import { redirect } from "next/navigation";
import { contexto } from "@/lib/session";
import { diasAteTrial, planoById } from "@/lib/dominio";
import { Shell, type ItemPainel } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const c = await contexto();
  if (!c) redirect("/login");
  const dias = diasAteTrial(c.empresa.trialUntil);
  const dados: ItemPainel = {
    empresaNome: c.empresa.nomeFantasia || c.empresa.nome,
    usuarioNome: c.usuario.nome,
    planoNome: planoById(c.empresa.plano).nome,
    planoId: c.empresa.plano,
    trialDias: c.empresa.trialUntil && Number.isFinite(dias) ? Math.max(0, dias) : null,
    uf: c.empresa.uf,
    ambiente: String(((c.empresa.fiscal ?? {}) as Record<string, unknown>).ambiente ?? "2"),
  };

  return <Shell dados={dados}>{children}</Shell>;
}
