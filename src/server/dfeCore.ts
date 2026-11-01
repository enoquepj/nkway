/**
 * NKWAY — Motor Server-Side de Distribuição DF-e e Cofre do Certificado A1.
 * Executa exclusivamente no Node.js (Server Components, Server Actions e Route Handlers).
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from "node:crypto";
import https from "node:https";
import tls from "node:tls";
import { gunzipSync, gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { empresas, type EmpresaRow } from "@/db/schema";
import {
  MIN_INTERVALO_DFE_MS,
  NS_NFE,
  NS_WSDL_DIST,
  SOAP_ACTION_DIST,
  buildSoapConsChNFe,
  buildSoapDistNsu,
  padNsu,
  sefazDistUrl,
  type DfeDocumento,
  type StatusManifesto,
} from "@/lib/dfe";
import { UF_NUMERO, gerarChave, gerarGtin, round2, soDigitos, validarChaveAcesso, validarCnpj } from "@/lib/dominio";

const BUCKET_CERT = "certificados-a1";
const MAX_DOCS_GUARDADOS = 120;

/* ------------------------------------------------ criptografia AES-256-GCM */

function chaveSimetrica(): Buffer {
  const segredo =
    process.env.DFE_SECRET ||
    process.env.AUTH_SECRET ||
    "nkway-dfe-segredo-local-dev-troque-em-producao";
  return scryptSync(segredo, "nkway.dfe.a1.v1", 32);
}

/** Cifra string sensível (senha do A1 ou PFX em base64) com AES-256-GCM autenticado */
export function cifrarSegredo(plano: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chaveSimetrica(), iv);
  const enc = Buffer.concat([cipher.update(plano, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

/** Decifra payload `v1:...` gerado por cifrarSegredo; lança erro se adulterado */
export function decifrarSegredo(cifrado: string): string {
  const partes = String(cifrado || "").split(":");
  if (partes.length !== 4 || partes[0] !== "v1") {
    throw new Error("Formato de segredo cifrado inválido.");
  }
  const iv = Buffer.from(partes[1], "base64url");
  const tag = Buffer.from(partes[2], "base64url");
  const dados = Buffer.from(partes[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", chaveSimetrica(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(dados), decipher.final()]);
  return dec.toString("utf8");
}

/* ------------------------------------------- diagnóstico de variáveis env */

export function ambienteDfeServidor() {
  const storageUrl = (process.env.DFE_STORAGE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const storageKey = process.env.DFE_STORAGE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const workerUrl = (process.env.DFE_MTLS_WORKER_URL || "").replace(/\/$/, "");
  const workerSecret = process.env.DFE_MTLS_WORKER_SECRET || "";
  const modoEnv = (process.env.DFE_SEFAZ_MODE || "").toLowerCase();
  const cronSecret = process.env.DFE_CRON_SECRET || process.env.CRON_SECRET || "";

  const bucketConfigurado = Boolean(storageUrl && storageKey);
  const workerConfigurado = Boolean(workerUrl);
  const modoLiveSolicitado = modoEnv === "live" || modoEnv === "direct";

  return {
    storageUrl,
    storageKey,
    workerUrl,
    workerSecret,
    modoEnv,
    cronSecret,
    bucketConfigurado,
    workerConfigurado,
    cronSecretConfigurado: Boolean(cronSecret),
    modoLiveSolicitado,
  };
}

/* ------------------------------------- bucket privado certificados-a1 REST */

export async function salvarPfxArmazenamento(params: {
  empresaId: string;
  cnpj: string;
  pfxBuffer: Buffer;
}): Promise<{ certPath: string; pfxCifradoFallback: string | null; modo: "bucket" | "cofre" }> {
  const env = ambienteDfeServidor();
  const cnpj14 = soDigitos(params.cnpj).padStart(14, "0").slice(0, 14);
  const objeto = `${params.empresaId}/${cnpj14}-${Date.now()}.pfx`;
  const payloadCifrado = cifrarSegredo(params.pfxBuffer.toString("base64"));

  if (env.bucketConfigurado) {
    const res = await fetch(`${env.storageUrl}/storage/v1/object/${BUCKET_CERT}/${objeto}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.storageKey}`,
        apikey: env.storageKey,
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
      },
      body: Buffer.from(payloadCifrado, "utf8"),
    });
    if (res.ok) {
      return { certPath: `bucket://${BUCKET_CERT}/${objeto}`, pfxCifradoFallback: null, modo: "bucket" };
    }
  }

  return {
    certPath: `cofre://${params.empresaId}/${cnpj14}.pfx`,
    pfxCifradoFallback: payloadCifrado,
    modo: "cofre",
  };
}

export async function carregarPfxArmazenamento(fiscal: Record<string, unknown>): Promise<Buffer> {
  const certPath = String(fiscal.dfeCertPath ?? "");
  const env = ambienteDfeServidor();

  if (certPath.startsWith(`bucket://${BUCKET_CERT}/`) && env.bucketConfigurado) {
    const objeto = certPath.slice(`bucket://${BUCKET_CERT}/`.length);
    const res = await fetch(`${env.storageUrl}/storage/v1/object/${BUCKET_CERT}/${objeto}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.storageKey}`,
        apikey: env.storageKey,
      },
    });
    if (!res.ok) {
      throw new Error(`Falha ao ler certificado no bucket privado (HTTP ${res.status}).`);
    }
    const textoCifrado = (await res.text()).trim();
    const b64 = textoCifrado.startsWith("v1:") ? decifrarSegredo(textoCifrado) : Buffer.from(textoCifrado).toString("base64");
    return Buffer.from(b64, "base64");
  }

  const cofre = String(fiscal.dfePfxCifrado ?? "");
  if (!cofre) {
    throw new Error("Certificado A1 (.pfx) não encontrado. Envie o arquivo na aba Certificado A1.");
  }
  return Buffer.from(decifrarSegredo(cofre), "base64");
}

export async function removerPfxArmazenamento(fiscal: Record<string, unknown>): Promise<void> {
  const certPath = String(fiscal.dfeCertPath ?? "");
  const env = ambienteDfeServidor();
  if (certPath.startsWith(`bucket://${BUCKET_CERT}/`) && env.bucketConfigurado) {
    const objeto = certPath.slice(`bucket://${BUCKET_CERT}/`.length);
    await fetch(`${env.storageUrl}/storage/v1/object/${BUCKET_CERT}/${objeto}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.storageKey}`,
        apikey: env.storageKey,
      },
    }).catch(() => undefined);
  }
}

