"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ estilo */

export const cn = (...v: (string | false | null | undefined)[]) => v.filter(Boolean).join(" ");

/* ------------------------------------------------------------------- ícone */

const CAMINHOS: Record<string, ReactNode> = {
  painel: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  caixa: (
    <>
      <path d="M3 7h18l-1.2 12.1a2 2 0 0 1-2 1.9H6.2a2 2 0 0 1-2-1.9L3 7Z" />
      <path d="M8 7V5.5A3.5 3.5 0 0 1 11.5 2h1A3.5 3.5 0 0 1 16 5.5V7" />
      <path d="M9 12h6" />
    </>
  ),
  documento: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  entrada: (
    <>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </>
  ),
  caixaEstoque: (
    <>
      <path d="m12 2 8.5 4.4v10.8L12 22l-8.5-4.4V6.4L12 2Z" />
      <path d="M3.6 6.4 12 11l8.4-4.6M12 11v11" />
    </>
  ),
  etiqueta: (
    <>
      <path d="M3 12.5V5a2 2 0 0 1 2-2h7.5L21 12.5 12.5 21 3 12.5Z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  pessoas: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6M17 20a5.6 5.6 0 0 0-2-4.3" />
    </>
  ),
  carteira: (
    <>
      <rect x="2.5" y="6" width="19" height="13" rx="2.5" />
      <path d="M2.5 10.5h19M16 15h2" />
    </>
  ),
  caminhoes: (
    <>
      <path d="M2 7.5h11v9H2zM13 10.5h4.5l3.5 3.5v2.5H13z" />
      <circle cx="6.5" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </>
  ),
  engrenagem: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.06.06A2 2 0 1 1 4.2 16.9l.06-.06A1.7 1.7 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.06-.06A2 2 0 1 1 7.1 4.2l.06.06A1.7 1.7 0 0 0 10.1 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  busca: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  alerta: (
    <>
      <path d="M12 3.5 2.6 20h18.8L12 3.5Z" />
      <path d="M12 10v4.2M12 17.4v.1" />
    </>
  ),
  impressora: (
    <>
      <path d="M7 9V3h10v6" />
      <rect x="3" y="9" width="18" height="7" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  lixo: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />
    </>
  ),
  baixar: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 18v2h16v-2" />
    </>
  ),
  seta: <path d="M5 12h13m-5-6 6 6-6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  raio: <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" />,
  atualizar: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4.5" y="10" width="15" height="11" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  grafico: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12.5 16V7M17 16v-6" />
    </>
  ),
  copiar: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3H6a3 3 0 0 0-3 3v6.5A2.5 2.5 0 0 0 5.5 15" />
    </>
  ),
  salvar: (
    <>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M8 3v5h7V3M8 21v-6h8v6" />
    </>
  ),
  imprimir: (
    <>
      <path d="M7 8V3h10v5" />
      <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <rect x="7" y="14" width="10" height="7" rx="1" />
    </>
  ),
};

export function Icon({
  name,
  className = "size-4",
  strokeWidth = 1.7,
}: {
  name: keyof typeof CAMINHOS | string;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {CAMINHOS[name] ?? CAMINHOS.painel}
    </svg>
  );
}

/* ---------------------------------------------------------------- superfícies */

export function Card({
  children,
  className,
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(16,24,40,.06),0_8px_24px_-16px_rgba(16,24,40,.25)]",
        padding && "p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function CardTitulo({
  titulo,
  descricao,
  acao,
  icone,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  icone?: string;
}) {
  return (
    <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {icone && (
          <span className="mt-0.5 grid size-7 place-items-center rounded-lg bg-way-50 text-way-600">
            <Icon name={icone} className="size-4" />
          </span>
        )}
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight text-ink-800">{titulo}</h2>
          {descricao && <p className="text-[11.5px] leading-tight text-ink-400">{descricao}</p>}
        </div>
      </div>
      {acao}
    </header>
  );
}

