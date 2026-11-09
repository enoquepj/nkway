import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  assinaturaFaturas,
  assinaturas,
  auditorias,
  caixaMovimentos,
  caixaSessoes,
  clientes,
  contas,
  devolucoes,
  empresas,
  entradas,
  eventosFiscais,
  fornecedores,
  inutilizacoes,
  mdfes,
  movimentos,
  produtos,
  usuarios,
  vendaItens,
  vendas,
  parametrosFiscais,
  produtoTributacoes,
  type EntradaRow,
} from "@/db/schema";
import { CAMPOS_TRIBUTARIOS, PARAMETROS_TRIBUTARIOS_VAZIOS, type ParametrosTributarios, type RegimeFiscalPerfil } from "@/lib/tributacao";

function lerParametros(bruto: unknown): ParametrosTributarios {
  const fonte = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, unknown> : {};
  const resultado = { ...PARAMETROS_TRIBUTARIOS_VAZIOS };
  for (const campo of CAMPOS_TRIBUTARIOS) {
    const valor = fonte[campo];
    resultado[campo] = typeof valor === "string" || typeof valor === "number" ? String(valor) : "";
  }
  return resultado;
}

export type PerfilFiscalResumoDto = { id: string; nome: string; regime: RegimeFiscalPerfil; ativo: boolean; atualizadoEm: string; dados: ParametrosTributarios };
export type ComplementoProdutoDto = { perfilId: string | null; dados: ParametrosTributarios };

/** Etapa 3: perfis da própria empresa (ativos e inativos, para exibir vínculo histórico) — nunca de outra empresa. */
export async function listarPerfisFiscais(empresaId: string): Promise<PerfilFiscalResumoDto[]> {
  const linhas = await db.select().from(parametrosFiscais)
    .where(and(eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil")))
    .orderBy(asc(parametrosFiscais.nome));
  return linhas.map((p) => ({ id: p.id, nome: p.nome, regime: p.regime as RegimeFiscalPerfil, ativo: p.ativo, atualizadoEm: p.atualizadoEm ? p.atualizadoEm.toISOString() : "", dados: lerParametros(p.dados) }));
}

/** Etapa 3: vínculo atual de perfil por produto (complemento fiscal), somente da empresa da sessão. */
export async function listarComplementosFiscais(empresaId: string): Promise<Record<string, ComplementoProdutoDto>> {
  const linhas = await db.select().from(produtoTributacoes).where(eq(produtoTributacoes.empresaId, empresaId));
  return Object.fromEntries(linhas.map((c) => [c.produtoId, { perfilId: c.perfilId ?? null, dados: lerParametros(c.dados) }]));
}
import type { CicloAssinatura, FormaAssinatura, StatusAssinatura, StatusFaturaAssinatura } from "@/lib/assinatura";
import { apurarSessaoCaixa, aplicarSnapshotFechamento, type ApuracaoSessaoCaixa, type MovimentoCaixaInput } from "@/lib/caixa";
import { carregarInsumosSessoes } from "@/server/caixaCore";
import { padNsu, type DfePainelDados } from "@/lib/dfe";
import { diasAteTrial, planoById, round2, situacaoEstoque, soDigitos, validarCnpj, type SituacaoEstoque } from "@/lib/dominio";
import type { ProvedorEmissorFiscal, StatusSefazVenda } from "@/lib/emissorFiscal";
import { normalizarPerfil, temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import {
  resolverProtocoloOrigemVenda,
  resolverSituacaoFiscalVenda,
  type ProtocoloOrigemVenda,
  type SituacaoFiscalVenda,
} from "@/lib/situacaoFiscal";
import { diagnosticoGatewayServidor, type ProvedorGateway } from "@/server/assinaturaGateway";
import { ambienteDfeServidor, lerDocumentosDfeFiscal } from "@/server/dfeCore";
import { diagnosticoEmissorServidor } from "@/server/emissorFiscalCore";

const N = (v: unknown, dec = 2) => {
  const f = 10 ** dec;
  return Math.round((Number(v ?? 0) + Number.EPSILON) * f) / f;
};
const iso = (d: Date | string | null | undefined) =>
  d ? (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : "";

/* --------------------------------------------------------------- produtos */

export type ProdutoDto = {
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
  ativo: boolean;
  ncm: string;
  cfop: string;
  csosn: string;
  cest: string;
  lote: string;
  validade: string;
  localizacao: string;
  icmsAliq: number;
  situacao: SituacaoEstoque;
  margem: number;
  markup: number;
  lucro: number;
};

export async function listarProdutos(empresaId: string, apenasAtivos = false) {
  const linhas = await db
    .select()
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), apenasAtivos ? eq(produtos.ativo, true) : undefined))
    .orderBy(asc(produtos.nome));
  return linhas.map<ProdutoDto>((p) => {
    const custo = N(p.custo, 4);
    const preco = N(p.preco, 4);
    return {
      id: p.id,
      nome: p.nome,
      sku: p.sku,
      gtin: p.gtin,
      categoria: p.categoria,
      marca: p.marca,
      unidade: p.unidade,
      custo,
      preco,
      estoque: N(p.estoque, 3),
      estoqueMin: N(p.estoqueMin, 3),
      pesavel: p.pesavel,
      ativo: p.ativo,
      ncm: p.ncm,
      cfop: p.cfop,
      csosn: p.csosn,
      cest: p.cest,
      lote: p.lote,
      validade: p.validade ? iso(p.validade) : "",
      localizacao: p.localizacao,
      icmsAliq: N(p.icmsAliq),
      situacao: situacaoEstoque(N(p.estoque, 3), N(p.estoqueMin, 3)),
      margem: preco > 0 ? round2(((preco - custo) / preco) * 100) : 0,
      markup: custo > 0 ? round2((preco / custo - 1) * 100) : 0,
      lucro: round2(preco - custo),
    };
  });
}

/* --------------------------------------------------------------- clientes */

export async function listarClientes(empresaId: string) {
  const [linhas, historico, saldo, ultima] = await Promise.all([
    db.select().from(clientes).where(eq(clientes.empresaId, empresaId)).orderBy(asc(clientes.nome)),
    db
      .select({
        clienteId: vendas.clienteId,
        total: sql<string>`coalesce(sum(${vendas.total}),0)`,
        qtd: sql<string>`count(*)`,
      })
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), eq(vendas.status, "faturado"), sql`${vendas.clienteId} is not null`))
      .groupBy(vendas.clienteId),
    db
      .select({
        contraparteId: contas.contraparteId,
        nome: contas.contraparteNome,
        saldo: sql<string>`coalesce(sum(${contas.valor} - ${contas.valorPago}),0)`,
      })
      .from(contas)
      .where(and(eq(contas.empresaId, empresaId), eq(contas.tipo, "receber"), eq(contas.status, "aberta")))
      .groupBy(contas.contraparteId, contas.contraparteNome),
    db
      .select({ clienteId: vendas.clienteId, data: sql<string>`max(${vendas.data})` })
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), sql`${vendas.clienteId} is not null`))
      .groupBy(vendas.clienteId),
  ]);
  return linhas.map((c) => {
    const hist = historico.find((v) => v.clienteId === c.id);
    return {
      id: c.id,
      nome: c.nome,
      documento: c.documento,
      email: c.email ?? "",
      telefone: c.telefone ?? "",
      cidade: c.cidade ?? "",
      uf: c.uf ?? "",
      bairro: c.bairro ?? "",
      logradouro: c.logradouro ?? "",
      numero: c.numero ?? "",
      cep: c.cep ?? "",
      condicaoPadrao: c.condicaoPadrao,
      limiteCredito: N(c.limiteCredito),
      indIe: c.indIe ?? "9",
      observacao: c.observacao ?? "",
      totalComprado: N(hist?.total ?? "0"),
      qtdVendas: Number(hist?.qtd ?? 0),
      // vínculo por id: renomear o cliente não perde o histórico; nome só cobre títulos antigos sem id
      saldoEmAberto: N(
        saldo.find((s) => (s.contraparteId ? s.contraparteId === c.id : s.nome === c.nome))?.saldo ?? "0",
      ),
      ultimaCompra: iso(ultima.find((u) => u.clienteId === c.id)?.data),
    };
  });
}

