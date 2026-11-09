import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { parametrosFiscais, produtos, produtoTributacoes } from "@/db/schema";
import { avisosTributarios, CAMPOS_TRIBUTARIOS, crtSugeridoParaRegime, PARAMETROS_TRIBUTARIOS_VAZIOS, type ParametrosTributarios, type RegimeFiscalPerfil, type TipoCodigoFiscal } from "@/lib/tributacao";

export type CodigoFiscalDto = { id: string; tipo: TipoCodigoFiscal; codigo: string; nome: string; ativo: boolean };
export type PerfilFiscalDto = { id: string; nome: string; regime: RegimeFiscalPerfil; ativo: boolean; dados: ParametrosTributarios };
export type ProdutoFiscalDto = { id: string; nome: string; sku: string; categoria: string; ativo: boolean; perfilId: string | null; dados: ParametrosTributarios; avisos: string[] };
export type PainelTributacaoDto = {
  empresa: string;
  regime: string;
  crt: number;
  crtConfigurado: boolean;
  crtSugerido: number | null;
  produtos: ProdutoFiscalDto[];
  perfis: PerfilFiscalDto[];
  codigos: CodigoFiscalDto[];
};

export function lerParametrosSalvos(bruto: unknown): ParametrosTributarios {
  const fonte = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, unknown> : {};
  const resultado = { ...PARAMETROS_TRIBUTARIOS_VAZIOS };
  for (const campo of CAMPOS_TRIBUTARIOS) {
    const valor = fonte[campo];
    resultado[campo] = typeof valor === "string" || typeof valor === "number" ? String(valor) : "";
  }
  return resultado;
}

/** Etapa 3: hash do perfil para detectar alteração concorrente entre prévia e aplicação. */
export function hashPerfilFiscal(perfil: { dados: unknown; atualizadoEm: Date | null }): string {
  return createHash("sha256").update(JSON.stringify({ dados: perfil.dados ?? {}, atualizadoEm: perfil.atualizadoEm?.toISOString() ?? null })).digest("hex");
}

export function resolverCrtFiscal(regime: string, fiscal: unknown): { crt: number; configurado: boolean; sugerido: number | null } {
  const config = fiscal && typeof fiscal === "object" ? fiscal as Record<string, unknown> : {};
  const atual = Number(config.crt);
  const sugerido = crtSugeridoParaRegime(regime);
  return { crt: [1, 2, 3, 4].includes(atual) ? atual : (sugerido ?? 1), configurado: [1, 2, 3, 4].includes(atual), sugerido };
}

/** Dados sempre filtrados por empresa; códigos locais não são apresentados como tabela oficial. */
export async function listarPainelTributacao(empresaId: string, nomeEmpresa: string, regime: string, fiscal: unknown): Promise<PainelTributacaoDto> {
  const [itens, registros, complementos] = await Promise.all([
    db.select({ id: produtos.id, nome: produtos.nome, sku: produtos.sku, categoria: produtos.categoria, ativo: produtos.ativo,
      ncm: produtos.ncm, cest: produtos.cest, cfop: produtos.cfop, csosn: produtos.csosn, icmsAliq: produtos.icmsAliq,
      pisAliq: produtos.pisAliq, cofinsAliq: produtos.cofinsAliq, ibsAliq: produtos.ibsAliq, cbsAliq: produtos.cbsAliq })
      .from(produtos).where(eq(produtos.empresaId, empresaId)).orderBy(asc(produtos.nome)),
    db.select().from(parametrosFiscais).where(eq(parametrosFiscais.empresaId, empresaId)).orderBy(asc(parametrosFiscais.nome)),
    db.select().from(produtoTributacoes).where(eq(produtoTributacoes.empresaId, empresaId)),
  ]);
  const porProduto = new Map(complementos.map((c) => [c.produtoId, c]));
  const crtAtual = resolverCrtFiscal(regime, fiscal);
  const resultado: ProdutoFiscalDto[] = itens.map((p) => {
    const complemento = porProduto.get(p.id);
    const dados = lerParametrosSalvos(complemento?.dados);
    // O cadastro principal é a fonte única para campos já existentes no produto.
    Object.assign(dados, { ncm: p.ncm, cest: p.cest, cfop: p.cfop, csosn: p.csosn,
      icmsAliq: String(p.icmsAliq), pisAliq: String(p.pisAliq), cofinsAliq: String(p.cofinsAliq), ibsAliq: String(p.ibsAliq), cbsAliq: String(p.cbsAliq) });
    return { id: p.id, nome: p.nome, sku: p.sku, categoria: p.categoria, ativo: p.ativo, perfilId: complemento?.perfilId ?? null, dados, avisos: avisosTributarios(dados, crtAtual.crt) };
  });
  return {
    empresa: nomeEmpresa, regime, crt: crtAtual.crt, crtConfigurado: crtAtual.configurado, crtSugerido: crtAtual.sugerido,
    produtos: resultado,
    perfis: registros.filter((r) => r.tipo === "perfil").map((r) => ({ id: r.id, nome: r.nome, regime: r.regime as RegimeFiscalPerfil, ativo: r.ativo, dados: lerParametrosSalvos(r.dados) })),
    codigos: registros.filter((r) => r.tipo !== "perfil").map((r) => ({ id: r.id, tipo: r.tipo as TipoCodigoFiscal, codigo: r.codigo, nome: r.nome, ativo: r.ativo })),
  };
}

/** Consulta isolada usada pelo emissor; só retorna complementos da empresa da venda. */
export async function obterComplementosTributarios(empresaId: string, ids: string[]) {
  if (!ids.length) return new Map<string, ParametrosTributarios>();
  const linhas = await db.select({ produtoId: produtoTributacoes.produtoId, dados: produtoTributacoes.dados })
    .from(produtoTributacoes)
    .where(and(eq(produtoTributacoes.empresaId, empresaId), inArray(produtoTributacoes.produtoId, ids)));
  return new Map(linhas.map((l) => [l.produtoId, lerParametrosSalvos(l.dados)]));
}
