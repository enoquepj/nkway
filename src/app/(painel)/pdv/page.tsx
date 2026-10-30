import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarClientes, listarProdutos } from "@/server/dados";
import { PdvView } from "@/views/Pdv";

export const dynamic = "force-dynamic";

export default async function PdvPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [produtos, clientes] = await Promise.all([listarProdutos(c.empresaId, true), listarClientes(c.empresaId)]);
  const fiscal = (c.empresa.fiscal ?? {}) as Record<string, unknown>;
  return (
    <PdvView
      produtos={produtos}
      clientes={clientes.map((cl) => ({
        id: cl.id,
        nome: cl.nome,
        documento: cl.documento,
        condicaoPadrao: cl.condicaoPadrao,
        limiteCredito: cl.limiteCredito,
        saldoEmAberto: cl.saldoEmAberto,
      }))}
      empresa={{
        nome: c.empresa.nome,
        fantasia: c.empresa.nomeFantasia || c.empresa.nome,
        cnpj: c.empresa.cnpj,
        documento: c.empresa.cnpj,
        endereco: c.empresa.endereco || "",
        municipio: c.empresa.municipio || "",
        ambiente: String(fiscal.ambiente ?? "2"),
      }}
    />
  );
}
