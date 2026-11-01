-- =============================================================================
-- NKWAY · Fase 3 — Exportação de XML em Documentos de Venda
-- Coluna aditiva xml_fiscal em nk_venda (NULL quando não há XML fiscal armazenado)
-- =============================================================================

alter table public.nk_venda
  add column if not exists xml_fiscal text;
