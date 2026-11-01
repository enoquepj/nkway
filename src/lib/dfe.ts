/**
 * NKWAY — tipos e utilitários puros de Distribuição DF-e (NT 2014.002 v1.01).
 * Módulo isomórfico (sem dependências Node), seguro para importar em Views e no Servidor.
 */
import { soDigitos } from "@/lib/dominio";

export const SEFAZ_AN_PROD =
  "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
export const SEFAZ_AN_HOM =
  "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

export const SOAP_ACTION_DIST =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
export const NS_WSDL_DIST = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";

/** Intervalo mínimo entre consultas SEFAZ sem novos documentos (evita cStat 656 Consumo Indevido) */
export const MIN_INTERVALO_DFE_MS = 60_000;

export type StatusManifesto =
  | "pendente"
  | "ciencia"
  | "confirmada"
  | "desconhecida"
  | "nao_realizada"
  | "resumo";

export const MANIFESTOS_DFE: {
  id: Exclude<StatusManifesto, "pendente" | "resumo">;
  tpEvento: string;
  rotulo: string;
  exigeJustificativa: boolean;
  tom: "info" | "ok" | "alerta" | "erro";
}[] = [
  { id: "ciencia", tpEvento: "210210", rotulo: "Ciência da operação", exigeJustificativa: false, tom: "info" },
  { id: "confirmada", tpEvento: "210200", rotulo: "Confirmação da operação", exigeJustificativa: false, tom: "ok" },
  { id: "desconhecida", tpEvento: "210220", rotulo: "Desconhecimento da operação", exigeJustificativa: true, tom: "alerta" },
  { id: "nao_realizada", tpEvento: "210240", rotulo: "Operação não realizada", exigeJustificativa: true, tom: "erro" },
];

export const ROTULO_MANIFESTO: Record<
  StatusManifesto,
  { rotulo: string; tom: "neutro" | "info" | "ok" | "alerta" | "erro" | "roxo" }
> = {
  pendente: { rotulo: "Pendente", tom: "alerta" },
  resumo: { rotulo: "Resumo (dar ciência)", tom: "roxo" },
  ciencia: { rotulo: "Ciência (210210)", tom: "info" },
  confirmada: { rotulo: "Confirmada (210200)", tom: "ok" },
  desconhecida: { rotulo: "Desconhecida (210220)", tom: "erro" },
  nao_realizada: { rotulo: "Não realizada (210240)", tom: "erro" },
};

export type DfeDocumento = {
  id: string;
  nsu: string;
  chave: string;
  numero: string;
  serie: string;
  /** procNFe | resNFe | procEventoNFe | resEvento */
  schema: string;
  emitenteNome: string;
  emitenteCnpj: string;
  valorTotal: number;
  dataEmissao: string;
  statusManifesto: StatusManifesto;
  protocoloManifesto?: string;
  justificativaManifesto?: string;
  temXmlCompleto: boolean;
  /** XML compactado GZIP+Base64 no banco; no painel vem o XML pronto quando disponível */
  xmlZip?: string;
  xml?: string;
  importadoErp: boolean;
  entradaId?: string | null;
  capturadoEm: string;
};

export type DfePainelDados = {
  empresaCnpj: string;
  empresaNome: string;
  empresaUf: string;
  ambiente: 1 | 2;
  ativo: boolean;
  modoEfetivo: "live" | "demo";
  workerConfigurado: boolean;
  bucketConfigurado: boolean;
  cronSecretConfigurado: boolean;
  temCertificado: boolean;
  armazenamentoCert: "bucket" | "cofre" | "nenhum";
  certificadoPath: string;
  certificadoNome: string;
  certificadoValidade: string;
  certificadoSerial: string;
  certificadoCnpj: string;
  ultimoNsu: string;
  maxNsu: string;
  ultimaConsultaEm: string | null;
  ultimoCstat: string;
  ultimoXmotivo: string;
  documentos: DfeDocumento[];
};

/** Formata NSU com 15 dígitos numéricos (padrão SEFAZ) */
export function padNsu(nsu: string | number | null | undefined): string {
  return soDigitos(String(nsu ?? "0")).padStart(15, "0").slice(-15);
}

export function sefazDistUrl(ambiente: 1 | 2): string {
  return ambiente === 2 ? SEFAZ_AN_HOM : SEFAZ_AN_PROD;
}

export function rotuloSchemaDfe(schema: string): { rotulo: string; completo: boolean } {
  const s = (schema || "").toLowerCase();
  if (s.includes("procnfe")) return { rotulo: "NF-e completa", completo: true };
  if (s.includes("resnfe")) return { rotulo: "Resumo NF-e", completo: false };
  if (s.includes("evento")) return { rotulo: "Evento fiscal", completo: false };
  return { rotulo: schema || "procNFe", completo: true };
}

/** Envelope SOAP 1.2 NfeDistDFeInteresse v1.01 — consulta sequencial por ultNSU */
export function buildSoapDistNsu(cnpj: string, ultNsu: string, ambiente: 1 | 2 = 2): string {
  const cnpj14 = soDigitos(cnpj).padStart(14, "0").slice(0, 14);
  const nsu = padNsu(ultNsu);
  const tpAmb = ambiente === 1 ? "1" : "2";
  const distDFe =
    `<distDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>91</cUFAutor>` +
    `<CNPJ>${cnpj14}</CNPJ>` +
    `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
    `</distDFeInt>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="${NS_WSDL_DIST}">` +
    `<nfeDadosMsg>${distDFe}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** Envelope SOAP 1.2 NfeDistDFeInteresse v1.01 — consulta pontual por chave de 44 dígitos */
export function buildSoapConsChNFe(cnpj: string, chave: string, ambiente: 1 | 2 = 2): string {
  const cnpj14 = soDigitos(cnpj).padStart(14, "0").slice(0, 14);
  const ch44 = soDigitos(chave).slice(0, 44);
  const tpAmb = ambiente === 1 ? "1" : "2";
  const distDFe =
    `<distDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUFAutor>91</cUFAutor>` +
    `<CNPJ>${cnpj14}</CNPJ>` +
    `<consChNFe><chNFe>${ch44}</chNFe></consChNFe>` +
    `</distDFeInt>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="${NS_WSDL_DIST}">` +
    `<nfeDadosMsg>${distDFe}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}
