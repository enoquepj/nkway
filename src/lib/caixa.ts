/**
 * NKWAY — Motor puro de cálculos de Sessão e Fechamento de Caixa (Fase 2 + correção 2026-11).
 * Compartilhado entre interface, Server Actions, relatórios futuros e bateria de testes.
 *
 * Regra central (uma só, testável): uma venda compõe o caixa quando pertence à MESMA empresa e à
 * MESMA sessão (`caixaSessaoId`), foi comercialmente concretizada (`faturado`/`cancelado`), tem
 * recebimento próprio (pagamentos ou total) e não é duplicata fiscal de outra operação já contada.
 * Presença de chave/protocolo/tipo fiscal NÃO é requisito. DAV aberto é orçamento e nunca entra.
 */
import { FORMAS_PAGAMENTO, round2 } from "@/lib/dominio";

export const FORMAS_CAIXA = FORMAS_PAGAMENTO.map((f) => ({ id: f.id, rotulo: f.label }));
export type FormaCaixaId = (typeof FORMAS_PAGAMENTO)[number]["id"];

/** Formas que não representam dinheiro em gaveta: entram no esperado da própria forma e viram contas a receber. */
export const FORMAS_NAO_FISICAS: readonly string[] = ["boleto", "prazo"];

/** Parâmetros globais de segurança da gaveta (Etapa 2/2026). */
export const LIMITE_DINHEIRO_GAVETA = 800;
export const PERCENTUAL_BLOQUEIO_GAVETA = 1.2;
export const LIMITE_BLOQUEIO_GAVETA = round2(LIMITE_DINHEIRO_GAVETA * PERCENTUAL_BLOQUEIO_GAVETA);
export const FUNDO_TROCO_PADRAO = 100;

export type EstadoGaveta = "normal" | "alerta" | "bloqueado";

/** Estado lógico da gaveta — nunca expõe o valor ao operador, só o estado. */
export function estadoGavetaPorSaldo(saldoDinheiro: number): {
  estado: EstadoGaveta;
  bloquearVendaDinheiro: boolean;
} {
  const saldo = round2(Math.max(0, Number(saldoDinheiro) || 0));
  if (saldo >= LIMITE_BLOQUEIO_GAVETA) return { estado: "bloqueado", bloquearVendaDinheiro: true };
  if (saldo >= LIMITE_DINHEIRO_GAVETA) return { estado: "alerta", bloquearVendaDinheiro: false };
  return { estado: "normal", bloquearVendaDinheiro: false };
}

export type VendaCaixaInput = {
  id: string;
  status: string;
  total: number;
  formaPagamento: string;
  pagamentos: { forma: string; valor: number }[];
  /**
   * Campos de identidade econômica. São opcionais apenas por compatibilidade com chamadas
   * antigas/sintéticas: quando `caixaSessaoId` vem `undefined`, a venda é tratada como já
   * selecionada para a sessão; quando vem `null`, é "sem sessão" e NÃO entra.
   */
  tipo?: string;
  empresaId?: string | null;
  caixaSessaoId?: string | null;
  davOrigemId?: string | null;
  origem?: string | null;
  /** ids de outros registros da mesma operação econômica (preenchido pela deduplicação) */
  idsEquivalentes?: string[];
};

export type MovimentoCaixaInput = {
  id: string;
  /** `cofre` = recolhimento do saldo líquido no fechamento; ignorado pela apuração (não altera snapshot) */
  tipo: "suprimento" | "sangria" | "estorno" | "ajuste" | "cofre";
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

export type InconsistenciaCaixa = { vendaId: string; motivo: string };

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
  /** troco devolvido em dinheiro nas vendas consideradas (informativo; já descontado do esperado) */
  totalTroco: number;
  /** boleto + prazo esperados — volume de venda a receber, nunca dinheiro em gaveta */
  totalNaoFisico: number;
  /** esperado em espécie (gaveta física) */
  esperadoEmEspecie: number;
  /** vendas cujo recebimento não fecha (excesso sem dinheiro para troco etc.) */
  inconsistencias: InconsistenciaCaixa[];
  avisos: string[];
};

