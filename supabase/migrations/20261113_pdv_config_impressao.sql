-- NKWAY · Etapa 1 PDV/impressão: configuração do cupom por empresa.
-- Aditiva e idempotente: cria apenas nk_pdv_config. Não altera vendas, produtos,
-- caixa, documentos, parâmetros fiscais, tabelas legadas, RLS, usuário ou conexão.
create table if not exists nk_pdv_config (
  empresa_id uuid primary key references nk_empresa(id) on delete cascade,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