export function PageHeader({
  titulo,
  subtitulo,
  acao,
  etiquetas,
}: {
  titulo: string;
  subtitulo?: string;
  acao?: ReactNode;
  etiquetas?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink-900">{titulo}</h1>
        {subtitulo && <p className="mt-0.5 text-[13px] text-ink-400">{subtitulo}</p>}
        {etiquetas && <div className="mt-2 flex flex-wrap items-center gap-1.5">{etiquetas}</div>}
      </div>
      {acao && <div className="flex flex-wrap items-center gap-2">{acao}</div>}
    </div>
  );
}

type Tom = "neutro" | "ok" | "alerta" | "erro" | "info" | "roxo";
const TONS: Record<Tom, string> = {
  neutro: "bg-ink-50 text-ink-500 ring-ink-100",
  ok: "bg-way-50 text-way-700 ring-way-100",
  alerta: "bg-amber-50 text-amber-700 ring-amber-100",
  erro: "bg-rose-50 text-rose-700 ring-rose-100",
  info: "bg-sky-50 text-sky-700 ring-sky-100",
  roxo: "bg-violet-50 text-violet-700 ring-violet-100",
};

export function Badge({ children, tom = "neutro", mono }: { children: ReactNode; tom?: Tom; mono?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset",
        TONS[tom],
        mono && "font-mono text-[10px] tracking-tight",
      )}
    >
      {children}
    </span>
  );
}

export { TONS as tons };
export type { Tom };

/* ------------------------------------------------------------------ botões */

type VarianteBotao = "primario" | "secundario" | "fantasma" | "perigo" | "suave";
const VARIANTES: Record<VarianteBotao, string> = {
  primario: "bg-way-600 text-white hover:bg-way-700 shadow-[0_1px_0_rgba(255,255,255,.14)_inset]",
  secundario: "bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50",
  fantasma: "text-ink-500 hover:bg-ink-100/70 hover:text-ink-800",
  perigo: "bg-rose-600 text-white hover:bg-rose-700",
  suave: "bg-way-50 text-way-700 hover:bg-way-100",
};

