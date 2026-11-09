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

type ItemMenu = { href: string; rotulo: string; icone: string; atalho?: string; permissao?: PermissaoAcao; descricao?: string };
type GrupoMenu = { id: string; titulo: string; icone: string; itens: ItemMenu[] };

/**
 * Menu por domínio de negócio, na vertente dos ERPs de varejo (Vendas · Fiscal · Compras/Estoque · Cadastros · Financeiro · Gestão · Sistema).
 * Grupos recolhíveis; o grupo da rota ativa abre sozinho; a preferência fica no navegador (localStorage `nkway.menu`).
 * A permissão continua sendo decidida pelo servidor em cada rota — aqui é só ocultação visual.
 */
const GRUPOS: GrupoMenu[] = [
  {
    id: "vendas", titulo: "Vendas e caixa", icone: "caixa",
    itens: [
      { href: "/pdv", rotulo: "PDV · Frente de caixa", icone: "caixa", atalho: "F2", descricao: "Tela cheia de venda" },
      { href: "/caixa", rotulo: "Abertura e fechamento", icone: "carteira", permissao: "caixa.abrir" },
      { href: "/dashboard/auditoria-caixa", rotulo: "Auditoria de caixa", icone: "cadeado", permissao: "caixa.auditoria", descricao: "Turnos DIVERGE e homologação" },
      { href: "/documentos", rotulo: "Documentos de venda", icone: "documento", permissao: "documentos.ver" },
    ],
  },
  {
    id: "fiscal", titulo: "Fiscal", icone: "raio",
    itens: [
      { href: "/emissor", rotulo: "Emissor SEFAZ", icone: "raio", permissao: "documentos.ver" },
      { href: "/dfe", rotulo: "DF-e e Certificado A1", icone: "cadeado", permissao: "fiscal.eventos" },
      { href: "/transporte", rotulo: "MDF-e", icone: "caminhoes", permissao: "fiscal.eventos" },
      { href: "/config/fiscal/produtos", rotulo: "Tributação de produtos", icone: "etiqueta", permissao: "config.gerenciar", descricao: "Perfis, CST, CFOP, cClassTrib" },
    ],
  },
  {
    id: "compras", titulo: "Compras e estoque", icone: "caixaEstoque",
    itens: [
      { href: "/entradas", rotulo: "Entrada de mercadoria", icone: "entrada", permissao: "estoque.ajustar" },
      { href: "/devolucoes", rotulo: "Devoluções de compra", icone: "atualizar", permissao: "estoque.ajustar" },
      { href: "/estoque", rotulo: "Estoque e kardex", icone: "caixaEstoque" },
    ],
  },
  {
    id: "cadastros", titulo: "Cadastros", icone: "etiqueta",
    itens: [
      { href: "/produtos", rotulo: "Produtos e preços", icone: "etiqueta" },
      { href: "/clientes", rotulo: "Clientes e fornecedores", icone: "pessoas", permissao: "cadastros.clientes" },
    ],
  },
  {
    id: "financeiro", titulo: "Financeiro", icone: "carteira",
    itens: [
      { href: "/financeiro", rotulo: "Contas e fluxo de caixa", icone: "carteira", permissao: "financeiro.gerenciar" },
      { href: "/assinatura", rotulo: "Assinatura e plano", icone: "raio" },
    ],
  },
  {
    id: "gestao", titulo: "Gestão", icone: "grafico",
    itens: [
      { href: "/relatorios", rotulo: "Relatórios", icone: "grafico" },
      { href: "/usuarios", rotulo: "Usuários e auditoria", icone: "pessoas", permissao: "usuarios.ver" },
    ],
  },
  {
    id: "sistema", titulo: "Sistema", icone: "engrenagem",
    itens: [
      { href: "/config", rotulo: "Configurações", icone: "engrenagem" },
      { href: "/prontidao", rotulo: "Central de prontidão", icone: "check", permissao: "config.gerenciar" },
      { href: "/migracao", rotulo: "Migração do legado", icone: "entrada", permissao: "config.gerenciar" },
    ],
  },
];

