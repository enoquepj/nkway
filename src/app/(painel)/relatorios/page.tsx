import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarContas, listarVendas, posicaoEstoque } from "@/server/dados";
import { RelatoriosView } from "@/views/Relatorios";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [vendas, contas, estoque] = await Promise.all([listarVendas(c.empresaId), listarContas(c.empresaId), posicaoEstoque(c.empresaId)]);
  return (
    <RelatoriosView
      vendas={vendas.map((v) => ({
        id: v.id,
        data: v.data,
        total: v.total,
        subtotal: v.subtotal,
        desconto: v.desconto,
        status: v.status,
        tipo: v.tipo,
        modelo: v.modelo,
        forma: v.formaPagamento,
        clienteNome: v.clienteNome,
        pagamentos: v.pagamentos,
        itens: v.itens,
      }))}
      contas={contas}
      estoque={estoque.map((p) => ({ nome: p.nome, categoria: p.categoria, estoque: p.estoque, custoMedio: p.custoMedio, valorTotal: p.valorTotal, valorVenda: p.valorVenda, situacao: p.situacao }))}
      empresa={c.empresa.nomeFantasia || c.empresa.nome}
    />
  );
}
