import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarInutilizacoes, listarProximoNumero, listarVendas } from "@/server/dados";
import { DocumentosView } from "@/views/Documentos";
import type { Emitente } from "@/lib/danfe";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const fiscal = (c.empresa.fiscal ?? {}) as Record<string, unknown>;
  const serieAtual = String(fiscal.serieNfce ?? "1");
  const [vendas, inutilizacoes] = await Promise.all([
    listarVendas(c.empresaId),
    listarInutilizacoes(c.empresaId),
  ]);
  const proximoNumero = await listarProximoNumero(c.empresaId, "NFC-e", serieAtual);
  return (
    <DocumentosView
      vendas={vendas}
      empresa={{
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        nome: c.empresa.nome,
        cnpj: c.empresa.cnpj,
        endereco: c.empresa.endereco || "",
        municipio: c.empresa.municipio || "",
        uf: c.empresa.uf,
      }}
      emitente={{
        nome: c.empresa.nome,
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        cnpj: c.empresa.cnpj,
        ie: c.empresa.ie || "",
        regime: c.empresa.regime,
        endereco: [c.empresa.endereco, c.empresa.numero, c.empresa.bairro].filter(Boolean).join(", "),
        municipio: c.empresa.municipio || "",
        uf: c.empresa.uf,
        codMunicipio: c.empresa.codMunicipio || "",
      } satisfies Emitente}
      inutilizacoes={inutilizacoes}
      proximoNumero={proximoNumero}
      serieAtual={serieAtual}
    />
  );
}
