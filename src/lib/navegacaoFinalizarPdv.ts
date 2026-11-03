/**
 * NKWAY — Máquina pura de navegação 100% por teclado do modal Finalizar Operação (F10).
 *
 * Permite operar todo o fechamento sem mouse:
 * - Formas de pagamento (`Dinheiro`, `PIX`, `Crédito`, `Débito`, `Boleto`, `Prazo`) com setas ← → (e ↑ ↓ entre seções) + Enter.
 * - Valor da parcela (`R$`) com digitação direta, ← → quando selecionado/vazio para trocar forma, ↑ ↓ entre seções e Enter para lançar.
 * - Modelo de documento fiscal (`NFC-e`, `NF-e`, `SAT`) com setas ← →.
 * - Tipo de registro/fechamento (`1. Salvar como DAV`, `2. Finalizar sem nota`, `3. Finalizar e emitir NFC-e/NF-e/SAT`)
 *   com setas ↑ ↓ (e ← → para alternar `NFC-e` / `NF-e` / `SAT`), teclas rápidas `1` / `2` / `3` e `Enter` para concluir.
 * - Confirmação final de emissão fiscal (`Voltar às opções` ↔ `Confirmar e emitir`) com ← → / ↑ ↓, `Enter` e `Esc`.
 */

import { FORMAS_PAGAMENTO } from "@/lib/dominio";

export const MODELOS_FISCAIS_PDV = ["NFC-e", "NF-e", "SAT"] as const;
export type ModeloFiscalPdv = (typeof MODELOS_FISCAIS_PDV)[number];

export const OPCOES_FECHAMENTO_PDV = ["dav", "sem_nota", "emitir_nfce"] as const;
export type OpcaoFechamentoPdv = (typeof OPCOES_FECHAMENTO_PDV)[number];

export type SecaoFocoFinalizarPdv = "formas" | "valor" | "modelo" | "opcoes" | "confirmacao";
export type BotaoConfirmacaoFiscalPdv = "voltar" | "confirmar";

export type EstadoNavegacaoFinalizarPdv = {
  secao: SecaoFocoFinalizarPdv;
  formaAtiva: string;
  modeloFiscal: ModeloFiscalPdv;
  opcaoFechamento: OpcaoFechamentoPdv;
  botaoConfirmacao: BotaoConfirmacaoFiscalPdv;
};

export type ContextoFinalizarTecladoPdv = {
  temSaldoFaltando: boolean;
  temParcelasLancadas: boolean;
  podeDav: boolean;
  podeSemNota: boolean;
  podeEmitirFiscal: boolean;
  confirmandoEmissao: boolean;
  ocupado?: boolean;
  /** Verdadeiro quando o input de valor está vazio ou com todo o texto selecionado (permite ← → trocar forma) */
  inputValorSelecionadoOuVazio?: boolean;
};

export type AcaoTecladoFinalizarPdv =
  | { tipo: "NENHUMA" }
  | { tipo: "MUDAR_FORMA"; forma: string }
  | { tipo: "INICIAR_DIGITACAO_VALOR"; caractere: string }
  | { tipo: "LANCAR_PARCELA" }
  | { tipo: "TROCAR_FORMA_UNICA"; forma: string }
  | { tipo: "MUDAR_MODELO"; modelo: ModeloFiscalPdv }
  | { tipo: "ABRIR_CLIENTE_F8" }
  | { tipo: "ABRIR_CONFIRMACAO_FISCAL" }
  | { tipo: "VOLTAR_OPCOES" }
  | { tipo: "EXECUTAR_FECHAMENTO"; modo: OpcaoFechamentoPdv };

export type ResultadoTeclaFinalizarPdv = {
  interceptado: boolean;
  estado: EstadoNavegacaoFinalizarPdv;
  acao: AcaoTecladoFinalizarPdv;
};

const LISTA_IDS_FORMAS = FORMAS_PAGAMENTO.map((f) => f.id);

