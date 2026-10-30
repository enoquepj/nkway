import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarContas } from "@/server/dados";
import { FinanceiroView } from "@/views/Financeiro";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const contas = await listarContas(c.empresaId);
  return <FinanceiroView contas={contas} />;
}
