import { contexto } from "@/lib/session";
import { obterProntidao } from "@/server/prontidaoCore";
import { obterVersaoDeploy } from "@/server/versaoDeploy";

export const dynamic = "force-dynamic";

/**
 * NKWAY — leitura resumida da Central de prontidão.
 * GET /api/prontidao → 401 sem sessão; nunca devolve valores de variáveis secretas,
 * URLs de conexão, tokens, senhas ou certificados. Apenas metadados públicos de versão.
 */
export async function GET() {
  const c = await contexto();
  if (!c) return Response.json({ ok: false, erro: "Sessão expirada. Entre novamente." }, { status: 401 });

  try {
    const dados = await obterProntidao(c.empresaId, c.empresa.nomeFantasia || c.empresa.nome);
    return Response.json(
      {
        ok: dados.bancoConectado,
        versao: obterVersaoDeploy(),
        geradoEm: dados.geradoEm,
        empresa: dados.empresaNome,
        resumo: dados.resumo,
        contagens: dados.contagens,
        blocos: dados.blocos.map((b) => ({
          id: b.id,
          titulo: b.titulo,
          rota: b.rota,
          prontos: b.itens.filter((i) => i.status === "pronto").length,
          pendentes: b.itens.filter((i) => i.status === "pendente").length,
          opcionais: b.itens.filter((i) => i.status === "opcional").length,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { ok: false, erro: e instanceof Error ? e.message : "Falha ao consultar a prontidão." },
      { status: 500 },
    );
  }
}
