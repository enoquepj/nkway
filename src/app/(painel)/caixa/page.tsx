import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { listarSessoesCaixa, obterSessaoCaixaOperador } from "@/server/dados";
import { CaixaView } from "@/views/Caixa";

export const dynamic = "force-dynamic";

export default async function CaixaPage() {
  const c = await contexto();
  if (!c) redirect("/login");

  const papel = normalizarPerfil(c.usuario.papel);
  const [sessaoAtual, historico] = await Promise.all([
    obterSessaoCaixaOperador(c.empresaId, c.usuario.id, papel),
    listarSessoesCaixa(c.empresaId, c.usuario.id, papel),
  ]);

  return (
    <CaixaView
      sessaoAtual={sessaoAtual}
      historico={historico}
      usuarioAtual={{
        id: c.usuario.id,
        nome: c.usuario.nome,
        papel,
      }}
    />
  );
}
