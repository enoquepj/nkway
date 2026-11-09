import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarCategorias, listarComplementosFiscais, listarPerfisFiscais, listarProdutos } from "@/server/dados";
import { ProdutosView } from "@/views/Produtos";
import { planoById } from "@/lib/dominio";
import { temPermissao } from "@/lib/permissoes";
import { resolverCrtFiscal } from "@/server/tributacaoCore";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [produtos, categorias, perfis, complementos] = await Promise.all([
    listarProdutos(c.empresaId), listarCategorias(c.empresaId), listarPerfisFiscais(c.empresaId), listarComplementosFiscais(c.empresaId),
  ]);
  const crt = resolverCrtFiscal(c.empresa.regime, c.empresa.fiscal).crt;
  return (
    <ProdutosView
      produtos={produtos}
      categorias={categorias}
      podeFiscal={temPermissao(c.usuario.papel, "config.gerenciar")}
      plano={{ nome: planoById(c.empresa.plano).nome, limite: planoById(c.empresa.plano).limiteProdutos, atuais: produtos.filter((p) => p.ativo).length }}
      perfis={perfis}
      complementos={complementos}
      regime={c.empresa.regime}
      crt={crt}
    />
  );
}
