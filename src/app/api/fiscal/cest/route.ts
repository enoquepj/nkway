import { contexto } from "@/lib/session";
import { temPermissao } from "@/lib/permissoes";
import { consultarCest, gerenciarCest } from "@/server/cestCore";
import type { CodigoErroCest } from "@/lib/cest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie" };
const responder = (dados: unknown, status = 200) => Response.json(dados, { status, headers });
const STATUS_ERRO: Record<CodigoErroCest, number> = {
  registro_invalido: 400, duplicado: 409, limite_excedido: 413,
  nao_encontrado: 404, persistencia: 500, acesso_negado: 403,
};

/**
 * Somente leitura da referência LOCAL de CEST da empresa da sessão.
 * Nunca dispara rede externa e nunca lê outra empresa.
 */
export async function GET(request: Request) {
  try {
    const c = await contexto();
    if (!c) return responder({ ok: false, erro: "Sessão expirada. Entre novamente." }, 401);
    const podeGerenciar = temPermissao(c.usuario.papel, "config.gerenciar");
    if (!podeGerenciar && !temPermissao(c.usuario.papel, "cadastros.produtos")) return responder({ ok: false, erro: "Sem permissão para consultar CEST no cadastro." }, 403);
    const params = new URL(request.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const p = params.get("pagina") ?? "1";
    if ([...params.keys()].some((k) => !["q", "pagina"].includes(k)) || q.length > 80 || !/^[1-9]\d{0,3}$/.test(p) || Number(p) > 2000) return responder({ ok: false, erro: "Informe uma busca de até 80 caracteres e uma página válida." }, 400);
    return responder({ ok: true, dados: await consultarCest(c.empresaId, q, Number(p), podeGerenciar) });
  } catch {
    return responder({ ok: false, erro: "Consulta CEST indisponível. O valor atual do produto foi preservado; o preenchimento manual continua possível. Nada foi validado oficialmente." }, 503);
  }
}

/**
 * Cadastro/remoção explícita da referência local (somente config.gerenciar, pela tela da aplicação).
 * Não aceita URL, arquivo, empresa ou catálogo enviado pelo cliente — apenas campos declarados do registro.
 */
export async function POST(request: Request) {
  try {
    const c = await contexto();
    if (!c) return responder({ ok: false, erro: "Sessão expirada. Entre novamente." }, 401);
    if (!temPermissao(c.usuario.papel, "config.gerenciar")) return responder({ ok: false, erro: "Somente quem gerencia a configuração pode alterar a referência local de CEST." }, 403);
    const origin = request.headers.get("origin");
    let mesmaOrigem = false;
    try { mesmaOrigem = !!origin && new URL(origin).host === (request.headers.get("host") || new URL(request.url).host); } catch { /* inválida */ }
    if (!mesmaOrigem || request.headers.get("x-nkway-cest") !== "referencia" || request.headers.get("sec-fetch-site") === "cross-site") return responder({ ok: false, erro: "Alteração permitida somente pela tela da aplicação." }, 403);
    if (new URL(request.url).search) return responder({ ok: false, erro: "A alteração não aceita parâmetros de URL." }, 400);
    const texto = await request.text();
    if (texto.length > 8192) return responder({ ok: false, erro: "Payload acima do limite permitido." }, 413);
    let dados: unknown;
    try { dados = texto.trim() ? JSON.parse(texto) : null; } catch { return responder({ ok: false, erro: "Corpo inválido." }, 400); }
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) return responder({ ok: false, erro: "Informe a operação e o registro da referência local." }, 400);
    const entrada = dados as Record<string, unknown>;
    if (Object.keys(entrada).some((k) => ["url", "empresaId", "arquivo", "catalogo", "registros"].includes(k))) return responder({ ok: false, erro: "A referência local não aceita URL, empresa ou catálogo externo." }, 400);
    if (entrada.registro && typeof entrada.registro === "object" && !Array.isArray(entrada.registro)) {
      const reg = entrada.registro as Record<string, unknown>;
      if (Object.keys(reg).some((k) => ["url", "arquivo", "html"].includes(k))) return responder({ ok: false, erro: "O registro não aceita URL ou conteúdo externo." }, 400);
    }
    const resultado = await gerenciarCest(c, dados);
    if (!resultado.ok) return responder(resultado, STATUS_ERRO[resultado.codigo ?? "persistencia"] ?? 400);
    return responder(resultado, 200);
  } catch {
    return responder({ ok: false, erro: "Não foi possível alterar a referência local. Nada foi alterado; revise os dados e tente novamente." }, 503);
  }
}
