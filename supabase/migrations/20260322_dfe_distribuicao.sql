-- =============================================================================
-- NKWAY · Distribuição de DF-e (NF-e de entrada / Ambiente Nacional)
-- NT 2014.002 — NfeDistDFeInteresse
-- Requer: pgcrypto, pg_cron (e http ou pg_net para disparar a Edge Function)
-- Rode no SQL Editor do Supabase (ou via CLI de migrations).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
-- create extension if not exists pg_net; -- descomente se disponível no projeto

-- -----------------------------------------------------------------------------
-- 1. Configuração fiscal por empresa (certificado A1 + controle de NSU)
-- -----------------------------------------------------------------------------
create table if not exists public.empresas_config (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users (id) on delete cascade,
  cnpj              text not null,
  razao_social      text not null default '',
  -- caminho no bucket privado "certificados-a1"
  certificado_path  text,
  -- senha do .pfx cifrada com pgcrypto (chave = app.dfe_secret / vault)
  certificado_senha bytea,
  -- NSU da última consulta bem-sucedida (pad 15 dígitos na aplicação)
  ultimo_nsu        text not null default '000000000000000',
  max_nsu           text not null default '000000000000000',
  ambiente          smallint not null default 1 check (ambiente in (1, 2)), -- 1 prod · 2 homolog
  ativo             boolean not null default true,
  ultima_consulta_em timestamptz,
  ultimo_cstat      text,
  ultimo_xmotivo    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint empresas_config_cnpj_unique unique (cnpj),
  constraint empresas_config_cnpj_digits check (cnpj ~ '^\d{14}$')
);

create index if not exists idx_empresas_config_user on public.empresas_config (user_id);
create index if not exists idx_empresas_config_ativo on public.empresas_config (ativo) where ativo;

comment on table public.empresas_config is
  'Cadastro de empresas destinatárias para captura automática de DF-e (NF-e de entrada).';
comment on column public.empresas_config.certificado_senha is
  'Senha do A1 cifrada (pgp_sym_encrypt). Nunca armazene em texto puro.';
comment on column public.empresas_config.ultimo_nsu is
  'Último NSU processado com sucesso — evita cStat 656 Consumo Indevido.';

-- -----------------------------------------------------------------------------
-- 2. NF-e de entrada capturadas (XML bruto + metadados)
-- -----------------------------------------------------------------------------
create table if not exists public.nfe_entrada (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references public.empresas_config (id) on delete cascade,
  cnpj_destinatario  text not null,
  chave_acesso       text not null,
  nsu                text not null,
  schema_tipo        text not null default 'procNFe', -- procNFe | resNFe | resEvento | procEventoNFe
  emitente_cnpj      text,
  emitente_nome      text,
  valor_total        numeric(15, 2),
  data_emissao       timestamptz,
  status_manifesto   text not null default 'pendente'
                       check (status_manifesto in (
                         'pendente', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada', 'resumo'
                       )),
  xml_bruto          text,          -- XML completo (nfeProc / resNFe / evento)
  importado_erp      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint nfe_entrada_chave_unique unique (chave_acesso),
  constraint nfe_entrada_chave_44 check (chave_acesso ~ '^\d{44}$')
);

create index if not exists idx_nfe_entrada_empresa on public.nfe_entrada (empresa_id);
create index if not exists idx_nfe_entrada_dest on public.nfe_entrada (cnpj_destinatario);
create index if not exists idx_nfe_entrada_emit on public.nfe_entrada (emitente_cnpj);
create index if not exists idx_nfe_entrada_emissao on public.nfe_entrada (data_emissao desc);
create index if not exists idx_nfe_entrada_nsu on public.nfe_entrada (empresa_id, nsu);

comment on table public.nfe_entrada is
  'Documentos capturados via NfeDistDFeInteresse (XML bruto + dados para o ERP).';

-- -----------------------------------------------------------------------------
-- 3. updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_empresas_config_updated on public.empresas_config;
create trigger trg_empresas_config_updated
  before update on public.empresas_config
  for each row execute function public.set_updated_at();

drop trigger if exists trg_nfe_entrada_updated on public.nfe_entrada;
create trigger trg_nfe_entrada_updated
  before update on public.nfe_entrada
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Helpers de criptografia da senha do A1 (chave vem de Vault / GUC)
--    Defina no painel: Database → Settings ou via secrets da Edge Function
--    e sincronize: select set_config('app.dfe_secret', 'SUA_CHAVE_LONGA', false);
--    Em produção use Supabase Vault.
-- -----------------------------------------------------------------------------
create or replace function public.dfe_encrypt_password(plain text)
returns bytea
language sql
security definer
set search_path = public
as $$
  select pgp_sym_encrypt(
    plain,
    coalesce(current_setting('app.dfe_secret', true), 'CHANGE_ME_DFE_SECRET_MIN_32_CHARS!!')
  );
$$;

create or replace function public.dfe_decrypt_password(cipher bytea)
returns text
language sql
security definer
set search_path = public
as $$
  select pgp_sym_decrypt(
    cipher,
    coalesce(current_setting('app.dfe_secret', true), 'CHANGE_ME_DFE_SECRET_MIN_32_CHARS!!')
  );
$$;

revoke all on function public.dfe_encrypt_password(text) from public;
revoke all on function public.dfe_decrypt_password(bytea) from public;
grant execute on function public.dfe_encrypt_password(text) to service_role;
grant execute on function public.dfe_decrypt_password(bytea) to service_role;

