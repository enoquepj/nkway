import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarClientes, listarContas, listarFornecedores } from "@/server/dados";
import { FinanceiroView } from "@/views/Financeiro";

export const dynamic = "force-dynamic";

export default async function FinanceiroPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [contas, clientes, fornecedores] = await Promise.all([
    listarContas(c.empresaId),
    listarClientes(c.empresaId),
    listarFornecedores(c.empresaId),
  ]);
  return (
    <FinanceiroView
      contas={contas}
      clientes={clientes.map((x) => ({ id: x.id, nome: x.nome }))}
      fornecedores={fornecedores.map((x) => ({ id: x.id, nome: x.nome }))}
    />
  );
}
