"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contas, entradas, fornecedores, movimentos, produtos, type EntradaItem } from "@/db/schema";
import { hojeISO, round2, somaDias } from "@/lib/dominio";
import { notaPorChaveDemo, parseNfeXml, type NfeXml } from "@/lib/xmlNfe";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; id?: string; aviso?: string } | { ok: false; erro: string };

const revalidar = () => ["/entradas", "/estoque", "/financeiro", "/", "/produtos"].forEach((p) => revalidatePath(p));

/** vínculo automático do item da nota com o cadastro interno (GTIN → SKU → nome) */
async function vincular(empresaId: string, itens: { nome: string; gtin?: string; custo: number }[], markupPadrao: number) {
  const catalogo = await db
    .select({ id: produtos.id, nome: produtos.nome, sku: produtos.sku, gtin: produtos.gtin, preco: produtos.preco, custo: produtos.custo })
    .from(produtos)
    .where(eq(produtos.empresaId, empresaId));
  const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return itens.map((i, idx) => {
    const alvo = normal(i.nome);
    const achado =
      catalogo.find((c) => i.gtin && i.gtin !== "SEM GTIN" && c.gtin === i.gtin) ??
      catalogo.find((c) => normal(c.nome) === alvo) ??
      catalogo.find((c) => alvo.length > 6 && normal(c.nome).startsWith(alvo.slice(0, 12))) ??
      catalogo.find((c) => normal(c.nome).includes(alvo.split(" ").slice(0, 2).join(" ")) && alvo.split(" ").length > 1);
    const custo = round2(i.custo);
    return {
      produtoId: achado?.id ?? null,
      nome: achado?.nome ?? i.nome.toUpperCase(),
      nomeFornecedor: i.nome,
      sku: achado?.sku ?? `NT${String(Date.now()).slice(-6)}${idx}`,
      ncm: "00000000",
      cfop: "5101",
      unidade: "UN",
      gtin: i.gtin ?? "SEM GTIN",
      qtd: 1,
      qtdNota: 1,
      custo,
      preco: round2(achado?.preco ?? custo * (1 + markupPadrao / 100)),
    } satisfies EntradaItem;
  });
}

function semDuplicidade(empresaId: string, chave: string) {
  return db
    .select({ id: entradas.id, status: entradas.status })
    .from(entradas)
    .where(and(eq(entradas.empresaId, empresaId), eq(entradas.chave, chave)))
    .limit(1);
}

async function criarDeNota(
  empresaId: string,
  nota: NfeXml,
  origem: "xml" | "sefaz",
  gerarFinanceiro: boolean,
  fornecedorId: string | null,
) {
  if (nota.chave) {
    const [d] = await semDuplicidade(empresaId, nota.chave);
    if (d)
      return {
        ok: false as const,
        erro: `A NF-e ${nota.numero} deste fornecedor já está registrada (${d.status}).`,
      };
  }
  const itens = await vincular(empresaId, nota.itens.map((i) => ({ nome: i.nome, gtin: i.gtin, custo: i.custo })), 40);
  nota.itens.forEach((i, idx) => {
    itens[idx].qtd = i.qtd;
    itens[idx].qtdNota = i.qtd;
    itens[idx].unidade = i.unidade;
    itens[idx].ncm = i.ncm;
    itens[idx].cfop = i.cfop;
  });
  const totalItens = round2(itens.reduce((s, i) => s + i.qtd * i.custo, 0));
  const [nova] = await db
    .insert(entradas)
    .values({
      empresaId,
      numeroNota: nota.numero,
      serie: nota.serie,
      chave: nota.chave,
      fornecedor: nota.fornecedor,
      cnpjFornecedor: nota.cnpjFornecedor,
      fornecedorId,
      emissao: nota.emissao,
      valorProdutos: nota.valorProdutos || totalItens,
      valorFrete: nota.valorFrete,
      total: nota.total || totalItens + nota.valorFrete,
      status: itens.every((i) => i.produtoId) ? "conferida" : "pendente",
      origem,
      gerarFinanceiro,
      itens,
      observacao: `Importada por ${origem === "xml" ? "XML" : "consulta SEFAZ"}`,
    })
    .returning({ id: entradas.id });
  revalidar();
  return {
    ok: true as const,
    id: nova.id,
    aviso: itens.some((i) => !i.produtoId)
      ? `${itens.filter((i) => i.produtoId === null).length} item(ns) sem vínculo com o cadastro — faça o tratamento.`
      : `${itens.length} item(ns) já vinculados ao cadastro.`,
  };
}

