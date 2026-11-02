/**
 * NKWAY — Motor puro de Pagamento Dividido, Troco Seguro e Validação de Crédito do PDV (Complemento 2 de 3).
 *
 * Regras de negócio:
 * 1. Somente `dinheiro` pode ultrapassar o saldo restante da venda e gerar troco.
 * 2. Formas eletrônicas ou faturadas (`pix`, `credito`, `debito`, `boleto`, `prazo`) são limitadas ao saldo restante.
 * 3. Quando o saldo já está quitado (`falta === 0`), novos lançamentos são recusados até remover/editar uma parcela.
 * 4. Vendas com parcela `prazo` ou `boleto` (exceto DAV, que é orçamento) exigem cliente cadastrado (`clienteId`)
 *    e respeitam `limiteCredito` quando `limiteCredito > 0` (`saldoEmAberto + valorAPrazo <= limiteCredito`).
 */

import { FORMAS_PAGAMENTO, moeda, rotuloForma, round2, valorAPrazo } from "@/lib/dominio";

export type ParcelaPagamentoPdv = {
  forma: string;
  valor: number;
};

export type ClienteCreditoPdv = {
  id: string;
  nome: string;
  documento?: string;
  condicaoPadrao?: string;
  limiteCredito: number;
  saldoEmAberto: number;
};

export type ResumoPagamentoPdv = {
  total: number;
  pago: number;
  pagoDinheiro: number;
  pagoOutrasFormas: number;
  falta: number;
  troco: number;
  quitado: boolean;
  valorAPrazo: number;
  formaPrincipal: string;
};

const FORMAS_VALIDAS = new Set<string>(FORMAS_PAGAMENTO.map((f) => f.id));

export function formaPagamentoValidaPdv(forma: string): boolean {
  return FORMAS_VALIDAS.has(String(forma ?? "").trim().toLowerCase());
}