/* ------------------------------------------------------------------ rateio */

export type RateioPagamentos = {
  /** líquido por forma (troco já descontado do dinheiro) */
  porForma: Record<string, number>;
  /** soma bruta das parcelas válidas (ou o total, no fallback legado) */
  somaRecebida: number;
  /** troco devolvido — exclusivamente em dinheiro */
  troco: number;
  usouFallbackForma: boolean;
  parcelasIgnoradas: number;
  formasDesconhecidas: number;
  /** excesso recebido que não pôde virar troco por falta de dinheiro (PIX/cartão não geram troco) */
  inconsistencia: string | null;
};

function mapaZerado(): Record<string, number> {
  const m: Record<string, number> = {};
  for (const f of FORMAS_PAGAMENTO) m[f.id] = 0;
  return m;
}

function normalizarForma(forma: unknown, mapa: Record<string, number>): { forma: string; conhecida: boolean } {
  const f = String(forma ?? "").trim().toLowerCase();
  if (f && mapa[f] !== undefined) return { forma: f, conhecida: true };
  return { forma: "dinheiro", conhecida: Boolean(f) === false ? true : false };
}

/**
 * Rateia o recebimento de uma venda por forma de pagamento.
 * - parcela zero/negativa/NaN é ignorada e contada em `parcelasIgnoradas`;
 * - sem parcela válida → fallback legado por `formaPagamento` com o total;
 * - troco = somaRecebida − total (quando positivo) e sai SOMENTE do dinheiro;
 * - se o excesso não couber no dinheiro, nenhuma outra forma é reduzida: fica registrado em `inconsistencia`.
 */
export function ratearPagamentosDetalhado(
  venda: Pick<VendaCaixaInput, "total" | "formaPagamento" | "pagamentos">,
): RateioPagamentos {
  const out = mapaZerado();
  const total = round2(Math.max(0, Number(venda.total) || 0));
  const brutas = Array.isArray(venda.pagamentos) ? venda.pagamentos : [];
  let parcelasIgnoradas = 0;
  let formasDesconhecidas = 0;
  let soma = 0;
  let temValida = false;

  for (const p of brutas) {
    const v = Number((p as { valor?: unknown })?.valor);
    if (!Number.isFinite(v) || v <= 0) {
      parcelasIgnoradas++;
      continue;
    }
    const { forma, conhecida } = normalizarForma((p as { forma?: unknown })?.forma, out);
    if (!conhecida) formasDesconhecidas++;
    const val = round2(v);
    out[forma] = round2(out[forma] + val);
    soma = round2(soma + val);
    temValida = true;
  }

  if (!temValida) {
    const { forma } = normalizarForma(venda.formaPagamento, out);
    out[forma] = total;
    return {
      porForma: out,
      somaRecebida: total,
      troco: 0,
      usouFallbackForma: true,
      parcelasIgnoradas,
      formasDesconhecidas,
      inconsistencia: null,
    };
  }

  const excesso = round2(Math.max(0, soma - total));
  const dinheiroBruto = out.dinheiro;
  const troco = round2(Math.min(excesso, dinheiroBruto));
  if (troco > 0) out.dinheiro = round2(dinheiroBruto - troco);
  const sobra = round2(excesso - troco);
  const inconsistencia =
    sobra > 0.009
      ? `Recebido R$ ${soma.toFixed(2)} para um total de R$ ${total.toFixed(2)}: R$ ${sobra.toFixed(2)} excedentes em formas que não geram troco (PIX/cartão/boleto/prazo).`
      : null;

  return {
    porForma: out,
    somaRecebida: soma,
    troco,
    usouFallbackForma: false,
    parcelasIgnoradas,
    formasDesconhecidas,
    inconsistencia,
  };
}

