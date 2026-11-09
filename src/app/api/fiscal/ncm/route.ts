import { contexto } from "@/lib/session";
import { temPermissao } from "@/lib/permissoes";
import { atualizarNcm, consultarNcm } from "@/server/ncmCore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const responder = (dados: unknown, status = 200) => Response.json(dados, { status, headers });

/** Somente leitura; não dispara rede externa. Empresa sempre vem da sessão. */
export async function GET(request: Request) {
  try {
    const c = await contexto();
    if (!c) return responder({ ok: false, erro: "Sessão expirada. Entre novamente." }, 401);
    const podeAtualizar = temPermissao(c.usuario.papel, "config.gerenciar");
    if (!podeAtualizar && !temPermissao(c.usuario.papel, "cadastros.produtos")) return responder({ ok: false, erro: "Sem permissão para consultar NCM no cadastro." }, 403);
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const p = params.get("pagina") ?? "1";
    if ([...params.keys()].some((k) => !["q", "pagina"].includes(k)) || q.length > 80 || !/^[1-9]\d{0,3}$/.test(p) || Number(p) > 2000) return responder({ ok: false, erro: "Informe uma busca de até 80 caracteres e uma página válida." }, 400);
    return responder({ ok: true, dados: await consultarNcm(c.empresaId, q, Number(p), podeAtualizar) });
  } catch {
    return responder({ ok: false, erro: "Consulta NCM indisponível. Preserve o código atual ou informe-o manualmente com orientação contábil. Nenhum código foi validado oficialmente." }, 503);
  }
}

/** Atualização explícita, administrativa e auditada; não recebe fonte, URL, empresa ou códigos. */
export async function POST(request: Request) {
  try {
    const c = await contexto();
    if (!c) return responder({ ok: false, erro: "Sessão expirada. Entre novamente." }, 401);
    if (!temPermissao(c.usuario.papel, "config.gerenciar")) return responder({ ok: false, erro: "Somente quem gerencia a configuração pode atualizar o catálogo." }, 403);
    const origin = request.headers.get("origin");
    let mesmaOrigem = false;
    try { mesmaOrigem = !!origin && new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); } catch { /* inválida */ }
    if (!mesmaOrigem || request.headers.get("x-nkway-ncm") !== "atualizar" || request.headers.get("sec-fetch-site") === "cross-site") return responder({ ok: false, erro: "Atualização permitida somente pela tela da aplicação." }, 403);
    if (new URL(request.url).search) return responder({ ok: false, erro: "A atualização não aceita parâmetros." }, 400);
    // Corpo opcional vazio: leitura limitada evita aceitar um catálogo/URL enviado pelo cliente.
    if (request.body) {
      const reader = request.body.getReader(); let bytes = 0; const partes: Uint8Array[] = [];
      while (true) {
        const r = await reader.read(); if (r.done) break;
        bytes += r.value.byteLength;
        if (bytes > 1024) { await reader.cancel(); return responder({ ok: false, erro: "A atualização não aceita dados de catálogo." }, 413); }
        partes.push(r.value);
      }
      const corpo = Buffer.concat(partes).toString("utf8").trim();
      if (corpo) {
        let dados: unknown; try { dados = JSON.parse(corpo); } catch { return responder({ ok: false, erro: "Corpo inválido." }, 400); }
        if (!dados || typeof dados !== "object" || Array.isArray(dados) || Object.keys(dados).length) return responder({ ok: false, erro: "A atualização não aceita dados de catálogo." }, 400);
      }
    }
    const resultado = await atualizarNcm(c);
    const status = resultado.estado === "falha" ? 502 : resultado.estado === "aguardar" ? 429 : resultado.estado === "em_atualizacao" ? 202 : 200;
    return responder({ ok: resultado.estado !== "falha", ...resultado }, status);
  } catch {
    return responder({ ok: false, erro: "Não foi possível atualizar o catálogo. Preserve o NCM atual e use o preenchimento manual orientado." }, 503);
  }
}
