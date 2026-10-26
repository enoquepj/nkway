-- =============================================================================
-- NKWAY · erp_estados — snapshot completo do ERP por empresa (sync nuvem)
-- - 1 linha por empresa (estado JSON)
-- - RLS multiempresa
-- - version + updated_at (concorrência otimista)
-- - limite 10 MB por empresa no JSON (octet_length)
-- - RPC salvar_estado_erp (security definer, só a própria empresa)
-- =============================================================================

create table if not exists public.erp_estados (
  empresa_id   uuid primary key references public.empresas(id) on delete cascade,
  -- Snapshot do DB do front (produtos, clientes, vendas, etc.)
  estado       jsonb not null default '{}'::jsonb,
  -- Controle de versão: cada save bem-sucedido incrementa
  version      bigint not null default 1,
  -- Tamanho em bytes do JSON (atualizado na RPC)
  tamanho_bytes integer not null default 0,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint erp_estados_tamanho_max check (tamanho_bytes <= 10485760)
);

comment on table public.erp_estados is
  'Estado integral do ERP por empresa para sincronização. Limite 10 MB (10485760 bytes) por empresa.';
comment on column public.erp_estados.version is
  'Versão monotônica. Cliente envia version conhecida; se divergir → conflito 409.';
comment on column public.erp_estados.tamanho_bytes is
  'octet_length do JSON em UTF-8. Check impede > 10 MB.';

create index if not exists idx_erp_estados_updated on public.erp_estados (updated_at desc);

alter table public.erp_estados enable row level security;

drop policy if exists p_erp_estados_select on public.erp_estados;
create policy p_erp_estados_select on public.erp_estados
  for select to authenticated
  using (empresa_id = public.empresa_do_usuario());

-- Inserts/updates só via RPC (authenticated não grava direto o jsonb solto)
drop policy if exists p_erp_estados_insert on public.erp_estados;
-- sem policy de insert/update para authenticated → bloqueado por RLS
-- service_role ignora RLS

-- -----------------------------------------------------------------------------
-- Campos extras em produtos / vendas (alinha com o front TypeScript)
-- -----------------------------------------------------------------------------
alter table public.produtos add column if not exists gtin text;
alter table public.produtos add column if not exists unidade text default 'UN';
alter table public.produtos add column if not exists marca text;
alter table public.produtos add column if not exists impostos jsonb default '{}'::jsonb;
alter table public.produtos add column if not exists pesavel boolean default false;
alter table public.produtos add column if not exists cod_balanca text;

alter table public.vendas add column if not exists v_frete numeric(12,2) default 0;
alter table public.vendas add column if not exists transporte jsonb;
alter table public.vendas add column if not exists t_pag text;
alter table public.vendas add column if not exists v_pago numeric(12,2);
alter table public.vendas add column if not exists v_troco numeric(12,2);
alter table public.vendas add column if not exists pagamentos jsonb;

alter table public.clientes add column if not exists cep text;
alter table public.clientes add column if not exists logradouro text;
alter table public.clientes add column if not exists numero text;
alter table public.clientes add column if not exists bairro text;
alter table public.clientes add column if not exists uf text;
alter table public.clientes add column if not exists cod_municipio text;
alter table public.clientes add column if not exists limite_credito numeric(12,2);

-- -----------------------------------------------------------------------------
-- RPC: carregar estado
-- -----------------------------------------------------------------------------
create or replace function public.carregar_estado_erp()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_do_usuario();
  v_row public.erp_estados%rowtype;
begin
  if v_emp is null then
    raise exception 'EMPRESA_NAO_ENCONTRADA' using errcode = 'P0001';
  end if;

  select * into v_row from public.erp_estados where empresa_id = v_emp;
  if not found then
    return jsonb_build_object(
      'existe', false,
      'version', 0,
      'estado', '{}'::jsonb,
      'tamanho_bytes', 0,
      'limite_bytes', 10485760,
      'updated_at', null
    );
  end if;

  return jsonb_build_object(
    'existe', true,
    'version', v_row.version,
    'estado', v_row.estado,
    'tamanho_bytes', v_row.tamanho_bytes,
    'limite_bytes', 10485760,
    'updated_at', v_row.updated_at
  );
end;
$$;

grant execute on function public.carregar_estado_erp() to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: salvar estado (concorrência otimista + limite 10 MB)
-- p_version_cliente = version que o cliente leu; 0 = primeiro save
-- Retorno JSON: ok | conflito | grande_demais
-- -----------------------------------------------------------------------------
create or replace function public.salvar_estado_erp(
  p_estado jsonb,
  p_version_cliente bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_do_usuario();
  v_bytes integer;
  v_atual public.erp_estados%rowtype;
  v_nova_version bigint;
begin
  if v_emp is null then
    raise exception 'EMPRESA_NAO_ENCONTRADA' using errcode = 'P0001';
  end if;

  if p_estado is null then
    return jsonb_build_object('ok', false, 'erro', 'ESTADO_NULO');
  end if;

  -- Tamanho real do JSON em texto UTF-8
  v_bytes := octet_length(p_estado::text);

  if v_bytes > 10485760 then
    return jsonb_build_object(
      'ok', false,
      'erro', 'LIMITE_10MB',
      'tamanho_bytes', v_bytes,
      'limite_bytes', 10485760,
      'mensagem', 'Estado da empresa ultrapassou 10 MB. Reduza histórico (vendas/XML) ou contate o suporte para upgrade.'
    );
  end if;

  select * into v_atual from public.erp_estados where empresa_id = v_emp for update;

  if not found then
    -- Primeiro save
    if p_version_cliente is distinct from 0 and p_version_cliente is distinct from 1 then
      -- cliente achava que já existia versão — ainda assim permitimos create se vazio
      null;
    end if;
    insert into public.erp_estados (empresa_id, estado, version, tamanho_bytes, updated_at)
    values (v_emp, p_estado, 1, v_bytes, now());
    return jsonb_build_object(
      'ok', true,
      'version', 1,
      'tamanho_bytes', v_bytes,
      'limite_bytes', 10485760,
      'updated_at', now()
    );
  end if;

  -- Conflito: alguém salvou outra versão no meio
  if p_version_cliente is distinct from null
     and p_version_cliente is distinct from 0
     and p_version_cliente <> v_atual.version then
    return jsonb_build_object(
      'ok', false,
      'erro', 'CONFLITO_VERSAO',
      'version_servidor', v_atual.version,
      'version_cliente', p_version_cliente,
      'updated_at', v_atual.updated_at,
      'mensagem', 'Outro dispositivo alterou os dados. Recarregue e tente de novo (ou force o save).'
    );
  end if;

  v_nova_version := v_atual.version + 1;

  update public.erp_estados set
    estado = p_estado,
    version = v_nova_version,
    tamanho_bytes = v_bytes,
    updated_at = now()
  where empresa_id = v_emp;

  return jsonb_build_object(
    'ok', true,
    'version', v_nova_version,
    'tamanho_bytes', v_bytes,
    'limite_bytes', 10485760,
    'updated_at', now()
  );
end;
$$;

grant execute on function public.salvar_estado_erp(jsonb, bigint) to authenticated;

-- Force save (admin da empresa): ignora version do cliente, ainda respeita 10 MB
create or replace function public.salvar_estado_erp_force(p_estado jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.salvar_estado_erp(p_estado, 0);
end;
$$;

grant execute on function public.salvar_estado_erp_force(jsonb) to authenticated;