export async function listarFornecedores(empresaId: string) {
  const [linhas, entradasRows] = await Promise.all([
    db.select().from(fornecedores).where(eq(fornecedores.empresaId, empresaId)).orderBy(asc(fornecedores.nome)),
    db
      .select({
        cnpj: entradas.cnpjFornecedor,
        total: sql<string>`coalesce(sum(${entradas.total}),0)`,
        qtd: sql<string>`count(*)`,
        ultima: sql<string>`max(${entradas.emissao})`,
      })
      .from(entradas)
      .where(eq(entradas.empresaId, empresaId))
      .groupBy(entradas.cnpjFornecedor),
  ]);
  return linhas.map((f) => {
    const doc = (f.cnpj ?? "").replace(/\D/g, "");
    const c = entradasRows.find((e) => doc && e.cnpj === doc);
    return {
      id: f.id,
      nome: f.nome,
      cnpj: f.cnpj,
      cidade: f.cidade ?? "",
      uf: f.uf ?? "",
      telefone: f.telefone ?? "",
      email: f.email ?? "",
      prazoPagDias: f.prazoPagDias,
      totalComprado: N(c?.total ?? "0"),
      qtdNotas: Number(c?.qtd ?? 0),
      ultimaNota: c?.ultima ? String(c.ultima).slice(0, 10) : "",
    };
  });
}

/* ----------------------------------------------------------------- vendas */

export type VendaDto = {
  id: string;
  numero: number;
  clienteNome: string;
  total: number;
  subtotal: number;
  desconto: number;
  vFrete: number;
  formaPagamento: string;
  pagamentos: { forma: string; valor: number }[];
  tipo: string;
  status: string;
  modelo: string | null;
  serie: string | null;
  numeroNota: number | null;
  chave: string | null;
  protocolo: string | null;
  protocoloOrigem: ProtocoloOrigemVenda;
  situacaoFiscal: SituacaoFiscalVenda;
  validade: string | null;
  observacao: string | null;
  operador: string | null;
  caixa: string;
  ambiente: string;
  origem: string;
  clienteId: string | null;
  davOrigemId: string | null;
  temXml: boolean;
  statusSefaz: StatusSefazVenda;
  cstatSefaz: string;
  motivoSefaz: string;
  emissorProvedor: ProvedorEmissorFiscal;
  data: string;
  itens: {
    produtoId?: string | null;
    gtin?: string | null;
    nome: string;
    qtd: number;
    precoUnit: number;
    total: number;
    unidade: string | null;
  }[];
  eventos: { id: string; tipo: string; sequencia: number; descricao: string; protocolo: string; em: string }[];
};

export type FiltroListarVendas = {
  tipo?: "fiscal" | "dav" | "sem_nota" | "todos" | "";
  ids?: string[];
  busca?: string;
  inicio?: string;
  fim?: string;
  situacao?: string;
  pagina?: number;
  tamanhoPagina?: number;
};

function montarCondicoesVendas(empresaId: string, filtro?: FiltroListarVendas): SQL[] | null {
  const condicoes: SQL[] = [eq(vendas.empresaId, empresaId)];

  if (filtro?.tipo && filtro.tipo !== "todos") {
    condicoes.push(eq(vendas.tipo, filtro.tipo));
  }
  if (filtro?.ids) {
    if (filtro.ids.length === 0) return null;
    condicoes.push(inArray(vendas.id, filtro.ids));
  }
  if (filtro?.inicio && /^\d{4}-\d{2}-\d{2}$/.test(filtro.inicio)) {
    condicoes.push(sql`${vendas.data} >= (${filtro.inicio}::date)`);
  }
  if (filtro?.fim && /^\d{4}-\d{2}-\d{2}$/.test(filtro.fim)) {
    condicoes.push(sql`${vendas.data} < (${filtro.fim}::date + interval '1 day')`);
  }

  const sit = String(filtro?.situacao ?? "").trim();
  if (sit && sit !== "todas" && sit !== "todos") {
    if (sit === "aberto" || sit === "faturado" || sit === "cancelado") {
      condicoes.push(eq(vendas.status, sit));
    } else if (sit === "cancelada") {
      condicoes.push(or(eq(vendas.status, "cancelado"), eq(vendas.statusSefaz, "cancelada_sefaz"))!);
    } else if (sit === "autorizada") {
      condicoes.push(
        and(
          ne(vendas.status, "cancelado"),
          or(
            and(eq(vendas.situacaoFiscal, "autorizada"), eq(vendas.protocoloOrigem, "autorizado_sefaz")),
            and(isNull(vendas.situacaoFiscal), eq(vendas.statusSefaz, "autorizada"), sql`coalesce(${vendas.protocolo}, '') <> ''`),
          ),
        )!,
      );
    } else if (sit === "pendente_transmissao") {
      condicoes.push(
        and(
          ne(vendas.status, "cancelado"),
          or(
            eq(vendas.situacaoFiscal, "pendente_transmissao"),
            and(isNull(vendas.situacaoFiscal), inArray(vendas.statusSefaz, ["pendente_envio", "contingencia"])),
          ),
        )!,
      );
    } else if (sit === "simulado") {
      condicoes.push(
        and(
          ne(vendas.status, "cancelado"),
          eq(vendas.tipo, "fiscal"),
          or(
            eq(vendas.situacaoFiscal, "simulado"),
            and(isNull(vendas.situacaoFiscal), eq(vendas.statusSefaz, "simulado")),
          ),
        )!,
      );
    } else if (sit === "nao_emitida") {
      condicoes.push(
        and(
          ne(vendas.status, "cancelado"),
          or(eq(vendas.situacaoFiscal, "nao_emitida"), inArray(vendas.tipo, ["dav", "sem_nota"])),
        )!,
      );
    } else if (sit === "rejeitada") {
      condicoes.push(
        and(
          ne(vendas.status, "cancelado"),
          or(eq(vendas.situacaoFiscal, "rejeitada"), eq(vendas.statusSefaz, "rejeitada")),
        )!,
      );
    }
  }

  const termoBruto = String(filtro?.busca ?? "").trim();
  if (termoBruto) {
    const digitos = soDigitos(termoBruto);
    const padraoTexto = `%${termoBruto}%`;
    const clausulasBusca: SQL[] = [
      sql`${vendas.clienteNome} ilike ${padraoTexto}`,
      sql`coalesce(${vendas.protocolo}, '') ilike ${padraoTexto}`,
      sql`coalesce(${vendas.chave}, '') ilike ${padraoTexto}`,
      sql`cast(${vendas.numero} as text) = ${termoBruto}`,
      sql`cast(coalesce(${vendas.numeroNota}, -1) as text) = ${termoBruto}`,
      sql`exists (
        select 1 from nk_cliente c
        where c.empresa_id = ${empresaId}
          and c.id = ${vendas.clienteId}
          and c.nome ilike ${padraoTexto}
      )`,
    ];

    if (digitos.length > 0) {
      if (digitos.length <= 9) {
        clausulasBusca.push(sql`cast(${vendas.numero} as text) = ${digitos}`);
        clausulasBusca.push(sql`cast(coalesce(${vendas.numeroNota}, -1) as text) = ${digitos}`);
      }
      if (digitos.length >= 4) {
        clausulasBusca.push(
          sql`regexp_replace(coalesce(${vendas.chave}, ''), '\\D', '', 'g') like ${`%${digitos}%`}`,
        );
        clausulasBusca.push(
          sql`regexp_replace(coalesce(${vendas.protocolo}, ''), '\\D', '', 'g') like ${`%${digitos}%`}`,
        );
      }
      if (digitos.length >= 3) {
        clausulasBusca.push(
          sql`exists (
            select 1 from nk_cliente c
            where c.empresa_id = ${empresaId}
              and (c.id = ${vendas.clienteId} or upper(c.nome) = upper(${vendas.clienteNome}))
              and regexp_replace(coalesce(c.documento, ''), '\\D', '', 'g') like ${`%${digitos}%`}
          )`,
        );
      }
    }

    condicoes.push(or(...clausulasBusca)!);
  }

  return condicoes;
}

