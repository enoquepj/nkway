/**
 * Gate de acesso ao console do desenvolvedor.
 *
 * ⚠️ IMPORTANTE — leia antes de confiar nisto:
 * Validação no frontend é apenas uma BARREIRA DE CONVENIÊNCIA. Ela evita
 * que um usuário comum tropece no console, mas NÃO protege contra alguém
 * determinado: todo o código roda no navegador e pode ser inspecionado.
 *
 * Proteção real exige validar no servidor (ex.: coluna `papel = 'dev'`
 * na tabela usuarios do Supabase, com RLS). Veja DEV.md seção 7.
 */

const KEY_SESSAO = "nkway.dev";
const KEY_HASH = "nkway.dev.hash";
const KEY_TENTATIVAS = "nkway.dev.tentativas";
const KEY_VERSAO = "nkway.dev.versao";

/**
 * Hash SHA-256 da senha definitiva do desenvolvedor (formato: sha256("nkway::" + senha)).
 * A senha em texto puro NÃO fica no código. Para trocar:
 *   node -e 'console.log(require("crypto").createHash("sha256").update("nkway::NOVA_SENHA").digest("hex"))'
 * Cole o resultado aqui e incremente VERSAO_SENHA.
 */
const HASH_PADRAO = "329d63b18a67f7ca00d26e1104ddbf42c289b75ba5e16ec565c66749cd880043";

/**
 * Versão da senha embutida. Ao alterar HASH_PADRAO, incremente este número:
 * o hash antigo salvo no navegador é descartado e a nova senha passa a valer.
 */
const VERSAO_SENHA = "2";

const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000; // 5 minutos

/** SHA-256 via Web Crypto (nativo do navegador) */
export async function hash(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`nkway::${texto}`),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashAtual(): Promise<string> {
  const versaoOk = localStorage.getItem(KEY_VERSAO) === VERSAO_SENHA;
  const custom = localStorage.getItem("nkway.dev.custom") === "1";
  const salvo = localStorage.getItem(KEY_HASH);

  // Reaproveita o hash salvo apenas se a versão bate ou se o usuário
  // definiu uma senha própria pelo console.
  if (salvo && (versaoOk || custom)) return salvo;

  const h = HASH_PADRAO;
  localStorage.setItem(KEY_HASH, h);
  localStorage.setItem(KEY_VERSAO, VERSAO_SENHA);
  localStorage.removeItem("nkway.dev.custom");
  localStorage.removeItem(KEY_TENTATIVAS);
  return h;
}

export const senhaPersonalizada = () =>
  localStorage.getItem("nkway.dev.custom") === "1";

type Bloqueio = { tentativas: number; ate: number };

const lerBloqueio = (): Bloqueio => {
  try {
    return JSON.parse(localStorage.getItem(KEY_TENTATIVAS) ?? "") as Bloqueio;
  } catch {
    return { tentativas: 0, ate: 0 };
  }
};

export function estadoBloqueio() {
  const b = lerBloqueio();
  const restante = b.ate - Date.now();
  return {
    bloqueado: restante > 0,
    segundos: Math.ceil(restante / 1000),
    restantes: Math.max(0, MAX_TENTATIVAS - b.tentativas),
  };
}

/** Valida a senha e libera a sessão de desenvolvedor */
export async function validarSenha(senha: string): Promise<
  { ok: true } | { ok: false; erro: string }
> {
  const est = estadoBloqueio();
  if (est.bloqueado)
    return {
      ok: false,
      erro: `Muitas tentativas. Aguarde ${Math.ceil(est.segundos / 60)} min.`,
    };

  const esperado = await hashAtual();
  if ((await hash(senha)) !== esperado) {
    const b = lerBloqueio();
    const tentativas = b.tentativas + 1;
    localStorage.setItem(
      KEY_TENTATIVAS,
      JSON.stringify({
        tentativas,
        ate: tentativas >= MAX_TENTATIVAS ? Date.now() + BLOQUEIO_MS : 0,
      }),
    );
    const faltam = MAX_TENTATIVAS - tentativas;
    return {
      ok: false,
      erro:
        faltam > 0
          ? `Senha incorreta. ${faltam} tentativa(s) restante(s).`
          : "Acesso bloqueado por 5 minutos.",
    };
  }

  localStorage.removeItem(KEY_TENTATIVAS);
  localStorage.setItem(KEY_SESSAO, "1");
  return { ok: true };
}

/** Troca a senha do console */
export async function trocarSenha(
  atual: string,
  nova: string,
): Promise<string | null> {
  if ((await hash(atual)) !== (await hashAtual())) return "Senha atual incorreta.";
  if (nova.length < 8) return "A nova senha deve ter ao menos 8 caracteres.";
  localStorage.setItem(KEY_HASH, await hash(nova));
  localStorage.setItem("nkway.dev.custom", "1");
  localStorage.setItem(KEY_VERSAO, VERSAO_SENHA);
  return null;
}

/** Restaura a senha embutida no código (usar se esquecer a personalizada) */
export async function restaurarSenhaPadrao() {
  localStorage.setItem(KEY_HASH, HASH_PADRAO);
  localStorage.setItem(KEY_VERSAO, VERSAO_SENHA);
  localStorage.removeItem("nkway.dev.custom");
  localStorage.removeItem(KEY_TENTATIVAS);
}

export const devAtivo = () => localStorage.getItem(KEY_SESSAO) === "1";

export function sairDev() {
  localStorage.removeItem(KEY_SESSAO);
}

/** Indica se ainda está usando a senha padrão (deve alertar o usuário) */
export async function usandoSenhaPadrao(): Promise<boolean> {
  return (await hashAtual()) === HASH_PADRAO;
}
