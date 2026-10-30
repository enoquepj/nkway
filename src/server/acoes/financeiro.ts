"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contas } from "@/db/schema";
import { hojeISO, round2 } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };

const revalidar = () => ["/financeiro", "/", "/documentos"].forEach((p) => revalidatePath(p));

export async function lancarConta(input: {
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string;
  contraparteNome: string;
  valor: number;
  vencimento: string;
  forma: string;
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (input.descricao.trim().length < 3) return { ok: false, erro: "Descreva o título." };
    if (!(input.valor > 0)) return { ok: false, erro: "O valor deve ser maior que zero." };
    await db.insert(contas).values({
      empresaId,
      tipo: input.tipo,
      descricao: input.descricao.trim(),
      categoria: input.categoria || (input.tipo === "receber" ? "Vendas" : "Custos"),
      contraparteNome: input.contraparteNome.trim(),
      valor: round2(input.valor),
      vencimento: input.vencimento || hojeISO(),
      forma: input.forma,
      status: "aberta",
    });
    revalidar();
    return { ok: true, aviso: `Título de ${input.tipo} lançado.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function baixarConta(input: {
  contaId: string;
  valor: number;
  forma: string;
  data: string;
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [c] = await db.select().from(contas).where(and(eq(contas.id, input.contaId), eq(contas.empresaId, empresaId))).limit(1);
    if (!c) return { ok: false, erro: "Título não encontrado." };
    if (c.status === "paga") return { ok: false, erro: "Este título já está baixado." };
    const valor = round2(input.valor > 0 ? input.valor : Number(c.valor) - Number(c.valorPago));
    if (valor <= 0) return { ok: false, erro: "Valor de baixa inválido." };
    const pago = round2(Number(c.valorPago) + valor);
    const total = round2(Number(c.valor));
    await db
      .update(contas)
      .set({ valorPago: pago, status: pago + 0.01 >= total ? "paga" : "aberta", pagoEm: input.data || hojeISO(), forma: input.forma || c.forma })
      .where(eq(contas.id, c.id));
    revalidar();
    return {
      ok: true,
      aviso: pago + 0.01 >= total ? `Título quitado (${valor.toFixed(2)} recebidos).` : `Baixa parcial: restam ${round2(total - pago).toFixed(2)}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function reabrirConta(contaId: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    await db.update(contas).set({ status: "aberta", valorPago: 0, pagoEm: null }).where(and(eq(contas.id, contaId), eq(contas.empresaId, empresaId)));
    revalidar();
    return { ok: true, aviso: "Título reaberto." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirConta(contaId: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    await db.delete(contas).where(and(eq(contas.id, contaId), eq(contas.empresaId, empresaId)));
    revalidar();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** ajuste de data em lote (antecipação / renegociação de vencimento) */
export async function moverVencimentos(contaIds: string[], dias: number): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    let n = 0;
    for (const id of contaIds) {
      const [c] = await db.select().from(contas).where(and(eq(contas.id, id), eq(contas.empresaId, empresaId))).limit(1);
      if (!c || c.status === "paga") continue;
      const d = new Date(`${c.vencimento}T12:00:00`);
      d.setDate(d.getDate() + dias);
      await db.update(contas).set({ vencimento: d.toISOString().slice(0, 10) }).where(eq(contas.id, c.id));
      n++;
    }
    revalidar();
    return { ok: true, aviso: `${n} título(s) com vencimento deslocado em ${dias} dia(s).` };
  } catch (e) {
    return comoErro(e);
  }
}