export async function listarVendas(empresaId: string, filtro?: FiltroListarVendas) {
  const condicoes = montarCondicoesVendas(empresaId, filtro);
  if (!condicoes) return [];

  const usarPaginacao =
    (filtro?.pagina !== undefined && filtro.pagina > 0) ||
    (filtro?.tamanhoPagina !== undefined && filtro.tamanhoPagina > 0);

  const pagina = Math.max(1, Math.floor(Number(filtro?.pagina ?? 1) || 1));
  const tamanhoPagina = Math.min(200, Math.max(1, Math.floor(Number(filtro?.tamanhoPagina ?? 20) || 20)));

  const queryBase = db
    .select()
    .from(vendas)
    .where(and(...condicoes))
    .orderBy(desc(vendas.data), desc(vendas.numero));

  const linhas = usarPaginacao
    ? await queryBase.limit(tamanhoPagina).offset((pagina - 1) * tamanhoPagina)
    : await queryBase;

  const ids = linhas.map((l) => l.id);
  const itens = ids.length ? await db.select().from(vendaItens).where(inArray(vendaItens.vendaId, ids)) : [];
  const evs = ids.length
    ? await db
        .select()
        .from(eventosFiscais)
        .where(and(eq(eventosFiscais.empresaId, empresaId), inArray(eventosFiscais.vendaId, ids)))
    : [];
  const eventosPorVenda = new Map<string, typeof evs>();
  for (const e of evs) {
    const l = eventosPorVenda.get(e.vendaId);
    if (l) l.push(e);
    else eventosPorVenda.set(e.vendaId, [e]);
  }
  return linhas.map<VendaDto>((v) => ({
    id: v.id,
    numero: v.numero,
    clienteNome: v.clienteNome,
    total: N(v.total),
    subtotal: N(v.subtotal),
    desconto: N(v.desconto),
    vFrete: N(v.vFrete),
    formaPagamento: v.formaPagamento,
    pagamentos: (v.pagamentos ?? []) as { forma: string; valor: number }[],
    tipo: v.tipo,
    status: v.status,
    modelo: v.modelo,
    serie: v.serie,
    numeroNota: v.numeroNota,
    chave: v.chave,
    protocolo: v.protocolo,
    protocoloOrigem: resolverProtocoloOrigemVenda(v),
    situacaoFiscal: resolverSituacaoFiscalVenda(v),
    validade: iso(v.validade),
    observacao: v.observacao,
    operador: v.operador,
    caixa: v.caixa ?? "",
    ambiente: v.ambiente ?? "2",
    origem: v.origem ?? "pdv",
    clienteId: v.clienteId,
    davOrigemId: v.davOrigemId,
    temXml: Boolean(v.xmlFiscal && /<\s*(?:nfeProc|NFe|infNFe|CFe)\b/i.test(v.xmlFiscal)),
    statusSefaz: (v.status === "cancelado"
      ? "cancelada_sefaz"
      : (v.statusSefaz as StatusSefazVenda) || "simulado") as StatusSefazVenda,
    cstatSefaz: v.cstatSefaz || (v.status === "cancelado" ? "135" : "100"),
    motivoSefaz: v.motivoSefaz || "",
    emissorProvedor: ((v.emissorProvedor as ProvedorEmissorFiscal) || "local") as ProvedorEmissorFiscal,
    eventos: (eventosPorVenda.get(v.id) ?? [])
      .sort((a, b) => a.sequencia - b.sequencia)
      .map((e) => ({
        id: e.id,
        tipo: e.tipo,
        sequencia: e.sequencia,
        descricao: e.descricao,
        protocolo: e.protocolo ?? "",
        em: e.createdAt ? new Date(e.createdAt).toISOString() : "",
      })),
    data: v.data ? new Date(v.data).toISOString() : "",
    itens: itens
      .filter((i) => i.vendaId === v.id)
      .map((i) => ({
        produtoId: i.produtoId,
        gtin: i.gtin,
        nome: i.nome,
        qtd: N(i.qtd, 3),
        precoUnit: N(i.precoUnit, 4),
        total: N(i.total),
        unidade: i.unidade,
      })),
  }));
}

