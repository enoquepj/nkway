import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarClientes, listarFornecedores, listarVendas } from "@/server/dados";
import { ClientesView } from "@/views/Clientes";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [clientes, fornecedores, vendas] = await Promise.all([listarClientes(c.empresaId), listarFornecedores(c.empresaId), listarVendas(c.empresaId)]);
  return (
    <ClientesView
      clientes={clientes}
      fornecedores={fornecedores}
      historico={vendas.map((v) => ({
        clienteId: v.clienteId,
        id: v.id,
        numero: v.numero,
        data: v.data,
        total: v.total,
        status: v.status,
        tipo: v.tipo,
        forma: v.formaPagamento,
        itens: v.itens.length,
        modelo: v.modelo,
        numeroNota: v.numeroNota,
      }))}
    />
  );
}
