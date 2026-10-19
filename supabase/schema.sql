-- =====================================================================
-- NKWAY — Schema multi-tenant para Supabase
-- Execute no SQL Editor do painel: https://app.supabase.com
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EMPRESAS (tenants)
-- ---------------------------------------------------------------------
create table if not exists empresas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cnpj        text,
  plano       text not null default 'free' check (plano in ('free','pro','ultra')),
  trial_fim   timestamptz not null default now() + interval '14 days',
  valido_ate  timestamptz,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. USUÁRIOS (liga auth.users -> empresa)
-- ---------------------------------------------------------------------
create table if not exists usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome       text not null,
  email      text not null,
  papel      text not null default 'admin' check (papel in ('admin','vendedor','financeiro')),
  criado_em  timestamptz not null default now()
);

-- Helper: retorna a empresa do usuário logado
create or replace function empresa_do_usuario()
returns uuid language sql stable security definer as $$
  select empresa_id from usuarios where id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- 3. CADASTROS
-- ---------------------------------------------------------------------
create table if not exists produtos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nome        text not null,
  sku         text,
  categoria   text,
  custo       numeric(12,2) not null default 0,
  preco       numeric(12,2) not null default 0,
  estoque     integer not null default 0,
  estoque_min integer not null default 0,
  criado_em   timestamptz not null default now()
);

create table if not exists clientes (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  nome       text not null,
  documento  text,
  email      text,
  telefone   text,
  cidade     text,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. VENDAS (DAV e Fiscal)
-- ---------------------------------------------------------------------
create table if not exists vendas (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  numero       integer not null,
  cliente_id   uuid references clientes(id) on delete set null,
  cliente_nome text not null,
  itens        jsonb not null default '[]',
  total        numeric(12,2) not null default 0,
  desconto     numeric(12,2) not null default 0,
  pagamento    text not null,
  tipo         text not null check (tipo in ('dav','fiscal')),
  status       text not null default 'aberto' check (status in ('aberto','faturado','cancelado')),
  validade     date,
  observacao   text,
  fiscal       jsonb,            -- { modelo, serie, numeroNota, chave, protocolo, autorizadaEm }
  data         timestamptz not null default now()
);

create table if not exists lancamentos (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete cascade,
  descricao  text not null,
  valor      numeric(12,2) not null,
  tipo       text not null check (tipo in ('receber','pagar')),
  vencimento date not null,
  pago       boolean not null default false,
  categoria  text,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. ÍNDICES
-- ---------------------------------------------------------------------
create index if not exists idx_produtos_empresa    on produtos(empresa_id);
create index if not exists idx_clientes_empresa    on clientes(empresa_id);
create index if not exists idx_vendas_empresa      on vendas(empresa_id, data desc);
create index if not exists idx_lancamentos_empresa on lancamentos(empresa_id, vencimento);

-- ---------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY — isolamento total entre empresas
-- ---------------------------------------------------------------------
alter table empresas    enable row level security;
alter table usuarios    enable row level security;
alter table produtos    enable row level security;
alter table clientes    enable row level security;
alter table vendas      enable row level security;
alter table lancamentos enable row level security;

-- Empresa: só enxerga a própria
drop policy if exists p_empresa on empresas;
create policy p_empresa on empresas
  for all using (id = empresa_do_usuario());

-- Usuários da mesma empresa
drop policy if exists p_usuarios on usuarios;
create policy p_usuarios on usuarios
  for all using (empresa_id = empresa_do_usuario() or id = auth.uid());

-- Demais tabelas: filtro por empresa_id
drop policy if exists p_produtos on produtos;
create policy p_produtos on produtos
  for all using (empresa_id = empresa_do_usuario())
  with check (empresa_id = empresa_do_usuario());

drop policy if exists p_clientes on clientes;
create policy p_clientes on clientes
  for all using (empresa_id = empresa_do_usuario())
  with check (empresa_id = empresa_do_usuario());

drop policy if exists p_vendas on vendas;
create policy p_vendas on vendas
  for all using (empresa_id = empresa_do_usuario())
  with check (empresa_id = empresa_do_usuario());

drop policy if exists p_lancamentos on lancamentos;
create policy p_lancamentos on lancamentos
  for all using (empresa_id = empresa_do_usuario())
  with check (empresa_id = empresa_do_usuario());

-- ---------------------------------------------------------------------
-- 7. IMPORTANTE — segurança do plano
-- ---------------------------------------------------------------------
-- As colunas plano / valido_ate NUNCA devem ser escritas pelo frontend.
-- Revogue o update e deixe apenas o webhook (service_role) alterar:
revoke update (plano, valido_ate) on empresas from authenticated;

-- ---------------------------------------------------------------------
-- 8. SIGNUP: cria empresa + usuário numa transação
-- ---------------------------------------------------------------------
create or replace function criar_empresa(p_nome text, p_cnpj text, p_usuario text)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  insert into empresas (nome, cnpj) values (p_nome, p_cnpj) returning id into v_id;
  insert into usuarios (id, empresa_id, nome, email)
    values (auth.uid(), v_id, p_usuario, auth.email());
  return v_id;
end $$;