export async function listarVendasPaginado(
  empresaId: string,
  filtro?: FiltroListarVendas,
): Promise<{
  itens: VendaDto[];
  total: number;
  pagina: number;
  tamanhoPagina: number;
  totalPaginas: number;
}> {
  const pagina = Math.max(1, Math.floor(Number(filtro?.pagina ?? 1) || 1));
  const tamanhoPagina = Math.min(100, Math.max(1, Math.floor(Number(filtro?.tamanhoPagina ?? 15) || 15)));
  const condicoes = montarCondicoesVendas(empresaId, filtro);
  if (!condicoes) {
    return { itens: [], total: 0, pagina: 1, tamanhoPagina, totalPaginas: 1 };
  }

  const [contagem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(vendas)
    .where(and(...condicoes));

  const total = Number(contagem?.n ?? 0);
  const totalPaginas = Math.max(1, Math.ceil(total / tamanhoPagina));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const itens = await listarVendas(empresaId, {
    ...filtro,
    pagina: paginaSegura,
    tamanhoPagina,
  });

  return {
    itens,
    total,
    pagina: paginaSegura,
    tamanhoPagina,
    totalPaginas,
  };
}

/* --------------------------------------------------------------- entradas */

export async function listarEntradas(empresaId: string) {
  const linhas: EntradaRow[] = await db
    .select()
    .from(entradas)
    .where(eq(entradas.empresaId, empresaId))
    .orderBy(desc(entradas.emissao), desc(entradas.createdAt));
  return linhas.map((e) => ({
    id: e.id,
    numeroNota: e.numeroNota,
    serie: e.serie,
    chave: e.chave,
    fornecedor: e.fornecedor,
    cnpjFornecedor: e.cnpjFornecedor,
    fornecedorId: e.fornecedorId,
    emissao: iso(e.emissao),
    createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : "",
    valorProdutos: N(e.valorProdutos),
    valorFrete: N(e.valorFrete),
    total: N(e.total),
    status: e.status,
    origem: e.origem,
    gerarFinanceiro: e.gerarFinanceiro,
    observacao: e.observacao ?? "",
    itens: (e.itens ?? []).map((i) => ({
      produtoId: i.produtoId,
      nome: i.nome,
      nomeFornecedor: i.nomeFornecedor ?? "",
      sku: i.sku,
      ncm: i.ncm,
      cfop: i.cfop,
      unidade: i.unidade,
      gtin: i.gtin ?? "",
      qtd: N(i.qtd, 3),
      qtdNota: N(i.qtdNota, 3),
      custo: N(i.custo, 4),
      preco: N(i.preco, 4),
    })),
  }));
}

/* ---------------------------------------------------------------- estoque */

export async function listarKardex(empresaId: string, produtoId?: string) {
  const linhas = await db
    .select()
    .from(movimentos)
    .where(and(eq(movimentos.empresaId, empresaId), produtoId ? eq(movimentos.produtoId, produtoId) : undefined))
    .orderBy(desc(movimentos.data))
    .limit(produtoId ? 2000 : 1500);
  return linhas.map((m) => ({
    id: m.id,
    produtoId: m.produtoId,
    produtoNome: m.produtoNome,
    tipo: m.tipo,
    qtd: N(m.qtd, 3),
    saldoApos: N(m.saldoApos, 3),
    custoUnit: N(m.custoUnit, 4),
    custoMedioApos: N(m.custoMedioApos, 4),
    documento: m.documento ?? "",
    observacao: m.observacao ?? "",
    usuarioNome: m.usuarioNome ?? "",
    data: m.data ? new Date(m.data).toISOString() : "",
  }));
}

/** Saídas por venda nos últimos 30/90 dias por produto (vendas válidas: não canceladas e fora de DAV orçamento). */
export async function vendasPorProdutoRecentes(empresaId: string): Promise<{ produtoId: string; qtd30: number; qtd90: number; valor90: number; ultimaVenda: string | null }[]> {
  const linhas = await db
    .select({
      produtoId: vendaItens.produtoId,
      qtd30: sql<string>`coalesce(sum(case when ${vendas.data} >= now() - interval '30 days' then ${vendaItens.qtd} else 0 end), 0)`,
      qtd90: sql<string>`coalesce(sum(${vendaItens.qtd}), 0)`,
      valor90: sql<string>`coalesce(sum(${vendaItens.total}), 0)`,
      ultimaVenda: sql<string | null>`max(${vendas.data})`,
    })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
    .where(and(
      eq(vendas.empresaId, empresaId),
      sql`${vendas.data} >= now() - interval '90 days'`,
      sql`lower(${vendas.status}) <> 'cancelado'`,
      // DAV (orçamento) nunca baixa estoque; ao faturar, a venda filha (davOrigemId) é quem registra a saída.
      sql`${vendas.tipo} <> 'dav'`,
      sql`${vendaItens.produtoId} is not null`,
    ))
    .groupBy(vendaItens.produtoId);
  return linhas.filter((l) => l.produtoId).map((l) => ({
    produtoId: l.produtoId as string, qtd30: N(l.qtd30, 3), qtd90: N(l.qtd90, 3), valor90: N(l.valor90, 2),
    ultimaVenda: l.ultimaVenda ? new Date(l.ultimaVenda).toISOString() : null,
  }));
}

export async function posicaoEstoque(empresaId: string) {
  const [lista, ultimos] = await Promise.all([
    listarProdutos(empresaId),
    db
      .select({ produtoId: movimentos.produtoId, custo: movimentos.custoMedioApos })
      .from(movimentos)
      .where(and(eq(movimentos.empresaId, empresaId), sql`${movimentos.custoMedioApos} > 0`))
      .orderBy(desc(movimentos.data))
      .limit(4000),
  ]);
  const ultimo = new Map<string, number>();
  for (const c of ultimos) if (!ultimo.has(c.produtoId)) ultimo.set(c.produtoId, N(c.custo, 4));
  return lista.map((p) => {
    const custoMedio = ultimo.get(p.id) ?? p.custo;
    return {
      ...p,
      custoMedio,
      valorTotal: round2(custoMedio * p.estoque),
      valorVenda: round2(p.preco * p.estoque),
      girou: ultimo.has(p.id),
    };
  });
}

/* -------------------------------------------------------------- financeiro */

export async function listarContas(empresaId: string) {
  const linhas = await db.select().from(contas).where(eq(contas.empresaId, empresaId)).orderBy(asc(contas.vencimento));
  const hoje = new Date().toISOString().slice(0, 10);
  return linhas.map((c) => ({
    id: c.id,
    tipo: c.tipo,
    descricao: c.descricao,
    categoria: c.categoria,
    contraparteNome: c.contraparteNome ?? "",
    valor: N(c.valor),
    valorPago: N(c.valorPago),
    saldo: round2(N(c.valor) - N(c.valorPago)),
    vencimento: iso(c.vencimento),
    pagoEm: iso(c.pagoEm),
    status: c.status,
    forma: c.forma ?? "",
    atrasada: c.status === "aberta" && iso(c.vencimento) < hoje,
  }));
}

/* ------------------------------------------------------------------ MDF-e */

export async function listarMdfes(empresaId: string) {
  const linhas = await db.select().from(mdfes).where(eq(mdfes.empresaId, empresaId)).orderBy(desc(mdfes.emitidoEm));
  return linhas.map((m) => ({
    id: m.id,
    numero: m.numero,
    serie: m.serie,
    chave: m.chave,
    protocolo: m.protocolo ?? "",
    ufInicio: m.ufInicio,
    ufFim: m.ufFim,
    municipioCarregamento: m.municipioCarregamento ?? "",
    municipioDescarregamento: m.municipioDescarregamento ?? "",
    placa: m.placa,
    rntrc: m.rntrc ?? "",
    condutor: m.condutor ?? "",
    cpfCondutor: m.cpfCondutor ?? "",
    pesoBruto: N(m.pesoBruto, 3),
    valorCarga: N(m.valorCarga),
    status: m.status,
    emitidoEm: m.emitidoEm ? new Date(m.emitidoEm).toISOString() : "",
    encerradoEm: m.encerradoEm ? new Date(m.encerradoEm).toISOString() : "",
    documentos: (m.documentos ?? []) as { chave: string; tipo: string; valor: number }[],
  }));
}

/* -------------------------------------------------------------- dashboard */

export async function painel(empresaId: string) {
  const inicioDia = new Date();
  inicioDia.setHours(0, 0, 0, 0);
  const em14 = new Date(inicioDia);
  em14.setDate(em14.getDate() - 13);
  const hoje = new Date().toISOString().slice(0, 10);

  const [notas, davs, contasAbertas, alertas, contagem, ultimas, topProdutos] = await Promise.all([
    db
      .select()
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), eq(vendas.status, "faturado"), gte(vendas.data, em14))),
    db
      .select({
        id: vendas.id,
        total: vendas.total,
        validade: vendas.validade,
        cliente: vendas.clienteNome,
        numero: vendas.numero,
      })
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), eq(vendas.tipo, "dav"), eq(vendas.status, "aberto"))),
    db.select().from(contas).where(and(eq(contas.empresaId, empresaId), eq(contas.status, "aberta"))),
    db
      .select({
        id: produtos.id,
        nome: produtos.nome,
        estoque: produtos.estoque,
        minimo: produtos.estoqueMin,
        sku: produtos.sku,
        preco: produtos.preco,
      })
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true), sql`${produtos.estoque} <= ${produtos.estoqueMin}`))
      .orderBy(asc(produtos.estoque))
      .limit(8),
    db.select({ n: sql<string>`count(*)` }).from(produtos).where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true))),
    db
      .select({
        id: vendas.id,
        numero: vendas.numero,
        total: vendas.total,
        data: vendas.data,
        cliente: vendas.clienteNome,
        tipo: vendas.tipo,
        numeroNota: vendas.numeroNota,
        modelo: vendas.modelo,
        status: vendas.status,
        forma: vendas.formaPagamento,
      })
      .from(vendas)
      .where(eq(vendas.empresaId, empresaId))
      .orderBy(desc(vendas.data))
      .limit(8),
    db
      .select({ nome: vendaItens.nome, qtd: sql<string>`sum(${vendaItens.qtd})`, total: sql<string>`sum(${vendaItens.total})` })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
      .where(and(eq(vendas.empresaId, empresaId), gte(vendas.data, em14), eq(vendas.status, "faturado")))
      .groupBy(vendaItens.nome)
      .orderBy(desc(sql`sum(${vendaItens.total})`))
      .limit(6),
  ]);

  const porDia = new Map<string, { vendas: number; total: number }>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(em14);
    d.setDate(d.getDate() + i);
    porDia.set(d.toISOString().slice(0, 10), { vendas: 0, total: 0 });
  }
  let hojeTotal = 0;
  let hojeVendas = 0;
  for (const v of notas) {
    const d = iso(v.data);
    const balde = porDia.get(d);
    if (balde) {
      balde.total += N(v.total);
      balde.vendas += 1;
    }
    if (d === hoje) {
      hojeTotal += N(v.total);
      hojeVendas += 1;
    }
  }
  const totalPeriodo = round2(notas.reduce((s, v) => s + N(v.total), 0));
  const receber = contasAbertas.filter((c) => c.tipo === "receber");
  const pagar = contasAbertas.filter((c) => c.tipo === "pagar");
  const vencidas = contasAbertas.filter((c) => iso(c.vencimento) < hoje);
  const soma = (l: typeof contasAbertas) => round2(l.reduce((s, c) => s + N(c.valor) - N(c.valorPago), 0));

  return {
    kpis: {
      hojeTotal: round2(hojeTotal),
      hojeVendas,
      totalPeriodo,
      ticket: notas.length ? round2(totalPeriodo / notas.length) : 0,
      numeroVendas: notas.length,
      produtosAtivos: Number(contagem[0]?.n ?? 0),
      davsAbertos: davs.length,
      davsVencendo: davs.filter((d) => iso(d.validade) && iso(d.validade) <= hoje).length,
      aReceber: soma(receber),
      aPagar: soma(pagar),
      vencidas: vencidas.length,
      saldoCaixa: round2(soma(receber) - soma(pagar)),
    },
    serie: [...porDia.entries()].map(([dia, v]) => ({ dia, total: round2(v.total), vendas: v.vendas })),
    topProdutos: topProdutos.map((t) => ({ nome: t.nome, qtd: N(t.qtd, 3), total: N(t.total) })),
    alertasEstoque: alertas.map((a) => ({
      id: a.id,
      nome: a.nome,
      sku: a.sku,
      estoque: N(a.estoque, 3),
      minimo: N(a.minimo, 3),
      preco: N(a.preco),
      situacao: situacaoEstoque(N(a.estoque, 3), N(a.minimo, 3)),
    })),
    davsAbertos: davs.map((d) => ({ id: d.id, numero: d.numero, cliente: d.cliente, total: N(d.total), validade: iso(d.validade) })),
    contasVencidas: vencidas.slice(0, 6).map((c) => ({
      id: c.id,
      descricao: c.descricao,
      tipo: c.tipo,
      valor: round2(N(c.valor) - N(c.valorPago)),
      vencimento: iso(c.vencimento),
      contraparte: c.contraparteNome ?? "",
    })),
    ultimosDocumentos: ultimas.map((v) => ({
      id: v.id,
      numero: v.numero,
      total: N(v.total),
      data: v.data ? new Date(v.data).toISOString() : "",
      cliente: v.cliente,
      tipo: v.tipo,
      numeroNota: v.numeroNota,
      modelo: v.modelo,
      status: v.status,
      forma: v.forma,
    })),
  };
}

