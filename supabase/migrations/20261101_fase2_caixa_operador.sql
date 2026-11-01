-- =============================================================================
-- NKWAY · Fase 2 — Fechamento de Caixa por Operador
-- Migração idempotente e aditiva (preserva dados existentes)
-- =============================================================================

alter table public.nk_venda
  add column if not exists operador_id uuid,
  add column if not exists caixa_sessao_id uuid;

create index if not exists nk_venda_caixa_sessao_idx on public.nk_venda (caixa_sessao_id);

create table if not exists public.nk_caixa_sessao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  numero integer not null,
  terminal text not null default 'CAIXA 1',
  operador_id uuid not null references public.nk_usuario (id),
  operador_nome text not null,
  status text not null default 'aberto',
  saldo_inicial numeric(12, 2) not null default 0,
  valores_esperados jsonb default '{}'::jsonb,
  valores_informados jsonb default '{}'::jsonb,
  diferencas jsonb default '{}'::jsonb,
  total_esperado numeric(12, 2) not null default 0,
  total_informado numeric(12, 2) not null default 0,
  diferenca_total numeric(12, 2) not null default 0,
  observacao_abertura text default '',
  justificativa_fechamento text default '',
  aberto_em timestamptz default now(),
  fechado_em timestamptz,
  fechado_por_id uuid,
  fechado_por_nome text default '',
  reaberto_em timestamptz,
  reaberto_por_nome text default '',
  justificativa_reabertura text default ''
);

create index if not exists nk_caixa_sessao_empresa_idx on public.nk_caixa_sessao (empresa_id, aberto_em);
create index if not exists nk_caixa_sessao_operador_idx on public.nk_caixa_sessao (empresa_id, operador_id, status);

-- Impede duas sessões de caixa abertas simultaneamente para o mesmo operador
create unique index if not exists nk_caixa_sessao_operador_aberto_uidx
  on public.nk_caixa_sessao (empresa_id, operador_id)
  where status = 'aberto';

create table if not exists public.nk_caixa_movimento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  sessao_id uuid not null references public.nk_caixa_sessao (id) on delete cascade,
  tipo text not null,
  forma text not null default 'dinheiro',
  valor numeric(12, 2) not null default 0,
  motivo text not null default '',
  venda_id uuid,
  usuario_id uuid,
  usuario_nome text not null default '',
  created_at timestamptz default now()
);

create index if not exists nk_caixa_mov_sessao_idx on public.nk_caixa_movimento (sessao_id);
create index if not exists nk_caixa_mov_empresa_idx on public.nk_caixa_movimento (empresa_id);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on table public.nk_caixa_sessao, public.nk_caixa_movimento to nkway_app';
  end if;
exception when others then
  null;
end $$;
