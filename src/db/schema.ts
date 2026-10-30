import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Plano comercial — freemium com trial de 14 dias */
export const PLANOS = ["start", "me", "loja_mais"] as const;
export type PlanoId = (typeof PLANOS)[number];

export const empresas = pgTable("nk_empresa", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  nomeFantasia: text("nome_fantasia"),
  cnpj: text("cnpj").notNull(),
  uf: text("uf").notNull().default("RO"),
  municipio: text("municipio").default(""),
  codMunicipio: text("cod_municipio").default(""),
  ie: text("ie").default(""),
  regime: text("regime").notNull().default("mei"),
  porte: text("porte").notNull().default("MEI"),
  telefone: text("telefone").default(""),
  email: text("email").default(""),
  endereco: text("endereco").default(""),
  numero: text("numero").default(""),
  bairro: text("bairro").default(""),
  cep: text("cep").default(""),
  plano: text("plano").notNull().default("mei"),
  trialUntil: timestamp("trial_until", { withTimezone: true }),
  assinaturaPagoEm: date("assinatura_pago_em"),
  /** Configuração fiscal completa (série, ambiente, CSC, certificado) */
  fiscal: jsonb("fiscal").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const usuarios = pgTable(
  "nk_usuario",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    email: text("email").notNull(),
    senhaHash: text("senha_hash").notNull(),
    papel: text("papel").notNull().default("operador"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("nk_usuario_email_idx").on(t.email)],
);

export const produtos = pgTable(
  "nk_produto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    sku: text("sku").notNull().default(""),
    gtin: text("gtin").notNull().default("SEM GTIN"),
    categoria: text("categoria").notNull().default("Geral"),
    marca: text("marca").notNull().default(""),
    unidade: text("unidade").notNull().default("UN"),
    custo: numeric("custo", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    preco: numeric("preco", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    estoque: numeric("estoque", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    estoqueMin: numeric("estoque_min", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    pesavel: boolean("pesavel").notNull().default(false),
    ativo: boolean("ativo").notNull().default(true),
    ncm: text("ncm").notNull().default("00000000"),
    cest: text("cest").notNull().default(""),
    cfop: text("cfop").notNull().default("5102"),
    csosn: text("csosn").notNull().default("102"),
    icmsAliq: numeric("icms_aliq", { precision: 6, scale: 2, mode: "number" }).notNull().default(0),
    pisAliq: numeric("pis_aliq", { precision: 6, scale: 2, mode: "number" }).notNull().default(0),
    cofinsAliq: numeric("cofins_aliq", { precision: 6, scale: 2, mode: "number" }).notNull().default(0),
    ibsAliq: numeric("ibs_aliq", { precision: 6, scale: 2, mode: "number" }).notNull().default(0.1),
    cbsAliq: numeric("cbs_aliq", { precision: 6, scale: 2, mode: "number" }).notNull().default(0.9),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("nk_produto_empresa_idx").on(t.empresaId),
    index("nk_produto_sku_idx").on(t.sku),
    index("nk_produto_gtin_idx").on(t.gtin),
  ],
);

export const clientes = pgTable(
  "nk_cliente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    documento: text("documento").notNull().default(""),
    email: text("email").default(""),
    telefone: text("telefone").default(""),
    cidade: text("cidade").default(""),
    uf: text("uf").default(""),
    cep: text("cep").default(""),
    logradouro: text("logradouro").default(""),
    numero: text("numero").default(""),
    bairro: text("bairro").default(""),
    indIe: text("ind_ie").default("9"),
    limiteCredito: numeric("limite_credito", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    condicaoPadrao: text("condicao_padrao").notNull().default("a vista"),
    observacao: text("observacao"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("nk_cliente_empresa_idx").on(t.empresaId)],
);

export const fornecedores = pgTable(
  "nk_fornecedor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    nome: text("nome").notNull(),
    cnpj: text("cnpj").notNull().default(""),
    cidade: text("cidade").default(""),
    uf: text("uf").default(""),
    telefone: text("telefone").default(""),
    email: text("email").default(""),
    prazoPagDias: integer("prazo_pag_dias").notNull().default(30),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("nk_fornecedor_empresa_idx").on(t.empresaId)],
);

export const vendas = pgTable(
  "nk_venda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    numero: integer("numero").notNull(),
    clienteId: uuid("cliente_id"),
    clienteNome: text("cliente_nome").notNull().default("CONSUMIDOR"),
    subtotal: numeric("subtotal", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    desconto: numeric("desconto", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    vFrete: numeric("v_frete", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    /** forma de pagamento principal (de maior valor quando dividido) */
    formaPagamento: text("forma_pagamento").notNull().default("dinheiro"),
    /** [{ forma, valor, recebido }] — divisão de pagamento do PDV */
    pagamentos: jsonb("pagamentos").$type<{ forma: string; valor: number }[]>().default([]),
    tipo: text("tipo").notNull().default("fiscal"),
    status: text("status").notNull().default("faturado"),
    modelo: text("modelo"),
    serie: text("serie"),
    numeroNota: integer("numero_nota"),
    chave: text("chave"),
    protocolo: text("protocolo"),
    autorizadaEm: bigint("autorizada_em", { mode: "number" }),
    validade: date("validade"),
    observacao: text("observacao"),
    operador: text("operador").default("Frente de caixa"),
    /** DAV que originou esta nota */
    davOrigemId: uuid("dav_origem_id"),
    data: timestamp("data", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("nk_venda_empresa_idx").on(t.empresaId), index("nk_venda_data_idx").on(t.data)],
);

export const vendaItens = pgTable(
  "nk_venda_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendaId: uuid("venda_id")
      .notNull()
      .references(() => vendas.id, { onDelete: "cascade" }),
    produtoId: uuid("produto_id"),
    nome: text("nome").notNull(),
    qtd: numeric("qtd", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    precoUnit: numeric("preco_unit", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    unidade: text("unidade").default("UN"),
    gtin: text("gtin"),
  },
  (t) => [index("nk_venda_item_venda_idx").on(t.vendaId)],
);

/** Kardex — todo movimento de estoque com saldo após (trilha auditável) */
export const movimentos = pgTable(
  "nk_movimento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    produtoId: uuid("produto_id").notNull(),
    produtoNome: text("produto_nome").notNull(),
    /** entrada | venda | ajuste | perda | devolucao | inventario */
    tipo: text("tipo").notNull(),
    qtd: numeric("qtd", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    saldoApos: numeric("saldo_apos", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    custoUnit: numeric("custo_unit", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    custoMedioApos: numeric("custo_medio_apos", { precision: 12, scale: 4, mode: "number" }).notNull().default(0),
    documento: text("documento").default(""),
    observacao: text("observacao"),
    data: timestamp("data", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("nk_movimento_empresa_idx").on(t.empresaId),
    index("nk_movimento_produto_idx").on(t.produtoId),
  ],
);

/** Entrada de mercadoria — XML de NF-e, chave SEFAZ ou digitação manual */
export const entradas = pgTable(
  "nk_entrada",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    numeroNota: text("numero_nota").notNull().default("0"),
    serie: text("serie").notNull().default("1"),
    chave: text("chave").notNull().default(""),
    fornecedor: text("fornecedor").notNull().default(""),
    cnpjFornecedor: text("cnpj_fornecedor").notNull().default(""),
    fornecedorId: uuid("fornecedor_id"),
    emissao: date("emissao").notNull(),
    valorProdutos: numeric("valor_produtos", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    valorFrete: numeric("valor_frete", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    total: numeric("total", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    /** pendente → conferida → lancada */
    status: text("status").notNull().default("pendente"),
    origem: text("origem").notNull().default("manual"),
    gerarFinanceiro: boolean("gerar_financeiro").notNull().default(true),
    /** itens vindos do XML/manual antes do vínculo com o cadastro interno */
    itens: jsonb("itens").$type<EntradaItem[]>().default([]),
    observacao: text("observacao"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lancadaEm: timestamp("lancada_em", { withTimezone: true }),
  },
  (t) => [index("nk_entrada_empresa_idx").on(t.empresaId), index("nk_entrada_status_idx").on(t.status)],
);

/** Financeiro — contas a pagar e receber, baixa de títulos */
export const contas = pgTable(
  "nk_conta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    tipo: text("tipo").notNull().default("receber"),
    descricao: text("descricao").notNull(),
    categoria: text("categoria").notNull().default("Vendas"),
    contraparteNome: text("contraparte_nome").default(""),
    valor: numeric("valor", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    valorPago: numeric("valor_pago", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    vencimento: date("vencimento").notNull(),
    pagoEm: date("pago_em"),
    status: text("status").notNull().default("aberta"),
    forma: text("forma"),
    /** vínculo com documento emitido / entrada lançada */
    vendaId: uuid("venda_id"),
    entradaId: uuid("entrada_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("nk_conta_empresa_idx").on(t.empresaId), index("nk_conta_venc_idx").on(t.vencimento)],
);

/** MDF-e — manifesto de transporte de documentos fiscais */
export const mdfes = pgTable(
  "nk_mdfe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull().references(() => empresas.id, { onDelete: "cascade" }),
    numero: integer("numero").notNull(),
    serie: text("serie").notNull().default("1"),
    chave: text("chave").notNull().default(""),
    protocolo: text("protocolo").default(""),
    ufInicio: text("uf_inicio").notNull(),
    ufFim: text("uf_fim").notNull(),
    municipioCarregamento: text("municipio_carregamento").default(""),
    municipioDescarregamento: text("municipio_descarregamento").default(""),
    placa: text("placa").notNull(),
    rntrc: text("rntrc").default(""),
    condutor: text("condutor").default(""),
    cpfCondutor: text("cpf_condutor").default(""),
    documentos: jsonb("documentos").$type<{ chave: string; tipo: string; valor: number }[]>().default([]),
    pesoBruto: numeric("peso_bruto", { precision: 12, scale: 3, mode: "number" }).notNull().default(0),
    valorCarga: numeric("valor_carga", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    status: text("status").notNull().default("autorizado"),
    emitidoEm: timestamp("emitido_em", { withTimezone: true }).defaultNow(),
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
  },
  (t) => [index("nk_mdfe_empresa_idx").on(t.empresaId)],
);

export type EntradaItem = {
  /** produto interno vinculado (null = novo, criado ao lançar) */
  produtoId: string | null;
  nome: string;
  nomeFornecedor?: string;
  sku: string;
  ncm: string;
  cfop: string;
  unidade: string;
  gtin?: string;
  qtd: number;
  qtdNota: number;
  custo: number;
  preco: number;
};

export type EmpresaRow = typeof empresas.$inferSelect;
export type ProdutoRow = typeof produtos.$inferSelect;
export type ClienteRow = typeof clientes.$inferSelect;
export type FornecedorRow = typeof fornecedores.$inferSelect;
export type VendaRow = typeof vendas.$inferSelect;
export type VendaItemRow = typeof vendaItens.$inferSelect;
export type MovimentoRow = typeof movimentos.$inferSelect;
export type EntradaRow = typeof entradas.$inferSelect;
export type ContaRow = typeof contas.$inferSelect;
export type MdfeRow = typeof mdfes.$inferSelect;