export type Painel = Awaited<ReturnType<typeof painel>>;

/** curva ABC por faturamento no período */
export async function curvaAbc(empresaId: string, inicio: string, fim: string) {
  const linhas = await db
    .select({ nome: vendaItens.nome, qtd: sql<string>`sum(${vendaItens.qtd})`, total: sql<string>`sum(${vendaItens.total})` })
    .from(vendaItens)
    .innerJoin(vendas, eq(vendas.id, vendaItens.vendaId))
    .where(
      and(
        eq(vendas.empresaId, empresaId),
        eq(vendas.status, "faturado"),
        gte(vendas.data, new Date(`${inicio}T00:00:00`)),
        sql`${vendas.data} < ${new Date(`${fim}T00:00:00`)} + interval '1 day'`,
      ),
    )
    .groupBy(vendaItens.nome)
    .orderBy(desc(sql`sum(${vendaItens.total})`));
  const totalGeral = round2(linhas.reduce((s, l) => s + N(l.total), 0)) || 1;
  let acumulado = 0;
  return linhas.map((l) => {
    const total = N(l.total);
    acumulado += total;
    return {
      nome: l.nome,
      qtd: N(l.qtd, 3),
      total,
      participacao: round2((total / totalGeral) * 100),
      acumuladoPart: round2((acumulado / totalGeral) * 100),
      classe: (acumulado / totalGeral <= 0.8 ? "A" : acumulado / totalGeral <= 0.95 ? "B" : "C") as "A" | "B" | "C",
    };
  });
}

export async function listarCategorias(empresaId: string) {
  const r = await db
    .selectDistinct({ categoria: produtos.categoria })
    .from(produtos)
    .where(eq(produtos.empresaId, empresaId));
  return r.map((x) => x.categoria).filter((c) => !!c);
}

/** numeração fiscal: próxima nota livre saltando inutilizadas */
export async function proximaNumero(empresaId: string) {
  const [r] = await db
    .select({ n: sql<string>`coalesce(max(${vendas.numeroNota}), 0)` })
    .from(vendas)
    .where(and(eq(vendas.empresaId, empresaId), sql`${vendas.numeroNota} is not null`));
  return Number(r?.n ?? 0) + 1;
}

export const _aux = { isNull, or, sql };

/* ------------------------------------------------------------ devoluções */

export type DevolucaoDto = {
  id: string;
  numero: number;
  serie: string;
  chave: string;
  chaveReferente: string;
  entradaId: string | null;
  fornecedor: string;
  cnpjFornecedor: string;
  cfop: string;
  emissao: string;
  valorProdutos: number;
  total: number;
  status: string;
  motivo: string;
  itens: { produtoId: string | null; nome: string; unidade: string; ncm: string; cfop: string; qtd: number; custo: number; total: number }[];
};

export async function listarDevolucoes(empresaId: string) {
  const linhas = await db
    .select()
    .from(devolucoes)
    .where(eq(devolucoes.empresaId, empresaId))
    .orderBy(desc(devolucoes.numero));
  return linhas.map<DevolucaoDto>((d) => ({
    id: d.id,
    numero: d.numero,
    serie: d.serie,
    chave: d.chave,
    chaveReferente: d.chaveReferente,
    entradaId: d.entradaId,
    fornecedor: d.fornecedor,
    cnpjFornecedor: d.cnpjFornecedor,
    cfop: d.cfop,
    emissao: iso(d.emissao),
    valorProdutos: N(d.valorProdutos),
    total: N(d.total),
    status: d.status,
    motivo: d.motivo ?? "",
    itens: (d.itens ?? []).map((i) => ({
      produtoId: i.produtoId,
      nome: i.nome,
      unidade: i.unidade,
      ncm: i.ncm,
      cfop: i.cfop,
      qtd: N(i.qtd, 3),
      custo: N(i.custo, 4),
      total: N(i.total),
    })),
  }));
}

/** entradas lançadas e elegíveis a devolução */
export async function listarEntradasDevolviveis(empresaId: string) {
  const linhas = await db
    .select()
    .from(entradas)
    .where(and(eq(entradas.empresaId, empresaId), eq(entradas.status, "lancada")))
    .orderBy(desc(entradas.emissao));
  const feitas = await db.select({ entradaId: devolucoes.entradaId, itens: devolucoes.itens }).from(devolucoes).where(eq(devolucoes.empresaId, empresaId));
  const ja = new Map<string, number>();
  for (const f of feitas) for (const i of f.itens ?? []) if (i.produtoId) ja.set(i.produtoId, round2((ja.get(i.produtoId) ?? 0) + i.qtd));
  return linhas.map((e) => {
    const itens = (e.itens ?? []).map((i) => ({ ...i, disponivel: round2(Math.max(0, i.qtdNota - (i.produtoId ? ja.get(i.produtoId) ?? 0 : 0))) }));
    return {
      id: e.id,
      numeroNota: e.numeroNota,
      serie: e.serie,
      chave: e.chave,
      fornecedor: e.fornecedor,
      cnpjFornecedor: e.cnpjFornecedor,
      emissao: iso(e.emissao),
      total: N(e.total),
      itens,
      podeDevolver: itens.some((i) => i.disponivel > 0),
    };
  });
}

/* -------------------------------------------------- numeração e eventos */

export type InutilizacaoDto = {
  id: string;
  modelo: string;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  status: string;
  protocolo: string;
  em: string;
};

export async function listarInutilizacoes(empresaId: string) {
  const linhas = await db
    .select()
    .from(inutilizacoes)
    .where(eq(inutilizacoes.empresaId, empresaId))
    .orderBy(desc(inutilizacoes.createdAt));
  return linhas.map<InutilizacaoDto>((i) => ({
    id: i.id,
    modelo: i.modelo,
    serie: i.serie,
    numeroInicial: i.numeroInicial,
    numeroFinal: i.numeroFinal,
    justificativa: i.justificativa,
    status: i.status,
    protocolo: i.protocolo ?? "",
    em: i.createdAt ? new Date(i.createdAt).toISOString() : "",
  }));
}