/** Compatibilidade: líquido por forma (mesma regra do rateio detalhado). */
export function ratearPagamentosLiquidos(
  venda: Pick<VendaCaixaInput, "total" | "formaPagamento" | "pagamentos">,
): Record<string, number> {
  return ratearPagamentosDetalhado(venda).porForma;
}

/* ------------------------------------------------------ identidade econômica */

export type CodigoCaixa =
  | "venda_concreta"
  | "venda_cancelada"
  | "dav_concreto"
  | "dav_concreto_cancelado"
  | "outra_empresa"
  | "sem_sessao"
  | "outra_sessao"
  | "dav_orcamento"
  | "rascunho_aberto"
  | "status_nao_elegivel"
  | "sem_valor"
  | "duplicata_fiscal_de_dav";

export type ClassificacaoVendaCaixa = {
  vendaId: string;
  compoeCaixa: boolean;
  /** id da operação econômica única (a própria venda, ou o DAV concreto que ela apenas fiscaliza) */
  operacaoEconomicaId: string;
  /** registro cujos `pagamentos[]`/`formaPagamento` alimentam o caixa; `null` quando não compõe */
  registroFonteDoPagamento: string | null;
  codigo: CodigoCaixa;
  motivo: string;
  cancelada: boolean;
  avisos: string[];
};

export type ContextoSessaoCaixa = { empresaId: string; sessaoId: string };

function somaParcelasValidas(pags: VendaCaixaInput["pagamentos"]): number {
  return round2(
    (Array.isArray(pags) ? pags : []).reduce((s, p) => {
      const v = Number((p as { valor?: unknown })?.valor);
      return Number.isFinite(v) && v > 0 ? s + v : s;
    }, 0),
  );
}

/** Classificação individual, sem olhar vínculos (usada para o próprio registro e para o DAV de origem). */
function classificarIsolada(venda: VendaCaixaInput, ctx: ContextoSessaoCaixa): ClassificacaoVendaCaixa {
  const base = {
    vendaId: venda.id,
    operacaoEconomicaId: venda.id,
    registroFonteDoPagamento: null as string | null,
    cancelada: false,
    avisos: [] as string[],
  };
  const fora = (codigo: CodigoCaixa, motivo: string): ClassificacaoVendaCaixa => ({
    ...base,
    compoeCaixa: false,
    codigo,
    motivo,
  });

  if (venda.empresaId != null && ctx.empresaId && String(venda.empresaId) !== String(ctx.empresaId)) {
    return fora("outra_empresa", "venda de outra empresa (isolamento de tenant)");
  }

  const tipo = String(venda.tipo ?? "fiscal").toLowerCase();
  const status = String(venda.status ?? "").toLowerCase();
  const ehDav = tipo === "dav";
  const total = round2(Math.max(0, Number(venda.total) || 0));
  const somaPags = somaParcelasValidas(venda.pagamentos);

  // DAV orçamento/pré-venda é decidido pelos campos reais, antes de qualquer vínculo de sessão
  if (ehDav && status === "aberto") {
    return fora("dav_orcamento", "DAV em aberto é orçamento/pré-venda: sem baixa de estoque, sem recebimento, sem caixa");
  }
  if (ehDav && somaPags <= 0) {
    return fora(
      "dav_orcamento",
      "DAV sem recebimento próprio: quando faturado, a venda filha (davOrigemId) é a operação econômica",
    );
  }

  const sessaoVenda = venda.caixaSessaoId === undefined ? ctx.sessaoId : venda.caixaSessaoId;
  if (!sessaoVenda) return fora("sem_sessao", "venda sem vínculo explícito a uma sessão de caixa (não entra retroativamente)");
  if (String(sessaoVenda) !== String(ctx.sessaoId)) return fora("outra_sessao", "venda vinculada a outra sessão/operador");

  if (status === "aberto") return fora("rascunho_aberto", "registro em aberto ainda não concretizado");
  if (status !== "faturado" && status !== "cancelado") {
    return fora("status_nao_elegivel", `status "${venda.status}" não é comercialmente concretizado`);
  }

  if (ehDav) {
    // DAV concreto: sessão própria + status concretizado + recebimento próprio confirmado
    return {
      ...base,
      registroFonteDoPagamento: venda.id,
      compoeCaixa: true,
      cancelada: status === "cancelado",
      codigo: status === "cancelado" ? "dav_concreto_cancelado" : "dav_concreto",
      motivo: "DAV comercial concreto: sessão, status faturado e pagamentos confirmados",
    };
  }

  if (total <= 0 && somaPags <= 0) return fora("sem_valor", "venda sem valor nem recebimento");

  const avisos: string[] = [];
  if (somaPags <= 0) avisos.push("sem pagamentos[] — rateio pelo fallback legado formaPagamento");

  return {
    ...base,
    avisos,
    registroFonteDoPagamento: venda.id,
    compoeCaixa: true,
    cancelada: status === "cancelado",
    codigo: status === "cancelado" ? "venda_cancelada" : "venda_concreta",
    motivo:
      status === "cancelado"
        ? "venda concreta cancelada: entra como bruto + estorno (efeito líquido zero, auditável)"
        : `venda ${tipo === "sem_nota" ? "sem nota" : "fiscal"} concreta: sessão, faturada e recebimento próprio`,
  };
}

