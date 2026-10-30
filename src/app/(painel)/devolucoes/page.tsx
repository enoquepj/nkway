import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { movimentos } from "@/db/schema";
import { contexto } from "@/lib/session";
import { DevolucoesView } from "@/views/Devolucoes";
import { listarDevolucoes, listarEntradasDevolviveis } from "@/server/dados";

export const dynamic = "force-dynamic";

export default async function DevolucoesPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [devolucoes, entradas, kardex] = await Promise.all([
    listarDevolucoes(c.empresaId),
    listarEntradasDevolviveis(c.empresaId),
    db
      .select({ nome: movimentos.produtoNome, qtd: movimentos.qtd, documento: movimentos.documento, data: movimentos.data })
      .from(movimentos)
      .where(and(eq(movimentos.empresaId, c.empresaId), eq(movimentos.tipo, "devolucao")))
      .orderBy(desc(movimentos.data))
      .limit(20),
  ]);
  return (
    <DevolucoesView
      devolucoes={devolucoes}
      entradas={entradas}
      ufEmpresa={c.empresa.uf}
      kardexDevolucao={kardex.map((m) => ({
        nome: m.nome,
        qtd: Number(m.qtd),
        documento: m.documento ?? "",
        data: m.data ? new Date(m.data).toISOString() : "",
      }))}
    />
  );
}
