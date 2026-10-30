"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Icon, cn } from "./ui";
import { sair } from "@/server/acoes/auth";

export type ItemPainel = {
  empresaNome: string;
  usuarioNome: string;
  planoNome: string;
  planoId: string;
  trialDias: number | null;
  uf: string;
  ambiente: string;
};

const GRUPOS: { titulo: string; itens: { href: string; rotulo: string; icone: string; atalho?: string }[] }[] = [
  {
    titulo: "Frente de caixa",
    itens: [
      { href: "/", rotulo: "Visão geral", icone: "painel" },
      { href: "/pdv", rotulo: "PDV", icone: "caixa", atalho: "F2" },
    ],
  },
  {
    titulo: "Fiscal",
    itens: [
      { href: "/documentos", rotulo: "Documentos fiscais", icone: "documento" },
      { href: "/transporte", rotulo: "MDF-e", icone: "caminhoes" },
    ],
  },
  {
    titulo: "Compras e estoque",
    itens: [
      { href: "/entradas", rotulo: "Entrada de mercadoria", icone: "entrada" },
      { href: "/estoque", rotulo: "Estoque e kardex", icone: "caixaEstoque" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/produtos", rotulo: "Produtos e preços", icone: "etiqueta" },
      { href: "/clientes", rotulo: "Clientes e fornecedores", icone: "pessoas" },
      { href: "/financeiro", rotulo: "Financeiro", icone: "carteira" },
      { href: "/relatorios", rotulo: "Relatórios", icone: "grafico" },
    ],
  },
];

export function Shell({ dados, children }: { dados: ItemPainel; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => setAberto(false), [pathname]);

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        router.push("/pdv");
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [router]);

  const ativo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "sem-impressao fixed inset-y-0 left-0 z-40 flex w-[236px] flex-col bg-ink-900 text-ink-100 transition-transform lg:translate-x-0",
          aberto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
          <span className="grid size-8 place-items-center rounded-lg bg-way-500 font-black text-ink-900">N</span>
          <div className="leading-tight">
            <p className="text-[15px] font-extrabold tracking-tight text-white">NKWAY</p>
            <p className="micro text-ink-400">ERP · PDV · Fiscal</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-md p-1.5 text-ink-300 hover:bg-ink-800 lg:hidden"
            onClick={() => setAberto(false)}
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="mb-3">
              <p className="micro px-2.5 py-1 text-ink-500">{g.titulo}</p>
              <ul className="space-y-0.5">
                {g.itens.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                        ativo(i.href)
                          ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35"
                          : "text-ink-300 hover:bg-ink-800 hover:text-white",
                      )}
                    >
                      <Icon
                        name={i.icone}
                        className={cn("size-4 shrink-0", ativo(i.href) ? "text-way-300" : "text-ink-400 group-hover:text-way-300")}
                      />
                      <span className="flex-1 truncate">{i.rotulo}</span>
                      {i.atalho && (
                        <kbd className="rounded bg-ink-800 px-1 py-px font-mono text-[9.5px] text-ink-400 group-hover:bg-ink-700">
                          {i.atalho}
                        </kbd>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-1 border-t border-ink-800 pt-3">
            <Link
              href="/config"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                ativo("/config") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
              )}
            >
              <Icon name="engrenagem" className="size-4" />
              Configurações
            </Link>
          </div>
        </nav>

        <div className="border-t border-ink-800 px-3 py-3">
          <p className="truncate text-[12.5px] font-semibold text-white">{dados.empresaNome}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-400">
            {dados.uf} · {dados.ambiente === "1" ? "Produção" : "Homologação"}
            <span className="inline-flex items-center gap-1 text-way-300">
              <i className="size-1.5 rounded-full bg-way-400" />
              online
            </span>
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Badge tom={dados.planoId === "start" ? "neutro" : "ok"}>{dados.planoNome}</Badge>
            <button
              type="button"
              onClick={async () => {
                setSaindo(true);
                await sair();
              }}
              disabled={saindo}
              className="rounded-md px-1.5 py-1 text-[11px] font-semibold text-ink-400 transition hover:bg-ink-800 hover:text-white"
            >
              Sair
            </button>
          </div>
        </div>
      </aside>

      {aberto && <button aria-label="Fechar menu" type="button" onClick={() => setAberto(false)} className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden" />}

      <div className="flex min-w-0 flex-1 flex-col lg:ml-[236px]">
        <header className="sem-impressao sticky top-0 z-20 flex items-center gap-3 border-b border-ink-100 bg-white/85 px-4 py-2.5 backdrop-blur">
          <button type="button" onClick={() => setAberto(true)} className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 lg:hidden">
            <Icon name="painel" className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-ink-800">{dados.usuarioNome}</p>
            <p className="truncate text-[11px] text-ink-400">{dados.empresaNome}</p>
          </div>
          {dados.trialDias !== null && (
            <span
              className={cn(
                "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline-flex",
                dados.trialDias <= 3 ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-amber-50 text-amber-700 ring-amber-100",
              )}
            >
              <Icon name="raio" className="size-3" />
              {dados.trialDias > 0 ? `Trial: ${dados.trialDias} dia(s)` : "Trial expirado"}
            </span>
          )}
          <Link href="/pdv">
            <Button tamanho="sm" icone="caixa">
              Abrir PDV
            </Button>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 sm:px-6">{children}</main>
        <footer className="sem-impressao border-t border-ink-100 px-6 py-3 text-[11px] text-ink-400">
          NKWAY · emissão fiscal simulada em homologação — sem valor jurídico. Integração com emissor homologado (Fiscalo/DFe) é o
          próximo passo para produção.
        </footer>
      </div>
    </div>
  );
}
