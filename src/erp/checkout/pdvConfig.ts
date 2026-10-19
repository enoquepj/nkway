import type { Produto } from "../types";

/** Configuração da frente de caixa — fica salva neste computador */
export type PdvConfig = {
  numeroCaixa: string;
  operador: string;
  /** A etiqueta da balança (EAN-13 começando com 2) carrega VALOR R$ ou PESO Kg */
  etiquetaBalanca: "valor" | "peso";
  /** Voltar para a tela de espera automaticamente (segundos) */
  autoEspera: number;
  /** SKUs exibidos no carrossel da tela de espera */
  skusEspera: string[];
};

const KEY = "nkway.pdv.config";

export const padraoConfig: PdvConfig = {
  numeroCaixa: "01",
  operador: "",
  etiquetaBalanca: "valor",
  autoEspera: 15,
  skusEspera: ["CAM-001", "TEN-200", "FRU-101", "FRI-102", "JAQ-055"],
};

export function carregarConfig(): PdvConfig {
  try {
    return { ...padraoConfig, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return padraoConfig;
  }
}

export function salvarConfig(c: PdvConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

/**
 * Interpreta o que foi digitado/bipado no campo de busca da frente de caixa.
 *
 *  - "3x" ou "2,5x" precedendo o produto → quantidade/peso avulso
 *  - EAN-13 começando com "2" → etiqueta de BALANÇA (código 5d + valor/peso 5d)
 *  - EAN-13 comum → GTIN do produto
 *  - demais → busca por nome ou SKU
 */
export type Interpretacao =
  | { tipo: "qtd"; valor: number; resto: string }
  | { tipo: "balanca"; cod: string; medida: number }
  | { tipo: "busca"; termo: string };

export function interpretarEntrada(texto: string, cfgEtiqueta: PdvConfig["etiquetaBalanca"]): Interpretacao {
  const t = texto.trim().toLowerCase();

  // quantidade com X: "3x", "2.5x", "2,5 x", OU "3x banana" (com produto junto)
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*x(?:\s+(.*))?$/);
  if (m) {
    return {
      tipo: "qtd",
      valor: parseFloat(m[1].replace(",", ".")),
      resto: (m[2] ?? "").trim(),
    };
  }

  // etiqueta de balança: analisa EAN-13 iniciando em 2 (convenção GS1 itens variáveis)
  if (/^2\d{12}$/.test(t)) {
    const cod = t.slice(1, 6); // código do produto (5 díg. após o "2")
    const bruto = Number(t.slice(6, 11));
    // etiqueta com valor R$: 5 díg. = centavos | com peso: 5 díg. = gramas
    const medida = cfgEtiqueta === "valor" ? bruto / 100 : bruto / 1000;
    return { tipo: "balanca", cod, medida };
  }

  return { tipo: "busca", termo: t };
}

export type ResultadoBusca =
  | { tipo: "produto"; produto: Produto }
  | { tipo: "lista"; produtos: Produto[] }
  | { tipo: "vazio" };

export function buscarProduto(termo: string, produtos: Produto[]): ResultadoBusca {
  const t = termo.trim().toLowerCase();
  if (!t) return { tipo: "vazio" };

  // 1 — exatidão por GTIN (bipe do leitor)
  const gtin = produtos.find((p) => p.gtin === t);
  if (gtin) return { tipo: "produto", produto: gtin };

  // 2 — exatidão por SKU ou código de balança
  const sku = produtos.find(
    (p) => p.sku.toLowerCase() === t || (p.codBalanca && p.codBalanca.replace(/^0+/, "") === t.replace(/^0+/, "")),
  );
  if (sku) return { tipo: "produto", produto: sku };

  // 3 — contém nome/código
  const lista = produtos.filter(
    (p) =>
      p.nome.toLowerCase().includes(t) ||
      p.sku.toLowerCase().includes(t) ||
      (p.gtin || "").includes(t) ||
      (p.marca || "").toLowerCase().includes(t),
  );
  if (lista.length === 1) return { tipo: "produto", produto: lista[0] };
  if (lista.length > 1) return { tipo: "lista", produtos: lista.slice(0, 9) };

  return { tipo: "vazio" };
}
