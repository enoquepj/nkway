"use client";

import Link from "next/link";
import { Icon, cn } from "@/components/ui";

/** Navegação única entre os relatórios gerais e os relatórios gerenciais do PDV. */
export function MenuRelatorios({ atual, podeAcessarPdv }: { atual: "gerais" | "pdv"; podeAcessarPdv: boolean }) {
  const itens = [
    { id: "gerais", href: "/relatorios", titulo: "Gerais e documentos", detalhe: "Vendas, clientes, fiscal e estoque", icone: "documento" },
    ...(podeAcessarPdv ? [{ id: "pdv", href: "/dashboard/relatorios/pdv", titulo: "PDV e caixa", detalhe: "Vendas, produtos e auditoria", icone: "caixa" }] : []),
  ];
  return (
    <nav aria-label="Menu de relatórios" className="grid gap-2 sm:grid-cols-2">
      {itens.map((item) => (
        <Link key={item.id} href={item.href} aria-current={atual === item.id ? "page" : undefined} className={cn("group flex items-center gap-3 rounded-xl border px-4 py-3 transition", atual === item.id ? "border-way-300 bg-way-50 text-ink-900 shadow-sm" : "border-ink-100 bg-white text-ink-600 hover:border-way-200 hover:bg-way-50/40")}>
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", atual === item.id ? "bg-way-600 text-white" : "bg-ink-50 text-ink-500 group-hover:text-way-700")}><Icon name={item.icone} className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[12.5px] font-bold">{item.titulo}</span><span className="mt-0.5 block text-[11px] text-ink-400">{item.detalhe}</span></span>
          <Icon name="chevron" className="size-4 text-ink-300" />
        </Link>
      ))}
    </nav>
  );
}
