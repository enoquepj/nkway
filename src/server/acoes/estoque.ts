"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { movimentos, produtos } from "@/db/schema";
import { round2 } from "@/lib/dominio";
import { lerQuantidade } from "@/lib/estoqueIndicadores";
import { comoErro, exigirPermissao, texto, corpo } from "@/server/tenant";

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
    const { empresaId, usuario } = await exigirPermissao("estoque.ajustar");
    input = corpo(input);
    if (!texto(input.motivo).trim()) return { ok: false, erro: "Descreva o motivo do ajuste (auditoria do kardex)." };
    if (!(input.tipo in ROTULO)) return { ok: false, erro: "Tipo de movimento inválido." };
    const qtd = Number(input.qtd);
    if (!Number.isFinite(qtd)) return { ok: false, erro: "Quantidade inválida." };
    if (input.modo === "delta" && Math.abs(qtd) < 0.0005) return { ok: false, erro: "Informe uma quantidade diferente de zero." };
    const resultado = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(produtos).where(and(eq(produtos.id, input.produtoId), eq(produtos.empresaId, empresaId))).for("update");
      if (!p) return { ok: false as const, erro: "Produto não encontrado." };
      const atual = Number(p.estoque);
      const novo = input.modo === "inventario" ? round2(Math.max(0, qtd)) : round2(atual + qtd);
      if (novo < 0) return { ok: false as const, erro: `O ajuste deixaria o saldo negativo (atual ${atual} ${p.unidade}).` };
      const delta = round2(novo - atual);
      if (Math.abs(delta) < 0.0005) return { ok: true as const, aviso: `${p.nome}: saldo já era ${atual} ${p.unidade}; nada a lançar.` };
      await tx.update(produtos).set({ estoque: novo, atualizadoEm: new Date() }).where(and(eq(produtos.id, p.id), eq(produtos.empresaId, empresaId)));
      await tx.insert(movimentos).values({
        empresaId, produtoId: p.id, produtoNome: p.nome, tipo: input.tipo, qtd: delta, saldoApos: novo,
        custoUnit: Number(p.custo), custoMedioApos: Number(p.custo), documento: ROTULO[input.tipo],
        observacao: texto(input.motivo).trim().slice(0, 200), usuarioId: usuario.id, usuarioNome: usuario.nome,
      });
      return { ok: true as const, aviso: `${p.nome}: saldo ${atual} → ${novo} ${p.unidade}.` };
    });
    if (resultado.ok) revalidar();
    return resultado;
  } catch (e) {
    return comoErro(e);
  }
}

/** Inventário em lote: transação única, trava por produto (FOR UPDATE), recusa quantidade inválida e grava só as linhas com diferença.
 *  `rotulo` identifica a sessão de contagem (ex.: "Inventário geral 11/2026", "Contagem corredor 3") e vai para o documento do kardex. */
export async function lancarInventario(
  bruto: { produtoId: string; quantidade: number | string; observacao?: string }[] | { linhas: { produtoId: string; quantidade: number | string; observacao?: string }[]; rotulo?: string },
): Promise<{ ok: true; ajustados: number; semDiferenca: number; aviso?: string } | { ok: false; erro: string }> {
  try {
    const { empresaId, usuario } = await exigirPermissao("estoque.ajustar");
    const entrada = Array.isArray(bruto) ? { linhas: bruto, rotulo: "" } : corpo<{ linhas?: unknown; rotulo?: unknown }>(bruto);
    const linhas = Array.isArray(entrada.linhas) ? entrada.linhas as { produtoId: unknown; quantidade: unknown; observacao?: unknown }[] : [];
    const rotulo = texto(entrada.rotulo).trim().slice(0, 80) || "Inventário";
    if (linhas.length === 0) return { ok: false, erro: "Nenhuma contagem informada." };
    if (linhas.length > 2000) return { ok: false, erro: "Aplique a contagem em lotes de até 2.000 produtos." };
    const preparadas: { produtoId: string; quantidade: number; observacao: string }[] = [];
    for (const l of linhas) {
      const produtoId = texto(l.produtoId);
      const quantidade = lerQuantidade(l.quantidade);
      if (!/^[0-9a-f-]{36}$/i.test(produtoId)) return { ok: false, erro: "Produto inválido na contagem." };
      if (quantidade === null) return { ok: false, erro: "Há contagem com quantidade inválida (use números, com até 3 casas, sem sinal)." };
      preparadas.push({ produtoId, quantidade, observacao: texto(l.observacao).trim().slice(0, 200) });
    }
    const ids = [...new Set(preparadas.map((p) => p.produtoId))];
    if (ids.length !== preparadas.length) return { ok: false, erro: "Há produto repetido na contagem." };
    const resultado = await db.transaction(async (tx) => {
      const atuais = await tx.select().from(produtos).where(and(eq(produtos.empresaId, empresaId), inArray(produtos.id, ids))).for("update");
      const porId = new Map(atuais.map((p) => [p.id, p]));
      if (porId.size !== ids.length) return { ok: false as const, erro: "Há produto que não pertence a esta empresa ou foi excluído." };
      let ajustados = 0, semDiferenca = 0;
      const agora = new Date();
      for (const l of preparadas) {
        const p = porId.get(l.produtoId)!;
        const atual = Number(p.estoque);
        const delta = round2(l.quantidade - atual);
        if (Math.abs(delta) < 0.0005) { semDiferenca++; continue; }
        await tx.update(produtos).set({ estoque: l.quantidade, atualizadoEm: agora }).where(and(eq(produtos.id, p.id), eq(produtos.empresaId, empresaId)));
        await tx.insert(movimentos).values({
          empresaId, produtoId: p.id, produtoNome: p.nome, tipo: "inventario", qtd: delta, saldoApos: l.quantidade,
          custoUnit: Number(p.custo), custoMedioApos: Number(p.custo), documento: rotulo,
          observacao: l.observacao || `Contagem física: sistema ${atual} → contado ${l.quantidade}`,
          usuarioId: usuario.id, usuarioNome: usuario.nome, data: agora,
        });
        ajustados++;
      }
      return { ok: true as const, ajustados, semDiferenca };
    });
    if (!resultado.ok) return resultado;
    revalidar();
    return { ...resultado, aviso: `${rotulo}: ${resultado.ajustados} produto(s) ajustado(s), ${resultado.semDiferenca} sem diferença.` };
  } catch (e) {
    return comoErro(e);
  }
}
