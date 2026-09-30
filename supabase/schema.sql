-- ============================================================================
--  FLORESCA · histórico de análises
--  Rode este arquivo no Supabase: Dashboard → SQL Editor → New query → Run
-- ============================================================================

create table if not exists public.analyses (
  id          uuid primary key default gen_random_uuid(),
  url         text        not null,
  host        text,
  overall     smallint    check (overall between 0 and 100),
  reach       smallint    check (reach between 0 and 100),
  scores      jsonb       not null default '{}'::jsonb,   -- nota por categoria
  summary     jsonb       not null default '{}'::jsonb,   -- contagem de falhas, palavra-chave principal etc.
  created_at  timestamptz not null default now()
);

create index if not exists analyses_created_at_idx on public.analyses (created_at desc);
create index if not exists analyses_host_idx       on public.analyses (host);

-- Segurança: RLS ligado e NENHUMA policy para anon/authenticated.
-- Resultado: ninguém lê ou grava direto pela API pública; só a Edge Function
-- (que usa a chave secreta do servidor) consegue salvar e listar o histórico.
alter table public.analyses enable row level security;

-- (Opcional) evolução de um mesmo site ao longo do tempo:
create or replace view public.analyses_by_host
with (security_invoker = true) as
select host,
       count(*)                         as total_analises,
       max(created_at)                  as ultima_analise,
       round(avg(overall))::int         as media_indice,
       (array_agg(overall order by created_at desc))[1] as indice_atual
from public.analyses
group by host;
