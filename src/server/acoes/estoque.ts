"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { movimentos, produtos } from "@/db/schema";
import { round2 } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };

const revalidar = () => ["/estoque", "/", "/produtos"].forEach((p) => revalidatePath(p));

type TipoAjuste = "ajuste" | "perda" | "devolucao" | "inventario";

const ROTULO: Record<TipoAjuste, string> = {
  ajuste: "Ajuste de estoque",
  perda: "Perda / avaria",
  devolucao: "Devolução",
  inventario: "Inventário",
};

export async function ajustarEstoque(input: {
  produtoId: string;
  tipo: TipoAjuste;
  /** positivo = entra, negativo = sai; ignorado quando modo = inventario */
  qtd: number;
  motivo: string;
  modo: "delta" | "inventario";
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [p] = await db.select().from(produtos).where(and(eq(produtos.id, input.produtoId), eq(produtos.empresaId, empresaId))).limit(1);
    if (!p) return { ok: false, erro: "Produto não encontrado." };
    if (!input.motivo.trim()) return { ok: false, erro: "Descreva o motivo do ajuste (auditoria do kardex)." };
    const atual = Number(p.estoque);
    const novo = input.modo === "inventario" ? round2(Math.max(0, input.qtd)) : round2(atual + input.qtd);
    if (novo < 0) return { ok: false, erro: `O ajuste deixaria o saldo negativo (atual ${atual} ${p.unidade}).` };
    const delta = round2(novo - atual);
    await db.update(produtos).set({ estoque: novo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
    await db.insert(movimentos).values({
      empresaId,
      produtoId: p.id,
      produtoNome: p.nome,
      tipo: input.tipo,
      qtd: delta,
      saldoApos: novo,
      custoUnit: Number(p.custo),
      custoMedioApos: Number(p.custo),
      documento: ROTULO[input.tipo],
      observacao: input.motivo.trim(),
    });
    revalidar();
    return { ok: true, aviso: `${p.nome}: saldo ${atual} → ${novo} ${p.unidade}.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** inventário em lote: grava só as linhas com diferença */
export async function lancarInventario(linhas: { produtoId: string; quantidade: number; observacao: string }[]): Promise<{ ok: true; ajustados: number } | { ok: false; erro: string }> {
  try {
    const { empresaId } = await tenant();
    let ajustados = 0;
    for (const l of linhas) {
      const [p] = await db.select().from(produtos).where(and(eq(produtos.id, l.produtoId), eq(produtos.empresaId, empresaId))).limit(1);
      if (!p) continue;
      const atual = Number(p.estoque);
      const novo = round2(Math.max(0, l.quantidade));
      if (Math.abs(novo - atual) < 0.0005) continue;
      await db.update(produtos).set({ estoque: novo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
      await db.insert(movimentos).values({
        empresaId,
        produtoId: p.id,
        produtoNome: p.nome,
        tipo: "inventario",
        qtd: round2(novo - atual),
        saldoApos: novo,
        custoUnit: Number(p.custo),
        custoMedioApos: Number(p.custo),
        documento: "Inventário",
        observacao: l.observacao || "Contagem física",
      });
      ajustados++;
    }
    revalidar();
    return { ok: true, ajustados };
  } catch (e) {
    return comoErro(e);
  }
}
