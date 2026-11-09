import { cabecalhosVersaoDeploy, obterVersaoDeploy } from "@/server/versaoDeploy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Identificação pública e somente leitura desta publicação.
 * Não consulta banco, não aceita um commit por parâmetro e não substitui o health.
 */
export async function GET() {
  const versao = obterVersaoDeploy();
  return Response.json(versao, { headers: cabecalhosVersaoDeploy(versao) });
}
