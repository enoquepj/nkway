import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PdvLayout({ children }: { children: ReactNode }) {
  const c = await contexto();
  if (!c) redirect("/login");

  return <div className="h-[100dvh] w-full overflow-hidden bg-[#eef0f4]">{children}</div>;
}
