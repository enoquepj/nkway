import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { projetarCaixaVisivel, type CaixaSessaoAbertaVisivel } from "@/lib/caixaVisivel";
import { contexto } from "@/lib/session";
import { listarSessoesCaixa, listarUsuarios } from "@/server/dados";
import { CaixaView } from "@/views/Caixa";

export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const c = await contexto();
  if (!c) redirect("/login");

  const papel = normalizarPerfil(c.usuario.papel);
  const [sessoes, usuariosEmpresa] = await Promise.all([
    listarSessoesCaixa(c.empresaId, c.usuario.id, papel),
    listarUsuarios(c.empresaId),
  ]);
  const historico = sessoes.map(projetarCaixaVisivel);
  const sessaoAtual = historico.find((s): s is CaixaSessaoAbertaVisivel => s.status === "aberto" && s.operadorId === c.usuario.id) ?? null;
  const operadores = usuariosEmpresa.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }));

  return (
    <CaixaView
      sessaoAtual={sessaoAtual}
      historico={historico}
      usuarioAtual={{
        id: c.usuario.id,
        nome: c.usuario.nome,
        papel,
      }}
      operadores={operadores}
    />
  );
}
