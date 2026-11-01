/**
 * NKWAY — Motor Server-Side de Migração Planejada e Idempotente do Legado → `nk_*`.
 *
 * Garantias arquiteturais:
 * 1. SOMENTE LEITURA nas tabelas legadas sem prefixo (jamais executa UPDATE/DELETE/DROP/ALTER nelas).
 * 2. Isolamento multi-tenant: no banco, só lê dados da empresa legada cujo CNPJ (14 dígitos)
 *    ou e-mail de administrador coincida com a empresa autenticada atual.
 * 3. Pipeline único para Simulação (Dry-Run) e Execução Real, garantindo idempotência (2ª execução = 0 duplicados).
 * 4. Saneamento fiscal automático compatível com todas as verificações de `src/server/diagnostico.ts`.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditorias,
  clientes,
  contas,
  empresas,
  entradas,
  fornecedores,
  inutilizacoes,
  mdfes,
  movimentos,
  produtos,
  usuarios,
  vendaItens,
  vendas,
  type EntradaItem,
} from "@/db/schema";
import { padNsu, type DfeDocumento } from "@/lib/dfe";
import {
  MODELO_NUMERO,
  UF_NUMERO,
  documentoValido,
  gerarChave,
  hojeISO,
  mascaraDocumento,
  round2,
  soDigitos,
  validarChaveAcesso,
  validarCnpj,
  validarGtin,
} from "@/lib/dominio";
import {
  MODULOS_MIGRACAO,
  TABELAS_LEGADAS_CONHECIDAS,
  ehUuidValido,
  normalizarNomeComparacao,
  type InspecaoBancoLegadoDto,
  type ModuloMigracaoId,
  type PlanoMigracaoLegadoDto,
  type ResultadoExecucaoMigracaoDto,
  type ResumoModuloMigracao,
  type StatusTabelaLegada,
} from "@/lib/migracaoLegado";
import { registrarAuditoria } from "@/server/auditoria";
import { lerDocumentosDfeFiscal, zipDocZip } from "@/server/dfeCore";

/* ------------------------------------------- UUID determinístico por tenant */

