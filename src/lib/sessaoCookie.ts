/**
 * NKWAY — Escopo do cookie de sessão (`nkway.sessao`).
 *
 * Módulo puro (sem Next, sem banco): a CRIAÇÃO e o ENCERRAMENTO da sessão usam
 * exatamente o mesmo escopo. Sem isso, em HTTPS o navegador mantém o cookie
 * particionado e o "Sair" não encerra a sessão de verdade.
 */

export const NOME_COOKIE_SESSAO = "nkway.sessao";
export const IDADE_COOKIE_SESSAO_SEGUNDOS = 60 * 60 * 24 * 30;

/** HTTPS detectado pelos cabeçalhos da requisição (Vercel / proxy reverso). */
export function requisicaoEhHttps(hdrs: { get(name: string): string | null }): boolean {
  const proto = hdrs.get("x-forwarded-proto") || "";
  const origin = hdrs.get("origin") || "";
  return proto.includes("https") || origin.startsWith("https://");
}

/** Atributos usados na CRIAÇÃO do cookie de sessão. */
export function atributosCookieSessao(ehHttps: boolean) {
  return {
    httpOnly: true,
    sameSite: ehHttps ? ("none" as const) : ("lax" as const),
    path: "/" as const,
    secure: ehHttps,
    ...(ehHttps ? { partitioned: true as const } : {}),
  };
}

/**
 * Atributos de EXPIRAÇÃO: o mesmo escopo da criação mais `maxAge: 0` e
 * `expires` no passado, para o navegador descartar o cookie imediatamente.
 */
export function atributosExpiracaoCookieSessao(ehHttps: boolean) {
  return { ...atributosCookieSessao(ehHttps), maxAge: 0, expires: new Date(0) };
}
