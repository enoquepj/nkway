"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Button, Icon, Vazio, cn } from "./ui";

export type Coluna<T> = {
  id: string;
  rotulo: string;
  alinhar?: "esquerda" | "direita" | "centro";
  largura?: string;
  /** usado para ordenar e exportar CSV */
  valor?: (linha: T) => string | number | null | undefined;
  render?: (linha: T) => ReactNode;
  ocultoNoCsv?: boolean;
};

const ALINHA = { esquerda: "text-left", direita: "text-right", centro: "text-center" } as const;

function baixarCsv<T>(nome: string, colunas: Coluna<T>[], linhas: T[]) {
  const cabecalho = colunas.map((c) => esc(c.rotulo)).join(";");
  const corpo = linhas.map((l) =>
    colunas
      .map((c) => {
        const v = c.valor ? c.valor(l) : null;
        return typeof v === "number" ? String(v).replace(".", ",") : esc(String(v ?? ""));
      })
      .join(";"),
  );
  const csv = `\uFEFF${[cabecalho, ...corpo].join("\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function Tabela<T>({
  colunas,
  linhas,
  chave,
  tamanhoPagina = 20,
  nomeExportar,
  vazio = "Nada para mostrar com os filtros atuais.",
  selecionarLinha,
  rodape,
  compacta,
  alturaFixa,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (linha: T) => string;
  tamanhoPagina?: number;
  nomeExportar?: string;
  vazio?: ReactNode;
  selecionarLinha?: (linha: T) => void;
  rodape?: ReactNode;
  compacta?: boolean;
  alturaFixa?: boolean;
}) {
  const [ordem, setOrdem] = useState<{ coluna: string; dir: "asc" | "desc" } | null>(null);
  const [pagina, setPagina] = useState(0);

  const ordenadas = useMemo(() => {
    if (!ordem) return linhas;
    const col = colunas.find((c) => c.id === ordem.coluna);
    if (!col?.valor) return linhas;
    const copia = [...linhas];
    copia.sort((a, b) => {
      const va = col.valor!(a);
      const vb = col.valor!(b);
      if (typeof va === "number" && typeof vb === "number")
        return ordem.dir === "asc" ? va - vb : vb - va;
      const sa = String(va ?? "");
      const sb = String(vb ?? "");
      const r = sa.localeCompare(sb, "pt-BR", { numeric: true });
      return ordem.dir === "asc" ? r : -r;
    });
    return copia;
  }, [linhas, ordem, colunas]);

  const totalPaginas = Math.max(1, Math.ceil(ordenadas.length / tamanhoPagina));
  const paginaSegura = Math.min(pagina, totalPaginas - 1);
  const visiveis = ordenadas.slice(paginaSegura * tamanhoPagina, (paginaSegura + 1) * tamanhoPagina);

  const cabecalho = (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      {colunas.map((c) => {
        const ativo = ordem?.coluna === c.id;
        return (
          <th
            key={c.id}
            style={c.largura ? { width: c.largura } : undefined}
            className={cn(
              "micro whitespace-nowrap px-2.5 py-2 font-semibold text-ink-400",
              ALINHA[c.alinhar ?? "esquerda"],
              c.valor && "cursor-pointer select-none hover:text-ink-700",
            )}
            onClick={() =>
              c.valor &&
              setOrdem((o) =>
                o?.coluna === c.id ? { coluna: c.id, dir: o.dir === "asc" ? "desc" : "asc" } : { coluna: c.id, dir: "asc" },
              )
            }
          >
            <span className={cn("inline-flex items-center gap-1", c.alinhar === "direita" && "flex-row-reverse")}>
              {c.rotulo}
              {c.valor && (
                <Icon
                  name="chevron"
                  className={cn(
                    "size-3 transition",
                    ativo ? "text-way-600" : "text-ink-200",
                    ativo && ordem?.dir === "asc" && "-rotate-90",
                    !ativo && "rotate-90 opacity-0 group-hover:opacity-100",
                  )}
                />
              )}
            </span>
          </th>
        );
      })}
    </tr>
  );

  if (linhas.length === 0) return <Vazio>{vazio}</Vazio>;

  return (
    <div className="overflow-hidden rounded-xl border border-ink-100 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 bg-white px-3 py-2">
        <span className="tabular text-[11.5px] font-medium text-ink-400">
          {linhas.length} {linhas.length === 1 ? "registro" : "registros"}
          {ordem && " · ordenado"}
        </span>
        <div className="flex items-center gap-1.5">
          {rodape}
          {nomeExportar && (
            <Button
              tamanho="sm"
              variante="fantasma"
              icone="baixar"
              onClick={() =>
                baixarCsv(nomeExportar, colunas.filter((c) => !c.ocultoNoCsv), ordenadas)
              }
            >
              CSV
            </Button>
          )}
        </div>
      </div>

      {alturaFixa ? (
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10">{cabecalho}</thead>
            <tbody>
              {visiveis.map((l) => (
                <Linha key={chave(l)} linha={l} colunas={colunas} onClick={selecionarLinha} compacta={compacta} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>{cabecalho}</thead>
          <tbody>
            {visiveis.map((l) => (
              <Linha key={chave(l)} linha={l} colunas={colunas} onClick={selecionarLinha} compacta={compacta} />
            ))}
          </tbody>
        </table>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-between border-t border-ink-100 px-3 py-2">
          <span className="tabular text-[11.5px] text-ink-400">
            {paginaSegura * tamanhoPagina + 1}–{Math.min(ordenadas.length, (paginaSegura + 1) * tamanhoPagina)} de{" "}
            {ordenadas.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={paginaSegura === 0}
              onClick={() => setPagina(paginaSegura - 1)}
              className="rounded-md p-1 text-ink-500 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 disabled:opacity-40"
            >
              <Icon name="chevron" className="size-3.5 rotate-180" />
            </button>
            <span className="tabular px-1 text-[12px] font-semibold text-ink-600">
              {paginaSegura + 1} / {totalPaginas}
            </span>
            <button
              type="button"
              disabled={paginaSegura >= totalPaginas - 1}
              onClick={() => setPagina(paginaSegura + 1)}
              className="rounded-md p-1 text-ink-500 ring-1 ring-inset ring-ink-200 transition hover:bg-ink-50 disabled:opacity-40"
            >
              <Icon name="chevron" className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Linha<T>({
  linha,
  colunas,
  onClick,
  compacta,
}: {
  linha: T;
  colunas: Coluna<T>[];
  onClick?: (l: T) => void;
  compacta?: boolean;
}) {
  return (
    <tr
      onClick={onClick ? () => onClick(linha) : undefined}
      className={cn(
        "border-b border-ink-50 transition last:border-0",
        onClick && "cursor-pointer",
        "hover:bg-way-50/40",
      )}
    >
      {colunas.map((c) => (
        <td
          key={c.id}
          className={cn(
            compacta ? "px-2.5 py-1.5" : "px-2.5 py-2.5",
            "align-middle text-[12.5px] text-ink-700",
            ALINHA[c.alinhar ?? "esquerda"],
          )}
        >
          {c.render ? c.render(linha) : (c.valor?.(linha) as ReactNode) ?? "—"}
        </td>
      ))}
    </tr>
  );
}
