-- =============================================================================
-- NKWAY · Etapa 1 (2026) — Quebra de caixa, homologação e fundo de troco
-- =============================================================================
-- ADITIVA e idempotente (IF NOT EXISTS). Preserva 100% dos dados existentes.
-- Nao cria RLS (as tabelas nk_* sao acessadas por nkway_app, tenant por empresa_id),
-- nao toca em tabelas legadas sem prefixo, nao altera DATABASE_URL e nao executa
-- UPDATE em registros existentes.
--
-- A auto-aplicacao em producao é feita por src/db/migracao.ts no boot.
-- O SQL consolidado gerado pela tela /migracao está em src/lib/migracaoLegado.ts.
-- =============================================================================

alter table public.nk_caixa_sessao
  add column if not exists status_aprovacao text,
  add column if not exists homologado_por_usuario_id uuid,
  add column if not exists fundo_troco numeric(12, 2);

comment on column public.nk_caixa_sessao.status_aprovacao is
  'null (sem quebra) | pendente | homologado — aprovação de quebra no fechamento às cegas.';
comment on column public.nk_caixa_sessao.fundo_troco is
  'Fundo de troco provisionado para a próxima abertura (padrão R$ 100,00 na aplicação).';

create table if not exists public.nk_caixa_quebra_log (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  sessao_id uuid not null references public.nk_caixa_sessao (id) on delete cascade,
  usuario_id uuid references public.nk_usuario (id),
  valor_diferenca numeric(12, 2) not null default 0,
  tipo text not null default 'FALTA',
  justificativa text not null default '',
  homologado_por_usuario_id uuid,
  homologado_em timestamptz,
  created_at timestamptz default now()
);

comment on table public.nk_caixa_quebra_log is
  'SOBRA quando informado > esperado, FALTA no caso contrário; homologado apenas por perfil com caixa.homologar.';

create index if not exists nk_caixa_quebra_sessao_idx on public.nk_caixa_quebra_log (sessao_id);
create index if not exists nk_caixa_quebra_empresa_idx on public.nk_caixa_quebra_log (empresa_id, created_at);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on table public.nk_caixa_quebra_log to nkway_app';
  end if;
exception when others then
  null;
end $$;
