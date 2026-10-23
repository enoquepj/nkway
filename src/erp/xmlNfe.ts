import { uid, type Entrada, type ItemEntrada } from "./types";

/**
 * Leitor de XML de NF-e (modelo 55) para entrada de mercadoria.
 * Lê o arquivo que o fornecedor envia e monta a nota de entrada,
 * exatamente como o lojista recebe da SEFAZ / do fornecedor.
 */

const txt = (el: Element | null | undefined, tag: string) =>
  el?.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";

const num = (el: Element | null | undefined, tag: string) => {
  const v = txt(el, tag);
  return v ? Number(v) : 0;
};

export type ResultadoXml =
  | { ok: true; entrada: Entrada }
  | { ok: false; erro: string };

export function lerXmlNfe(conteudo: string): ResultadoXml {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(conteudo, "text/xml");
  } catch {
    return { ok: false, erro: "Não foi possível ler o arquivo XML." };
  }

  if (doc.getElementsByTagName("parsererror").length)
    return { ok: false, erro: "XML inválido ou corrompido." };

  const infNFe = doc.getElementsByTagName("infNFe")[0];
  if (!infNFe)
    return {
      ok: false,
      erro: "Este arquivo não parece ser uma NF-e (tag infNFe não encontrada).",
    };

  const ide = infNFe.getElementsByTagName("ide")[0];
  const emit = infNFe.getElementsByTagName("emit")[0];
  const total = infNFe.getElementsByTagName("ICMSTot")[0];

  const chave = (infNFe.getAttribute("Id") ?? "").replace(/\D/g, "");

  const itens: ItemEntrada[] = Array.from(infNFe.getElementsByTagName("det")).map(
    (det) => {
      const prod = det.getElementsByTagName("prod")[0];
      const qtd = num(prod, "qCom");
      const vUnit = num(prod, "vUnCom");
      const nomeXml = txt(prod, "xProd");
      return {
        produtoId: null,
        nome: nomeXml,
        nomeFornecedor: nomeXml,
        sku: txt(prod, "cProd"),
        ncm: txt(prod, "NCM"),
        cfop: txt(prod, "CFOP"),
        unidade: txt(prod, "uCom") || "UN",
        qtd,
        qtdNota: qtd,
        custo: vUnit,
        // cEAN = código de barras do produto na NF-e ("SEM GTIN" vem como tal)
        gtin: (() => {
          const ean = txt(prod, "cEAN").replace(/\D/g, "");
          return ean.length === 13 ? ean : undefined;
        })(),
        // sugestão de preço de venda: custo + 80% de margem (ajustável na tela de tratamento)
        preco: Math.round(vUnit * 1.8 * 100) / 100,
      };
    },
  );

  if (itens.length === 0)
    return { ok: false, erro: "Nenhum produto encontrado no XML." };

  const emissaoRaw = txt(ide, "dhEmi") || txt(ide, "dEmi");

  const entrada: Entrada = {
    id: uid(),
    numeroNota: txt(ide, "nNF"),
    serie: txt(ide, "serie"),
    chave,
    fornecedor: txt(emit, "xNome"),
    cnpjFornecedor: formatCnpj(txt(emit, "CNPJ")),
    itens,
    total: num(total, "vNF") || itens.reduce((s, i) => s + i.qtd * i.custo, 0),
    emissao: emissaoRaw ? emissaoRaw.slice(0, 10) : new Date().toISOString().slice(0, 10),
    status: "pendente",
    origem: "xml",
    gerarFinanceiro: true,
  };

  return { ok: true, entrada };
}

export const formatCnpj = (c: string) =>
  c.length === 14
    ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
    : c;

/** XML de exemplo para o usuário testar a importação sem ter um arquivo real */
export const XML_EXEMPLO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe><infNFe Id="NFe35250945678901000123550010000123451000123456" versao="4.00">
    <ide><cUF>35</cUF><nNF>12345</nNF><serie>1</serie><dhEmi>2026-01-15T09:30:00-03:00</dhEmi></ide>
    <emit><CNPJ>45678901000123</CNPJ><xNome>Textil Brasil Industria SA</xNome><IE>123456789</IE></emit>
    <det nItem="1"><prod>
      <cProd>CAM-001</cProd><xProd>Camiseta Basica Branca M</xProd><NCM>61091000</NCM>
      <CFOP>5102</CFOP><uCom>UN</uCom><qCom>50.0000</qCom><vUnCom>18.5000</vUnCom><vProd>925.00</vProd>
    </prod></det>
    <det nItem="2"><prod>
      <cProd>CAL-014</cProd><xProd>Calca Jeans Slim 42</xProd><NCM>62034200</NCM>
      <CFOP>5102</CFOP><uCom>UN</uCom><qCom>20.0000</qCom><vUnCom>62.0000</vUnCom><vProd>1240.00</vProd>
    </prod></det>
    <det nItem="3"><prod>
      <cProd>JAQ-055</cProd><xProd>Jaqueta Corta-Vento P</xProd><NCM>62019300</NCM>
      <CFOP>5102</CFOP><uCom>UN</uCom><qCom>15.0000</qCom><vUnCom>95.0000</vUnCom><vProd>1425.00</vProd>
    </prod></det>
    <total><ICMSTot><vNF>3590.00</vNF></ICMSTot></total>
  </infNFe></NFe>
