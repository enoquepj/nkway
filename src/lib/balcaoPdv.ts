/**
 * NKWAY — Operações rápidas de balcão da Frente de Caixa (Complemento 2 de 3):
 * 1. Consulta de Preço, Estoque e Tributos (F7) — sem adicionar à venda.
 * 2. Leitura de Etiqueta de Balança EAN-13 iniciando em 2 (padrão GS1 peso/valor variável).
 * 3. Vendas em Espera / Suspender e Retomar Atendimento (F9) — sem perder itens ativos.
 */

import { round2, tributosEstimados, validarGtin } from "@/lib/dominio";
import { normalizarQtdPdv, type LinhaItemPdv } from "@/lib/multiplicadorPdv";
import type { ParcelaPagamentoPdv } from "@/lib/pagamentoPdv";

export const CHAVE_ESPERA_PDV = "nkway.pdv.espera";
export const CHAVE_ETIQUETA_BALANCA_PDV = "nkway.pdv.etiquetaBalanca";
export const LIMITE_VENDAS_ESPERA_PDV = 20;

export type ModoEtiquetaBalancaPdv = "peso" | "valor";

export type ProdutoBalcaoPdv = {
  id: string;
  nome: string;
  sku: string;
  gtin: string;
  categoria?: string;
  marca?: string;
  unidade: string;
  preco: number;
  estoque: number;
  estoqueMin?: number;
  pesavel: boolean;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  localizacao?: string;
  icmsAliq?: number;
  pisAliq?: number;
  cofinsAliq?: number;
  ibsAliq?: number;
  cbsAliq?: number;
};

