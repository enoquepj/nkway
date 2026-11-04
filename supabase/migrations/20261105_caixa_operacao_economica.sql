-- =============================================================================
-- NKWAY · Motor de apuração/fechamento de caixa — migração aditiva mínima
-- =============================================================================
-- Objetivo: permitir que o esquema distinga DAV de ORÇAMENTO (pré-venda) de
-- DAV COMERCIAL CONCRETO sem inventar concretização para registros antigos.
--
-- Regras de segurança:
--   * ADITIVA e idempotente (IF NOT EXISTS).
--   * Coluna ANULÁVEL e SEM DEFAULT: todo registro legado permanece NULL.
--   * Nenhum UPDATE, nenhuma conversão automática de DAV, nenhum DELETE.
--   * Não toca em tabelas legadas sem prefixo, RLS, DATABASE_URL ou infra.
--   * Valores aceitos pela aplicação: 'orcamento' | 'concretizado'.
--     A decisão final (compoeCaixa) continua em src/lib/caixa.ts (com apoio de src/server/caixaCore.ts) e exige
--     também caixaSessaoId, pagamentos válidos e, quando apurável, kardex.
--
-- A auto-aplicação idempotente em produção é feita por src/db/migracao.ts.
-- =============================================================================

alter table public.nk_venda
  add column if not exists status_comercial text;

comment on column public.nk_venda.status_comercial is
  'Confirmação comercial explícita do caixa: orcamento | concretizado. NULL = legado preservado (sem conversão automática).';