-- RPC segura para o front gravar senha sem ver a chave simétrica
create or replace function public.dfe_salvar_empresa(
  p_cnpj text,
  p_razao text,
  p_cert_path text,
  p_senha_plain text,
  p_ambiente smallint default 1
)
returns public.empresas_config
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.empresas_config;
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;
  if length(v_cnpj) <> 14 then
    raise exception 'CNPJ inválido';
  end if;
  if p_cert_path is null or length(p_cert_path) < 3 then
    raise exception 'Caminho do certificado obrigatório';
  end if;
  if p_senha_plain is null or length(p_senha_plain) < 1 then
    raise exception 'Senha do certificado obrigatória';
  end if;

  insert into public.empresas_config as e (
    user_id, cnpj, razao_social, certificado_path, certificado_senha, ambiente, ativo
  ) values (
    v_uid,
    v_cnpj,
    coalesce(p_razao, ''),
    p_cert_path,
    public.dfe_encrypt_password(p_senha_plain),
    coalesce(p_ambiente, 1),
    true
  )
  on conflict (cnpj) do update set
    user_id = excluded.user_id,
    razao_social = excluded.razao_social,
    certificado_path = excluded.certificado_path,
    certificado_senha = excluded.certificado_senha,
    ambiente = excluded.ambiente,
    ativo = true,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.dfe_salvar_empresa(text, text, text, text, smallint) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.empresas_config enable row level security;
alter table public.nfe_entrada enable row level security;

drop policy if exists empresas_config_owner_select on public.empresas_config;
create policy empresas_config_owner_select on public.empresas_config
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists empresas_config_owner_insert on public.empresas_config;
create policy empresas_config_owner_insert on public.empresas_config
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists empresas_config_owner_update on public.empresas_config;
create policy empresas_config_owner_update on public.empresas_config
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists empresas_config_owner_delete on public.empresas_config;
create policy empresas_config_owner_delete on public.empresas_config
  for delete to authenticated
  using (user_id = auth.uid());

-- service_role ignora RLS (Edge Functions)

drop policy if exists nfe_entrada_owner_select on public.nfe_entrada;
create policy nfe_entrada_owner_select on public.nfe_entrada
  for select to authenticated
  using (
    exists (
      select 1 from public.empresas_config e
      where e.id = nfe_entrada.empresa_id and e.user_id = auth.uid()
    )
  );

drop policy if exists nfe_entrada_owner_update on public.nfe_entrada;
create policy nfe_entrada_owner_update on public.nfe_entrada
  for update to authenticated
  using (
    exists (
      select 1 from public.empresas_config e
      where e.id = nfe_entrada.empresa_id and e.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.empresas_config e
      where e.id = nfe_entrada.empresa_id and e.user_id = auth.uid()
    )
  );

-- inserts de nfe_entrada só via service_role (Edge Function)

-- -----------------------------------------------------------------------------
-- 6. Storage bucket privado para A1
--    (também pode criar pelo Dashboard → Storage)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'certificados-a1',
  'certificados-a1',
  false,
  5242880, -- 5 MB
  array['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream']
)
on conflict (id) do nothing;

drop policy if exists cert_a1_owner_upload on storage.objects;
create policy cert_a1_owner_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'certificados-a1'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists cert_a1_owner_select on storage.objects;
create policy cert_a1_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'certificados-a1'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists cert_a1_owner_update on storage.objects;
create policy cert_a1_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'certificados-a1'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists cert_a1_owner_delete on storage.objects;
create policy cert_a1_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'certificados-a1'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 7. Cron a cada 10 minutos → Edge Function dfe-dist
--    Substitua PROJECT_REF e SERVICE_ROLE_KEY antes de agendar.
--    Secrets: Dashboard → Edge Functions → Secrets
--      DFE_CRON_SECRET = string aleatória longa
-- -----------------------------------------------------------------------------
-- Exemplo com pg_net (Supabase):
/*
select cron.unschedule('nkway-dfe-dist-10min') where exists (
  select 1 from cron.job where jobname = 'nkway-dfe-dist-10min'
);

select cron.schedule(
  'nkway-dfe-dist-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/dfe-dist',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'x-dfe-cron-secret', current_setting('app.settings.dfe_cron_secret', true)
    ),
    body := jsonb_build_object('origem', 'pg_cron')
  );
  $$
);
*/

-- Alternativa sem pg_net: agende no Dashboard → Edge Functions → Schedules
-- ou use um cron externo (GitHub Actions) batendo no mesmo endpoint a cada 10 min.

-- -----------------------------------------------------------------------------
-- 8. View auxiliar para o dashboard (sem xml_bruto pesado na listagem)
-- -----------------------------------------------------------------------------
create or replace view public.v_nfe_entrada_lista
with (security_invoker = true)
as
select
  n.id,
  n.empresa_id,
  n.cnpj_destinatario,
  n.chave_acesso,
  n.nsu,
  n.schema_tipo,
  n.emitente_cnpj,
  n.emitente_nome,
  n.valor_total,
  n.data_emissao,
  n.status_manifesto,
  n.importado_erp,
  n.created_at,
  (n.xml_bruto is not null and length(n.xml_bruto) > 0) as tem_xml
from public.nfe_entrada n;

grant select on public.v_nfe_entrada_lista to authenticated;