/** próximo número fiscal disponível, pulando os intervalos inutilizados */
export async function proximoNumeroFiscal(empresaId: string, modelo: string, serie: string) {
  const [r] = await db
    .select({ n: sql<string | null>`max(${vendas.numeroNota})` })
    .from(vendas)
    .where(and(eq(vendas.empresaId, empresaId), eq(vendas.tipo, "fiscal"), eq(vendas.modelo, modelo), eq(vendas.serie, serie)));
  let candidato = Number(r?.n ?? 0) + 1;
  const faixas = await db
    .select({ i: inutilizacoes.numeroInicial, f: inutilizacoes.numeroFinal, st: inutilizacoes.status })
    .from(inutilizacoes)
    .where(and(eq(inutilizacoes.empresaId, empresaId), eq(inutilizacoes.modelo, modelo), eq(inutilizacoes.serie, serie)));
  const ativas = faixas.filter((x) => x.st !== "cancelado");
  for (let volta = 0; volta < 200; volta++) {
    const dentro = ativas.find((x) => candidato >= x.i && candidato <= x.f);
    if (!dentro) break;
    candidato = dentro.f + 1;
  }
  return candidato;
}

export async function listarProximoNumero(empresaId: string, modelo = "NFC-e", serie = "1") {
  return proximoNumeroFiscal(empresaId, modelo, serie);
}

/* ------------------------------------------- DF-e / Certificado A1 (SEFAZ) */

export async function obterPainelDfe(empresaId: string): Promise<DfePainelDados> {
  const [[emp], ents] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    db
      .select({ id: entradas.id, chave: entradas.chave })
      .from(entradas)
      .where(eq(entradas.empresaId, empresaId)),
  ]);

  const fiscal = (emp?.fiscal ?? {}) as Record<string, unknown>;
  const env = ambienteDfeServidor();
  const certPath = String(fiscal.dfeCertPath ?? "");
  const temSenha = Boolean(fiscal.dfeSenhaCifrada);
  const temPfxCofre = Boolean(fiscal.dfePfxCifrado);
  const temCertificado = Boolean(temSenha && (certPath || temPfxCofre));

  const armazenamentoCert: "bucket" | "cofre" | "nenhum" = !temCertificado
    ? "nenhum"
    : certPath.startsWith("bucket://")
      ? "bucket"
      : "cofre";

  const modoEfetivo: "live" | "demo" =
    env.modoLiveSolicitado && temCertificado && (env.workerConfigurado || env.modoEnv === "direct")
      ? "live"
      : "demo";

  const porChave = new Map<string, string>();
  for (const e of ents) {
    if (e.chave) porChave.set(e.chave, e.id);
  }

  const docs = lerDocumentosDfeFiscal(fiscal, true).map((d) => {
    const entradaExistente = d.chave ? porChave.get(d.chave) : undefined;
    return {
      ...d,
      xmlZip: undefined,
      importadoErp: Boolean(d.importadoErp || entradaExistente),
      entradaId: entradaExistente ?? d.entradaId ?? null,
    };
  });

  const ultimoNsu = padNsu(String(fiscal.dfeUltimoNsu ?? "0"));
  const maxNsu = padNsu(String(fiscal.dfeMaxNsu ?? ultimoNsu));

  return {
    empresaCnpj: emp?.cnpj ?? "",
    empresaNome: emp?.nome ?? "",
    empresaUf: emp?.uf ?? "RO",
    ambiente: (Number(fiscal.ambiente ?? 2) === 1 ? 1 : 2) as 1 | 2,
    ativo: fiscal.dfeAtivo !== false,
    modoEfetivo,
    workerConfigurado: env.workerConfigurado,
    bucketConfigurado: env.bucketConfigurado,
    cronSecretConfigurado: env.cronSecretConfigurado,
    temCertificado,
    armazenamentoCert,
    certificadoPath: certPath,
    certificadoNome: String(fiscal.certificadoNome ?? ""),
    certificadoValidade: String(fiscal.certificadoValidade ?? ""),
    certificadoSerial: String(fiscal.certificadoSerial ?? ""),
    certificadoCnpj: String(fiscal.dfeCertCnpj ?? ""),
    ultimoNsu,
    maxNsu,
    ultimaConsultaEm: fiscal.dfeUltimaConsultaEm ? String(fiscal.dfeUltimaConsultaEm) : null,
    ultimoCstat: String(fiscal.dfeUltimoCstat ?? ""),
    ultimoXmotivo: String(fiscal.dfeUltimoXmotivo ?? ""),
    documentos: docs,
  };
}

/* ------------------------------------------- usuários, perfis e auditoria */

export type UsuarioDto = {
  id: string;
  nome: string;
  email: string;
  papel: PerfilUsuario;
  papelOriginal: string;
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
};

export type AuditoriaDto = {
  id: string;
  usuarioId: string | null;
  usuarioNome: string;
  usuarioPapel: string;
  acao: string;
  entidade: string;
  registroId: string;
  resumo: string;
  alteracoes: Record<string, unknown>;
  criadoEm: string;
};

export async function listarUsuarios(empresaId: string): Promise<UsuarioDto[]> {
  const linhas = await db
    .select({
      id: usuarios.id,
      nome: usuarios.nome,
      email: usuarios.email,
      papel: usuarios.papel,
      ativo: usuarios.ativo,
      createdAt: usuarios.createdAt,
      atualizadoEm: usuarios.atualizadoEm,
    })
    .from(usuarios)
    .where(eq(usuarios.empresaId, empresaId))
    .orderBy(asc(usuarios.nome));

  return linhas.map((u) => ({
    id: u.id,
    nome: u.nome,
    email: u.email,
    papel: normalizarPerfil(u.papel),
    papelOriginal: u.papel,
    ativo: u.ativo !== false,
    criadoEm: u.createdAt ? new Date(u.createdAt).toISOString() : "",
    atualizadoEm: u.atualizadoEm ? new Date(u.atualizadoEm).toISOString() : "",
  }));
}

export async function listarAuditorias(empresaId: string, limite = 300): Promise<AuditoriaDto[]> {
  const linhas = await db
    .select()
    .from(auditorias)
    .where(eq(auditorias.empresaId, empresaId))
    .orderBy(desc(auditorias.createdAt))
    .limit(limite);

  return linhas.map((a) => ({
    id: a.id,
    usuarioId: a.usuarioId,
    usuarioNome: a.usuarioNome,
    usuarioPapel: a.usuarioPapel,
    acao: a.acao,
    entidade: a.entidade,
    registroId: a.registroId,
    resumo: a.resumo,
    alteracoes: (a.alteracoes ?? {}) as Record<string, unknown>,
    criadoEm: a.createdAt ? new Date(a.createdAt).toISOString() : "",
  }));
}

/* ------------------------------------------- sessões e fechamento de caixa */

export type CaixaSessaoDto = {
  id: string;
  numero: number;
  terminal: string;
  operadorId: string;
  operadorNome: string;
  status: "aberto" | "fechado";
  saldoInicial: number;
  apuracao: Omit<ApuracaoSessaoCaixa, "classificacoes">;
  movimentos: MovimentoCaixaInput[];
  valoresEsperados: Record<string, number>;
  valoresInformados: Record<string, number>;
  diferencas: Record<string, number>;
  totalEsperado: number;
  totalInformado: number;
  diferencaTotal: number;
  observacaoAbertura: string;
  justificativaFechamento: string;
  abertoEm: string;
  fechadoEm: string;
  fechadoPorNome: string;
  reabertoEm: string;
  reabertoPorNome: string;
  /** Etapa 1: aprovação de quebra e fundo de troco (opcionais para sessões antigas) */
  statusAprovacao?: string | null;
  homologadoPorUsuarioId?: string | null;
  fundoTroco?: number | null;
  justificativaReabertura: string;
};