export function uuidDeterministico(empresaId: string, escopo: string, idLegado: string): string {
  const limpo = String(idLegado ?? "").trim();
  if (ehUuidValido(limpo)) return limpo.toLowerCase();
  const hex = createHash("sha256")
    .update(`nkway.legado:${empresaId}:${escopo}:${limpo}`)
    .digest("hex");
  const p1 = hex.slice(0, 8);
  const p2 = hex.slice(8, 12);
  const p3 = `5${hex.slice(13, 16)}`; // versão 5 determinística
  const variante = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const p4 = `${variante}${hex.slice(17, 20)}`;
  const p5 = hex.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`;
}

/* ------------------------------------------- Tipos brutos normalizados */

type ProdutoLegado = {
  id: string;
  nome: string;
  sku: string;
  gtin: string;
  categoria: string;
  marca: string;
  unidade: string;
  custo: number;
  preco: number;
  estoque: number;
  estoqueMin: number;
  pesavel: boolean;
  ncm: string;
  cest: string;
  cfop: string;
  csosn: string;
  icmsAliq: number;
  pisAliq: number;
  cofinsAliq: number;
  ibsAliq: number;
  cbsAliq: number;
};

type ClienteLegado = {
  id: string;
  nome: string;
  documento: string;
  email: string;
  telefone: string;
  cidade: string;
  uf: string;
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  indIe: string;
  limiteCredito: number;
  condicaoPadrao: string;
};

type FornecedorLegado = {
  id: string;
  nome: string;
  cnpj: string;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  prazoPagDias: number;
};

type EntradaLegada = {
  id: string;
  numeroNota: string;
  serie: string;
  chave: string;
  fornecedor: string;
  cnpjFornecedor: string;
  emissao: string;
  total: number;
  status: string;
  origem: string;
  gerarFinanceiro: boolean;
  itens: {
    produtoId: string | null;
    nome: string;
    sku: string;
    ncm: string;
    cfop: string;
    unidade: string;
    gtin: string;
    qtd: number;
    qtdNota: number;
    custo: number;
    preco: number;
  }[];
};

type VendaLegada = {
  id: string;
  numero: number;
  clienteId: string | null;
  clienteNome: string;
  itens: { produtoId: string | null; nome: string; qtd: number; preco: number; unidade: string; gtin: string }[];
  total: number;
  desconto: number;
  vFrete: number;
  pagamento: string;
  pagamentos: { forma: string; valor: number }[];
  tipo: "dav" | "fiscal";
  status: "aberto" | "faturado" | "cancelado";
  validade: string | null;
  observacao: string | null;
  fiscal: {
    modelo: string;
    serie: string;
    numeroNota: number;
    chave: string;
    protocolo: string;
    autorizadaEm: number | null;
  } | null;
  dataIso: string;
};

type LancamentoLegado = {
  id: string;
  descricao: string;
  valor: number;
  tipo: "receber" | "pagar";
  vencimento: string;
  pago: boolean;
  categoria: string;
};

type DfeLegada = {
  id: string;
  chave: string;
  nsu: string;
  schema: string;
  emitenteCnpj: string;
  emitenteNome: string;
  valorTotal: number;
  dataEmissao: string;
  statusManifesto: string;
  xmlBruto: string | null;
  importadoErp: boolean;
};

type MdfeLegado = {
  id: string;
  numero: number;
  serie: string;
  chave: string;
  protocolo: string;
  ufInicio: string;
  ufFim: string;
  municipioCarregamento: string;
  municipioDescarregamento: string;
  placa: string;
  rntrc: string;
  condutor: string;
  cpfCondutor: string;
  documentos: { chave: string; tipo: string; valor: number }[];
  pesoBruto: number;
  valorCarga: number;
  status: string;
  emitidoEmIso: string;
};

type InutilizacaoLegada = {
  id: string;
  modelo: string;
  serie: string;
  inicio: number;
  fim: number;
  justificativa: string;
  protocolo: string;
};

export type PacoteLegadoBruto = {
  empresaOrigemNome: string;
  empresaOrigemCnpj: string;
  configFiscal: Record<string, unknown> | null;
  produtos: ProdutoLegado[];
  clientes: ClienteLegado[];
  fornecedores: FornecedorLegado[];
  entradas: EntradaLegada[];
  vendas: VendaLegada[];
  lancamentos: LancamentoLegado[];
  dfes: DfeLegada[];
  mdfes: MdfeLegado[];
  inutilizacoes: InutilizacaoLegada[];
};

/* ------------------------------------------- Helpers de data e número */

function numSeguro(v: unknown, padrao = 0): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
}

function dataIsoSegura(v: unknown, padrao = hojeISO()): string {
  if (!v) return padrao;
  if (typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? padrao : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? padrao : d.toISOString().slice(0, 10);
}

function timestampIsoSeguro(v: unknown): string {
  if (!v) return new Date().toISOString();
  const d = typeof v === "number" ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/* ------------------------------------------- Inspeção somente-leitura */

export async function inspecionarFontesLegadas(empresaId: string): Promise<InspecaoBancoLegadoDto> {
  const [[emp], admins, ultAuds, existentesRes] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    db
      .select({ email: usuarios.email, papel: usuarios.papel, ativo: usuarios.ativo })
      .from(usuarios)
      .where(eq(usuarios.empresaId, empresaId)),
    db
      .select()
      .from(auditorias)
      .where(and(eq(auditorias.empresaId, empresaId), eq(auditorias.acao, "migracao.executar")))
      .orderBy(desc(auditorias.createdAt))
      .limit(1),
    db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('empresas','usuarios','config_fiscal','produtos','clientes','vendas','lancamentos','erp_estados','empresas_config','nfe_entrada')`,
    ),
  ]);

  const presentesSet = new Set(existentesRes.rows.map((r) => r.table_name));
  const tabelas: StatusTabelaLegada[] = [];

  for (const t of TABELAS_LEGADAS_CONHECIDAS) {
    const existe = presentesSet.has(t);
    if (!existe) {
      tabelas.push({ tabela: t, existe: false, acessivel: false, erroPermissao: false });
      continue;
    }
    try {
      await db.execute(sql.raw(`select 1 from public."${t}" limit 1`));
      tabelas.push({ tabela: t, existe: true, acessivel: true, erroPermissao: false });
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      const perm = code === "42501" || msg.includes("permission denied");
      tabelas.push({ tabela: t, existe: true, acessivel: false, erroPermissao: perm });
    }
  }

  const cnpj14 = soDigitos(emp?.cnpj);
  const emailsAdmin = admins
    .filter((a) => a.ativo !== false)
    .map((a) => a.email.trim().toLowerCase())
    .filter(Boolean);

  let empresaLegadaEncontrada: InspecaoBancoLegadoDto["empresaLegadaEncontrada"] = null;
  const tabEmp = tabelas.find((t) => t.tabela === "empresas");
  const tabUsu = tabelas.find((t) => t.tabela === "usuarios");
  const tabEst = tabelas.find((t) => t.tabela === "erp_estados");

  if (tabEmp?.acessivel) {
    let empLegRow: { id: string; nome: string; cnpj: string | null } | undefined;

    if (cnpj14.length === 14) {
      const rCnpj = await db.execute<{ id: string; nome: string; cnpj: string | null }>(
        sql`select id::text as id, nome, cnpj from public.empresas where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = ${cnpj14} order by criado_em desc nulls last limit 1`,
      );
      empLegRow = rCnpj.rows[0];
    }

    if (!empLegRow && tabUsu?.acessivel && emailsAdmin.length > 0) {
      const rEmail = await db.execute<{ id: string; nome: string; cnpj: string | null }>(
        sql`select e.id::text as id, e.nome, e.cnpj
            from public.empresas e
            join public.usuarios u on u.empresa_id = e.id
            where lower(u.email) in (${sql.join(emailsAdmin.map((em) => sql`${em}`), sql`,`)})
            order by e.criado_em desc nulls last
            limit 1`,
      );
      empLegRow = rEmail.rows[0];
    }

    if (empLegRow) {
      let possuiSnapshotJson = false;
      let versaoSnapshot = 0;
      let atualizadoEm = "";

      if (tabEst?.acessivel) {
        const rEst = await db.execute<{ version: number; updated_at: string | null; tem: boolean }>(
          sql`select coalesce(version, 0)::int as version,
                     updated_at::text as updated_at,
                     (estado is not null and estado <> '{}'::jsonb) as tem
              from public.erp_estados
              where empresa_id = ${empLegRow.id}::uuid
              limit 1`,
        );
        if (rEst.rows[0]) {
          possuiSnapshotJson = Boolean(rEst.rows[0].tem);
          versaoSnapshot = Number(rEst.rows[0].version ?? 0);
          atualizadoEm = rEst.rows[0].updated_at ? new Date(rEst.rows[0].updated_at).toISOString() : "";
        }
      }

      empresaLegadaEncontrada = {
        id: empLegRow.id,
        nome: empLegRow.nome,
        cnpj: empLegRow.cnpj ? mascaraDocumento(empLegRow.cnpj) : emp?.cnpj ?? "",
        possuiSnapshotJson,
        versaoSnapshot,
        atualizadoEm,
      };
    }
  }

  let dfeLegadoEncontradas = 0;
  const tabNfe = tabelas.find((t) => t.tabela === "nfe_entrada");
  if (tabNfe?.acessivel && cnpj14.length === 14) {
    const rNfe = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from public.nfe_entrada where regexp_replace(coalesce(cnpj_destinatario, ''), '\D', '', 'g') = ${cnpj14}`,
    );
    dfeLegadoEncontradas = Number(rNfe.rows[0]?.n ?? 0);
  }

  const ult = ultAuds[0];

  return {
    tabelasPresentes: tabelas.filter((t) => t.existe).length,
    tabelasAcessiveis: tabelas.filter((t) => t.acessivel).length,
    faltaPermissaoLeitura: tabelas.some((t) => t.erroPermissao),
    tabelas,
    empresaLegadaEncontrada,
    dfeLegadoEncontradas,
    ultimaMigracaoEm: ult?.createdAt ? new Date(ult.createdAt).toISOString() : null,
    ultimaMigracaoResumo: ult?.resumo ?? null,
  };
}

/* ----------------------------------- Extração de JSON / Snapshot Legado */

export function extrairPacoteDeObjetoJson(
  bruto: unknown,
  empresaPadrao: { nome: string; cnpj: string },
): PacoteLegadoBruto {
  if (!bruto || typeof bruto !== "object") {
    throw new Error("O conteúdo informado não é um objeto JSON válido do NKWAY.");
  }
  const raiz = bruto as Record<string, unknown>;
  // Aceita tanto `{ estado: { produtos, ... } }` (formato erp_estados) quanto `{ db: { ... } }` ou `{ produtos, ... }` direto
  const estado =
    raiz.estado && typeof raiz.estado === "object"
      ? (raiz.estado as Record<string, unknown>)
      : raiz.db && typeof raiz.db === "object"
        ? (raiz.db as Record<string, unknown>)
        : raiz;

  const chavesReconhecidas = [
    "configFiscal",
    "produtos",
    "clientes",
    "fornecedores",
    "entradas",
    "vendas",
    "lancamentos",
    "mdfes",
    "inutilizacoes",
    "dfes",
  ];
  if (!chavesReconhecidas.some((k) => k in estado)) {
    throw new Error(
      "JSON não reconhecido como backup/snapshot do NKWAY (esperava chaves como produtos, clientes, vendas ou lancamentos).",
    );
  }

  const prodsRaw = Array.isArray(estado.produtos) ? (estado.produtos as Record<string, unknown>[]) : [];
  const clisRaw = Array.isArray(estado.clientes) ? (estado.clientes as Record<string, unknown>[]) : [];
  const fornsRaw = Array.isArray(estado.fornecedores) ? (estado.fornecedores as Record<string, unknown>[]) : [];
  const entsRaw = Array.isArray(estado.entradas) ? (estado.entradas as Record<string, unknown>[]) : [];
  const vdsRaw = Array.isArray(estado.vendas) ? (estado.vendas as Record<string, unknown>[]) : [];
  const lancsRaw = Array.isArray(estado.lancamentos) ? (estado.lancamentos as Record<string, unknown>[]) : [];
  const mdfesRaw = Array.isArray(estado.mdfes) ? (estado.mdfes as Record<string, unknown>[]) : [];
  const inutsRaw = Array.isArray(estado.inutilizacoes) ? (estado.inutilizacoes as Record<string, unknown>[]) : [];
  const dfesRaw = Array.isArray(estado.dfes) ? (estado.dfes as Record<string, unknown>[]) : [];

  const produtosNorm: ProdutoLegado[] = prodsRaw.map((p, idx) => {
    const imp = (p.impostos && typeof p.impostos === "object" ? p.impostos : {}) as Record<string, unknown>;
    return {
      id: String(p.id ?? `prod-${idx + 1}`),
      nome: String(p.nome ?? "").trim(),
      sku: String(p.sku ?? "").trim(),
      gtin: String(p.gtin ?? "SEM GTIN").trim() || "SEM GTIN",
      categoria: String(p.categoria ?? "Geral").trim() || "Geral",
      marca: String(p.marca ?? "").trim(),
      unidade: String(p.unidade ?? "UN").trim().toUpperCase() || "UN",
      custo: numSeguro(p.custo, 0),
      preco: numSeguro(p.preco, 0),
      estoque: numSeguro(p.estoque, 0),
      estoqueMin: numSeguro(p.estoqueMin ?? p.estoque_min, 0),
      pesavel: Boolean(p.pesavel),
      ncm: String(p.ncm ?? imp.ncm ?? "00000000"),
      cest: String(p.cest ?? imp.cest ?? ""),
      cfop: String(p.cfop ?? imp.cfop ?? "5102"),
      csosn: String(p.csosn ?? imp.csosn ?? "102"),
      icmsAliq: numSeguro(p.icmsAliq ?? imp.icmsAliq, 0),
      pisAliq: numSeguro(p.pisAliq ?? imp.pisAliq, 0),
      cofinsAliq: numSeguro(p.cofinsAliq ?? imp.cofinsAliq, 0),
      ibsAliq: numSeguro(p.ibsAliq ?? imp.ibsAliq, 0.1),
      cbsAliq: numSeguro(p.cbsAliq ?? imp.cbsAliq, 0.9),
    };
  });

  const clientesNorm: ClienteLegado[] = clisRaw.map((c, idx) => ({
    id: String(c.id ?? `cli-${idx + 1}`),
    nome: String(c.nome ?? "").trim(),
    documento: String(c.documento ?? "").trim(),
    email: String(c.email ?? "").trim(),
    telefone: String(c.telefone ?? "").trim(),
    cidade: String(c.cidade ?? "").trim(),
    uf: String(c.uf ?? "").trim().toUpperCase(),
    cep: soDigitos(String(c.cep ?? "")).slice(0, 8),
    logradouro: String(c.logradouro ?? "").trim(),
    numero: String(c.numero ?? "").trim(),
    bairro: String(c.bairro ?? "").trim(),
    indIe: String(c.indIe ?? c.ind_ie ?? "9"),
    limiteCredito: numSeguro(c.limiteCredito ?? c.limite_credito, 0),
    condicaoPadrao: String(c.condicaoPadrao ?? c.condicao_padrao ?? "a vista"),
  }));

  const fornecedoresNorm: FornecedorLegado[] = fornsRaw.map((f, idx) => ({
    id: String(f.id ?? `forn-${idx + 1}`),
    nome: String(f.nome ?? "").trim(),
    cnpj: String(f.cnpj ?? "").trim(),
    cidade: String(f.cidade ?? "").trim(),
    uf: String(f.uf ?? "").trim().toUpperCase(),
    telefone: String(f.telefone ?? "").trim(),
    email: String(f.email ?? "").trim(),
    prazoPagDias: Math.max(0, Math.round(numSeguro(f.prazoPagDias ?? f.prazo_pag_dias, 30))),
  }));

  const entradasNorm: EntradaLegada[] = entsRaw.map((e, idx) => {
    const itensArr = Array.isArray(e.itens) ? (e.itens as Record<string, unknown>[]) : [];
    return {
      id: String(e.id ?? `ent-${idx + 1}`),
      numeroNota: String(e.numeroNota ?? e.numero_nota ?? idx + 1),
      serie: String(e.serie ?? "1"),
      chave: soDigitos(String(e.chave ?? "")),
      fornecedor: String(e.fornecedor ?? "FORNECEDOR LEGADO").trim(),
      cnpjFornecedor: soDigitos(String(e.cnpjFornecedor ?? e.cnpj_fornecedor ?? "")),
      emissao: dataIsoSegura(e.emissao),
      total: numSeguro(e.total, 0),
      status: String(e.status ?? "conferida"),
      origem: String(e.origem ?? "manual"),
      gerarFinanceiro: e.gerarFinanceiro !== false,
      itens: itensArr.map((it, iPos) => ({
        produtoId: it.produtoId ? String(it.produtoId) : null,
        nome: String(it.nome ?? `ITEM ${iPos + 1}`).trim(),
        sku: String(it.sku ?? `LEG${idx + 1}${iPos + 1}`).trim(),
        ncm: soDigitos(String(it.ncm ?? "")).padEnd(8, "0").slice(0, 8),
        cfop: soDigitos(String(it.cfop ?? "")).padEnd(4, "5102").slice(0, 4),
        unidade: String(it.unidade ?? "UN").trim().toUpperCase() || "UN",
        gtin: String(it.gtin ?? "SEM GTIN").trim() || "SEM GTIN",
        qtd: Math.max(0.001, numSeguro(it.qtd, 1)),
        qtdNota: Math.max(0.001, numSeguro(it.qtdNota ?? it.qtd, 1)),
        custo: Math.max(0, numSeguro(it.custo, 0)),
        preco: Math.max(0, numSeguro(it.preco, 0)),
      })),
    };
  });

  const vendasNorm: VendaLegada[] = vdsRaw.map((v, idx) => {
    const itensArr = Array.isArray(v.itens) ? (v.itens as Record<string, unknown>[]) : [];
    const pagsArr = Array.isArray(v.pagamentos) ? (v.pagamentos as Record<string, unknown>[]) : [];
    const fisObj = v.fiscal && typeof v.fiscal === "object" ? (v.fiscal as Record<string, unknown>) : null;
    const tipo = String(v.tipo ?? "fiscal") === "dav" ? "dav" : "fiscal";
    const statusRaw = String(v.status ?? (tipo === "fiscal" ? "faturado" : "aberto"));
    const status: VendaLegada["status"] =
      statusRaw === "cancelado" ? "cancelado" : statusRaw === "aberto" ? "aberto" : "faturado";

    return {
      id: String(v.id ?? `vd-${idx + 1}`),
      numero: Math.max(1, Math.round(numSeguro(v.numero, idx + 1))),
      clienteId: v.clienteId || v.cliente_id ? String(v.clienteId ?? v.cliente_id) : null,
      clienteNome: String(v.clienteNome ?? v.cliente_nome ?? "CONSUMIDOR").trim() || "CONSUMIDOR",
      itens: itensArr.map((it, iPos) => ({
        produtoId: it.produtoId ? String(it.produtoId) : null,
        nome: String(it.nome ?? `ITEM ${iPos + 1}`).trim(),
        qtd: Math.max(0.001, numSeguro(it.qtd, 1)),
        preco: Math.max(0, numSeguro(it.preco ?? it.precoUnit, 0)),
        unidade: String(it.unidade ?? "UN").trim().toUpperCase() || "UN",
        gtin: String(it.gtin ?? "SEM GTIN"),
      })),
      total: Math.max(0, numSeguro(v.total, 0)),
      desconto: Math.max(0, numSeguro(v.desconto, 0)),
      vFrete: Math.max(0, numSeguro(v.vFrete ?? v.v_frete, 0)),
      pagamento: String(v.pagamento ?? v.formaPagamento ?? "dinheiro"),
      pagamentos: pagsArr.map((p) => ({
        forma: String(p.forma ?? "dinheiro"),
        valor: Math.max(0, numSeguro(p.valor, 0)),
      })),
      tipo,
      status,
      validade: v.validade ? dataIsoSegura(v.validade) : null,
      observacao: v.observacao ? String(v.observacao) : null,
      fiscal: fisObj
        ? {
            modelo: String(fisObj.modelo ?? "NFC-e"),
            serie: String(fisObj.serie ?? "1"),
            numeroNota: Math.max(1, Math.round(numSeguro(fisObj.numeroNota, idx + 1))),
            chave: soDigitos(String(fisObj.chave ?? "")),
            protocolo: String(fisObj.protocolo ?? ""),
            autorizadaEm: fisObj.autorizadaEm ? Number(fisObj.autorizadaEm) : null,
          }
        : null,
      dataIso: timestampIsoSeguro(v.data),
    };
  });

  const lancamentosNorm: LancamentoLegado[] = lancsRaw.map((l, idx) => ({
    id: String(l.id ?? `lanc-${idx + 1}`),
    descricao: String(l.descricao ?? `Título legado ${idx + 1}`).trim(),
    valor: numSeguro(l.valor, 0),
    tipo: String(l.tipo ?? "receber") === "pagar" ? "pagar" : "receber",
    vencimento: dataIsoSegura(l.vencimento),
    pago: Boolean(l.pago),
    categoria: String(l.categoria ?? (l.tipo === "pagar" ? "Custos" : "Vendas")).trim() || "Geral",
  }));

  const mdfesNorm: MdfeLegado[] = mdfesRaw.map((m, idx) => {
    const docsArr = Array.isArray(m.documentos) ? (m.documentos as Record<string, unknown>[]) : [];
    return {
      id: String(m.id ?? `mdfe-${idx + 1}`),
      numero: Math.max(1, Math.round(numSeguro(m.numero, idx + 1))),
      serie: String(m.serie ?? "1"),
      chave: soDigitos(String(m.chave ?? "")),
      protocolo: String(m.protocolo ?? ""),
      ufInicio: String(m.ufInicio ?? "RO").toUpperCase().slice(0, 2),
      ufFim: String(m.ufFim ?? "RO").toUpperCase().slice(0, 2),
      municipioCarregamento: String(m.municipioCarregamento ?? ""),
      municipioDescarregamento: String(m.municipioDescarregamento ?? ""),
      placa: String(m.placa ?? "ABC1D23").toUpperCase(),
      rntrc: String(m.rntrc ?? ""),
      condutor: String(m.condutor ?? ""),
      cpfCondutor: soDigitos(String(m.cpfCondutor ?? "")),
      documentos: docsArr.map((d) => ({
        chave: soDigitos(String(d.chave ?? "")),
        tipo: String(d.tipo ?? "NF-e"),
        valor: Math.max(0, numSeguro(d.valor, 0)),
      })),
      pesoBruto: Math.max(0, numSeguro(m.pesoBruto, 0)),
      valorCarga: Math.max(0, numSeguro(m.valorCarga, 0)),
      status: String(m.status ?? "autorizado"),
      emitidoEmIso: timestampIsoSeguro(m.emitidoEm),
    };
  });

  const inutsNorm: InutilizacaoLegada[] = inutsRaw.map((i, idx) => ({
    id: String(i.id ?? `inut-${idx + 1}`),
    modelo: String(i.modelo ?? "NFC-e"),
    serie: String(i.serie ?? "1"),
    inicio: Math.max(1, Math.round(numSeguro(i.inicio ?? i.numeroInicial, 1))),
    fim: Math.max(1, Math.round(numSeguro(i.fim ?? i.numeroFinal, 1))),
    justificativa: String(i.justificativa ?? "Inutilização migrada do sistema legado"),
    protocolo: String(i.protocolo ?? ""),
  }));

  const dfesNorm: DfeLegada[] = dfesRaw.map((d, idx) => ({
    id: String(d.id ?? `dfe-${idx + 1}`),
    chave: soDigitos(String(d.chave ?? d.chave_acesso ?? "")),
    nsu: padNsu(String(d.nsu ?? idx + 1)),
    schema: String(d.schema ?? d.schema_tipo ?? "procNFe"),
    emitenteCnpj: soDigitos(String(d.emitenteCnpj ?? d.emitente_cnpj ?? "")),
    emitenteNome: String(d.emitenteNome ?? d.emitente_nome ?? "FORNECEDOR"),
    valorTotal: Math.max(0, numSeguro(d.valorTotal ?? d.valor_total, 0)),
    dataEmissao: dataIsoSegura(d.dataEmissao ?? d.data_emissao),
    statusManifesto: String(d.statusManifesto ?? d.status_manifesto ?? "pendente"),
    xmlBruto: d.xmlBruto || d.xml_bruto ? String(d.xmlBruto ?? d.xml_bruto) : null,
    importadoErp: Boolean(d.importadoErp ?? d.importado_erp),
  }));

  return {
    empresaOrigemNome: String(raiz.empresaNome ?? empresaPadrao.nome),
    empresaOrigemCnpj: String(raiz.empresaCnpj ?? empresaPadrao.cnpj),
    configFiscal:
      estado.configFiscal && typeof estado.configFiscal === "object"
        ? (estado.configFiscal as Record<string, unknown>)
        : null,
    produtos: produtosNorm,
    clientes: clientesNorm,
    fornecedores: fornecedoresNorm,
    entradas: entradasNorm,
    vendas: vendasNorm,
    lancamentos: lancamentosNorm,
    dfes: dfesNorm,
    mdfes: mdfesNorm,
    inutilizacoes: inutsNorm,
  };
}

/* ------------------------ Leitura Somente-SELECT do Banco Legado */

export async function carregarPacoteLegadoDoBanco(empresaId: string): Promise<PacoteLegadoBruto> {
  const [[emp], inspecao] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    inspecionarFontesLegadas(empresaId),
  ]);

  if (!emp) throw new Error("Empresa atual não localizada.");

  const cnpj14 = soDigitos(emp.cnpj);
  const legEmp = inspecao.empresaLegadaEncontrada;

  if (!legEmp && inspecao.dfeLegadoEncontradas === 0) {
    if (inspecao.faltaPermissaoLeitura) {
      throw new Error(
        "As tabelas legadas existem no banco, mas o usuário da aplicação ainda não possui permissão SELECT nelas. Aplique o comando GRANT SELECT somente-leitura ou importe via arquivo JSON.",
      );
    }
    throw new Error(
      `Nenhum registro legado encontrado nas tabelas sem prefixo para o CNPJ ${emp.cnpj} ou e-mail do administrador.`,
    );
  }

  let base: PacoteLegadoBruto = {
    empresaOrigemNome: legEmp?.nome ?? emp.nome,
    empresaOrigemCnpj: legEmp?.cnpj ?? emp.cnpj,
    configFiscal: null,
    produtos: [],
    clientes: [],
    fornecedores: [],
    entradas: [],
    vendas: [],
    lancamentos: [],
    dfes: [],
    mdfes: [],
    inutilizacoes: [],
  };

  const acessivel = (nome: string) => Boolean(inspecao.tabelas.find((t) => t.tabela === nome)?.acessivel);

  // 1. Se houver snapshot rico em erp_estados, usa como ponto de partida
  if (legEmp && acessivel("erp_estados")) {
    const rEst = await db.execute<{ estado: unknown }>(
      sql`select estado from public.erp_estados where empresa_id = ${legEmp.id}::uuid limit 1`,
    );
    const estObj = rEst.rows[0]?.estado;
    if (estObj && typeof estObj === "object" && Object.keys(estObj as object).length > 0) {
      try {
        base = extrairPacoteDeObjetoJson(
          { estado: estObj, empresaNome: legEmp.nome, empresaCnpj: legEmp.cnpj },
          { nome: emp.nome, cnpj: emp.cnpj },
        );
      } catch {
        // Ignora se estado estiver vazio
      }
    }
  }

  // 2. Complementa com tabelas relacionais legadas (SELECT estritamente filtrado por legEmp.id)
  if (legEmp) {
    if (acessivel("config_fiscal")) {
      const rCfg = await db.execute<Record<string, unknown>>(
        sql`select * from public.config_fiscal where empresa_id = ${legEmp.id}::uuid limit 1`,
      );
      if (rCfg.rows[0]) {
        const c = rCfg.rows[0];
        base.configFiscal = {
          ...(base.configFiscal ?? {}),
          regime: c.regime ?? base.configFiscal?.regime,
          crt: c.crt ?? base.configFiscal?.crt,
          ufPadrao: c.uf_padrao ?? base.configFiscal?.ufPadrao,
          serieNfce: c.serie_nfce ?? base.configFiscal?.serieNfce,
          serieNfe: c.serie_nfe ?? base.configFiscal?.serieNfe,
          ambiente: c.ambiente ?? base.configFiscal?.ambiente,
          cscId: c.csc_id ?? base.configFiscal?.cscId,
          cscToken: c.csc_token ?? base.configFiscal?.cscToken,
        };
      }
    }

    if (acessivel("produtos")) {
      const rProds = await db.execute<Record<string, unknown>>(
        sql`select * from public.produtos where empresa_id = ${legEmp.id}::uuid`,
      );
      const idsJaNoSnapshot = new Set(base.produtos.map((p) => p.id));
      for (const p of rProds.rows) {
        const pid = String(p.id ?? "");
        if (idsJaNoSnapshot.has(pid)) continue;
        const imp = (p.impostos && typeof p.impostos === "object" ? p.impostos : {}) as Record<string, unknown>;
        base.produtos.push({
          id: pid,
          nome: String(p.nome ?? "").trim(),
          sku: String(p.sku ?? "").trim(),
          gtin: String(p.gtin ?? "SEM GTIN").trim() || "SEM GTIN",
          categoria: String(p.categoria ?? "Geral").trim() || "Geral",
          marca: String(p.marca ?? "").trim(),
          unidade: String(p.unidade ?? "UN").trim().toUpperCase() || "UN",
          custo: numSeguro(p.custo, 0),
          preco: numSeguro(p.preco, 0),
          estoque: numSeguro(p.estoque, 0),
          estoqueMin: numSeguro(p.estoque_min, 0),
          pesavel: Boolean(p.pesavel),
          ncm: String(imp.ncm ?? "00000000"),
          cest: String(imp.cest ?? ""),
          cfop: String(imp.cfop ?? "5102"),
          csosn: String(imp.csosn ?? "102"),
          icmsAliq: numSeguro(imp.icmsAliq, 0),
          pisAliq: numSeguro(imp.pisAliq, 0),
          cofinsAliq: numSeguro(imp.cofinsAliq, 0),
          ibsAliq: numSeguro(imp.ibsAliq, 0.1),
          cbsAliq: numSeguro(imp.cbsAliq, 0.9),
        });
      }
    }

    if (acessivel("clientes")) {
      const rClis = await db.execute<Record<string, unknown>>(
        sql`select * from public.clientes where empresa_id = ${legEmp.id}::uuid`,
      );
      const idsJa = new Set(base.clientes.map((c) => c.id));
      for (const c of rClis.rows) {
        const cid = String(c.id ?? "");
        if (idsJa.has(cid)) continue;
        base.clientes.push({
          id: cid,
          nome: String(c.nome ?? "").trim(),
          documento: String(c.documento ?? "").trim(),
          email: String(c.email ?? "").trim(),
          telefone: String(c.telefone ?? "").trim(),
          cidade: String(c.cidade ?? "").trim(),
          uf: String(c.uf ?? "").trim().toUpperCase(),
          cep: soDigitos(String(c.cep ?? "")).slice(0, 8),
          logradouro: String(c.logradouro ?? "").trim(),
          numero: String(c.numero ?? "").trim(),
          bairro: String(c.bairro ?? "").trim(),
          indIe: "9",
          limiteCredito: numSeguro(c.limite_credito, 0),
          condicaoPadrao: "a vista",
        });
      }
    }

    if (acessivel("vendas")) {
      const rVds = await db.execute<Record<string, unknown>>(
        sql`select * from public.vendas where empresa_id = ${legEmp.id}::uuid order by data asc`,
      );
      const idsJa = new Set(base.vendas.map((v) => v.id));
      for (const v of rVds.rows) {
        const vid = String(v.id ?? "");
        if (idsJa.has(vid)) continue;
        const itensArr = Array.isArray(v.itens) ? (v.itens as Record<string, unknown>[]) : [];
        const pagsArr = Array.isArray(v.pagamentos) ? (v.pagamentos as Record<string, unknown>[]) : [];
        const fisObj = v.fiscal && typeof v.fiscal === "object" ? (v.fiscal as Record<string, unknown>) : null;
        const tipo = String(v.tipo ?? "fiscal") === "dav" ? "dav" : "fiscal";
        const stRaw = String(v.status ?? "faturado");
        base.vendas.push({
          id: vid,
          numero: Math.max(1, Math.round(numSeguro(v.numero, 1))),
          clienteId: v.cliente_id ? String(v.cliente_id) : null,
          clienteNome: String(v.cliente_nome ?? "CONSUMIDOR").trim() || "CONSUMIDOR",
          itens: itensArr.map((it, iPos) => ({
            produtoId: it.produtoId ? String(it.produtoId) : null,
            nome: String(it.nome ?? `ITEM ${iPos + 1}`),
            qtd: Math.max(0.001, numSeguro(it.qtd, 1)),
            preco: Math.max(0, numSeguro(it.preco ?? it.precoUnit, 0)),
            unidade: String(it.unidade ?? "UN").toUpperCase(),
            gtin: String(it.gtin ?? "SEM GTIN"),
          })),
          total: Math.max(0, numSeguro(v.total, 0)),
          desconto: Math.max(0, numSeguro(v.desconto, 0)),
          vFrete: Math.max(0, numSeguro(v.v_frete, 0)),
          pagamento: String(v.pagamento ?? "dinheiro"),
          pagamentos: pagsArr.map((p) => ({
            forma: String(p.forma ?? "dinheiro"),
            valor: Math.max(0, numSeguro(p.valor, 0)),
          })),
          tipo,
          status: stRaw === "cancelado" ? "cancelado" : stRaw === "aberto" ? "aberto" : "faturado",
          validade: v.validade ? dataIsoSegura(v.validade) : null,
          observacao: v.observacao ? String(v.observacao) : null,
          fiscal: fisObj
            ? {
                modelo: String(fisObj.modelo ?? "NFC-e"),
                serie: String(fisObj.serie ?? "1"),
                numeroNota: Math.max(1, Math.round(numSeguro(fisObj.numeroNota, 1))),
                chave: soDigitos(String(fisObj.chave ?? "")),
                protocolo: String(fisObj.protocolo ?? ""),
                autorizadaEm: fisObj.autorizadaEm ? Number(fisObj.autorizadaEm) : null,
              }
            : null,
          dataIso: timestampIsoSeguro(v.data),
        });
      }
    }

    if (acessivel("lancamentos")) {
      const rLancs = await db.execute<Record<string, unknown>>(
        sql`select * from public.lancamentos where empresa_id = ${legEmp.id}::uuid`,
      );
      const idsJa = new Set(base.lancamentos.map((l) => l.id));
      for (const l of rLancs.rows) {
        const lid = String(l.id ?? "");
        if (idsJa.has(lid)) continue;
        base.lancamentos.push({
          id: lid,
          descricao: String(l.descricao ?? "Lançamento legado").trim(),
          valor: numSeguro(l.valor, 0),
          tipo: String(l.tipo ?? "receber") === "pagar" ? "pagar" : "receber",
          vencimento: dataIsoSegura(l.vencimento),
          pago: Boolean(l.pago),
          categoria: String(l.categoria ?? "Geral").trim() || "Geral",
        });
      }
    }
  }

  // 3. Tabela legada nfe_entrada (DF-e) filtrada estritamente pelo CNPJ de 14 dígitos da empresa atual
  if (acessivel("nfe_entrada") && cnpj14.length === 14) {
    const rNfe = await db.execute<Record<string, unknown>>(
      sql`select * from public.nfe_entrada where regexp_replace(coalesce(cnpj_destinatario, ''), '\D', '', 'g') = ${cnpj14} order by data_emissao desc nulls last limit 120`,
    );
    const chavesJa = new Set(base.dfes.map((d) => d.chave));
    for (const d of rNfe.rows) {
      const ch = soDigitos(String(d.chave_acesso ?? ""));
      if (!ch || chavesJa.has(ch)) continue;
      chavesJa.add(ch);
      base.dfes.push({
        id: String(d.id ?? ch),
        chave: ch,
        nsu: padNsu(String(d.nsu ?? "1")),
        schema: String(d.schema_tipo ?? "procNFe"),
        emitenteCnpj: soDigitos(String(d.emitente_cnpj ?? "")),
        emitenteNome: String(d.emitente_nome ?? "FORNECEDOR DF-E LEGADO"),
        valorTotal: Math.max(0, numSeguro(d.valor_total, 0)),
        dataEmissao: dataIsoSegura(d.data_emissao),
        statusManifesto: String(d.status_manifesto ?? "pendente"),
        xmlBruto: d.xml_bruto ? String(d.xml_bruto) : null,
        importadoErp: Boolean(d.importado_erp),
      });
    }
  }

  return base;
}

/* --------------------- Planejador (Dry-Run) + Executor Idempotente */

export async function processarMigracaoLegado(params: {
  empresaId: string;
  fonte: "banco" | "json";
  pacote: PacoteLegadoBruto;
  modulosSelecionados?: ModuloMigracaoId[];
  aplicar: boolean;
  silenciarAuditoria?: boolean;
  usuario: { id: string; nome: string; papel: string };
}): Promise<{
  plano: PlanoMigracaoLegadoDto;
  execucao: ResultadoExecucaoMigracaoDto | null;
}> {
  const { empresaId, fonte, pacote, aplicar, usuario } = params;
  const filtroModulos = new Set<ModuloMigracaoId>(
    params.modulosSelecionados?.length ? params.modulosSelecionados : MODULOS_MIGRACAO.map((m) => m.id),
  );

  const [[emp], prodsAtuais, clisAtuais, fornsAtuais, entsAtuais, vdsAtuais, ctsAtuais, mdfsAtuais, inutsAtuais] =
    await Promise.all([
      db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
      db.select().from(produtos).where(eq(produtos.empresaId, empresaId)),
      db.select().from(clientes).where(eq(clientes.empresaId, empresaId)),
      db.select().from(fornecedores).where(eq(fornecedores.empresaId, empresaId)),
      db.select().from(entradas).where(eq(entradas.empresaId, empresaId)),
      db.select().from(vendas).where(eq(vendas.empresaId, empresaId)),
      db.select().from(contas).where(eq(contas.empresaId, empresaId)),
      db.select().from(mdfes).where(eq(mdfes.empresaId, empresaId)),
      db.select().from(inutilizacoes).where(eq(inutilizacoes.empresaId, empresaId)),
    ]);

  if (!emp) throw new Error("Empresa não encontrada.");

  const resumos: ResumoModuloMigracao[] = [];
  const importadosPorModulo = Object.fromEntries(MODULOS_MIGRACAO.map((m) => [m.id, 0])) as Record<ModuloMigracaoId, number>;
  let fiscalAtualizado = { ...((emp.fiscal ?? {}) as Record<string, unknown>) };
  let precisaSalvarFiscal = false;

  /* ---------------- 1. CONFIGURAÇÃO FISCAL ---------------- */
  {
    const cfg = pacote.configFiscal;
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    if (cfg && filtroModulos.has("fiscal")) {
      const serieNfceNova = String(cfg.serieNfce ?? fiscalAtualizado.serieNfce ?? "1");
      const serieNfeNova = String(cfg.serieNfe ?? fiscalAtualizado.serieNfe ?? "1");
      const crtNovo = Number(cfg.crt ?? fiscalAtualizado.crt ?? 1);
      const cscIdNovo = String(cfg.cscId ?? fiscalAtualizado.cscId ?? "");
      const mudou =
        !fiscalAtualizado.legadoConfigMigrada &&
        (serieNfceNova !== String(fiscalAtualizado.serieNfce ?? "1") ||
          serieNfeNova !== String(fiscalAtualizado.serieNfe ?? "1") ||
          (cscIdNovo && !fiscalAtualizado.cscId));

      if (mudou) {
        novos = 1;
        if (aplicar) {
          const tokenRaw = String(cfg.cscToken ?? "");
          fiscalAtualizado = {
            ...fiscalAtualizado,
            serieNfce: /^\d{1,3}$/.test(serieNfceNova) ? serieNfceNova : "1",
            serieNfe: /^\d{1,3}$/.test(serieNfeNova) ? serieNfeNova : "1",
            crt: [1, 2, 3, 4].includes(crtNovo) ? crtNovo : 1,
            cscId: cscIdNovo || fiscalAtualizado.cscId,
            cscToken:
              tokenRaw && !fiscalAtualizado.cscToken
                ? `${tokenRaw.slice(0, 3)}···${tokenRaw.slice(-3)}`
                : fiscalAtualizado.cscToken,
            legadoConfigMigrada: true,
          };
          precisaSalvarFiscal = true;
          importadosPorModulo.fiscal = 1;
        }
      } else {
        ignorados = 1;
      }
    }
    resumos.push({
      modulo: "fiscal",
      rotulo: "Configuração fiscal",
      destino: "nk_empresa.fiscal",
      encontrados: cfg ? 1 : 0,
      novos,
      ignoradosExistentes: ignorados,
      saneados: 0,
      avisos,
    });
  }

  /* ---------------- 2. PRODUTOS + KARDEX INICIAL ---------------- */
  const mapaProdutoId = new Map<string, string>(); // idLegado -> uuid nk_produto
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const porId = new Map(prodsAtuais.map((p) => [p.id, p.id]));
    const porGtin = new Map(
      prodsAtuais.filter((p) => p.gtin && p.gtin !== "SEM GTIN").map((p) => [p.gtin, p.id]),
    );
    const skusUsados = new Set(prodsAtuais.map((p) => p.sku.toUpperCase()).filter(Boolean));
    const porSku = new Map(prodsAtuais.filter((p) => p.sku).map((p) => [p.sku.toUpperCase(), p.id]));
    const porNome = new Map(prodsAtuais.map((p) => [normalizarNomeComparacao(p.nome), p.id]));

    for (let i = 0; i < pacote.produtos.length; i++) {
      const pl = pacote.produtos[i];
      if (!pl.nome) continue;

      const uuidCand = uuidDeterministico(empresaId, "produto", pl.id);
      const nomeNorm = normalizarNomeComparacao(pl.nome);
      const gtinLimpo = pl.gtin && pl.gtin !== "SEM GTIN" ? soDigitos(pl.gtin) : "SEM GTIN";

      const existenteId =
        porId.get(uuidCand) ??
        (gtinLimpo !== "SEM GTIN" ? porGtin.get(gtinLimpo) : undefined) ??
        (pl.sku ? porSku.get(pl.sku.toUpperCase()) : undefined) ??
        porNome.get(nomeNorm);

      if (existenteId) {
        mapaProdutoId.set(pl.id, existenteId);
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("produtos")) continue;

      let gtinFinal = gtinLimpo || "SEM GTIN";
      if (gtinFinal !== "SEM GTIN" && !validarGtin(gtinFinal)) {
        gtinFinal = "SEM GTIN";
        saneados++;
        if (avisos.length < 5) avisos.push(`Produto "${pl.nome}": GTIN inválido ajustado para SEM GTIN.`);
      }

      const custoFinal = round2(Math.max(0, pl.custo));
      let precoFinal = round2(Math.max(0, pl.preco));
      if (precoFinal < custoFinal) {
        precoFinal = custoFinal;
        saneados++;
        if (avisos.length < 5) avisos.push(`Produto "${pl.nome}": preço ajustado para não ficar abaixo do custo.`);
      }

      const estoqueFinal = round2(Math.max(0, pl.estoque));
      const estoqueMinFinal = round2(Math.max(0, pl.estoqueMin));

      let skuFinal = (pl.sku || `LEG${String(i + 1).padStart(4, "0")}`).toUpperCase();
      if (skusUsados.has(skuFinal)) {
        let suf = 2;
        while (skusUsados.has(`${skuFinal}-${suf}`)) suf++;
        skuFinal = `${skuFinal}-${suf}`;
        saneados++;
      }

      const ncmDigits = soDigitos(pl.ncm);
      const ncmFinal = ncmDigits.length === 8 ? ncmDigits : ncmDigits.padEnd(8, "0").slice(0, 8) || "00000000";
      const cfopDigits = soDigitos(pl.cfop);
      const cfopFinal = cfopDigits.length === 4 ? cfopDigits : "5102";
      const clampAliq = (v: number, def = 0) => Math.min(100, Math.max(0, round2(Number.isFinite(v) ? v : def)));

      skusUsados.add(skuFinal);
      porId.set(uuidCand, uuidCand);
      if (gtinFinal !== "SEM GTIN") porGtin.set(gtinFinal, uuidCand);
      porSku.set(skuFinal, uuidCand);
      porNome.set(nomeNorm, uuidCand);
      mapaProdutoId.set(pl.id, uuidCand);
      novos++;

      if (aplicar) {
        await db.insert(produtos).values({
          id: uuidCand,
          empresaId,
          nome: pl.nome.toUpperCase(),
          sku: skuFinal,
          gtin: gtinFinal,
          categoria: pl.categoria || "Geral",
          marca: pl.marca || "",
          unidade: (pl.unidade || "UN").slice(0, 6),
          custo: custoFinal,
          preco: precoFinal,
          estoque: estoqueFinal,
          estoqueMin: estoqueMinFinal,
          pesavel: pl.pesavel,
          ativo: true,
          ncm: ncmFinal,
          cest: soDigitos(pl.cest).slice(0, 7),
          cfop: cfopFinal,
          csosn: pl.csosn || "102",
          icmsAliq: clampAliq(pl.icmsAliq, 0),
          pisAliq: clampAliq(pl.pisAliq, 0),
          cofinsAliq: clampAliq(pl.cofinsAliq, 0),
          ibsAliq: clampAliq(pl.ibsAliq, 0.1),
          cbsAliq: clampAliq(pl.cbsAliq, 0.9),
          atualizadoEm: new Date(),
        });

        if (estoqueFinal > 0) {
          await db.insert(movimentos).values({
            empresaId,
            produtoId: uuidCand,
            produtoNome: pl.nome.toUpperCase(),
            tipo: "inventario",
            qtd: estoqueFinal,
            saldoApos: estoqueFinal,
            custoUnit: custoFinal,
            custoMedioApos: custoFinal,
            documento: "Migração legado",
            observacao: "Saldo inicial migrado da base legada",
            usuarioId: usuario.id,
            usuarioNome: usuario.nome,
            data: new Date(),
          });
        }
        importadosPorModulo.produtos++;
      }
    }

    resumos.push({
      modulo: "produtos",
      rotulo: "Produtos e estoque inicial",
      destino: "nk_produto + nk_movimento",
      encontrados: pacote.produtos.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 3. CLIENTES ---------------- */
  const mapaClienteId = new Map<string, string>();
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const porId = new Map(clisAtuais.map((c) => [c.id, c.id]));
    const porDoc = new Map(
      clisAtuais.filter((c) => soDigitos(c.documento).length >= 11).map((c) => [soDigitos(c.documento), c.id]),
    );
    const nomesUsados = new Map(clisAtuais.map((c) => [normalizarNomeComparacao(c.nome), c.id]));

    for (const cl of pacote.clientes) {
      if (!cl.nome) continue;
      const uuidCand = uuidDeterministico(empresaId, "cliente", cl.id);
      const docDig = soDigitos(cl.documento);
      const nomeNorm = normalizarNomeComparacao(cl.nome);

      const existenteId =
        porId.get(uuidCand) ??
        (docDig.length >= 11 ? porDoc.get(docDig) : undefined) ??
        nomesUsados.get(nomeNorm);

      if (existenteId) {
        mapaClienteId.set(cl.id, existenteId);
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("clientes")) continue;

      let docFinal = cl.documento ? mascaraDocumento(docDig) : "";
      if (docFinal && !documentoValido(docFinal)) {
        docFinal = "";
        saneados++;
        if (avisos.length < 5) avisos.push(`Cliente "${cl.nome}": CPF/CNPJ inválido removido para não bloquear emissão.`);
      }

      const ufCand = cl.uf.replace(/[^A-Z]/g, "").slice(0, 2);
      const indIeFinal = ["1", "2", "9"].includes(cl.indIe) ? cl.indIe : "9";

      porId.set(uuidCand, uuidCand);
      if (docFinal) porDoc.set(soDigitos(docFinal), uuidCand);
      nomesUsados.set(nomeNorm, uuidCand);
      mapaClienteId.set(cl.id, uuidCand);
      novos++;

      if (aplicar) {
        await db.insert(clientes).values({
          id: uuidCand,
          empresaId,
          nome: cl.nome.trim(),
          documento: docFinal,
          email: cl.email,
          telefone: cl.telefone,
          cidade: cl.cidade,
          uf: ufCand.length === 2 ? ufCand : "",
          cep: cl.cep,
          logradouro: cl.logradouro,
          numero: cl.numero,
          bairro: cl.bairro,
          indIe: indIeFinal,
          limiteCredito: round2(Math.max(0, cl.limiteCredito)),
          condicaoPadrao: cl.condicaoPadrao || "a vista",
        });
        importadosPorModulo.clientes++;
      }
    }

    resumos.push({
      modulo: "clientes",
      rotulo: "Clientes",
      destino: "nk_cliente",
      encontrados: pacote.clientes.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 4. FORNECEDORES ---------------- */
  const mapaFornecedorCnpj = new Map<string, string>();
  for (const f of fornsAtuais) {
    if (soDigitos(f.cnpj).length === 14) mapaFornecedorCnpj.set(soDigitos(f.cnpj), f.id);
  }
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const porNome = new Map(fornsAtuais.map((f) => [normalizarNomeComparacao(f.nome), f.id]));

    for (const fl of pacote.fornecedores) {
      if (!fl.nome) continue;
      const cnpjDig = soDigitos(fl.cnpj);
      const nomeNorm = normalizarNomeComparacao(fl.nome);

      const jaId = (cnpjDig ? mapaFornecedorCnpj.get(cnpjDig) : undefined) ?? porNome.get(nomeNorm);
      if (jaId) {
        if (cnpjDig) mapaFornecedorCnpj.set(cnpjDig, jaId);
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("fornecedores")) continue;

      if (!validarCnpj(cnpjDig)) {
        saneados++;
        if (avisos.length < 5) avisos.push(`Fornecedor "${fl.nome}" ignorado: CNPJ sem dígito verificador válido.`);
        continue;
      }

      const uuidCand = uuidDeterministico(empresaId, "fornecedor", fl.id);
      const ufCand = fl.uf.replace(/[^A-Z]/g, "").slice(0, 2);
      mapaFornecedorCnpj.set(cnpjDig, uuidCand);
      porNome.set(nomeNorm, uuidCand);
      novos++;

      if (aplicar) {
        await db.insert(fornecedores).values({
          id: uuidCand,
          empresaId,
          nome: fl.nome.toUpperCase(),
          cnpj: mascaraDocumento(cnpjDig),
          cidade: fl.cidade,
          uf: ufCand.length === 2 ? ufCand : "",
          telefone: fl.telefone,
          email: fl.email,
          prazoPagDias: fl.prazoPagDias || 30,
        });
        importadosPorModulo.fornecedores++;
      }
    }

    resumos.push({
      modulo: "fornecedores",
      rotulo: "Fornecedores",
      destino: "nk_fornecedor",
      encontrados: pacote.fornecedores.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 5. ENTRADAS DE MERCADORIA ---------------- */
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const chavesEnt = new Set(entsAtuais.map((e) => soDigitos(e.chave)).filter(Boolean));
    const numFornEnt = new Set(
      entsAtuais.map((e) => `${e.numeroNota}|${soDigitos(e.cnpjFornecedor) || normalizarNomeComparacao(e.fornecedor)}`),
    );

    for (const el of pacote.entradas) {
      const ch = soDigitos(el.chave);
      const chaveAssinatura = `${el.numeroNota}|${el.cnpjFornecedor || normalizarNomeComparacao(el.fornecedor)}`;

      if ((ch && chavesEnt.has(ch)) || numFornEnt.has(chaveAssinatura)) {
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("entradas")) continue;

      let chaveFinal = ch;
      if (chaveFinal && chaveFinal.length !== 44) {
        chaveFinal = "";
        saneados++;
      }

      const itensNorm: EntradaItem[] = (el.itens.length ? el.itens : [
        {
          produtoId: null,
          nome: "MERCADORIA MIGRADA LEGADO",
          sku: `LEG-ENT-${el.numeroNota}`,
          ncm: "00000000",
          cfop: "5102",
          unidade: "UN",
          gtin: "SEM GTIN",
          qtd: 1,
          qtdNota: 1,
          custo: Math.max(0.01, el.total),
          preco: round2(Math.max(0.01, el.total) * 1.35),
        },
      ]).map((it) => ({
        produtoId: it.produtoId ? (mapaProdutoId.get(it.produtoId) ?? null) : null,
        nome: it.nome.toUpperCase(),
        nomeFornecedor: it.nome,
        sku: it.sku,
        ncm: /^\d{8}$/.test(it.ncm) ? it.ncm : "00000000",
        cfop: /^\d{4}$/.test(it.cfop) ? it.cfop : "5102",
        unidade: it.unidade || "UN",
        gtin: validarGtin(it.gtin) ? it.gtin : "SEM GTIN",
        qtd: round2(it.qtd),
        qtdNota: round2(it.qtdNota),
        custo: round2(Math.max(0, it.custo)),
        preco: round2(Math.max(it.custo, it.preco)),
      }));

      const vProd = round2(itensNorm.reduce((s, i) => s + i.qtd * i.custo, 0));
      const totalFinal = round2(Math.max(vProd, el.total));
      // Se já estava lançada no legado, marca "conferida" ou "lancada" conforme presença de movimento, evitando inflar fila pendente (com-5)
      const statusFinal = el.status === "lancada" ? "conferida" : "conferida";

      if (chaveFinal) chavesEnt.add(chaveFinal);
      numFornEnt.add(chaveAssinatura);
      novos++;

      if (aplicar) {
        await db.insert(entradas).values({
          id: uuidDeterministico(empresaId, "entrada", el.id),
          empresaId,
          numeroNota: el.numeroNota,
          serie: el.serie || "1",
          chave: chaveFinal,
          fornecedor: el.fornecedor.toUpperCase(),
          cnpjFornecedor: el.cnpjFornecedor,
          fornecedorId: el.cnpjFornecedor ? (mapaFornecedorCnpj.get(el.cnpjFornecedor) ?? null) : null,
          emissao: el.emissao,
          valorProdutos: vProd,
          valorFrete: round2(Math.max(0, totalFinal - vProd)),
          total: totalFinal,
          status: statusFinal,
          origem: "manual",
          gerarFinanceiro: false,
          itens: itensNorm,
          observacao: "Migrada da base legada",
        });
        importadosPorModulo.entradas++;
      }
    }

    resumos.push({
      modulo: "entradas",
      rotulo: "Entradas de mercadoria",
      destino: "nk_entrada",
      encontrados: pacote.entradas.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 6. VENDAS FISCAIS E DAVs ---------------- */
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const idsVendaJa = new Set(vdsAtuais.map((v) => v.id));
    const chavesVendaJa = new Set(vdsAtuais.map((v) => soDigitos(v.chave)).filter(Boolean));
    const numerosUsados = new Set(vdsAtuais.map((v) => v.numero));
    let maiorNumero = vdsAtuais.reduce((m, v) => Math.max(m, v.numero), 0);

    const notasPorSerie = new Set(
      vdsAtuais
        .filter((v) => v.tipo === "fiscal")
        .map((v) => `${v.modelo ?? "NFC-e"}|${v.serie ?? "1"}|${v.numeroNota ?? 0}`),
    );
    let maiorNotaFiscal = vdsAtuais
      .filter((v) => v.tipo === "fiscal")
      .reduce((m, v) => Math.max(m, Number(v.numeroNota ?? 0)), 0);

    const assinaturasDav = new Set(
      vdsAtuais.map((v) => `${v.tipo}|${normalizarNomeComparacao(v.clienteNome)}|${round2(Number(v.total))}|${(v.data ? new Date(v.data).toISOString().slice(0, 10) : "")}`),
    );

    for (const vl of pacote.vendas) {
      const uuidCand = uuidDeterministico(empresaId, "venda", vl.id);
      const chOrig = soDigitos(vl.fiscal?.chave ?? "");
      const assNat = `${vl.tipo}|${normalizarNomeComparacao(vl.clienteNome)}|${round2(vl.total)}|${vl.dataIso.slice(0, 10)}`;

      if (idsVendaJa.has(uuidCand) || (chOrig && chavesVendaJa.has(chOrig)) || assinaturasDav.has(assNat)) {
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("vendas")) continue;

      let numeroInterno = vl.numero;
      if (numerosUsados.has(numeroInterno)) {
        maiorNumero = Math.max(maiorNumero + 1, numeroInterno + 1);
        numeroInterno = maiorNumero;
        saneados++;
      }
      numerosUsados.add(numeroInterno);
      maiorNumero = Math.max(maiorNumero, numeroInterno);

      const itensBase =
        vl.itens.length > 0
          ? vl.itens
          : [
              {
                produtoId: null,
                nome: "ITEM DE VENDA MIGRADO DO LEGADO",
                qtd: 1,
                preco: round2(Math.max(0, vl.total + vl.desconto - vl.vFrete)),
                unidade: "UN",
                gtin: "SEM GTIN",
              },
            ];

      const itensProntos = itensBase.map((it) => {
        const qtd = round2(it.qtd * 1000) / 1000;
        const precoUnit = round2(Math.max(0, it.preco));
        return {
          produtoId: it.produtoId ? (mapaProdutoId.get(it.produtoId) ?? null) : null,
          nome: it.nome.toUpperCase(),
          qtd,
          precoUnit,
          total: round2(qtd * precoUnit),
          unidade: (it.unidade || "UN").slice(0, 6),
          gtin: validarGtin(it.gtin) ? it.gtin : "SEM GTIN",
        };
      });

      const subtotal = round2(itensProntos.reduce((s, i) => s + i.qtd * i.precoUnit, 0));
      const desconto = Math.min(subtotal, round2(Math.max(0, vl.desconto)));
      const frete = round2(Math.max(0, vl.vFrete));
      const total = round2(subtotal - desconto + frete);

      const formaPrincipal = ["dinheiro", "pix", "credito", "debito", "boleto", "prazo"].includes(vl.pagamento)
        ? vl.pagamento
        : "dinheiro";
      let pags = vl.pagamentos.filter((p) => p.valor > 0).map((p) => ({ forma: p.forma, valor: round2(p.valor) }));
      const somaPags = round2(pags.reduce((s, p) => s + p.valor, 0));
      if (pags.length > 0 && Math.abs(somaPags - total) > 0.02) {
        pags = [{ forma: formaPrincipal, valor: total }];
        saneados++;
      } else if (pags.length === 0 && vl.tipo === "fiscal") {
        pags = [{ forma: formaPrincipal, valor: total }];
      }

      let modelo: string | null = null;
      let serie: string | null = null;
      let numeroNota: number | null = null;
      let chave: string | null = null;
      let protocolo: string | null = null;

      if (vl.tipo === "fiscal") {
        modelo = ["NFC-e", "NF-e", "SAT"].includes(vl.fiscal?.modelo ?? "") ? vl.fiscal!.modelo : "NFC-e";
        serie = /^\d{1,3}$/.test(vl.fiscal?.serie ?? "") ? vl.fiscal!.serie : "1";
        let candNota = vl.fiscal?.numeroNota ?? numeroInterno;
        while (notasPorSerie.has(`${modelo}|${serie}|${candNota}`)) {
          maiorNotaFiscal = Math.max(maiorNotaFiscal + 1, candNota + 1);
          candNota = maiorNotaFiscal;
          saneados++;
        }
        numeroNota = candNota;
        maiorNotaFiscal = Math.max(maiorNotaFiscal, candNota);
        notasPorSerie.add(`${modelo}|${serie}|${numeroNota}`);

        if (chOrig && validarChaveAcesso(chOrig) && !chavesVendaJa.has(chOrig)) {
          chave = chOrig;
        } else {
          const aamm = `${vl.dataIso.slice(2, 4)}${vl.dataIso.slice(5, 7)}`;
          chave = gerarChave({
            uf: UF_NUMERO[emp.uf] ?? "11",
            aamm: /^\d{4}$/.test(aamm) ? aamm : "2603",
            cnpj: emp.cnpj,
            modelo: MODELO_NUMERO[modelo] ?? "65",
            serie,
            numeroNota,
          });
          saneados++;
        }
        chavesVendaJa.add(chave);
        protocolo = vl.fiscal?.protocolo || `1${UF_NUMERO[emp.uf] ?? "11"}${String(numeroNota).padStart(12, "0")}`;
      }

      idsVendaJa.add(uuidCand);
      assinaturasDav.add(assNat);
      novos++;

      if (aplicar) {
        const clienteMapeado = vl.clienteId ? (mapaClienteId.get(vl.clienteId) ?? null) : null;
        await db.insert(vendas).values({
          id: uuidCand,
          empresaId,
          numero: numeroInterno,
          clienteId: clienteMapeado,
          clienteNome: vl.clienteNome,
          subtotal,
          desconto,
          vFrete: frete,
          total,
          formaPagamento: formaPrincipal,
          pagamentos: pags,
          tipo: vl.tipo,
          status: vl.status,
          modelo,
          serie,
          numeroNota,
          chave,
          protocolo,
          xmlFiscal: null, // Nunca gera XML fictício (regra estrita Fase 3)
          autorizadaEm: vl.tipo === "fiscal" ? (vl.fiscal?.autorizadaEm ?? new Date(vl.dataIso).getTime()) : null,
          validade: vl.tipo === "dav" ? (vl.validade || hojeISO()) : null,
          observacao: vl.observacao ? `${vl.observacao} (legado)` : "Migrado do legado",
          operador: "Histórico legado",
          caixa: "CAIXA 1",
          ambiente: String(fiscalAtualizado.ambiente ?? "2"),
          origem: "legado",
          data: new Date(vl.dataIso),
        });

        await db.insert(vendaItens).values(
          itensProntos.map((it) => ({
            vendaId: uuidCand,
            produtoId: it.produtoId,
            nome: it.nome,
            qtd: it.qtd,
            precoUnit: it.precoUnit,
            total: it.total,
            unidade: it.unidade,
            gtin: it.gtin,
          })),
        );
        importadosPorModulo.vendas++;
      }
    }

    resumos.push({
      modulo: "vendas",
      rotulo: "Vendas fiscais e DAVs",
      destino: "nk_venda + nk_venda_item",
      encontrados: pacote.vendas.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 7. FINANCEIRO (LANÇAMENTOS → CONTAS) ---------------- */
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const idsContaJa = new Set(ctsAtuais.map((c) => c.id));
    const chavesContaJa = new Set(
      ctsAtuais.map((c) => `${c.tipo}|${normalizarNomeComparacao(c.descricao)}|${String(c.vencimento).slice(0, 10)}|${round2(Number(c.valor))}`),
    );

    for (const ll of pacote.lancamentos) {
      if (ll.valor <= 0) {
        saneados++;
        if (avisos.length < 5) avisos.push(`Título "${ll.descricao}" ignorado: valor menor ou igual a zero.`);
        continue;
      }

      const uuidCand = uuidDeterministico(empresaId, "conta", ll.id);
      const venc = /^\d{4}-\d{2}-\d{2}$/.test(ll.vencimento) ? ll.vencimento : hojeISO();
      const val = round2(ll.valor);
      const chaveNat = `${ll.tipo}|${normalizarNomeComparacao(ll.descricao)}|${venc}|${val}`;

      if (idsContaJa.has(uuidCand) || chavesContaJa.has(chaveNat)) {
        ignorados++;
        continue;
      }

      if (!filtroModulos.has("financeiro")) continue;

      idsContaJa.add(uuidCand);
      chavesContaJa.add(chaveNat);
      novos++;

      if (aplicar) {
        await db.insert(contas).values({
          id: uuidCand,
          empresaId,
          tipo: ll.tipo,
          descricao: ll.descricao,
          categoria: ll.categoria || (ll.tipo === "receber" ? "Vendas" : "Custos"),
          contraparteNome: "",
          contraparteId: null,
          contraparteTipo: null,
          valor: val,
          valorPago: ll.pago ? val : 0,
          vencimento: venc,
          pagoEm: ll.pago ? venc : null,
          status: ll.pago ? "paga" : "aberta",
          forma: "pix",
          origem: "migracao_legado",
        });
        importadosPorModulo.financeiro++;
      }
    }

    resumos.push({
      modulo: "financeiro",
      rotulo: "Contas a pagar e receber",
      destino: "nk_conta",
      encontrados: pacote.lancamentos.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 8. DF-e / NF-e RECEBIDAS (nfe_entrada) ---------------- */
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const docsAtuais = lerDocumentosDfeFiscal(fiscalAtualizado, false);
    const chavesDfeJa = new Set(docsAtuais.map((d) => d.chave).filter(Boolean));
    const novosDocsDfe: DfeDocumento[] = [];

    for (const dl of pacote.dfes) {
      if (chavesDfeJa.has(dl.chave)) {
        ignorados++;
        continue;
      }
      if (!filtroModulos.has("dfe")) continue;

      if (!validarChaveAcesso(dl.chave)) {
        saneados++;
        if (avisos.length < 5) avisos.push(`DF-e NSU ${dl.nsu} ignorada: chave de acesso sem 44 dígitos válidos.`);
        continue;
      }

      chavesDfeJa.add(dl.chave);
      novos++;

      const temXml = Boolean(dl.xmlBruto && /<\s*(?:nfeProc|NFe|infNFe)\b/i.test(dl.xmlBruto));
      novosDocsDfe.push({
        id: uuidDeterministico(empresaId, "dfe", dl.id),
        nsu: padNsu(dl.nsu),
        chave: dl.chave,
        numero: String(Number(dl.chave.slice(25, 34)) || 1),
        serie: String(Number(dl.chave.slice(22, 25)) || 1),
        schema: temXml ? "procNFe_v4.00.xsd" : "resNFe_v1.01.xsd",
        emitenteNome: dl.emitenteNome,
        emitenteCnpj: dl.emitenteCnpj,
        valorTotal: round2(dl.valorTotal),
        dataEmissao: dl.dataEmissao,
        statusManifesto: (["pendente", "ciencia", "confirmada", "desconhecida", "nao_realizada", "resumo"].includes(dl.statusManifesto)
          ? dl.statusManifesto
          : temXml
            ? "ciencia"
            : "resumo") as DfeDocumento["statusManifesto"],
        temXmlCompleto: temXml,
        xmlZip: dl.xmlBruto ? zipDocZip(dl.xmlBruto) : undefined,
        importadoErp: dl.importadoErp,
        entradaId: null,
        capturadoEm: new Date().toISOString(),
      });
    }

    if (aplicar && novosDocsDfe.length > 0) {
      const todos = [...novosDocsDfe, ...docsAtuais].slice(0, 120);
      const maiorNsu = todos.reduce((m, d) => Math.max(m, Number(soDigitos(d.nsu)) || 0), Number(soDigitos(String(fiscalAtualizado.dfeUltimoNsu ?? "0"))));
      fiscalAtualizado = {
        ...fiscalAtualizado,
        dfeUltimoNsu: padNsu(maiorNsu),
        dfeMaxNsu: padNsu(Math.max(maiorNsu, Number(soDigitos(String(fiscalAtualizado.dfeMaxNsu ?? "0"))))),
        dfeDocumentos: todos,
      };
      precisaSalvarFiscal = true;
      importadosPorModulo.dfe = novosDocsDfe.length;
    }

    resumos.push({
      modulo: "dfe",
      rotulo: "NF-e recebidas (DF-e)",
      destino: "nk_empresa.fiscal.dfeDocumentos",
      encontrados: pacote.dfes.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  /* ---------------- 9. MDF-e E INUTILIZAÇÕES ---------------- */
  {
    const avisos: string[] = [];
    let novos = 0;
    let ignorados = 0;
    let saneados = 0;

    const chavesMdfeJa = new Set(mdfesAtuaisMap());
    function mdfesAtuaisMap() {
      return mdfsAtuais.map((m) => soDigitos(m.chave)).filter(Boolean);
    }
    let maiorMdfeNum = mdfsAtuais.reduce((m, x) => Math.max(m, x.numero), 0);

    for (const ml of pacote.mdfes) {
      if (ml.chave && chavesMdfeJa.has(ml.chave)) {
        ignorados++;
        continue;
      }
      if (!filtroModulos.has("eventos")) continue;

      const docsNfe = ml.documentos.filter((d) => d.tipo === "NF-e" && soDigitos(d.chave).length === 44);
      if (ml.documentos.length > 0 && docsNfe.length === 0) {
        saneados++;
        continue;
      }
      const valorCarga = round2(docsNfe.reduce((s, d) => s + d.valor, 0));
      maiorMdfeNum = Math.max(maiorMdfeNum + 1, ml.numero);
      const chaveFinal =
        ml.chave.length === 44
          ? ml.chave
          : gerarChave({
              uf: UF_NUMERO[emp.uf] ?? "11",
              aamm: "2603",
              cnpj: emp.cnpj,
              modelo: "58",
              serie: ml.serie || "1",
              numeroNota: maiorMdfeNum,
            });

      chavesMdfeJa.add(chaveFinal);
      novos++;

      if (aplicar) {
        await db.insert(mdfes).values({
          id: uuidDeterministico(empresaId, "mdfe", ml.id),
          empresaId,
          numero: maiorMdfeNum,
          serie: ml.serie || "1",
          chave: chaveFinal,
          protocolo: ml.protocolo || `191${Date.now().toString().slice(-12)}`,
          ufInicio: ml.ufInicio || emp.uf,
          ufFim: ml.ufFim || emp.uf,
          municipioCarregamento: ml.municipioCarregamento,
          municipioDescarregamento: ml.municipioDescarregamento,
          placa: ml.placa || "ABC1D23",
          rntrc: ml.rntrc,
          condutor: ml.condutor,
          cpfCondutor: ml.cpfCondutor,
          documentos: docsNfe,
          pesoBruto: round2(ml.pesoBruto),
          valorCarga,
          status: ["autorizado", "encerrado", "cancelado"].includes(ml.status) ? ml.status : "autorizado",
          emitidoEm: new Date(ml.emitidoEmIso),
        });
        importadosPorModulo.eventos++;
      }
    }

    const faixasAtuais = [...inutsAtuais];
    const notasEmitidas = new Set(
      vdsAtuais.filter((v) => v.tipo === "fiscal").map((v) => `${v.modelo}|${v.serie}|${v.numeroNota}`),
    );

    for (const il of pacote.inutilizacoes) {
      const ini = Math.min(il.inicio, il.fim);
      const fim = Math.max(il.inicio, il.fim);
      const jaExiste = faixasAtuais.some(
        (f) => f.modelo === il.modelo && f.serie === il.serie && f.numeroInicial === ini && f.numeroFinal === fim,
      );
      if (jaExiste) {
        ignorados++;
        continue;
      }
      if (!filtroModulos.has("eventos")) continue;

      const sobrepoe = faixasAtuais.some(
        (f) => f.status !== "cancelado" && f.modelo === il.modelo && f.serie === il.serie && ini <= f.numeroFinal && fim >= f.numeroInicial,
      );
      let cobreEmitida = false;
      for (let n = ini; n <= Math.min(fim, ini + 500); n++) {
        if (notasEmitidas.has(`${il.modelo}|${il.serie}|${n}`)) {
          cobreEmitida = true;
          break;
        }
      }
      if (sobrepoe || cobreEmitida) {
        saneados++;
        if (avisos.length < 5) avisos.push(`Faixa ${ini}–${fim} ignorada por conflitar com nota já emitida ou faixa ativa.`);
        continue;
      }

      const just =
        il.justificativa.trim().length >= 15
          ? il.justificativa.trim().slice(0, 255)
          : "Numeração inutilizada migrada do sistema legado NKWAY";

      novos++;
      if (aplicar) {
        const [inserida] = await db
          .insert(inutilizacoes)
          .values({
            id: uuidDeterministico(empresaId, "inutilizacao", il.id),
            empresaId,
            modelo: il.modelo || "NFC-e",
            serie: il.serie || "1",
            numeroInicial: ini,
            numeroFinal: fim,
            justificativa: just,
            status: "homologado",
            protocolo: il.protocolo || `111${Date.now().toString().slice(-12)}`,
          })
          .returning();
        faixasAtuais.push(inserida);
        importadosPorModulo.eventos++;
      }
    }

    resumos.push({
      modulo: "eventos",
      rotulo: "MDF-e e Inutilizações",
      destino: "nk_mdfe + nk_inutilizacao",
      encontrados: pacote.mdfes.length + pacote.inutilizacoes.length,
      novos,
      ignoradosExistentes: ignorados,
      saneados,
      avisos,
    });
  }

  if (aplicar && precisaSalvarFiscal) {
    await db.update(empresas).set({ fiscal: fiscalAtualizado }).where(eq(empresas.id, empresaId));
  }

  const plano: PlanoMigracaoLegadoDto = {
    fonte,
    empresaOrigemNome: pacote.empresaOrigemNome,
    empresaOrigemCnpj: pacote.empresaOrigemCnpj,
    geradoEm: new Date().toISOString(),
    modulos: resumos,
    totalEncontrados: resumos.reduce((s, r) => s + r.encontrados, 0),
    totalNovos: resumos.reduce((s, r) => s + r.novos, 0),
    totalIgnorados: resumos.reduce((s, r) => s + r.ignoradosExistentes, 0),
    totalAvisos: resumos.reduce((s, r) => s + r.saneados, 0),
  };

  if (!aplicar) {
    if (!params.silenciarAuditoria) {
      await registrarAuditoria({
        empresaId,
        usuario,
        acao: "migracao.simular",
      entidade: "migracao_legado",
      registroId: fonte,
      resumo: `Simulação (dry-run) do legado (${fonte}): ${plano.totalNovos} novo(s) · ${plano.totalIgnorados} já existente(s)`,
      alteracoes: {
        fonte,
        totalEncontrados: plano.totalEncontrados,
        totalNovos: plano.totalNovos,
        totalIgnorados: plano.totalIgnorados,
      },
      });
    }
    return { plano, execucao: null };
  }

  const totalImportados = Object.values(importadosPorModulo).reduce((s, v) => s + v, 0);
  const todosAvisos = resumos.flatMap((r) => r.avisos).slice(0, 20);

  const execucao: ResultadoExecucaoMigracaoDto = {
    fonte,
    executadoEm: new Date().toISOString(),
    importadosPorModulo,
    totalImportados,
    totalIgnorados: plano.totalIgnorados,
    avisos: todosAvisos,
  };

  await registrarAuditoria({
    empresaId,
    usuario,
    acao: "migracao.executar",
    entidade: "migracao_legado",
    registroId: fonte,
    resumo: `Migração do legado (${fonte}) concluída: ${totalImportados} registro(s) importado(s) para nk_* · ${plano.totalIgnorados} duplicado(s) ignorado(s)`,
    alteracoes: {
      fonte,
      importadosPorModulo,
      totalImportados,
      totalIgnorados: plano.totalIgnorados,
      avisosCount: todosAvisos.length,
    },
  });

  return { plano, execucao };
}
