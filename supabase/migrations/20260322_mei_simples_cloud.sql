-- =============================================================================
-- NKWAY · Ajustes para MEI / ME / Simples Nacional + nuvem Supabase
-- Rode no SQL Editor DEPOIS de schema.sql e (opcional) da migration DF-e.
-- Idempotente: pode rodar mais de uma vez.
-- =============================================================================

-- Porte e regime na empresa (onboarding MEI/ME)
alter table public.empresas
  add column if not exists porte text not null default 'mei';

alter table public.empresas
  add column if not exists regime text not null default 'simples';

alter table public.empresas
  add column if not exists uf char(2) not null default 'SP';

alter table public.empresas
  add column if not exists ie text;

-- Constraint de porte (drop/recreate se já existir nome genérico)
do $$
begin
  alter table public.empresas drop constraint if exists empresas_porte_check;
  alter table public.empresas
    add constraint empresas_porte_check
    check (porte in ('mei', 'me', 'epp', 'outros'));
exception when others then null;
end $$;

do $$
begin
  alter table public.empresas drop constraint if exists empresas_regime_check;
  alter table public.empresas
    add constraint empresas_regime_check
    check (regime in ('mei', 'simples', 'simples_excedente', 'presumido', 'real'));
exception when others then null;
end $$;

comment on column public.empresas.porte is 'mei | me | epp | outros — define limites sugeridos de plano e fiscal';
comment on column public.empresas.regime is 'Regime tributário padrão da empresa (Simples/MEI etc.)';

-- Config fiscal por empresa (1:1) — opcional, o app ainda usa local; cloud pode ler depois
create table if not exists public.config_fiscal (
  empresa_id   uuid primary key references public.empresas(id) on delete cascade,
  regime       text not null default 'simples',
  crt          smallint not null default 1,
  uf_padrao    char(2) not null default 'SP',
  ie           text,
  serie_nfce   text default '1',
  serie_nfe    text default '1',
  ambiente     smallint not null default 2 check (ambiente in (1, 2)),
  csc_id       text,
  csc_token    text,
  atualizado_em timestamptz not null default now()
);

alter table public.config_fiscal enable row level security;

drop policy if exists p_config_fiscal on public.config_fiscal;
create policy p_config_fiscal on public.config_fiscal
  for all using (empresa_id = public.empresa_do_usuario())
  with check (empresa_id = public.empresa_do_usuario());

-- Signup enriquecido (mantém assinatura antiga via defaults)
create or replace function public.criar_empresa(
  p_nome text,
  p_cnpj text,
  p_usuario text,
  p_porte text default 'mei',
  p_regime text default 'simples',
  p_uf text default 'SP'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_porte text := coalesce(nullif(trim(p_porte), ''), 'mei');
  v_regime text := coalesce(nullif(trim(p_regime), ''), 'simples');
  v_uf text := upper(coalesce(nullif(trim(p_uf), ''), 'SP'));
  v_crt smallint;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;

  if v_porte not in ('mei', 'me', 'epp', 'outros') then
    v_porte := 'mei';
  end if;

  -- MEI força regime mei + CRT 4
  if v_porte = 'mei' then
    v_regime := 'mei';
  end if;

  if v_regime not in ('mei', 'simples', 'simples_excedente', 'presumido', 'real') then
    v_regime := 'simples';
  end if;

  v_crt := case v_regime
    when 'mei' then 4
    when 'simples' then 1
    when 'simples_excedente' then 2
    else 3
  end;

  insert into public.empresas (nome, cnpj, porte, regime, uf, plano, trial_fim)
  values (
    coalesce(nullif(trim(p_nome), ''), 'Minha Empresa'),
    nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''),
    v_porte,
    v_regime,
    left(v_uf, 2),
    'free',
    now() + interval '14 days'
  )
  returning id into v_id;

  insert into public.usuarios (id, empresa_id, nome, email, papel)
  values (auth.uid(), v_id, coalesce(nullif(trim(p_usuario), ''), 'Administrador'), auth.email(), 'admin');

  insert into public.config_fiscal (empresa_id, regime, crt, uf_padrao, ambiente)
  values (v_id, v_regime, v_crt, left(v_uf, 2), 2);

  return v_id;
end;
$$;

grant execute on function public.criar_empresa(text, text, text, text, text, text) to authenticated;

-- View simples de “saúde da nuvem” por empresa (uso interno)
create or replace view public.v_empresa_resumo
with (security_invoker = true)
as
select
  e.id,
  e.nome,
  e.cnpj,
  e.porte,
  e.regime,
  e.uf,
  e.plano,
  e.trial_fim,
  (select count(*) from public.produtos p where p.empresa_id = e.id) as qtd_produtos,
  (select count(*) from public.clientes c where c.empresa_id = e.id) as qtd_clientes,
  (select count(*) from public.vendas v where v.empresa_id = e.id) as qtd_vendas
from public.empresas e
where e.id = public.empresa_do_usuario();

grant select on public.v_empresa_resumo to authenticated;
