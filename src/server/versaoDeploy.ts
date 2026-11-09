import { identificarVersaoDeploy, versaoDeployValida, type VersaoDeploy } from "@/lib/versaoDeploy";

/**
 * Somente servidor. Lê três metadados de sistema, nunca segredos.
 * Não usa NODE_ENV como prova de produção, nem o Git local como commit publicado.
 * Ausência de metadados é informada honestamente, sem mudar variáveis na Vercel.
 */
export function obterVersaoDeploy(): VersaoDeploy {
  return identificarVersaoDeploy({
    vercel: process.env.VERCEL,
    commit: process.env.VERCEL_GIT_COMMIT_SHA,
    ambiente: process.env.VERCEL_ENV,
  });
}

export function cabecalhosVersaoDeploy(versao = obterVersaoDeploy()): Record<string, string> {
  const segura = versaoDeployValida(versao) ? versao : identificarVersaoDeploy();
  return {
    "Cache-Control": "no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "X-NKWAY-Commit": segura.commit ?? "nao-identificado",
    "X-NKWAY-Ambiente": segura.ambiente,
  };
}
