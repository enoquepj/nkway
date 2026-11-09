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

/* ------------------------------------------------------------------ CFOP de saída (Etapa C) */
/**
 * Convênio SINIEF s/nº 1970 — Anexo (Códigos Fiscais de Operações e Prestações), redação do Ajuste SINIEF 07/2001 e alterações.
 * SUBCONJUNTO do varejo/comércio: vendas, transferências, devoluções de compra, ST, bonificação, remessas, baixas e "outras saídas"
 * nos grupos 5 (dentro do estado), 6 (interestadual) e 7 (exterior). Não é a tabela completa; prestações de serviço e CFOPs
 * específicos de indústria/energia/combustíveis/comunicação ficam de fora. Códigos fora do subconjunto continuam digitáveis.
 */
export const CFOP_SAIDA_VAREJO: readonly ItemTabelaFiscal[] = [
  { codigo: "5101", descricao: "Venda de produção do estabelecimento" },
  { codigo: "5102", descricao: "Venda de mercadoria adquirida ou recebida de terceiros" },
  { codigo: "5103", descricao: "Venda de produção do estabelecimento, efetuada fora do estabelecimento" },
  { codigo: "5104", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento" },
  { codigo: "5105", descricao: "Venda de produção do estabelecimento que não deva por ele transitar" },
  { codigo: "5106", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar" },
  { codigo: "5109", descricao: "Venda de produção do estabelecimento, destinada à Zona Franca de Manaus ou Áreas de Livre Comércio" },
  { codigo: "5110", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, destinada à Zona Franca de Manaus ou Áreas de Livre Comércio" },
  { codigo: "5116", descricao: "Venda de produção do estabelecimento originada de encomenda para entrega futura" },
  { codigo: "5117", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, originada de encomenda para entrega futura" },
  { codigo: "5118", descricao: "Venda de produção do estabelecimento entregue ao destinatário por conta e ordem do adquirente originário, em venda à ordem" },
  { codigo: "5119", descricao: "Venda de mercadoria adquirida ou recebida de terceiros entregue ao destinatário por conta e ordem do adquirente originário, em venda à ordem" },
  { codigo: "5120", descricao: "Venda de mercadoria adquirida ou recebida de terceiros entregue ao destinatário pelo vendedor remetente, em venda à ordem" },
  { codigo: "5151", descricao: "Transferência de produção do estabelecimento" },
  { codigo: "5152", descricao: "Transferência de mercadoria adquirida ou recebida de terceiros" },
  { codigo: "5201", descricao: "Devolução de compra para industrialização ou produção rural" },
  { codigo: "5202", descricao: "Devolução de compra para comercialização" },
  { codigo: "5208", descricao: "Devolução de mercadoria recebida em transferência para industrialização ou produção rural" },
  { codigo: "5209", descricao: "Devolução de mercadoria recebida em transferência para comercialização" },
  { codigo: "5210", descricao: "Devolução de compra para utilização na prestação de serviço" },
  { codigo: "5401", descricao: "Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto" },
  { codigo: "5402", descricao: "Venda de produção do estabelecimento de produto sujeito ao regime de substituição tributária, em operação entre contribuintes substitutos do mesmo produto" },
  { codigo: "5403", descricao: "Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto" },
  { codigo: "5405", descricao: "Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído" },
  { codigo: "5409", descricao: "Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "5410", descricao: "Devolução de compra para industrialização ou produção rural em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "5411", descricao: "Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "5551", descricao: "Venda de bem do ativo imobilizado" },
  { codigo: "5556", descricao: "Devolução de compra de material de uso ou consumo" },
  { codigo: "5910", descricao: "Remessa em bonificação, doação ou brinde" },
  { codigo: "5911", descricao: "Remessa de amostra grátis" },
  { codigo: "5912", descricao: "Remessa de mercadoria ou bem para demonstração" },
  { codigo: "5913", descricao: "Retorno de mercadoria ou bem recebido para demonstração" },
  { codigo: "5914", descricao: "Remessa de mercadoria ou bem para exposição ou feira" },
  { codigo: "5915", descricao: "Remessa de mercadoria ou bem para conserto ou reparo" },
  { codigo: "5916", descricao: "Retorno de mercadoria ou bem recebido para conserto ou reparo" },
  { codigo: "5917", descricao: "Remessa de mercadoria em consignação mercantil ou industrial" },
  { codigo: "5918", descricao: "Devolução de mercadoria recebida em consignação mercantil ou industrial" },
  { codigo: "5920", descricao: "Remessa de vasilhame ou sacaria" },
  { codigo: "5921", descricao: "Devolução de vasilhame ou sacaria" },
  { codigo: "5922", descricao: "Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura" },
  { codigo: "5923", descricao: "Remessa de mercadoria por conta e ordem de terceiros, em venda à ordem ou em operações com armazém geral ou depósito fechado" },
  { codigo: "5924", descricao: "Remessa para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente" },
  { codigo: "5925", descricao: "Retorno de mercadoria recebida para industrialização por conta e ordem do adquirente da mercadoria, quando aquela não transitar pelo estabelecimento do adquirente" },
  { codigo: "5927", descricao: "Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração" },
  { codigo: "5928", descricao: "Lançamento efetuado a título de baixa de estoque decorrente do encerramento da atividade da empresa" },
  { codigo: "5929", descricao: "Lançamento efetuado em decorrência de emissão de documento fiscal relativo a operação ou prestação também registrada em equipamento Emissor de Cupom Fiscal (ECF)" },
  { codigo: "5949", descricao: "Outra saída de mercadoria ou prestação de serviço não especificada" },
  { codigo: "6101", descricao: "Venda de produção do estabelecimento" },
  { codigo: "6102", descricao: "Venda de mercadoria adquirida ou recebida de terceiros" },
  { codigo: "6103", descricao: "Venda de produção do estabelecimento, efetuada fora do estabelecimento" },
  { codigo: "6104", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, efetuada fora do estabelecimento" },
  { codigo: "6105", descricao: "Venda de produção do estabelecimento que não deva por ele transitar" },
  { codigo: "6106", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar" },
  { codigo: "6107", descricao: "Venda de produção do estabelecimento, destinada a não contribuinte" },
  { codigo: "6108", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, destinada a não contribuinte" },
  { codigo: "6109", descricao: "Venda de produção do estabelecimento, destinada à Zona Franca de Manaus ou Áreas de Livre Comércio" },
  { codigo: "6110", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, destinada à Zona Franca de Manaus ou Áreas de Livre Comércio" },
  { codigo: "6116", descricao: "Venda de produção do estabelecimento originada de encomenda para entrega futura" },
  { codigo: "6117", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, originada de encomenda para entrega futura" },
  { codigo: "6118", descricao: "Venda de produção do estabelecimento entregue ao destinatário por conta e ordem do adquirente originário, em venda à ordem" },
  { codigo: "6119", descricao: "Venda de mercadoria adquirida ou recebida de terceiros entregue ao destinatário por conta e ordem do adquirente originário, em venda à ordem" },
  { codigo: "6120", descricao: "Venda de mercadoria adquirida ou recebida de terceiros entregue ao destinatário pelo vendedor remetente, em venda à ordem" },
  { codigo: "6151", descricao: "Transferência de produção do estabelecimento" },
  { codigo: "6152", descricao: "Transferência de mercadoria adquirida ou recebida de terceiros" },
  { codigo: "6201", descricao: "Devolução de compra para industrialização ou produção rural" },
  { codigo: "6202", descricao: "Devolução de compra para comercialização" },
  { codigo: "6208", descricao: "Devolução de mercadoria recebida em transferência para industrialização ou produção rural" },
  { codigo: "6209", descricao: "Devolução de mercadoria recebida em transferência para comercialização" },
  { codigo: "6210", descricao: "Devolução de compra para utilização na prestação de serviço" },
  { codigo: "6401", descricao: "Venda de produção do estabelecimento em operação com produto sujeito ao regime de substituição tributária, na condição de contribuinte substituto" },
  { codigo: "6402", descricao: "Venda de produção do estabelecimento de produto sujeito ao regime de substituição tributária, em operação entre contribuintes substitutos do mesmo produto" },
  { codigo: "6403", descricao: "Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituto" },
  { codigo: "6404", descricao: "Venda de mercadoria sujeita ao regime de substituição tributária, cujo imposto já tenha sido retido anteriormente" },
  { codigo: "6405", descricao: "Venda de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária, na condição de contribuinte substituído" },
  { codigo: "6409", descricao: "Transferência de mercadoria adquirida ou recebida de terceiros em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "6410", descricao: "Devolução de compra para industrialização ou produção rural em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "6411", descricao: "Devolução de compra para comercialização em operação com mercadoria sujeita ao regime de substituição tributária" },
  { codigo: "6551", descricao: "Venda de bem do ativo imobilizado" },
  { codigo: "6556", descricao: "Devolução de compra de material de uso ou consumo" },
  { codigo: "6910", descricao: "Remessa em bonificação, doação ou brinde" },
  { codigo: "6911", descricao: "Remessa de amostra grátis" },
  { codigo: "6912", descricao: "Remessa de mercadoria ou bem para demonstração" },
  { codigo: "6913", descricao: "Retorno de mercadoria ou bem recebido para demonstração" },
  { codigo: "6914", descricao: "Remessa de mercadoria ou bem para exposição ou feira" },
  { codigo: "6915", descricao: "Remessa de mercadoria ou bem para conserto ou reparo" },
  { codigo: "6916", descricao: "Retorno de mercadoria ou bem recebido para conserto ou reparo" },
  { codigo: "6917", descricao: "Remessa de mercadoria em consignação mercantil ou industrial" },
  { codigo: "6918", descricao: "Devolução de mercadoria recebida em consignação mercantil ou industrial" },
  { codigo: "6920", descricao: "Remessa de vasilhame ou sacaria" },
  { codigo: "6921", descricao: "Devolução de vasilhame ou sacaria" },
  { codigo: "6922", descricao: "Lançamento efetuado a título de simples faturamento decorrente de venda para entrega futura" },
  { codigo: "6923", descricao: "Remessa de mercadoria por conta e ordem de terceiros, em venda à ordem ou em operações com armazém geral ou depósito fechado" },
  { codigo: "6924", descricao: "Remessa para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente" },
  { codigo: "6925", descricao: "Retorno de mercadoria recebida para industrialização por conta e ordem do adquirente da mercadoria, quando aquela não transitar pelo estabelecimento do adquirente" },
  { codigo: "6927", descricao: "Lançamento efetuado a título de baixa de estoque decorrente de perda, roubo ou deterioração" },
  { codigo: "6928", descricao: "Lançamento efetuado a título de baixa de estoque decorrente do encerramento da atividade da empresa" },
  { codigo: "6949", descricao: "Outra saída de mercadoria ou prestação de serviço não especificada" },
  { codigo: "7101", descricao: "Venda de produção do estabelecimento" },
  { codigo: "7102", descricao: "Venda de mercadoria adquirida ou recebida de terceiros" },
  { codigo: "7105", descricao: "Venda de produção do estabelecimento, que não deva por ele transitar" },
  { codigo: "7106", descricao: "Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar" },
  { codigo: "7127", descricao: "Venda de produção do estabelecimento sob o regime de drawback" },
  { codigo: "7949", descricao: "Outra saída de mercadoria ou prestação de serviço não especificada" }
] as const;
export const CFOP_FONTE = { fonte: "Convênio SINIEF s/nº 1970 — Anexo CFOP (subconjunto do varejo)", ato: "Ajuste SINIEF 07/2001 e alterações", url: "https://www.confaz.fazenda.gov.br/legislacao/ajustes/2001/AJ_007_01", conferidaEm: "2026-11-09" } as const;
const CFOP_POR_CODIGO = new Map(CFOP_SAIDA_VAREJO.map((i) => [i.codigo, i]));
export function descricaoCfop(codigo: string): string | null { return CFOP_POR_CODIGO.get(String(codigo ?? "").replace(/\D/g, ""))?.descricao ?? null; }
/** Opções de CFOP para lista: `grupo` "5" | "6" | "7" | "56" (5 e 6). Rótulo "código — descrição". */
export function opcoesCfop(grupo: "5" | "6" | "7" | "56" = "56"): { valor: string; rotulo: string }[] {
  const aceita = (c: string) => grupo === "56" ? c[0] === "5" || c[0] === "6" : c[0] === grupo;
  return CFOP_SAIDA_VAREJO.filter((i) => aceita(i.codigo)).map((i) => ({ valor: i.codigo, rotulo: `${i.codigo} — ${i.descricao}` }));
}