/**
 * Classifica um registro de `nk_venda` para a sessão.
 * `indice` (id → venda) permite resolver `davOrigemId`: se o DAV de origem é ele mesmo um DAV
 * concreto da sessão, esta venda apenas fiscaliza a mesma operação e NÃO compõe (duplicata).
 */
export function classificarVendaCaixa(
  venda: VendaCaixaInput,
  ctx: ContextoSessaoCaixa,
  indice?: Map<string, VendaCaixaInput>,
): ClassificacaoVendaCaixa {
  const propria = classificarIsolada(venda, ctx);
  if (!propria.compoeCaixa || !venda.davOrigemId || !indice) return propria;
  const pai = indice.get(String(venda.davOrigemId));
  if (!pai || pai.id === venda.id) return propria;
  const classPai = classificarIsolada(pai, ctx);
  if (classPai.compoeCaixa && (classPai.codigo === "dav_concreto" || classPai.codigo === "dav_concreto_cancelado")) {
    return {
      ...propria,
      compoeCaixa: false,
      operacaoEconomicaId: pai.id,
      registroFonteDoPagamento: pai.id,
      codigo: "duplicata_fiscal_de_dav",
      motivo: "nota/venda que apenas fiscaliza um DAV concreto já contabilizado (identidade econômica única)",
    };
  }
  return propria;
}

/** Atalho booleano do predicado central. */
export function compoeCaixa(venda: VendaCaixaInput, ctx: ContextoSessaoCaixa, indice?: Map<string, VendaCaixaInput>): boolean {
  return classificarVendaCaixa(venda, ctx, indice).compoeCaixa;
}

/**
 * Classifica todas as vendas e devolve a lista deduplicada por `operacaoEconomicaId`,
 * pronta para `calcularApuracaoCaixa`. Quando dois registros reivindicam a mesma operação,
 * fica o registro-fonte do pagamento; o outro vira duplicata (registrado em `classificacoes`).
 */
