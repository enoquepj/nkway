import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { listarKardex, posicaoEstoque } from "@/server/dados";
import { EstoqueView } from "@/views/Estoque";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const c = await contexto();
  if (!c) redirect("/login");
  const [posicao, movimentos] = await Promise.all([posicaoEstoque(c.empresaId), listarKardex(c.empresaId)]);
  return (
    <EstoqueView
      posicao={posicao}
      movimentos={movimentos}
      produtos={posicao.map((p) => ({ id: p.id, nome: p.nome, estoque: p.estoque, estoqueMin: p.estoqueMin, unidade: p.unidade, custo: p.custo }))}
    />
  );
}