/** Remove acentos e normaliza espaços/caixa para busca instantânea no balcão */
export function normalizarTextoBalcaoPdv(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/* ------------------------------------------- 1. Etiqueta de Balança GS1-2 */

export type ResultadoEtiquetaBalancaPdv<T extends ProdutoBalcaoPdv = ProdutoBalcaoPdv> =
  | {
      ehEtiquetaBalanca: false;
    }
  | {
      ehEtiquetaBalanca: true;
      ok: true;
      codigoProduto5: string;
      modo: ModoEtiquetaBalancaPdv;
      produto: T;
      pesoKg: number;
      valorEtiqueta: number;
    }
  | {
      ehEtiquetaBalanca: true;
      ok: false;
      codigoProduto5: string;
      erro: string;
    };

/**
 * Decodifica etiqueta EAN-13 de balança (`2CCCCCMMMMMD`):
 * - Só trata como etiqueta de balança quando tem 13 dígitos, começa com `2`, possui DV EAN-13 válido
 *   e NÃO corresponde ao GTIN fixo literal de nenhum produto ativo.
 * - Casa `CCCCC` (5 dígitos) com a parte numérica do `sku` de produtos `pesavel: true`.
 * - Modo `"peso"`: `MMMMM` = gramas (`MMMMM / 1000` kg).
 * - Modo `"valor"`: `MMMMM` = centavos (`(MMMMM / 100) / preco` convertido em kg com 3 casas).
 */
export function decodificarEtiquetaBalancaPdv<T extends ProdutoBalcaoPdv>(
  codigoBruto: string,
  produtosAtivos: readonly T[],
  modo: ModoEtiquetaBalancaPdv = "peso",
): ResultadoEtiquetaBalancaPdv<T> {
  const limpo = String(codigoBruto ?? "").trim();
  if (!/^2\d{12}$/.test(limpo)) {
    return { ehEtiquetaBalanca: false };
  }

  // Se houver um produto cadastrado exatamente com esse GTIN-13 fixo, respeita o GTIN normal
  const gtinFixo = produtosAtivos.find((p) => p.gtin === limpo);
  if (gtinFixo) {
    return { ehEtiquetaBalanca: false };
  }

  if (!validarGtin(limpo)) {
    return {
      ehEtiquetaBalanca: true,
      ok: false,
      codigoProduto5: limpo.slice(1, 6),
      erro: `Etiqueta de balança "${limpo}" com dígito verificador inválido.`,
    };
  }

  const codigoProduto5 = limpo.slice(1, 6);
  const codigoNum = Number(codigoProduto5);
  const medidaBruta = Number(limpo.slice(6, 11));

  if (codigoNum <= 0 || medidaBruta <= 0) {
    return {
      ehEtiquetaBalanca: true,
      ok: false,
      codigoProduto5,
      erro: `Etiqueta de balança "${limpo}" com código ou peso/valor zerado.`,
    };
  }

  const produto = produtosAtivos.find((p) => {
    if (!p.pesavel) return false;
    const digitosSku = String(p.sku ?? "").replace(/\D/g, "");
    if (!digitosSku) return false;
    return Number(digitosSku) === codigoNum;
  });

  if (!produto) {
    return {
      ehEtiquetaBalanca: true,
      ok: false,
      codigoProduto5,
      erro: `Nenhum produto pesável encontrado para o código de balança ${codigoProduto5}.`,
    };
  }

  if (produto.preco <= 0) {
    return {
      ehEtiquetaBalanca: true,
      ok: false,
      codigoProduto5,
      erro: `Produto "${produto.nome}" está com preço zerado.`,
    };
  }

  let pesoKg = 0;
  let valorEtiqueta = 0;

  if (modo === "peso") {
    pesoKg = normalizarQtdPdv(medidaBruta / 1000);
    valorEtiqueta = round2(pesoKg * produto.preco);
  } else {
    valorEtiqueta = round2(medidaBruta / 100);
    pesoKg = normalizarQtdPdv(valorEtiqueta / produto.preco);
  }

  if (pesoKg <= 0) {
    return {
      ehEtiquetaBalanca: true,
      ok: false,
      codigoProduto5,
      erro: `Peso calculado na etiqueta de "${produto.nome}" é inválido.`,
    };
  }

  return {
    ehEtiquetaBalanca: true,
    ok: true,
    codigoProduto5,
    modo,
    produto,
    pesoKg,
    valorEtiqueta,
  };
}

/** Gera um código EAN-13 válido de 13 dígitos de etiqueta de balança (`2CCCCCMMMMM0D`) para testes e simulação */
export function gerarEtiquetaBalancaEan13Pdv(params: {
  codigoProduto: number | string;
  medidaCincoDigitos: number;
}): string {
  const cod = String(params.codigoProduto).replace(/\D/g, "").slice(-5).padStart(5, "0");
  const med = String(Math.max(0, Math.floor(params.medidaCincoDigitos))).slice(-5).padStart(5, "0");
  const base12 = `2${cod}${med}0`;
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const dv = (10 - (soma % 10)) % 10;
  return `${base12}${dv}`;
}

/* ------------------------------------------- 2. Consulta de Preço (F7) */

export function calcularTributosProdutoPdv(produto: ProdutoBalcaoPdv, qtd = 1) {
  const valorBase = round2(Math.max(0, Number(produto.preco) || 0) * Math.max(0, qtd));
  return tributosEstimados(valorBase, {
    icms: Number(produto.icmsAliq ?? 0),
    pis: Number(produto.pisAliq ?? 0),
    cofins: Number(produto.cofinsAliq ?? 0),
    ibs: Number(produto.ibsAliq ?? 0.1),
    cbs: Number(produto.cbsAliq ?? 0.9),
  });
}

/**
 * Busca produtos para o modal F7 (Consulta de Preço) sem tocar no carrinho da venda.
 * Suporta GTIN exato, etiqueta de balança GS1-2, SKU e nome sem acentos.
 */
export function consultarProdutosPrecoPdv<T extends ProdutoBalcaoPdv>(
  termo: string,
  produtosAtivos: readonly T[],
  modoBalanca: ModoEtiquetaBalancaPdv = "peso",
  limite = 8,
): {
  lista: T[];
  destaque: T | null;
  leituraBalanca: { pesoKg: number; valorEtiqueta: number } | null;
} {
  const bruto = String(termo ?? "").trim();
  if (!bruto) {
    return { lista: [], destaque: null, leituraBalanca: null };
  }

  const soDig = bruto.replace(/\D/g, "");
  if (soDig.length === 13 && /^\d{13}$/.test(bruto)) {
    const porGtin = produtosAtivos.find((p) => p.gtin === soDig);
    if (porGtin) {
      return { lista: [porGtin], destaque: porGtin, leituraBalanca: null };
    }
    const bal = decodificarEtiquetaBalancaPdv(soDig, produtosAtivos, modoBalanca);
    if (bal.ehEtiquetaBalanca && bal.ok && bal.produto) {
      return {
        lista: [bal.produto],
        destaque: bal.produto,
        leituraBalanca: { pesoKg: bal.pesoKg, valorEtiqueta: bal.valorEtiqueta },
      };
    }
  }

  const norm = normalizarTextoBalcaoPdv(bruto);
  const exatoSku = produtosAtivos.find((p) => normalizarTextoBalcaoPdv(p.sku) === norm);
  if (exatoSku) {
    return { lista: [exatoSku], destaque: exatoSku, leituraBalanca: null };
  }

  const ranqueados = produtosAtivos
    .map((p) => {
      const nome = normalizarTextoBalcaoPdv(p.nome);
      const sku = normalizarTextoBalcaoPdv(p.sku);
      const marca = normalizarTextoBalcaoPdv(p.marca ?? "");
      let pontos = -1;
      if (p.gtin && soDig.length >= 6 && p.gtin.includes(soDig)) pontos = 1000;
      else if (sku.startsWith(norm)) pontos = 850;
      else if (nome.startsWith(norm)) pontos = 600 + norm.length * 2;
      else if (nome.split(" ").some((pal) => pal.startsWith(norm))) pontos = 350;
      else if (nome.includes(norm) || sku.includes(norm) || (marca && marca.includes(norm))) pontos = 200;
      if (pontos < 0) return null;
      return { p, pontos };
    })
    .filter((x): x is { p: T; pontos: number } => Boolean(x))
    .sort((a, b) => b.pontos - a.pontos || a.p.nome.localeCompare(b.p.nome, "pt-BR"))
    .slice(0, Math.max(1, limite))
    .map((x) => x.p);

  return {
    lista: ranqueados,
    destaque: ranqueados[0] ?? null,
    leituraBalanca: null,
  };
}

/* ------------------------------------------- 3. Vendas em Espera (F9) */

export type VendaEmEsperaPdv = {
  id: string;
  identificacao: string;
  linhas: LinhaItemPdv[];
  clienteId: string | null;
  clienteNome: string;
  descontoModo: "real" | "percentual";
  descontoValor: string;
  pagamentos: ParcelaPagamentoPdv[];
  subtotal: number;
  total: number;
  unidades: number;
  criadoEm: number;
};

export type RascunhoVendaAtivaPdv = {
  linhas: readonly LinhaItemPdv[];
  clienteId: string | null;
  clienteNome: string;
  descontoModo: "real" | "percentual";
  descontoValor: string;
  pagamentos: readonly ParcelaPagamentoPdv[];
};

function calcularTotaisRascunho(r: RascunhoVendaAtivaPdv) {
  const subtotal = round2(r.linhas.reduce((s, l) => s + l.qtd * l.preco, 0));
  const valDesc = Number(String(r.descontoValor ?? "").replace(",", ".")) || 0;
  const desconto = round2(
    Math.min(subtotal, r.descontoModo === "percentual" ? (subtotal * valDesc) / 100 : valDesc),
  );
  const total = round2(Math.max(0, subtotal - desconto));
  const unidades = normalizarQtdPdv(r.linhas.reduce((s, l) => s + l.qtd, 0));
  return { subtotal, total, unidades };
}

/** Sanitiza lista lida do localStorage garantindo estrutura íntegra */
export function sanitizarListaEsperaPdv(bruto: unknown): VendaEmEsperaPdv[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const linhas = Array.isArray(item.linhas)
        ? item.linhas
            .filter((l): l is LinhaItemPdv => Boolean(l && typeof l === "object" && (l as LinhaItemPdv).produtoId))
            .map((l) => ({
              produtoId: String(l.produtoId),
              nome: String(l.nome ?? ""),
              qtd: normalizarQtdPdv(Number(l.qtd) || 0),
              preco: round2(Number(l.preco) || 0),
              unidade: String(l.unidade ?? "UN"),
              estoque: normalizarQtdPdv(Number(l.estoque) || 0),
              pesavel: Boolean(l.pesavel),
            }))
            .filter((l) => l.qtd > 0)
        : [];
      const descontoModo: "real" | "percentual" = item.descontoModo === "percentual" ? "percentual" : "real";
      const descontoValor = String(item.descontoValor ?? "");
      const pagamentos = Array.isArray(item.pagamentos)
        ? item.pagamentos
            .filter((p): p is ParcelaPagamentoPdv => Boolean(p && typeof p === "object"))
            .map((p) => ({ forma: String(p.forma ?? "dinheiro"), valor: round2(Number(p.valor) || 0) }))
            .filter((p) => p.valor > 0)
        : [];
      const clienteId = typeof item.clienteId === "string" && item.clienteId ? item.clienteId : null;
      const clienteNome = String(item.clienteNome || "CONSUMIDOR");
      const { subtotal, total, unidades } = calcularTotaisRascunho({
        linhas,
        clienteId,
        clienteNome,
        descontoModo,
        descontoValor,
        pagamentos,
      });
      return {
        id: String(item.id || `esp-${Date.now()}`),
        identificacao: String(item.identificacao || clienteNome || "Atendimento em espera"),
        linhas,
        clienteId,
        clienteNome,
        descontoModo,
        descontoValor,
        pagamentos,
        subtotal,
        total,
        unidades,
        criadoEm: Number(item.criadoEm) || Date.now(),
      };
    })
    .filter((v) => v.linhas.length > 0)
    .slice(0, LIMITE_VENDAS_ESPERA_PDV);
}

