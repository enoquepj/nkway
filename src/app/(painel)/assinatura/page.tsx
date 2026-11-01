import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { obterPainelAssinatura } from "@/server/dados";
import { PainelAssinatura } from "@/views/Assinatura";

export const dynamic = "force-dynamic";

export default async function AssinaturaPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const dados = await obterPainelAssinatura(c.empresaId);
  return <PainelAssinatura dados={dados} usuarioPapel={normalizarPerfil(c.usuario.papel)} mostrarCabecalho />;
}
