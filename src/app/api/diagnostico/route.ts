import { contexto } from "@/lib/session";
import { rodarDiagnostico } from "@/server/diagnostico";

export const dynamic = "force-dynamic";

/**
 * NKWAY — console do dev em formato de rota (porta do DevConsole do protótipo).
 * GET /api/diagnostico → bateria de testes sobre o tenant da sessão.
 */
export async function GET() {
  const c = await contexto();
  if (!c) return Response.json({ ok: false, erro: "Sessão expirada. Entre novamente." }, { status: 401 });

  try {
    const d = await rodarDiagnostico(c.empresaId, c.usuario.id);
    return Response.json({
      ok: d.resumo.criticos === 0,
      empresa: { nome: c.empresa.nome, cnpj: c.empresa.cnpj, uf: c.empresa.uf },
      usuario: c.usuario.nome,
      ...d,
    });
  } catch (e) {
    return Response.json(
      { ok: false, erro: e instanceof Error ? e.message : "Falha ao rodar o diagnóstico." },
      { status: 500 },
    );
  }
}
