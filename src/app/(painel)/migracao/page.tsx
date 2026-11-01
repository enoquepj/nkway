import { redirect } from "next/navigation";
import { normalizarPerfil } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { inspecionarFontesLegadas } from "@/server/migracaoLegadoCore";
import { MigracaoLegadoView } from "@/views/MigracaoLegado";

export const dynamic = "force-dynamic";

export default async function MigracaoLegadoPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const inspecao = await inspecionarFontesLegadas(c.empresaId);
  return (
    <MigracaoLegadoView
      inspecao={inspecao}
      empresaAtual={{ nome: c.empresa.nome, cnpj: c.empresa.cnpj }}
      usuarioPapel={normalizarPerfil(c.usuario.papel)}
    />
  );
}