/** Suspende o atendimento atual para a fila de espera local (F9) */
export function suspenderVendaParaEsperaPdv(params: {
  listaAtual: readonly VendaEmEsperaPdv[];
  vendaAtiva: RascunhoVendaAtivaPdv;
  identificacao?: string;
  idGerado?: string;
  agora?: number;
}):
  | { ok: true; lista: VendaEmEsperaPdv[]; suspensa: VendaEmEsperaPdv }
  | { ok: false; erro: string } {
  const linhasValidas = params.vendaAtiva.linhas.filter((l) => l.qtd > 0);
  if (linhasValidas.length === 0) {
    return {
      ok: false,
      erro: "Adicione ao menos um item com quantidade válida antes de colocar em espera.",
    };
  }

  if (params.listaAtual.length >= LIMITE_VENDAS_ESPERA_PDV) {
    return {
      ok: false,
      erro: `Limite de ${LIMITE_VENDAS_ESPERA_PDV} vendas em espera atingido. Retome ou descarte uma antes.`,
    };
  }

  const agora = params.agora ?? Date.now();
  const { subtotal, total, unidades } = calcularTotaisRascunho({
    ...params.vendaAtiva,
    linhas: linhasValidas,
  });
  const rotuloManual = String(params.identificacao ?? "").trim();
  const identificacao =
    rotuloManual ||
    (params.vendaAtiva.clienteId ? params.vendaAtiva.clienteNome : `Balcão #${params.listaAtual.length + 1}`);

  const suspensa: VendaEmEsperaPdv = {
    id: params.idGerado || `esp-${agora}-${Math.random().toString(36).slice(2, 7)}`,
    identificacao,
    linhas: linhasValidas.map((l) => ({ ...l })),
    clienteId: params.vendaAtiva.clienteId,
    clienteNome: params.vendaAtiva.clienteNome || "CONSUMIDOR",
    descontoModo: params.vendaAtiva.descontoModo,
    descontoValor: params.vendaAtiva.descontoValor,
    pagamentos: params.vendaAtiva.pagamentos.map((p) => ({ ...p })),
    subtotal,
    total,
    unidades,
    criadoEm: agora,
  };

  return {
    ok: true,
    lista: [suspensa, ...params.listaAtual],
    suspensa,
  };
}

