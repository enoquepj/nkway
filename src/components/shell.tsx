"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ROTA_PDV, abrirPdvComTelaCheia } from "@/lib/abrirPdv";
import { ROTULO_PERFIL, temPermissao, type PerfilUsuario, type PermissaoAcao } from "@/lib/permissoes";
import { LinkPdv } from "./LinkPdv";
import { Badge, Button, Icon, cn } from "./ui";
import { sair } from "@/server/acoes/auth";

export type ItemPainel = {
  empresaNome: string;
  usuarioNome: string;
  usuarioPapel: PerfilUsuario;
  planoNome: string;
  planoId: string;
  trialDias: number | null;
  uf: string;
  ambiente: string;
};

const GRUPOS: {
  titulo: string;
  itens: { href: string; rotulo: string; icone: string; atalho?: string; permissao?: PermissaoAcao }[];
}[] = [
  {
    titulo: "Frente de caixa",
    itens: [
      { href: "/", rotulo: "Visão geral", icone: "painel" },
      { href: "/pdv", rotulo: "PDV", icone: "caixa", atalho: "F2" },
      { href: "/caixa", rotulo: "Caixa e fechamento", icone: "carteira", permissao: "caixa.abrir" },
    ],
  },
  {
    titulo: "Fiscal",
    itens: [
      { href: "/documentos", rotulo: "Documentos de venda", icone: "documento", permissao: "documentos.ver" },
      { href: "/emissor", rotulo: "Emissor SEFAZ", icone: "raio", permissao: "documentos.ver" },
      { href: "/transporte", rotulo: "MDF-e", icone: "caminhoes", permissao: "fiscal.eventos" },
    ],
  },
  {
    titulo: "Compras e estoque",
    itens: [
      { href: "/dfe", rotulo: "DF-e e Certificado A1", icone: "cadeado", permissao: "fiscal.eventos" },
      { href: "/entradas", rotulo: "Entrada de mercadoria", icone: "entrada", permissao: "estoque.ajustar" },
      { href: "/devolucoes", rotulo: "Devoluções de compra", icone: "atualizar", permissao: "estoque.ajustar" },
      { href: "/estoque", rotulo: "Estoque e kardex", icone: "caixaEstoque" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/produtos", rotulo: "Produtos e preços", icone: "etiqueta" },
      { href: "/clientes", rotulo: "Clientes e fornecedores", icone: "pessoas", permissao: "cadastros.clientes" },
      { href: "/financeiro", rotulo: "Financeiro", icone: "carteira", permissao: "financeiro.gerenciar" },
      { href: "/relatorios", rotulo: "Relatórios", icone: "grafico" },
      { href: "/usuarios", rotulo: "Usuários e auditoria", icone: "pessoas", permissao: "usuarios.ver" },
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
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "k") {
        abrirPdvComTelaCheia({
          navegar: (rota) => router.push(rota),
          origem: "atalho",
          eventoTeclado: e,
          pathnameAtual: pathname,
        });
      }
    };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [router, pathname]);

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
          {GRUPOS.map((g) => {
            const visiveis = g.itens.filter((i) => !i.permissao || temPermissao(dados.usuarioPapel, i.permissao));
            if (visiveis.length === 0) return null;
            return (
            <div key={g.titulo} className="mb-3">
              <p className="micro px-2.5 py-1 text-ink-500">{g.titulo}</p>
              <ul className="space-y-0.5">
                {visiveis.map((i) => {
                  const classeItem = cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                    ativo(i.href)
                      ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35"
                      : "text-ink-300 hover:bg-ink-800 hover:text-white",
                  );
                  const conteudoItem = (
                    <>
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
                    </>
                  );
                  return (
                    <li key={i.href}>
                      {i.href === ROTA_PDV ? (
                        <LinkPdv className={classeItem} aoAbrir={() => setAberto(false)}>
                          {conteudoItem}
                        </LinkPdv>
                      ) : (
                        <Link href={i.href} className={classeItem}>
                          {conteudoItem}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            );
          })}
          <div className="mt-1 space-y-0.5 border-t border-ink-800 pt-3">
            <Link
              href="/assinatura"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                ativo("/assinatura") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
              )}
            >
              <Icon name="raio" className="size-4" />
              Assinatura e CNPJ
            </Link>
            {temPermissao(dados.usuarioPapel, "config.gerenciar") && (
              <Link
                href="/migracao"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                  ativo("/migracao") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
                )}
              >
                <Icon name="entrada" className="size-4" />
                Migração legado
              </Link>
            )}
            {temPermissao(dados.usuarioPapel, "config.gerenciar") && (
              <Link
                href="/prontidao"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                  ativo("/prontidao") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
                )}
              >
                <Icon name="grafico" className="size-4" />
                Central de prontidão
              </Link>
            )}
            {temPermissao(dados.usuarioPapel, "caixa.auditoria") && (
              <Link
                href="/dashboard/auditoria-caixa"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition",
                  ativo("/dashboard/auditoria-caixa") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
                )}
              >
                <Icon name="carteira" className="size-4" />
                Auditoria de caixa
              </Link>
            )}
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
            <Link href="/assinatura" className="hover:opacity-85">
              <Badge tom={dados.planoId === "start" ? "neutro" : "ok"}>{dados.planoNome}</Badge>
            </Link>
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
            <p className="flex items-center gap-2 truncate text-[13px] font-semibold text-ink-800">
              <span className="truncate">{dados.usuarioNome}</span>
              <Badge tom={ROTULO_PERFIL[dados.usuarioPapel].tom}>{ROTULO_PERFIL[dados.usuarioPapel].nome}</Badge>
            </p>
            <p className="truncate text-[11px] text-ink-400">{dados.empresaNome}</p>
          </div>
          {dados.trialDias !== null && (
            <Link
              href="/assinatura"
              className={cn(
                "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition hover:opacity-85 sm:inline-flex",
                dados.trialDias <= 3 ? "bg-rose-50 text-rose-700 ring-rose-100" : "bg-amber-50 text-amber-700 ring-amber-100",
              )}
            >
              <Icon name="raio" className="size-3" />
              {dados.trialDias > 0 ? `Trial: ${dados.trialDias} dia(s) · Assinar` : "Trial expirado · Assinar"}
            </Link>
          )}
          <LinkPdv>
            <Button tamanho="sm" icone="caixa">
              Abrir PDV
            </Button>
          </LinkPdv>
        </header>
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 sm:px-6">{children}</main>
        <footer className="sem-impressao flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 px-6 py-3 text-[11px] text-ink-400">
          <span>
            NKWAY · Ambiente {dados.ambiente === "1" ? "1 (Produção SEFAZ)" : "2 (Homologação — sem valor jurídico)"} · Motor NF-e/NFC-e 4.00 com contingência e pré-validação ativo.
          </span>
          <Link href="/emissor" className="font-semibold text-way-700 hover:underline">
            Monitor Emissor SEFAZ →
          </Link>
        </footer>
      </div>
    </div>
  );
}
