"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clientes, fornecedores, movimentos, produtos, vendaItens, vendas } from "@/db/schema";
import { round2, validarGtin } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";
import { planoById } from "@/lib/dominio";

export type Resultado = { ok: true; id?: string; aviso?: string } | { ok: false; erro: string };

const revalidar = () => {
  ["/produtos", "/clientes", "/", "/pdv", "/estoque"].forEach((p) => revalidatePath(p));
};

/* ---------------------------------------------------------------- produto */

export type ProdutoInput = {
  id?: string;
  nome: string;
  sku: string;
  gtin: string;
  categoria: string;
  marca: string;
  unidade: string;
  custo: number;
  preco: number;
  estoque: number;
  estoqueMin: number;
  pesavel: boolean;
  ativo: boolean;
  ncm: string;
  cfop: string;
  csosn: string;
  icmsAliq: number;
};

export async function salvarProduto(input: ProdutoInput): Promise<Resultado> {
  try {
    const { empresaId, empresa } = await tenant();
    const nome = input.nome.trim();
    if (nome.length < 3) return { ok: false, erro: "Nome do produto é obrigatório (mín. 3 caracteres)." };
    if (input.preco < 0 || input.custo < 0) return { ok: false, erro: "Custo e preço não podem ser negativos." };
    if (!validarGtin(input.gtin.trim())) return { ok: false, erro: "GTIN inválido: o dígito verificador não confere." };
    if (input.gtin.trim() && input.gtin !== "SEM GTIN") {
      const [duplicado] = await db
        .select({ id: produtos.id })
        .from(produtos)
        .where(and(eq(produtos.empresaId, empresaId), eq(produtos.gtin, input.gtin.trim()), input.id ? sql`${produtos.id} <> ${input.id}` : undefined))
        .limit(1);
      if (duplicado) return { ok: false, erro: "Já existe produto com este GTIN." };
    }

    const limite = planoById(empresa.plano).limiteProdutos;
    const [qtd] = await db
      .select({ n: sql<string>`count(*)` })
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true)));
    if (!input.id && Number(qtd?.n ?? 0) >= limite)
      return { ok: false, erro: `Plano ${planoById(empresa.plano).nome} permite ${limite} produtos ativos. Faça upgrade em Configurações → Assinatura.` };

    const valores = {
      nome: nome.toUpperCase(),
      sku: input.sku.trim(),
      gtin: input.gtin.trim() || "SEM GTIN",
      categoria: input.categoria.trim() || "Geral",
      marca: input.marca.trim(),
      unidade: input.unidade,
      custo: round2(input.custo),
      preco: round2(input.preco),
      estoqueMin: Math.max(0, input.estoqueMin),
      pesavel: input.pesavel,
      ativo: input.ativo,
      ncm: input.ncm.replace(/\D/g, "").padEnd(8, "0").slice(0, 8),
      cfop: input.cfop.replace(/\D/g, "").slice(0, 4) || "5102",
      csosn: input.csosn.trim() || "102",
      icmsAliq: round2(input.icmsAliq),
      atualizadoEm: new Date(),
    };

    if (input.id) {
      const [atual] = await db.select({ estoque: produtos.estoque }).from(produtos).where(eq(produtos.id, input.id)).limit(1);
      await db.update(produtos).set(valores).where(eq(produtos.id, input.id));
      const novoEstoque = round2(input.estoque);
      if (atual && Math.abs(Number(atual.estoque) - novoEstoque) > 0.0005) {
        const delta = round2(novoEstoque - Number(atual.estoque));
        await db.update(produtos).set({ estoque: novoEstoque }).where(eq(produtos.id, input.id));
        await db.insert(movimentos).values({
          empresaId,
          produtoId: input.id,
          produtoNome: valores.nome,
          tipo: "ajuste",
          qtd: delta,
          saldoApos: novoEstoque,
          custoUnit: valores.custo,
          custoMedioApos: valores.custo,
          documento: "Cadastro do produto",
          observacao: "Estoque ajustado pela tela de produtos",
        });
      }
      revalidar();
      return { ok: true, id: input.id };
    }

    const estoqueInicial = Math.max(0, round2(input.estoque));
    const [novo] = await db
      .insert(produtos)
      .values({ ...valores, empresaId, estoque: estoqueInicial })
      .returning({ id: produtos.id });
    if (estoqueInicial > 0)
      await db.insert(movimentos).values({
        empresaId,
        produtoId: novo.id,
        produtoNome: valores.nome,
        tipo: "inventario",
        qtd: estoqueInicial,
        saldoApos: estoqueInicial,
        custoUnit: valores.custo,
        custoMedioApos: valores.custo,
        documento: "Cadastro do produto",
        observacao: "Saldo inicial de estoque",
      });
    revalidar();
    return { ok: true, id: novo.id };
  } catch (e) {
    return comoErro(e);
  }
}

