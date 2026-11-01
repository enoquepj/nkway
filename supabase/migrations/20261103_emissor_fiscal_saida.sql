-- =============================================================================
-- NKWAY · Emissor Fiscal de Saída Homologado, Pré-Validador SEFAZ e Contingência
-- Migração aditiva e idempotente (preserva 100% dos dados existentes e tabelas legadas)
-- =============================================================================

alter table public.nk_venda
  add column if not exists status_sefaz text default 'simulado',
  add column if not exists cstat_sefaz text default '100',
  add column if not exists motivo_sefaz text default '',
  add column if not exists emissor_provedor text default 'local';

create index if not exists nk_venda_status_sefaz_idx on public.nk_venda (empresa_id, status_sefaz);
