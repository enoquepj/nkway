import { redirect } from "next/navigation";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entradas } from "@/db/schema";
import { contexto } from "@/lib/session";
import { painel } from "@/server/dados";
import { DashboardView } from "@/views/Dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const dados = await painel(c.empresaId);
  const [pend] = await db
    .select({ n: count() })
    .from(entradas)
    .where(sql`${entradas.empresaId} = ${c.empresaId} and ${entradas.status} <> 'lancada'`);
  const fiscal = (c.empresa.fiscal ?? {}) as Record<string, unknown>;
  return (
    <DashboardView
      dados={dados}
      empresa={{
        nome: c.empresa.nome,
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        plano: c.empresa.plano,
        trialUntil: c.empresa.trialUntil ? new Date(c.empresa.trialUntil).toISOString() : null,
        uf: c.empresa.uf,
        ambiente: String(fiscal.ambiente ?? "2"),
        entradasPendentes: Number(pend?.n ?? 0),
      }}
    />
  );
}
