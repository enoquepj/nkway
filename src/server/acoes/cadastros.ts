"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { clientes, fornecedores, movimentos, produtos, vendaItens, vendas } from "@/db/schema";
import { round2, validarGtin } from "@/lib/dominio";
import { comoErro, exigirPermissao, tenant, texto, corpo } from "@/server/tenant";
import { planoById } from "@/lib/dominio";
import { codigoNcmDigitado } from "@/lib/ncm";
import { registrarAuditoria } from "@/server/auditoria";

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
    const { empresaId, empresa, usuario } = await exigirPermissao("cadastros.produtos");
    input = corpo(input);
    const nome = texto(input.nome).trim();
    if (nome.length < 3) return { ok: false, erro: "Nome do produto é obrigatório (mín. 3 caracteres)." };
    if (input.preco < 0 || input.custo < 0) return { ok: false, erro: "Custo e preço não podem ser negativos." };
    if (!validarGtin(texto(input.gtin).trim())) return { ok: false, erro: "GTIN inválido: o dígito verificador não confere." };
    if ([input.preco, input.custo, input.estoque, input.estoqueMin, input.icmsAliq].some((n) => typeof n !== "number" || !Number.isFinite(n))) return { ok: false, erro: "Informe valores numéricos válidos para preço, custo, estoque e ICMS." };
    const resultado: Resultado = await db.transaction(async (tx) => {
      const [atual] = input.id ? await tx.select().from(produtos).where(and(eq(produtos.id, input.id), eq(produtos.empresaId, empresaId))).for("update") : [];
      if (input.id && !atual) return { ok: false as const, erro: "Produto não encontrado nesta empresa." };
      const ncmInformado = texto(input.ncm);
      // Valores legados não editados continuam intactos, mesmo se precisarem de revisão.
      // Um novo código jamais é completado com zeros nem truncado silenciosamente.
      const ncm = atual && input.ncm === atual.ncm ? atual.ncm : ncmInformado === "" ? "00000000" : codigoNcmDigitado(ncmInformado);
      if (ncm === null) return { ok: false as const, erro: "NCM deve conter 8 dígitos completos. Níveis hierárquicos não podem ser usados como código do produto." };
      if (texto(input.gtin).trim() && input.gtin !== "SEM GTIN") {
        const [duplicado] = await tx.select({ id: produtos.id }).from(produtos).where(and(
          eq(produtos.empresaId, empresaId), eq(produtos.gtin, texto(input.gtin).trim()), input.id ? sql`${produtos.id} <> ${input.id}` : undefined,
        )).limit(1);
        if (duplicado) return { ok: false as const, erro: "Já existe produto com este GTIN." };
      }
      if (!input.id) {
        const limite = planoById(empresa.plano).limiteProdutos;
        const [qtd] = await tx.select({ n: sql<string>`count(*)` }).from(produtos).where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true)));
        if (Number(qtd?.n ?? 0) >= limite) return { ok: false as const, erro: `Plano ${planoById(empresa.plano).nome} permite ${limite} produtos ativos. Faça upgrade em Configurações → Assinatura.` };
      }
      const valores = {
        nome: nome.toUpperCase(), sku: texto(input.sku).trim(), gtin: texto(input.gtin).trim() || "SEM GTIN",
        categoria: texto(input.categoria).trim() || "Geral", marca: texto(input.marca).trim(), unidade: input.unidade,
        custo: round2(input.custo), preco: round2(input.preco), estoqueMin: Math.max(0, input.estoqueMin),
        pesavel: input.pesavel, ativo: input.ativo, ncm,
        cfop: texto(input.cfop).replace(/\D/g, "").slice(0, 4) || "5102",
        csosn: texto(input.csosn).trim() || "102", icmsAliq: round2(input.icmsAliq), atualizadoEm: new Date(),
      };
      let id: string;
      if (atual) {
        id = atual.id;
        await tx.update(produtos).set(valores).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
        const novoEstoque = round2(input.estoque);
        if (Math.abs(Number(atual.estoque) - novoEstoque) > 0.0005) {
          const delta = round2(novoEstoque - Number(atual.estoque));
          await tx.update(produtos).set({ estoque: novoEstoque }).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
          await tx.insert(movimentos).values({ empresaId, produtoId: id, produtoNome: valores.nome, tipo: "ajuste", qtd: delta,
            saldoApos: novoEstoque, custoUnit: valores.custo, custoMedioApos: valores.custo,
            documento: "Cadastro do produto", observacao: "Estoque ajustado pela tela de produtos" });
        }
      } else {
        const estoqueInicial = Math.max(0, round2(input.estoque));
        const [novo] = await tx.insert(produtos).values({ ...valores, empresaId, estoque: estoqueInicial }).returning({ id: produtos.id });
        id = novo.id;
        if (estoqueInicial > 0) await tx.insert(movimentos).values({ empresaId, produtoId: id, produtoNome: valores.nome,
          tipo: "inventario", qtd: estoqueInicial, saldoApos: estoqueInicial, custoUnit: valores.custo, custoMedioApos: valores.custo,
          documento: "Cadastro do produto", observacao: "Saldo inicial de estoque" });
      }
      if (!atual || atual.ncm !== ncm) {
        await registrarAuditoria({ empresaId, usuario, acao: "produto.ncm_informado", entidade: "produto", registroId: id,
          resumo: "NCM informado no cadastro; classificação e tributação não certificadas pelo sistema.",
          alteracoes: { antes: atual?.ncm ?? null, depois: ncm, modo: ncm === "00000000" ? "nao_informado" : "informado_pelo_usuario", validacaoOficial: false } }, tx);
      }
      const aviso = ncm === "00000000" || !codigoNcmDigitado(ncm)
        ? "Produto salvo com NCM genérico ou legado não revisado. Confirme a classificação antes de emitir."
        : !atual || atual.ncm !== ncm ? "Produto salvo. O NCM foi registrado na auditoria como escolha do usuário, sem certificação fiscal." : undefined;
      return { ok: true as const, id, ...(aviso ? { aviso } : {}) };
    });
    // Uma falha de revalidação de tela não pode ser apresentada como rollback de uma transação já confirmada.
    if (resultado.ok) { try { revalidar(); } catch { console.error("[produtos] Falha ao revalidar a tela após gravação confirmada."); } }
    return resultado;
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "";
    if (mensagem.startsWith("Sessão expirada") || mensagem.startsWith("Acesso negado")) return comoErro(e);
    return { ok: false, erro: "Não foi possível salvar o produto. A gravação não foi confirmada; revise os dados e tente novamente." };
  }
}

