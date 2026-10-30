import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarCategorias, listarProdutos } from "@/server/dados";
import { ProdutosView } from "@/views/Produtos";
import { planoById } from "@/lib/dominio";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [produtos, categorias] = await Promise.all([listarProdutos(c.empresaId), listarCategorias(c.empresaId)]);
  return (
    <ProdutosView
      produtos={produtos}
      categorias={categorias}
      plano={{ nome: planoById(c.empresa.plano).nome, limite: planoById(c.empresa.plano).limiteProdutos, atuais: produtos.filter((p) => p.ativo).length }}
    />
  );
}
