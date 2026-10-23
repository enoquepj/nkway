/**
 * NKWAY · Edge Function `dfe-dist`
 * Distribuição DF-e — NfeDistDFeInteresse (NT 2014.002) v1.01
 *
 * Disparo: pg_cron / Schedule a cada 10 min, ou POST manual.
 * Auth: Authorization Bearer <service_role> + header x-dfe-cron-secret
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   DFE_CRON_SECRET
 *   DFE_SECRET          — mesma chave usada no pgcrypto (app.dfe_secret)
 *   DFE_SEFAZ_MODE      — "live" | "demo" (demo não chama SEFAZ)
 *
 * LIMITAÇÃO DE PLATAFORMA:
 * mTLS com A1 no runtime Deno/Supabase Edge é restrito. Este código:
 *  1) Monta o SOAP correto, controla NSU, descompacta docZip, grava XML.
 *  2) Tenta mTLS via Deno.createHttpClient quando disponível.
 *  3) Se mTLS nativo falhar, use o worker Node em
 *     `supabase/functions/dfe-dist/sefaz-mtls-worker.mjs` (Fly.io/Render)
 *     e defina DFE_MTLS_WORKER_URL.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as forge from "https://esm.sh/node-forge@1.3.1";
import { gunzipSync, gzipSync } from "https://esm.sh/fflate@0.8.2";

// ---------------------------------------------------------------------------
// Constantes SEFAZ — Ambiente Nacional (Distribuição DF-e)
// ---------------------------------------------------------------------------
const SEFAZ_AN_PROD =
  "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const SEFAZ_AN_HOM =
  "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";

const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_WSDL = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";

/** Intervalo mínimo entre lotes da MESMA empresa (cStat 656) — ms */
const MIN_INTERVALO_MS = 60_000;
/** Máximo de lotes por empresa por execução do cron */
const MAX_LOTES_POR_EMPRESA = 5;
/** Máximo de empresas por tick do cron */
const MAX_EMPRESAS_POR_TICK = 20;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
type EmpresaRow = {
  id: string;
  cnpj: string;
  razao_social: string;
  certificado_path: string | null;
  certificado_senha: string | null; // base64 do bytea via PostgREST às vezes
  ultimo_nsu: string;
  max_nsu: string;
  ambiente: 1 | 2;
  ativo: boolean;
  ultima_consulta_em: string | null;
};

type DocExtraido = {
  nsu: string;
  schema: string;
  xml: string;
  chave?: string;
  emitenteCnpj?: string;
  emitenteNome?: string;
  valorTotal?: number;
  dataEmissao?: string;
  statusManifesto: string;
};

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dfe-cron-secret",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 0), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function padNsu(nsu: string | number): string {
  return String(nsu ?? "0").replace(/\D/g, "").padStart(15, "0").slice(-15);
}

function textOf(el: Element | null, tag: string): string {
  if (!el) return "";
  const local = tag.includes(":") ? tag.split(":")[1] : tag;
  const found =
    el.getElementsByTagNameNS(NS_NFE, local)[0] ||
    el.getElementsByTagName(tag)[0] ||
    el.getElementsByTagName(local)[0];
  return found?.textContent?.trim() ?? "";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/** decodifica Base64 + GZIP da tag docZip */
function unzipDocZip(base64Gzip: string): string {
  const raw = b64ToBytes(base64Gzip);
  const plain = gunzipSync(raw);
  return bytesToUtf8(plain);
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

// ---------------------------------------------------------------------------
// SOAP NfeDistDFeInteresse v1.01 — distNSU
// ---------------------------------------------------------------------------
function buildSoapDistNsu(cnpj: string, ultNsu: string): string {
  const cnpj14 = onlyDigits(cnpj).padStart(14, "0");
  const nsu = padNsu(ultNsu);
  // cUFAutor 91 = Ambiente Nacional
  const distDFe = (
    `<distDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>1</tpAmb>` +
    `<cUFAutor>91</cUFAutor>` +
    `<CNPJ>${cnpj14}</CNPJ>` +
    `<distNSU><ultNSU>${nsu}</ultNSU></distNSU>` +
    `</distDFeInt>`
  ).replace(/>\s+</g, "><");

  // Envelope conforme WSDL NFeDistribuicaoDFe
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDistDFeInteresse xmlns="${NS_WSDL}">` +
    `<nfeDadosMsg>${distDFe}</nfeDadosMsg>` +
    `</nfeDistDFeInteresse>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function sefazUrl(ambiente: 1 | 2): string {
  return ambiente === 2 ? SEFAZ_AN_HOM : SEFAZ_AN_PROD;
}

// ---------------------------------------------------------------------------
// Certificado A1 (.pfx) → PEM cert + key (node-forge)
// ---------------------------------------------------------------------------
function pfxToPem(pfxBytes: Uint8Array, password: string): { certPem: string; keyPem: string } {
  const der = forge.util.createBuffer(
    String.fromCharCode(...pfxBytes) as string,
  );
  // forge espera binary string
  let binary = "";
  for (let i = 0; i < pfxBytes.length; i++) binary += String.fromCharCode(pfxBytes[i]);
  const p12Asn1 = forge.asn1.fromDer(binary);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ];
  const keyBags =
    p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag];

  if (!certBags?.length || !keyBags?.length) {
    throw new Error("Não foi possível extrair certificado/chave do PFX. Verifique a senha.");
  }

  const cert = certBags[0].cert;
  const key = keyBags[0].key;
  if (!cert || !key) throw new Error("PFX incompleto (cert/key ausentes).");

  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(key),
  };
}

