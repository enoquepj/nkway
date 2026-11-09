-- NKWAY · Tabelas de domínio oficiais para a parametrização fiscal (CFOP, CSTs, CSOSN,
-- origem, cClassTrib, cCredPres, cBenef por UF, alíquotas padrão IBS/CBS).
-- Aditivo e idempotente: cria apenas nk_tabela_dominio e nk_tabela_dominio_meta.
-- São dados públicos de referência (não de tenant), semeados por scripts/inserir-tabelas-fiscais.mjs
-- a partir das fontes oficiais (Portal NF-e/SVRS, Receita Federal, CONFAZ). Não altera nk_produto,
-- notas, parâmetros fiscais por empresa, tabelas legadas, RLS, usuário ou conexão.
create table if not exists nk_tabela_dominio (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  codigo text not null,
  descricao text not null default '',
  uf text not null default '',
  vig_ini date,
  vig_fim date,
  fonte text not null default '',
  versao text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists nk_tabela_dominio_tipo_codigo_uf_uidx on nk_tabela_dominio(tipo, codigo, uf);
create index if not exists nk_tabela_dominio_tipo_idx on nk_tabela_dominio(tipo);

create table if not exists nk_tabela_dominio_meta (
  tipo text primary key,
  fonte text not null default '',
  referencia text not null default '',
  url text not null default '',
  versao text not null default '',
  total integer not null default 0,
  atualizado_em timestamptz not null default now()
);