/* ---------------------------------------- inspeção e validação de PFX (A1) */

export type ResultadoInspecaoPfx =
  | {
      ok: true;
      titularExtraido: string;
      cnpjExtraido: string;
      aviso?: string;
    }
  | { ok: false; erro: string };

/** Valida estrutura ASN.1 PKCS#12 e senha do certificado A1 (.pfx / .p12) */
export function inspecionarPfx(pfxBuffer: Buffer, senha: string): ResultadoInspecaoPfx {
  if (!pfxBuffer || pfxBuffer.length < 128) {
    return { ok: false, erro: "Arquivo .pfx inválido ou vazio." };
  }
  if (pfxBuffer.length > 250 * 1024) {
    return { ok: false, erro: "O certificado A1 (.pfx) deve ter no máximo 250 KB." };
  }
  if (pfxBuffer[0] !== 0x30) {
    return { ok: false, erro: "O arquivo enviado não é um certificado PKCS#12 (.pfx / .p12) válido." };
  }
  if (!senha) {
    return { ok: false, erro: "Informe a senha do certificado A1." };
  }

  // Extrai possível titular ICP-Brasil "RAZAO SOCIAL:12345678000199" presente nos atributos visíveis do PFX
  const ascii = pfxBuffer.toString("latin1").replace(/[^\x20-\x7EÀ-ÿ]/g, " ");
  const matchIcp = ascii.match(/([A-Z0-9][A-Z0-9 .,&/-]{3,60}):(\d{14})/);
  const titularExtraido = matchIcp ? matchIcp[1].trim() : "";
  const cnpjCand = matchIcp ? matchIcp[2] : "";
  const cnpjExtraido = cnpjCand && validarCnpj(cnpjCand) ? cnpjCand : "";

  try {
    tls.createSecureContext({ pfx: pfxBuffer, passphrase: senha });
    return { ok: true, titularExtraido, cnpjExtraido };
  } catch (e) {
    const code = (e as { code?: string })?.code || "";
    const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();

    if (msg.includes("mac verify failure") || msg.includes("bad decrypt") || msg.includes("pkcs12 cipherfinal")) {
      return { ok: false, erro: "Senha do certificado A1 incorreta." };
    }

    // Certificados A1 ICP-Brasil antigos com RC2-40-CBC no OpenSSL 3 sem legacy provider
    if (code === "ERR_OSSL_UNSUPPORTED" || msg.includes("unsupported")) {
      // OID 1.2.840.113549.1.7.1 (PKCS#7 data dentro de PKCS#12)
      const oidPkcs7 = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07]);
      if (!pfxBuffer.includes(oidPkcs7)) {
        return { ok: false, erro: "Estrutura PKCS#12 não reconhecida." };
      }
      return {
        ok: true,
        titularExtraido,
        cnpjExtraido,
        aviso: "Certificado A1 com cifra ICP-Brasil legada (RC2): armazenado cifrado para uso pelo worker mTLS.",
      };
    }

    return { ok: false, erro: `Não foi possível abrir o certificado A1: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}` };
  }
}