/** Avança ou retrocede ciclicamente entre as 6 formas de pagamento oficiais */
export function ciclarFormaPagamentoPdv(formaAtual: string, delta: -1 | 1): string {
  const idx = LISTA_IDS_FORMAS.indexOf(formaAtual as (typeof LISTA_IDS_FORMAS)[number]);
  const base = idx >= 0 ? idx : 0;
  const prox = (base + delta + LISTA_IDS_FORMAS.length) % LISTA_IDS_FORMAS.length;
  return LISTA_IDS_FORMAS[prox];
}

/** Avança ou retrocede ciclicamente entre os modelos fiscais (`NFC-e` ↔ `NF-e` ↔ `SAT`) */
export function ciclarModeloFiscalPdv(modeloAtual: ModeloFiscalPdv, delta: -1 | 1): ModeloFiscalPdv {
  const idx = MODELOS_FISCAIS_PDV.indexOf(modeloAtual);
  const base = idx >= 0 ? idx : 0;
  const prox = (base + delta + MODELOS_FISCAIS_PDV.length) % MODELOS_FISCAIS_PDV.length;
  return MODELOS_FISCAIS_PDV[prox];
}

/** Retorna a lista ordenada das opções de fechamento atualmente habilitadas */
export function listarOpcoesFechamentoHabilitadasPdv(
  ctx: Pick<ContextoFinalizarTecladoPdv, "podeDav" | "podeSemNota" | "podeEmitirFiscal">,
): OpcaoFechamentoPdv[] {
  const lista: OpcaoFechamentoPdv[] = [];
  if (ctx.podeDav) lista.push("dav");
  if (ctx.podeSemNota) lista.push("sem_nota");
  if (ctx.podeEmitirFiscal) lista.push("emitir_nfce");
  return lista;
}

export function resolverOpcaoFechamentoValidaPdv(
  preferida: OpcaoFechamentoPdv,
  ctx: Pick<ContextoFinalizarTecladoPdv, "podeDav" | "podeSemNota" | "podeEmitirFiscal">,
): OpcaoFechamentoPdv {
  const habilitadas = listarOpcoesFechamentoHabilitadasPdv(ctx);
  if (habilitadas.includes(preferida)) return preferida;
  if (habilitadas.includes("emitir_nfce")) return "emitir_nfce";
  if (habilitadas.includes("sem_nota")) return "sem_nota";
  if (habilitadas.includes("dav")) return "dav";
  return preferida;
}

/** Cria o estado inicial ao pressionar F10 */
export function criarEstadoInicialFinalizarPdv(params: {
  formaInicial: string;
  modeloAtual: ModeloFiscalPdv;
  ctx: Pick<
    ContextoFinalizarTecladoPdv,
    "temSaldoFaltando" | "temParcelasLancadas" | "podeDav" | "podeSemNota" | "podeEmitirFiscal"
  >;
}): EstadoNavegacaoFinalizarPdv {
  const formaValida = LISTA_IDS_FORMAS.includes(params.formaInicial as (typeof LISTA_IDS_FORMAS)[number])
    ? params.formaInicial
    : "dinheiro";
  const modeloValido = MODELOS_FISCAIS_PDV.includes(params.modeloAtual) ? params.modeloAtual : "NFC-e";
  const opcaoPadrao = resolverOpcaoFechamentoValidaPdv("emitir_nfce", params.ctx);

  // Se o operador já lançou o pagamento antes de abrir F10 e não falta nada, posiciona direto nas opções de documento;
  // caso contrário, posiciona nas formas de pagamento para permitir ← → imediatos.
  const secaoInicial: SecaoFocoFinalizarPdv =
    params.ctx.temParcelasLancadas && !params.ctx.temSaldoFaltando ? "opcoes" : "formas";

  return {
    secao: secaoInicial,
    formaAtiva: formaValida,
    modeloFiscal: modeloValido,
    opcaoFechamento: opcaoPadrao,
    botaoConfirmacao: "confirmar",
  };
}

