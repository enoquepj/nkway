"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contas, devolucoes, entradas, movimentos, produtos } from "@/db/schema";
import { cfopDevolucao, gerarChave, round2, UF_NUMERO, soDigitos, validarChaveAcesso } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string; id?: string } | { ok: false; erro: string };

const revalidar = () => ["/devolucoes", "/entradas", "/estoque", "/financeiro", "/", "/produtos"].forEach((p) => revalidatePath(p));

type ItemEntrada = { produtoId: string | null; nome: string; unidade: string; ncm: string; cfop: string; qtd: number; qtdNota: number; custo: number; preco: number };

/** itens disponíveis numa entrada já lançada (base para a devolução) */
export async function itensDaEntrada(entradaId: string) {
  const { empresaId } = await tenant();
  const [e] = await db
    .select()
    .from(entradas)
    .where(and(eq(entradas.id, entradaId), eq(entradas.empresaId, empresaId)))
    .limit(1);
  if (!e) return { ok: false as const, erro: "Nota de entrada não encontrada." };
  const devolvidos = await db
    .select({ itens: devolucoes.itens, status: devolucoes.status })
    .from(devolucoes)
    .where(and(eq(devolucoes.empresaId, empresaId), eq(devolucoes.entradaId, entradaId)));
  const ja = new Map<string, number>();
  for (const d of devolvidos)
    for (const i of d.itens ?? []) if (i.produtoId) ja.set(i.produtoId, round2((ja.get(i.produtoId) ?? 0) + i.qtd));
  return {
    ok: true as const,
    entrada: {
      id: e.id,
      numeroNota: e.numeroNota,
      serie: e.serie,
      chave: e.chave,
      fornecedor: e.fornecedor,
      cnpjFornecedor: e.cnpjFornecedor,
      fornecedorId: e.fornecedorId,
      emissao: String(e.emissao),
      status: e.status,
    },
    itens: (e.itens ?? []).map<ItemEntrada & { disponivel: number }>((i) => ({
      ...i,
      disponivel: round2(Math.max(0, i.qtdNota - (i.produtoId ? ja.get(i.produtoId) ?? 0 : 0))),
    })),
  };
}

