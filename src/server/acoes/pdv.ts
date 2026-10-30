"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clientes, contas, movimentos, produtos, vendaItens, vendas } from "@/db/schema";
import {
  FORMAS_PAGAMENTO,
  MODELO_NUMERO,
  round2,
  valorAPrazo,
  gerarChave,
  hojeISO,
  somaDias,
  UF_NUMERO,
} from "@/lib/dominio";
import { comoErro, corpo, numero, tenant, texto } from "@/server/tenant";

export type ItemPdv = { produtoId: string; qtd: number; preco: number };
export type Pagamento = { forma: string; valor: number };

const REVALIDAR = ["/", "/pdv", "/documentos", "/estoque", "/financeiro", "/produtos", "/clientes"];
const revalidarTudo = () => REVALIDAR.forEach((p) => revalidatePath(p));

async function proximoNumero(empresaId: string, campo: "numero" | "numeroNota") {
  const alvo = campo === "numero" ? vendas.numero : vendas.numeroNota;
  const [r] = await db
    .select({ n: sql<string | null>`max(${alvo})` })
    .from(vendas)
    .where(eq(vendas.empresaId, empresaId));
  return Number(r?.n ?? 0) + 1;
}

/**
 * Número fiscal disponível: soma 1 ao último emitido e pula os intervalos inutilizados
 * (importado por baixo para não virar server action).
 */
async function proximoNumeroFiscal(empresaId: string, modelo: string, serie: string) {
  const { proximoNumeroNota } = await import("@/server/acoes/numeracao");
  return proximoNumeroNota(empresaId, modelo, serie);
}

const diasCondicao = (c: string) => (c === "7d" ? 7 : c === "14d" ? 14 : c === "60d" ? 60 : c === "30d" ? 30 : 0);

type ResultadoVenda =
  | { ok: true; id: string; total: number; numero: number; numeroNota: number | null; chave: string | null; troco: number; aviso?: string }
  | { ok: false; erro: string };

