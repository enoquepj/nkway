/**
 * NKWAY — Helper único e reutilizável para abertura do PDV (/pdv) em tela cheia.
 * Centraliza o pedido de Fullscreen API no mesmo gesto do usuário (clique ou atalho),
 * grava a preferência em `nkway.pdv.telaCheia`, evita pedidos simultâneos e nunca
 * bloqueia a navegação caso o navegador recuse ou não suporte a API.
 */

export const ROTA_PDV = "/pdv";
export const CHAVE_TELA_CHEIA = "nkway.pdv.telaCheia";

export type EventoCliquePdv = {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
};

export type EventoTecladoPdv = {
  repeat?: boolean;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
};

type DocumentoTelaCheia = {
  fullscreenElement?: Element | null;
  documentElement?: {
    requestFullscreen?: () => Promise<void> | void;
  } | null;
};

type ArmazenamentoLocal = {
  getItem: (chave: string) => string | null;
  setItem: (chave: string, valor: string) => void;
};

let promessaTelaCheiaAtiva: Promise<boolean> | null = null;
let ultimoResultadoTelaCheia: { ts: number; ok: boolean } | null = null;
let ultimaNavegacaoPdvTs = 0;

function obterDocumentoPadrao(): DocumentoTelaCheia | null {
  return typeof document !== "undefined" ? (document as unknown as DocumentoTelaCheia) : null;
}

function obterStoragePadrao(): ArmazenamentoLocal | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Identifica cliques modificados (Ctrl/Cmd/Shift/Alt+clique, botão do meio/direito ou target externo)
 * para preservar a abertura nativa em nova aba/janela sem sequestrar a navegação.
 */
export function ehCliqueModificadoPdv(evento?: EventoCliquePdv | null, target?: string): boolean {
  if (!evento) return false;
  if (evento.defaultPrevented) return true;
  if (target && target !== "_self") return true;
  if (typeof evento.button === "number" && evento.button !== 0) return true;
  if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return true;
  return false;
}

/** Retorna a promessa de fullscreen atualmente em andamento (se houver), evitando chamadas duplicadas. */
export function obterPromessaTelaCheiaAtiva(): Promise<boolean> | null {
  return promessaTelaCheiaAtiva;
}

/**
 * Informa ao PDV recém-montado se houve falha recente (< janelaMs) ao pedir fullscreen no gesto de entrada,
 * permitindo acionar imediatamente o aviso de fallback existente sem disparar segundo pedido redundante.
 */
export function consumirFalhaRecenteTelaCheia(janelaMs = 2000, agora = Date.now()): boolean {
  if (!ultimoResultadoTelaCheia) return false;
  const recente = agora - ultimoResultadoTelaCheia.ts <= janelaMs;
  const falhou = !ultimoResultadoTelaCheia.ok;
  ultimoResultadoTelaCheia = null;
  return recente && falhou;
}

/** Limpa o estado interno do módulo (uso exclusivo em testes automatizados). */
export function resetarEstadoTelaCheiaPdv(): void {
  promessaTelaCheiaAtiva = null;
  ultimoResultadoTelaCheia = null;
  ultimaNavegacaoPdvTs = 0;
}

/**
 * Solicita tela cheia em `document.documentElement` com proteção contra chamadas simultâneas
 * e tratamento completo de exceções síncronas e rejeições assíncronas.
 */
export function solicitarTelaCheiaElemento(opcoes?: {
  gravarPreferencia?: boolean;
  doc?: DocumentoTelaCheia | null;
  storage?: ArmazenamentoLocal | null;
  agora?: number;
}): Promise<boolean> {
  const doc = opcoes && "doc" in opcoes ? (opcoes.doc ?? null) : obterDocumentoPadrao();
  const storage = opcoes && "storage" in opcoes ? (opcoes.storage ?? null) : obterStoragePadrao();

  if (opcoes?.gravarPreferencia && storage) {
    try {
      storage.setItem(CHAVE_TELA_CHEIA, "true");
    } catch {
      /* storage indisponível */
    }
  }

  if (!doc) {
    return Promise.resolve(false);
  }

  if (doc.fullscreenElement) {
    ultimoResultadoTelaCheia = { ts: opcoes?.agora ?? Date.now(), ok: true };
    return Promise.resolve(true);
  }

  if (promessaTelaCheiaAtiva) {
    return promessaTelaCheiaAtiva;
  }

  const fn = doc.documentElement?.requestFullscreen;
  if (typeof fn !== "function") {
    ultimoResultadoTelaCheia = { ts: opcoes?.agora ?? Date.now(), ok: false };
    return Promise.resolve(false);
  }

  let chamada: Promise<void> | void;
  try {
    chamada = fn.call(doc.documentElement);
  } catch {
    ultimoResultadoTelaCheia = { ts: opcoes?.agora ?? Date.now(), ok: false };
    return Promise.resolve(false);
  }

  const p = Promise.resolve(chamada)
    .then(
      () => {
        ultimoResultadoTelaCheia = { ts: Date.now(), ok: true };
        return true;
      },
      () => {
        ultimoResultadoTelaCheia = { ts: Date.now(), ok: false };
        return false;
      },
    )
    .finally(() => {
      promessaTelaCheiaAtiva = null;
    });

  promessaTelaCheiaAtiva = p;
  return p;
}

/**
 * Ponto único para abrir o PDV a partir de qualquer entrada oficial (item da sidebar,
 * botões "Abrir PDV" / "Ir para o PDV" e atalho global Alt+K do Shell).
 */
export function abrirPdvComTelaCheia(params: {
  navegar: (rota: string) => void;
  origem?: "clique" | "atalho";
  eventoClique?: EventoCliquePdv | null;
  eventoTeclado?: EventoTecladoPdv | null;
  target?: string;
  pathnameAtual?: string | null;
  doc?: DocumentoTelaCheia | null;
  storage?: ArmazenamentoLocal | null;
  agora?: number;
}): { interceptado: boolean; navegou: boolean; promessaTelaCheia: Promise<boolean> | null } {
  const agora = params.agora ?? Date.now();

  if (params.origem === "atalho") {
    if (params.eventoTeclado?.repeat || params.eventoTeclado?.defaultPrevented) {
      return { interceptado: false, navegou: false, promessaTelaCheia: promessaTelaCheiaAtiva };
    }
    params.eventoTeclado?.preventDefault?.();
  } else {
    if (ehCliqueModificadoPdv(params.eventoClique, params.target)) {
      return { interceptado: false, navegou: false, promessaTelaCheia: null };
    }
    params.eventoClique?.preventDefault?.();
  }

  const promessaTelaCheia = solicitarTelaCheiaElemento({
    gravarPreferencia: true,
    ...(params.doc !== undefined ? { doc: params.doc } : {}),
    ...(params.storage !== undefined ? { storage: params.storage } : {}),
    agora,
  });

  if (params.pathnameAtual === ROTA_PDV) {
    return { interceptado: true, navegou: false, promessaTelaCheia };
  }

  // Evita disparo duplo de router.push em tecla pressionada duas vezes no mesmo instante (< 120ms)
  if (params.origem === "atalho" && agora - ultimaNavegacaoPdvTs < 120) {
    return { interceptado: true, navegou: false, promessaTelaCheia };
  }
  ultimaNavegacaoPdvTs = agora;

  params.navegar(ROTA_PDV);
  return { interceptado: true, navegou: true, promessaTelaCheia };
}
