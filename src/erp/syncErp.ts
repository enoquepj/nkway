import { isCloud, supabase } from "../lib/supabase";
import type { DB } from "./types";

const LIMITE_BYTES = 10 * 1024 * 1024; // 10 MB — igual ao check no Postgres

export type SyncMeta = {
  version: number;
  tamanhoBytes: number;
  limiteBytes: number;
  updatedAt: string | null;
};

export type SaveResult =
  | { ok: true; version: number; tamanhoBytes: number; limiteBytes: number }
  | {
      ok: false;
      erro: "LIMITE_10MB" | "CONFLITO_VERSAO" | "SEM_CLOUD" | "REDE" | string;
      mensagem: string;
      versionServidor?: number;
      tamanhoBytes?: number;
      limiteBytes?: number;
    };

function byteSizeJson(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

/** Remove campos enormes opcionais se precisar enxugar (XML embutido etc.) */
export function estadoParaSync(db: DB): Record<string, unknown> {
  return {
    configFiscal: db.configFiscal,
    produtos: db.produtos,
    clientes: db.clientes,
    fornecedores: db.fornecedores,
    vendas: db.vendas,
    lancamentos: db.lancamentos,
    entradas: db.entradas,
    movimentos: db.movimentos,
    devolucoes: db.devolucoes,
    cancelamentos: db.cancelamentos,
    inutilizacoes: db.inutilizacoes,
    mdfes: db.mdfes,
  };
}

export function tamanhoEstadoBytes(db: DB): number {
  return byteSizeJson(estadoParaSync(db));
}

export function usoStorageLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  const lim = LIMITE_BYTES / (1024 * 1024);
  return `${mb.toFixed(2)} MB / ${lim} MB`;
}

export async function carregarEstadoNuvem(): Promise<{
  meta: SyncMeta;
  estado: Partial<DB> | null;
} | null> {
  if (!isCloud || !supabase) return null;
  const { data, error } = await supabase.rpc("carregar_estado_erp");
  if (error) throw new Error(error.message);
  const d = data as {
    existe: boolean;
    version: number;
    estado: Partial<DB>;
    tamanho_bytes: number;
    limite_bytes: number;
    updated_at: string | null;
  };
  return {
    meta: {
      version: d.version ?? 0,
      tamanhoBytes: d.tamanho_bytes ?? 0,
      limiteBytes: d.limite_bytes ?? LIMITE_BYTES,
      updatedAt: d.updated_at,
    },
    estado: d.existe ? d.estado : null,
  };
}

export async function salvarEstadoNuvem(
  db: DB,
  versionCliente: number,
  force = false,
): Promise<SaveResult> {
  if (!isCloud || !supabase) {
    return { ok: false, erro: "SEM_CLOUD", mensagem: "Supabase não configurado." };
  }

  const payload = estadoParaSync(db);
  const tamanho = byteSizeJson(payload);
  if (tamanho > LIMITE_BYTES) {
    return {
      ok: false,
      erro: "LIMITE_10MB",
      mensagem: `Seus dados têm ${usoStorageLabel(tamanho)}. O limite por empresa é 10 MB. Apague vendas/XML antigos ou fale com o suporte.`,
      tamanhoBytes: tamanho,
      limiteBytes: LIMITE_BYTES,
    };
  }

  const { data, error } = await supabase.rpc(
    force ? "salvar_estado_erp_force" : "salvar_estado_erp",
    force
      ? { p_estado: payload }
      : { p_estado: payload, p_version_cliente: versionCliente },
  );

  if (error) {
    return { ok: false, erro: "REDE", mensagem: error.message };
  }

  const d = data as Record<string, unknown>;
  if (d.ok === true) {
    return {
      ok: true,
      version: Number(d.version),
      tamanhoBytes: Number(d.tamanho_bytes),
      limiteBytes: Number(d.limite_bytes) || LIMITE_BYTES,
    };
  }

  if (d.erro === "LIMITE_10MB") {
    return {
      ok: false,
      erro: "LIMITE_10MB",
      mensagem: String(d.mensagem || "Limite de 10 MB atingido."),
      tamanhoBytes: Number(d.tamanho_bytes),
      limiteBytes: Number(d.limite_bytes) || LIMITE_BYTES,
    };
  }

  if (d.erro === "CONFLITO_VERSAO") {
    return {
      ok: false,
      erro: "CONFLITO_VERSAO",
      mensagem: String(d.mensagem || "Conflito de versão."),
      versionServidor: Number(d.version_servidor),
    };
  }

  return {
    ok: false,
    erro: String(d.erro || "DESCONHECIDO"),
    mensagem: String(d.mensagem || "Falha ao salvar."),
  };
}

export { LIMITE_BYTES };