async function gravarVenda(
  input: {
    itens: ItemPdv[];
    clienteId: string | null;
    clienteNome: string;
    desconto: number;
    frete: number;
    pagamentos: Pagamento[];
    tipo: "fiscal" | "dav";
    modelo: "NFC-e" | "NF-e" | "SAT";
    validade?: string;
    observacao?: string;
    davOrigemId?: string;
    baixaEstoque: boolean;
    operador?: string;
    caixa?: string;
  },
): Promise<ResultadoVenda> {
  try {
    const { empresaId, empresa } = await tenant();
    input = corpo(input);
    const itens = (input.itens ?? []).filter((i) => i?.qtd > 0);
    if (itens.length === 0) return { ok: false, erro: "A venda está sem itens." };

    const produtosRows = await db
      .select()
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), sql`${produtos.id} in (${sql.join(itens.map((i) => sql`${i.produtoId}`), sql`,`)})`));
    const porId = new Map(produtosRows.map((p) => [p.id, p]));
    for (const i of itens) if (!porId.has(i.produtoId)) return { ok: false, erro: "Um dos itens não pertence a esta empresa." };

    const subtotal = round2(itens.reduce((s, i) => s + i.qtd * i.preco, 0));
    const desconto = Math.min(Math.max(0, round2(input.desconto)), subtotal);
    const frete = Math.max(0, round2(input.frete || 0));
    const total = round2(subtotal - desconto + frete);
    if (total < 0) return { ok: false, erro: "O desconto não pode superar o subtotal." };

    const pagamentos = input.pagamentos
      .map((p) => ({ forma: p.forma, valor: round2(Math.max(0, p.valor)) }))
      .filter((p) => p.valor > 0);
    const somaPagos = round2(pagamentos.reduce((s, p) => s + p.valor, 0));
    if (input.tipo === "fiscal" && pagamentos.length && somaPagos + 0.01 < total)
      return { ok: false, erro: `Faltam R$ ${round2(total - somaPagos).toFixed(2)} em pagamentos.` };
    const formaPrincipal = pagamentos.length
      ? pagamentos.slice().sort((a, b) => b.valor - a.valor)[0].forma
      : "dinheiro";
    const aPrazo = input.tipo === "fiscal" ? valorAPrazo(pagamentos, total, formaPrincipal) : 0;
    const troco = round2(Math.max(0, somaPagos - total));

    if (input.baixaEstoque) {
      for (const i of itens) {
        const p = porId.get(i.produtoId)!;
        if (Number(p.estoque) + 0.001 < i.qtd)
          return { ok: false, erro: `Estoque insuficiente de ${p.nome} (atual ${p.estoque} ${p.unidade}).` };
      }
    }

    const numero = await proximoNumero(empresaId, "numero");
    const fiscal = input.tipo === "fiscal";
    const fiscalCfg = (empresa.fiscal ?? {}) as Record<string, string | number>;
    const serie = String(fiscalCfg[input.modelo === "NF-e" ? "serieNfe" : input.modelo === "SAT" ? "serieNfce" : "serieNfce"] ?? "1");
    const numeroNota = fiscal ? await proximoNumeroFiscal(empresaId, input.modelo, serie) : null;
    const chave = fiscal
      ? gerarChave({
          uf: UF_NUMERO[empresa.uf] ?? "00",
          aamm: `${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth() + 1).padStart(2, "0")}`,
          cnpj: empresa.cnpj,
          modelo: MODELO_NUMERO[input.modelo] ?? "65",
          serie,
          numeroNota: numeroNota!,
        })
      : null;
    const protocolo = fiscal
      ? `1${UF_NUMERO[empresa.uf] ?? "00"}${Date.now().toString().padStart(14, "0").slice(-14)}`
      : null;

    const [venda] = await db
      .insert(vendas)
      .values({
        empresaId,
        numero,
        clienteId: input.clienteId,
        clienteNome: input.clienteNome || "CONSUMIDOR",
        subtotal,
        desconto,
        vFrete: frete,
        total,
        formaPagamento: formaPrincipal,
        pagamentos,
        tipo: input.tipo,
        status: fiscal ? "faturado" : "aberto",
        modelo: fiscal ? input.modelo : null,
        serie: fiscal ? serie : null,
        numeroNota,
        chave,
        protocolo,
        autorizadaEm: fiscal ? Date.now() : null,
        validade: !fiscal ? (input.validade || somaDias(hojeISO(), 3)) : null,
        observacao: input.observacao || null,
        operador: input.operador || "Frente de caixa",
        caixa: input.caixa || "CAIXA 1",
        ambiente: String(((empresa.fiscal ?? {}) as Record<string, unknown>).ambiente ?? "2"),
        origem: input.davOrigemId ? "dav" : "pdv",
        davOrigemId: input.davOrigemId ?? null,
        data: new Date(),
      })
      .returning({ id: vendas.id });

    await db.insert(vendaItens).values(
      itens.map((i) => {
        const p = porId.get(i.produtoId)!;
        return {
          vendaId: venda.id,
          produtoId: i.produtoId,
          nome: p.nome,
          qtd: round2(i.qtd * 1000) / 1000,
          precoUnit: i.preco,
          total: round2(i.qtd * i.preco),
          unidade: p.unidade,
          gtin: p.gtin,
        };
      }),
    );

    let aviso: string | undefined;
    if (input.baixaEstoque) {
      for (const i of itens) {
        const p = porId.get(i.produtoId)!;
        const saldo = round2(Number(p.estoque) - i.qtd);
        await db.update(produtos).set({ estoque: saldo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
        await db.insert(movimentos).values({
          empresaId,
          produtoId: p.id,
          produtoNome: p.nome,
          tipo: "venda",
          qtd: -i.qtd,
          saldoApos: saldo,
          custoUnit: Number(p.custo),
          custoMedioApos: Number(p.custo),
          documento: fiscal ? `Nº ${numeroNota ?? numero} ${input.modelo}` : `DAV ${numero}`,
          observacao: fiscal ? "Venda registrada no PDV" : "Reserva de DAV (estoque baixado no faturamento)",
        });
        if (saldo <= Number(p.estoqueMin)) aviso = `${p.nome} ficou em nível crítico de estoque.`;
      }
    }

    if (aPrazo > 0) {
      const [cli] = input.clienteId
        ? await db.select().from(clientes).where(eq(clientes.id, input.clienteId)).limit(1)
        : [];
      const dias = cli ? diasCondicao(cli.condicaoPadrao) : 30;
      await db.insert(contas).values({
        empresaId,
        tipo: "receber",
        descricao: `${input.modelo} nº ${numeroNota} — ${input.clienteNome || "CONSUMIDOR"}`,
        categoria: "Vendas",
        contraparteId: input.clienteId,
        contraparteTipo: input.clienteId ? "cliente" : null,
        contraparteNome: input.clienteNome || "CONSUMIDOR",
        valor: aPrazo,
        vencimento: somaDias(hojeISO(), dias || 30),
        forma: formaPrincipal,
        vendaId: venda.id,
        status: "aberta",
      });
    }

    if (input.davOrigemId)
      await db.update(vendas).set({ status: "faturado" }).where(eq(vendas.id, input.davOrigemId));

    revalidarTudo();
    return { ok: true, id: venda.id, total, numero, numeroNota, chave, troco, aviso };
  } catch (e) {
    return comoErro(e);
  }
}

export async function registrarVenda(input: {
  itens: ItemPdv[];
  clienteId?: string | null;
  clienteNome?: string;
  desconto?: number;
  frete?: number;
  pagamentos?: Pagamento[];
  tipo?: "fiscal" | "dav";
  modelo?: "NFC-e" | "NF-e" | "SAT";
  validade?: string;
  observacao?: string;
}): Promise<ResultadoVenda> {
  input = corpo(input);
  return gravarVenda({
    itens: input.itens,
    clienteId: input.clienteId ?? null,
    clienteNome: input.clienteNome ?? "CONSUMIDOR",
    desconto: input.desconto ?? 0,
    frete: input.frete ?? 0,
    pagamentos: input.pagamentos ?? [],
    tipo: input.tipo ?? "fiscal",
    modelo: input.modelo ?? "NFC-e",
    validade: input.validade,
    observacao: input.observacao,
    baixaEstoque: (input.tipo ?? "fiscal") === "fiscal",
  });
}

