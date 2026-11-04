/**
 * NKWAY — Tipos e utilitários puros para Migração Planejada do Legado → `nk_*`.
 * Regra de ouro: as tabelas legadas sem prefixo NUNCA são alteradas ou apagadas (somente leitura).
 */

export const TABELAS_LEGADAS_CONHECIDAS = [
  "empresas",
  "usuarios",
  "config_fiscal",
  "produtos",
  "clientes",
  "vendas",
  "lancamentos",
  "erp_estados",
  "empresas_config",
  "nfe_entrada",
] as const;

export type TabelaLegadaNome = (typeof TABELAS_LEGADAS_CONHECIDAS)[number];

export const MODULOS_MIGRACAO = [
  { id: "fiscal", rotulo: "Configuração fiscal", destino: "nk_empresa.fiscal", descricao: "Séries, CRT, ambiente e CSC mascarado" },
  { id: "produtos", rotulo: "Produtos e estoque inicial", destino: "nk_produto + nk_movimento", descricao: "Catálogo deduplicado por GTIN/SKU/nome com kardex inicial" },
  { id: "clientes", rotulo: "Clientes", destino: "nk_cliente", descricao: "Deduplicados por CPF/CNPJ válido ou nome" },
  { id: "fornecedores", rotulo: "Fornecedores", destino: "nk_fornecedor", descricao: "Fornecedores com CNPJ válido vindos do snapshot legado" },
  { id: "entradas", rotulo: "Entradas de mercadoria", destino: "nk_entrada", descricao: "Notas de compra do snapshot legado vinculadas aos produtos" },
  { id: "vendas", rotulo: "Vendas fiscais e DAVs", destino: "nk_venda + nk_venda_item", descricao: "Histórico de documentos e itens preservando chaves válidas" },
  { id: "financeiro", rotulo: "Contas a pagar e receber", destino: "nk_conta", descricao: "Lançamentos financeiros legados com status aberto/pago" },
  { id: "dfe", rotulo: "NF-e recebidas (DF-e)", destino: "nk_empresa.fiscal.dfeDocumentos", descricao: "XMLs brutos da tabela legada nfe_entrada para o painel /dfe" },
  { id: "eventos", rotulo: "MDF-e e Inutilizações", destino: "nk_mdfe + nk_inutilizacao", descricao: "Manifestos e faixas inutilizadas do snapshot legado" },
] as const;

export type ModuloMigracaoId = (typeof MODULOS_MIGRACAO)[number]["id"];

export type ResumoModuloMigracao = {
  modulo: ModuloMigracaoId;
  rotulo: string;
  destino: string;
  encontrados: number;
  novos: number;
  ignoradosExistentes: number;
  saneados: number;
  avisos: string[];
};

export type StatusTabelaLegada = {
  tabela: TabelaLegadaNome;
  existe: boolean;
  acessivel: boolean;
  erroPermissao: boolean;
};

export type InspecaoBancoLegadoDto = {
  tabelasPresentes: number;
  tabelasAcessiveis: number;
  faltaPermissaoLeitura: boolean;
  tabelas: StatusTabelaLegada[];
  empresaLegadaEncontrada: {
    id: string;
    nome: string;
    cnpj: string;
    possuiSnapshotJson: boolean;
    versaoSnapshot: number;
    atualizadoEm: string;
  } | null;
  dfeLegadoEncontradas: number;
  ultimaMigracaoEm: string | null;
  ultimaMigracaoResumo: string | null;
};

export type PlanoMigracaoLegadoDto = {
  fonte: "banco" | "json";
  empresaOrigemNome: string;
  empresaOrigemCnpj: string;
  geradoEm: string;
  modulos: ResumoModuloMigracao[];
  totalEncontrados: number;
  totalNovos: number;
  totalIgnorados: number;
  totalAvisos: number;
};

export type ResultadoExecucaoMigracaoDto = {
  fonte: "banco" | "json";
  executadoEm: string;
  importadosPorModulo: Record<ModuloMigracaoId, number>;
  totalImportados: number;
  totalIgnorados: number;
  avisos: string[];
};

export function normalizarNomeComparacao(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function ehUuidValido(s: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? "").trim());
}

/**
 * Gera SQL opcional e 100% somente-leitura (GRANT SELECT) caso o administrador queira
 * permitir que `nkway_app` leia as tabelas legadas antigas no Supabase SQL Editor.
 * Nunca apaga, altera dados nem desativa tabelas legadas.
 */
export function gerarSqlPermissaoLeituraLegado(): string {
  return [
    "-- Permissão SOMENTE LEITURA nas tabelas legadas para o assistente de migração NKWAY",
    "-- Não altera, não apaga e não modifica nenhuma tabela legada.",
    "do $$",
    "declare t text;",
    "begin",
    "  foreach t in array array['empresas','usuarios','config_fiscal','produtos','clientes','vendas','lancamentos','erp_estados','empresas_config','nfe_entrada']",
    "  loop",
    "    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then",
    "      execute format('grant select on table public.%I to nkway_app', t);",
    "    end if;",
    "  end loop;",
    "end $$;",
  ].join("\n");
}

