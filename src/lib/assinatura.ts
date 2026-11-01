/**
 * NKWAY — Regras de domínio de Assinatura Comercial e Recorrência por CNPJ.
 * Módulo puro (sem dependências Node), compartilhado entre interface, Server Actions e testes.
 */
import { PLANOS_CFG, hojeISO, planoById, round2, soDigitos, somaDias, validarCnpj } from "@/lib/dominio";

export const CICLOS_ASSINATURA = ["mensal", "anual"] as const;
export type CicloAssinatura = (typeof CICLOS_ASSINATURA)[number];

export const FORMAS_ASSINATURA = [
  { id: "pix", rotulo: "PIX Recorrente", descricao: "Liberação imediata após leitura do QR Code ou Copia e Cola" },
  { id: "boleto", rotulo: "Boleto Registrado (CNPJ)", descricao: "Faturado contra o CNPJ da empresa com linha digitável" },
  { id: "cartao", rotulo: "Cartão de Crédito", descricao: "Renovação automática no vencimento sem ocupar fluxo de caixa" },
] as const;

export type FormaAssinatura = (typeof FORMAS_ASSINATURA)[number]["id"];

export type StatusAssinatura = "ativa" | "aguardando_pagamento" | "inadimplente" | "cancelada";
export type StatusFaturaAssinatura = "pendente" | "paga" | "vencida" | "cancelada" | "estornada";

export const ROTULO_STATUS_ASSINATURA: Record<
  StatusAssinatura,
  { rotulo: string; tom: "ok" | "alerta" | "erro" | "neutro" }
