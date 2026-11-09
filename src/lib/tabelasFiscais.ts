/**
 * Tabelas fiscais de REFERÊNCIA embutidas (somente leitura) para as listas do perfil fiscal e da ficha do produto.
 *
 * Mesma base dos ERPs de mercado: tabelas oficiais do SPED / Portal da NF-e / CONFAZ. São instantâneos revisados
 * manualmente, com fonte, ato e data de conferência declarados — não há atualização automática.
 * Prioridade de uso na interface: 1) tabela carregada em `nk_tabela_dominio` (quando a empresa/instalação tiver feito a
 * carga oficial); 2) este instantâneo. Selecionar um código NÃO comprova o enquadramento: decisão da contabilidade.
 * cClassTrib (173 códigos, IT 2025.002 v1.70) está em `src/lib/tabelaClassTrib.ts`.
 * CST IBS/CBS: texto literal do seletor da consulta pública oficial do Portal DFe SVRS, extraído em 2026-11-09.
 */

export type ItemTabelaFiscal = { codigo: string; descricao: string; sentido?: "saida" | "entrada" | "ambos"; nota?: string };
export type IdTabelaFiscal = "cst_pis" | "cst_cofins" | "cst_ipi" | "cst_ibs_cbs" | "cst_icms" | "csosn";
export type TabelaFiscalReferencia = { id: IdTabelaFiscal; rotulo: string; fonte: string; ato: string; url: string; conferidaEm: string; itens: readonly ItemTabelaFiscal[] };

