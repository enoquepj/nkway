import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarVendas } from "@/server/dados";
import { DocumentosView } from "@/views/Documentos";

export const dynamic = "force-dynamic";

export default async function DocumentosPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const vendas = await listarVendas(c.empresaId);
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
    />
  );
}