/**
 * Retoma uma venda da lista de espera para o caixa.
 * Se já houver outra venda com itens na tela, guarda-a automaticamente em espera (`trocouComAtual: true`)
 * para jamais perder itens digitados por engano!
 */
export function retomarVendaDeEsperaPdv(params: {
  listaAtual: readonly VendaEmEsperaPdv[];
  idAlvo: string;
  vendaAtivaNaTela?: RascunhoVendaAtivaPdv | null;
  produtosAtivos?: readonly ProdutoBalcaoPdv[];
  agora?: number;
}):
  | {
      ok: true;
      retomada: VendaEmEsperaPdv;
      listaRestante: VendaEmEsperaPdv[];
      trocouComAtual: boolean;
    }
  | {
      ok: false;
      erro: string;
    } {
  const alvo = params.listaAtual.find((v) => v.id === params.idAlvo);
  if (!alvo) {
    return { ok: false, erro: "Venda em espera não encontrada." };
  }

  let listaRestante = params.listaAtual.filter((v) => v.id !== params.idAlvo);
  let trocouComAtual = false;

  const ativa = params.vendaAtivaNaTela;
  const linhasAtivas = ativa ? ativa.linhas.filter((l) => l.qtd > 0) : [];
  if (ativa && linhasAtivas.length > 0) {
    const rTroca = suspenderVendaParaEsperaPdv({
      listaAtual: listaRestante,
      vendaAtiva: { ...ativa, linhas: linhasAtivas },
      identificacao: ativa.clienteId ? `${ativa.clienteNome} (troca)` : "Venda trocada no caixa",
      agora: params.agora,
    });
    if (rTroca.ok) {
      listaRestante = rTroca.lista;
      trocouComAtual = true;
    }
  }

  const mapaProdutos = new Map((params.produtosAtivos ?? []).map((p) => [p.id, p]));
  const linhasAtualizadas = alvo.linhas.map((l) => {
    const prod = mapaProdutos.get(l.produtoId);
    if (!prod) return { ...l };
    return {
      ...l,
      estoque: normalizarQtdPdv(prod.estoque),
      unidade: prod.unidade || l.unidade,
      pesavel: Boolean(prod.pesavel),
    };
  });

  return {
    ok: true,
    retomada: {
      ...alvo,
      linhas: linhasAtualizadas,
    },
    listaRestante,
    trocouComAtual,
  };
}

export function removerVendaDeEsperaPdv(
  listaAtual: readonly VendaEmEsperaPdv[],
  idAlvo: string,
): VendaEmEsperaPdv[] {
  return listaAtual.filter((v) => v.id !== idAlvo);
}
