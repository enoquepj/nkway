/**
 * Base de filtros reutilizável dos módulos (porta de src/erp/filtros.ts).
 * Tudo aqui é determinístico e roda no cliente ou no servidor.
 */

export type Periodo = { inicio: string; fim: string };

export const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** busca textual tolerante a acento, múltiplos termos e parte do início da palavra */
export function casaTexto(valor: string | null | undefined, termo: string): boolean {
  if (!termo.trim()) return true;
  const alvo = semAcento(valor ?? "");
  return semAcento(termo)
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => alvo.includes(t));
}

/** aceita "1.234,56", "1234.56" e "R$ 1.234,56"; devolve null quando não é número */
export function lerNumero(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  const limpo = texto.replace(/[^\d.,-]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",")
    ? Number(limpo.replace(/\./g, "").replace(",", "."))
    : Number(limpo);
  return Number.isFinite(normal) ? normal : null;
}

export function emPeriodo(data: string | Date | null | undefined, p: Periodo): boolean {
  if (!data) return false;
  const d = typeof data === "string" ? data.slice(0, 10) : data.toISOString().slice(0, 10);
  if (p.inicio && d < p.inicio) return false;
  if (p.fim && d > p.fim) return false;
  return true;
}

export function periodoRelativo(dias: number): Periodo {
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - (dias - 1));
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

export type Compara<T> = (a: T, b: T) => number;

export function ordenar<T>(linhas: T[], campo: keyof T | null, dir: "asc" | "desc"): T[] {
  if (!campo) return linhas;
  const copia = [...linhas];
  copia.sort((a, b) => {
    const va = a[campo];
    const vb = b[campo];
    if (typeof va === "number" && typeof vb === "number") return dir === "asc" ? va - vb : vb - va;
    const sa = String(va ?? "");
    const sb = String(vb ?? "");
    return dir === "asc" ? sa.localeCompare(sb, "pt-BR") : sb.localeCompare(sa, "pt-BR");
  });
  return copia;
}

export function alternarItem<T>(lista: T[], item: T): T[] {
  return lista.includes(item) ? lista.filter((x) => x !== item) : [...lista, item];
}

export function resumoFiltros(ativos: Record<string, string | number | boolean | string[] | null>): string[] {
  return Object.entries(ativos)
    .filter(([, v]) => v !== "" && v !== null && v !== false && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
}
