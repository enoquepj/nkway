import { redirect } from "next/navigation";
import { temPermissao } from "@/lib/permissoes";
import { fusoRelatorioPdv, periodoPadraoRelatorioPdv } from "@/lib/relatoriosPdv";
import { contexto } from "@/lib/session";
import { RelatoriosPdvView } from "@/views/RelatoriosPdv";

export const dynamic = "force-dynamic";

/** A página e a API verificam a permissão independentemente. */
export default async function RelatoriosPdvPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  if (!temPermissao(c.usuario.papel, "caixa.auditoria")) redirect("/");
  const fuso = fusoRelatorioPdv(c.empresa.uf);
  return <RelatoriosPdvView empresa={c.empresa.nomeFantasia || c.empresa.nome} fuso={fuso} periodoInicial={periodoPadraoRelatorioPdv(fuso)} />;
}
