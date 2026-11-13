import { cookies, headers } from "next/headers";
import {
  NOME_COOKIE_SESSAO,
  atributosExpiracaoCookieSessao,
  requisicaoEhHttps,
} from "@/lib/sessaoCookie";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const SEM_CACHE = { "Cache-Control": "no-store, private" };

/**
 * Encerra a sessão do usuário.
 *
 * A sessão é stateless (cookie assinado pelo servidor), então expirar o cookie
 * com o MESMO escopo da criação encerra o acesso de imediato — inclusive o
 * `Partitioned` em HTTPS, que o `cookies().delete()` não remove.
 *
 * Responde `{ ok: true }` para o Shell navegar para `/login` só depois de o
 * cookie expirado chegar ao navegador.
 */
export async function POST() {
  try {
    const ehHttps = requisicaoEhHttps(await headers());
    const jar = await cookies();
    jar.set(NOME_COOKIE_SESSAO, "", atributosExpiracaoCookieSessao(ehHttps));
    return Response.json({ ok: true }, { headers: SEM_CACHE });
  } catch {
    return Response.json(
      { ok: false, erro: "Não foi possível encerrar a sessão. Tente novamente." },
      { status: 500, headers: SEM_CACHE },
    );
  }
}