/* ----------------------------------------- docZip (GZIP + Base64) e XML */

export function zipDocZip(xml: string): string {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function unzipDocZip(base64Gzip: string): string {
  const limpo = String(base64Gzip || "").replace(/\s+/g, "");
  return gunzipSync(Buffer.from(limpo, "base64")).toString("utf8");
}

function extrairTagXml(xml: string, tag: string): string {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function extrairBlocoXml(xml: string, tag: string): string {
  const re = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${tag}>`, "i");
  return xml.match(re)?.[0] ?? "";
}

export type DocExtraidoSefaz = {
  nsu: string;
  schema: string;
  chave: string;
  numero: string;
  serie: string;
  emitenteCnpj: string;
  emitenteNome: string;
  valorTotal: number;
  dataEmissao: string;
  statusManifesto: StatusManifesto;
  temXmlCompleto: boolean;
  xml: string;
  xmlZip: string;
};

export function classificarXmlFiscal(xml: string, schemaHint = ""): Omit<DocExtraidoSefaz, "nsu" | "xml" | "xmlZip"> {
  const infMatch = xml.match(/<(?:\w+:)?infNFe\b([^>]*)>/i);
  if (infMatch) {
    const idAttr = infMatch[1].match(/\bId\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const chave = soDigitos(idAttr).slice(-44) || soDigitos(extrairTagXml(xml, "chNFe")).slice(0, 44);
    const ide = extrairBlocoXml(xml, "ide") || xml;
    const emit = extrairBlocoXml(xml, "emit") || xml;
    const tot = extrairBlocoXml(xml, "ICMSTot") || xml;
    const dh = extrairTagXml(ide, "dhEmi") || extrairTagXml(ide, "dEmi");
    return {
      schema: schemaHint || "procNFe_v4.00.xsd",
      chave,
      numero: extrairTagXml(ide, "nNF") || String(Number(chave.slice(25, 34)) || 0),
      serie: extrairTagXml(ide, "serie") || String(Number(chave.slice(22, 25)) || 1),
      emitenteCnpj: soDigitos(extrairTagXml(emit, "CNPJ") || extrairTagXml(emit, "CPF")),
      emitenteNome: extrairTagXml(emit, "xNome") || "FORNECEDOR",
      valorTotal: round2(Number(extrairTagXml(tot, "vNF") || extrairTagXml(tot, "vProd") || 0)),
      dataEmissao: dh ? dh.slice(0, 10) : new Date().toISOString().slice(0, 10),
      statusManifesto: "pendente",
      temXmlCompleto: true,
    };
  }

  const resBloco = extrairBlocoXml(xml, "resNFe");
  if (resBloco) {
    const chave = soDigitos(extrairTagXml(resBloco, "chNFe")).slice(0, 44);
    const dh = extrairTagXml(resBloco, "dhEmi");
    return {
      schema: schemaHint || "resNFe_v1.01.xsd",
      chave,
      numero: chave.length === 44 ? String(Number(chave.slice(25, 34))) : "0",
      serie: chave.length === 44 ? String(Number(chave.slice(22, 25))) : "1",
      emitenteCnpj: soDigitos(extrairTagXml(resBloco, "CNPJ") || extrairTagXml(resBloco, "CPF")),
      emitenteNome: extrairTagXml(resBloco, "xNome") || "EMITENTE (RESUMO)",
      valorTotal: round2(Number(extrairTagXml(resBloco, "vNF") || 0)),
      dataEmissao: dh ? dh.slice(0, 10) : new Date().toISOString().slice(0, 10),
      statusManifesto: "resumo",
      temXmlCompleto: false,
    };
  }

  const chaveEvt = soDigitos(extrairTagXml(xml, "chNFe")).slice(0, 44);
  const dhEvt = extrairTagXml(xml, "dhEvento");
  return {
    schema: schemaHint || "procEventoNFe_v1.00.xsd",
    chave: chaveEvt,
    numero: chaveEvt.length === 44 ? String(Number(chaveEvt.slice(25, 34))) : "0",
    serie: chaveEvt.length === 44 ? String(Number(chaveEvt.slice(22, 25))) : "1",
    emitenteCnpj: soDigitos(extrairTagXml(xml, "CNPJ") || extrairTagXml(xml, "CPF")),
    emitenteNome: extrairTagXml(xml, "xEvento") || "EVENTO FISCAL SEFAZ",
    valorTotal: 0,
    dataEmissao: dhEvt ? dhEvt.slice(0, 10) : new Date().toISOString().slice(0, 10),
    statusManifesto: "pendente",
    temXmlCompleto: false,
  };
}

/** Extrai cStat, xMotivo, ultNSU, maxNSU e descompacta todos os <docZip> do retorno SOAP */
export function extrairRetornoDist(soapXml: string): {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  docs: DocExtraidoSefaz[];
} {
  const ret = extrairBlocoXml(soapXml, "retDistDFeInt");
  if (!ret) {
    return {
      cStat: "0",
      xMotivo: "retDistDFeInt ausente no retorno SOAP da SEFAZ",
      ultNSU: "000000000000000",
      maxNSU: "000000000000000",
      docs: [],
    };
  }

  const cStat = extrairTagXml(ret, "cStat") || "0";
  const xMotivo = extrairTagXml(ret, "xMotivo") || "Sem motivo informado";
  const ultNSU = padNsu(extrairTagXml(ret, "ultNSU"));
  const maxNSU = padNsu(extrairTagXml(ret, "maxNSU"));

  const docs: DocExtraidoSefaz[] = [];
  const regexZip = /<(?:\w+:)?docZip\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?docZip>/gi;
  let match: RegExpExecArray | null;
  while ((match = regexZip.exec(ret)) !== null) {
    const attrs = match[1] || "";
    const b64 = (match[2] || "").trim();
    if (!b64) continue;
    const nsu = padNsu(attrs.match(/\bNSU\s*=\s*["']([^"']+)["']/i)?.[1] ?? "0");
    const schema = attrs.match(/\bschema\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    try {
      const xml = unzipDocZip(b64);
      const info = classificarXmlFiscal(xml, schema);
      docs.push({
        nsu,
        xml,
        xmlZip: zipDocZip(xml),
        ...info,
      });
    } catch {
      // ignora docZip corrompido isoladamente sem abortar o lote
    }
  }

  return { cStat, xMotivo, ultNSU, maxNSU, docs };
}

/* -------------------------------------------- envio SOAP via Worker mTLS */

export async function enviarSoapSefazMtls(params: {
  url: string;
  soapXml: string;
  pfxBuffer: Buffer;
  passphrase: string;
}): Promise<string> {
  const env = ambienteDfeServidor();

  if (env.workerConfigurado) {
    const res = await fetch(`${env.workerUrl}/sefaz-soap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dfe-worker-secret": env.workerSecret,
      },
      body: JSON.stringify({
        url: params.url,
        soapXml: params.soapXml,
        soapAction: SOAP_ACTION_DIST,
        pfxBase64: params.pfxBuffer.toString("base64"),
        passphrase: params.passphrase,
      }),
    });
    const dados = (await res.json().catch(() => ({}))) as { xml?: string; erro?: string };
    if (!res.ok || !dados.xml) {
      throw new Error(dados.erro || `Worker mTLS retornou HTTP ${res.status}`);
    }
    return dados.xml;
  }

  if (env.modoEnv === "direct") {
    return await new Promise<string>((resolve, reject) => {
      const u = new URL(params.url);
      const req = https.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: "POST",
          pfx: params.pfxBuffer,
          passphrase: params.passphrase,
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8",
            SOAPAction: SOAP_ACTION_DIST,
            "Content-Length": Buffer.byteLength(params.soapXml, "utf8"),
          },
          timeout: 45_000,
        },
        (resp) => {
          const pedacos: Buffer[] = [];
          resp.on("data", (c: Buffer) => pedacos.push(c));
          resp.on("end", () => {
            const txt = Buffer.concat(pedacos).toString("utf8");
            if ((resp.statusCode ?? 500) >= 400) {
              reject(new Error(`SEFAZ HTTP ${resp.statusCode}: ${txt.slice(0, 240)}`));
            } else {
              resolve(txt);
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Tempo limite excedido ao consultar a SEFAZ (45s)."));
      });
      req.write(params.soapXml, "utf8");
      req.end();
    });
  }

  throw new Error(
    "Modo live ativo, mas DFE_MTLS_WORKER_URL não está configurado. Defina a URL do worker mTLS ou use modo demo.",
  );
}

