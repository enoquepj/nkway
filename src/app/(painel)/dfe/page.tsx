import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { obterPainelDfe } from "@/server/dados";
import { DfeView } from "@/views/Dfe";

export const dynamic = "force-dynamic";

export default async function DfePage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const dados = await obterPainelDfe(c.empresaId);
  return <DfeView dados={dados} />;
}
