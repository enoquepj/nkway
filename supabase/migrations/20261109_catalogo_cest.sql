-- NKWAY · Etapa 2 (CEST): referência LOCAL por empresa da relação CEST ↔ NCM.
-- Aditiva e idempotente: cria apenas nk_catalogo_cest. Não altera nk_produto, notas,
-- parâmetros fiscais, tabelas legadas, RLS, usuário ou conexão.
-- O CONFAZ publica o CEST apenas em anexos PDF (Conv. ICMS 92/2015 e atualizações);
-- nenhuma fonte estruturada de terceiro foi adotada nesta etapa. A tabela guarda
-- proveniência declarada por registro e nunca é aplicada automaticamente a produtos.
create table if not exists nk_catalogo_cest (
  empresa_id uuid primary key references nk_empresa(id) on delete cascade,
  registros jsonb,
  hash text,
  fonte text,
  total_registros integer not null default 0,
  atualizado_em timestamptz
);
