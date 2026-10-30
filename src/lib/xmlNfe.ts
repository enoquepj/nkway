/**
 * Leitura de XML de NF-e de entrada (porta de src/erp/xmlNfe.ts).
 * Parser sem dependências: extrai as tags relevantes do <NFe> e dos <det>.
 */

export type NfeItemXml = {
  nome: string;
  ncm: string;
  cfop: string;
  unidade: string;
  qtd: number;
  custo: number;
  gtin: string;
};

export type NfeXml = {
  chave: string;
  numero: string;
  serie: string;
  emissao: string;
  fornecedor: string;
  cnpjFornecedor: string;
  valorProdutos: number;
  valorFrete: number;
  total: number;
  itens: NfeItemXml[];
};

const pega = (xml: string, tag: string, de = 0, ate = xml.length): string => {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const trecho = xml.slice(de, ate);
  const m = trecho.match(re);
  return m ? limpa(m[1]) : "";
};

const limpa = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const n = (s: string) => {
  const v = Number(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

/** data SEFAZ (2026-03-22T10:00:00-03:00 ou 20260322) → yyyy-mm-dd */
function normalizaData(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v.replace(/\D/g, "");
  if (d.length >= 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const t = Date.parse(v);
  return Number.isNaN(t) ? new Date().toISOString().slice(0, 10) : new Date(t).toISOString().slice(0, 10);
}

const digitos = (s: string) => s.replace(/\D/g, "");

export function parseNfeXml(xml: string): NfeXml {
  if (!/<\s*NFe|nfeProc|infNFe/i.test(xml))
    throw new Error("Arquivo não parece ser uma NF-e. Envie o .xml da SEFAZ (procNFe ou NFe).");

  const ideIni = xml.indexOf("<ide>");
  const ideFim = ideIni >= 0 ? xml.indexOf("</ide>", ideIni) + 6 : xml.length;
  const ide = ideIni >= 0 ? xml.slice(ideIni, ideFim) : xml;

  const chave = pega(xml, "chNFe") || digitos(pega(xml, "chave"));
  const emitIni = xml.indexOf("<emit>");
  const emitFim = emitIni >= 0 ? xml.indexOf("</emit>", emitIni) + 7 : xml.length;
  const emit = emitIni >= 0 ? xml.slice(emitIni, emitFim) : xml;

  const detBlocos = [...xml.matchAll(/<det\b[\s\S]*?(?=<det\b|$)/g)].map((m) => m[0]);

  return {
    chave: chave || `SIMUL${digitos(String(Date.now())).slice(0, 36)}`,
    numero: pega(ide, "nNF") || "0",
    serie: pega(ide, "serie") || "1",
    emissao: normalizaData(pega(ide, "dhEmi") || pega(ide, "dEmi")),
    fornecedor: pega(emit, "xNome") || "FORNECEDOR NÃO IDENTIFICADO",
    cnpjFornecedor: digitos(pega(emit, "CNPJ") || pega(emit, "CPF")),
    valorProdutos: n(pega(xml, "vProd")),
    valorFrete: n(pega(xml, "vFrete")),
    total: n(pega(xml, "vNF")) || n(pega(xml, "vProd")),
    itens: detBlocos.map((bloco) => ({
      nome: limpa(pega(bloco, "xProd")) || "ITEM SEM DESCRIÇÃO",
      ncm: digitos(pega(bloco, "NCM")).slice(0, 8) || "00000000",
      cfop: digitos(pega(bloco, "CFOP")).slice(0, 4) || "5101",
      unidade: (pega(bloco, "uCom") || "UN").slice(0, 6),
      qtd: n(pega(bloco, "qCom")) || 1,
      custo: n(pega(bloco, "vUnCom")) || 0,
      gtin: pega(bloco, "cEAN") === "SEM GTIN" ? "SEM GTIN" : digitos(pega(bloco, "cEAN")),
    })),
  };
}

export type NotaSefaz = NfeXml & { origem: "sefaz" };

/**
 * Consulta pontual por chave (modo demonstração).
 * Em produção, o caminho é DF-e → `dfe-dist` (Supabase Edge) → worker mTLS com A1,
 * conforme `supabase/DFE_ROTEIRO_CONFIG.md` do repositório.
 */
export function notaPorChaveDemo(chave: string): NotaSefaz {
  const c = digitos(chave);
  if (c.length !== 44) throw new Error("A chave de acesso deve ter 44 dígitos (sem espaços).");
  const uf = c.slice(0, 2);
  const aamm = c.slice(2, 6);
  const cnpj = c.slice(6, 20);
  const modelo = c.slice(20, 22);
  const numero = String(Number(c.slice(25, 34)));
  let soma = 0;
  for (let i = 0; i < 20; i++) soma += Number(c[i]) * (i % 2 === 0 ? 1 : 3);
  const cidade = ["Ji-Paraná", "Porto Velho", "Ariquemes", "Vilhena", "Cacoal"][soma % 5];
  const fornecedor = [
    "DISTRIBUIDORA NORTE SUL LTDA",
    "ATACADÃO AMAZÔNIA S.A.",
    "COMERCIAL RIO MADEIRA EIRELI",
    "DISTRIBUIDORA CENTRAL OESTE LTDA",
  ][soma % 4];
  const itens: NfeItemXml[] = [
    { nome: "ARROZ TIPO 1 5KG", ncm: "10063021", cfop: "5101", unidade: "PC", qtd: 24, custo: 22.4, gtin: "7896004210016" },
    { nome: "OLEO DE SOJA 900ML", ncm: "15071000", cfop: "5101", unidade: "UN", qtd: 36, custo: 6.35, gtin: "7893004111129" },
    { nome: "ACUCAR REFINADO 5KG", ncm: "17019900", cfop: "5101", unidade: "PC", qtd: 18, custo: 14.9, gtin: "7891234001237" },
    { nome: "FEIJAO CARIOCA 1KG", ncm: "07133391", cfop: "5101", unidade: "UN", qtd: 30, custo: 7.15, gtin: "7898100123456" },
  ].slice(0, (Number(numero) % 4) + 1);
  const valorProdutos = itens.reduce((s, i) => s + i.qtd * i.custo, 0);
  return {
    chave: c,
    numero,
    serie: String(Number(c.slice(22, 25))),
    emissao: `20${aamm.slice(0, 2)}-${aamm.slice(2, 4)}-${String((Number(numero) % 27) + 1).padStart(2, "0")}`,
    fornecedor,
    cnpjFornecedor: cnpj,
    valorProdutos: Math.round(valorProdutos * 100) / 100,
    valorFrete: Math.round(valorProdutos * 0.04 * 100) / 100,
    total: Math.round((valorProdutos * 1.04 + 12) * 100) / 100,
    itens,
    origem: "sefaz",
  };
}

export const rotuloUf = (uf: string) => uf || `UF ${uf}`;
export const _modelo = { modeloNF: (c: string) => digitos(c).slice(20, 22) || "55" };
