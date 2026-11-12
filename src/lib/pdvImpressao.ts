/**
 * NKWAY — Configurações de PDV e impressão do cupom (Etapa 1).
 * Inspirado nos ERPs de varejo mais usados (Bling, Omie, Tiny, ContaAzul, TOTVS/Linx):
 * confirmação, vias, cabeçalho/logo, itens cancelados, desconto por item, modo compacto,
 * confissão de dívida no crediário e layout 80mm/A4 — tudo por empresa, sem quebrar o padrão.
 * Módulo puro: sem banco, sem rede, compartilhado entre Config, PDV, Impressao e testes.
 */

export type LayoutCupomPdv = "80mm" | "A4";
export type TamanhoFontePdv = "normal" | "grande";

export type PdvImpressaoConfig = {
  /** 1 — Perguntar "Imprimir agora?" antes de abrir o diálogo de impressão. */
  confirmarAntesImprimir: boolean;
  /** 2 — Mostra bloco de logo (iniciais + fantasia em destaque) no topo do cupom. */
  imprimeLogo: boolean;
  /** 2b — Texto do logo (até 40 chars). Vazio = usa a fantasia da empresa. */
  logoTexto: string;
  /** 3 — Quantas vias saem na impressão (1–3). */
  nroVias: 1 | 2 | 3;
  /** 4 — Mostra cabeçalho completo do emitente (endereço, CNPJ/IE, município). */
  imprimeCabecalho: boolean;
  /** 5 — Lista itens removidos/cancelados no cupom como "CANCELADO" (riscado). */
  imprimirItensCancelados: boolean;
  /** 6 — Mostra desconto/acréscimo por item abaixo da linha do produto. */
  imprimirDescontoAcrescimoItens: boolean;
  /** 7 — Uma linha por item (compacto) em vez do bloco detalhado. */
  imprimirUmaLinha: boolean;
  /** 8 — Imprime bloco de confissão de dívida + assinaturas quando há prazo/boleto. */
  confissaoDivida: boolean;
  /** 8b — Texto da confissão (até 600 chars). */
  confissaoTexto: string;
  /** 9 — Largura padrão do comprovante do PDV. */
  layoutCupom: LayoutCupomPdv;
  /** 10a — Mensagem de rodapé (até 140 chars). */
  mensagemRodape: string;
  /** 10b — Exibe tributos aproximados (Lei 12.741) + IBS/CBS. */
  exibirTributos: boolean;
  /** 10c — Exibe operador e terminal no cupom. */
  exibirOperadorCaixa: boolean;
  /** 10d — Exibe bloco do cliente (nome + documento). */
  exibirCliente: boolean;
  /** 10e — Impressão automática após concluir a venda (respeita a confirmação). */
  impressaoAutomatica: boolean;
  /** 10f — Tamanho da fonte do cupom 80mm. */
  tamanhoFonte: TamanhoFontePdv;
};

export const PDV_IMPRESSAO_PADRAO: PdvImpressaoConfig = {
  confirmarAntesImprimir: true,
  imprimeLogo: false,
  logoTexto: "",
  nroVias: 1,
  imprimeCabecalho: true,
  imprimirItensCancelados: false,
  imprimirDescontoAcrescimoItens: true,
  imprimirUmaLinha: false,
  confissaoDivida: false,
  confissaoTexto:
    "Confesso-me devedor(a) do valor acima e comprometo-me a pagá-lo no vencimento, autorizando a cobrança e a inclusão nos cadastros de proteção ao crédito em caso de inadimplência.",
  layoutCupom: "80mm",
  mensagemRodape: "Obrigado pela preferência! Volte sempre.",
  exibirTributos: true,
  exibirOperadorCaixa: true,
  exibirCliente: true,
  impressaoAutomatica: false,
  tamanhoFonte: "normal",
};

export const ROTULO_VIA_PDV: Record<number, string> = {
  1: "Consumidor",
  2: "Arquivo / Caixa",
  3: "Contabilidade",
};

const MAX_TEXTO = 600;

function bool(v: unknown, padrao: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "sim" || v === "true") return true;
  if (v === 0 || v === "0" || v === "nao" || v === "não" || v === "false") return false;
  return padrao;
}

function texto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Sanitiza qualquer JSON vindo do banco/cliente para um config válido. Nunca lança. */
export function sanitizarConfigPdvImpressao(bruto: unknown): PdvImpressaoConfig {
  const f = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const vias = Number(f.nroVias);
  const layout = String(f.layoutCupom ?? "80mm");
  const fonte = String(f.tamanhoFonte ?? "normal");
  return {
    confirmarAntesImprimir: bool(f.confirmarAntesImprimir, true),
    imprimeLogo: bool(f.imprimeLogo, false),
    logoTexto: texto(f.logoTexto, 40),
    nroVias: vias === 2 ? 2 : vias === 3 ? 3 : 1,
    imprimeCabecalho: bool(f.imprimeCabecalho, true),
    imprimirItensCancelados: bool(f.imprimirItensCancelados, false),
    imprimirDescontoAcrescimoItens: bool(f.imprimirDescontoAcrescimoItens, true),
    imprimirUmaLinha: bool(f.imprimirUmaLinha, false),
    confissaoDivida: bool(f.confissaoDivida, false),
    confissaoTexto: texto(f.confissaoTexto, MAX_TEXTO) || PDV_IMPRESSAO_PADRAO.confissaoTexto,
    layoutCupom: layout === "A4" ? "A4" : "80mm",
    mensagemRodape: texto(f.mensagemRodape, 140),
    exibirTributos: bool(f.exibirTributos, true),
    exibirOperadorCaixa: bool(f.exibirOperadorCaixa, true),
    exibirCliente: bool(f.exibirCliente, true),
    impressaoAutomatica: bool(f.impressaoAutomatica, false),
    tamanhoFonte: fonte === "grande" ? "grande" : "normal",
  };
}

/** Formas que caracterizam crediário (prazo) e pedem confissão de dívida. */
const FORMAS_PRAZO = new Set(["prazo", "boleto", "crediario", "carnê", "carne", "conta_receber"]);

export function vendaTemPrazo(formas: readonly string[]): boolean {
  return formas.some((f) => FORMAS_PRAZO.has(String(f ?? "").trim().toLowerCase()));
}

export function deveImprimirConfissao(cfg: PdvImpressaoConfig, formas: readonly string[], tipoVenda: string): boolean {
  if (!cfg.confissaoDivida) return false;
  if (tipoVenda === "dav") return false;
  return vendaTemPrazo(formas);
}

/** Iniciais para o bloco de logo (ex.: "MS" de "Mercado São José"). */
export function iniciaisLogoPdv(nome: string): string {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "NK";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/** Rótulos das vias para impressão (1 via = sem sufixo; 2+ = "Via 1 de 2 — Consumidor"). */
export function rotulosViasPdv(nroVias: 1 | 2 | 3): string[] {
  if (nroVias <= 1) return [""];
  return Array.from({ length: nroVias }, (_, i) => `Via ${i + 1} de ${nroVias} — ${ROTULO_VIA_PDV[i + 1] ?? "Adicional"}`);
}
