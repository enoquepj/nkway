-- =============================================================================
-- NKWAY · Fase 1 — Usuários, Perfis, Permissões e Trilha de Auditoria
-- Migração idempotente e aditiva (preserva 100% dos dados existentes e tabelas legadas)
-- =============================================================================

alter table public.nk_usuario
  add column if not exists ativo boolean not null default true,
  add column if not exists atualizado_em timestamptz default now();

create index if not exists nk_usuario_empresa_idx on public.nk_usuario (empresa_id);

create table if not exists public.nk_auditoria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  usuario_id uuid,
  usuario_nome text not null default '',
  usuario_papel text not null default '',
  acao text not null,
  entidade text not null,
  registro_id text not null default '',
  resumo text not null default '',
  alteracoes jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists nk_auditoria_empresa_data_idx on public.nk_auditoria (empresa_id, created_at);
create index if not exists nk_auditoria_empresa_acao_idx on public.nk_auditoria (empresa_id, acao);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on table public.nk_auditoria to nkway_app';
  end if;
exception when others then
  null;
end $$;