/* -------------------------------------- gerador SOAP Demo realista (v4.00) */

const FORNECEDORES_DFE_DEMO = [
  { nome: "DISTRIBUIDORA NORTE SUL LTDA", cnpj: "04583620000151" },
  { nome: "ATACADAO AMAZONIA ALIMENTOS S.A.", cnpj: "11222333000181" },
  { nome: "INDUSTRIA DE BEBIDAS RIO MADEIRA LTDA", cnpj: "33000167000101" },
  { nome: "COMERCIAL HIGIENE & LIMPEZA OESTE LTDA", cnpj: "60746948000112" },
];

const CATALOGO_DFE_DEMO = [
  { nome: "ARROZ TIPO 1 5KG", ncm: "10063021", cfop: "5102", un: "PC", qtd: 20, custo: 22.15, gtin: gerarGtin(1001) },
  { nome: "FEIJAO CARIOCA TIPO 1 1KG", ncm: "07133399", cfop: "5102", un: "UN", qtd: 30, custo: 7.1, gtin: gerarGtin(1002) },
  { nome: "OLEO DE SOJA 900ML", ncm: "15079011", cfop: "5102", un: "UN", qtd: 24, custo: 6.25, gtin: gerarGtin(1003) },
  { nome: "CAFE TOSTADO 500G", ncm: "09012100", cfop: "5102", un: "UN", qtd: 16, custo: 12.2, gtin: gerarGtin(1005) },
  { nome: "LEITE UHT 1L", ncm: "04012010", cfop: "5102", un: "UN", qtd: 48, custo: 4.3, gtin: gerarGtin(1006) },
  { nome: "DETERGENTE 500ML", ncm: "34025000", cfop: "5102", un: "UN", qtd: 36, custo: 2.25, gtin: gerarGtin(1014) },
];

