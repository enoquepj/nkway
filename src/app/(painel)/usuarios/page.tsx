import { redirect } from "next/navigation";
import { planoById } from "@/lib/dominio";
import { normalizarPerfil, temPermissao } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { listarAuditorias, listarUsuarios } from "@/server/dados";
import { UsuariosView } from "@/views/Usuarios";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const c = await contexto();
  if (!c) redirect("/login");

  const papel = normalizarPerfil(c.usuario.papel);
  const podeVerUsuarios = temPermissao(papel, "usuarios.ver");
  const podeVerAuditoria = temPermissao(papel, "auditoria.ver");

  const [usuarios, auditorias] = await Promise.all([
    podeVerUsuarios ? listarUsuarios(c.empresaId) : Promise.resolve([]),
    podeVerAuditoria ? listarAuditorias(c.empresaId) : Promise.resolve([]),
  ]);

  const cfgPlano = planoById(c.empresa.plano);

  return (
    <UsuariosView
      usuarios={usuarios}
      auditorias={auditorias}
      usuarioAtual={{
        id: c.usuario.id,
        nome: c.usuario.nome,
        papel,
      }}
      plano={{
        nome: cfgPlano.nome,
        limiteUsuarios: cfgPlano.limiteUsuarios,
      }}
    />
  );
}
