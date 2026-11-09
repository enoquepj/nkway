/** Metadados públicos de publicação. Não contém acesso a ambiente, banco ou Git. */
export type AmbienteDeploy = "production" | "preview" | "development" | "desconhecido";

export type VersaoDeploy = {
  identificado: boolean;
  commit: string | null;
  commitCurto: string | null;
  ambiente: AmbienteDeploy;
  origem: "vercel" | "indisponivel";
};

export const ROTULO_AMBIENTE_DEPLOY: Record<AmbienteDeploy, string> = {
  production: "Produção",
  preview: "Prévia",
  development: "Desenvolvimento",
  desconhecido: "Ambiente não identificado",
};

/** SHA completo: um prefixo não é prova suficiente de identidade. */
export function normalizarCommitDeploy(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const commit = valor.trim();
  return /^[a-f0-9]{40}$/i.test(commit) ? commit.toLowerCase() : null;
}

/** Lista fechada: nunca repassar process.env, mensagens de commit, autores ou URLs. */
export function identificarVersaoDeploy(
  metadados: { vercel?: unknown; commit?: unknown; ambiente?: unknown } = {},
): VersaoDeploy {
  const naVercel = metadados.vercel === "1";
  const commit = naVercel ? normalizarCommitDeploy(metadados.commit) : null;
  const ambiente: AmbienteDeploy = naVercel && (
    metadados.ambiente === "production" ||
    metadados.ambiente === "preview" ||
    metadados.ambiente === "development"
  ) ? metadados.ambiente : "desconhecido";

  return {
    identificado: commit !== null,
    commit,
    commitCurto: commit?.slice(0, 7) ?? null,
    ambiente,
    origem: naVercel ? "vercel" : "indisponivel",
  };
}

/** Valida o contrato recebido pelo navegador, sem aceitar valores livres. */
export function versaoDeployValida(valor: unknown): valor is VersaoDeploy {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false;
  const v = valor as Record<string, unknown>;
  const chaves = ["identificado", "commit", "commitCurto", "ambiente", "origem"];
  if (Object.keys(v).length !== chaves.length || !chaves.every((chave) => Object.hasOwn(v, chave))) return false;
  if (v.origem !== "vercel" && v.origem !== "indisponivel") return false;
  const esperado = identificarVersaoDeploy({
    vercel: v.origem === "vercel" ? "1" : undefined,
    commit: v.commit,
    ambiente: v.ambiente,
  });
  return chaves.every((chave) => v[chave] === esperado[chave as keyof VersaoDeploy]);
}

export type ComparacaoDeploy = "confere" | "diverge" | "nao_identificado" | "invalido";

export function compararCommitDeploy(versao: VersaoDeploy, esperado: unknown): ComparacaoDeploy {
  const commitEsperado = normalizarCommitDeploy(esperado);
  if (!commitEsperado) return "invalido";
  if (!versaoDeployValida(versao) || !versao.identificado) return "nao_identificado";
  return versao.commit === commitEsperado ? "confere" : "diverge";
}
