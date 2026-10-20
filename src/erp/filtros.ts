import { useEffect, useState } from "react";

/** minúsculas e sem acentos — "Maçã" vira "maca" */
export const normalizar = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Verifica se um texto (ex.: descrição do lançamento) cita o nome de um cliente/fornecedor,
 * ignorando acentos, maiúsculas e sufixos societários (LTDA, ME, EPP, S/A, EIRELI…).
 */
export function citaNome(texto: string, nome: string): boolean {
  const limpar = (x: string) =>
    normalizar(x).replace(/\b(ltda|me|epp|eireli|mei|s\/?a|cia)\b\.?/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const n = limpar(nome);
  return n.length >= 3 && ` ${limpar(texto)} `.includes(` ${n} `);
}

const soDigitos = (s: string) => (s ?? "").replace(/\D/g, "");

/** Data local no formato yyyy-mm-dd (evita o erro de fuso do toISOString após 21h) */
export function dataLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(iso + "T12:00");
  d.setDate(d.getDate() + dias);
  return dataLocal(d);
}

/** Diferença em dias inteiros: b − a */
export function diasEntre(a: string, b: string): number {
  return Math.round((new Date(b + "T12:00").getTime() - new Date(a + "T12:00").getTime()) / 864e5);
}

/** Converte "150", "150,5", "1.234,56" em número (ou NaN) */
export function lerNumero(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return NaN;
  // "1.234,56" → vírgula decimal · "1.000" / "12.500" → ponto de milhar · "50.5" → ponto decimal
  const milhar = /^\d{1,3}(\.\d{3})+$/.test(t);
  const norm = t.includes(",") || milhar ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(norm);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Busca textual global: todas as palavras digitadas precisam aparecer em algum campo.
 * Ignora maiúsculas/acentos. Números também casam só pelos dígitos (CPF/CNPJ/chave com ou sem máscara)
 * e por valor exato ("150,00" encontra 150).
 */
export function casaTexto(termo: string, campos: (string | number | undefined | null)[]): boolean {
  const t = normalizar(termo.trim());
  if (!t) return true;
  const textos = campos.filter((c) => c != null && c !== "").map((c) => normalizar(String(c)));
  const alvo = textos.join(" | ");
  const valorBuscado = lerNumero(termo);
  if (Number.isFinite(valorBuscado) && /[\d]/.test(termo)) {
    const temValor = campos.some((c) => typeof c === "number" && Math.abs(c - valorBuscado) < 0.005);
    if (temValor) return true;
  }
  return t.split(/\s+/).every((palavra) => {
    if (alvo.includes(palavra)) return true;
    const dig = soDigitos(palavra);
    return dig.length >= 3 && textos.some((x) => soDigitos(x).includes(dig));
  });
}

// ---------------------------------------------------------------- períodos
export type PresetPeriodo =
  | "todos"
  | "hoje"
  | "ontem"
  | "ult7"
  | "ult30"
  | "7dias"
  | "30dias"
  | "mes"
  | "mesAnterior"
  | "vencidos30"
  | "personalizado";

export const ROTULO_PERIODO: Record<PresetPeriodo, string> = {
  todos: "Todos",
  hoje: "Hoje",
  ontem: "Ontem",
  ult7: "Últimos 7 dias",
  ult30: "Últimos 30 dias",
  "7dias": "Próx. 7 dias",
  "30dias": "Próx. 30 dias",
  mes: "Este mês",
  mesAnterior: "Mês anterior",
  vencidos30: "Vencidos + 30 dias",
  personalizado: "Personalizado",
};

/** Intervalo [de, até] inclusivo. Strings vazias = sem limite. */
export function intervaloPeriodo(p: PresetPeriodo, de = "", ate = ""): { de: string; ate: string } {
  const hoje = dataLocal();
  const d = new Date();
  switch (p) {
    case "hoje":
      return { de: hoje, ate: hoje };
    case "ontem": {
      const o = somarDias(hoje, -1);
      return { de: o, ate: o };
    }
    case "ult7":
      return { de: somarDias(hoje, -6), ate: hoje };
    case "ult30":
      return { de: somarDias(hoje, -29), ate: hoje };
    case "7dias":
      return { de: hoje, ate: somarDias(hoje, 7) };
    case "30dias":
      return { de: hoje, ate: somarDias(hoje, 30) };
    case "mes":
      return {
        de: dataLocal(new Date(d.getFullYear(), d.getMonth(), 1)),
        ate: dataLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      };
    case "mesAnterior":
      return {
        de: dataLocal(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        ate: dataLocal(new Date(d.getFullYear(), d.getMonth(), 0)),
      };
    case "vencidos30":
      return { de: "", ate: somarDias(hoje, 30) };
    case "personalizado":
      return { de, ate };
    default:
      return { de: "", ate: "" };
  }
}

export const dentroDoIntervalo = (iso: string, i: { de: string; ate: string }) =>
  (!i.de || iso >= i.de) && (!i.ate || iso <= i.ate);

/** Liga/desliga um valor numa lista (filtros de seleção múltipla) */
export function alternar<T>(lista: T[], v: T): T[] {
  return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v];
}

/** Estado de filtros salvo no navegador por módulo (nkway.filtros.<modulo>) */
export function useFiltrosSalvos<T extends object>(modulo: string, padrao: T) {
  const KEY = `nkway.filtros.${modulo}`;
  const [f, setF] = useState<T>(() => {
    try {
      return { ...padrao, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    } catch {
      return padrao;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(f));
    } catch {
      /* ignora quota */
    }
  }, [KEY, f]);
  const set = <K extends keyof T>(k: K, v: T[K]) => setF((s) => ({ ...s, [k]: v }));
  /** liga/desliga um valor numa lista do filtro (seguro para cliques rápidos) */
  const toggle = <K extends keyof T>(k: K, v: T[K] extends (infer U)[] ? U : never) =>
    setF((s) => ({ ...s, [k]: alternar(s[k] as unknown[], v) }));
  const limpar = () => setF(padrao);
  return { f, set, toggle, setF, limpar };
}
