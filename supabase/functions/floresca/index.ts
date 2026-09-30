// ============================================================================
//  FLORESCA · Edge Function (Supabase / Deno)
//
//  Por que existe: o navegador não consegue ler o HTML de outro site (CORS).
//  Esta função roda no servidor do Supabase e faz o trabalho "de bastidor":
//
//    action: "fetch"    → baixa o HTML da página + robots.txt + sitemap.xml
//    action: "psi"      → roda o Google PageSpeed Insights (Lighthouse + CrUX)
//    action: "suggest"  → buscas reais do Google Autocomplete p/ uma palavra
//    action: "save"     → salva o resultado da análise na tabela `analyses`
//    action: "history"  → lista as últimas análises (opcional: de um host)
//
//  Deploy:  supabase functions deploy floresca --no-verify-jwt
//  Segredo opcional (recomendado): supabase secrets set PSI_API_KEY=xxxx
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*", // troque pelo domínio do seu GitHub Pages se quiser restringir
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 FlorescaBot/1.0";
const MAX_HTML = 2_000_000; // 2 MB

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

// --- proteção básica contra SSRF (não deixar a função acessar rede interna) ---
function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Só http/https");
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) ||
    h === "0.0.0.0" || h.startsWith("[") || /^\d+$/.test(h)
  ) throw new Error("Endereço não permitido");
  return u;
}

async function timedFetch(url: string, ms = 15000, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", ...(init.headers || {}) },
    });
    return { res, ms: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(t);
  }
}

async function readText(res: Response, limit = MAX_HTML) {
  const buf = new Uint8Array(await res.arrayBuffer());
  const slice = buf.byteLength > limit ? buf.slice(0, limit) : buf;
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(slice), bytes: buf.byteLength };
}

// ---------------------------------------------------------------- actions ---

async function actionFetch(rawUrl: string) {
  const u = assertPublicUrl(rawUrl);
  const { res, ms } = await timedFetch(u.href);
  const { text, bytes } = await readText(res);

  const pick = [
    "content-type", "content-encoding", "cache-control", "strict-transport-security",
    "x-robots-tag", "server", "x-powered-by", "content-security-policy",
    "x-frame-options", "x-content-type-options", "referrer-policy", "last-modified",
  ];
  const headers: Record<string, string> = {};
  for (const k of pick) {
    const v = res.headers.get(k);
    if (v) headers[k] = v.slice(0, 300);
  }

  const origin = new URL(res.url || u.href).origin;

  // robots.txt
  let robots: { found: boolean; text?: string; sitemaps?: string[] } = { found: false };
  try {
    const r = await timedFetch(origin + "/robots.txt", 8000);
    if (r.res.ok && /text\/plain/i.test(r.res.headers.get("content-type") || "text/plain")) {
      const t = (await readText(r.res, 100_000)).text;
      robots = {
        found: true,
        text: t.slice(0, 5000),
        sitemaps: [...t.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 10),
      };
    }
  } catch { /* ignora */ }

  // sitemap.xml
  let sitemap: { found: boolean; url?: string; urls?: number; isIndex?: boolean } = { found: false };
  const candidates = [...(robots.sitemaps || []), origin + "/sitemap.xml", origin + "/sitemap_index.xml"];
  for (const s of candidates) {
    try {
      assertPublicUrl(s);
      const r = await timedFetch(s, 8000);
      if (!r.res.ok) continue;
      const t = (await readText(r.res, 3_000_000)).text;
      if (!/<(urlset|sitemapindex)/i.test(t)) continue;
      sitemap = {
        found: true,
        url: s,
        isIndex: /<sitemapindex/i.test(t),
        urls: (t.match(/<loc>/gi) || []).length,
      };
      break;
    } catch { /* tenta o próximo */ }
  }

  return {
    requestedUrl: u.href,
    finalUrl: res.url || u.href,
    redirected: res.redirected,
    status: res.status,
    ttfbMs: ms,
    bytes,
    headers,
    html: text,
    robots,
    sitemap,
  };
}

async function actionPsi(rawUrl: string, strategy: string) {
  const u = assertPublicUrl(rawUrl);
  const key = Deno.env.get("PSI_API_KEY");
  const qs = new URLSearchParams({ url: u.href, strategy: strategy === "desktop" ? "desktop" : "mobile", locale: "pt_BR" });
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) qs.append("category", c);
  if (key) qs.set("key", key);
  const { res } = await timedFetch("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + qs, 90000);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "PageSpeed falhou");
  // devolve só o necessário (o JSON completo passa de 1 MB)
  const lh = data.lighthouseResult || {};
  const audits: Record<string, unknown> = {};
  for (const [k, a] of Object.entries<any>(lh.audits || {})) {
    audits[k] = {
      score: a.score, numericValue: a.numericValue, displayValue: a.displayValue,
      title: a.title, scoreDisplayMode: a.scoreDisplayMode,
      ...(k === "final-screenshot" ? { details: a.details } : {}),
      ...(["total-byte-weight", "resource-summary"].includes(k) ? { details: a.details } : {}),
    };
  }
  return {
    strategy,
    categories: lh.categories,
    audits,
    loadingExperience: data.loadingExperience,
    originLoadingExperience: data.originLoadingExperience,
  };
}

async function actionSuggest(q: string, hl = "pt-BR", gl = "br") {
  if (!q || q.length > 120) throw new Error("Consulta inválida");
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}&q=${encodeURIComponent(q)}`;
  const { res } = await timedFetch(url, 8000);
  const buf = new Uint8Array(await res.arrayBuffer());
  // o Google às vezes responde em ISO-8859-1
  let txt = new TextDecoder("utf-8").decode(buf);
  if (txt.includes("�")) txt = new TextDecoder("iso-8859-1").decode(buf);
  const arr = JSON.parse(txt);
  return { q, suggestions: (arr[1] || []).slice(0, 10) };
}

function db() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function actionSave(record: any) {
  const clamp = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const row = {
    url: String(record?.url || "").slice(0, 2000),
    host: String(record?.host || "").slice(0, 255),
    overall: clamp(record?.overall),
    reach: clamp(record?.reach),
    scores: record?.scores ?? {},
    summary: record?.summary ?? {},
  };
  if (!row.url) throw new Error("Registro sem URL");
  const { data, error } = await db().from("analyses").insert(row).select("id, created_at").single();
  if (error) throw error;
  return data;
}

async function actionHistory(host?: string) {
  let q = db().from("analyses")
    .select("id, url, host, overall, reach, scores, summary, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (host) q = q.eq("host", host);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ------------------------------------------------------------------ server ---

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case "fetch":   return json(await actionFetch(body.url));
      case "psi":     return json(await actionPsi(body.url, body.strategy));
      case "suggest": return json(await actionSuggest(body.q, body.hl, body.gl));
      case "save":    return json(await actionSave(body.record));
      case "history": return json(await actionHistory(body.host));
      case "ping":    return json({ ok: true, psiKey: !!Deno.env.get("PSI_API_KEY") });
      default:        return json({ error: "Ação desconhecida" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
