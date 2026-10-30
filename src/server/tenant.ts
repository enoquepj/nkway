import { contexto } from "@/lib/session";

/** todo action de escrita resolve o tenant pela sessão — nunca pelo cliente */
export async function tenant() {
  const c = await contexto();
  if (!c) throw new Error("Sessão expirada. Entre novamente.");
  return c;
}

/**
 * Leitura tolerante de campos vindos do cliente.
 * Server action pode receber `undefined` quando o corpo chega fora do formato esperado —
 * `input.email.trim()` viraria TypeError 500 sem stack útil no navegador.
 */
export const texto = (v: unknown): string => String(v ?? "").trim();

/** número tolerante: aceita "1.234,56", 1234 e null → 0 */
export function numero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** booleano tolerante */
export const logico = (v: unknown): boolean => v === true || v === "true" || v === 1;

/** parâmetro string tolerante: ações como `trocarSenha(nova: string)` podem receber null */
export const cadeia = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Garante que o corpo da ação seja um objeto (mesmo quando o cliente envia `null`).
 * `const input = corpo(bruto)` na primeira linha da ação resolve o 500 silencioso.
 */
export function corpo<T extends object>(bruto: unknown): T {
  return bruto && typeof bruto === "object" ? (bruto as T) : ({} as T);
}

export function comoErro(e: unknown): { ok: false; erro: string } {
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, erro: msg.slice(0, 300) };
}
