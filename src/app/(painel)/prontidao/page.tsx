import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { obterProntidao } from "@/server/prontidaoCore";
import { ProntidaoView } from "@/views/Prontidao";
import { obterVersaoDeploy } from "@/server/versaoDeploy";

export const dynamic = "force-dynamic";

export default async function ProntidaoPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const dados = await obterProntidao(c.empresaId, c.empresa.nomeFantasia || c.empresa.nome);
  return <ProntidaoView dados={dados} versao={obterVersaoDeploy()} />;
}