export function selecionarVendasDaSessao(
  vendas: VendaCaixaInput[],
  ctx: ContextoSessaoCaixa,
): { selecionadas: VendaCaixaInput[]; classificacoes: ClassificacaoVendaCaixa[] } {
  const indice = new Map(vendas.map((v) => [v.id, v] as const));
  const classificacoes = vendas.map((v) => classificarVendaCaixa(v, ctx, indice));
  const porOperacao = new Map<string, { venda: VendaCaixaInput; equivalentes: string[] }>();

  classificacoes.forEach((c, i) => {
    if (!c.compoeCaixa) return;
    const atual = porOperacao.get(c.operacaoEconomicaId);
    if (!atual) {
      porOperacao.set(c.operacaoEconomicaId, { venda: vendas[i], equivalentes: [] });
      return;
    }
    // dois registros concretos para a mesma operação: mantém o primeiro, marca o segundo
    atual.equivalentes.push(vendas[i].id);
    classificacoes[i] = {
      ...c,
      compoeCaixa: false,
      registroFonteDoPagamento: atual.venda.id,
      codigo: "duplicata_fiscal_de_dav",
      motivo: "operação econômica já contabilizada por outro registro desta sessão",
    };
  });

  // registros excluídos como duplicata também são equivalentes da operação (para casar estornos explícitos)
  for (const c of classificacoes) {
    if (c.codigo === "duplicata_fiscal_de_dav") porOperacao.get(c.operacaoEconomicaId)?.equivalentes.push(c.vendaId);
  }

  const selecionadas = [...porOperacao.values()].map(({ venda, equivalentes }) => ({
    ...venda,
    idsEquivalentes: [...new Set(equivalentes.filter((id) => id !== venda.id))],
  }));
  return { selecionadas, classificacoes };
}

/* ---------------------------------------------------------------- apuração */

/**
 * Calcula os saldos esperados por forma de pagamento de uma sessão de caixa a partir de vendas JÁ
 * selecionadas (use `apurarSessaoCaixa` para aplicar o predicado + deduplicação antes):
 * esperado(forma) = saldoInicial(só dinheiro) + vendasBrutas(forma) + suprimentos(forma) − sangrias(forma) − estornos(forma)
 * Venda cancelada entra como bruto + estorno (explícito via movimento com `vendaId`, ou implícito uma única vez).
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
  const inconsistencias: InconsistenciaCaixa[] = [];
  const avisos: string[] = [];

  const vendasComEstornoMov = new Set(
    params.movimentos.filter((m) => m.tipo === "estorno" && m.vendaId).map((m) => String(m.vendaId)),
  );
  const idsConsiderados = new Set<string>();

  let qtdAtivas = 0;
  let qtdCanceladas = 0;
  let totalTroco = 0;
  let parcelasIgnoradas = 0;
  let fallbacks = 0;

  for (const v of params.vendas) {
    idsConsiderados.add(v.id);
    for (const eq of v.idsEquivalentes ?? []) idsConsiderados.add(eq);
    const rateio = ratearPagamentosDetalhado(v);
    totalTroco = round2(totalTroco + rateio.troco);
    parcelasIgnoradas += rateio.parcelasIgnoradas;
    if (rateio.usouFallbackForma && (v.pagamentos?.length ?? 0) === 0) fallbacks++;
    if (rateio.inconsistencia) inconsistencias.push({ vendaId: v.id, motivo: rateio.inconsistencia });

    const temEstornoExplicito =
      vendasComEstornoMov.has(v.id) || (v.idsEquivalentes ?? []).some((id) => vendasComEstornoMov.has(id));

    if (String(v.status).toLowerCase() === "cancelado") {
      qtdCanceladas++;
      for (const f of Object.keys(vendasPorForma)) {
        vendasPorForma[f] = round2(vendasPorForma[f] + rateio.porForma[f]);
        if (!temEstornoExplicito) estornosPorForma[f] = round2(estornosPorForma[f] + rateio.porForma[f]);
      }
    } else {
      qtdAtivas++;
      for (const f of Object.keys(vendasPorForma)) {
        vendasPorForma[f] = round2(vendasPorForma[f] + rateio.porForma[f]);
      }
    }
  }

  let estornosForaDaSessao = 0;
  for (const m of params.movimentos) {
    const f = vendasPorForma[m.forma] !== undefined ? m.forma : "dinheiro";
    const val = round2(Math.max(0, Number(m.valor) || 0));
    if (m.tipo === "suprimento") suprimentosPorForma[f] = round2(suprimentosPorForma[f] + val);
    else if (m.tipo === "sangria") sangriasPorForma[f] = round2(sangriasPorForma[f] + val);
    else if (m.tipo === "estorno") {
      estornosPorForma[f] = round2(estornosPorForma[f] + val);
      if (m.vendaId && !idsConsiderados.has(String(m.vendaId))) estornosForaDaSessao++;
    }
  }

  if (parcelasIgnoradas > 0) avisos.push(`${parcelasIgnoradas} parcela(s) zero/negativa/inválida ignorada(s)`);
  if (fallbacks > 0) avisos.push(`${fallbacks} venda(s) legada(s) sem pagamentos[] rateada(s) por formaPagamento`);
  if (estornosForaDaSessao > 0) {
    avisos.push(`${estornosForaDaSessao} estorno(s) explícito(s) de venda que não compõe esta sessão (saída física registrada nesta gaveta)`);
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
  const totalNaoFisico = round2(FORMAS_NAO_FISICAS.reduce((s, f) => s + (esperadosMap[f] ?? 0), 0));

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
    totalTroco,
    totalNaoFisico,
    esperadoEmEspecie: esperadosMap.dinheiro ?? 0,
    inconsistencias,
    avisos,
  };
}

export type ApuracaoSessaoCaixa = ApuracaoCaixa & {
  sessaoId: string;
  classificacoes: ClassificacaoVendaCaixa[];
  consideradas: number;
  excluidas: { vendaId: string; codigo: CodigoCaixa; motivo: string }[];
  /** `true` quando os esperados vieram do snapshot gravado no fechamento (sessão fechada) */
  snapshotAplicado: boolean;
  /** diferença entre o recálculo atual e o snapshot (0 quando não há snapshot) */
  divergenciaRecalculo: number;
  /** saldo acumulado em espécie na gaveta (fundo + vendas + suprimentos − sangrias − estornos) */
  saldoDinheiroGaveta: number;
  /** `normal` | `alerta` (≥ R$ 800) | `bloqueado` (≥ 120% do limite) */
  estadoGaveta: EstadoGaveta;
  /** boolean consumido pelo client component do PDV para desabilitar conclusão em dinheiro */
  bloquearVendaDinheiro: boolean;
  limiteDinheiroGaveta: number;
  fundoTrocoPadrao: number;
};

