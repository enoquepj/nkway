/**
 * NKWAY — Motor puro de cálculos de Sessão e Fechamento de Caixa (Fase 2).
 * Compartilhado entre interface, Server Actions e bateria de testes.
 */
import { FORMAS_PAGAMENTO, round2 } from "@/lib/dominio";

export const FORMAS_CAIXA = FORMAS_PAGAMENTO.map((f) => ({ id: f.id, rotulo: f.label }));
export type FormaCaixaId = (typeof FORMAS_PAGAMENTO)[number]["id"];

export type VendaCaixaInput = {
  id: string;
  status: string;
  total: number;
  formaPagamento: string;
  pagamentos: { forma: string; valor: number }[];
};

export type MovimentoCaixaInput = {
  id: string;
  tipo: "suprimento" | "sangria" | "estorno" | "ajuste";
  forma: string;
  valor: number;
  motivo: string;
  vendaId?: string | null;
  usuarioNome: string;
  criadoEm: string;
};

export type ResumoFormaCaixa = {
  forma: string;
  rotulo: string;
  saldoInicial: number;
  vendas: number;
  suprimentos: number;
  sangrias: number;
  estornos: number;
  esperado: number;
};

export type ApuracaoCaixa = {
  porForma: ResumoFormaCaixa[];
  esperadosMap: Record<string, number>;
  saldoInicial: number;
  totalVendasBrutas: number;
  totalSuprimentos: number;
  totalSangrias: number;
  totalEstornos: number;
  totalEsperado: number;
  qtdVendasAtivas: number;
  qtdVendasCanceladas: number;
};

function mapaZerado(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const f of FORMAS_PAGAMENTO) m[f.id] = 0;
  return m;
}

/** Extrai o valor líquido recebido em cada forma de pagamento de uma venda (descontando troco em dinheiro) */
export function ratearPagamentosLiquidos(venda: Pick<VendaCaixaInput, "total" | "formaPagamento" | "pagamentos">): Record<string, number> {
  const out = mapaZerado();
  const pags = (venda.pagamentos ?? []).filter((p) => Number(p.valor) > 0);
  if (pags.length === 0) {
    const f = out[venda.formaPagamento] !== undefined ? venda.formaPagamento : "dinheiro";
    out[f] = round2(Math.max(0, Number(venda.total) || 0));
    return out;
  }

  let soma = 0;
  for (const p of pags) {
    const f = out[p.forma] !== undefined ? p.forma : "dinheiro";
    const v = round2(Math.max(0, Number(p.valor) || 0));
    out[f] = round2(out[f] + v);
    soma = round2(soma + v);
  }

  const total = round2(Math.max(0, Number(venda.total) || 0));
  const troco = round2(Math.max(0, soma - total));
  if (troco > 0) {
    out.dinheiro = round2(Math.max(0, out.dinheiro - troco));
  }
  return out;
}

/**
 * Calcula os saldos esperados por forma de pagamento de uma sessão de caixa:
 * esperado(forma) = saldoInicial(só dinheiro) + vendasBrutas(forma) + suprimentos(forma) - sangrias(forma) - estornos(forma)
 */
