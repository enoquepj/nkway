/**
 * Worker Node.js — mTLS com certificado A1 para SEFAZ.
 * Hospede em Fly.io / Render / VPS (Node 20+).
 *
 * ENV:
 *   PORT=8787
 *   DFE_MTLS_WORKER_SECRET=string-secreta
 *
 * POST /sefaz-soap
 * body: { url, soapXml, certPem, keyPem, soapAction }
 * resp: { xml } | { erro }
 *
 * Também expõe POST /nfe/por-chave  { chave, certPem, keyPem, cnpj, ultNsu?, ambiente? }
 * para o contrato VITE_NFE_BRIDGE_URL do NKWAY (download pontual por chave via distNSU
 * é feito pela Edge; este endpoint opcional monta distNSU a partir do NSU 0 se necessário).
 */
import http from "node:http";
import https from "node:https";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.DFE_MTLS_WORKER_SECRET || "";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, x-dfe-worker-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  res.end(body);
}

function httpsSoapMtls({ url, soapXml, certPem, keyPem, soapAction }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        cert: certPem,
        key: keyPem,
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8",
          SOAPAction: soapAction || "",
          "Content-Length": Buffer.byteLength(soapXml, "utf8"),
        },
        timeout: 60000,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (resp.statusCode && resp.statusCode >= 400) {
            reject(new Error(`SEFAZ HTTP ${resp.statusCode}: ${text.slice(0, 400)}`));
          } else resolve(text);
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout SEFAZ"));
    });
    req.write(soapXml, "utf8");
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { erro: "Use POST" });
    return;
  }

  const hdr = req.headers["x-dfe-worker-secret"] || "";
  if (SECRET && hdr !== SECRET) {
    send(res, 401, { erro: "Não autorizado" });
    return;
  }

  try {
    const body = await readBody(req);
    if (req.url === "/sefaz-soap" || req.url?.startsWith("/sefaz-soap")) {
      const { url, soapXml, certPem, keyPem, soapAction } = body;
      if (!url || !soapXml || !certPem || !keyPem) {
        send(res, 400, { erro: "url, soapXml, certPem e keyPem são obrigatórios" });
        return;
      }
      const xml = await httpsSoapMtls({ url, soapXml, certPem, keyPem, soapAction });
      send(res, 200, { xml });
      return;
    }

    // Contrato do front NKWAY (VITE_NFE_BRIDGE_URL)
    if (req.url === "/nfe/por-chave" || req.url?.startsWith("/nfe/por-chave")) {
      send(res, 501, {
        erro:
          "Use a Edge Function dfe-dist + worker /sefaz-soap para distribuição DF-e. " +
          "Por-chave pontual: dispare a captura e leia nfe_entrada no Postgres, ou envie o XML via importação de arquivo.",
      });
      return;
    }

    send(res, 404, { erro: "Rota não encontrada" });
  } catch (e) {
    send(res, 500, { erro: e.message || String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`DFE mTLS worker on :${PORT}`);
});
