import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { empresas } from "@/db/schema";
import { executarCapturaDfeEmpresa } from "@/server/dfeCore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * NKWAY — captura automática de DF-e (cron a cada 10 min / webhook manual).
 *
 * GET  /api/dfe/dist  → Vercel Cron (Authorization: Bearer <segredo>)
 * POST /api/dfe/dist  → disparo manual autenticado
 *
 * Sem `DFE_CRON_SECRET` (ou `CRON_SECRET`) a rota responde 401 e não executa nada.
 * O segredo nunca aparece em logs nem na resposta; a comparação é de tempo constante.
 * Nenhuma URL de conexão, senha do A1 ou conteúdo de certificado é devolvido.
 */

const LIMITE_EMPRESAS = 20;

function segredoCron(): string {
  return (process.env.DFE_CRON_SECRET || process.env.CRON_SECRET || "").trim();
}

function segredoRecebido(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return (bearer || req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "").trim();
}

function confere(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

async function executar(req: Request): Promise<Response> {
  const esperado = segredoCron();
  if (!esperado || !confere(segredoRecebido(req), esperado)) {
    return Response.json({ ok: false, erro: "Não autorizado: segredo do cron ausente ou inválido." }, { status: 401 });
  }

  const empresaAlvo = new URL(req.url).searchParams.get("empresaId") || "";
  try {
    const todas = await db.select().from(empresas);
    const fila = todas
      .filter((e) => (empresaAlvo ? e.id === empresaAlvo : true))
      .filter((e) => {
        const fiscal = (e.fiscal ?? {}) as Record<string, unknown>;
        return fiscal.dfeAtivo !== false;
      })
      .slice(0, LIMITE_EMPRESAS);

    const resultados: {
      empresaId: string;
      ok: boolean;
      modo?: string;
      cStat?: string;
      novos?: number;
      erro?: string;
    }[] = [];

    // Sequencial: evita concorrência de NSU e respeita a trava de 60s contra cStat 656.
    for (const empresa of fila) {
      try {
        const r = await executarCapturaDfeEmpresa(empresa);
        resultados.push(
          r.ok
            ? { empresaId: empresa.id, ok: true, modo: r.modo, cStat: r.cStat, novos: r.novos }
            : { empresaId: empresa.id, ok: false, erro: String(r.erro || "Falha na captura.").slice(0, 160) },
        );
      } catch (e) {
        console.error("[nkway] falha na captura DF-e da empresa", empresa.id, e instanceof Error ? e.message : e);
        resultados.push({ empresaId: empresa.id, ok: false, erro: "Falha na captura. Verifique os logs do servidor." });
      }
    }

    return Response.json(
      {
        ok: resultados.every((r) => r.ok),
        executadoEm: new Date().toISOString(),
        processadas: resultados.length,
        novos: resultados.reduce((n, r) => n + (r.novos ?? 0), 0),
        resultados,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[nkway] falha ao listar empresas para DF-e", e instanceof Error ? e.message : e);
    return Response.json({ ok: false, erro: "Falha ao consultar as empresas. Verifique os logs do servidor." }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return executar(req);
}

export async function POST(req: Request) {
  return executar(req);
}
