/**
 * NKWAY — Serviço Server-Side de Auditoria (Fase 1).
 * Registra usuário, perfil, data, ação, entidade, registro afetado e alterações sanitizadas.
 */
import { db } from "@/db";
import { auditorias } from "@/db/schema";
import { normalizarPerfil } from "@/lib/permissoes";

const CAMPOS_SENSIVEIS = new Set([
  "senha",
  "senhahash",
  "senha_hash",
  "novasenha",
  "pfxbase64",
  "dfesenhacifrada",
  "dfepfxcifrado",
  "csctoken",
  "token",
  "secret",
]);

function sanitizarObjeto(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4) return "[truncado]";
  if (valor === null || valor === undefined) return valor;
  if (Array.isArray(valor)) return valor.slice(0, 50).map((item) => sanitizarObjeto(item, profundidade + 1));
  if (typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (CAMPOS_SENSIVEIS.has(k.toLowerCase())) {
        out[k] = "[protegido]";
      } else {
        out[k] = sanitizarObjeto(v, profundidade + 1);
      }
    }
    return out;
  }
  if (typeof valor === "string" && valor.length > 500) {
    return `${valor.slice(0, 500)}…`;
  }
  return valor;
}

export type RegistroAuditoriaInput = {
  empresaId: string;
  usuario?: { id?: string | null; nome?: string | null; papel?: string | null } | null;
  acao: string;
  entidade: string;
  registroId?: string | number | null;
  resumo: string;
  alteracoes?: Record<string, unknown>;
};

export async function registrarAuditoria(input: RegistroAuditoriaInput, executor: Pick<typeof db, "insert"> = db): Promise<void> {
  const alteracoesLimpas = (sanitizarObjeto(input.alteracoes ?? {}) ?? {}) as Record<string, unknown>;
  await executor.insert(auditorias).values({
    empresaId: input.empresaId,
    usuarioId: input.usuario?.id ?? null,
    usuarioNome: String(input.usuario?.nome ?? "Sistema").slice(0, 120),
    usuarioPapel: input.usuario?.papel ? normalizarPerfil(input.usuario.papel) : "sistema",
    acao: String(input.acao).slice(0, 80),
    entidade: String(input.entidade).slice(0, 60),
    registroId: input.registroId != null ? String(input.registroId).slice(0, 120) : "",
    resumo: String(input.resumo).slice(0, 400),
    alteracoes: alteracoesLimpas,
  });
}
