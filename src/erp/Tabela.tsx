import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

// ------------------------------------------------------------------ ordenação
export type Direcao = "asc" | "desc";
type Valor = string | number | null | undefined;

/**
 * Ordena a lista pela coluna escolhida. Clicar de novo na mesma coluna inverte a direção.
 * Textos são comparados em português (ignora acentos e maiúsculas); vazios vão para o fim.
 */
export function useOrdenacao<T, C extends string>(
  lista: T[],
  acessores: Record<C, (item: T) => Valor>,
  padrao: { col: C; dir: Direcao },
) {
  const [ord, setOrd] = useState(padrao);
  const ordenada = useMemo(() => {
    const get = acessores[ord.col];
    if (!get) return lista;
    const fator = ord.dir === "asc" ? 1 : -1;
    return [...lista].sort((a, b) => {
      const va = get(a), vb = get(b);
      const vaVazio = va == null || va === "", vbVazio = vb == null || vb === "";
      if (vaVazio && vbVazio) return 0;
      if (vaVazio) return 1;
      if (vbVazio) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * fator;
      return String(va).localeCompare(String(vb), "pt-BR", { sensitivity: "base", numeric: true }) * fator;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, ord]);
  const ordenar = (col: C) =>
    setOrd((o) => (o.col === col ? { col, dir: o.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" }));
  return { ordenada, col: ord.col, dir: ord.dir, ordenar };
}

/** Cabeçalho de coluna clicável para ordenar */
export function ThOrd<C extends string>({
  col,
  atual,
  dir,
  onOrdenar,
  children,
  alinhar = "left",
  className,
}: {
  col: C;
  atual: C;
  dir: Direcao;
  onOrdenar: (c: C) => void;
  children: ReactNode;
  alinhar?: "left" | "right" | "center";
  className?: string;
}) {
  const ativo = col === atual;
  return (
    <th
      className={cn("px-4 py-3", alinhar === "right" && "text-right", alinhar === "center" && "text-center", className)}
      aria-sort={ativo ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        data-col={col}
        onClick={() => onOrdenar(col)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-800",
          ativo ? "font-bold text-sky-700" : "",
        )}
        title="Clique para ordenar"
      >
        {children}
        <span className={cn("text-[10px]", ativo ? "opacity-100" : "opacity-30")}>{ativo && dir === "desc" ? "▼" : "▲"}</span>
      </button>
    </th>
  );
}

// ------------------------------------------------------------------ paginação
export function usePaginacao<T>(lista: T[], chave: string, tamanhoPadrao = 25) {
  const KEY = `nkway.pagina.${chave}`;
  const [tamanho, setTamanhoState] = useState<number>(() => Number(localStorage.getItem(KEY)) || tamanhoPadrao);
  const [pagina, setPagina] = useState(1);
  const total = lista.length;
  const paginas = tamanho > 0 ? Math.max(1, Math.ceil(total / tamanho)) : 1;
  // ao filtrar, volta para a primeira página
  useEffect(() => setPagina(1), [total]);
  const atual = Math.min(pagina, paginas);
  const itens = tamanho > 0 ? lista.slice((atual - 1) * tamanho, atual * tamanho) : lista;
  const setTamanho = (n: number) => {
    setTamanhoState(n);
    setPagina(1);
    try { localStorage.setItem(KEY, String(n)); } catch { /* ignora */ }
  };
  return { itens, pagina: atual, paginas, tamanho, total, setPagina, setTamanho };
}

export function Paginacao({
  pagina,
  paginas,
  tamanho,
  total,
  setPagina,
  setTamanho,
}: ReturnType<typeof usePaginacao<unknown>>) {
  if (total === 0) return null;
  const ini = tamanho > 0 ? (pagina - 1) * tamanho + 1 : 1;
  const fim = tamanho > 0 ? Math.min(total, pagina * tamanho) : total;
  const btn = "rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>Mostrando <b className="text-slate-800">{ini}–{fim}</b> de <b className="text-slate-800">{total}</b></span>
      <div className="flex items-center gap-1.5">
        <label className="mr-2 flex items-center gap-1.5">
          Por página
          <select value={tamanho} onChange={(e) => setTamanho(Number(e.target.value))} aria-label="Itens por página"
            className="rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs font-semibold text-slate-700">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            <option value={0}>Todos</option>
          </select>
        </label>
        <button type="button" className={btn} disabled={pagina <= 1} onClick={() => setPagina(1)} aria-label="Primeira página">«</button>
        <button type="button" className={btn} disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} aria-label="Página anterior">‹</button>
        <span className="px-1.5 font-semibold text-slate-700">{pagina} / {paginas}</span>
        <button type="button" className={btn} disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} aria-label="Próxima página">›</button>
        <button type="button" className={btn} disabled={pagina >= paginas} onClick={() => setPagina(paginas)} aria-label="Última página">»</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ exportação
/**
 * Baixa um CSV que abre direto no Excel em português:
 * separador ";", vírgula decimal e BOM UTF-8 (acentos corretos).
 */
export function exportarCsv(nomeArquivo: string, cabecalho: string[], linhas: Valor[][]) {
  const cel = (v: Valor) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cabecalho, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nomeArquivo}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Botão padrão de exportar */
export function BotaoExportar({ onClick, total }: { onClick: () => void; total: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={total === 0}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
      title="Exporta a lista filtrada para Excel (CSV)"
    >
      ⬇ Exportar ({total})
    </button>
  );
}