export async function alternarProduto(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await exigirPermissao("cadastros.produtos");
    const [p] = await db.select({ ativo: produtos.ativo }).from(produtos).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId))).limit(1);
    if (!p) return { ok: false, erro: "Produto não encontrado." };
    await db.update(produtos).set({ ativo: !p.ativo }).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
    revalidatePath("/produtos");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirProduto(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await exigirPermissao("cadastros.produtos");
    const [proprio] = await db.select({ id: produtos.id }).from(produtos).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId))).limit(1);
    if (!proprio) return { ok: false, erro: "Produto não encontrado nesta empresa." };
    const [uso] = await db
      .select({ n: sql<string>`count(*)` })
      .from(vendaItens)
      .where(eq(vendaItens.produtoId, id));
    if (Number(uso?.n ?? 0) > 0) {
      await db.update(produtos).set({ ativo: false }).where(and(eq(produtos.id, id), eq(produtos.empresaId, empresaId)));
      revalidatePath("/produtos");
      return { ok: true, aviso: "Produto tem histórico de vendas: foi desativado em vez de apagado." };
    }
    await db.delete(movimentos).where(and(eq(movimentos.produtoId, id), eq(movimentos.empresaId, empresaId)));
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
    const { empresaId } = await exigirPermissao("cadastros.produtos");
    input = corpo(input);
    input.ids = input.ids ?? [];
    if (!input.ids?.length) return { ok: false, erro: "Selecione ao menos um produto." };
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
    const { empresaId } = await exigirPermissao("cadastros.clientes");
    input = corpo(input);
    if (texto(input.nome).trim().length < 2) return { ok: false, erro: "Informe o nome do cliente." };
    const valores = {
      nome: texto(input.nome).trim(),
      documento: texto(input.documento).trim(),
      email: texto(input.email).trim(),
      telefone: texto(input.telefone).trim(),
      cidade: texto(input.cidade).trim(),
      uf: texto(input.uf).trim(),
      limiteCredito: round2(input.limiteCredito),
      condicaoPadrao: input.condicaoPadrao,
      indIe: input.indIe,
      observacao: texto(input.observacao).trim(),
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
    const { empresaId } = await exigirPermissao("cadastros.clientes");
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
    const { empresaId } = await exigirPermissao("cadastros.clientes");
    input = corpo(input);
    if (texto(input.nome).trim().length < 3) return { ok: false, erro: "Informe a razão social do fornecedor." };
    const valores = {
      nome: texto(input.nome).trim().toUpperCase(),
      cnpj: texto(input.cnpj).trim(),
      cidade: texto(input.cidade).trim(),
      uf: texto(input.uf).trim(),
      telefone: texto(input.telefone).trim(),
      email: texto(input.email).trim(),
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
    const { empresaId } = await exigirPermissao("cadastros.clientes");
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