/**
 * Porta de entrada única: aplica o predicado, deduplica por operação econômica e apura.
 * Recebe as vendas brutas da sessão (qualquer tipo/status) e os movimentos da sessão.
 */
export function apurarSessaoCaixa(params: {
  sessaoId: string;
  empresaId: string;
  saldoInicial: number;
  vendas: VendaCaixaInput[];
  movimentos: MovimentoCaixaInput[];
}): ApuracaoSessaoCaixa {
  const ctx = { empresaId: params.empresaId, sessaoId: params.sessaoId };
  const { selecionadas, classificacoes } = selecionarVendasDaSessao(params.vendas, ctx);
  const apuracao = calcularApuracaoCaixa({
    saldoInicial: params.saldoInicial,
    vendas: selecionadas,
    movimentos: params.movimentos,
  });
  // Saldo em espécie da gaveta: usa o esperado em dinheiro já apurado pelo motor
  // (fundo + vendas em dinheiro + suprimentos − sangrias − estornos), sem duplicar regra.
  const saldoDinheiroGaveta = round2(apuracao.esperadoEmEspecie);
  const gaveta = estadoGavetaPorSaldo(saldoDinheiroGaveta);
  return {
    ...apuracao,
    sessaoId: params.sessaoId,
    classificacoes,
    consideradas: selecionadas.length,
    excluidas: classificacoes
      .filter((c) => !c.compoeCaixa)
      .map((c) => ({ vendaId: c.vendaId, codigo: c.codigo, motivo: c.motivo })),
    snapshotAplicado: false,
    divergenciaRecalculo: 0,
    saldoDinheiroGaveta,
    estadoGaveta: gaveta.estado,
    bloquearVendaDinheiro: gaveta.bloquearVendaDinheiro,
    limiteDinheiroGaveta: LIMITE_DINHEIRO_GAVETA,
    fundoTrocoPadrao: FUNDO_TROCO_PADRAO,
  };
}

