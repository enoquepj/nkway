import { db } from "@/db";
import { sql } from "drizzle-orm";
import { cabecalhosVersaoDeploy } from "@/server/versaoDeploy";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = cabecalhosVersaoDeploy();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers });
  }
}