> = {
  ativa: { rotulo: "Ativa", tom: "ok" },
  aguardando_pagamento: { rotulo: "Aguardando pagamento", tom: "alerta" },
  inadimplente: { rotulo: "Em atraso", tom: "erro" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
};

export const ROTULO_STATUS_FATURA: Record<
  StatusFaturaAssinatura,
  { rotulo: string; tom: "ok" | "alerta" | "erro" | "neutro" }
> = {
  paga: { rotulo: "Paga", tom: "ok" },
  pendente: { rotulo: "Aguardando pagamento", tom: "alerta" },
  vencida: { rotulo: "Vencida", tom: "erro" },
  cancelada: { rotulo: "Cancelada", tom: "neutro" },
  estornada: { rotulo: "Estornada", tom: "erro" },
};

/** Desconto comercial de 20% para contratação no ciclo anual */
export const DESCONTO_ANUAL_PCT = 20;

export function calcularPrecoAssinatura(
  planoId: string,
  ciclo: CicloAssinatura,
): {
  planoId: string;
  planoNome: string;
  precoBaseMensal: number;
  mensalEquivalente: number;
  valorCiclo: number;
  economiaAnual: number;
  diasCiclo: number;
} {
  const plano = planoById(planoId);
  const base = round2(plano.preco);
  if (base <= 0) {
    return {
      planoId: plano.id,
      planoNome: plano.nome,
      precoBaseMensal: 0,
      mensalEquivalente: 0,
      valorCiclo: 0,
      economiaAnual: 0,
      diasCiclo: 30,
    };
  }
  if (ciclo === "anual") {
    const mensalEq = round2(base * (1 - DESCONTO_ANUAL_PCT / 100));
    const valorAnual = round2(mensalEq * 12);
    const economia = round2(base * 12 - valorAnual);
    return {
      planoId: plano.id,
      planoNome: plano.nome,
      precoBaseMensal: base,
      mensalEquivalente: mensalEq,
      valorCiclo: valorAnual,
      economiaAnual: economia,
      diasCiclo: 365,
    };
  }
  return {
    planoId: plano.id,
    planoNome: plano.nome,
    precoBaseMensal: base,
    mensalEquivalente: base,
    valorCiclo: base,
    economiaAnual: 0,
    diasCiclo: 30,
  };
}

export function calcularProximoVencimento(baseIso: string | null | undefined, ciclo: CicloAssinatura): string {
  const ref = baseIso && /^\d{4}-\d{2}-\d{2}/.test(baseIso) ? baseIso.slice(0, 10) : hojeISO();
  return somaDias(ref, ciclo === "anual" ? 365 : 30);
}

export function validarCnpjAssinatura(cnpj: string | null | undefined): { ok: true; cnpj14: string } | { ok: false; erro: string } {
  const limpo = soDigitos(cnpj);
  if (limpo.length !== 14) {
    return { ok: false, erro: "A assinatura recorrente B2B exige um CNPJ com 14 dígitos." };
  }
  if (!validarCnpj(limpo)) {
    return { ok: false, erro: "CNPJ inválido para faturamento: os dígitos verificadores não conferem." };
  }
  return { ok: true, cnpj14: limpo };
}

/* ------------------------------------------- PIX EMV BR Code + CRC-16 CCITT */

function tlv(id: string, valor: string): string {
  const limpo = String(valor ?? "");
  return `${id}${String(limpo.length).padStart(2, "0")}${limpo}`;
}

/** CRC-16/CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF) exigido pelo Banco Central no campo 6304 */
export function crc16Pix(payloadSemCrc4: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payloadSemCrc4.length; i++) {
    crc ^= payloadSemCrc4.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function validarPayloadPixEmv(payload: string | null | undefined): boolean {
  const s = String(payload ?? "").trim();
  if (s.length < 30 || !s.startsWith("000201") || !s.slice(0, -4).endsWith("6304")) return false;
  const esperado = crc16Pix(s.slice(0, -4));
  return esperado === s.slice(-4).toUpperCase();
}

/**
 * Monta payload PIX Copia e Cola enxuto (≤ 124 bytes, compatível com QR Code SVG versões 1-6).
 */
export function gerarPayloadPixEmv(params: {
  chavePix?: string;
  nomeRecebedor?: string;
  cidade?: string;
  valor: number;
  txid: string;
}): string {
  const chave = (params.chavePix || "pix@nkway.com.br").slice(0, 22);
  const nome = (params.nomeRecebedor || "NKWAY ERP")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .slice(0, 12)
    .trim() || "NKWAY";
  const cidade = (params.cidade || "JI PARANA")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .slice(0, 10)
    .trim() || "BRASIL";
  const txid = (params.txid || "NKWAY01").replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "NKWAY01";
  const valorFmt = round2(Math.max(0.01, params.valor)).toFixed(2);

  const merchantAccount = tlv("00", "br.gov.bcb.pix") + tlv("01", chave);
  const campoAdicional = tlv("05", txid);

  const corpo =
    tlv("00", "01") +
    tlv("26", merchantAccount) +
    tlv("52", "0000") +
    tlv("53", "986") +
    tlv("54", valorFmt) +
    tlv("58", "BR") +
    tlv("59", nome) +
    tlv("60", cidade) +
    tlv("62", campoAdicional) +
    "6304";

  return `${corpo}${crc16Pix(corpo)}`;
}

/* ------------------------------------ Boleto Registrado FEBRABAN 47 dígitos */

function dvMod10(bloco: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = bloco.length - 1; i >= 0; i--) {
    let mult = Number(bloco[i]) * peso;
    if (mult > 9) mult = Math.floor(mult / 10) + (mult % 10);
    soma += mult;
    peso = peso === 2 ? 1 : 2;
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

function dvMod11Boleto(codigo43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = codigo43.length - 1; i >= 0; i--) {
    soma += Number(codigo43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const sub = 11 - (soma % 11);
  return sub === 0 || sub === 10 || sub === 11 ? 1 : sub;
}

/** Gera linha digitável bancária de 47 dígitos com DVs Mod-10 e Mod-11 válidos */
export function gerarLinhaDigitavelBoleto(params: {
  valor: number;
  vencimentoIso: string;
  nossoNumero: number;
}): string {
  const banco = "461"; // Asaas IP S.A. (461)
  const moedaCod = "9";
  // Fator de vencimento base 2025-02-22 = 1000 (reinício FEBRABAN)
  const baseData = Date.UTC(2025, 1, 22);
  const partes = (params.vencimentoIso || hojeISO()).slice(0, 10).split("-").map(Number);
  const alvoData = Date.UTC(partes[0] || 2026, (partes[1] || 1) - 1, partes[2] || 1);
  const dias = Math.max(1000, Math.min(9999, 1000 + Math.round((alvoData - baseData) / 86_400_000)));
  const fator = String(dias).padStart(4, "0");
  const centavos = String(Math.round(round2(Math.max(0, params.valor)) * 100)).padStart(10, "0").slice(-10);
  const campoLivre = `00019${String(Math.abs(params.nossoNumero)).padStart(11, "0").slice(-11)}010100001`.slice(0, 25);

  const semDac43 = `${banco}${moedaCod}${fator}${centavos}${campoLivre}`;
  const dacGeral = dvMod11Boleto(semDac43);

  const c1Base = `${banco}${moedaCod}${campoLivre.slice(0, 5)}`;
  const c1 = `${c1Base.slice(0, 5)}.${c1Base.slice(5)}${dvMod10(c1Base)}`;

  const c2Base = campoLivre.slice(5, 15);
  const c2 = `${c2Base.slice(0, 5)}.${c2Base.slice(5)}${dvMod10(c2Base)}`;

  const c3Base = campoLivre.slice(15, 25);
  const c3 = `${c3Base.slice(0, 5)}.${c3Base.slice(5)}${dvMod10(c3Base)}`;

  const c4 = String(dacGeral);
  const c5 = `${fator}${centavos}`;

  return `${c1} ${c2} ${c3} ${c4} ${c5}`;
}

export function validarLinhaDigitavelBoleto(linha: string | null | undefined): boolean {
  const dig = soDigitos(linha);
  if (dig.length !== 47) return false;
  const c1Ok = dvMod10(dig.slice(0, 9)) === Number(dig[9]);
  const c2Ok = dvMod10(dig.slice(10, 20)) === Number(dig[20]);
  const c3Ok = dvMod10(dig.slice(21, 31)) === Number(dig[31]);
  const campoLivre = `${dig.slice(4, 9)}${dig.slice(10, 20)}${dig.slice(21, 31)}`;
  const semDac43 = `${dig.slice(0, 4)}${dig.slice(33, 47)}${campoLivre}`;
  const dacOk = dvMod11Boleto(semDac43) === Number(dig[32]);
  return c1Ok && c2Ok && c3Ok && dacOk;
}

/* -------------------------------------- Validação Luhn de Cartão (em RAM) */

export function detectarBandeiraCartao(numeroLimpo: string): string {
  const d = soDigitos(numeroLimpo);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard";
  if (/^(4011|4312|4389|4514|4576|5041|5067|5090|6277|6362|6363|650|6516|6550)/.test(d)) return "Elo";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^(606282|3841)/.test(d)) return "Hipercard";
  return "Cartão";
}

/** Valida número de cartão pelo algoritmo de Luhn (usado só em memória; nunca persistir PAN) */
export function validarCartaoLuhn(numeroCartao: string | null | undefined): boolean {
  const d = soDigitos(numeroCartao);
  if (d.length < 13 || d.length > 19 || /^(\d)\1+$/.test(d)) return false;
  let soma = 0;
  let dobrar = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dobrar) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    soma += n;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

export function planoPagoValido(planoId: string): boolean {
  return PLANOS_CFG.some((p) => p.id === planoId && p.preco > 0);
}