export function montarXmlNfeDemo(params: {
  chave?: string;
  ufDest: string;
  cnpjDest: string;
  nomeDest: string;
  indice: number;
  dataIso?: string;
}): { chave: string; xml: string; numeroNota: number; fornecedor: string; cnpjFornecedor: string; total: number } {
  const forn = FORNECEDORES_DFE_DEMO[params.indice % FORNECEDORES_DFE_DEMO.length];
  const numeroNota = 4100 + params.indice;
  const hoje = params.dataIso || new Date().toISOString().slice(0, 10);
  const aamm = `${hoje.slice(2, 4)}${hoje.slice(5, 7)}`;
  const chave =
    params.chave && validarChaveAcesso(params.chave)
      ? soDigitos(params.chave)
      : gerarChave({
          uf: UF_NUMERO[params.ufDest] || "11",
          aamm,
          cnpj: forn.cnpj,
          modelo: "55",
          serie: "1",
          numeroNota,
        });

  const itemA = CATALOGO_DFE_DEMO[params.indice % CATALOGO_DFE_DEMO.length];
  const itemB = CATALOGO_DFE_DEMO[(params.indice + 2) % CATALOGO_DFE_DEMO.length];
  const escolhidos = [itemA, itemB];
  const vProd = round2(escolhidos.reduce((s, i) => s + i.qtd * i.custo, 0));
  const vFrete = round2(vProd * 0.03);
  const vNF = round2(vProd + vFrete);

  const dets = escolhidos
    .map(
      (it, idx) =>
        `<det nItem="${idx + 1}"><prod>` +
        `<cProd>DF${100 + idx}</cProd><cEAN>${it.gtin}</cEAN><xProd>${it.nome}</xProd>` +
        `<NCM>${it.ncm}</NCM><CFOP>${it.cfop}</CFOP><uCom>${it.un}</uCom>` +
        `<qCom>${it.qtd.toFixed(4)}</qCom><vUnCom>${it.custo.toFixed(4)}</vUnCom><vProd>${round2(it.qtd * it.custo).toFixed(2)}</vProd>` +
        `<cEANTrib>${it.gtin}</cEANTrib><uTrib>${it.un}</uTrib><qTrib>${it.qtd.toFixed(4)}</qTrib><vUnTrib>${it.custo.toFixed(4)}</vUnTrib>` +
        `</prod></det>`,
    )
    .join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="${NS_NFE}" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">` +
    `<ide><cUF>${UF_NUMERO[params.ufDest] || "11"}</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>${numeroNota}</nNF><dhEmi>${hoje}T09:30:00-04:00</dhEmi><tpNF>1</tpNF><tpAmb>2</tpAmb></ide>` +
    `<emit><CNPJ>${forn.cnpj}</CNPJ><xNome>${forn.nome}</xNome></emit>` +
    `<dest><CNPJ>${soDigitos(params.cnpjDest).padStart(14, "0")}</CNPJ><xNome>${params.nomeDest}</xNome></dest>` +
    dets +
    `<total><ICMSTot><vProd>${vProd.toFixed(2)}</vProd><vFrete>${vFrete.toFixed(2)}</vFrete><vNF>${vNF.toFixed(2)}</vNF></ICMSTot></total>` +
    `</infNFe></NFe></nfeProc>`;

  return { chave, xml, numeroNota, fornecedor: forn.nome, cnpjFornecedor: forn.cnpj, total: vNF };
}

