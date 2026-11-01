-- =============================================================================
-- NKWAY · SCRIPT CONSOLIDADO ÚNICO PARA O SUPABASE (TODAS AS NOVAS TABELAS E COLUNAS nk_*)
-- Seguro e idempotente (IF NOT EXISTS): pode rodar mesmo que parte já tenha sido aplicada.
-- Preserva 100% dos dados existentes e não altera nenhuma tabela legada sem prefixo.
-- =============================================================================

-- 1. FASE 1 — Usuários (colunas ativo e atualizado_em) e Trilha de Auditoria (nk_auditoria)
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

-- 2. FASE 2 — Fechamento de Caixa por Operador (nk_caixa_sessao e nk_caixa_movimento)
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

-- 3. FASE 3 E EMISSOR SEFAZ 4.00 — Colunas xml_fiscal e status_sefaz em nk_venda
alter table public.nk_venda
  add column if not exists xml_fiscal text,
  add column if not exists status_sefaz text default 'simulado',
  add column if not exists cstat_sefaz text default '100',
  add column if not exists motivo_sefaz text default '',
  add column if not exists emissor_provedor text default 'local';

create index if not exists nk_venda_status_sefaz_idx on public.nk_venda (empresa_id, status_sefaz);

-- 4. ASSINATURA COM GATEWAY E RECORRÊNCIA POR CNPJ (nk_assinatura e nk_assinatura_fatura)
create table if not exists public.nk_assinatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  cnpj text not null,
  razao_social text not null default '',
  email_cobranca text not null default '',
  plano_id text not null,
  ciclo text not null default 'mensal',
  forma_pagamento text not null default 'pix',
  valor_ciclo numeric(12, 2) not null default 0,
  status text not null default 'aguardando_pagamento',
  gateway text not null default 'sandbox',
  gateway_customer_id text default '',
  gateway_subscription_id text default '',
  cartao_bandeira text default '',
  cartao_ultimos4 text default '',
  proximo_vencimento date not null,
  cancelar_ao_fim_do_ciclo boolean not null default false,
  cancelada_em timestamptz,
  motivo_cancelamento text default '',
  created_at timestamptz default now(),
  atualizado_em timestamptz default now()
);

create index if not exists nk_assinatura_empresa_idx on public.nk_assinatura (empresa_id);
create index if not exists nk_assinatura_cnpj_idx on public.nk_assinatura (cnpj);
create index if not exists nk_assinatura_gateway_sub_idx on public.nk_assinatura (gateway_subscription_id);

create table if not exists public.nk_assinatura_fatura (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,
  assinatura_id uuid not null references public.nk_assinatura (id) on delete cascade,
  numero integer not null,
  cnpj text not null,
  plano_id text not null,
  ciclo text not null default 'mensal',
  competencia text not null default '',
  valor numeric(12, 2) not null default 0,
  forma_pagamento text not null default 'pix',
  status text not null default 'pendente',
  vencimento date not null,
  pago_em timestamptz,
  gateway text not null default 'sandbox',
  gateway_payment_id text default '',
  checkout_url text default '',
  pix_payload text default '',
  linha_digitavel text default '',
  nsu_autorizacao text default '',
  created_at timestamptz default now()
);

create index if not exists nk_ass_fatura_empresa_idx on public.nk_assinatura_fatura (empresa_id, created_at);
create index if not exists nk_ass_fatura_ass_idx on public.nk_assinatura_fatura (assinatura_id);
create index if not exists nk_ass_fatura_gw_pay_idx on public.nk_assinatura_fatura (gateway_payment_id);

-- 5. PERMISSÕES PARA O USUÁRIO DEDICADO nkway_app
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on table public.nk_auditoria, public.nk_caixa_sessao, public.nk_caixa_movimento, public.nk_assinatura, public.nk_assinatura_fatura to nkway_app';
  end if;
exception when others then
  null;
end $$;