// ---------------------------------------------------------------------------
// Envio SOAP com mTLS
// ---------------------------------------------------------------------------
async function sendSoapMtls(
  url: string,
  soapXml: string,
  certPem: string,
  keyPem: string,
): Promise<string> {
  const worker = Deno.env.get("DFE_MTLS_WORKER_URL")?.replace(/\/$/, "");
  if (worker) {
    const res = await fetch(`${worker}/sefaz-soap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dfe-worker-secret": Deno.env.get("DFE_MTLS_WORKER_SECRET") || "",
      },
      body: JSON.stringify({ url, soapXml, certPem, keyPem, soapAction: SOAP_ACTION }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || `Worker mTLS HTTP ${res.status}`);
    return data.xml as string;
  }

  // Tentativa nativa Deno (disponível em alguns runtimes self-hosted)
  const DenoAny = Deno as unknown as {
    createHttpClient?: (opts: { certChain?: string; privateKey?: string }) => unknown;
  };
  if (typeof DenoAny.createHttpClient === "function") {
    const client = DenoAny.createHttpClient({
      certChain: certPem,
      privateKey: keyPem,
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        // @ts-ignore client custom
        client,
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          SOAPAction: SOAP_ACTION,
        },
        body: soapXml,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`SEFAZ HTTP ${res.status}: ${text.slice(0, 300)}`);
      return text;
    } finally {
      // @ts-ignore
      client?.close?.();
    }
  }

  throw new Error(
    "mTLS com A1 não disponível neste runtime. Configure DFE_MTLS_WORKER_URL " +
      "(worker Node em supabase/functions/dfe-dist/sefaz-mtls-worker.mjs) " +
      "ou defina DFE_SEFAZ_MODE=demo para testes sem SEFAZ.",
  );
}

// ---------------------------------------------------------------------------
// Parse retorno distDFeInt + docZip
// ---------------------------------------------------------------------------
function extrairRetornoDist(soapXml: string): {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  docs: DocExtraido[];
} {
  const doc = parseXml(soapXml);
  // retDistDFeInt pode estar aninhado no Body
  const ret =
    doc.getElementsByTagNameNS(NS_NFE, "retDistDFeInt")[0] ||
    doc.getElementsByTagName("retDistDFeInt")[0];

  if (!ret) {
    return {
      cStat: "0",
      xMotivo: "retDistDFeInt ausente no retorno SOAP",
      ultNSU: "000000000000000",
      maxNSU: "000000000000000",
      docs: [],
    };
  }

  const cStat = textOf(ret, "cStat");
  const xMotivo = textOf(ret, "xMotivo");
  const ultNSU = padNsu(textOf(ret, "ultNSU"));
  const maxNSU = padNsu(textOf(ret, "maxNSU"));

  const docs: DocExtraido[] = [];
  const lote =
    ret.getElementsByTagNameNS(NS_NFE, "loteDistDFeInt")[0] ||
    ret.getElementsByTagName("loteDistDFeInt")[0];

  if (lote) {
    const zips = [
      ...Array.from(lote.getElementsByTagNameNS(NS_NFE, "docZip")),
      ...Array.from(lote.getElementsByTagName("docZip")),
    ];
    for (const z of zips) {
      const nsu = padNsu(z.getAttribute("NSU") || z.getAttribute("nsu") || "0");
      const schema = z.getAttribute("schema") || "";
      const b64 = (z.textContent || "").trim();
      if (!b64) continue;
      let xml = "";
      try {
        xml = unzipDocZip(b64);
      } catch (e) {
        console.error("Falha GZIP docZip NSU", nsu, e);
        continue;
      }
      const meta = parseDocumentoFiscal(xml, schema);
      docs.push({ nsu, schema: schema || meta.schema, xml, ...meta });
    }
  }

  return { cStat, xMotivo, ultNSU, maxNSU, docs };
}

function parseDocumentoFiscal(
  xml: string,
  schemaHint: string,
): Omit<DocExtraido, "nsu" | "xml"> {
  const d = parseXml(xml);
  const schema = schemaHint || "";

  // NF-e completa (procNFe / nfeProc)
  const inf =
    d.getElementsByTagNameNS(NS_NFE, "infNFe")[0] ||
    d.getElementsByTagName("infNFe")[0];
  if (inf) {
    const ide = inf.getElementsByTagNameNS(NS_NFE, "ide")[0] || inf.getElementsByTagName("ide")[0];
    const emit = inf.getElementsByTagNameNS(NS_NFE, "emit")[0] || inf.getElementsByTagName("emit")[0];
    const total = inf.getElementsByTagNameNS(NS_NFE, "ICMSTot")[0] || inf.getElementsByTagName("ICMSTot")[0];
    const idAttr = inf.getAttribute("Id") || "";
    const chave = onlyDigits(idAttr).slice(-44) || textOf(d.documentElement, "chNFe");
    const dhEmi = textOf(ide, "dhEmi") || textOf(ide, "dEmi");
    return {
      schema: schema || "procNFe",
      chave: chave.length === 44 ? chave : undefined,
      emitenteCnpj: onlyDigits(textOf(emit, "CNPJ") || textOf(emit, "CPF")),
      emitenteNome: textOf(emit, "xNome"),
      valorTotal: Number(textOf(total, "vNF") || "0") || undefined,
      dataEmissao: dhEmi || undefined,
      statusManifesto: "pendente",
    };
  }

  // Resumo NF-e (resNFe)
  const res =
    d.getElementsByTagNameNS(NS_NFE, "resNFe")[0] ||
    d.getElementsByTagName("resNFe")[0];
  if (res) {
    const chave = onlyDigits(textOf(res, "chNFe"));
    return {
      schema: schema || "resNFe",
      chave: chave.length === 44 ? chave : undefined,
      emitenteCnpj: onlyDigits(textOf(res, "CNPJ") || textOf(res, "CPF")),
      emitenteNome: textOf(res, "xNome"),
      valorTotal: Number(textOf(res, "vNF") || "0") || undefined,
      dataEmissao: textOf(res, "dhEmi") || undefined,
      statusManifesto: "resumo",
    };
  }

  // Eventos
  const chEvento = onlyDigits(textOf(d.documentElement, "chNFe"));
  return {
    schema: schema || "evento",
    chave: chEvento.length === 44 ? chEvento : undefined,
    statusManifesto: "pendente",
  };
}

// ---------------------------------------------------------------------------
// Demo (sem SEFAZ) — útil para validar gravação/NSU/UI
// ---------------------------------------------------------------------------
function uint8ToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function demoLote(cnpj: string, ult: string): string {
  const nsu = padNsu(Number(onlyDigits(ult) || "0") + 1);
  const base =
    "35" +
    "2603" +
    onlyDigits(cnpj).padStart(14, "0").slice(0, 14) +
    "55" +
    "001" +
    "000000001" +
    "1" +
    "12345678";
  // DV simplificado (demo)
  const chave = (base + "0").slice(0, 44).padEnd(44, "0");
  const xmlNfe =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<nfeProc xmlns="${NS_NFE}" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00">` +
    `<ide><dhEmi>${new Date().toISOString()}</dhEmi></ide>` +
    `<emit><CNPJ>12345678000190</CNPJ><xNome>FORNECEDOR DEMO DF-e</xNome></emit>` +
    `<dest><CNPJ>${onlyDigits(cnpj)}</CNPJ></dest>` +
    `<total><ICMSTot><vNF>1500.00</vNF></ICMSTot></total>` +
    `</infNFe></NFe></nfeProc>`;
  return buildDemoSoap(nsu, xmlNfe);
}

function buildDemoSoap(nsu: string, xml: string): string {
  const gz = gzipSync(new TextEncoder().encode(xml));
  const b64 = uint8ToB64(gz);
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
    `<nfeDistDFeInteresseResponse xmlns="${NS_WSDL}"><nfeDistDFeInteresseResult>` +
    `<retDistDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    `<tpAmb>1</tpAmb><cStat>138</cStat><xMotivo>Documento(s) localizado(s) DEMO</xMotivo>` +
    `<dhResp>${new Date().toISOString()}</dhResp>` +
    `<ultNSU>${nsu}</ultNSU><maxNSU>${nsu}</maxNSU>` +
    `<loteDistDFeInt>` +
    `<docZip NSU="${nsu}" schema="procNFe_v4.00.xsd">${b64}</docZip>` +
    `</loteDistDFeInt></retDistDFeInt>` +
    `</nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse>` +
    `</soap:Body></soap:Envelope>`
  );
}

// ---------------------------------------------------------------------------
// Processa uma empresa
// ---------------------------------------------------------------------------
async function processarEmpresa(
  sb: SupabaseClient,
  emp: EmpresaRow,
  mode: string,
): Promise<{ empresa: string; lotes: number; docs: number; cStat?: string; erro?: string }> {
  if (!emp.certificado_path && mode === "live") {
    return { empresa: emp.cnpj, lotes: 0, docs: 0, erro: "Sem certificado_path" };
  }

  // throttle local
  if (emp.ultima_consulta_em) {
    const elapsed = Date.now() - new Date(emp.ultima_consulta_em).getTime();
    if (elapsed < MIN_INTERVALO_MS) {
      return {
        empresa: emp.cnpj,
        lotes: 0,
        docs: 0,
        erro: `Aguardar ${Math.ceil((MIN_INTERVALO_MS - elapsed) / 1000)}s (anti-656)`,
      };
    }
  }

  let certPem = "";
  let keyPem = "";
  if (mode === "live") {
    const senha = await decryptPassword(sb, emp);
    const { data: file, error: dlErr } = await sb.storage
      .from("certificados-a1")
      .download(emp.certificado_path!);
    if (dlErr || !file) {
      return { empresa: emp.cnpj, lotes: 0, docs: 0, erro: `Storage: ${dlErr?.message || "arquivo ausente"}` };
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    try {
      const pem = pfxToPem(buf, senha);
      certPem = pem.certPem;
      keyPem = pem.keyPem;
    } catch (e) {
      return { empresa: emp.cnpj, lotes: 0, docs: 0, erro: `PFX: ${(e as Error).message}` };
    }
  }

  let ult = padNsu(emp.ultimo_nsu);
  let max = padNsu(emp.max_nsu);
  let lotes = 0;
  let docsGravados = 0;
  let lastStat = "";
  let lastMotivo = "";

  for (let i = 0; i < MAX_LOTES_POR_EMPRESA; i++) {
    lotes++;
    const soap = buildSoapDistNsu(emp.cnpj, ult);
    let respXml = "";
    try {
      if (mode === "demo") {
        respXml = demoLote(emp.cnpj, ult);
      } else {
        respXml = await sendSoapMtls(sefazUrl(emp.ambiente), soap, certPem, keyPem);
      }
    } catch (e) {
      await sb
        .from("empresas_config")
        .update({
          ultima_consulta_em: new Date().toISOString(),
          ultimo_cstat: "ERR",
          ultimo_xmotivo: (e as Error).message.slice(0, 500),
        })
        .eq("id", emp.id);
      return { empresa: emp.cnpj, lotes, docs: docsGravados, erro: (e as Error).message };
    }

    const ret = extrairRetornoDist(respXml);
    lastStat = ret.cStat;
    lastMotivo = ret.xMotivo;
    max = ret.maxNSU || max;

    // cStat relevantes:
    // 137 = nenhum documento
    // 138 = documento(s) localizado(s)
    // 656 = consumo indevido
    if (ret.cStat === "656") {
      await sb
        .from("empresas_config")
        .update({
          ultima_consulta_em: new Date().toISOString(),
          ultimo_cstat: ret.cStat,
          ultimo_xmotivo: ret.xMotivo,
        })
        .eq("id", emp.id);
      return {
        empresa: emp.cnpj,
        lotes,
        docs: docsGravados,
        cStat: ret.cStat,
        erro: "Consumo Indevido (656) — aguarde ~1h e reduza a frequência",
      };
    }

    for (const doc of ret.docs) {
      if (!doc.chave || doc.chave.length !== 44) {
        // ainda atualiza NSU mesmo sem chave parseável
        ult = doc.nsu > ult ? doc.nsu : ult;
        continue;
      }
      const { error: upErr } = await sb.from("nfe_entrada").upsert(
        {
          empresa_id: emp.id,
          cnpj_destinatario: emp.cnpj,
          chave_acesso: doc.chave,
          nsu: doc.nsu,
          schema_tipo: doc.schema || "procNFe",
          emitente_cnpj: doc.emitenteCnpj || null,
          emitente_nome: doc.emitenteNome || null,
          valor_total: doc.valorTotal ?? null,
          data_emissao: doc.dataEmissao || null,
          status_manifesto: doc.statusManifesto || "pendente",
          xml_bruto: doc.xml,
        },
        { onConflict: "chave_acesso", ignoreDuplicates: false },
      );
      if (!upErr) docsGravados++;
      if (doc.nsu > ult) ult = doc.nsu;
    }

    // avança ultNSU do retorno mesmo sem docs (137)
    if (ret.ultNSU > ult) ult = ret.ultNSU;

    await sb
      .from("empresas_config")
      .update({
        ultimo_nsu: ult,
        max_nsu: max,
        ultima_consulta_em: new Date().toISOString(),
        ultimo_cstat: ret.cStat,
        ultimo_xmotivo: ret.xMotivo,
      })
      .eq("id", emp.id);

    // 137 = fim; 138 com ult>=max = fim
    if (ret.cStat === "137") break;
    if (ret.cStat === "138" && ult >= max) break;
    if (ret.docs.length === 0 && ret.cStat !== "138") break;

    // pausa entre lotes da mesma empresa
    await new Promise((r) => setTimeout(r, MIN_INTERVALO_MS));
  }

  return { empresa: emp.cnpj, lotes, docs: docsGravados, cStat: lastStat, erro: lastMotivo };
}

async function decryptPassword(sb: SupabaseClient, emp: EmpresaRow): Promise<string> {
  // Preferência: RPC security definer; fallback se senha já vier decodificável (não recomendado)
  const { data, error } = await sb.rpc("dfe_decrypt_password", {
    cipher: emp.certificado_senha,
  });
  if (!error && typeof data === "string") return data;

  // Alternativa: Edge usa DFE_SECRET e decodifica bytea hex/base64
  const secret = Deno.env.get("DFE_SECRET") || "CHANGE_ME_DFE_SECRET_MIN_32_CHARS!!";
  if (!emp.certificado_senha) throw new Error("Senha do certificado ausente");

  // PostgREST devolve bytea como \xHEX
  const raw = String(emp.certificado_senha);
  let bytes: Uint8Array;
  if (raw.startsWith("\\x")) {
    const hex = raw.slice(2);
    bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  } else {
    bytes = b64ToBytes(raw);
  }

  // pgp_sym_decrypt via SQL é o caminho correto — se RPC falhou, erro explícito
  throw new Error(
    `Falha ao descriptografar senha A1 (rpc dfe_decrypt_password): ${error?.message || "sem dados"}. ` +
      `Confirme app.dfe_secret / DFE_SECRET. bytes=${bytes.length} secretLen=${secret.length}`,
  );
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("DFE_CRON_SECRET") || "";
    const hdr = req.headers.get("x-dfe-cron-secret") || "";
    const auth = req.headers.get("Authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    // Aceita: cron secret OU bearer service role
    const okCron = cronSecret && hdr === cronSecret;
    const okBearer = serviceKey && auth === `Bearer ${serviceKey}`;
    if (!okCron && !okBearer) {
      return json({ erro: "Não autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (!supabaseUrl || !serviceKey) {
      return json({ erro: "SUPABASE_URL / SERVICE_ROLE_KEY ausentes" }, 500);
    }

    const sb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const mode = (Deno.env.get("DFE_SEFAZ_MODE") || "demo").toLowerCase();
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const onlyCnpj = body?.cnpj ? onlyDigits(body.cnpj) : null;

    let q = sb
      .from("empresas_config")
      .select(
        "id,cnpj,razao_social,certificado_path,certificado_senha,ultimo_nsu,max_nsu,ambiente,ativo,ultima_consulta_em",
      )
      .eq("ativo", true)
      .order("ultima_consulta_em", { ascending: true, nullsFirst: true })
      .limit(MAX_EMPRESAS_POR_TICK);

    if (onlyCnpj) q = q.eq("cnpj", onlyCnpj);

    const { data: empresas, error } = await q;
    if (error) return json({ erro: error.message }, 500);
    if (!empresas?.length) return json({ ok: true, msg: "Nenhuma empresa ativa", resultados: [] });

    const resultados = [];
    for (const emp of empresas as EmpresaRow[]) {
      const r = await processarEmpresa(sb, emp, mode);
      resultados.push(r);
    }

    return json({
      ok: true,
      mode,
      em: new Date().toISOString(),
      resultados,
    });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});