const CHAVE_MENU = "nkway.menu";
function lerPreferenciaMenu(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try { const v = JSON.parse(window.localStorage.getItem(CHAVE_MENU) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

export function Shell({ dados, children }: { dados: ItemPainel; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => setAberto(false), [pathname]);

  // Grupos recolhíveis: preferência do usuário + o grupo da rota ativa sempre aberto.
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  useEffect(() => { setAbertos(lerPreferenciaMenu()); }, []);
  const alternarGrupo = (id: string) => setAbertos((a) => {
    const prox = { ...a, [id]: !(a[id] ?? true) };
    try { window.localStorage.setItem(CHAVE_MENU, JSON.stringify(prox)); } catch { /* preferência opcional */ }
    return prox;
  });

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

  const ativo = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/relatorios") return pathname.startsWith("/relatorios") || pathname.startsWith("/dashboard/relatorios/");
    if (href === "/config") return pathname === "/config" || (pathname.startsWith("/config/") && !pathname.startsWith("/config/fiscal/produtos"));
    return pathname === href || pathname.startsWith(href + "/");
  };
  const grupoAtivo = GRUPOS.find((g) => g.itens.some((i) => ativo(i.href)))?.id ?? null;

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

        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Menu principal">
          <Link
            href="/"
            className={cn(
              "mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold transition",
              ativo("/") ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-200 hover:bg-ink-800 hover:text-white",
            )}
          >
            <Icon name="painel" className={cn("size-4", ativo("/") ? "text-way-300" : "text-ink-400")} />
            Visão geral
          </Link>
          {GRUPOS.map((g) => {
            const visiveis = g.itens.filter((i) => !i.permissao || temPermissao(dados.usuarioPapel, i.permissao));
            if (visiveis.length === 0) return null;
            const expandido = grupoAtivo === g.id || (abertos[g.id] ?? true);
            const idLista = `menu-grupo-${g.id}`;
            return (
              <div key={g.id} className="mb-1.5">
                <button
                  type="button"
                  onClick={() => alternarGrupo(g.id)}
                  aria-expanded={expandido}
                  aria-controls={idLista}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition hover:bg-ink-800/70",
                    grupoAtivo === g.id ? "text-way-200" : "text-ink-400",
                  )}
                >
                  <Icon name={g.icone} className="size-3.5 shrink-0 opacity-80" />
                  <span className="micro flex-1 font-semibold tracking-wide">{g.titulo}</span>
                  <Icon name="voltar" className={cn("size-3 transition-transform", expandido ? "-rotate-90" : "rotate-180")} />
                </button>
                {expandido && (
                  <ul id={idLista} className="mt-0.5 space-y-0.5 border-l border-ink-800 pl-1.5">
                    {visiveis.map((i) => {
                      const estaAtivo = ativo(i.href);
                      const classeItem = cn(
                        "group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition",
                        estaAtivo ? "bg-way-600/15 text-white ring-1 ring-inset ring-way-500/35" : "text-ink-300 hover:bg-ink-800 hover:text-white",
                      );
                      const conteudoItem = (
                        <>
                          <Icon name={i.icone} className={cn("size-4 shrink-0", estaAtivo ? "text-way-300" : "text-ink-500 group-hover:text-way-300")} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{i.rotulo}</span>
                            {i.descricao && <span className="block truncate text-[10.5px] font-normal text-ink-500">{i.descricao}</span>}
                          </span>
                          {i.atalho && (
                            <kbd className="rounded bg-ink-800 px-1 py-px font-mono text-[9.5px] text-ink-400 group-hover:bg-ink-700">{i.atalho}</kbd>
                          )}
                        </>
                      );
                      return (
                        <li key={i.href}>
                          {i.href === ROTA_PDV ? (
                            <LinkPdv className={classeItem} aoAbrir={() => setAberto(false)}>{conteudoItem}</LinkPdv>
                          ) : (
                            <Link href={i.href} className={classeItem} aria-current={estaAtivo ? "page" : undefined}>{conteudoItem}</Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
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
