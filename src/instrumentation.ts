/**
 * NKWAY — bootstrap do ambiente de demonstração.
 * Roda uma vez por processo do servidor e é idempotente (a empresa demo já existe? não cria).
 * Desligue com NKWAY_SEED=off quando for usar apenas dados reais.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NKWAY_SEED === "off") return;
  try {
    const { semearAmbiente } = await import("./db/seed");
    const r = await semearAmbiente();
    if (r.criado) console.info("[nkway] ambiente de demonstração criado (demo@nkway.com.br / nkway123)");
  } catch (e) {
    console.error("[nkway] seed ignorado:", e instanceof Error ? e.message : e);
  }
}