export function calcularApuracaoCaixa(params: {
  saldoInicial: number;
  vendas: VendaCaixaInput[];
  movimentos: MovimentoCaixaInput[];
}): ApuracaoCaixa {
  const saldoIni = round2(Math.max(0, Number(params.saldoInicial) || 0));
  const vendasPorForma = mapaZerado();
  const suprimentosPorForma = mapaZerado();
  const sangriasPorForma = mapaZerado();
  const estornosPorForma = mapaZerado();

  // Controla quais vendas canceladas já possuem movimento explícito de estorno registrado na sessão
  const vendasComEstornoMov = new Set(
    params.movimentos.filter((m) => m.tipo === "estorno" && m.vendaId).map((m) => String(m.vendaId)),
  );

  let qtdAtivas = 0;
  let qtdCanceladas = 0;

  for (const v of params.vendas) {
    const rateio = ratearPagamentosLiquidos(v);
    if (v.status === "cancelado") {
      qtdCanceladas++;
      // Contabiliza a venda original e o respectivo estorno para transparência contábil no resumo do caixa
      for (const f of Object.keys(vendasPorForma)) {
        vendasPorForma[f] = round2(vendasPorForma[f] + rateio[f]);
        if (!vendasComEstornoMov.has(v.id)) {
          estornosPorForma[f] = round2(estornosPorForma[f] + rateio[f]);
        }
      }
    } else {
      qtdAtivas++;
      for (const f of Object.keys(vendasPorForma)) {
        vendasPorForma[f] = round2(vendasPorForma[f] + rateio[f]);
      }
    }
  }

  for (const m of params.movimentos) {
    const f = vendasPorForma[m.forma] !== undefined ? m.forma : "dinheiro";
    const val = round2(Math.max(0, Number(m.valor) || 0));
    if (m.tipo === "suprimento") suprimentosPorForma[f] = round2(suprimentosPorForma[f] + val);
    else if (m.tipo === "sangria") sangriasPorForma[f] = round2(sangriasPorForma[f] + val);
    else if (m.tipo === "estorno") estornosPorForma[f] = round2(estornosPorForma[f] + val);
  }

  const esperadosMap: Record<string, number> = {};
  const porForma: ResumoFormaCaixa[] = FORMAS_PAGAMENTO.map((fp) => {
    const ini = fp.id === "dinheiro" ? saldoIni : 0;
    const esperado = round2(
      ini + vendasPorForma[fp.id] + suprimentosPorForma[fp.id] - sangriasPorForma[fp.id] - estornosPorForma[fp.id],
    );
    esperadosMap[fp.id] = esperado;
    return {
      forma: fp.id,
      rotulo: fp.label,
      saldoInicial: ini,
      vendas: vendasPorForma[fp.id],
      suprimentos: suprimentosPorForma[fp.id],
      sangrias: sangriasPorForma[fp.id],
      estornos: estornosPorForma[fp.id],
      esperado,
    };
  });

  const soma = (m: Record<string, number>) => round2(Object.values(m).reduce((s, v) => s + v, 0));

  return {
    porForma,
    esperadosMap,
    saldoInicial: saldoIni,
    totalVendasBrutas: soma(vendasPorForma),
    totalSuprimentos: soma(suprimentosPorForma),
    totalSangrias: soma(sangriasPorForma),
    totalEstornos: soma(estornosPorForma),
    totalEsperado: soma(esperadosMap),
    qtdVendasAtivas: qtdAtivas,
    qtdVendasCanceladas: qtdCanceladas,
  };
}

/** Compara valores esperados × informados no fechamento ou ajuste */
export function calcularConferenciaCaixa(
  esperados: Record<string, number>,
  informadosBrutos: Record<string, number>,
): {
  informados: Record<string, number>;
  diferencas: Record<string, number>;
  totalEsperado: number;
  totalInformado: number;
  diferencaTotal: number;
  temDivergencia: boolean;
} {
  const informados: Record<string, number> = {};
  const diferencas: Record<string, number> = {};
  let totalEsperado = 0;
  let totalInformado = 0;
  let temDivergencia = false;

  for (const fp of FORMAS_PAGAMENTO) {
    const esp = round2(Number(esperados[fp.id] ?? 0));
    const inf = round2(Math.max(0, Number(informadosBrutos[fp.id] ?? 0)));
    const dif = round2(inf - esp);
    informados[fp.id] = inf;
    diferencas[fp.id] = dif;
    totalEsperado = round2(totalEsperado + esp);
    totalInformado = round2(totalInformado + inf);
    if (Math.abs(dif) >= 0.01) temDivergencia = true;
  }

  return {
    informados,
    diferencas,
    totalEsperado,
    totalInformado,
    diferencaTotal: round2(totalInformado - totalEsperado),
    temDivergencia,
  };
}
