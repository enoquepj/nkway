/**
 * Indicadores de estoque (puros, testáveis): giro, cobertura, sugestão de compra e curva ABC.
 * Referências de prática de mercado (Bling, Omie, TOTVS): cobertura em dias = saldo ÷ média diária de saída;
 * sugestão de compra = (média diária × (lead time + dias de cobertura desejada)) − saldo − pendente; ABC por valor de saída.
 * Nada aqui é regra fiscal; são apoios de gestão e dependem da janela de vendas escolhida.
 */

export type VendaAgregada = { produtoId: string; qtd30: number; qtd90: number; valor90: number; ultimaVenda: string | null };
export type ProdutoBase = { id: string; estoque: number; estoqueMin: number; custo: number; preco: number; ativo: boolean };

export type IndicadorProduto = {
  mediaDiaria30: number;
  mediaDiaria90: number;
  /** Dias de cobertura com a média de 30 dias (null = sem saída no período). */
  coberturaDias: number | null;
  /** Quantidade sugerida para repor até `diasCobertura` + `leadTimeDias`, já descontando o saldo. */
  sugestaoCompra: number;
  /** Giro no período de 90 dias: saída ÷ estoque médio aproximado (saldo atual). */
  giro90: number | null;
  classeAbc: "A" | "B" | "C" | "—";
  diasSemVenda: number | null;
  /** "parado" = ativo, com saldo e sem venda nos últimos 90 dias. */
  parado: boolean;
  situacaoReposicao: "ruptura" | "repor" | "atencao" | "ok" | "excesso";
};

export type ParametrosIndicadores = { diasCobertura: number; leadTimeDias: number; hoje?: Date };
export const PARAMETROS_PADRAO: ParametrosIndicadores = { diasCobertura: 15, leadTimeDias: 7 };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function calcularIndicadores(produtos: ProdutoBase[], vendas: VendaAgregada[], params: ParametrosIndicadores = PARAMETROS_PADRAO): Map<string, IndicadorProduto> {
  const hoje = params.hoje ?? new Date();
  const porProduto = new Map(vendas.map((v) => [v.produtoId, v]));
  // Curva ABC por valor vendido em 90 dias: A até 80% acumulado, B até 95%, C o restante; sem venda = "—".
  const ordenado = [...produtos].map((p) => ({ id: p.id, valor: porProduto.get(p.id)?.valor90 ?? 0 })).filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = ordenado.reduce((s, x) => s + x.valor, 0);
  const classe = new Map<string, "A" | "B" | "C">();
  let acumulado = 0;
  for (const x of ordenado) {
    acumulado += x.valor;
    const pct = total > 0 ? acumulado / total : 1;
    classe.set(x.id, pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C");
  }
  const resultado = new Map<string, IndicadorProduto>();
  for (const p of produtos) {
    const v = porProduto.get(p.id);
    const mediaDiaria30 = r3((v?.qtd30 ?? 0) / 30);
    const mediaDiaria90 = r3((v?.qtd90 ?? 0) / 90);
    const coberturaDias = mediaDiaria30 > 0 ? Math.round(p.estoque / mediaDiaria30) : null;
    const alvo = mediaDiaria30 * (params.diasCobertura + params.leadTimeDias);
    const sugestaoCompra = Math.max(0, r3(Math.max(alvo, p.estoqueMin) - p.estoque));
    const giro90 = p.estoque > 0 && (v?.qtd90 ?? 0) > 0 ? r3((v?.qtd90 ?? 0) / p.estoque) : null;
    const diasSemVenda = v?.ultimaVenda ? Math.max(0, Math.floor((hoje.getTime() - new Date(v.ultimaVenda).getTime()) / 86400000)) : null;
    const parado = p.ativo && p.estoque > 0 && (v?.qtd90 ?? 0) === 0;
    let situacaoReposicao: IndicadorProduto["situacaoReposicao"] = "ok";
    if (p.estoque <= 0 && (mediaDiaria30 > 0 || p.estoqueMin > 0)) situacaoReposicao = "ruptura";
    else if (p.estoque <= p.estoqueMin || (coberturaDias !== null && coberturaDias < params.leadTimeDias)) situacaoReposicao = "repor";
    else if (coberturaDias !== null && coberturaDias < params.diasCobertura + params.leadTimeDias) situacaoReposicao = "atencao";
    else if (coberturaDias !== null && coberturaDias > 180) situacaoReposicao = "excesso";
    resultado.set(p.id, { mediaDiaria30, mediaDiaria90, coberturaDias, sugestaoCompra, giro90, classeAbc: classe.get(p.id) ?? "—", diasSemVenda, parado, situacaoReposicao });
  }
  return resultado;
}

export const ROTULO_REPOSICAO: Record<IndicadorProduto["situacaoReposicao"], { rotulo: string; tom: "erro" | "alerta" | "info" | "ok" | "neutro" }> = {
  ruptura: { rotulo: "Ruptura", tom: "erro" },
  repor: { rotulo: "Repor", tom: "alerta" },
  atencao: { rotulo: "Atenção", tom: "info" },
  ok: { rotulo: "OK", tom: "ok" },
  excesso: { rotulo: "Excesso", tom: "neutro" },
};

/** Resumo de um extrato de kardex filtrado (saldo anterior, entradas, saídas, saldo final) para um único produto. */
export function resumirExtrato(movs: { qtd: number; saldoApos: number; data: string }[]): { saldoAnterior: number; entradas: number; saidas: number; saldoFinal: number; lancamentos: number } | null {
  if (!movs.length) return null;
  const ordenados = [...movs].sort((a, b) => a.data.localeCompare(b.data));
  const primeiro = ordenados[0];
  const saldoAnterior = r3(primeiro.saldoApos - primeiro.qtd);
  const entradas = r3(ordenados.filter((m) => m.qtd > 0).reduce((s, m) => s + m.qtd, 0));
  const saidas = r3(ordenados.filter((m) => m.qtd < 0).reduce((s, m) => s - m.qtd, 0));
  return { saldoAnterior, entradas, saidas, saldoFinal: ordenados[ordenados.length - 1].saldoApos, lancamentos: ordenados.length };
}

/** Lê uma quantidade digitada ("12", "12,5", "12.5"); null quando inválida. Nunca negativa para contagem. */
export function lerQuantidade(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? r3(bruto) : null;
  if (typeof bruto !== "string") return null;
  const t = bruto.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(t)) return null;
  return r3(Number(t));
}
