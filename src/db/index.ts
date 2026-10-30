import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Conexão é criada de forma preguiçosa: o build da Vercel importa este módulo
 * para coletar as páginas e não tem DATABASE_URL — lançar aqui derrubaria o build
 * ("Failed to collect page data"). O erro passa a existir só quando há de fato
 * uma consulta.
 */
export const databaseUrl = process.env.DATABASE_URL ?? "";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: NodePgDatabase;
};

function criar(): { pool: Pool; db: NodePgDatabase } {
  if (!databaseUrl) throw new Error("DATABASE_URL não configurada — defina nas variáveis de ambiente.");
  const pool =
    globalForDb.__arenaNextJsPostgresqlPool ??
    new Pool({
      connectionString: databaseUrl,
      // alguns provedores (Neon, Supabase) exigem TLS
      ssl: /sslmode=require|neon\.tech|supabase\.(co|com)/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
  if (process.env.NODE_ENV !== "production") globalForDb.__arenaNextJsPostgresqlPool = pool;
  return { pool, db: drizzle(pool) };
}

/** Pool real — só toque quando houver consulta. */
export function pegarPool(): Pool {
  return criar().pool;
}

/** Proxy: qualquer consulta chega aqui e só então cria a conexão. */
export const db = new Proxy({} as NodePgDatabase, {
  get(_alvo, prop, receptor) {
    const globalForDb2 = globalThis as typeof globalThis & { __arenaNextJsPostgresqlDb?: NodePgDatabase };
    if (!globalForDb2.__arenaNextJsPostgresqlDb) globalForDb2.__arenaNextJsPostgresqlDb = criar().db;
    const real = globalForDb2.__arenaNextJsPostgresqlDb as unknown as Record<string | symbol, unknown>;
    const valor = real[prop];
    return typeof valor === "function" ? (valor as (...a: unknown[]) => unknown).bind(real) : (valor ?? receptor);
  },
});