export async function listarSessoesCaixa(
  empresaId: string,
  usuarioId: string,
  papel: string,
): Promise<CaixaSessaoDto[]> {
  const verTodos = temPermissao(papel, "caixa.relatorio_todos");
  const condicoes = [eq(caixaSessoes.empresaId, empresaId)];
  if (!verTodos) condicoes.push(eq(caixaSessoes.operadorId, usuarioId));

  const sessoes = await db
    .select()
    .from(caixaSessoes)
    .where(and(...condicoes))
    .orderBy(desc(caixaSessoes.abertoEm))
    .limit(250);

  if (sessoes.length === 0) return [];

  const ids = sessoes.map((s) => s.id);
  // Regra única do motor: todas as vendas vinculadas à sessão (qualquer tipo/status); o predicado decide
  const { vendasPorSessao, movsPorSessao } = await carregarInsumosSessoes(empresaId, ids);

  return sessoes.map((s) => {
    const movsSessao: MovimentoCaixaInput[] = (movsPorSessao.get(s.id) ?? [])
      .slice()
      .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : a.criadoEm > b.criadoEm ? -1 : 0));

    const apurada = apurarSessaoCaixa({
      sessaoId: s.id,
      empresaId,
      saldoInicial: N(s.saldoInicial),
      vendas: vendasPorSessao.get(s.id) ?? [],
      movimentos: movsSessao,
    });
    // sessão fechada: o esperado exibido é o snapshot do fechamento (não muda silenciosamente)
    const { classificacoes, ...apuracao } =
      s.status === "fechado" ? aplicarSnapshotFechamento(apurada, s.valoresEsperados as Record<string, number>) : apurada;
    void classificacoes;

    const fechado = s.status === "fechado";
    const esperados = fechado && Object.keys(s.valoresEsperados ?? {}).length > 0
      ? (s.valoresEsperados as Record<string, number>)
      : apuracao.esperadosMap;

    return {
      id: s.id,
      numero: s.numero,
      terminal: s.terminal,
      operadorId: s.operadorId,
      operadorNome: s.operadorNome,
      status: (s.status === "fechado" ? "fechado" : "aberto") as "aberto" | "fechado",
      saldoInicial: N(s.saldoInicial),
      apuracao,
      movimentos: movsSessao,
      valoresEsperados: esperados,
      valoresInformados: (s.valoresInformados ?? {}) as Record<string, number>,
      diferencas: (s.diferencas ?? {}) as Record<string, number>,
      totalEsperado: fechado ? N(s.totalEsperado) : apuracao.totalEsperado,
      totalInformado: N(s.totalInformado),
      diferencaTotal: N(s.diferencaTotal),
      observacaoAbertura: s.observacaoAbertura ?? "",
      justificativaFechamento: s.justificativaFechamento ?? "",
      abertoEm: s.abertoEm ? new Date(s.abertoEm).toISOString() : "",
      fechadoEm: s.fechadoEm ? new Date(s.fechadoEm).toISOString() : "",
      fechadoPorNome: s.fechadoPorNome ?? "",
      reabertoEm: s.reabertoEm ? new Date(s.reabertoEm).toISOString() : "",
      reabertoPorNome: s.reabertoPorNome ?? "",
      justificativaReabertura: s.justificativaReabertura ?? "",
      statusAprovacao: s.statusAprovacao ?? null,
      homologadoPorUsuarioId: s.homologadoPorUsuarioId ?? null,
      fundoTroco: s.fundoTroco === null || s.fundoTroco === undefined ? null : N(s.fundoTroco),
    };
  });
}

export async function obterSessaoCaixaOperador(
  empresaId: string,
  usuarioId: string,
  papel: string,
): Promise<CaixaSessaoDto | null> {
  const todas = await listarSessoesCaixa(empresaId, usuarioId, papel);
  return todas.find((s) => s.operadorId === usuarioId && s.status === "aberto") ?? null;
}

/* ------------------------------------ assinatura recorrente por CNPJ */

export type AssinaturaContratoDto = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  emailCobranca: string;
  planoId: string;
  planoNome: string;
  ciclo: CicloAssinatura;
  formaPagamento: FormaAssinatura;
  valorCiclo: number;
  status: StatusAssinatura;
  gateway: ProvedorGateway;
  gatewayCustomerId: string;
  gatewaySubscriptionId: string;
  cartaoBandeira: string;
  cartaoUltimos4: string;
  proximoVencimento: string;
  cancelarAoFimDoCiclo: boolean;
  canceladaEm: string;
  motivoCancelamento: string;
  criadoEm: string;
};

export type AssinaturaFaturaDto = {
  id: string;
  assinaturaId: string;
  numero: number;
  cnpj: string;
  planoId: string;
  planoNome: string;
  ciclo: CicloAssinatura;
  competencia: string;
  valor: number;
  formaPagamento: FormaAssinatura;
  status: StatusFaturaAssinatura;
  vencimento: string;
  pagoEm: string;
  gateway: ProvedorGateway;
  gatewayPaymentId: string;
  checkoutUrl: string;
  pixPayload: string;
  linhaDigitavel: string;
  nsuAutorizacao: string;
  criadoEm: string;
};

export type AssinaturaPainelDto = {
  empresaNome: string;
  empresaCnpj: string;
  empresaEmail: string;
  planoAtual: {
    id: string;
    nome: string;
    preco: number;
    limiteProdutos: number;
    limiteUsuarios: number;
  };
  trialDias: number | null;
  assinaturaPagoEm: string;
  uso: {
    produtosAtivos: number;
    usuariosAtivos: number;
  };
  gateway: {
    provedor: ProvedorGateway;
    modoLive: boolean;
    webhookProtegido: boolean;
    asaasAmbiente: "producao" | "sandbox";
  };
  contratoAtivo: AssinaturaContratoDto | null;
  contratos: AssinaturaContratoDto[];
  faturas: AssinaturaFaturaDto[];
};

