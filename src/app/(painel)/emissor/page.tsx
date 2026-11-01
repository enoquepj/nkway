import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { obterPainelEmissorFiscal } from "@/server/dados";
import { EmissorFiscalView } from "@/views/EmissorFiscal";

export const dynamic = "force-dynamic";

export default async function EmissorFiscalPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const dados = await obterPainelEmissorFiscal(c.empresaId);
  return <EmissorFiscalView dados={dados} usuarioPapel={normalizarPerfil(c.usuario.papel)} />;
}