/**
 * Script SQL único consolidado e idempotente (IF NOT EXISTS) com todas as novas tabelas
 * e colunas aditivas das Fases 1, 2, 3, Assinatura CNPJ e Emissor SEFAZ 4.00.
 */
export function gerarSqlConsolidadoSupabaseNk(): string {
  return [
    "-- =============================================================================",
    "-- NKWAY · SCRIPT CONSOLIDADO ÚNICO PARA O SUPABASE (NOVAS TABELAS E COLUNAS nk_*)",
    "-- Idempotente (IF NOT EXISTS): seguro para rodar no SQL Editor do Supabase.",
    "-- Preserva 100% dos dados existentes e não altera tabelas legadas sem prefixo.",
    "-- =============================================================================",
    "",
    "-- 1. Fase 1: Usuários e Trilha de Auditoria (nk_auditoria)",
    "alter table public.nk_usuario",
    "  add column if not exists ativo boolean not null default true,",
    "  add column if not exists atualizado_em timestamptz default now();",
    "create index if not exists nk_usuario_empresa_idx on public.nk_usuario (empresa_id);",
    "",
    "create table if not exists public.nk_auditoria (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  usuario_id uuid,",
    "  usuario_nome text not null default '',",
    "  usuario_papel text not null default '',",
    "  acao text not null,",
    "  entidade text not null,",
    "  registro_id text not null default '',",
    "  resumo text not null default '',",
    "  alteracoes jsonb default '{}'::jsonb,",
    "  created_at timestamptz default now()",
    ");",
    "create index if not exists nk_auditoria_empresa_data_idx on public.nk_auditoria (empresa_id, created_at);",
    "create index if not exists nk_auditoria_empresa_acao_idx on public.nk_auditoria (empresa_id, acao);",
    "",
    "-- 2. Fase 2: Fechamento de Caixa por Operador (nk_caixa_sessao e nk_caixa_movimento)",
    "alter table public.nk_venda",
    "  add column if not exists operador_id uuid,",
    "  add column if not exists caixa_sessao_id uuid,",
    "  add column if not exists status_comercial text;",
    "create index if not exists nk_venda_caixa_sessao_idx on public.nk_venda (caixa_sessao_id);",
    "",
    "create table if not exists public.nk_caixa_sessao (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  numero integer not null,",
    "  terminal text not null default 'CAIXA 1',",
    "  operador_id uuid not null references public.nk_usuario (id),",
    "  operador_nome text not null,",
    "  status text not null default 'aberto',",
    "  saldo_inicial numeric(12, 2) not null default 0,",
    "  valores_esperados jsonb default '{}'::jsonb,",
    "  valores_informados jsonb default '{}'::jsonb,",
    "  diferencas jsonb default '{}'::jsonb,",
    "  total_esperado numeric(12, 2) not null default 0,",
    "  total_informado numeric(12, 2) not null default 0,",
    "  diferenca_total numeric(12, 2) not null default 0,",
    "  observacao_abertura text default '',",
    "  justificativa_fechamento text default '',",
    "  aberto_em timestamptz default now(),",
    "  fechado_em timestamptz,",
    "  fechado_por_id uuid,",
    "  fechado_por_nome text default '',",
    "  reaberto_em timestamptz,",
    "  reaberto_por_nome text default '',",
    "  justificativa_reabertura text default ''",
    ");",
    "create index if not exists nk_caixa_sessao_empresa_idx on public.nk_caixa_sessao (empresa_id, aberto_em);",
    "create index if not exists nk_caixa_sessao_operador_idx on public.nk_caixa_sessao (empresa_id, operador_id, status);",
    "create unique index if not exists nk_caixa_sessao_operador_aberto_uidx",
    "  on public.nk_caixa_sessao (empresa_id, operador_id) where status = 'aberto';",
    "",
    "create table if not exists public.nk_caixa_movimento (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  sessao_id uuid not null references public.nk_caixa_sessao (id) on delete cascade,",
    "  tipo text not null,",
    "  forma text not null default 'dinheiro',",
    "  valor numeric(12, 2) not null default 0,",
    "  motivo text not null default '',",
    "  venda_id uuid,",
    "  usuario_id uuid,",
    "  usuario_nome text not null default '',",
    "  created_at timestamptz default now()",
    ");",
    "create index if not exists nk_caixa_mov_sessao_idx on public.nk_caixa_movimento (sessao_id);",
    "create index if not exists nk_caixa_mov_empresa_idx on public.nk_caixa_movimento (empresa_id);",
    "",
    "-- 2b. Etapa 1 (2026): quebra de caixa, homologação e fundo de troco (aditivo)",
    "alter table public.nk_caixa_sessao",
    "  add column if not exists status_aprovacao text,",
    "  add column if not exists homologado_por_usuario_id uuid,",
    "  add column if not exists fundo_troco numeric(12, 2);",
    "create table if not exists public.nk_caixa_quebra_log (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  sessao_id uuid not null references public.nk_caixa_sessao (id) on delete cascade,",
    "  usuario_id uuid references public.nk_usuario (id),",
    "  valor_diferenca numeric(12, 2) not null default 0,",
    "  tipo text not null default 'FALTA',",
    "  justificativa text not null default '',",
    "  homologado_por_usuario_id uuid,",
    "  homologado_em timestamptz,",
    "  created_at timestamptz default now()",
    ");",
    "create index if not exists nk_caixa_quebra_sessao_idx on public.nk_caixa_quebra_log (sessao_id);",
    "create index if not exists nk_caixa_quebra_empresa_idx on public.nk_caixa_quebra_log (empresa_id, created_at);",
    "",
    "-- 3. Fase 3 e Emissor SEFAZ 4.00: Colunas xml_fiscal e status_sefaz em nk_venda",
    "alter table public.nk_venda",
    "  add column if not exists xml_fiscal text,",
    "  add column if not exists status_sefaz text default 'simulado',",
    "  add column if not exists cstat_sefaz text default '100',",
    "  add column if not exists motivo_sefaz text default '',",
    "  add column if not exists emissor_provedor text default 'local';",
    "create index if not exists nk_venda_status_sefaz_idx on public.nk_venda (empresa_id, status_sefaz);",
    "",
    "-- 4. Assinatura com Gateway e Recorrência por CNPJ (nk_assinatura e nk_assinatura_fatura)",
    "create table if not exists public.nk_assinatura (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  cnpj text not null,",
    "  razao_social text not null default '',",
    "  email_cobranca text not null default '',",
    "  plano_id text not null,",
    "  ciclo text not null default 'mensal',",
    "  forma_pagamento text not null default 'pix',",
    "  valor_ciclo numeric(12, 2) not null default 0,",
    "  status text not null default 'aguardando_pagamento',",
    "  gateway text not null default 'sandbox',",
    "  gateway_customer_id text default '',",
    "  gateway_subscription_id text default '',",
    "  cartao_bandeira text default '',",
    "  cartao_ultimos4 text default '',",
    "  proximo_vencimento date not null,",
    "  cancelar_ao_fim_do_ciclo boolean not null default false,",
    "  cancelada_em timestamptz,",
    "  motivo_cancelamento text default '',",
    "  created_at timestamptz default now(),",
    "  atualizado_em timestamptz default now()",
    ");",
    "create index if not exists nk_assinatura_empresa_idx on public.nk_assinatura (empresa_id);",
    "create index if not exists nk_assinatura_cnpj_idx on public.nk_assinatura (cnpj);",
    "create index if not exists nk_assinatura_gateway_sub_idx on public.nk_assinatura (gateway_subscription_id);",
    "",
    "create table if not exists public.nk_assinatura_fatura (",
    "  id uuid primary key default gen_random_uuid(),",
    "  empresa_id uuid not null references public.nk_empresa (id) on delete cascade,",
    "  assinatura_id uuid not null references public.nk_assinatura (id) on delete cascade,",
    "  numero integer not null,",
    "  cnpj text not null,",
    "  plano_id text not null,",
    "  ciclo text not null default 'mensal',",
    "  competencia text not null default '',",
    "  valor numeric(12, 2) not null default 0,",
    "  forma_pagamento text not null default 'pix',",
    "  status text not null default 'pendente',",
    "  vencimento date not null,",
    "  pago_em timestamptz,",
    "  gateway text not null default 'sandbox',",
    "  gateway_payment_id text default '',",
    "  checkout_url text default '',",
    "  pix_payload text default '',",
    "  linha_digitavel text default '',",
    "  nsu_autorizacao text default '',",
    "  created_at timestamptz default now()",
    ");",
    "create index if not exists nk_ass_fatura_empresa_idx on public.nk_assinatura_fatura (empresa_id, created_at);",
    "create index if not exists nk_ass_fatura_ass_idx on public.nk_assinatura_fatura (assinatura_id);",
    "create index if not exists nk_ass_fatura_gw_pay_idx on public.nk_assinatura_fatura (gateway_payment_id);",
    "",
    "-- 5. Permissões para o usuário dedicado nkway_app",
    "do $$",
    "begin",
    "  if exists (select 1 from pg_roles where rolname = 'nkway_app') then",
    "    execute 'grant select, insert, update, delete on table public.nk_auditoria, public.nk_caixa_sessao, public.nk_caixa_movimento, public.nk_caixa_quebra_log, public.nk_assinatura, public.nk_assinatura_fatura to nkway_app';",
    "  end if;",
    "exception when others then",
    "  null;",
    "end $$;",
  ].join("\n");
}
