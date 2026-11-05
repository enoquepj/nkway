/** Relatórios gerenciais de PDV. Leituras somente da empresa recebida da sessão server-side. */
import { and, asc, count, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { auditorias, caixaMovimentos, caixaQuebraLogs, caixaSessoes, produtos, vendaItens, vendas } from "@/db/schema";
import { ratearPagamentosDetalhado, selecionarVendasDaSessao, type VendaCaixaInput } from "@/lib/caixa";
import { FORMAS_PAGAMENTO, rotuloForma, round2 } from "@/lib/dominio";
import { colunasRelatorioPdv, type FiltrosRelatorioPdv, type IndicadorRelatorioPdv, type LinhaRelatorioPdv, type RespostaRelatorioPdv } from "@/lib/relatoriosPdv";
import { normalizarVendaCaixa } from "@/server/caixaCore";

const MAX_VENDAS_PERIODO = 50_000;
const SEM_SESSAO = "relatorio-sem-sessao";
const N = (x: unknown) => Number.isFinite(Number(x)) ? Number(x) : 0;
const iso = (x: Date | string | null | undefined) => x ? new Date(x).toISOString() : null;
const arred = (x: number) => round2(Number.isFinite(x) ? x : 0);

/** Uma única lista JSON parametrizada evita milhares de parâmetros e mantém o filtro seguro. */
function emIds(coluna: AnyPgColumn, ids: string[]): SQL {
  return sql`${coluna} in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as ids(value))`;
}

/** Limites por dia no fuso da empresa, mantendo o índice da coluna de timestamp utilizável. */
function noPeriodo(coluna: AnyPgColumn, f: FiltrosRelatorioPdv, fuso: string): SQL {
  return sql`${coluna} >= (${f.inicio}::date::timestamp at time zone ${fuso}) and ${coluna} < ((${f.fim}::date + 1)::timestamp at time zone ${fuso})`;
}

function padraoBusca(v: string) { return `%${v.replace(/[\\%_]/g, "\\$&")}%`; }
const nomeOperadorVenda = sql<string>`coalesce(nullif(${caixaSessoes.operadorNome}, ''), nullif(${vendas.operador}, ''), 'Não informado')`;
const idOperadorVenda = sql<string>`coalesce(${caixaSessoes.operadorId}::text, ${vendas.operadorId}::text, '')`;
const terminalVenda = sql<string>`coalesce(nullif(${caixaSessoes.terminal}, ''), nullif(${vendas.caixa}, ''), 'Não informado')`;
const juncaoSessaoVenda = (empresaId: string) => and(eq(vendas.caixaSessaoId, caixaSessoes.id), eq(caixaSessoes.empresaId, empresaId));
// Divergências opostas em formas diferentes não devem se anular na auditoria.
const quebraAbsoluta = sql`greatest(
  coalesce((select sum(abs((dif.valor #>> '{}')::numeric))
    from jsonb_each(case when jsonb_typeof(${caixaSessoes.diferencas}) = 'object' then ${caixaSessoes.diferencas} else '{}'::jsonb end) as dif(forma, valor)
    where jsonb_typeof(dif.valor) = 'number'), 0),
  abs(coalesce(${caixaSessoes.diferencaTotal}, 0))
)`;

function filtroVenda(empresaId: string, f: FiltrosRelatorioPdv, fuso: string): SQL | undefined {
  return and(
    eq(vendas.empresaId, empresaId), noPeriodo(vendas.data, f, fuso),
    f.terminal ? eq(terminalVenda, f.terminal) : undefined,
    f.operador ? or(ilike(nomeOperadorVenda, padraoBusca(f.operador)), ilike(idOperadorVenda, padraoBusca(f.operador))) : undefined,
  );
}

function filtroSessao(empresaId: string, f: FiltrosRelatorioPdv): SQL | undefined {
  return and(
    eq(caixaSessoes.empresaId, empresaId),
    f.terminal ? eq(caixaSessoes.terminal, f.terminal) : undefined,
    f.operador ? or(ilike(caixaSessoes.operadorNome, padraoBusca(f.operador)), ilike(sql`${caixaSessoes.operadorId}::text`, padraoBusca(f.operador))) : undefined,
    f.statusTurno !== "todos" ? eq(caixaSessoes.status, f.statusTurno) : undefined,
  );
}

const camposVenda = {
  id: vendas.id, empresaId: vendas.empresaId, caixaSessaoId: vendas.caixaSessaoId, tipo: vendas.tipo,
  status: vendas.status, total: vendas.total, subtotal: vendas.subtotal, desconto: vendas.desconto,
  formaPagamento: vendas.formaPagamento, pagamentos: vendas.pagamentos, davOrigemId: vendas.davOrigemId,
  origem: vendas.origem, data: vendas.data,
};
type VendaRelatorio = typeof vendas.$inferSelect extends never ? never : {
  id: string; empresaId: string; caixaSessaoId: string | null; tipo: string; status: string;
  total: number; subtotal: number; desconto: number; formaPagamento: string;
  pagamentos: { forma: string; valor: number }[] | null; davOrigemId: string | null; origem: string | null; data: Date | null;
};

/**
 * Reusa a seleção do motor por sessão, inclusive o DAV de origem fora do período.
 * Registros históricos sem sessão são classificados em um grupo separado e sinalizados;
 * eles aparecem na visão global, mas nunca são atribuídos a um fechamento de caixa.
 */
async function selecionarVendas(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const candidatas = await db.select(camposVenda).from(vendas)
    .leftJoin(caixaSessoes, juncaoSessaoVenda(empresaId))
    .where(filtroVenda(empresaId, f, fuso)).orderBy(asc(vendas.data), asc(vendas.id)).limit(MAX_VENDAS_PERIODO + 1);
  if (candidatas.length > MAX_VENDAS_PERIODO) throw new RangeError("Há mais de 50.000 vendas no período. Reduza o intervalo para consultar com segurança.");
  const idsPresentes = new Set(candidatas.map((v) => v.id));
  const idsPais = [...new Set(candidatas.map((v) => v.davOrigemId).filter((id): id is string => Boolean(id) && !idsPresentes.has(id!)))];
  const pais = idsPais.length ? await db.select(camposVenda).from(vendas).where(and(eq(vendas.empresaId, empresaId), emIds(vendas.id, idsPais))) : [];
  const porId = new Map<string, VendaRelatorio>([...candidatas, ...pais].map((v) => [v.id, v]));
  const grupos = new Map<string, VendaRelatorio[]>();
  for (const v of candidatas) {
    const chave = v.caixaSessaoId || SEM_SESSAO;
    const lista = grupos.get(chave) ?? [];
    lista.push(v); grupos.set(chave, lista);
  }
  const escolhidas = new Set<string>();
  for (const [sessaoId, lista] of grupos) {
    const presentes = new Set(lista.map((v) => v.id));
    const relacionadas = [...lista];
    for (const v of lista) {
      const pai = v.davOrigemId ? porId.get(v.davOrigemId) : undefined;
      if (pai && !presentes.has(pai.id)) { relacionadas.push(pai); presentes.add(pai.id); }
    }
    const norm: VendaCaixaInput[] = relacionadas.map((v) => {
      const n = normalizarVendaCaixa(v);
      return sessaoId === SEM_SESSAO && !v.caixaSessaoId ? { ...n, caixaSessaoId: undefined } : n;
    });
    for (const v of selecionarVendasDaSessao(norm, { empresaId, sessaoId }).selecionadas) {
      if (idsPresentes.has(v.id)) escolhidas.add(v.id);
    }
  }
  const selecionadas = candidatas.filter((v) => escolhidas.has(v.id));
  return {
    ativas: selecionadas.filter((v) => v.status.toLowerCase() !== "cancelado"),
    canceladas: selecionadas.filter((v) => v.status.toLowerCase() === "cancelado"),
  };
}

async function resumoVendas(empresaId: string, ids: string[]) {
  const [r] = await db.select({
    quantidade: count(), bruto: sql<number>`coalesce(sum(${vendas.subtotal}), 0)`.mapWith(Number),
    liquido: sql<number>`coalesce(sum(${vendas.total}), 0)`.mapWith(Number),
    desconto: sql<number>`coalesce(sum(${vendas.desconto}), 0)`.mapWith(Number),
    ticket: sql<number>`coalesce(avg(${vendas.total}), 0)`.mapWith(Number),
  }).from(vendas).where(and(eq(vendas.empresaId, empresaId), emIds(vendas.id, ids)));
  return { quantidade: N(r?.quantidade), bruto: arred(N(r?.bruto)), liquido: arred(N(r?.liquido)), desconto: arred(N(r?.desconto)), ticket: arred(N(r?.ticket)) };
}

async function opcoes(empresaId: string) {
  const [ts, vs, cs] = await Promise.all([
    db.selectDistinct({ nome: caixaSessoes.terminal }).from(caixaSessoes).where(eq(caixaSessoes.empresaId, empresaId)).orderBy(asc(caixaSessoes.terminal)).limit(500),
    db.selectDistinct({ nome: vendas.caixa }).from(vendas).where(eq(vendas.empresaId, empresaId)).orderBy(asc(vendas.caixa)).limit(500),
    db.selectDistinct({ nome: produtos.categoria }).from(produtos).where(eq(produtos.empresaId, empresaId)).orderBy(asc(produtos.categoria)).limit(500),
  ]);
  return {
    terminais: [...new Set([...ts, ...vs].map((x) => String(x.nome ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    categorias: cs.map((x) => x.nome).filter(Boolean),
  };
}

function avisoHistorico(ativas: VendaRelatorio[]) {
  const n = ativas.filter((v) => !v.caixaSessaoId).length;
  return n ? [`${n} venda(s) histórica(s) sem sessão estão incluídas na visão de vendas; elas não compõem o fechamento de caixa.`] : [];
}

async function visaoGeral(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const { ativas, canceladas } = await selecionarVendas(empresaId, f, fuso);
  const resumo = await resumoVendas(empresaId, ativas.map((v) => v.id));
  const distribuicao = new Map(FORMAS_PAGAMENTO.map((p) => [p.id as string, { forma: p.label, valor: 0, lancamentos: 0 }]));
  let inconsistentes = 0; let desconhecidas = 0; let ignoradas = 0;
  const formasConhecidas = new Set<string>(FORMAS_PAGAMENTO.map((p) => p.id));
  for (const v of ativas) {
    const r = ratearPagamentosDetalhado(normalizarVendaCaixa(v));
    if (r.inconsistencia) inconsistentes++;
    desconhecidas += r.formasDesconhecidas;
    ignoradas += r.parcelasIgnoradas;
    if (r.usouFallbackForma && !formasConhecidas.has(String(v.formaPagamento ?? "").trim().toLowerCase())) desconhecidas++;
    for (const [forma, valor] of Object.entries(r.porForma)) {
      if (valor <= 0) continue;
      const item = distribuicao.get(forma);
      if (item) { item.valor = arred(item.valor + valor); item.lancamentos++; }
    }
  }
  const totalRecebido = arred([...distribuicao.values()].reduce((s, x) => s + x.valor, 0));
  const linhas: LinhaRelatorioPdv[] = [...distribuicao.values()].map((x) => ({ ...x, percentual: totalRecebido ? arred(x.valor / totalRecebido * 100) : 0 })).sort((a, b) => N(b.valor) - N(a.valor));
  const inicio = (f.pagina - 1) * f.tamanhoPagina;
  const indicadores: IndicadorRelatorioPdv[] = [
    { rotulo: "Faturamento bruto", valor: resumo.bruto, formato: "moeda", detalhe: "Subtotal antes de descontos; sem frete", icone: "grafico", tom: "verde" },
    { rotulo: "Faturamento líquido", valor: resumo.liquido, formato: "moeda", detalhe: `${resumo.quantidade} venda(s) concluída(s)`, icone: "carteira", tom: "azul" },
    { rotulo: "Ticket médio", valor: resumo.ticket, formato: "moeda", detalhe: "Líquido dividido pelas vendas", icone: "caixa", tom: "roxo" },
    { rotulo: "Descontos", valor: resumo.desconto, formato: "moeda", detalhe: "Nas vendas concluídas", icone: "menos", tom: "laranja" },
    { rotulo: "Cupons cancelados", valor: canceladas.length, formato: "numero", detalhe: `${arred(canceladas.reduce((s, v) => s + N(v.total), 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · pela data da venda`, icone: "alerta", tom: "laranja" },
  ];
  const avisos = [
    ...avisoHistorico(ativas),
    "Vale-refeição não é uma forma cadastrada no PDV atual. Boleto e prazo são recebimentos não físicos.",
    "Itens removidos antes da conclusão não são registrados; não é possível totalizar esses cancelamentos.",
    ...(inconsistentes ? [`${inconsistentes} venda(s) têm recebimento inconsistente e precisam de revisão.`] : []),
    ...(desconhecidas ? [`${desconhecidas} parcela(s) ou venda(s) têm forma desconhecida ou ausente; o motor atual as classifica em dinheiro. Revise os registros.`] : []),
    ...(ignoradas ? [`${ignoradas} parcela(s) inválida(s) foram ignoradas pelo motor de caixa.`] : []),
  ];
  return { indicadores, linhas: linhas.slice(inicio, inicio + f.tamanhoPagina), total: linhas.length, avisos };
}

async function rankingProdutos(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const { ativas } = await selecionarVendas(empresaId, f, fuso);
  const ids = ativas.map((v) => v.id);
  const chave = sql<string>`coalesce(${produtos.id}::text, 'avulso:' || lower(${vendaItens.nome}))`;
  const nome = sql<string>`coalesce(nullif(${produtos.nome}, ''), ${vendaItens.nome})`;
  const sku = sql<string>`coalesce(nullif(${produtos.sku}, ''), '—')`;
  const categoria = sql<string>`coalesce(${produtos.categoria}, 'Não cadastrado')`;
  // Rateio proporcional do desconto global da venda; frete não é receita de mercadoria.
  const receita = sql`case when ${vendas.subtotal} > 0 then ${vendaItens.total} * greatest(0, ${vendas.subtotal} - ${vendas.desconto}) / ${vendas.subtotal} else ${vendaItens.total} end`;
  const where = and(eq(vendas.empresaId, empresaId), emIds(vendas.id, ids), f.categoria ? eq(categoria, f.categoria) : undefined);
  const joinVenda = and(eq(vendaItens.vendaId, vendas.id), eq(vendas.empresaId, empresaId));
  const joinProduto = and(eq(vendaItens.produtoId, produtos.id), eq(produtos.empresaId, empresaId));
  const [stats] = await db.select({
    total: sql<number>`count(distinct ${chave})`.mapWith(Number),
    quantidade: sql<number>`coalesce(sum(${vendaItens.qtd}), 0)`.mapWith(Number),
    receita: sql<number>`coalesce(sum(${receita}), 0)`.mapWith(Number),
  }).from(vendaItens).innerJoin(vendas, joinVenda).leftJoin(produtos, joinProduto).where(where);
  const total = Math.min(N(stats?.total), f.top);
  const offset = (f.pagina - 1) * f.tamanhoPagina;
  const limite = Math.max(0, Math.min(f.tamanhoPagina, f.top - offset));
  const acumuladoAnterior = sql<number>`coalesce((sum(sum(${receita})) over (order by sum(${receita}) desc, ${nome} asc, ${chave} asc rows between unbounded preceding and current row) - sum(${receita})) * 100 / nullif(sum(sum(${receita})) over (), 0), 0)`.mapWith(Number);
  const rows = limite ? await db.select({
    chave, nome, sku, categoria,
    quantidade: sql<number>`coalesce(sum(${vendaItens.qtd}),0)`.mapWith(Number),
    receita: sql<number>`coalesce(sum(${receita}),0)`.mapWith(Number),
    custo: sql<number>`coalesce(sum(${vendaItens.qtd} * coalesce(${produtos.custo},0)),0)`.mapWith(Number),
    custoAusente: sql<boolean>`bool_or(${produtos.id} is null or ${produtos.custo} <= 0)`,
    estoque: produtos.estoque, minimo: produtos.estoqueMin, anterior: acumuladoAnterior,
  }).from(vendaItens).innerJoin(vendas, joinVenda).leftJoin(produtos, joinProduto).where(where)
    .groupBy(chave, nome, sku, categoria, produtos.estoque, produtos.estoqueMin)
    .orderBy(desc(sql`sum(${receita})`), asc(nome), asc(chave)).limit(limite).offset(offset) : [];
  const linhas: LinhaRelatorioPdv[] = rows.map((r, i) => {
    const faturamento = arred(N(r.receita)); const lucro = r.custoAusente ? null : arred(faturamento - N(r.custo));
    const estoque = r.estoque == null ? null : N(r.estoque); const minimo = r.minimo == null ? null : N(r.minimo);
    const alertaEstoque = estoque == null ? "Não cadastrado" : estoque <= 0 ? "Zerado" : minimo && estoque <= minimo ? "No mínimo" : minimo && estoque <= minimo * 1.2 ? "Próximo do mínimo" : minimo ? "OK" : "Mínimo não configurado";
    return { posicao: offset + i + 1, sku: r.sku, produto: r.nome, categoria: r.categoria, quantidade: N(r.quantidade), faturamento, lucro, margem: lucro == null || faturamento <= 0 ? null : arred(lucro / faturamento * 100), classe: N(stats?.receita) <= 0 ? "—" : N(r.anterior) < 80 ? "A" : N(r.anterior) < 95 ? "B" : "C", estoque, alertaEstoque };
  });
  return {
    indicadores: [
      { rotulo: "Produtos vendidos", valor: N(stats?.total), formato: "numero", detalhe: "Produtos distintos no filtro", icone: "caixaEstoque", tom: "verde" },
      { rotulo: "Unidades vendidas", valor: N(stats?.quantidade), formato: "quantidade", detalhe: "Pode incluir quantidades fracionadas", icone: "etiqueta", tom: "azul" },
      { rotulo: "Receita de mercadorias", valor: arred(N(stats?.receita)), formato: "moeda", detalhe: "Desconto global rateado; sem frete", icone: "grafico", tom: "roxo" },
      { rotulo: "Ranking exibido", valor: total, formato: "numero", detalhe: `Até os ${f.top} primeiros produtos`, icone: "painel", tom: "laranja" },
    ] as IndicadorRelatorioPdv[], linhas, total,
    avisos: [...avisoHistorico(ativas), "Margem estimada pelo custo atual do cadastro, não pelo custo histórico; custo ausente aparece como não disponível.", "Curva ABC calculada sobre todos os produtos filtrados, antes do limite Top. O alerta usa o estoque atual e o mínimo cadastrado."],
  };
}

function numeroNoMapa(m: unknown, chave: string): number | null {
  if (!m || typeof m !== "object" || !Object.prototype.hasOwnProperty.call(m, chave)) return null;
  const v = Number((m as Record<string, unknown>)[chave]);
  return Number.isFinite(v) ? v : null;
}
function comparacao(mapaE: unknown, mapaI: unknown, chaves: string[]) {
  const e = chaves.map((c) => numeroNoMapa(mapaE, c)); const i = chaves.map((c) => numeroNoMapa(mapaI, c));
  if (e.some((v) => v == null) || i.some((v) => v == null)) return { esperado: null, declarado: null, diferenca: null };
  const esperado = arred(e.reduce<number>((s, v) => s + (v ?? 0), 0));
  const declarado = arred(i.reduce<number>((s, v) => s + (v ?? 0), 0));
  return { esperado, declarado, diferenca: arred(declarado - esperado) };
}

async function auditoriaCaixa(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const escopo = filtroSessao(empresaId, f);
  const whereTurnos = and(escopo, noPeriodo(caixaSessoes.abertoEm, f, fuso));
  const whereSangrias = and(escopo, eq(caixaMovimentos.empresaId, empresaId), eq(caixaMovimentos.tipo, "sangria"), noPeriodo(caixaMovimentos.createdAt, f, fuso));
  const joinMov = and(eq(caixaMovimentos.sessaoId, caixaSessoes.id), eq(caixaSessoes.empresaId, empresaId));
  const [turnos] = await db.select({ total: count(), fechados: sql<number>`count(*) filter (where ${caixaSessoes.status} = 'fechado')`.mapWith(Number), quebras: sql<number>`count(*) filter (where ${caixaSessoes.status} = 'fechado' and ${quebraAbsoluta} > 0.009)`.mapWith(Number) }).from(caixaSessoes).where(whereTurnos);
  const [sangrias] = await db.select({ total: count(), valor: sql<number>`coalesce(sum(${caixaMovimentos.valor}),0)`.mapWith(Number) }).from(caixaMovimentos).innerJoin(caixaSessoes, joinMov).where(whereSangrias);
  // Uma homologação mista cria dois logs (FALTA e SOBRA), mas é uma única aprovação.
  const [homologacoes] = await db.select({ total: sql<number>`count(distinct (${caixaQuebraLogs.sessaoId}, ${caixaQuebraLogs.homologadoPorUsuarioId}, ${caixaQuebraLogs.homologadoEm}))`.mapWith(Number) }).from(caixaQuebraLogs).innerJoin(caixaSessoes, and(eq(caixaQuebraLogs.sessaoId, caixaSessoes.id), eq(caixaSessoes.empresaId, empresaId))).where(and(escopo, eq(caixaQuebraLogs.empresaId, empresaId), isNotNull(caixaQuebraLogs.homologadoPorUsuarioId), noPeriodo(caixaQuebraLogs.homologadoEm, f, fuso)));
  const indicadores: IndicadorRelatorioPdv[] = [
    { rotulo: "Turnos abertos no período", valor: N(turnos?.total), formato: "numero", detalhe: `${N(turnos?.fechados)} já encerrado(s)`, icone: "caixa", tom: "azul" },
    { rotulo: "Turnos com quebra", valor: N(turnos?.quebras), formato: "numero", detalhe: "Divergência por forma em turnos fechados", icone: "alerta", tom: "laranja" },
    { rotulo: "Sangrias registradas", valor: N(sangrias?.valor), formato: "moeda", detalhe: `${N(sangrias?.total)} movimentação(ões) no período`, icone: "carteira", tom: "verde" },
    { rotulo: "Homologações registradas", valor: N(homologacoes?.total), formato: "numero", detalhe: "Aprovações efetivas, não solicitações", icone: "check", tom: "roxo" },
  ];
  const offset = (f.pagina - 1) * f.tamanhoPagina;
  let linhas: LinhaRelatorioPdv[]; let total: number;
  if (f.detalhe === "sangrias") {
    const rows = await db.select({ id: caixaMovimentos.id, data: caixaMovimentos.createdAt, numero: caixaSessoes.numero, terminal: caixaSessoes.terminal, operador: caixaSessoes.operadorNome, responsavel: caixaMovimentos.usuarioNome, forma: caixaMovimentos.forma, valor: caixaMovimentos.valor, motivo: caixaMovimentos.motivo }).from(caixaMovimentos).innerJoin(caixaSessoes, joinMov).where(whereSangrias).orderBy(desc(caixaMovimentos.createdAt), desc(caixaMovimentos.id)).limit(f.tamanhoPagina).offset(offset);
    linhas = rows.map((r) => ({ data: iso(r.data), turno: `#${r.numero}`, terminal: r.terminal, operador: r.operador, responsavel: r.responsavel, forma: rotuloForma(r.forma), valor: N(r.valor), motivo: r.motivo })); total = N(sangrias?.total);
  } else {
    const rows = await db.select().from(caixaSessoes).where(whereTurnos).orderBy(desc(caixaSessoes.abertoEm), desc(caixaSessoes.id)).limit(f.tamanhoPagina).offset(offset);
    linhas = rows.map((r) => {
      // Blind balance: turno aberto nunca expõe saldo esperado nem declarado nesta API.
      const fechado = r.status === "fechado" && Boolean(r.fechadoEm);
      const dinheiro = fechado ? comparacao(r.valoresEsperados, r.valoresInformados, ["dinheiro"]) : { esperado: null, declarado: null, diferenca: null };
      const pix = fechado ? comparacao(r.valoresEsperados, r.valoresInformados, ["pix"]) : { esperado: null, declarado: null, diferenca: null };
      const cartoes = fechado ? comparacao(r.valoresEsperados, r.valoresInformados, ["credito", "debito"]) : { esperado: null, declarado: null, diferenca: null };
      return { sessaoId: r.id, turno: `#${r.numero}`, terminal: r.terminal, operador: r.operadorNome, abertoEm: iso(r.abertoEm), fechadoEm: iso(r.fechadoEm), status: r.status === "aberto" ? "Aberto" : "Fechado", dinheiroEsperado: dinheiro.esperado, dinheiroDeclarado: dinheiro.declarado, dinheiroDiferenca: dinheiro.diferenca, pixEsperado: pix.esperado, pixDeclarado: pix.declarado, pixDiferenca: pix.diferenca, cartoesEsperado: cartoes.esperado, cartoesDeclarado: cartoes.declarado, cartoesDiferenca: cartoes.diferenca, aprovacao: r.statusAprovacao ?? "—", lacre: "Não registrado" };
    }); total = N(turnos?.total);
  }
  return { indicadores, linhas, total, avisos: ["Turnos são filtrados pela abertura; sangrias e homologações, pela data da movimentação ou aprovação.", "Os valores esperados e declarados são snapshots de turnos fechados; turnos abertos não revelam saldos.", "A correção de homologação por forma vale para novos fechamentos. Turnos antigos com faltas e sobras compensadas podem não ter homologação registrada e precisam de revisão manual.", "O sistema não registra código de lacre, tentativas de senha ou uma classificação específica para sangria de segurança."] };
}

async function desempenhoOperadores(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const { ativas } = await selecionarVendas(empresaId, f, fuso); const ids = ativas.map((v) => v.id);
  const resumo = await resumoVendas(empresaId, ids);
  const where = and(eq(vendas.empresaId, empresaId), emIds(vendas.id, ids));
  const grupos = db.select({ nome: nomeOperadorVenda.as("nome"), usuarioId: idOperadorVenda.as("usuario_id") }).from(vendas).leftJoin(caixaSessoes, juncaoSessaoVenda(empresaId)).where(where).groupBy(nomeOperadorVenda, idOperadorVenda).as("operadores_agrupados");
  const [totalGrupos] = await db.select({ total: count() }).from(grupos);
  const rows = await db.select({ nome: nomeOperadorVenda, usuarioId: idOperadorVenda, vendas: count(), faturamento: sql<number>`coalesce(sum(${vendas.total}),0)`.mapWith(Number) }).from(vendas).leftJoin(caixaSessoes, juncaoSessaoVenda(empresaId)).where(where).groupBy(nomeOperadorVenda, idOperadorVenda).orderBy(desc(sql`sum(${vendas.total})`), asc(nomeOperadorVenda), asc(idOperadorVenda)).limit(f.tamanhoPagina).offset((f.pagina - 1) * f.tamanhoPagina);
  const quebras = await db.select({ nome: caixaSessoes.operadorNome, usuarioId: caixaSessoes.operadorId, quantidade: count(), valor: sql<number>`coalesce(sum(${quebraAbsoluta}),0)`.mapWith(Number) }).from(caixaSessoes).where(and(filtroSessao(empresaId, f), eq(caixaSessoes.status, "fechado"), noPeriodo(caixaSessoes.fechadoEm, f, fuso))).groupBy(caixaSessoes.operadorNome, caixaSessoes.operadorId);
  const porOperador = new Map(quebras.map((q) => [`${q.usuarioId}|${q.nome}`, q]));
  const linhas: LinhaRelatorioPdv[] = rows.map((r) => {
    const q = porOperador.get(`${r.usuarioId}|${r.nome}`); const valor = q ? arred(N(q.valor)) : null; const faturamento = arred(N(r.faturamento));
    return { operador: r.nome, usuarioId: r.usuarioId || null, vendas: N(r.vendas), faturamento, quebra: valor, acuracia: valor == null || faturamento <= 0 ? null : arred(Math.max(0, 100 - valor / faturamento * 100)), tempo: "Não registrado" };
  });
  return {
    indicadores: [
      { rotulo: "Operadores", valor: N(totalGrupos?.total), formato: "numero", detalhe: "Com vendas no período", icone: "pessoas", tom: "azul" },
      { rotulo: "Vendas concluídas", valor: resumo.quantidade, formato: "numero", detalhe: "Operações comerciais únicas", icone: "caixa", tom: "verde" },
      { rotulo: "Faturamento líquido", valor: resumo.liquido, formato: "moeda", detalhe: "Somatório das vendas atribuídas", icone: "grafico", tom: "roxo" },
      { rotulo: "Tempo de atendimento", valor: null, detalhe: "Não registrado pelo PDV atual", icone: "alerta", tom: "laranja" },
    ] as IndicadorRelatorioPdv[], linhas, total: N(totalGrupos?.total),
    avisos: [...avisoHistorico(ativas), "Acurácia estimada = 100 − (soma absoluta das quebras / faturamento × 100), limitada a zero. Sem fechamento no período, fica indisponível.", "Vendas usam sua data; quebras usam a data de fechamento. O ID é do usuário logado na sessão e pode ser compartilhado; o nome é o operador escolhido na abertura.", "A duração real do atendimento não é registrada; intervalos entre vendas não são usados como substituto."],
  };
}

async function cancelamentos(empresaId: string, f: FiltrosRelatorioPdv, fuso: string) {
  const { ativas } = await selecionarVendas(empresaId, f, fuso);
  const resumo = await resumoVendas(empresaId, ativas.map((v) => v.id));
  const joinVenda = and(sql`${vendas.id}::text = ${auditorias.registroId}`, eq(vendas.empresaId, empresaId));
  const condicao = and(eq(auditorias.empresaId, empresaId), eq(auditorias.acao, "venda.cancelar"), eq(auditorias.entidade, "venda"), eq(vendas.status, "cancelado"), sql`${vendas.tipo} <> 'dav'`, noPeriodo(auditorias.createdAt, f, fuso), f.terminal ? eq(terminalVenda, f.terminal) : undefined, f.operador ? or(ilike(nomeOperadorVenda, padraoBusca(f.operador)), ilike(idOperadorVenda, padraoBusca(f.operador))) : undefined);
  const [totais] = await db.select({ total: count(), valor: sql<number>`coalesce(sum(${vendas.total}),0)`.mapWith(Number) }).from(auditorias).innerJoin(vendas, joinVenda).leftJoin(caixaSessoes, juncaoSessaoVenda(empresaId)).where(condicao);
  const rows = await db.select({ id: auditorias.id, canceladoEm: auditorias.createdAt, numero: vendas.numero, numeroNota: vendas.numeroNota, valor: vendas.total, operador: nomeOperadorVenda, responsavel: auditorias.usuarioNome, alteracoes: auditorias.alteracoes }).from(auditorias).innerJoin(vendas, joinVenda).leftJoin(caixaSessoes, juncaoSessaoVenda(empresaId)).where(condicao).orderBy(desc(auditorias.createdAt), desc(auditorias.id)).limit(f.tamanhoPagina).offset((f.pagina - 1) * f.tamanhoPagina);
  const linhas: LinhaRelatorioPdv[] = rows.map((r) => ({ canceladoEm: iso(r.canceladoEm), numero: `#${r.numeroNota ?? r.numero}`, valor: N(r.valor), operador: r.operador, responsavel: r.responsavel, motivo: String((r.alteracoes ?? {}).motivo ?? "Não registrado"), autorizador: "Não registrado" }));
  return {
    indicadores: [
      { rotulo: "Cupons cancelados", valor: N(totais?.total), formato: "numero", detalhe: "Eventos auditados no período", icone: "documento", tom: "laranja" },
      { rotulo: "Valor cancelado", valor: arred(N(totais?.valor)), formato: "moeda", detalhe: "Cupons com cancelamento auditado", icone: "alerta", tom: "laranja" },
      { rotulo: "Descontos aplicados", valor: resumo.desconto, formato: "moeda", detalhe: "Sobre vendas concluídas no período", icone: "menos", tom: "azul" },
      { rotulo: "Desconto / faturamento", valor: resumo.liquido > 0 ? arred(resumo.desconto / resumo.liquido * 100) : null, formato: "percentual", detalhe: "Descontos divididos pelo faturamento líquido", icone: "grafico", tom: "roxo" },
    ] as IndicadorRelatorioPdv[], linhas, total: N(totais?.total),
    avisos: [...avisoHistorico(ativas), "Cancelamentos são exibidos pela data da auditoria. Registros antigos sem evento auditado não têm data de cancelamento confiável e não aparecem nesta lista.", "Itens removidos durante a venda, autorizações de gerente e devoluções de venda não são registrados neste modelo. Devoluções de compra não são tratadas como devolução de cliente."],
  };
}

export async function obterRelatorioPdv(empresaId: string, empresa: string, f: FiltrosRelatorioPdv, fuso: string): Promise<RespostaRelatorioPdv> {
  const [dados, filtros] = await Promise.all([
    f.aba === "visao" ? visaoGeral(empresaId, f, fuso)
      : f.aba === "produtos" ? rankingProdutos(empresaId, f, fuso)
      : f.aba === "caixa" ? auditoriaCaixa(empresaId, f, fuso)
      : f.aba === "operadores" ? desempenhoOperadores(empresaId, f, fuso)
      : cancelamentos(empresaId, f, fuso),
    opcoes(empresaId),
  ]);
  return { ok: true, aba: f.aba, detalhe: f.detalhe, empresa, fuso, filtros: f, colunas: colunasRelatorioPdv(f.aba, f.detalhe), indicadores: dados.indicadores, linhas: dados.linhas, total: dados.total, paginas: Math.max(1, Math.ceil(dados.total / f.tamanhoPagina)), avisos: dados.avisos, opcoes: filtros };
}
