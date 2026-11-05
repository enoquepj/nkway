-- NKWAY: parâmetros fiscais complementares por empresa.
-- Migração aditiva e idempotente: não atualiza produtos existentes nem toca tabelas legadas.
create table if not exists public.nk_fiscal_parametro (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa(id) on delete cascade,
  tipo text not null,
  codigo text not null default '',
  nome text not null,
  regime text not null default 'todos',
  dados jsonb not null default '{}'::jsonb,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists nk_fiscal_parametro_empresa_tipo_idx on public.nk_fiscal_parametro(empresa_id, tipo);
create unique index if not exists nk_fiscal_codigo_empresa_tipo_uidx on public.nk_fiscal_parametro(empresa_id, tipo, codigo) where tipo <> 'perfil';
create unique index if not exists nk_fiscal_perfil_empresa_nome_uidx on public.nk_fiscal_parametro(empresa_id, lower(nome)) where tipo = 'perfil';

create table if not exists public.nk_produto_tributacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa(id) on delete cascade,
  produto_id uuid not null references public.nk_produto(id) on delete cascade,
  perfil_id uuid references public.nk_fiscal_parametro(id) on delete set null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists nk_produto_tributacao_produto_uidx on public.nk_produto_tributacao(produto_id);
create index if not exists nk_produto_tributacao_empresa_idx on public.nk_produto_tributacao(empresa_id);

-- Caso a migração seja aplicada pelo proprietário do banco, mantém o acesso do usuário do app.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on public.nk_fiscal_parametro, public.nk_produto_tributacao to nkway_app';
  end if;
exception when insufficient_privilege then
  null;
end $$;
