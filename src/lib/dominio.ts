/**
 * NKWAY — regras de domínio compartilhadas (front e servidor).
 * Porta do núcleo de src/erp/types.ts do repositório para a versão fullstack.
 */

export const moeda = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

export const num = (v: number | string | null | undefined, casas = 3) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: casas }).format(Number(v ?? 0));

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export function mascaraDocumento(v: string): string {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11)
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export const dataBR = (v: string | Date | null | undefined) => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(`${v}T12:00:00`) : v;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
};

export const dataHoraBR = (v: string | Date | null | undefined) => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const hojeISO = () => new Date().toISOString().slice(0, 10);

export function somaDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export const apenasData = (v: string | Date) =>
  (typeof v === "string" ? v : v.toISOString()).slice(0, 10);

/** Gera chave de acesso de 44 dígitos no formato SEFAZ (simulada, sem valor jurídico) */
export function gerarChave(params: {
  uf: string;
  aamm: string;
  cnpj: string;
  modelo: string;
  serie: string;
  numeroNota: number;
}): string {
  const uf = params.uf.padStart(2, "0");
  const cnpj = soDigitos(params.cnpj).padStart(14, "0");
  const nNF = String(params.numeroNota).padStart(9, "0");
  const cNF = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const base = `${uf}${params.aamm}${cnpj}${params.modelo.padStart(2, "0")}${params.serie.padStart(3, "0")}${nNF}1${cNF}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return `${base}${dv}`;
}

export const formatChave = (c: string | null | undefined) =>
  (c ?? "").replace(/(.{4})/g, "$1 ").trim();

/** Dígito verificador de EAN-13 */
export function validarGtin(g: string): boolean {
  if (g === "" || g === "SEM GTIN") return true;
  if (!/^\d{13}$/.test(g)) return false;
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(g[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10 === Number(g[12]);
}

export function gerarGtin(base: number): string {
  const s = `789${String(base).padStart(9, "0")}`;
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return `${s}${(10 - (soma % 10)) % 10}`;
}

export const UFS: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais",
  MS: "Mato Grosso do Sul", MT: "Mato Grosso", PA: "Pará", PB: "Paraíba", PE: "Pernambuco",
  PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RO: "Rondônia",
  RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", TO: "Tocantins",
};

/** código UF numérico usado na chave de acesso */
export const UF_NUMERO: Record<string, string> = {
  AC: "12", AL: "27", AM: "13", AP: "16", BA: "29", CE: "23", DF: "53", ES: "32", GO: "52",
  MA: "21", MG: "31", MS: "50", MT: "51", PA: "15", PB: "25", PE: "26", PI: "22", PR: "41",
  RJ: "33", RN: "24", RO: "11", RR: "14", RS: "43", SC: "42", SE: "28", TO: "17",
};

export const MODELO_NUMERO: Record<string, string> = { "NF-e": "55", "NFC-e": "65", SAT: "59" };

/** Unidades de comercialização aceitas na NF-e (uCom / uTrib) */
export const UNIDADES_LISTA = ["UN", "CX", "KG", "G", "L", "ML", "M", "M2", "M3", "PAR", "DZ", "PC", "KIT", "SC", "ROL"] as const;

export const FORMAS_PAGAMENTO = [
  { id: "dinheiro", label: "Dinheiro", tPag: "01", cor: "emerald" },
  { id: "pix", label: "PIX", tPag: "17", cor: "teal" },
  { id: "credito", label: "Crédito", tPag: "03", cor: "indigo" },
  { id: "debito", label: "Débito", tPag: "04", cor: "sky" },
  { id: "boleto", label: "Boleto", tPag: "15", cor: "amber" },
  { id: "prazo", label: "Prazo / fiado", tPag: "18", cor: "rose" },
] as const;

export type FormaPagamentoId = (typeof FORMAS_PAGAMENTO)[number]["id"];

export const rotuloForma = (f: string | null | undefined) =>
  FORMAS_PAGAMENTO.find((x) => x.id === f)?.label ?? (f || "—");

/** Parte da venda que vira conta a receber (boleto / prazo) */
export function valorAPrazo(
  pagamentos: { forma: string; valor: number }[] | null | undefined,
  total: number,
  forma: string,
): number {
  if (pagamentos?.length)
    return round2(
      pagamentos.filter((p) => p.forma === "boleto" || p.forma === "prazo").reduce((s, p) => s + p.valor, 0),
    );
  return forma === "boleto" || forma === "prazo" ? round2(total) : 0;
}

/** Transparência fiscal (Lei 12.741) com fase de transição do IBS/CBS */
export function tributosEstimados(
  valor: number,
  aliq: { icms: number; pis: number; cofins: number; ibs: number; cbs: number },
) {
  const p = (k: number) => round2((valor * k) / 100);
  const itens = [
    { label: "ICMS", valor: p(aliq.icms) },
    { label: "PIS", valor: p(aliq.pis) },
    { label: "COFINS", valor: p(aliq.cofins) },
    { label: "IBS (teste 2026)", valor: p(aliq.ibs) },
    { label: "CBS (teste 2026)", valor: p(aliq.cbs) },
  ];
  return { itens, total: round2(itens.reduce((s, i) => s + i.valor, 0)) };
}

/** Situação de estoque usada em alertas, posição e filtros */
export type SituacaoEstoque = "zerado" | "critico" | "baixo" | "saudavel";
export function situacaoEstoque(estoque: number, minimo: number): SituacaoEstoque {
  if (estoque <= 0) return "zerado";
  if (minimo > 0 && estoque <= minimo * 0.5) return "critico";
  if (minimo > 0 && estoque <= minimo) return "baixo";
  return "saudavel";
}

export const ROTULO_SITUACAO: Record<SituacaoEstoque, string> = {
  zerado: "Zerado",
  critico: "Crítico",
  baixo: "Baixo",
  saudavel: "Saudável",
};

/** Curva ABC por faturamento */
export type ClasseABC = "A" | "B" | "C";
export function classeAcumulado(participacaoAcum: number): ClasseABC {
  if (participacaoAcum <= 80) return "A";
  if (participacaoAcum <= 95) return "B";
  return "C";
}

/** Planos e limites (paywall leve) */
export type PlanoCfg = {
  id: string;
  nome: string;
  preco: number;
  limiteProdutos: number;
  limiteUsuarios: number;
  recursos: string[];
};

export const PLANOS_CFG: PlanoCfg[] = [
  {
    id: "start",
    nome: "MEI Start",
    preco: 0,
    limiteProdutos: 300,
    limiteUsuarios: 1,
    recursos: ["PDV com DAV", "Estoque com kardex", "1 terminal", "Suporte por e-mail"],
  },
  {
    id: "me",
    nome: "ME / Simples",
    preco: 49.9,
    limiteProdutos: 10000,
    limiteUsuarios: 3,
    recursos: ["NFC-e e NF-e", "Entrada por XML", "Financeiro completo", "MDF-e", "Relatórios"],
  },
  {
    id: "loja_mais",
    nome: "Loja+",
    preco: 99.9,
    limiteProdutos: 100000,
    limiteUsuarios: 15,
    recursos: ["Tudo da ME/Simples", "Manutenção de preços em massa", "Multi-loja", "DF-e (captura NF-e)"],
  },
];

export const planoById = (id: string | null | undefined) =>
  PLANOS_CFG.find((p) => p.id === id) ?? PLANOS_CFG[0];

export const diasAteTrial = (until: Date | string | null | undefined) => {
  if (!until) return Infinity;
  const d = typeof until === "string" ? new Date(until) : until;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
};
