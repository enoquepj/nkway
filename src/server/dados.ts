import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  clientes,
  contas,
  devolucoes,
  entradas,
  eventosFiscais,
  fornecedores,
  inutilizacoes,
  mdfes,
  movimentos,
  produtos,
  vendaItens,
  vendas,
  type EntradaRow,
} from "@/db/schema";
import { round2, situacaoEstoque, type SituacaoEstoque } from "@/lib/dominio";

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
        nome: contas.contraparteNome,
        saldo: sql<string>`coalesce(sum(${contas.valor} - ${contas.valorPago}),0)`,
      })
      .from(contas)
      .where(and(eq(contas.empresaId, empresaId), eq(contas.tipo, "receber"), eq(contas.status, "aberta")))
      .groupBy(contas.contraparteNome),
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
      condicaoPadrao: c.condicaoPadrao,
      limiteCredito: N(c.limiteCredito),
      indIe: c.indIe ?? "9",
      observacao: c.observacao ?? "",
      totalComprado: N(hist?.total ?? "0"),
      qtdVendas: Number(hist?.qtd ?? 0),
      saldoEmAberto: N(saldo.find((s) => s.nome === c.nome)?.saldo ?? "0"),
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
  validade: string | null;
  observacao: string | null;
  operador: string | null;
  clienteId: string | null;
  davOrigemId: string | null;
  data: string;
  itens: { nome: string; qtd: number; precoUnit: number; total: number; unidade: string | null }[];
  eventos: { id: string; tipo: string; sequencia: number; descricao: string; protocolo: string; em: string }[];
};

export async function listarVendas(empresaId: string, filtro?: { tipo?: "fiscal" | "dav"; ids?: string[] }) {
  const condicoes = [eq(vendas.empresaId, empresaId)];
  if (filtro?.tipo) condicoes.push(eq(vendas.tipo, filtro.tipo));
  if (filtro?.ids) {
    if (filtro.ids.length === 0) return [];
    condicoes.push(inArray(vendas.id, filtro.ids));
  }
  const linhas = await db
    .select()
    .from(vendas)
    .where(and(...condicoes))
    .orderBy(desc(vendas.data))
    .limit(500);
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
    validade: iso(v.validade),
    observacao: v.observacao,
    operador: v.operador,
    clienteId: v.clienteId,
    davOrigemId: v.davOrigemId,
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
      .map((i) => ({ nome: i.nome, qtd: N(i.qtd, 3), precoUnit: N(i.precoUnit, 4), total: N(i.total), unidade: i.unidade })),
  }));
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
    .limit(600);
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
    data: m.data ? new Date(m.data).toISOString() : "",
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
