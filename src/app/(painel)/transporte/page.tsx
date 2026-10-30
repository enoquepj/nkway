import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarMdfes, listarVendas } from "@/server/dados";
import { TransporteView } from "@/views/Transporte";
import type { Emitente } from "@/lib/danfe";

export const dynamic = "force-dynamic";

export default async function TransportePage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [mdfes, vendas] = await Promise.all([listarMdfes(c.empresaId), listarVendas(c.empresaId)]);
  const ocupadas = new Set(mdfes.filter((m) => m.status !== "cancelado").flatMap((m) => m.documentos.map((d) => d.chave)));
  return (
    <TransporteView
      mdfes={mdfes}
      notas={vendas
        .filter((v) => v.tipo === "fiscal" && v.status === "faturado" && v.chave && !ocupadas.has(v.chave))
        .map((v) => ({ chave: v.chave!, modelo: v.modelo ?? "NF-e", numeroNota: v.numeroNota ?? 0, clienteNome: v.clienteNome, total: v.total, data: v.data }))}
      empresa={{
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        razao: c.empresa.nome,
        cnpj: c.empresa.cnpj,
        ie: c.empresa.ie || "",
        municipio: c.empresa.municipio || "",
        uf: c.empresa.uf,
        endereco: c.empresa.endereco || "",
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
    />
  );
}
