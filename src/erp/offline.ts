import type { Venda } from "./types";

/**
 * Fila offline-first do PDV.
 *
 * Regra de ouro do caixa: a venda NUNCA pode falhar por falta de internet.
 * Toda venda é gravada localmente primeiro e entra numa fila de
 * sincronização. Quando a conexão volta, a fila é enviada ao servidor.
 */

export type ItemFila = {
  id: string;
  venda: Venda;
  criadoEm: number;
  tentativas: number;
  erro?: string;
};

const KEY = "nkway.fila.sync";

const ler = (): ItemFila[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
};

const gravar = (f: ItemFila[]) => {
  localStorage.setItem(KEY, JSON.stringify(f));
  window.dispatchEvent(new CustomEvent("nkway:fila"));
};

export const filaAtual = ler;

export function enfileirar(venda: Venda) {
  const f = ler();
  f.push({
    id: venda.id || Math.random().toString(36).slice(2),
    venda,
    criadoEm: Date.now(),
    tentativas: 0,
  });
  gravar(f);
}

export function removerDaFila(id: string) {
  gravar(ler().filter((x) => x.id !== id));
}

export function marcarErro(id: string, erro: string) {
  gravar(
    ler().map((x) =>
      x.id === id ? { ...x, tentativas: x.tentativas + 1, erro } : x,
    ),
  );
}

export function limparFila() {
  gravar([]);
}

/**
 * Processa a fila. Recebe a função de envio para não acoplar ao Supabase —
 * em modo demo o envio é simulado.
 */
export async function sincronizar(
  enviar: (v: Venda) => Promise<void>,
): Promise<{ ok: number; falhou: number }> {
  if (!navigator.onLine) return { ok: 0, falhou: 0 };
  let ok = 0;
  let falhou = 0;

  for (const item of ler()) {
    try {
      await enviar(item.venda);
      removerDaFila(item.id);
      ok++;
    } catch (e) {
      marcarErro(item.id, e instanceof Error ? e.message : "erro desconhecido");
      falhou++;
    }
  }
  return { ok, falhou };
}
