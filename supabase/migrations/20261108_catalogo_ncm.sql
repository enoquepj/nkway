-- NKWAY — Etapa 1: cache NCM oficial por empresa.
-- Revisar backup/permissões antes do deploy. Não executado no Supabase nesta entrega.
-- Somente aditivo e idempotente; sem RLS, sem tabelas legadas e sem UPDATE em produtos.
-- A aplicação usa uma concessão temporária (lease_id/lease_ate) e substituição atômica.
-- Rollback lógico: reverter o código desta etapa e MANTER esta tabela e a auditoria.
-- Não é necessário DROP. Qualquer remoção futura exige exportação e revisão próprias.
create table if not exists nk_catalogo_ncm (
  empresa_id uuid primary key references nk_empresa(id) on delete cascade,
  registros jsonb,
  hash text,
  referencia date,
  referencia_fonte text,
  ato text,
  total_registros integer not null default 0,
  total_codigos integer not null default 0,
  coletado_em timestamptz,
  tentativa_em timestamptz,
  falha_em timestamptz,
  erro text,
  lease_id uuid,
  lease_ate timestamptz,
  repetir_apos timestamptz
);
