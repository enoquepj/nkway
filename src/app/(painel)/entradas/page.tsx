import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarEntradas, listarFornecedores, listarProdutos } from "@/server/dados";
import { EntradasView } from "@/views/Entradas";

export const dynamic = "force-dynamic";

export default async function EntradasPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [entradas, produtos, fornecedores] = await Promise.all([listarEntradas(c.empresaId), listarProdutos(c.empresaId), listarFornecedores(c.empresaId)]);
  return (
    <EntradasView
      entradas={entradas}
      produtos={produtos.map((p) => ({ id: p.id, nome: p.nome, sku: p.sku, gtin: p.gtin, estoque: p.estoque, custo: p.custo, preco: p.preco, unidade: p.unidade }))}
      fornecedores={fornecedores.map((f) => ({ id: f.id, nome: f.nome, cnpj: f.cnpj, prazoPagDias: f.prazoPagDias }))}
    />
  );
}
