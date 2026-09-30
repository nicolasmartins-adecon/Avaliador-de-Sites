# Floresca SEO

Diagnóstico de sites: cole uma URL e receba notas por área, plano de ação priorizado
(Crítico → Baixo), Core Web Vitals, palavras-chave, buscas reais do Google, prévia do
resultado no Google e do cartão de compartilhamento.

```
floresca-seo/
├── index.html                          ← o site inteiro (vai para o GitHub Pages)
├── README.md
└── supabase/
    ├── schema.sql                      ← tabela do histórico
    ├── config.toml                     ← desliga a exigência de login na função
    └── functions/floresca/index.ts     ← Edge Function (lê o HTML dos sites, PageSpeed, autocomplete, histórico)
```

## Como funciona

| Camada | Onde roda | O que faz |
|---|---|---|
| `index.html` | GitHub Pages (navegador) | Interface, motor de regras, notas, gráficos |
| Edge Function `floresca` | Supabase | Busca o HTML do site analisado (o navegador não consegue por causa do CORS), robots.txt, sitemap, PageSpeed e Google Autocomplete |
| Tabela `analyses` | Supabase (Postgres) | Guarda o histórico e permite ver a evolução de cada site |

**Funciona sem Supabase também**: nesse modo o PageSpeed é chamado direto do Google e o HTML
é lido por proxies públicos (allorigins, corsproxy, codetabs). É ótimo para testar, mas
menos estável. O selo no topo da página mostra o modo atual:
`supabase conectado` · `modo público` · `só pagespeed`.

---

## 1. Publicar no GitHub Pages (5 minutos)

1. Crie um repositório no GitHub (ex.: `floresca-seo`), público.
2. Envie os arquivos desta pasta (pelo botão **Add file → Upload files** ou por git):
   ```bash
   git init && git add . && git commit -m "Floresca SEO"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/floresca-seo.git
   git push -u origin main
   ```
3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, pasta `/ (root)` → **Save**.
4. Em 1–2 minutos o site fica em `https://SEU-USUARIO.github.io/floresca-seo/`.

Pronto: já dá para usar no modo público.

## 2. Conectar o Supabase (recomendado)

### 2.1 Criar a tabela
Supabase → seu projeto → **SQL Editor → New query** → cole o conteúdo de
`supabase/schema.sql` → **Run**.

A tabela fica com RLS ligado e sem policies públicas: ninguém lê nem grava direto pela API;
só a Edge Function (que usa a chave de serviço, disponível apenas no servidor).

### 2.2 Publicar a Edge Function

**Opção A · pelo terminal (Supabase CLI)**
```bash
npm i -g supabase            # ou: brew install supabase/tap/supabase
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase functions deploy floresca --no-verify-jwt
```

**Opção B · pelo painel**
Supabase → **Edge Functions → Deploy a new function → Via Editor** → nome `floresca` →
cole o conteúdo de `supabase/functions/floresca/index.ts` → **Deploy**. Depois, em
**Settings** da função, desligue **Enforce JWT verification** (a página chama a função
sem login).

A URL fica assim: `https://SEU_PROJECT_REF.supabase.co/functions/v1/floresca`

### 2.3 (Opcional) Chave do PageSpeed
Sem chave o PageSpeed funciona, mas com limite de uso compartilhado (erros 429 em horários de pico).

1. Google Cloud Console → crie um projeto → **APIs e serviços → Biblioteca** →
   ative **PageSpeed Insights API** → **Credenciais → Criar chave de API**.
2. Guarde como segredo da função (nunca vai para o navegador):
   ```bash
   supabase secrets set PSI_API_KEY=AIza...
   ```
   ou no painel: **Edge Functions → Secrets → Add new secret**.

### 2.4 Apontar o site para a função
Abra `index.html` e edite o bloco no topo:
```js
window.FLORESCA_CONFIG = {
  EDGE_URL: "https://SEU_PROJECT_REF.supabase.co/functions/v1/floresca",
  PSI_API_KEY: "",
  PUBLIC_PROXY: true
};
```
Faça commit/push. Para testar antes, dá para colar a URL pela engrenagem ⚙ da página
(fica salva só no seu navegador) e clicar em **Testar conexão**.

---

## O que é analisado

Cerca de 60 verificações em 10 áreas, cada uma com peso de 1 a 10:

- **Indexação**: status HTTP, HTTPS, noindex, canônica, idioma, robots.txt, sitemap, conteúdo que depende de JavaScript
- **SEO on-page**: title (texto e largura em pixels), meta description, H1, hierarquia de títulos, palavra-chave no title/H1/descrição/início, URL, nota SEO do Lighthouse
- **Conteúdo**: volume, legibilidade (Flesch adaptado ao português), subtítulos, alt das imagens, densidade da palavra-chave
- **Performance**: nota Lighthouse, LCP, INP (dados reais do Chrome quando existem) ou TBT, CLS, FCP, TTFB, peso, compressão, lazy loading, dimensões e formatos de imagem
- **Mobile e acessibilidade**: viewport, zoom, rótulos de formulário, nota de acessibilidade, contraste
- **Social**: og:title, og:description, og:image, cartão do X, favicon, perfis linkados
- **Dados estruturados**: JSON-LD/microdata, Organization/LocalBusiness, marcações de conteúdo, erros de sintaxe
- **Links**: internos, textos genéricos, links sem nome, links sem destino
- **Confiança**: conteúdo misto, contato visível, política de privacidade (LGPD), HSTS e cabeçalhos de segurança, boas práticas
- **Conversão de leads**: CTAs, CTA no topo, canal de captação (formulário/WhatsApp/telefone), WhatsApp, tamanho do formulário, Analytics/pixels

**Notas**
- *Saúde geral*: média ponderada das 10 áreas.
- *Potencial de alcance*: foco em ser encontrado e clicado (indexação, on-page, conteúdo, performance…).
- *Poder de conversão*: foco em transformar visita em lead (conversão, confiança, performance, mobile).
- Se a página está bloqueada para o Google (noindex, robots.txt bloqueando tudo, erro HTTP), o alcance é limitado a 15 e a saúde a 35.

**Prioridades**: Crítico = falha com peso ≥ 9 · Alto = falha com peso ≥ 6 ou atenção com peso ≥ 9 ·
Médio = demais falhas ou atenção com peso ≥ 5 · Baixo = o resto. *Vitória rápida* = prioridade
Médio ou acima com esforço baixo.

**Limites**: analisa uma página por vez; não mede backlinks, autoridade de domínio nem volume exato de busca.
As sugestões de cauda longa são ideias por padrão de intenção; confirme volume no Google Keyword Planner ou Google Trends.

## Personalizar

- Pesos e textos de cada verificação: função `analyze()` em `index.html` (seção 5).
- Pesos das áreas: objeto `CATS`.
- Cores e fontes: variáveis no início do `<style>` (tema escuro no `:root`, claro logo abaixo).
- Restringir quem pode usar a função: troque `"Access-Control-Allow-Origin": "*"` pelo domínio do seu Pages em `index.ts`.

## Evolução de um site no tempo
A view `analyses_by_host` (criada pelo `schema.sql`) mostra total de análises, média e nota atual por domínio:
```sql
select * from analyses_by_host order by ultima_analise desc;
```
