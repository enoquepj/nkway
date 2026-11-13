import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { empresas, usuarios } from "@/db/schema";
import {
  IDADE_COOKIE_SESSAO_SEGUNDOS,
  NOME_COOKIE_SESSAO,
  atributosCookieSessao,
  atributosExpiracaoCookieSessao,
  requisicaoEhHttps,
} from "@/lib/sessaoCookie";

const COOKIE = NOME_COOKIE_SESSAO;
const MAX_AGE = IDADE_COOKIE_SESSAO_SEGUNDOS;

function segredo(): string {
  return process.env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao";
}

const b64u = (buf: Buffer) => buf.toString("base64url");

function assinar(payload: string): string {
  return b64u(createHmac("sha256", segredo()).update(payload).digest());
}

export type Sessao = { empresaId: string; usuarioId: string };

export async function criarSessao(sessao: Sessao) {
  const payload = b64u(Buffer.from(JSON.stringify({ ...sessao, iat: Date.now() })));
  const token = `${payload}.${assinar(payload)}`;
  const ehHttps = requisicaoEhHttps(await headers());
  const jar = await cookies();
  jar.set(COOKIE, token, { ...atributosCookieSessao(ehHttps), maxAge: MAX_AGE });
}

export async function lerSessao(): Promise<Sessao | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const [payload, assinatura] = token.split(".");
  if (!payload || !assinatura) return null;
  const esperado = assinar(payload);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Sessao & { iat: number };
    if (Date.now() - dados.iat > MAX_AGE * 1000) return null;
    return { empresaId: dados.empresaId, usuarioId: dados.usuarioId };
  } catch {
    return null;
  }
}

/**
 * Encerra a sessão expirando o MESMO cookie com o MESMO escopo da criação
 * (Secure/SameSite/Partitioned em HTTPS). Sem isso o navegador mantém o cookie particionado.
 */
export async function encerrarSessao() {
  const ehHttps = requisicaoEhHttps(await headers());
  const jar = await cookies();
  jar.set(COOKIE, "", atributosExpiracaoCookieSessao(ehHttps));
}

/** Contexto do tenant: empresa + usuário logado. `null` quando não autenticado. */
export async function contexto() {
  const sessao = await lerSessao();
  if (!sessao) return null;
  const [empresa] = await db
    .select()
    .from(empresas)
    .where(eq(empresas.id, sessao.empresaId))
    .limit(1);
  if (!empresa) return null;
  const [usuario] = await db
    .select()
    .from(usuarios)
    .where(and(eq(usuarios.id, sessao.usuarioId), eq(usuarios.empresaId, sessao.empresaId)))
    .limit(1);
  if (!usuario || usuario.ativo === false) return null;
  return { empresa, usuario, empresaId: empresa.id };
}

export function novaSenhaAleatoria(bytes = 6) {
  return randomBytes(bytes).toString("base64url");
}

/** hash de senha com scrypt (sem dependências externas) */
export function hashSenha(senha: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", `${salt}:${segredo()}`).update(senha).digest("hex");
  return `v1.${salt}.${hash}`;
}

export function confereSenha(senha: string, armazenada: string): boolean {
  const [, salt, hash] = (armazenada || "").split(".");
  if (!salt || !hash) return false;
  const calc = createHmac("sha256", `${salt}:${segredo()}`).update(senha).digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