export function Button({
  children,
  onClick,
  variante = "primario",
  tipo = "button",
  className,
  disabled,
  icone,
  tamanho = "md",
  title,
}: {
  children?: ReactNode;
  onClick?: () => void;
  variante?: VarianteBotao;
  tipo?: "button" | "submit";
  className?: string;
  disabled?: boolean;
  icone?: string;
  tamanho?: "sm" | "md";
  title?: string;
}) {
  return (
    <button
      type={tipo}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-45",
        tamanho === "sm" ? "px-2.5 py-1.5 text-[12px]" : "px-3.5 py-2 text-[13px]",
        VARIANTES[variante],
        className,
      )}
    >
      {icone && <Icon name={icone} className={tamanho === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- forms */

const INPUT =
  "w-full rounded-lg border-0 bg-white px-2.5 py-1.5 text-[13px] text-ink-800 ring-1 ring-inset ring-ink-200 outline-none transition placeholder:text-ink-300 focus:ring-2 focus:ring-way-500 disabled:bg-ink-50 disabled:text-ink-400";

export function Campo({
  rotulo,
  children,
  dica,
  className,
  obrigatorio,
}: {
  rotulo: string;
  children: ReactNode;
  dica?: string;
  className?: string;
  obrigatorio?: boolean;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="micro mb-1 flex items-center gap-1 text-ink-400">
        {rotulo}
        {obrigatorio && <i className="not-italic text-rose-500">*</i>}
      </span>
      {children}
      {dica && <span className="mt-1 block text-[11px] leading-tight text-ink-300">{dica}</span>}
    </label>
  );
}

export function Input({
  className,
  valor,
  aoMudar,
  dinheiro,
  ...props
}: {
  className?: string;
  valor?: string;
  aoMudar?: (v: string) => void;
  dinheiro?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <input
      {...props}
      value={valor}
      onChange={(e) => aoMudar?.(e.target.value)}
      className={cn(INPUT, dinheiro && "tabular text-right", className)}
    />
  );
}

export function Select({
  className,
  valor,
  aoMudar,
  opcoes,
  ...props
}: {
  className?: string;
  valor?: string;
  aoMudar?: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value">) {
  return (
    <select
      {...props}
      value={valor}
      onChange={(e) => aoMudar?.(e.target.value)}
      className={cn(INPUT, "appearance-none pr-7", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364708a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 6px center",
        backgroundSize: "14px",
      }}
    >
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </select>
  );
}

export function Area({
  rotulo,
  valor,
  aoMudar,
  linhas = 3,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  linhas?: number;
  placeholder?: string;
}) {
  return (
    <Campo rotulo={rotulo}>
      <textarea
        rows={linhas}
        value={valor}
        placeholder={placeholder}
        onChange={(e) => aoMudar(e.target.value)}
        className={cn(INPUT, "resize-y leading-snug")}
      />
    </Campo>
  );
}

/* ------------------------------------------------------------- filtros UI */

export function BarraFiltros({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-ink-100 bg-white p-2.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function FiltroTexto({
  rotulo,
  valor,
  aoMudar,
  placeholder,
  largura = "w-52",
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  placeholder?: string;
  largura?: string;
}) {
  return (
    <Campo rotulo={rotulo} className={largura}>
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-300">
          <Icon name="busca" className="size-3.5" />
        </span>
        <Input
          valor={valor}
          aoMudar={aoMudar}
          placeholder={placeholder}
          className="pl-7"
          onKeyDown={(e) => e.key === "Escape" && aoMudar("")}
        />
        {valor && (
          <button
            type="button"
            onClick={() => aoMudar("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-300 hover:bg-ink-100 hover:text-ink-600"
          >
            <Icon name="x" className="size-3.5" />
          </button>
        )}
      </div>
    </Campo>
  );
}

export function FiltroMulti({
  rotulo,
  opcoes,
  selecionados,
  aoAlternar,
}: {
  rotulo: string;
  opcoes: { valor: string; rotulo: string; contagem?: number }[];
  selecionados: string[];
  aoAlternar: (v: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <span className="micro mb-1 block text-ink-400">{rotulo}</span>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "flex min-w-36 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ring-1 ring-inset transition",
          selecionados.length
            ? "bg-way-50 text-way-700 ring-way-200"
            : "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50",
        )}
      >
        <span className="truncate">
          {selecionados.length === 0
            ? "Todos"
            : selecionados.length === 1
              ? (opcoes.find((o) => o.valor === selecionados[0])?.rotulo ?? "1 seleção")
              : `${selecionados.length} selecionados`}
        </span>
        <Icon name="chevron" className={cn("size-3.5 shrink-0 transition", aberto && "rotate-90")} />
      </button>
      {aberto && (
        <div className="anim-in absolute z-30 mt-1 max-h-72 w-full min-w-48 overflow-auto rounded-lg border border-ink-100 bg-white p-1 shadow-lg">
          {opcoes.map((o) => {
            const on = selecionados.includes(o.valor);
            return (
              <button
                key={o.valor}
                type="button"
                onClick={() => aoAlternar(o.valor)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition",
                  on ? "bg-way-50 text-way-700" : "text-ink-600 hover:bg-ink-50",
                )}
              >
                <span
                  className={cn(
                    "grid size-3.5 shrink-0 place-items-center rounded-[3px] ring-1 ring-inset",
                    on ? "bg-way-600 text-white ring-way-600" : "ring-ink-200",
                  )}
                >
                  {on && <Icon name="check" className="size-2.5" strokeWidth={3} />}
                </span>
                <span className="flex-1 truncate">{o.rotulo}</span>
                {o.contagem !== undefined && <span className="tabular text-[11px] text-ink-300">{o.contagem}</span>}
              </button>
            );
          })}
          {selecionados.length > 0 && (
            <button
              type="button"
              onClick={() => selecionados.forEach((s) => aoAlternar(s))}
              className="mt-1 w-full rounded-md px-2 py-1 text-left text-[11.5px] font-semibold text-rose-600 hover:bg-rose-50"
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FiltroPeriodo({
  rotulo = "Período",
  valor,
  aoMudar,
}: {
  rotulo?: string;
  valor: { inicio: string; fim: string };
  aoMudar: (p: { inicio: string; fim: string }) => void;
}) {
  const atalhos = [
    { rotulo: "Hoje", dias: 1 },
    { rotulo: "7 dias", dias: 7 },
    { rotulo: "30 dias", dias: 30 },
    { rotulo: "90 dias", dias: 90 },
  ];
  return (
    <div>
      <span className="micro mb-1 block text-ink-400">{rotulo}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={valor.inicio}
          onChange={(e) => aoMudar({ ...valor, inicio: e.target.value })}
          className={cn(INPUT, "w-[136px] tabular")}
        />
        <span className="text-ink-300">→</span>
        <input
          type="date"
          value={valor.fim}
          onChange={(e) => aoMudar({ ...valor, fim: e.target.value })}
          className={cn(INPUT, "w-[136px] tabular")}
        />
        {atalhos.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={() => {
              const fim = new Date();
              const inicio = new Date();
              inicio.setDate(inicio.getDate() - (a.dias - 1));
              aoMudar({
                inicio: inicio.toISOString().slice(0, 10),
                fim: fim.toISOString().slice(0, 10),
              });
            }}
            className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-ink-400 ring-1 ring-inset ring-ink-100 transition hover:bg-ink-50 hover:text-ink-700"
          >
            {a.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-ink-50 py-0.5 pl-2 pr-1 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-ink-100">
      {children}
      {onClick && (
        <button type="button" onClick={onClick} className="rounded-full p-0.5 hover:bg-ink-100 hover:text-ink-700">
          <Icon name="x" className="size-3" />
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------- abas */

export function Abas({
  abas,
  atual,
  aoTrocar,
}: {
  abas: { id: string; rotulo: string; contagem?: number }[];
  atual: string;
  aoTrocar: (id: string) => void;
}) {
  return (
    <div className="mb-4 flex items-center gap-1 border-b border-ink-100">
      {abas.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => aoTrocar(a.id)}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold transition",
            atual === a.id
              ? "border-way-600 text-ink-900"
              : "border-transparent text-ink-400 hover:border-ink-200 hover:text-ink-600",
          )}
        >
          {a.rotulo}
          {a.contagem !== undefined && (
            <span
              className={cn(
                "tabular rounded px-1.5 py-px text-[10.5px]",
                atual === a.id ? "bg-way-50 text-way-700" : "bg-ink-50 text-ink-400",
              )}
            >
              {a.contagem}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- KPI */

export function Kpi({
  rotulo,
  valor,
  detalhe,
  tom = "neutro",
  icone,
  barra,
}: {
  rotulo: string;
  valor: string;
  detalhe?: ReactNode;
  tom?: Tom;
  icone?: string;
  barra?: number;
}) {
  const corBarra: Record<Tom, string> = {
    neutro: "bg-ink-300",
    ok: "bg-way-500",
    alerta: "bg-signal-500",
    erro: "bg-rose-500",
    info: "bg-sky-500",
    roxo: "bg-violet-500",
  };
  return (
    <Card className="anim-in p-3.5">
      <div className="flex items-start justify-between">
        <span className="micro text-ink-400">{rotulo}</span>
        {icone && (
          <span className={cn("grid size-6 place-items-center rounded-md ring-1 ring-inset", TONS[tom])}>
            <Icon name={icone} className="size-3.5" />
          </span>
        )}
      </div>
      <p className="tabular mt-1.5 text-[21px] font-bold leading-none tracking-[-0.02em] text-ink-900">{valor}</p>
      {detalhe && <div className="mt-1.5 text-[11.5px] leading-tight text-ink-400">{detalhe}</div>}
      {barra !== undefined && (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ink-100">
          <div className={cn("h-full rounded-full transition-all", corBarra[tom])} style={{ width: `${Math.min(100, Math.max(0, barra))}%` }} />
        </div>
      )}
    </Card>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/40 px-6 py-10 text-center">
      <p className="mx-auto max-w-md text-[13px] text-ink-400">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  largura = "max-w-2xl",
  rodape,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  descricao?: string;
  children: ReactNode;
  largura?: string;
  rodape?: ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const f = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/45 p-4 backdrop-blur-[2px] sm:p-8">
      <div className={cn("anim-in my-auto w-full rounded-2xl bg-white shadow-2xl ring-1 ring-ink-900/10", largura)}>
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-3.5">
          <div>
            <h3 className="text-[15px] font-bold tracking-tight text-ink-900">{titulo}</h3>
            {descricao && <p className="mt-0.5 text-[12px] text-ink-400">{descricao}</p>}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <Icon name="x" className="size-4" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {rodape && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 bg-ink-50/50 px-5 py-3">
            {rodape}
          </footer>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- feedback global */

type Toast = { id: number; texto: string; tom: "ok" | "erro" | "info" };
const ToastCtx = createContext<(texto: string, tom?: Toast["tom"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const push = useMemo(
    () => (texto: string, tom: Toast["tom"] = "ok") => {
      const id = Date.now() + Math.random();
      setLista((l) => [...l, { id, texto, tom }]);
      setTimeout(() => setLista((l) => l.filter((x) => x.id !== id)), 4200);
    },
    [],
  );
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="sem-impressao pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {lista.map((t) => (
          <div
            key={t.id}
            className={cn(
              "anim-in pointer-events-auto flex items-start gap-2 rounded-xl px-3 py-2.5 text-[12.5px] font-medium text-white shadow-xl",
              t.tom === "ok" ? "bg-ink-900" : t.tom === "erro" ? "bg-rose-600" : "bg-sky-700",
            )}
          >
            <Icon name={t.tom === "ok" ? "check" : t.tom === "erro" ? "alerta" : "raio"} className="mt-px size-4 shrink-0" />
            <span className="leading-snug">{t.texto}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ------------------------------------------------------ filtros salvos (PC) */

export function useFiltrosSalvos<T extends object>(chave: string, inicial: T) {
  const [salvos, setSalvos] = useState<Record<string, T>>({});
  useEffect(() => {
    try {
      const bruto = localStorage.getItem(`nkway.filtros.${chave}`);
      if (bruto) setSalvos(JSON.parse(bruto));
    } catch {
      /* armazenamento indisponível */
    }
  }, [chave]);
  const gravar = (nome: string, filtro: T) =>
    setSalvos((atual) => {
      const proximo = { ...atual, [nome]: filtro };
      try {
        localStorage.setItem(`nkway.filtros.${chave}`, JSON.stringify(proximo));
      } catch {
        /* ignora quota */
      }
      return proximo;
    });
  const apagar = (nome: string) =>
    setSalvos((atual) => {
      const proximo = { ...atual };
      delete proximo[nome];
      try {
        localStorage.setItem(`nkway.filtros.${chave}`, JSON.stringify(proximo));
      } catch {
        /* ignora quota */
      }
      return proximo;
    });
  return { salvos, gravar, apagar };
}

/** filtros salvos no navegador (prefixo `nkway.`) — como no app original */
export function FiltrosSalvos<T extends object>({
  chave,
  atual,
  aoAplicar,
}: {
  chave: string;
  atual: T;
  aoAplicar: (f: T) => void;
}) {
  const { salvos, gravar, apagar } = useFiltrosSalvos<T>(chave, atual);
  const [nome, setNome] = useState("");
  const nomes = Object.keys(salvos);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="micro text-ink-400">Filtro salvo</span>
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="ex.: notas do mês"
        className="w-36 rounded-lg px-2 py-1 text-[12px] ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
      />
      <Button
        tamanho="sm"
        variante="secundario"
        icone="salvar"
        disabled={!nome.trim()}
        onClick={() => {
          gravar(nome.trim(), atual);
          setNome("");
        }}
      >
        Salvar
      </Button>
      {nomes.map((n) => (
        <span
          key={n}
          className="inline-flex items-center gap-0.5 rounded-full bg-ink-50 py-0.5 pl-2 pr-0.5 text-[11px] font-medium text-ink-500 ring-1 ring-inset ring-ink-100"
        >
          <button type="button" className="hover:text-way-700" onClick={() => aoAplicar(salvos[n])}>
            {n}
          </button>
          <button
            type="button"
            aria-label={`Remover ${n}`}
            onClick={() => apagar(n)}
            className="rounded-full p-0.5 hover:bg-ink-100 hover:text-rose-600"
          >
            <Icon name="x" className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
