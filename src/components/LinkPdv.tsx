"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";
import { ROTA_PDV, abrirPdvComTelaCheia } from "@/lib/abrirPdv";

type PropsLinkPdv = Omit<ComponentPropsWithoutRef<typeof Link>, "href"> & {
  children: ReactNode;
  aoAbrir?: () => void;
};

/**
 * Link oficial para `/pdv`: solicita Fullscreen API no próprio gesto de clique
 * e navega imediatamente sem duplicar lógica nas entradas do sistema.
 */
export function LinkPdv({ children, onClick, target, aoAbrir, ...resto }: PropsLinkPdv) {
  const router = useRouter();
  const pathname = usePathname();

  function tratarClique(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented) return;

    const r = abrirPdvComTelaCheia({
      navegar: (rota) => router.push(rota),
      origem: "clique",
      eventoClique: e,
      target,
      pathnameAtual: pathname,
    });

    if (r.interceptado) {
      aoAbrir?.();
    }
  }

  return (
    <Link href={ROTA_PDV} target={target} onClick={tratarClique} {...resto}>
      {children}
    </Link>
  );
}
