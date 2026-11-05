import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitulo } from "@/components/ui";
import { temPermissao } from "@/lib/permissoes";
import { contexto } from "@/lib/session";
import { listarPainelTributacao } from "@/server/tributacaoCore";
import { TributacaoProdutosView } from "@/views/TributacaoProdutos";

export const dynamic = "force-dynamic";

export default async function TributacaoProdutosPage({ searchParams }: { searchParams: Promise<{ produto?: string | string[] }> }) {
  const c = await contexto();
  if (!c) redirect("/login");
  if (!temPermissao(c.usuario.papel, "config.gerenciar")) redirect("/");
  const params = await searchParams;
  const produtoInicial = typeof params.produto === "string" ? params.produto : "";
  try {
    const dados = await listarPainelTributacao(c.empresaId, c.empresa.nomeFantasia || c.empresa.nome, c.empresa.regime, c.empresa.fiscal);
    return <TributacaoProdutosView dados={dados} produtoInicial={produtoInicial} />;
  } catch (e) {
    console.error("[tributacao] Painel indisponível:", e instanceof Error ? e.name : "erro inesperado");
    return <Card><CardTitulo titulo="Parametrização fiscal indisponível" descricao="Não foi possível carregar as tabelas complementares. Os produtos existentes não foram alterados." icone="alerta" /><p className="text-sm text-ink-600">Verifique a aplicação da migração aditiva fiscal na prévia ou nos registros do servidor antes de usar esta tela.</p><Link href="/config" className="mt-4 inline-block text-sm font-semibold text-way-700 underline">Voltar às configurações</Link></Card>;
  }
}