export function montarXmlResumoDemo(params: {
  ufDest: string;
  indice: number;
  dataIso?: string;
}): { chave: string; xml: string; fornecedor: string; cnpjFornecedor: string; total: number } {
  const forn = FORNECEDORES_DFE_DEMO[(params.indice + 1) % FORNECEDORES_DFE_DEMO.length];
  const numeroNota = 5200 + params.indice;
  const hoje = params.dataIso || new Date().toISOString().slice(0, 10);
  const aamm = `${hoje.slice(2, 4)}${hoje.slice(5, 7)}`;
  const chave = gerarChave({
    uf: UF_NUMERO[params.ufDest] || "11",
    aamm,
    cnpj: forn.cnpj,
    modelo: "55",
    serie: "1",
    numeroNota,
  });
  const total = round2(640 + (params.indice % 5) * 185.4);
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<resNFe xmlns="${NS_NFE}" versao="1.01">` +
    `<chNFe>${chave}</chNFe><CNPJ>${forn.cnpj}</CNPJ><xNome>${forn.nome}</xNome>` +
    `<IE>000000014</IE><dhEmi>${hoje}T11:15:00-04:00</dhEmi><tpNF>1</tpNF>` +
    `<vNF>${total.toFixed(2)}</vNF><cSitNFe>1</cSitNFe>` +
    `</resNFe>`;
  return { chave, xml, fornecedor: forn.nome, cnpjFornecedor: forn.cnpj, total };
}

export function gerarSoapDemoDist(params: {
  cnpjDest: string;
  nomeDest: string;
  ufDest: string;
  ultNsu: string;
  ambiente: 1 | 2;
  chaveEspecifica?: string;
}): string {
  const baseNsu = Number(soDigitos(params.ultNsu) || "0");
  const nsu1 = padNsu(baseNsu + 1);
  const nfe = montarXmlNfeDemo({
    chave: params.chaveEspecifica,
    ufDest: params.ufDest,
    cnpjDest: params.cnpjDest,
    nomeDest: params.nomeDest,
    indice: baseNsu + 1,
  });
  const docZip1 = `<docZip NSU="${nsu1}" schema="procNFe_v4.00.xsd">${zipDocZip(nfe.xml)}</docZip>`;

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDistDFeInteresseResponse xmlns="${NS_WSDL_DIST}"><nfeDistDFeInteresseResult>` +
    `<retDistDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>${params.ambiente}</tpAmb><cStat>138</cStat><xMotivo>Documento(s) localizado(s) no Ambiente Nacional (DEMO)</xMotivo>` +
    `<dhResp>${new Date().toISOString()}</dhResp>` +
    `<ultNSU>${nsu1}</ultNSU><maxNSU>${nsu1}</maxNSU>` +
    `<loteDistDFeInt>${docZip1}</loteDistDFeInt>` +
    `</retDistDFeInt>` +
    `</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse>` +
    `</soap:Body></soap:Envelope>`
  );
}

