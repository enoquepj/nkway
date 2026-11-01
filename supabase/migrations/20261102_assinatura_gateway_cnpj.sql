-- =============================================================================
-- NKWAY · Item 6 — Assinatura com Gateway e Recorrência por CNPJ
-- Migração aditiva e idempotente (preserva dados existentes e tabelas legadas)
-- =============================================================================

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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'nkway_app') then
    execute 'grant select, insert, update, delete on table public.nk_assinatura, public.nk_assinatura_fatura to nkway_app';
  end if;
exception when others then
  null;
end $$;