export async function alternarProduto(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [p] = await db.select({ ativo: produtos.ativo }).from(produtos).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId))).limit(1);
    if (!p) return { ok: false, erro: "Produto não encontrado." };
    await db.update(produtos).set({ ativo: !p.ativo }).where(eq(produtos.id, id));
    revalidatePath("/produtos");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirProduto(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [uso] = await db
      .select({ n: sql<string>`count(*)` })
      .from(vendaItens)
      .where(eq(vendaItens.produtoId, id));
    if (Number(uso?.n ?? 0) > 0) {
      await db.update(produtos).set({ ativo: false }).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
      revalidatePath("/produtos");
      return { ok: true, aviso: "Produto tem histórico de vendas: foi desativado em vez de apagado." };
    }
    await db.delete(movimentos).where(eq(movimentos.produtoId, id));
    await db.delete(produtos).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
    revalidatePath("/produtos");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** manutenção de preços: % sobre o custo, R$ fixo, markup ou preço direto (em massa) */
export async function aplicarManutencaoPrecos(input: {
  ids: string[];
  modo: "percentual" | "real" | "markup" | "preco";
  valor: number;
  arredondar: "nenhum" | "para_cima" | "x90" | "inteiro";
}): Promise<{ ok: true; atualizados: number } | { ok: false; erro: string }> {
  try {
    const { empresaId } = await tenant();
    if (input.ids.length === 0) return { ok: false, erro: "Selecione ao menos um produto." };
    const linhas = await db
      .select()
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), sql`${produtos.id} in (${sql.join(input.ids.map((i) => sql`${i}`), sql`,`)})`));
    let atualizados = 0;
    for (const p of linhas) {
      let preco =
        input.modo === "percentual"
          ? p.custo * (1 + input.valor / 100)
          : input.modo === "real"
            ? p.custo + input.valor
            : input.modo === "markup"
              ? p.custo * (input.valor / 100)
              : input.valor;
      if (input.arredondar === "x90") preco = Math.floor(preco) + 0.9;
      else if (input.arredondar === "inteiro") preco = Math.round(preco);
      else if (input.arredondar === "para_cima") preco = Math.ceil(preco * 100) / 100;
      await db.update(produtos).set({ preco: round2(preco), atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
      atualizados++;
    }
    revalidatePath("/produtos");
    return { ok: true, atualizados };
  } catch (e) {
    return comoErro(e);
  }
}

/* -------------------------------------------------------------- cadastros */

export async function salvarCliente(input: {
  id?: string;
  nome: string;
  documento: string;
  email: string;
  telefone: string;
  cidade: string;
  uf: string;
  limiteCredito: number;
  condicaoPadrao: string;
  indIe: string;
  observacao: string;
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (input.nome.trim().length < 2) return { ok: false, erro: "Informe o nome do cliente." };
    const valores = {
      nome: input.nome.trim(),
      documento: input.documento.trim(),
      email: input.email.trim(),
      telefone: input.telefone.trim(),
      cidade: input.cidade.trim(),
      uf: input.uf.trim(),
      limiteCredito: round2(input.limiteCredito),
      condicaoPadrao: input.condicaoPadrao,
      indIe: input.indIe,
      observacao: input.observacao.trim(),
    };
    if (input.id) {
      await db.update(clientes).set(valores).where(and(eq(clientes.id, input.id), eq(clientes.empresaId, empresaId)));
      revalidatePath("/clientes");
      return { ok: true, id: input.id };
    }
    const [n] = await db.insert(clientes).values({ ...valores, empresaId }).returning({ id: clientes.id });
    revalidatePath("/clientes");
    return { ok: true, id: n.id };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirCliente(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [uso] = await db
      .select({ n: sql<string>`count(*)` })
      .from(vendas)
      .where(and(eq(vendas.clienteId, id), eq(vendas.status, "faturado")));
    if (Number(uso?.n ?? 0) > 0)
      return { ok: false, erro: "Cliente possui vendas faturadas: mantenha o cadastro para preservar o histórico." };
    await db.delete(clientes).where(and(eq(clientes.id, id), eq(clientes.empresaId, empresaId)));
    revalidatePath("/clientes");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function salvarFornecedor(input: {
  id?: string;
  nome: string;
  cnpj: string;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  prazoPagDias: number;
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (input.nome.trim().length < 3) return { ok: false, erro: "Informe a razão social do fornecedor." };
    const valores = {
      nome: input.nome.trim().toUpperCase(),
      cnpj: input.cnpj.trim(),
      cidade: input.cidade.trim(),
      uf: input.uf.trim(),
      telefone: input.telefone.trim(),
      email: input.email.trim(),
      prazoPagDias: Math.max(0, Math.round(input.prazoPagDias)),
    };
    if (input.id) {
      await db.update(fornecedores).set(valores).where(and(eq(fornecedores.id, input.id), eq(fornecedores.empresaId, empresaId)));
      revalidatePath("/clientes");
      return { ok: true, id: input.id };
    }
    const [n] = await db.insert(fornecedores).values({ ...valores, empresaId }).returning({ id: fornecedores.id });
    revalidatePath("/clientes");
    return { ok: true, id: n.id };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirFornecedor(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    await db.delete(fornecedores).where(and(eq(fornecedores.id, id), eq(fornecedores.empresaId, empresaId)));
    revalidatePath("/clientes");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function listaCategorias(): Promise<{ ok: true; categorias: string[] } | { ok: false; erro: string }> {
  const { empresaId } = await tenant();
  const r = await db.selectDistinct({ categoria: produtos.categoria }).from(produtos).where(eq(produtos.empresaId, empresaId)).orderBy(asc(produtos.categoria));
  return { ok: true, categorias: r.map((x) => x.categoria).filter(Boolean) };
}