/** emite a devolução de compra: gera NFref, baixa o estoque e cria o crédito com o fornecedor */
export async function emitirDevolucao(input: {
  entradaId: string;
  itens: { produtoId: string | null; nome: string; unidade: string; ncm: string; qtd: number; custo: number }[];
  motivo: string;
  gerarFinanceiro: boolean;
}): Promise<Resultado> {
  try {
    const { empresaId, empresa } = await tenant();
    const [ent] = await db
      .select()
      .from(entradas)
      .where(and(eq(entradas.id, input.entradaId), eq(entradas.empresaId, empresaId)))
      .limit(1);
    if (!ent) return { ok: false, erro: "Nota de entrada não encontrada." };
    if (ent.status !== "lancada") return { ok: false, erro: "Só é possível devolver mercadoria de uma entrada já lançada." };
    if (!validarChaveAcesso(ent.chave))
      return { ok: false, erro: "A nota de entrada não tem uma chave de acesso válida — o NFref precisa de 44 dígitos com DV." };

    const itens = input.itens.filter((i) => i.qtd > 0);
    if (!itens.length) return { ok: false, erro: "Informe a quantidade devolvida de pelo menos um item." };
    if (!input.motivo.trim()) return { ok: false, erro: "Descreva o motivo da devolução (exigido na autorização)." };

    // valida saldo e produto de cada item
    for (const i of itens) {
      if (!i.produtoId) return { ok: false, erro: `O item ${i.nome} não está vinculado a um produto do cadastro.` };
      const [p] = await db
        .select()
        .from(produtos)
        .where(and(eq(produtos.id, i.produtoId), eq(produtos.empresaId, empresaId)))
        .limit(1);
      if (!p) return { ok: false, erro: `Produto ${i.nome} não encontrado nesta empresa.` };
      if (round2(i.qtd) > round2(Number(p.estoque)))
        return { ok: false, erro: `${p.nome}: devolução de ${i.qtd} ${p.unidade} com saldo de apenas ${p.estoque}.` };
    }

    const cfop = cfopDevolucao(empresa.uf, soDigitos(ent.cnpjFornecedor) ? (await ufDoFornecedor(empresaId, ent.fornecedorId)) || empresa.uf : empresa.uf);
    const [ultima] = await db
      .select({ n: sql<number>`coalesce(max(${devolucoes.numero}),0)` })
      .from(devolucoes)
      .where(eq(devolucoes.empresaId, empresaId));
    const numero = Number(ultima?.n ?? 0) + 1;
    const chave = gerarChave({
      uf: UF_NUMERO[empresa.uf] ?? "11",
      aamm: `${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth() + 1).padStart(2, "0")}`,
      cnpj: empresa.cnpj,
      modelo: "55",
      serie: "1",
      numeroNota: numero,
    });

    const linhas = itens.map((i) => ({
      produtoId: i.produtoId,
      nome: i.nome,
      unidade: i.unidade || "UN",
      ncm: i.ncm || "00000000",
      cfop,
      qtd: round2(i.qtd),
      custo: round2(i.custo),
      total: round2(i.qtd * i.custo),
    }));
    const valorProdutos = round2(linhas.reduce((s, i) => s + i.total, 0));
    const total = round2(valorProdutos); // devolução não repõe frete destacado na nota original

    const [doc] = await db
      .insert(devolucoes)
      .values({
        empresaId,
        numero,
        serie: "1",
        chave,
        chaveReferente: ent.chave,
        entradaId: ent.id,
        fornecedor: ent.fornecedor,
        cnpjFornecedor: ent.cnpjFornecedor,
        fornecedorId: ent.fornecedorId,
        cfop,
        emissao: new Date().toISOString().slice(0, 10),
        valorProdutos,
        total,
        status: "emitida",
        gerarFinanceiro: input.gerarFinanceiro,
        motivo: input.motivo.trim(),
        itens: linhas,
      })
      .returning({ id: devolucoes.id });

    // baixa de estoque + kardex (saída com custo médio atual)
    for (const i of linhas) {
      if (!i.produtoId) continue;
      const [p] = await db.select().from(produtos).where(eq(produtos.id, i.produtoId)).limit(1);
      if (!p) continue;
      const atual = Number(p.estoque);
      const novo = round2(atual - i.qtd);
      if (novo < 0) return { ok: false, erro: `${p.nome}: estoque ficou negativo (${novo}). Devolução não registrada.` };
      await db.update(produtos).set({ estoque: novo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
      await db.insert(movimentos).values({
        empresaId,
        produtoId: p.id,
        produtoNome: p.nome,
        tipo: "devolucao",
        qtd: round2(-i.qtd),
        saldoApos: novo,
        custoUnit: round2(i.custo * 10000) / 10000,
        custoMedioApos: Number(p.custo),
        documento: `Devolução Nº ${numero} · NF ${ent.numeroNota}`,
        observacao: input.motivo.trim(),
      });
    }

    // crédito com o fornecedor (conta a receber)
    if (input.gerarFinanceiro && total > 0) {
      await db.insert(contas).values({
        empresaId,
        tipo: "receber",
        descricao: `Devolução Nº ${numero} — ${ent.fornecedor.slice(0, 30)}`,
        categoria: "Devoluções",
        contraparteNome: ent.fornecedor,
        valor: total,
        vencimento: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
        forma: "boleto",
        status: "aberta",
      });
    }

    revalidar();
    return { ok: true, id: doc.id, aviso: `Devolução Nº ${numero} emitida (${cfop}) — ${itens.length} item(ns), estoque baixado.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** cancela a devolução: volta o estoque e marca o documento */
export async function cancelarDevolucao(devolucaoId: string, motivo: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [d] = await db
      .select()
      .from(devolucoes)
      .where(and(eq(devolucoes.id, devolucaoId), eq(devolucoes.empresaId, empresaId)))
      .limit(1);
    if (!d) return { ok: false, erro: "Devolução não encontrada." };
    if (d.status === "cancelada") return { ok: false, erro: "Esta devolução já está cancelada." };
    if (!motivo.trim()) return { ok: false, erro: "Informe o motivo do cancelamento." };

    for (const i of d.itens ?? []) {
      if (!i.produtoId) continue;
      const [p] = await db.select().from(produtos).where(eq(produtos.id, i.produtoId)).limit(1);
      if (!p) continue;
      const novo = round2(Number(p.estoque) + i.qtd);
      await db.update(produtos).set({ estoque: novo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
      await db.insert(movimentos).values({
        empresaId,
        produtoId: p.id,
        produtoNome: p.nome,
        tipo: "devolucao",
        qtd: i.qtd,
        saldoApos: novo,
        custoUnit: round2(i.custo * 10000) / 10000,
        custoMedioApos: Number(p.custo),
        documento: `Cancelamento da devolução Nº ${d.numero}`,
        observacao: motivo.trim(),
      });
    }
    await db
      .update(contas)
      .set({ status: "cancelada" })
      .where(and(eq(contas.empresaId, empresaId), eq(contas.categoria, "Devoluções"), eq(contas.contraparteNome, d.fornecedor), eq(contas.valor, d.total), eq(contas.status, "aberta")));
    await db.update(devolucoes).set({ status: "cancelada", motivo: `${d.motivo ?? ""} · cancelada: ${motivo.trim()}` }).where(eq(devolucoes.id, d.id));
    revalidar();
    return { ok: true, aviso: `Devolução Nº ${d.numero} cancelada — estoque restaurado.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** UF cadastrada do fornecedor (usada para escolher 5201 ou 6201) */
async function ufDoFornecedor(empresaId: string, fornecedorId: string | null): Promise<string | null> {
  if (!fornecedorId) return null;
  const { fornecedores } = await import("@/db/schema");
  const [f] = await db
    .select({ uf: fornecedores.uf })
    .from(fornecedores)
    .where(and(eq(fornecedores.id, fornecedorId), eq(fornecedores.empresaId, empresaId)))
    .limit(1);
  return f?.uf ?? null;
}