export async function obterPainelAssinatura(empresaId: string): Promise<AssinaturaPainelDto> {
  const [[emp], contratosRows, faturasRows, [qtdProds], [qtdUsers]] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    db
      .select()
      .from(assinaturas)
      .where(eq(assinaturas.empresaId, empresaId))
      .orderBy(desc(assinaturas.createdAt))
      .limit(30),
    db
      .select()
      .from(assinaturaFaturas)
      .where(eq(assinaturaFaturas.empresaId, empresaId))
      .orderBy(desc(assinaturaFaturas.createdAt))
      .limit(100),
    db
      .select({ n: sql<string>`count(*)` })
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true))),
    db
      .select({ n: sql<string>`count(*)` })
      .from(usuarios)
      .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.ativo, true))),
  ]);

  const cfgPlano = planoById(emp?.plano);
  const dias = diasAteTrial(emp?.trialUntil);
  const trialDias = emp?.trialUntil && Number.isFinite(dias) ? Math.max(0, dias) : null;
  const diag = diagnosticoGatewayServidor();

  const contratos: AssinaturaContratoDto[] = contratosRows.map((c) => ({
    id: c.id,
    cnpj: c.cnpj,
    razaoSocial: c.razaoSocial,
    emailCobranca: c.emailCobranca,
    planoId: c.planoId,
    planoNome: planoById(c.planoId).nome,
    ciclo: (c.ciclo === "anual" ? "anual" : "mensal") as CicloAssinatura,
    formaPagamento: (c.formaPagamento === "boleto" || c.formaPagamento === "cartao" ? c.formaPagamento : "pix") as FormaAssinatura,
    valorCiclo: N(c.valorCiclo),
    status: (c.status as StatusAssinatura) || "aguardando_pagamento",
    gateway: (c.gateway as ProvedorGateway) || "sandbox",
    gatewayCustomerId: c.gatewayCustomerId ?? "",
    gatewaySubscriptionId: c.gatewaySubscriptionId ?? "",
    cartaoBandeira: c.cartaoBandeira ?? "",
    cartaoUltimos4: c.cartaoUltimos4 ?? "",
    proximoVencimento: iso(c.proximoVencimento),
    cancelarAoFimDoCiclo: c.cancelarAoFimDoCiclo,
    canceladaEm: c.canceladaEm ? new Date(c.canceladaEm).toISOString() : "",
    motivoCancelamento: c.motivoCancelamento ?? "",
    criadoEm: c.createdAt ? new Date(c.createdAt).toISOString() : "",
  }));

  const faturas: AssinaturaFaturaDto[] = faturasRows.map((f) => ({
    id: f.id,
    assinaturaId: f.assinaturaId,
    numero: f.numero,
    cnpj: f.cnpj,
    planoId: f.planoId,
    planoNome: planoById(f.planoId).nome,
    ciclo: (f.ciclo === "anual" ? "anual" : "mensal") as CicloAssinatura,
    competencia: f.competencia,
    valor: N(f.valor),
    formaPagamento: (f.formaPagamento === "boleto" || f.formaPagamento === "cartao" ? f.formaPagamento : "pix") as FormaAssinatura,
    status: (f.status as StatusFaturaAssinatura) || "pendente",
    vencimento: iso(f.vencimento),
    pagoEm: f.pagoEm ? new Date(f.pagoEm).toISOString() : "",
    gateway: (f.gateway as ProvedorGateway) || "sandbox",
    gatewayPaymentId: f.gatewayPaymentId ?? "",
    checkoutUrl: f.checkoutUrl ?? "",
    pixPayload: f.pixPayload ?? "",
    linhaDigitavel: f.linhaDigitavel ?? "",
    nsuAutorizacao: f.nsuAutorizacao ?? "",
    criadoEm: f.createdAt ? new Date(f.createdAt).toISOString() : "",
  }));

  const contratoAtivo = contratos.find((c) => c.status !== "cancelada") ?? null;

  return {
    empresaNome: emp?.nome ?? "",
    empresaCnpj: emp?.cnpj ?? "",
    empresaEmail: emp?.email ?? "",
    planoAtual: {
      id: cfgPlano.id,
      nome: cfgPlano.nome,
      preco: cfgPlano.preco,
      limiteProdutos: cfgPlano.limiteProdutos,
      limiteUsuarios: cfgPlano.limiteUsuarios,
    },
    trialDias,
    assinaturaPagoEm: iso(emp?.assinaturaPagoEm),
    uso: {
      produtosAtivos: Number(qtdProds?.n ?? 0),
      usuariosAtivos: Number(qtdUsers?.n ?? 0),
    },
    gateway: diag,
    contratoAtivo,
    contratos,
    faturas,
  };
}

/* ------------------------------ emissor fiscal de saída e contingência */

export type ItemProntidaoFiscal = {
  id: string;
  rotulo: string;
  ok: boolean;
  detalhe: string;
  criticoProducao: boolean;
};

export type PainelEmissorFiscalDto = {
  empresaNome: string;
  empresaCnpj: string;
  empresaUf: string;
  ambiente: 1 | 2;
  emissor: {
    provedor: ProvedorEmissorFiscal;
    modoLive: boolean;
    urlConfigurada: boolean;
    tokenConfigurado: boolean;
    webhookProtegido: boolean;
  };
  prontidaoProducao: {
    prontoParaProducao: boolean;
    itens: ItemProntidaoFiscal[];
    produtosSemNcmReal: number;
    totalProdutosAtivos: number;
  };
  resumo: {
    totalFiscais: number;
    autorizadasSefaz: number;
    homologacaoLocal: number;
    emContingenciaOuPendente: number;
    rejeitadas: number;
    comXmlReal: number;
  };
  documentos: VendaDto[];
};

export async function obterPainelEmissorFiscal(empresaId: string): Promise<PainelEmissorFiscalDto> {
  const [[emp], prodsAtivos, docsFiscais] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    db
      .select({ id: produtos.id, ncm: produtos.ncm })
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true))),
    listarVendas(empresaId, { tipo: "fiscal" }),
  ]);

  const fiscal = (emp?.fiscal ?? {}) as Record<string, unknown>;
  const ambiente = (Number(fiscal.ambiente ?? 2) === 1 ? 1 : 2) as 1 | 2;
  const diag = diagnosticoEmissorServidor();

  const cnpjOk = validarCnpj(emp?.cnpj ?? "");
  const ibgeOk = /^\d{7}$/.test(soDigitos(emp?.codMunicipio ?? ""));
  const cscOk = Boolean(String(fiscal.cscId ?? "").trim() && String(fiscal.cscToken ?? "").trim());
  const certVal = String(fiscal.certificadoValidade ?? "");
  const temA1 = Boolean(fiscal.dfeSenhaCifrada || fiscal.certificadoNome);
  const a1Valido = Boolean(temA1 && (!certVal || new Date(`${certVal.slice(0, 10)}T23:59:59`) >= new Date()));
  const produtosSemNcmReal = prodsAtivos.filter((p) => soDigitos(p.ncm) === "00000000" || soDigitos(p.ncm).length !== 8).length;

  const itensProntidao: ItemProntidaoFiscal[] = [
    {
      id: "cnpj",
      rotulo: "CNPJ do emitente válido",
      ok: cnpjOk,
      detalhe: emp?.cnpj || "Não informado",
      criticoProducao: true,
    },
    {
      id: "ibge",
      rotulo: "Código IBGE do município (7 dígitos)",
      ok: ibgeOk,
      detalhe: ibgeOk ? String(emp?.codMunicipio) : "Configure em Configurações → Empresa",
      criticoProducao: true,
    },
    {
      id: "csc",
      rotulo: "CSC ID e Token da NFC-e",
      ok: cscOk,
      detalhe: cscOk ? `CSC ID ${String(fiscal.cscId)}` : "Configure em Configurações → Fiscal",
      criticoProducao: true,
    },
    {
      id: "a1",
      rotulo: "Certificado Digital A1 válido",
      ok: a1Valido,
      detalhe: certVal ? `Validade ${certVal}` : "Envie o .pfx em DF-e e Certificado A1",
      criticoProducao: true,
    },
    {
      id: "ncm",
      rotulo: "Catálogo ativo com NCM TIPI real (≠ 00000000)",
      ok: produtosSemNcmReal === 0,
      detalhe:
        produtosSemNcmReal === 0
          ? `${prodsAtivos.length} produto(s) com NCM completo`
          : `${produtosSemNcmReal} de ${prodsAtivos.length} produto(s) com NCM 00000000`,
      criticoProducao: true,
    },
    {
      id: "provedor",
      rotulo: "Provedor Emissor Fiscal REST conectado",
      ok: diag.modoLive,
      detalhe: diag.modoLive
        ? `Conectado (${diag.provedor})`
        : "Em Homologação Local (defina EMISSOR_FISCAL_URL + EMISSOR_FISCAL_TOKEN p/ produção)",
      criticoProducao: true,
    },
  ];

  const prontoParaProducao = itensProntidao.every((i) => !i.criticoProducao || i.ok);

  return {
    empresaNome: emp?.nome ?? "",
    empresaCnpj: emp?.cnpj ?? "",
    empresaUf: emp?.uf ?? "RO",
    ambiente,
    emissor: diag,
    prontidaoProducao: {
      prontoParaProducao,
      itens: itensProntidao,
      produtosSemNcmReal,
      totalProdutosAtivos: prodsAtivos.length,
    },
    resumo: {
      totalFiscais: docsFiscais.length,
      autorizadasSefaz: docsFiscais.filter((d) => d.statusSefaz === "autorizada").length,
      homologacaoLocal: docsFiscais.filter((d) => d.statusSefaz === "simulado").length,
      emContingenciaOuPendente: docsFiscais.filter(
        (d) => d.status !== "cancelado" && (d.statusSefaz === "contingencia" || d.statusSefaz === "pendente_envio"),
      ).length,
      rejeitadas: docsFiscais.filter((d) => d.status !== "cancelado" && d.statusSefaz === "rejeitada").length,
      comXmlReal: docsFiscais.filter((d) => d.temXml).length,
    },
    documentos: docsFiscais,
  };
}