export async function importarXml(input: { xml: string; gerarFinanceiro: boolean; fornecedorId?: string | null }): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (!input.xml.trim()) return { ok: false, erro: "Cole ou arraste o conteúdo do XML da NF-e." };
    const nota = parseNfeXml(input.xml);
    return await criarDeNota(empresaId, nota, "xml", input.gerarFinanceiro, input.fornecedorId ?? null);
  } catch (e) {
    return comoErro(e);
  }
}

export async function importarPorChave(input: { chave: string; gerarFinanceiro: boolean; fornecedorId?: string | null }): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const nota = notaPorChaveDemo(input.chave);
    return await criarDeNota(empresaId, nota, "sefaz", input.gerarFinanceiro, input.fornecedorId ?? null);
  } catch (e) {
    return comoErro(e);
  }
}

export async function registrarEntradaManual(input: {
  fornecedor: string;
  cnpjFornecedor: string;
  numeroNota: string;
  serie: string;
  emissao: string;
  valorFrete: number;
  gerarFinanceiro: boolean;
  observacao?: string;
  itens: { produtoId: string | null; nome: string; qtd: number; custo: number; preco: number; unidade: string; sku: string; ncm?: string; cfop?: string; gtin?: string }[];
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (!input.fornecedor.trim()) return { ok: false, erro: "Informe o fornecedor da nota." };
    const itensValidos = input.itens.filter((i) => i.qtd > 0 && i.custo > 0);
    if (itensValidos.length === 0) return { ok: false, erro: "Digite ao menos um item com quantidade e custo." };
    const itens: EntradaItem[] = itensValidos.map((i, idx) => ({
      produtoId: i.produtoId,
      nome: i.nome || `ITEM ${idx + 1}`,
      nomeFornecedor: i.nome,
      sku: i.sku || `MAN${String(Date.now()).slice(-5)}${idx}`,
      ncm: (i.ncm ?? "00000000").replace(/\D/g, "").padEnd(8, "0").slice(0, 8),
      cfop: i.cfop ?? "5101",
      unidade: i.unidade || "UN",
      gtin: i.gtin ?? "SEM GTIN",
      qtd: round2(i.qtd * 1000) / 1000,
      qtdNota: round2(i.qtd * 1000) / 1000,
      custo: round2(i.custo),
      preco: round2(i.preco || i.custo * 1.4),
    }));
    const valorProdutos = round2(itens.reduce((s, i) => s + i.qtd * i.custo, 0));
    const [nova] = await db
      .insert(entradas)
      .values({
        empresaId,
        numeroNota: input.numeroNota || String(Date.now()).slice(-6),
        serie: input.serie || "1",
        chave: "",
        fornecedor: input.fornecedor.trim().toUpperCase(),
        cnpjFornecedor: input.cnpjFornecedor.replace(/\D/g, ""),
        emissao: input.emissao || hojeISO(),
        valorProdutos,
        valorFrete: round2(input.valorFrete),
        total: round2(valorProdutos + input.valorFrete),
        status: "conferida",
        origem: "manual",
        gerarFinanceiro: input.gerarFinanceiro,
        itens,
        observacao: input.observacao ?? null,
      })
      .returning({ id: entradas.id });
    revalidar();
    return { ok: true, id: nova.id, aviso: "Entrada manual registrada. Revise os vínculos e lance no estoque." };
  } catch (e) {
    return comoErro(e);
  }
}

