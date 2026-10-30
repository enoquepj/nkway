/**
 * NKWAY — montagem dos dados de impressão dos documentos fiscais.
 * Layouts: DANFE NFC-e em bobina de 80 mm, DANFE NF-e simplificado em A4
 * e DAMDFE em A4. Tudo é só cálculo e texto — a renderização fica em Impressao.tsx.
 */
import { FORMAS_PAGAMENTO, round2, soDigitos, tributosEstimados } from "@/lib/dominio";
import type { ProdutoRow } from "@/db/schema";

export type Emitente = {
  nome: string;
  fantasia: string;
  cnpj: string;
  ie: string;
  regime: string;
  endereco: string;
  municipio: string;
  uf: string;
  codMunicipio: string;
};

export type ItemDanfe = {
  nome: string;
  qtd: number;
  unidade: string | null;
  precoUnit: number;
  total: number;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  icmsAliq?: number;
};

export type DocFiscal = {
  modelo: "NFC-e" | "NF-e" | "SAT" | string;
  serie: string | null;
  numero: number;
  numeroInterno: number;
  chave: string | null;
  protocolo: string | null;
  autorizadaEm: string | null;
  status: string;
  ambiente: 1 | 2;
  data: string;
  operador: string | null;
  cliente: string;
  itens: ItemDanfe[];
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  pagamentos: { forma: string; valor: number }[];
  forma: string;
  troco: number;
  observacao: string | null;
};

export const rotuloFormaImpresso = (f: string) =>
  FORMAS_PAGAMENTO.find((x) => x.id === f)?.label ?? (f === "a vista" ? "À vista" : f || "—");

/** chave formatada em blocos de 4 (leitura humana) */
export const chaveBlocos = (c: string | null | undefined) => (soDigitos(c ?? "").replace(/(.{4})/g, "$1 ").trim());

/** texto do QR Code no padrão de consulta pública da NFC-e (2.0 simplificado) */
export function payloadQrNfce(doc: DocFiscal, emit: Emitente, cscId: string): string {
  const chave = soDigitos(doc.chave ?? "");
  if (!chave) return "";
  const totais = doc.total.toFixed(2);
  const digest = Buffer.from(`${chave}|${totais}|${emit.cnpj}`, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .slice(0, 56);
  const pedacos = [
    chave,
    "2",
    String(doc.ambiente),
    soDigitos(emit.ie) || "ISENTO",
    totais,
    digest,
    "1",
    cscId || "00000000",
  ];
  const url = `https://dfe-nkway.com.br/consulta?p=${pedacos.join("|")}`;
  return url.length <= 134 ? url : `${url.slice(0, 131)}...`;
}

/** carga tributária aproximada (Lei 12.741) a partir das alíquotas do produto */
export function tributosDoDoc(itens: ItemDanfe[], porNome: Map<string, ProdutoRow | undefined>) {
  const soma = itens.reduce(
    (acc, i) => {
      const p = porNome.get(i.nome);
      if (!p) return acc;
      return {
        icms: acc.icms + (i.total * Number(p.icmsAliq)) / 100,
        pis: acc.pis + (i.total * Number(p.pisAliq)) / 100,
        cofins: acc.cofins + (i.total * Number(p.cofinsAliq)) / 100,
        ibs: acc.ibs + (i.total * Number(p.ibsAliq)) / 100,
        cbs: acc.cbs + (i.total * Number(p.cbsAliq)) / 100,
      };
    },
    { icms: 0, pis: 0, cofins: 0, ibs: 0, cbs: 0 },
  );
  return tributosEstimados(
    round2(itens.reduce((s, i) => s + i.total, 0)),
    {
      icms: round2(soma.icms),
      pis: round2(soma.pis),
      cofins: round2(soma.cofins),
      ibs: round2(soma.ibs),
      cbs: round2(soma.cbs),
    },
  );
}

export type MdfeImpresso = {
  numero: number;
  serie: string;
  chave: string;
  protocolo: string | null;
  status: string;
  ufInicio: string;
  ufFim: string;
  municipioCarregamento: string | null;
  municipioDescarregamento: string | null;
  placa: string;
  rntrc: string | null;
  condutor: string | null;
  cpfCondutor: string | null;
  documentos: { chave: string; tipo: string; valor: number }[];
  pesoBruto: number;
  valorCarga: number;
  emitidoEm: string;
  encerradoEm: string | null;
  kmRodado?: number | null;
};
