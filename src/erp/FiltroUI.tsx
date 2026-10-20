import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../utils/cn";

/** Linha de caixas de seleção dos filtros principais */
export function LinhaFiltros({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

const caixaBase =
  "h-9 rounded-lg border bg-white pl-3 pr-8 text-sm font-medium outline-none transition focus:ring-2 focus:ring-sky-100";

/** Caixa de seleção única (nativa) com rótulo acima */
export function SelectFiltro<T extends string>({
  rotulo,
  valor,
  onChange,
  opcoes,
  padrao,
  largura = "min-w-[170px]",
}: {
  rotulo: string;
  valor: T;
  onChange: (v: T) => void;
  opcoes: { valor: T; rotulo: string }[];
  /** valor considerado "sem filtro" (não destaca a caixa) */
  padrao?: T;
  largura?: string;
}) {
  const id = useId();
  const ativo = padrao !== undefined && valor !== padrao;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onChange(e.target.value as T)}
        aria-label={rotulo}
        className={cn(
          caixaBase,
          largura,
          "cursor-pointer appearance-none bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat",
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath d='M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z'/%3E%3C/svg%3E\")]",
          ativo ? "border-sky-500 text-sky-800 ring-1 ring-sky-200" : "border-slate-300 text-slate-700 focus:border-sky-500",
        )}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
    </div>
  );
}

/** Caixa de seleção múltipla: abre uma lista com caixas de marcar e contagens */
export function MultiSelectFiltro<T extends string>({
  rotulo,
  opcoes,
  selecionados,
  onToggle,
  onLimpar,
  contagem,
  extra,
  largura = "min-w-[170px]",
}: {
  rotulo: string;
  opcoes: { valor: T; rotulo: string }[];
  selecionados: T[];
  onToggle: (v: T) => void;
  onLimpar: () => void;
  contagem?: Partial<Record<T, number>>;
  /** conteúdo adicional no rodapé da lista (ex.: modo "é / não é") */
  extra?: ReactNode;
  largura?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setAberto(false); } };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc, true); };
  }, [aberto]);

  const nomes = opcoes.filter((o) => selecionados.includes(o.valor)).map((o) => o.rotulo);
  const resumo = nomes.length === 0 ? "Todos" : nomes.length <= 2 ? nomes.join(", ") : `${nomes.length} selecionados`;

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <span id={id} className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-labelledby={id}
        data-filtro={rotulo}
        onClick={() => setAberto((a) => !a)}
        className={cn(
          caixaBase,
          largura,
          "relative max-w-[260px] truncate text-left",
          nomes.length ? "border-sky-500 text-sky-800 ring-1 ring-sky-200" : "border-slate-300 text-slate-700 hover:border-slate-400",
        )}
      >
        {resumo}
        <span className={cn("pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 transition", aberto && "rotate-180")}>▼</span>
      </button>

      {aberto && (
        <div role="listbox" aria-multiselectable="true" aria-labelledby={id}
          className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <button
            type="button"
            onClick={onLimpar}
            className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50", !nomes.length && "font-semibold text-sky-700")}
          >
            <span className="w-4">{!nomes.length ? "✓" : ""}</span> Todos
          </button>
          <div className="max-h-64 overflow-y-auto border-t border-slate-100 py-1">
            {opcoes.map((o) => {
              const marcado = selecionados.includes(o.valor);
              const n = contagem?.[o.valor];
              return (
                <label key={o.valor} data-opcao={o.valor} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                  <input type="checkbox" checked={marcado} onChange={() => onToggle(o.valor)} className="h-4 w-4 accent-sky-600" />
                  <span className="flex-1 capitalize">{o.rotulo}</span>
                  {n != null && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] font-semibold text-slate-500">{n}</span>}
                </label>
              );
            })}
          </div>
          {extra && <div className="border-t border-slate-100 bg-slate-50 px-3 py-2">{extra}</div>}
        </div>
      )}
    </div>
  );
}

/** Campo "de / até" com rótulo acima, alinhado às caixas de seleção */
export function IntervaloFiltro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{rotulo}</span>
      <div className="flex h-9 items-center gap-1.5 text-xs text-slate-500">{children}</div>
    </div>
  );
}

/** Painel de filtros: cabeçalho com busca + linha de ações */
export function PainelFiltros({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function BuscaGlobal({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Busca"
        className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpar busca"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Chip de filtro ativo, removível */
export function ChipAtivo({ children, onRemover }: { children: ReactNode; onRemover: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
      {children}
      <button type="button" onClick={onRemover} aria-label="Remover filtro" className="rounded-full px-1.5 text-sky-500 hover:bg-sky-100 hover:text-sky-800">
        ×
      </button>
    </span>
  );
}

export const inputFiltro =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100";
