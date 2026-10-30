import { contexto } from "@/lib/session";

/** todo action de escrita resolve o tenant pela sessão — nunca pelo cliente */
export async function tenant() {
  const c = await contexto();
  if (!c) throw new Error("Sessão expirada. Entre novamente.");
  return c;
}

export function comoErro(e: unknown): { ok: false; erro: string } {
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, erro: msg.slice(0, 300) };
}