/**
 * Sessão fechada: o esperado exibido é o snapshot gravado no fechamento — o motor atual não o
 * altera silenciosamente. A divergência entre recálculo e snapshot fica visível em `divergenciaRecalculo`.
 */
export function aplicarSnapshotFechamento(
  apuracao: ApuracaoSessaoCaixa,
  snapshotEsperados: Record<string, number> | null | undefined,
): ApuracaoSessaoCaixa {
  if (!snapshotEsperados || Object.keys(snapshotEsperados).length === 0) return apuracao;
  const esperadosMap: Record<string, number> = {};
  for (const fp of FORMAS_PAGAMENTO) esperadosMap[fp.id] = round2(Number(snapshotEsperados[fp.id] ?? 0));
  const totalSnapshot = round2(Object.values(esperadosMap).reduce((s, v) => s + v, 0));
  return {
    ...apuracao,
    esperadosMap,
    porForma: apuracao.porForma.map((f) => ({ ...f, esperado: esperadosMap[f.forma] ?? 0 })),
    totalEsperado: totalSnapshot,
    esperadoEmEspecie: esperadosMap.dinheiro ?? 0,
    totalNaoFisico: round2(FORMAS_NAO_FISICAS.reduce((s, f) => s + (esperadosMap[f] ?? 0), 0)),
    snapshotAplicado: true,
    divergenciaRecalculo: round2(apuracao.totalEsperado - totalSnapshot),
  };
}

/* -------------------------------------------------------------- conferência */

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

/**
 * Lê um valor em dinheiro digitado pelo operador, aceitando os formatos reais de teclado:
 * "150,50" · "150.50" · "1.500,50" · "1,500.50" · "1500" · "R$ 1.500,50". Devolve `null` quando não é número.
 * Regra: o ÚLTIMO separador (vírgula ou ponto) é decimal quando seguido de 1–2 dígitos; os demais são milhar.
 * Corrige a leitura antiga que tratava todo ponto como milhar ("150.50" virava 15.050,00 e gerava falsa divergência).
 */
export function lerValorDinheiro(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? round2(bruto) : null;
  if (bruto === undefined || bruto === null) return 0;
  if (typeof bruto !== "string") return null;
  const texto = bruto.replace(/\s|R\$/g, "");
  if (texto === "") return 0;
  if (!/^-?[\d.,]+$/.test(texto) || /[.,]{2,}/.test(texto)) return null;
  const negativo = texto.startsWith("-");
  const corpo = negativo ? texto.slice(1) : texto;
  const ultimoSep = Math.max(corpo.lastIndexOf(","), corpo.lastIndexOf("."));
  let inteiro = corpo, decimal = "";
  if (ultimoSep >= 0) {
    const depois = corpo.slice(ultimoSep + 1);
    const antes = corpo.slice(0, ultimoSep);
    const sepChar = corpo[ultimoSep];
    const outrosSeps = antes.replace(/\d/g, "");
    // Ponto único seguido de exatamente 3 dígitos e sem vírgula ("1.500") é milhar; o resto com 1-2 dígitos é decimal.
    const pareceMilhar = sepChar === "." && depois.length === 3 && !antes.includes(",") && outrosSeps.split("").every((c) => c === ".");
    if (depois.length >= 1 && depois.length <= 2 && !/[.,]/.test(depois)) { inteiro = antes; decimal = depois; }
    else if (pareceMilhar || (depois.length === 3 && !/[.,]/.test(depois))) { inteiro = corpo; decimal = ""; }
    else return null;
  }
  const digitosInteiros = inteiro.replace(/[.,]/g, "");
  if (!/^\d*$/.test(digitosInteiros) || !/^\d*$/.test(decimal)) return null;
  const n = Number(`${digitosInteiros || "0"}.${decimal || "0"}`);
  if (!Number.isFinite(n)) return null;
  return round2(negativo ? -n : n);
}
