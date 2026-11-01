/**
 * Worker Node.js — mTLS com certificado A1 para SEFAZ.
 * Hospede em Fly.io / Render / Railway / VPS (Node 20+).
 * Para certificados ICP-Brasil antigos (RC2), inicie com:
 *   NODE_OPTIONS=--openssl-legacy-provider node sefaz-mtls-worker.mjs
 *
 * ENV:
 *   PORT=8787
 *   DFE_MTLS_WORKER_SECRET=string-secreta
 *
 * GET  /health      → { ok: true, servico: "nkway-dfe-mtls-worker" }
 * POST /sefaz-soap
 *   body (opção Next.js): { url, soapXml, pfxBase64, passphrase, soapAction }
 *   body (opção PEM):     { url, soapXml, certPem, keyPem, soapAction }
 *   resp: { xml } | { erro }
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function httpsSoapMtls({ url, soapXml, certPem, keyPem, pfxBase64, passphrase, soapAction }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const tlsOpts = pfxBase64
      ? { pfx: Buffer.from(pfxBase64, "base64"), passphrase: String(passphrase ?? "") }
      : { cert: certPem, key: keyPem };

    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        ...tlsOpts,
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
  if (req.method === "GET" && (req.url === "/health" || req.url?.startsWith("/health"))) {
    send(res, 200, { ok: true, servico: "nkway-dfe-mtls-worker" });
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
      const { url, soapXml, certPem, keyPem, pfxBase64, passphrase, soapAction } = body;
      const temCredencial = Boolean(pfxBase64 || (certPem && keyPem));
      if (!url || !soapXml || !temCredencial) {
        send(res, 400, { erro: "url, soapXml e credencial A1 (pfxBase64 ou certPem+keyPem) são obrigatórios" });
        return;
      }
      const xml = await httpsSoapMtls({ url, soapXml, certPem, keyPem, pfxBase64, passphrase, soapAction });
      send(res, 200, { xml });
      return;
    }

    if (req.url === "/nfe/por-chave" || req.url?.startsWith("/nfe/por-chave")) {
      send(res, 501, {
        erro:
          "Use o módulo DF-e do NKWAY (/dfe) + worker /sefaz-soap para distribuição DF-e (distNSU e consChNFe).",
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