/* ------------------------------------- leitura/gravação da fila DF-e jsonb */

export function lerDocumentosDfeFiscal(fiscal: Record<string, unknown>, descompactarXml = false): DfeDocumento[] {
  const brutos = Array.isArray(fiscal.dfeDocumentos) ? (fiscal.dfeDocumentos as DfeDocumento[]) : [];
  return brutos.map((d) => {
    let xml: string | undefined;
    if (descompactarXml && d.xmlZip) {
      try {
        xml = unzipDocZip(d.xmlZip);
      } catch {
        xml = undefined;
      }
    }
    return {
      ...d,
      nsu: padNsu(d.nsu),
      xml,
    };
  });
}

/* ------------------------------------ execução da captura por empresaRow */

export async function executarCapturaDfeEmpresa(
  empresa: EmpresaRow,
  opcoes?: { chave?: string; forcarDemo?: boolean },
): Promise<{
  ok: true;
  modo: "live" | "demo";
  cStat: string;
  xMotivo: string;
  novos: number;
  ultNSU: string;
  maxNSU: string;
} | { ok: false; erro: string }> {
  const fiscal = (empresa.fiscal ?? {}) as Record<string, unknown>;
  const env = ambienteDfeServidor();
  const ambiente = (Number(fiscal.ambiente ?? 2) === 1 ? 1 : 2) as 1 | 2;
  const ultNsuAtual = padNsu(String(fiscal.dfeUltimoNsu ?? "0"));
  const maxNsuAtual = padNsu(String(fiscal.dfeMaxNsu ?? ultNsuAtual));
  const temCert = Boolean(fiscal.dfeSenhaCifrada && (fiscal.dfeCertPath || fiscal.dfePfxCifrado));

  const usarLive =
    !opcoes?.forcarDemo &&
    env.modoLiveSolicitado &&
    temCert &&
    (env.workerConfigurado || env.modoEnv === "direct");

  if (!opcoes?.forcarDemo && env.modoLiveSolicitado && !temCert) {
    return { ok: false, erro: "Modo live ativo: envie primeiro o Certificado Digital A1 (.pfx) e a senha." };
  }

  // Proteção contra cStat 656 (Consumo Indevido) no modo live quando não há lotes pendentes
  const ultimaIso = String(fiscal.dfeUltimaConsultaEm ?? "");
  if (usarLive && ultimaIso && ultNsuAtual === maxNsuAtual && !opcoes?.chave) {
    const decorrido = Date.now() - new Date(ultimaIso).getTime();
    if (Number.isFinite(decorrido) && decorrido < MIN_INTERVALO_DFE_MS) {
      const restam = Math.ceil((MIN_INTERVALO_DFE_MS - decorrido) / 1000);
      return {
        ok: false,
        erro: `Aguarde ${restam}s antes de nova consulta à SEFAZ para evitar bloqueio cStat 656 (Consumo Indevido).`,
      };
    }
  }

  let soapResposta = "";
  let modoUsado: "live" | "demo" = "demo";

  if (usarLive) {
    modoUsado = "live";
    const pfxBuffer = await carregarPfxArmazenamento(fiscal);
    const passphrase = decifrarSegredo(String(fiscal.dfeSenhaCifrada));
    const soapEnvio = opcoes?.chave
      ? buildSoapConsChNFe(empresa.cnpj, opcoes.chave, ambiente)
      : buildSoapDistNsu(empresa.cnpj, ultNsuAtual, ambiente);
    soapResposta = await enviarSoapSefazMtls({
      url: sefazDistUrl(ambiente),
      soapXml: soapEnvio,
      pfxBuffer,
      passphrase,
    });
  } else {
    soapResposta = gerarSoapDemoDist({
      cnpjDest: empresa.cnpj,
      nomeDest: empresa.nome,
      ufDest: empresa.uf || "RO",
      ultNsu: ultNsuAtual,
      ambiente,
      chaveEspecifica: opcoes?.chave,
    });
  }

  const ret = extrairRetornoDist(soapResposta);
  const atuais = lerDocumentosDfeFiscal(fiscal, false);
  const chavesVistas = new Set(atuais.map((d) => d.chave).filter(Boolean));
  const nsusVistos = new Set(atuais.map((d) => `${d.nsu}|${d.schema}`));

  const inseridos: DfeDocumento[] = [];
  for (const doc of ret.docs) {
    if (doc.chave && chavesVistas.has(doc.chave) && doc.temXmlCompleto) {
      // Atualiza resumo existente se agora chegou o procNFe completo
      const idx = atuais.findIndex((a) => a.chave === doc.chave && !a.temXmlCompleto);
      if (idx >= 0) {
        atuais[idx] = {
          ...atuais[idx],
          schema: doc.schema,
          temXmlCompleto: true,
          xmlZip: doc.xmlZip,
          valorTotal: doc.valorTotal || atuais[idx].valorTotal,
          emitenteNome: doc.emitenteNome || atuais[idx].emitenteNome,
        };
        inseridos.push(atuais[idx]);
      }
      continue;
    }
    if ((doc.chave && chavesVistas.has(doc.chave)) || nsusVistos.has(`${doc.nsu}|${doc.schema}`)) {
      continue;
    }
    const novo: DfeDocumento = {
      id: randomUUID(),
      nsu: doc.nsu,
      chave: doc.chave,
      numero: doc.numero,
      serie: doc.serie,
      schema: doc.schema,
      emitenteNome: doc.emitenteNome,
      emitenteCnpj: doc.emitenteCnpj,
      valorTotal: doc.valorTotal,
      dataEmissao: doc.dataEmissao,
      statusManifesto: doc.statusManifesto,
      temXmlCompleto: doc.temXmlCompleto,
      xmlZip: doc.xmlZip,
      importadoErp: false,
      entradaId: null,
      capturadoEm: new Date().toISOString(),
    };
    inseridos.unshift(novo);
    if (doc.chave) chavesVistas.add(doc.chave);
    nsusVistos.add(`${doc.nsu}|${doc.schema}`);
  }

  const proximoUltNsu =
    ret.cStat === "137" || ret.cStat === "138"
      ? padNsu(Math.max(Number(ultNsuAtual), Number(ret.ultNSU)))
      : ultNsuAtual;
  const proximoMaxNsu = padNsu(Math.max(Number(maxNsuAtual), Number(ret.maxNSU), Number(proximoUltNsu)));

  const listaFinal = [...inseridos, ...atuais].slice(0, MAX_DOCS_GUARDADOS);

  await db
    .update(empresas)
    .set({
      fiscal: {
        ...fiscal,
        dfeUltimoNsu: proximoUltNsu,
        dfeMaxNsu: proximoMaxNsu,
        dfeUltimaConsultaEm: new Date().toISOString(),
        dfeUltimoCstat: ret.cStat,
        dfeUltimoXmotivo: ret.xMotivo,
        dfeDocumentos: listaFinal,
      },
    })
    .where(eq(empresas.id, empresa.id));

  return {
    ok: true,
    modo: modoUsado,
    cStat: ret.cStat,
    xMotivo: ret.xMotivo,
    novos: inseridos.length,
    ultNSU: proximoUltNsu,
    maxNSU: proximoMaxNsu,
  };
}
