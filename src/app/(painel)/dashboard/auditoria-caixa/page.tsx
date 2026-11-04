import { redirect } from "next/navigation";
import { normalizarPerfil, temPermissao } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { listarAuditoriaCaixa } from "@/server/caixaCore";
import { AuditoriaCaixaView } from "@/views/AuditoriaCaixa";

export const dynamic = "force-dynamic";

/** Rota exclusiva de GERENTE / ADMINISTRADOR (permissão `caixa.auditoria`). */
export default async function AuditoriaCaixaPage() {
  const c = await contexto();
  if (!c) redirect("/login");

  const papel = normalizarPerfil(c.usuario.papel);
  if (!temPermissao(papel, "caixa.auditoria")) redirect("/");

  const linhas = await listarAuditoriaCaixa(c.empresaId);
  return <AuditoriaCaixaView linhas={linhas} podeHomologar={temPermissao(papel, "caixa.homologar")} />;
}