/** tela de tratamento: vínculo fornecedor↔interno, quantidade real recebida, custo e preço com markup */
export async function salvarTratamento(input: {
  entradaId: string;
  gerarFinanceiro: boolean;
  observacao: string;
  itens: EntradaItem[];
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [e] = await db.select({ id: entradas.id, status: entradas.status }).from(entradas).where(and(eq(entradas.id, input.entradaId), eq(entradas.empresaId, empresaId))).limit(1);
    if (!e) return { ok: false, erro: "Entrada não encontrada." };
    if (e.status === "lancada") return { ok: false, erro: "Entrada já lançada no estoque — não é possível editar." };
    await db
      .update(entradas)
      .set({
        itens: input.itens,
        gerarFinanceiro: input.gerarFinanceiro,
        observacao: input.observacao,
        status: input.itens.every((i) => i.produtoId) ? "conferida" : "pendente",
        valorProdutos: round2(input.itens.reduce((s, i) => s + i.qtd * i.custo, 0)),
        total: round2(input.itens.reduce((s, i) => s + i.qtd * i.custo, 0) + 0),
      })
      .where(eq(entradas.id, e.id));
    revalidar();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** lançar a entrada: custo médio ponderado, kardex, estoque e conta a pagar */
export async function lancarEntrada(entradaId: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [entrada] = await db.select().from(entradas).where(and(eq(entradas.id, entradaId), eq(entradas.empresaId, empresaId))).limit(1);
    if (!entrada) return { ok: false, erro: "Entrada não encontrada." };
    if (entrada.status === "lancada") return { ok: false, erro: "Esta entrada já foi lançada no estoque." };
    const itens = (entrada.itens ?? []) as EntradaItem[];
    if (itens.length === 0) return { ok: false, erro: "A entrada não tem itens para lançar." };

    let criados = 0;
    const documentos: string[] = [];
    for (const item of itens) {
      let produtoId = item.produtoId;
      let nome = item.nome;
      if (!produtoId) {
        const [novo] = await db
          .insert(produtos)
          .values({
            empresaId,
            nome: item.nome.toUpperCase(),
            sku: item.sku || `auto${Date.now().toString().slice(-5)}${criados}`,
            gtin: item.gtin && item.gtin !== "SEM GTIN" ? item.gtin : "SEM GTIN",
            categoria: "Entrada de nota",
            marca: "",
            unidade: item.unidade || "UN",
            custo: item.custo,
            preco: item.preco || round2(item.custo * 1.4),
            estoque: 0,
            estoqueMin: 0,
            ncm: item.ncm || "00000000",
            cfop: item.cfop || "5101",
          })
          .returning({ id: produtos.id });
        produtoId = novo.id;
        nome = item.nome.toUpperCase();
        criados++;
      }
      const [p] = await db.select().from(produtos).where(and(eq(produtos.id, produtoId), eq(produtos.empresaId, empresaId))).limit(1);
      if (!p) continue;
      const saldoAnterior = Number(p.estoque);
      const custoAnterior = Number(p.custo);
      const novoSaldo = round2(saldoAnterior + item.qtd);
      const custoMedio =
        saldoAnterior + item.qtd > 0
          ? round2((saldoAnterior * custoAnterior + item.qtd * item.custo) / (saldoAnterior + item.qtd))
          : item.custo;
      await db
        .update(produtos)
        .set({ estoque: novoSaldo, custo: custoMedio, preco: item.preco > 0 ? item.preco : p.preco, atualizadoEm: new Date() })
        .where(eq(produtos.id, p.id));
      await db.insert(movimentos).values({
        empresaId,
        produtoId: p.id,
        produtoNome: nome,
        tipo: "entrada",
        qtd: item.qtd,
        saldoApos: novoSaldo,
        custoUnit: item.custo,
        custoMedioApos: custoMedio,
        documento: `NF ${entrada.numeroNota} · ${entrada.fornecedor.slice(0, 24)}`,
        observacao:
          item.qtd !== item.qtdNota ? `Recebido ${item.qtd} de ${item.qtdNota} da nota` : `Entrada ${entrada.origem} · custo médio aplicado`,
      });
      if (item.qtd !== item.qtdNota) documentos.push(`${nome}: ${item.qtd}/${item.qtdNota}`);
    }

    let financeiro = "";
    if (entrada.gerarFinanceiro) {
      const [forn] = entrada.cnpjFornecedor
        ? await db.select().from(fornecedores).where(and(eq(fornecedores.empresaId, empresaId), eq(fornecedores.cnpj, entrada.cnpjFornecedor))).limit(1)
        : [];
      const prazo = forn?.prazoPagDias ?? 28;
      await db.insert(contas).values({
        empresaId,
        tipo: "pagar",
        descricao: `NF ${entrada.numeroNota} ${entrada.fornecedor.slice(0, 30)}`,
        categoria: "Fornecedores",
        contraparteNome: entrada.fornecedor,
        valor: entrada.total || round2(itens.reduce((s, i) => s + i.qtd * i.custo, 0)),
        vencimento: somaDias(entrada.emissao || hojeISO(), prazo),
        forma: "boleto",
        entradaId: entrada.id,
        status: "aberta",
      });
      financeiro = ` Conta a pagar gerada com ${prazo} dias.`;
    }

    await db.update(entradas).set({ status: "lancada", lancadaEm: new Date() }).where(eq(entradas.id, entrada.id));
    revalidar();
    return {
      ok: true,
      aviso: `${itens.length} item(ns) lançados${criados ? `, ${criados} produto(s) criados` : ""} com custo médio.${financeiro}${
        documentos.length ? ` Divergência de quantidade em ${documentos.length} item(ns).` : ""
      }`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirEntrada(entradaId: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [e] = await db.select({ status: entradas.status, chave: entradas.chave }).from(entradas).where(and(eq(entradas.id, entradaId), eq(entradas.empresaId, empresaId))).limit(1);
    if (!e) return { ok: false, erro: "Entrada não encontrada." };
    if (e.status === "lancada") return { ok: false, erro: "Entrada lançada no estoque não pode ser apagada." };
    await db.delete(entradas).where(eq(entradas.id, entradaId));
    await db.delete(contas).where(and(eq(contas.entradaId, entradaId), eq(contas.status, "aberta")));
    revalidar();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** pré-visualização do XML sem gravar (aba XML) */
export async function preVisualizarXml(xml: string): Promise<{ ok: true; nota: NfeXml } | { ok: false; erro: string }> {
  try {
    return { ok: true, nota: parseNfeXml(xml) };
  } catch (e) {
    return comoErro(e);
  }
}

export async function simularChave(chave: string): Promise<{ ok: true; nota: NfeXml } | { ok: false; erro: string }> {
  try {
    return { ok: true, nota: notaPorChaveDemo(chave) };
  } catch (e) {
    return comoErro(e);
  }
}

/** concilia fornecedor da nota com o cadastro (cria se preciso) */
export async function garantirFornecedor(nome: string, cnpj: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const doc = cnpj.replace(/\D/g, "");
    if (!nome.trim()) return { ok: false, erro: "Informe o nome do fornecedor." };
    if (doc) {
      const [existente] = await db.select({ id: fornecedores.id }).from(fornecedores).where(and(eq(fornecedores.empresaId, empresaId), eq(fornecedores.cnpj, doc))).limit(1);
      if (existente) return { ok: true, id: existente.id };
    }
    const [n] = await db.insert(fornecedores).values({ empresaId, nome: nome.trim().toUpperCase(), cnpj: doc }).returning({ id: fornecedores.id });
    revalidatePath("/clientes");
    return { ok: true, id: n.id };
  } catch (e) {
    return comoErro(e);
  }
}
