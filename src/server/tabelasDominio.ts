import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tabelaDominio, tabelaDominioMeta } from "@/db/schema";

/** Tipos de tabela de domínio suportados na parametrização fiscal. */
export const TIPOS_TABELA_DOMINIO = ["cfop", "cst_icms", "csosn", "cst_pis", "cst_cofins", "cst_ipi", "cst_ibs_cbs", "cclass_trib", "ccred_pres", "aliquota_padrao_ibs_cbs", "origem", "cbenef", "ncm", "cest"] as const;
export type TipoTabelaDominio = (typeof TIPOS_TABELA_DOMINIO)[number];

export type LinhaDominioDto = { codigo: string; descricao: string; uf: string; vigIni: string | null; vigFim: string | null };
export type MetaDominioDto = { tipo: string; fonte: string; referencia: string; url: string; versao: string; total: number; atualizadoEm: string | null };
export type TabelasDominioDto = Record<string, LinhaDominioDto[]> & { __metas?: never };

/**
 * Leitura somente-consulta das tabelas de domínio oficiais (dados públicos de referência,
 * não de tenant). Nunca retorna dados de outra empresa nem altera nada.
 */
export async function listarTabelaDominio(tipo: string, incluirInativos = false): Promise<LinhaDominioDto[]> {
  if (!TIPOS_TABELA_DOMINIO.includes(tipo as TipoTabelaDominio)) return [];
  const linhas = await db.select({
    codigo: tabelaDominio.codigo, descricao: tabelaDominio.descricao, uf: tabelaDominio.uf,
    vigIni: tabelaDominio.vigIni, vigFim: tabelaDominio.vigFim, ativo: tabelaDominio.ativo,
  }).from(tabelaDominio).where(eq(tabelaDominio.tipo, tipo)).orderBy(asc(tabelaDominio.codigo));
  return linhas.filter((l) => incluirInativos || l.ativo).map(({ codigo, descricao, uf, vigIni, vigFim }) => ({
    codigo, descricao, uf, vigIni: vigIni ? String(vigIni) : null, vigFim: vigFim ? String(vigFim) : null,
  }));
}

export async function listarMetasDominio(): Promise<MetaDominioDto[]> {
  const linhas = await db.select().from(tabelaDominioMeta).orderBy(asc(tabelaDominioMeta.tipo));
  return linhas.map((m) => ({ tipo: m.tipo, fonte: m.fonte, referencia: m.referencia, url: m.url, versao: m.versao, total: m.total, atualizadoEm: m.atualizadoEm?.toISOString() ?? null }));
}

/** Todas as tabelas usadas como opções selecionáveis no módulo fiscal, agrupadas por tipo. */
export async function listarTabelasDominio(): Promise<Record<string, LinhaDominioDto[]>> {
  const tipos = TIPOS_TABELA_DOMINIO.filter((t) => t !== "ncm" && t !== "cest"); // NCM/CEST têm consulta própria (etapas 1 e 2 do roteiro)
  const pares = await Promise.all(tipos.map(async (t) => [t, await listarTabelaDominio(t)] as const));
  const r: Record<string, LinhaDominioDto[]> = {};
  for (const [t, linhas] of pares) r[t] = linhas;
  return r;
}

/** Sanidade do diagnóstico: metadados presentes e contagens coerentes. */
export async function conferirTabelasDominio(): Promise<{ ok: boolean; detalhe: string }> {
  const metas = await db.select({ total: tabelaDominioMeta.total, tipo: tabelaDominioMeta.tipo }).from(tabelaDominioMeta);
  const contagem = await db.execute<{ tipo: string; n: number }>(sql`select tipo, count(*)::int as n from nk_tabela_dominio where ativo group by tipo`);
  const porTipo = new Map(contagem.rows.map((r) => [r.tipo, Number(r.n)]));
  const ruins = metas.filter((m) => (porTipo.get(m.tipo) ?? 0) !== m.total);
  const tiposComMeta = metas.map((m) => m.tipo);
  const esperado = ["cst_pis", "cst_cofins", "cst_icms", "csosn", "cst_ipi", "origem", "cst_ibs_cbs"];
  const faltando = esperado.filter((t) => !tiposComMeta.includes(t));
  const ok = ruins.length === 0 && faltando.length === 0;
  return { ok, detalhe: `${metas.length} metas · ${contagem.rows.length} tipos com linhas · incoerentes: ${ruins.map((r) => r.tipo).join(",") || "nenhuma"} · faltando: ${faltando.join(",") || "nenhum"}` };
}