</nfeProc>`;

/** Remove máscara da chave de acesso NF-e (44 dígitos) */
export function limparChaveNfe(chave: string): string {
  return (chave ?? "").replace(/\D/g, "");
}

export function validarChaveNfe(chave: string): boolean {
  return limparChaveNfe(chave).length === 44;
}

/** URL do bridge (servidor com certificado A1). Vazia = modo demo. */
export const nfeBridgeUrl = () =>
  (import.meta.env.VITE_NFE_BRIDGE_URL as string | undefined)?.replace(/\/$/, "").trim() || "";

export const nfeBridgeAtivo = () => nfeBridgeUrl().length > 0;

/**
 * Consulta NF-e pela chave de acesso (fluxo HOTLINE / portal SEFAZ).
 *
 * 1) Se VITE_NFE_BRIDGE_URL estiver definida → POST {url}/nfe/por-chave
 *    body JSON: { "chave": "44 dígitos" }
 *    resposta OK: { "xml": "..." }  |  erro: { "erro": "..." }
 * 2) Sem URL → MODO DEMO (XML de exemplo + dados extraídos da chave).
 *
 * O certificado A1 e a senha ficam SÓ no servidor do bridge — nunca no front.
 */
export async function importarPorChaveSefaz(chaveBruta: string): Promise<ResultadoXml> {
  const chave = limparChaveNfe(chaveBruta);
  if (chave.length !== 44) {
    return { ok: false, erro: "A chave de acesso deve ter 44 dígitos (com ou sem espaços)." };
  }

  const base = nfeBridgeUrl();
  if (base) {
    try {
      const res = await fetch(`${base}/nfe/por-chave`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ chave }),
      });
      const data = (await res.json().catch(() => ({}))) as { xml?: string; erro?: string; message?: string };
      if (!res.ok) {
        return {
          ok: false,
          erro: data.erro || data.message || `Bridge retornou HTTP ${res.status}. Verifique o servidor e o certificado A1.`,
        };
      }
      if (!data.xml || typeof data.xml !== "string") {
        return { ok: false, erro: "Bridge não devolveu o campo XML da NF-e." };
      }
      const lido = lerXmlNfe(data.xml);
      if (!lido.ok) return lido;
      return {
        ok: true,
        entrada: {
          ...lido.entrada,
          id: uid(),
          chave: limparChaveNfe(lido.entrada.chave) || chave,
          origem: "sefaz",
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "falha de rede";
      return {
        ok: false,
        erro: `Não foi possível contatar o bridge (${base}). ${msg}. Confira VITE_NFE_BRIDGE_URL e CORS.`,
      };
    }
  }

  // ---------- MODO DEMO (sem bridge) ----------
  await new Promise((r) => setTimeout(r, 700));
  const r = lerXmlNfe(XML_EXEMPLO);
  if (!r.ok) return r;
  const uf = chave.slice(0, 2);
  const aamm = chave.slice(2, 6);
  const cnpj = chave.slice(6, 20);
  const nNF = String(Number(chave.slice(25, 34)) || r.entrada.numeroNota);
  const serie = String(Number(chave.slice(22, 25)) || r.entrada.serie);
  return {
    ok: true,
    entrada: {
      ...r.entrada,
      id: uid(),
      chave,
      numeroNota: nNF,
      serie,
      cnpjFornecedor: formatCnpj(cnpj),
      emissao: aamm.length === 4
        ? `20${aamm.slice(0, 2)}-${aamm.slice(2, 4)}-01`
        : r.entrada.emissao,
      origem: "sefaz",
      fornecedor: r.entrada.fornecedor + (uf ? ` (UF ${uf} · DEMO)` : " · DEMO"),
    },
  };
}