/** IN RFB 1.009/2010 — Tabelas 4.3.3 (PIS/Pasep) e 4.3.4 (COFINS) do SPED EFD-Contribuições (mesma lista). */
export const CST_PIS_COFINS: readonly ItemTabelaFiscal[] = [
  { codigo: "01", descricao: "Operação tributável com alíquota básica", sentido: "saida" },
  { codigo: "02", descricao: "Operação tributável com alíquota diferenciada", sentido: "saida" },
  { codigo: "03", descricao: "Operação tributável com alíquota por unidade de medida de produto", sentido: "saida" },
  { codigo: "04", descricao: "Operação tributável monofásica — revenda a alíquota zero", sentido: "saida" },
  { codigo: "05", descricao: "Operação tributável por substituição tributária", sentido: "saida" },
  { codigo: "06", descricao: "Operação tributável a alíquota zero", sentido: "saida" },
  { codigo: "07", descricao: "Operação isenta da contribuição", sentido: "saida" },
  { codigo: "08", descricao: "Operação sem incidência da contribuição", sentido: "saida" },
  { codigo: "09", descricao: "Operação com suspensão da contribuição", sentido: "saida" },
  { codigo: "49", descricao: "Outras operações de saída", sentido: "saida" },
  { codigo: "50", descricao: "Operação com direito a crédito — vinculada exclusivamente a receita tributada no mercado interno", sentido: "entrada" },
  { codigo: "51", descricao: "Operação com direito a crédito — vinculada exclusivamente a receita não tributada no mercado interno", sentido: "entrada" },
  { codigo: "52", descricao: "Operação com direito a crédito — vinculada exclusivamente a receita de exportação", sentido: "entrada" },
  { codigo: "53", descricao: "Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno", sentido: "entrada" },
  { codigo: "54", descricao: "Operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "55", descricao: "Operação com direito a crédito — vinculada a receitas não tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "56", descricao: "Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "60", descricao: "Crédito presumido — operação de aquisição vinculada exclusivamente a receita tributada no mercado interno", sentido: "entrada" },
  { codigo: "61", descricao: "Crédito presumido — operação de aquisição vinculada exclusivamente a receita não tributada no mercado interno", sentido: "entrada" },
  { codigo: "62", descricao: "Crédito presumido — operação de aquisição vinculada exclusivamente a receita de exportação", sentido: "entrada" },
  { codigo: "63", descricao: "Crédito presumido — operação de aquisição vinculada a receitas tributadas e não tributadas no mercado interno", sentido: "entrada" },
  { codigo: "64", descricao: "Crédito presumido — operação de aquisição vinculada a receitas tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "65", descricao: "Crédito presumido — operação de aquisição vinculada a receitas não tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "66", descricao: "Crédito presumido — operação de aquisição vinculada a receitas tributadas e não tributadas no mercado interno e de exportação", sentido: "entrada" },
  { codigo: "67", descricao: "Crédito presumido — outras operações", sentido: "entrada" },
  { codigo: "70", descricao: "Operação de aquisição sem direito a crédito", sentido: "entrada" },
  { codigo: "71", descricao: "Operação de aquisição com isenção", sentido: "entrada" },
  { codigo: "72", descricao: "Operação de aquisição com suspensão", sentido: "entrada" },
  { codigo: "73", descricao: "Operação de aquisição a alíquota zero", sentido: "entrada" },
  { codigo: "74", descricao: "Operação de aquisição sem incidência da contribuição", sentido: "entrada" },
  { codigo: "75", descricao: "Operação de aquisição por substituição tributária", sentido: "entrada" },
  { codigo: "98", descricao: "Outras operações de entrada", sentido: "entrada" },
  { codigo: "99", descricao: "Outras operações", sentido: "ambos" }
] as const;

/** IN RFB 1.009/2010 — Tabela 4.3.2 do SPED (CST do IPI). */
export const CST_IPI: readonly ItemTabelaFiscal[] = [
  { codigo: "00", descricao: "Entrada com recuperação de crédito", sentido: "entrada" },
  { codigo: "01", descricao: "Entrada tributada com alíquota zero", sentido: "entrada" },
  { codigo: "02", descricao: "Entrada isenta", sentido: "entrada" },
  { codigo: "03", descricao: "Entrada não tributada", sentido: "entrada" },
  { codigo: "04", descricao: "Entrada imune", sentido: "entrada" },
  { codigo: "05", descricao: "Entrada com suspensão", sentido: "entrada" },
  { codigo: "49", descricao: "Outras entradas", sentido: "entrada" },
  { codigo: "50", descricao: "Saída tributada", sentido: "saida" },
  { codigo: "51", descricao: "Saída tributada com alíquota zero", sentido: "saida" },
  { codigo: "52", descricao: "Saída isenta", sentido: "saida" },
  { codigo: "53", descricao: "Saída não tributada", sentido: "saida" },
  { codigo: "54", descricao: "Saída imune", sentido: "saida" },
  { codigo: "55", descricao: "Saída com suspensão", sentido: "saida" },
  { codigo: "99", descricao: "Outras saídas", sentido: "saida" }
] as const;

/** Informe Técnico 2025.002 v1.70 (01/10/2026) — Tabela CST-IBS/CBS. */
export const CST_IBS_CBS: readonly ItemTabelaFiscal[] = [
  { codigo: "000", descricao: "Tributação integral", sentido: "ambos" },
  { codigo: "010", descricao: "Tributação com alíquotas uniformes", sentido: "ambos" },
  { codigo: "011", descricao: "Tributação com alíquotas uniformes reduzidas", sentido: "ambos" },
  { codigo: "200", descricao: "Alíquota reduzida", sentido: "ambos" },
  { codigo: "220", descricao: "Alíquota fixa", sentido: "ambos" },
  { codigo: "221", descricao: "Alíquota fixa proporcional", sentido: "ambos" },
  { codigo: "222", descricao: "Redução de Base de Cálculo", sentido: "ambos" },
  { codigo: "400", descricao: "Isenção", sentido: "ambos" },
  { codigo: "410", descricao: "Imunidade e não incidência", sentido: "ambos" },
  { codigo: "510", descricao: "Diferimento", sentido: "ambos" },
  { codigo: "515", descricao: "Diferimento com redução de alíquota", sentido: "ambos" },
  { codigo: "550", descricao: "Suspensão", sentido: "ambos" },
  { codigo: "620", descricao: "Tributação Monofásica", sentido: "ambos" },
  { codigo: "800", descricao: "Transferência de crédito", sentido: "ambos" },
  { codigo: "810", descricao: "Ajuste de IBS na ZFM", sentido: "ambos" },
  { codigo: "811", descricao: "Ajustes", sentido: "ambos" },
  { codigo: "820", descricao: "Tributação em documento específico", sentido: "ambos" },
  { codigo: "830", descricao: "Exclusão da Base de Cálculo", sentido: "ambos" }
] as const;

/** Convênio SINIEF s/nº 1970 — Tabela B; 02/15/53/61 pelo Ajuste SINIEF 01/2023 (monofásico). */
export const CST_ICMS_DESCRICOES: readonly ItemTabelaFiscal[] = [
  { codigo: "00", descricao: "Tributada integralmente" },
  { codigo: "02", descricao: "Tributação monofásica própria sobre combustíveis" },
  { codigo: "10", descricao: "Tributada e com cobrança do ICMS por substituição tributária" },
  { codigo: "15", descricao: "Tributação monofásica própria e com responsabilidade pela retenção sobre combustíveis" },
  { codigo: "20", descricao: "Com redução de base de cálculo" },
  { codigo: "30", descricao: "Isenta ou não tributada e com cobrança do ICMS por substituição tributária" },
  { codigo: "40", descricao: "Isenta" },
  { codigo: "41", descricao: "Não tributada" },
  { codigo: "50", descricao: "Suspensão" },
  { codigo: "51", descricao: "Diferimento" },
  { codigo: "53", descricao: "Tributação monofásica sobre combustíveis com recolhimento diferido" },
  { codigo: "60", descricao: "ICMS cobrado anteriormente por substituição tributária" },
  { codigo: "61", descricao: "Tributação monofásica sobre combustíveis cobrada anteriormente" },
  { codigo: "70", descricao: "Com redução de base de cálculo e cobrança do ICMS por substituição tributária" },
  { codigo: "90", descricao: "Outras" }
] as const;

/** Ajuste SINIEF 07/2005 — Tabela B do Anexo Único (CSOSN). */
export const CSOSN_DESCRICOES: readonly ItemTabelaFiscal[] = [
  { codigo: "101", descricao: "Tributada pelo Simples Nacional com permissão de crédito" },
  { codigo: "102", descricao: "Tributada pelo Simples Nacional sem permissão de crédito" },
  { codigo: "103", descricao: "Isenção do ICMS no Simples Nacional para faixa de receita bruta" },
  { codigo: "201", descricao: "Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por substituição tributária" },
  { codigo: "202", descricao: "Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por substituição tributária" },
  { codigo: "203", descricao: "Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por substituição tributária" },
  { codigo: "300", descricao: "Imune" },
  { codigo: "400", descricao: "Não tributada pelo Simples Nacional" },
  { codigo: "500", descricao: "ICMS cobrado anteriormente por substituição tributária (substituído) ou por antecipação" },
  { codigo: "900", descricao: "Outros" }
] as const;

const PORTAL_NFE = "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D";
const SPED_TABELAS = "http://sped.rfb.gov.br/pagina/show/1578";
export const TABELAS_FISCAIS: readonly TabelaFiscalReferencia[] = [
  { id: "cst_pis", rotulo: "CST PIS/Pasep", fonte: "SPED EFD-Contribuições — Tabela 4.3.3", ato: "IN RFB 1.009/2010", url: SPED_TABELAS, conferidaEm: "2026-11-09", itens: CST_PIS_COFINS },
  { id: "cst_cofins", rotulo: "CST COFINS", fonte: "SPED EFD-Contribuições — Tabela 4.3.4", ato: "IN RFB 1.009/2010", url: SPED_TABELAS, conferidaEm: "2026-11-09", itens: CST_PIS_COFINS },
  { id: "cst_ipi", rotulo: "CST IPI", fonte: "SPED — Tabela 4.3.2", ato: "IN RFB 1.009/2010", url: SPED_TABELAS, conferidaEm: "2026-11-09", itens: CST_IPI },
  { id: "cst_ibs_cbs", rotulo: "CST IBS/CBS", fonte: "Portal Nacional da NF-e / Portal DFe SVRS — Tabela CST-IBS/CBS", ato: "IT 2025.002 v1.70 (01/10/2026) · LC 214/2025", url: PORTAL_NFE, conferidaEm: "2026-11-09", itens: CST_IBS_CBS },
  { id: "cst_icms", rotulo: "CST ICMS", fonte: "Convênio SINIEF s/nº 1970 — Tabela B", ato: "Ajuste SINIEF 01/2023 (monofásico)", url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/1970/cv000_70", conferidaEm: "2026-11-09", itens: CST_ICMS_DESCRICOES },
  { id: "csosn", rotulo: "CSOSN", fonte: "Ajuste SINIEF 07/2005 — Tabela B", ato: "Ajuste SINIEF 07/2005", url: "https://www.confaz.fazenda.gov.br/legislacao/ajustes/2005/aj_007_05", conferidaEm: "2026-11-09", itens: CSOSN_DESCRICOES },
] as const;

const POR_ID = new Map<IdTabelaFiscal, TabelaFiscalReferencia>(TABELAS_FISCAIS.map((t) => [t.id, t]));
export function tabelaFiscal(id: IdTabelaFiscal): TabelaFiscalReferencia { const t = POR_ID.get(id); if (!t) throw new Error(`Tabela fiscal desconhecida: ${id}`); return t; }

/** Descrição oficial de um código (ou `null` se não constar — nunca inventa). */
export function descricaoFiscal(id: IdTabelaFiscal, codigo: string): string | null {
  const c = String(codigo ?? "").trim(); return tabelaFiscal(id).itens.find((i) => i.codigo === c)?.descricao ?? null;
}

/** Opções para lista suspensa: no perfil de VENDA os códigos de saída vêm primeiro; os de entrada seguem selecionáveis (devolução/ajustes). */
export function opcoesTabelaFiscal(id: IdTabelaFiscal, prioridade: "saida" | "entrada" | "todos" = "saida"): { valor: string; rotulo: string; grupo: string }[] {
  const t = tabelaFiscal(id);
  const grupoDe = (i: ItemTabelaFiscal) => (i.sentido === "entrada" ? "Entrada / crédito" : i.sentido === "saida" ? "Saída" : "Geral");
  const peso = (i: ItemTabelaFiscal) => (prioridade === "todos" || i.sentido === prioridade || i.sentido === "ambos" || !i.sentido ? 0 : 1);
  return [...t.itens].map((i, idx) => ({ i, idx })).sort((a, b) => peso(a.i) - peso(b.i) || a.idx - b.idx)
    .map(({ i }) => ({ valor: i.codigo, rotulo: `${i.codigo} — ${i.descricao}`, grupo: grupoDe(i) }));
}

/** Verificação estrutural (testes/diagnóstico): códigos únicos, numéricos, tamanho certo e com descrição. */
export function conferirTabelaFiscal(id: IdTabelaFiscal): { ok: boolean; total: number; problemas: string[] } {
  const t = tabelaFiscal(id); const tamanho = id === "cst_ibs_cbs" || id === "csosn" ? 3 : 2;
  const vistos = new Set<string>(); const problemas: string[] = [];
  for (const i of t.itens) {
    if (!new RegExp(`^\\d{${tamanho}}$`).test(i.codigo)) problemas.push(`${id}: código ${i.codigo} fora do formato`);
    if (vistos.has(i.codigo)) problemas.push(`${id}: código ${i.codigo} duplicado`); vistos.add(i.codigo);
    if (!i.descricao || i.descricao.length < 4) problemas.push(`${id}: ${i.codigo} sem descrição`);
  }
  return { ok: problemas.length === 0, total: t.itens.length, problemas };
}