export async function faturarDav(input: {
  davId: string;
  modelo: "NFC-e" | "NF-e" | "SAT";
  pagamentos: Pagamento[];
  desconto?: number;
}): Promise<ResultadoVenda> {
  try {
    const { empresaId } = await tenant();
    input = corpo(input);
    const [dav] = await db.select().from(vendas).where(and(eq(vendas.id, input.davId), eq(vendas.empresaId, empresaId))).limit(1);
    if (!dav) return { ok: false, erro: "DAV não encontrado." };
    if (dav.status !== "aberto") return { ok: false, erro: "Este DAV já foi faturado ou cancelado." };
    const itens = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, dav.id));
    return gravarVenda({
      itens: itens.map((i) => ({ produtoId: i.produtoId!, qtd: Number(i.qtd), preco: Number(i.precoUnit) })),
      clienteId: dav.clienteId,
      clienteNome: dav.clienteNome,
      desconto: input.desconto ?? Number(dav.desconto),
      frete: Number(dav.vFrete),
      pagamentos: input.pagamentos,
      tipo: "fiscal",
      modelo: input.modelo,
      davOrigemId: dav.id,
      baixaEstoque: true,
      observacao: dav.observacao ?? undefined,
    });
  } catch (e) {
    return comoErro(e);
  }
}

export async function cancelarVenda(input: { vendaId: string; motivo: string }): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const { empresaId } = await tenant();
    input = corpo(input);
    if (!texto(input.motivo).trim()) return { ok: false, erro: "Descreva o motivo do cancelamento." };
    const [venda] = await db.select().from(vendas).where(and(eq(vendas.id, input.vendaId), eq(vendas.empresaId, empresaId))).limit(1);
    if (!venda) return { ok: false, erro: "Documento não encontrado." };
    if (venda.status === "cancelado") return { ok: false, erro: "Este documento já está cancelado." };

    await db.update(vendas).set({ status: "cancelado", observacao: `${venda.observacao ?? ""} · Cancelado: ${texto(input.motivo).trim()}`.trim() }).where(eq(vendas.id, venda.id));

    const itens = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id));
    if (venda.tipo === "fiscal") {
      for (const i of itens) {
        if (!i.produtoId) continue;
        const [p] = await db.select().from(produtos).where(eq(produtos.id, i.produtoId)).limit(1);
        if (!p) continue;
        const saldo = round2(Number(p.estoque) + Number(i.qtd));
        await db.update(produtos).set({ estoque: saldo }).where(eq(produtos.id, p.id));
        await db.insert(movimentos).values({
          empresaId,
          produtoId: p.id,
          produtoNome: p.nome,
          tipo: "devolucao",
          qtd: Number(i.qtd),
          saldoApos: saldo,
          custoUnit: Number(p.custo),
          custoMedioApos: Number(p.custo),
          documento: venda.numeroNota ? `Cancel. NF ${venda.numeroNota}` : `Cancel. DAV ${venda.numero}`,
          observacao: texto(input.motivo).trim(),
        });
      }
    }
    await db.delete(contas).where(and(eq(contas.vendaId, venda.id), eq(contas.status, "aberta")));
    revalidarTudo();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirDav(davId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const { empresaId } = await tenant();
    const [dav] = await db.select().from(vendas).where(and(eq(vendas.id, davId), eq(vendas.empresaId, empresaId))).limit(1);
    if (!dav) return { ok: false, erro: "DAV não encontrado." };
    if (dav.status === "faturado") return { ok: false, erro: "DAV faturado não pode ser apagado — cancele a nota." };
    await db.delete(vendas).where(eq(vendas.id, davId));
    revalidarTudo();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** atalho do PDV: busca ao vivo por início do nome, SKU ou GTIN */
export async function buscarProdutos(termo: string) {
  const { empresaId } = await tenant();
  const t = termo.trim().toLowerCase();
  if (!t) return [];
  const linhas = await db
    .select({ id: produtos.id, nome: produtos.nome, sku: produtos.sku, gtin: produtos.gtin, preco: produtos.preco, estoque: produtos.estoque, unidade: produtos.unidade, pesavel: produtos.pesavel })
    .from(produtos)
    .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true), desc(produtos.nome)))
    .limit(400);
  return linhas
    .filter((p) => p.nome.toLowerCase().includes(t) || p.sku.toLowerCase().startsWith(t) || p.gtin.includes(t))
    .slice(0, 12)
    .map((p) => ({ ...p, preco: Number(p.preco), estoque: Number(p.estoque) }));
}