/**
 * Atualiza a navegação logo após lançar uma parcela de pagamento no modal F10:
 * - Se quitou o saldo (`falta === 0`), move automaticamente o cursor para `"opcoes"` (escolha DAV / Sem nota / NFC-e).
 * - Se ainda falta saldo (`falta > 0`), posiciona em `"formas"` para escolher a próxima forma com ← →.
 */
export function avancarAposLancamentoParcelaPdv(
  estado: EstadoNavegacaoFinalizarPdv,
  aindaFaltaSaldo: boolean,
  ctx: Pick<ContextoFinalizarTecladoPdv, "podeDav" | "podeSemNota" | "podeEmitirFiscal">,
): EstadoNavegacaoFinalizarPdv {
  if (!aindaFaltaSaldo) {
    return {
      ...estado,
      secao: "opcoes",
      opcaoFechamento: resolverOpcaoFechamentoValidaPdv(estado.opcaoFechamento, ctx),
    };
  }
  return {
    ...estado,
    secao: "formas",
  };
}

/**
 * Processa teclas de navegação e ação dentro do modal F10.
 */
export function processarTeclaFinalizarPdv(
  estadoAtual: EstadoNavegacaoFinalizarPdv,
  evento: {
    key: string;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  },
  ctx: ContextoFinalizarTecladoPdv,
): ResultadoTeclaFinalizarPdv {
  if (ctx.ocupado) {
    return { interceptado: false, estado: estadoAtual, acao: { tipo: "NENHUMA" } };
  }

  const estado: EstadoNavegacaoFinalizarPdv = ctx.confirmandoEmissao
    ? { ...estadoAtual, secao: "confirmacao" }
    : estadoAtual.secao === "confirmacao"
      ? { ...estadoAtual, secao: "opcoes" }
      : (!ctx.temSaldoFaltando && estadoAtual.secao === "valor")
        ? { ...estadoAtual, secao: "opcoes" }
        : { ...estadoAtual };

  const { key } = evento;
  const semModificadores = !evento.altKey && !evento.ctrlKey && !evento.metaKey;

  /* ------------------------------------------------ Etapa de confirmação fiscal */
  if (estado.secao === "confirmacao" || ctx.confirmandoEmissao) {
    if (semModificadores && (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown")) {
      const novoBotao: BotaoConfirmacaoFiscalPdv = estado.botaoConfirmacao === "confirmar" ? "voltar" : "confirmar";
      return {
        interceptado: true,
        estado: { ...estado, secao: "confirmacao", botaoConfirmacao: novoBotao },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && key === "Enter") {
      if (estado.botaoConfirmacao === "voltar") {
        return {
          interceptado: true,
          estado: { ...estado, secao: "opcoes", opcaoFechamento: "emitir_nfce", botaoConfirmacao: "confirmar" },
          acao: { tipo: "VOLTAR_OPCOES" },
        };
      }
      return {
        interceptado: true,
        estado,
        acao: { tipo: "EXECUTAR_FECHAMENTO", modo: "emitir_nfce" },
      };
    }
    if (semModificadores && key === "Escape") {
      return {
        interceptado: true,
        estado: { ...estado, secao: "opcoes", opcaoFechamento: "emitir_nfce", botaoConfirmacao: "confirmar" },
        acao: { tipo: "VOLTAR_OPCOES" },
      };
    }
    return { interceptado: false, estado, acao: { tipo: "NENHUMA" } };
  }

  /* ------------------------------------------------ Atalhos rápidos dentro do F10 */
  if (evento.altKey && !evento.metaKey && /^[1-6]$/.test(key)) {
    const idx = Number(key) - 1;
    const novaForma = LISTA_IDS_FORMAS[idx] ?? "dinheiro";
    return {
      interceptado: true,
      estado: { ...estado, secao: "formas", formaAtiva: novaForma },
      acao: { tipo: "MUDAR_FORMA", forma: novaForma },
    };
  }

  if (semModificadores && key === "F8") {
    return {
      interceptado: true,
      estado,
      acao: { tipo: "ABRIR_CLIENTE_F8" },
    };
  }

  const habilitadas = listarOpcoesFechamentoHabilitadasPdv(ctx);

  /* ------------------------------------------------ Seção 1: Formas de pagamento */
  if (estado.secao === "formas") {
    if (semModificadores && (key === "ArrowLeft" || key === "ArrowRight")) {
      const novaForma = ciclarFormaPagamentoPdv(estado.formaAtiva, key === "ArrowRight" ? 1 : -1);
      return {
        interceptado: true,
        estado: { ...estado, formaAtiva: novaForma },
        acao: { tipo: "MUDAR_FORMA", forma: novaForma },
      };
    }
    if (semModificadores && key === "ArrowDown") {
      const proximaSecao: SecaoFocoFinalizarPdv = ctx.temSaldoFaltando ? "valor" : "modelo";
      return {
        interceptado: true,
        estado: { ...estado, secao: proximaSecao },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && key === "ArrowUp") {
      if (habilitadas.length > 0) {
        return {
          interceptado: true,
          estado: { ...estado, secao: "opcoes", opcaoFechamento: habilitadas[habilitadas.length - 1] },
          acao: { tipo: "NENHUMA" },
        };
      }
      return {
        interceptado: true,
        estado: { ...estado, secao: "modelo" },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && /^[0-9]$/.test(key) && ctx.temSaldoFaltando) {
      return {
        interceptado: true,
        estado: { ...estado, secao: "valor" },
        acao: { tipo: "INICIAR_DIGITACAO_VALOR", caractere: key },
      };
    }
    if (semModificadores && key === "Enter") {
      if (ctx.temSaldoFaltando) {
        return {
          interceptado: true,
          estado,
          acao: { tipo: "LANCAR_PARCELA" },
        };
      }
      return {
        interceptado: true,
        estado: {
          ...estado,
          secao: "opcoes",
          opcaoFechamento: resolverOpcaoFechamentoValidaPdv(estado.opcaoFechamento, ctx),
        },
        acao: { tipo: "TROCAR_FORMA_UNICA", forma: estado.formaAtiva },
      };
    }
    return { interceptado: false, estado, acao: { tipo: "NENHUMA" } };
  }

  /* ------------------------------------------------ Seção 2: Valor da parcela (R$) */
  if (estado.secao === "valor") {
    if (semModificadores && key === "ArrowUp") {
      return {
        interceptado: true,
        estado: { ...estado, secao: "formas" },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && key === "ArrowDown") {
      return {
        interceptado: true,
        estado: { ...estado, secao: "modelo" },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && (key === "ArrowLeft" || key === "ArrowRight") && ctx.inputValorSelecionadoOuVazio) {
      const novaForma = ciclarFormaPagamentoPdv(estado.formaAtiva, key === "ArrowRight" ? 1 : -1);
      return {
        interceptado: true,
        estado: { ...estado, formaAtiva: novaForma },
        acao: { tipo: "MUDAR_FORMA", forma: novaForma },
      };
    }
    if (semModificadores && key === "Enter") {
      return {
        interceptado: true,
        estado,
        acao: { tipo: "LANCAR_PARCELA" },
      };
    }
    return { interceptado: false, estado, acao: { tipo: "NENHUMA" } };
  }

  /* ------------------------------------------------ Seção 3: Modelo Fiscal (NFC-e / NF-e / SAT) */
  if (estado.secao === "modelo") {
    if (semModificadores && (key === "ArrowLeft" || key === "ArrowRight")) {
      const novoModelo = ciclarModeloFiscalPdv(estado.modeloFiscal, key === "ArrowRight" ? 1 : -1);
      return {
        interceptado: true,
        estado: { ...estado, modeloFiscal: novoModelo },
        acao: { tipo: "MUDAR_MODELO", modelo: novoModelo },
      };
    }
    if (semModificadores && key === "ArrowUp") {
      return {
        interceptado: true,
        estado: { ...estado, secao: ctx.temSaldoFaltando ? "valor" : "formas" },
        acao: { tipo: "NENHUMA" },
      };
    }
    if (semModificadores && (key === "ArrowDown" || key === "Enter")) {
      const primeira = habilitadas[0] ?? resolverOpcaoFechamentoValidaPdv(estado.opcaoFechamento, ctx);
      return {
        interceptado: true,
        estado: { ...estado, secao: "opcoes", opcaoFechamento: primeira },
        acao: { tipo: "NENHUMA" },
      };
    }
    return { interceptado: false, estado, acao: { tipo: "NENHUMA" } };
  }

  /* ------------------------------------------------ Seção 4: Opções (1. DAV / 2. Sem nota / 3. Emitir) */
  if (estado.secao === "opcoes") {
    const atualValida = resolverOpcaoFechamentoValidaPdv(estado.opcaoFechamento, ctx);
    const idxAtual = habilitadas.indexOf(atualValida);

    if (semModificadores && key === "ArrowUp") {
      if (idxAtual > 0) {
        return {
          interceptado: true,
          estado: { ...estado, opcaoFechamento: habilitadas[idxAtual - 1] },
          acao: { tipo: "NENHUMA" },
        };
      }
      return {
        interceptado: true,
        estado: { ...estado, secao: "modelo", opcaoFechamento: atualValida },
        acao: { tipo: "NENHUMA" },
      };
    }

    if (semModificadores && key === "ArrowDown") {
      if (idxAtual >= 0 && idxAtual < habilitadas.length - 1) {
        return {
          interceptado: true,
          estado: { ...estado, opcaoFechamento: habilitadas[idxAtual + 1] },
          acao: { tipo: "NENHUMA" },
        };
      }
      return {
        interceptado: true,
        estado: { ...estado, secao: "formas", opcaoFechamento: atualValida },
        acao: { tipo: "NENHUMA" },
      };
    }

    if (semModificadores && (key === "ArrowLeft" || key === "ArrowRight")) {
      const novoModelo = ciclarModeloFiscalPdv(estado.modeloFiscal, key === "ArrowRight" ? 1 : -1);
      return {
        interceptado: true,
        estado: { ...estado, opcaoFechamento: atualValida, modeloFiscal: novoModelo },
        acao: { tipo: "MUDAR_MODELO", modelo: novoModelo },
      };
    }

    if (semModificadores && (key === "1" || key === "2" || key === "3")) {
      const mapa: Record<string, OpcaoFechamentoPdv> = {
        "1": "dav",
        "2": "sem_nota",
        "3": "emitir_nfce",
      };
      const alvo = mapa[key];
      if (alvo && habilitadas.includes(alvo)) {
        return {
          interceptado: true,
          estado: { ...estado, opcaoFechamento: alvo },
          acao: { tipo: "NENHUMA" },
        };
      }
    }

    if (semModificadores && key === "Enter") {
      if (!habilitadas.includes(atualValida)) {
        return { interceptado: true, estado, acao: { tipo: "NENHUMA" } };
      }
      if (atualValida === "emitir_nfce") {
        return {
          interceptado: true,
          estado: {
            ...estado,
            secao: "confirmacao",
            opcaoFechamento: "emitir_nfce",
            botaoConfirmacao: "confirmar",
          },
          acao: { tipo: "ABRIR_CONFIRMACAO_FISCAL" },
        };
      }
      return {
        interceptado: true,
        estado: { ...estado, opcaoFechamento: atualValida },
        acao: { tipo: "EXECUTAR_FECHAMENTO", modo: atualValida },
      };
    }
  }

  return { interceptado: false, estado, acao: { tipo: "NENHUMA" } };
}