/** Converte texto monetário pt-BR ("50", "50,50", "1.234,56", "50.5") em número positivo arredondado em 2 casas */
export function lerValorMonetarioPdv(entrada: string | number | null | undefined): number {
  if (typeof entrada === "number") {
    return Number.isFinite(entrada) ? round2(entrada) : NaN;
  }
  const limpo = String(entrada ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s+/g, "");
  if (!limpo) return NaN;

  let normalizado = limpo;
  if (limpo.includes(",") && limpo.includes(".")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (limpo.includes(",")) {
    normalizado = limpo.replace(",", ".");
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return NaN;
  const n = Number(normalizado);
  return Number.isFinite(n) ? round2(n) : NaN;
}

/** Calcula pago, falta, troco (exclusivo de dinheiro), quitação e parcela a prazo */
export function calcularResumoPagamentoPdv(
  pagamentos: readonly ParcelaPagamentoPdv[],
  totalVenda: number,
): ResumoPagamentoPdv {
  const total = round2(Math.max(0, Number(totalVenda) || 0));
  const validos = (Array.isArray(pagamentos) ? pagamentos : []).filter(
    (p) => p && Number.isFinite(p.valor) && round2(p.valor) > 0,
  );

  const pagoDinheiro = round2(
    validos.filter((p) => p.forma === "dinheiro").reduce((s, p) => s + round2(p.valor), 0),
  );
  const pagoOutrasFormas = round2(
    validos.filter((p) => p.forma !== "dinheiro").reduce((s, p) => s + round2(p.valor), 0),
  );
  const pago = round2(pagoDinheiro + pagoOutrasFormas);
  const falta = round2(Math.max(0, total - pago));

  // Troco real: apenas o excedente coberto por dinheiro físico pode virar troco em espécie
  const saldoCobertoPorDinheiro = round2(Math.max(0, total - pagoOutrasFormas));
  const troco = round2(Math.max(0, pagoDinheiro - saldoCobertoPorDinheiro));
  const quitado = total > 0 && falta <= 0.009;

  const formaPrincipal =
    validos.length > 0
      ? validos.slice().sort((a, b) => b.valor - a.valor)[0].forma
      : "dinheiro";

  const aPrazo = valorAPrazo(
    validos.map((p) => ({ forma: p.forma, valor: round2(p.valor) })),
    total,
    formaPrincipal,
  );

  return {
    total,
    pago,
    pagoDinheiro,
    pagoOutrasFormas,
    falta,
    troco,
    quitado,
    valorAPrazo: aPrazo,
    formaPrincipal,
  };
}

export type ResultadoLancamentoPagamentoPdv =
  | {
      ok: true;
      pagamentos: ParcelaPagamentoPdv[];
      valorAplicado: number;
      limitadoAoSaldo: boolean;
      resumo: ResumoPagamentoPdv;
      mensagem: string;
    }
  | {
      ok: false;
      erro: string;
    };

/**
 * Registra uma parcela de pagamento na venda atual.
 * - `dinheiro` pode superar o restante (calculando troco).
 * - Demais formas são limitadas automaticamente ao saldo restante.
 * - Consolida parcelas da mesma forma sem duplicar linhas.
 */
export function registrarParcelaPagamentoPdv(params: {
  pagamentosAtuais: readonly ParcelaPagamentoPdv[];
  totalVenda: number;
  forma: string;
  valorInformado: number | string;
}): ResultadoLancamentoPagamentoPdv {
  const total = round2(Math.max(0, Number(params.totalVenda) || 0));
  if (total <= 0) {
    return { ok: false, erro: "Adicione itens com valor maior que zero antes de lançar pagamento." };
  }

  const forma = String(params.forma ?? "").trim().toLowerCase();
  if (!formaPagamentoValidaPdv(forma)) {
    return { ok: false, erro: "Selecione uma forma de pagamento válida." };
  }

  const resumoAntes = calcularResumoPagamentoPdv(params.pagamentosAtuais, total);
  if (resumoAntes.falta <= 0.009) {
    return {
      ok: false,
      erro: "Saldo já quitado. Remova uma parcela ou clique em Zerar para alterar.",
    };
  }

  const lido = lerValorMonetarioPdv(params.valorInformado);
  if (!Number.isFinite(lido) || lido <= 0) {
    return { ok: false, erro: "Informe um valor de pagamento maior que zero." };
  }

  let valorAplicado = round2(lido);
  let limitadoAoSaldo = false;

  if (forma !== "dinheiro" && valorAplicado > resumoAntes.falta) {
    valorAplicado = resumoAntes.falta;
    limitadoAoSaldo = true;
  }

  const atuais = (params.pagamentosAtuais ?? []).map((p) => ({
    forma: p.forma,
    valor: round2(p.valor),
  }));
  const idxExistente = atuais.findIndex((p) => p.forma === forma);
  const novos =
    idxExistente >= 0
      ? atuais.map((p, i) => (i === idxExistente ? { ...p, valor: round2(p.valor + valorAplicado) } : p))
      : [...atuais, { forma, valor: valorAplicado }];

  const resumo = calcularResumoPagamentoPdv(novos, total);
  const sufixoLimite = limitadoAoSaldo ? " (ajustado ao saldo; troco só em dinheiro)" : "";
  const mensagem =
    resumo.falta > 0
      ? `${rotuloForma(forma)}: ${moeda(valorAplicado)} lançado${sufixoLimite}. Falta ${moeda(resumo.falta)}.`
      : resumo.troco > 0
        ? `${rotuloForma(forma)}: ${moeda(valorAplicado)} lançado. Venda quitada · Troco ${moeda(resumo.troco)}.`
        : `${rotuloForma(forma)}: ${moeda(valorAplicado)} lançado${sufixoLimite}. Venda quitada.`;

  return {
    ok: true,
    pagamentos: novos,
    valorAplicado,
    limitadoAoSaldo,
    resumo,
    mensagem,
  };
}

/**
 * Edita o valor de uma parcela já lançada pelo índice, mantendo a trava de que
 * formas não-dinheiro não podem ultrapassar o saldo restante das demais parcelas.
 */
export function editarParcelaPagamentoPdv(params: {
  pagamentosAtuais: readonly ParcelaPagamentoPdv[];
  totalVenda: number;
  indice: number;
  novoValor: number | string;
}): { pagamentos: ParcelaPagamentoPdv[]; limitadoAoSaldo: boolean; resumo: ResumoPagamentoPdv } {
  const total = round2(Math.max(0, Number(params.totalVenda) || 0));
  const lista = (params.pagamentosAtuais ?? []).map((p) => ({ forma: p.forma, valor: round2(p.valor) }));
  const alvo = lista[params.indice];
  if (!alvo) {
    return {
      pagamentos: lista,
      limitadoAoSaldo: false,
      resumo: calcularResumoPagamentoPdv(lista, total),
    };
  }

  const lido = lerValorMonetarioPdv(params.novoValor);
  const valorBruto = Number.isFinite(lido) && lido > 0 ? round2(lido) : 0;

  if (valorBruto <= 0) {
    const semAlvo = lista.filter((_, i) => i !== params.indice);
    return {
      pagamentos: semAlvo,
      limitadoAoSaldo: false,
      resumo: calcularResumoPagamentoPdv(semAlvo, total),
    };
  }

  const somaDemais = round2(lista.reduce((s, p, i) => (i === params.indice ? s : s + p.valor), 0));
  const maximoSemTroco = round2(Math.max(0, total - somaDemais));

  let valorFinal = valorBruto;
  let limitadoAoSaldo = false;
  if (alvo.forma !== "dinheiro" && valorFinal > maximoSemTroco) {
    valorFinal = maximoSemTroco;
    limitadoAoSaldo = true;
  }

  const atualizados =
    valorFinal <= 0
      ? lista.filter((_, i) => i !== params.indice)
      : lista.map((p, i) => (i === params.indice ? { ...p, valor: valorFinal } : p));

  return {
    pagamentos: atualizados,
    limitadoAoSaldo,
    resumo: calcularResumoPagamentoPdv(atualizados, total),
  };
}

/**
 * Normaliza as parcelas para persistência em `nk_venda.pagamentos`:
 * - Retorna `troco` calculado apenas sobre o excedente em `dinheiro`.
 * - Abate o `troco` da parcela de `dinheiro` gravada para que a soma líquida das parcelas
 *   seja exatamente igual ao `totalVenda` (consistente com `ratearPagamentosLiquidos` e `pdv-6`).
 */
export function normalizarPagamentosLiquidosPdv(
  pagamentosBrutos: readonly ParcelaPagamentoPdv[],
  totalVenda: number,
): {
  ok: true;
  pagamentosLiquidos: ParcelaPagamentoPdv[];
  troco: number;
} | {
  ok: false;
  erro: string;
} {
  const total = round2(Math.max(0, Number(totalVenda) || 0));
  if (total <= 0) {
    return { ok: true, pagamentosLiquidos: [], troco: 0 };
  }

  const consolidados = new Map<string, number>();
  for (const p of pagamentosBrutos ?? []) {
    const forma = String(p?.forma ?? "dinheiro").trim().toLowerCase() || "dinheiro";
    const val = round2(Math.max(0, Number(p?.valor) || 0));
    if (val <= 0) continue;
    consolidados.set(forma, round2((consolidados.get(forma) ?? 0) + val));
  }

  if (consolidados.size === 0) {
    return {
      ok: true,
      pagamentosLiquidos: [{ forma: "dinheiro", valor: total }],
      troco: 0,
    };
  }

  let somaNaoDinheiro = 0;
  for (const [forma, val] of consolidados.entries()) {
    if (forma !== "dinheiro") somaNaoDinheiro = round2(somaNaoDinheiro + val);
  }

  if (somaNaoDinheiro > total + 0.01) {
    return {
      ok: false,
      erro: "Pagamentos em PIX, cartão, boleto ou a prazo não podem ultrapassar o total da venda (troco permitido apenas em dinheiro).",
    };
  }

  const dinheiroBruto = consolidados.get("dinheiro") ?? 0;
  const somaTotal = round2(somaNaoDinheiro + dinheiroBruto);
  if (somaTotal + 0.01 < total) {
    return {
      ok: false,
      erro: `Faltam ${moeda(round2(total - somaTotal))} em pagamentos.`,
    };
  }

  const troco = round2(Math.max(0, somaTotal - total));
  if (dinheiroBruto > 0) {
    const dinheiroLiquido = round2(Math.max(0, dinheiroBruto - troco));
    if (dinheiroLiquido > 0) consolidados.set("dinheiro", dinheiroLiquido);
    else consolidados.delete("dinheiro");
  }

  const pagamentosLiquidos: ParcelaPagamentoPdv[] = Array.from(consolidados.entries()).map(([forma, valor]) => ({
    forma,
    valor: round2(valor),
  }));

  return {
    ok: true,
    pagamentosLiquidos,
    troco,
  };
}

/** Sugere cédulas rápidas em reais para agilizar o recebimento em dinheiro */
export function sugerirCedulasDinheiroPdv(restante: number): number[] {
  const base = round2(Math.max(0, restante));
  if (base <= 0) return [];
  const notas = [10, 20, 50, 100, 200];
  const opcoes = new Set<number>([base]);
  for (const n of notas) {
    if (n >= base) opcoes.add(n);
    const multiplo = Math.ceil(base / n) * n;
    if (multiplo >= base && multiplo <= base + 200) opcoes.add(round2(multiplo));
  }
  return Array.from(opcoes)
    .sort((a, b) => a - b)
    .slice(0, 5);
}

export type ValidacaoCreditoPdv =
  | {
      ok: true;
      valorAPrazo: number;
      limiteDisponivel: number | null;
      novoSaldoAberto: number;
    }
  | {
      ok: false;
      erro: string;
      codigo: "cliente_obrigatorio" | "limite_excedido";
      valorAPrazo: number;
      limiteDisponivel: number | null;
    };

/**
 * Valida vendas com parcela `prazo` ou `boleto`:
 * - DAV (orçamento) não movimenta financeiro e passa sempre.
 * - Venda efetiva (`sem_nota` ou `emitir_nfce` / `fiscal`) a prazo exige cliente identificado (`cliente`).
 * - Quando `cliente.limiteCredito > 0`, exige `saldoEmAberto + valorAPrazo <= limiteCredito`.
 */
export function validarCreditoVendaPdv(params: {
  modo: "dav" | "sem_nota" | "emitir_nfce" | "fiscal";
  pagamentos: readonly ParcelaPagamentoPdv[];
  totalVenda: number;
  cliente: ClienteCreditoPdv | null;
}): ValidacaoCreditoPdv {
  const total = round2(Math.max(0, Number(params.totalVenda) || 0));
  if (params.modo === "dav" || total <= 0) {
    return { ok: true, valorAPrazo: 0, limiteDisponivel: null, novoSaldoAberto: params.cliente?.saldoEmAberto ?? 0 };
  }

  const efetivos =
    params.pagamentos.length > 0 ? params.pagamentos : [{ forma: "dinheiro", valor: total }];
  const resumo = calcularResumoPagamentoPdv(efetivos, total);
  const aPrazo = resumo.valorAPrazo;

  if (aPrazo <= 0) {
    const disp =
      params.cliente && params.cliente.limiteCredito > 0
        ? round2(Math.max(0, params.cliente.limiteCredito - params.cliente.saldoEmAberto))
        : null;
    return {
      ok: true,
      valorAPrazo: 0,
      limiteDisponivel: disp,
      novoSaldoAberto: round2(params.cliente?.saldoEmAberto ?? 0),
    };
  }

  if (!params.cliente || !params.cliente.id) {
    return {
      ok: false,
      codigo: "cliente_obrigatorio",
      valorAPrazo: aPrazo,
      limiteDisponivel: null,
      erro: "Identifique um cliente cadastrado (F8) para registrar venda a prazo ou boleto.",
    };
  }

  const limite = round2(Math.max(0, Number(params.cliente.limiteCredito) || 0));
  const emAberto = round2(Math.max(0, Number(params.cliente.saldoEmAberto) || 0));
  const novoSaldo = round2(emAberto + aPrazo);

  if (limite > 0) {
    const disponivel = round2(Math.max(0, limite - emAberto));
    if (novoSaldo > limite + 0.009) {
      return {
        ok: false,
        codigo: "limite_excedido",
        valorAPrazo: aPrazo,
        limiteDisponivel: disponivel,
        erro: `Limite de crédito insuficiente para ${params.cliente.nome}: a prazo ${moeda(aPrazo)}, disponível ${moeda(disponivel)} (limite ${moeda(limite)}, em aberto ${moeda(emAberto)}).`,
      };
    }
    return {
      ok: true,
      valorAPrazo: aPrazo,
      limiteDisponivel: round2(Math.max(0, limite - novoSaldo)),
      novoSaldoAberto: novoSaldo,
    };
  }

  return {
    ok: true,
    valorAPrazo: aPrazo,
    limiteDisponivel: null,
    novoSaldoAberto: novoSaldo,
  };
}
