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

/* ------------------------------------------------------------------ carga a partir dos instantâneos embutidos */

import { CFOP_FONTE, CFOP_SAIDA_VAREJO, TABELAS_FISCAIS } from "@/lib/tabelasFiscais";
import { CLASS_TRIB, CLASS_TRIB_VERSAO } from "@/lib/tabelaClassTrib";
import { ORIGENS_MERCADORIA } from "@/lib/tributacao";
import { registrarAuditoria } from "@/server/auditoria";

export type ResultadoCargaDominio = { tipo: string; inseridas: number; atualizadas: number; total: number; fonte: string; referencia: string };

/**
 * Carrega/atualiza `nk_tabela_dominio` + `nk_tabela_dominio_meta` a partir dos instantâneos oficiais embutidos no código
 * (mesmos usados como fallback pelos seletores). Idempotente: upsert por (tipo, codigo, uf); não apaga linhas existentes
 * (códigos que saírem do instantâneo apenas deixam de ser reativados). Tabelas de referência pública: não têm tenant.
 * Executada por ação administrativa autenticada; nunca por script com credencial fora do servidor.
 */
export async function carregarTabelasDominioEmbutidas(executor: Pick<typeof db, "transaction">, usuario: { empresaId: string; id: string; nome: string; papel: string }): Promise<ResultadoCargaDominio[]> {
  type Lote = { tipo: TipoTabelaDominio; fonte: string; referencia: string; url: string; versao: string; linhas: { codigo: string; descricao: string }[] };
  const lotes: Lote[] = [
    ...TABELAS_FISCAIS.map((t) => ({ tipo: t.id as TipoTabelaDominio, fonte: t.fonte, referencia: t.ato, url: t.url, versao: t.conferidaEm, linhas: t.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao })) })),
    { tipo: "cclass_trib", fonte: CLASS_TRIB_VERSAO.fonte, referencia: `IT 2025.002 v${CLASS_TRIB_VERSAO.versao}`, url: CLASS_TRIB_VERSAO.url, versao: CLASS_TRIB_VERSAO.versao, linhas: CLASS_TRIB.map(([codigo, nome]) => ({ codigo, descricao: nome })) },
    { tipo: "cfop", fonte: CFOP_FONTE.fonte, referencia: CFOP_FONTE.ato, url: CFOP_FONTE.url, versao: CFOP_FONTE.conferidaEm, linhas: CFOP_SAIDA_VAREJO.map((i) => ({ codigo: i.codigo, descricao: i.descricao })) },
    { tipo: "origem", fonte: "Convênio SINIEF s/nº 1970 — Tabela A (origem da mercadoria)", referencia: "Ajuste SINIEF 20/2012", url: "https://www.confaz.fazenda.gov.br/legislacao/ajustes/2012/AJ_020_12", versao: "2026-11-09", linhas: ORIGENS_MERCADORIA.map((o) => ({ codigo: o.id, descricao: o.rotulo.replace(/^\d\s+—\s+/, "") })) },
  ];
  return executor.transaction(async (tx) => {
    const resultados: ResultadoCargaDominio[] = [];
    for (const lote of lotes) {
      const existentes = await tx.select({ codigo: tabelaDominio.codigo, descricao: tabelaDominio.descricao, ativo: tabelaDominio.ativo }).from(tabelaDominio).where(sql`${tabelaDominio.tipo} = ${lote.tipo} and ${tabelaDominio.uf} = ''`);
      const mapa = new Map(existentes.map((e) => [e.codigo, e]));
      let inseridas = 0, atualizadas = 0;
      for (const l of lote.linhas) {
        const atual = mapa.get(l.codigo);
        if (!atual) {
          await tx.insert(tabelaDominio).values({ tipo: lote.tipo, codigo: l.codigo, descricao: l.descricao, uf: "", fonte: lote.fonte, versao: lote.versao, ativo: true });
          inseridas++;
        } else if (atual.descricao !== l.descricao || !atual.ativo) {
          await tx.update(tabelaDominio).set({ descricao: l.descricao, ativo: true, fonte: lote.fonte, versao: lote.versao, atualizadoEm: new Date() }).where(sql`${tabelaDominio.tipo} = ${lote.tipo} and ${tabelaDominio.codigo} = ${l.codigo} and ${tabelaDominio.uf} = ''`);
          atualizadas++;
        }
      }
      const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from nk_tabela_dominio where tipo = ${lote.tipo} and ativo`)).rows;
      const total = Number(n); // total ativo real (inclui linhas preexistentes de outras cargas, que são preservadas)
      await tx.insert(tabelaDominioMeta).values({ tipo: lote.tipo, fonte: lote.fonte, referencia: lote.referencia, url: lote.url, versao: lote.versao, total, atualizadoEm: new Date() })
        .onConflictDoUpdate({ target: tabelaDominioMeta.tipo, set: { fonte: lote.fonte, referencia: lote.referencia, url: lote.url, versao: lote.versao, total, atualizadoEm: new Date() } });
      resultados.push({ tipo: lote.tipo, inseridas, atualizadas, total, fonte: lote.fonte, referencia: lote.referencia });
    }
    await registrarAuditoria({ empresaId: usuario.empresaId, usuario: { id: usuario.id, nome: usuario.nome, papel: usuario.papel }, acao: "fiscal.tabelas_dominio_carregar", entidade: "tabela_dominio", registroId: "embutidas",
      resumo: `Tabelas fiscais de referência carregadas a partir dos instantâneos embutidos: ${resultados.map((r) => `${r.tipo} ${r.total}`).join(" · ")}`,
      alteracoes: { resultados, observacao: "Tabelas públicas sem tenant; carga idempotente; nada apagado" } }, tx);
    return resultados;
  });
}
