import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { temPermissao } from "@/lib/permissoes";
import { listarKardex, posicaoEstoque, vendasPorProdutoRecentes } from "@/server/dados";
import { EstoqueView } from "@/views/Estoque";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [posicao, movimentos, vendasRecentes] = await Promise.all([posicaoEstoque(c.empresaId), listarKardex(c.empresaId), vendasPorProdutoRecentes(c.empresaId)]);
  return (
    <EstoqueView
      posicao={posicao}
      movimentos={movimentos}
      vendasRecentes={vendasRecentes}
      podeAjustar={temPermissao(c.usuario.papel, "estoque.ajustar")}
      produtos={posicao.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome, sku: p.sku, gtin: p.gtin, categoria: p.categoria, localizacao: p.localizacao ?? "", estoque: p.estoque, estoqueMin: p.estoqueMin, unidade: p.unidade, custo: p.custoMedio }))}
    />
  );
}
