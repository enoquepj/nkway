"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { parametrosFiscais, produtos, produtoTributacoes } from "@/db/schema";
import { CAMPOS_TRIBUTARIOS, REGIMES_FISCAIS, aplicarPerfilTributarioPreservando, crtSugeridoParaRegime, diffPerfilTributario, validarCodigoFiscal, validarParametrosTributarios, validarRegimeTributario, type ParametrosTributarios } from "@/lib/tributacao";
import { registrarAuditoria } from "@/server/auditoria";
import { hashPerfilFiscal, lerParametrosSalvos, resolverCrtFiscal } from "@/server/tributacaoCore";
import { carregarTabelasDominioEmbutidas, type ResultadoCargaDominio } from "@/server/tabelasDominio";
import { corpo, exigirPermissao, texto } from "@/server/tenant";

export type ResultadoTributacao = { ok: true; id: string; aviso: string } | { ok: false; erro: string };
const uuidValido = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function atualizarTelas() { ["/config/fiscal/produtos", "/config", "/produtos", "/pdv", "/emissor"].forEach((p) => revalidatePath(p)); }
function falha(e: unknown): ResultadoTributacao {
  const mensagem = e instanceof Error ? e.message : "";
  if (mensagem.startsWith("Sessão expirada") || mensagem.startsWith("Acesso negado")) return { ok: false, erro: mensagem };
  const causa = e && typeof e === "object" ? (e as { cause?: { code?: string }; code?: string }) : {};
  if (causa.code === "23505" || causa.cause?.code === "23505") return { ok: false, erro: "Já existe um registro fiscal com esse código ou nome nesta empresa." };
  console.error("[tributacao] Falha ao salvar parâmetros:", e instanceof Error ? e.name : "erro inesperado");
  return { ok: false, erro: "Não foi possível salvar. Verifique a disponibilidade da parametrização fiscal e tente novamente." };
}

/** Cadastro local de código e descrição, sem alterar tabelas oficiais ou produtos. */
export async function salvarCodigoFiscal(bruto: unknown): Promise<ResultadoTributacao> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const entrada = corpo<{ id?: unknown; tipo?: unknown; codigo?: unknown; nome?: unknown }>(bruto);
    const id = texto(entrada.id);
    if (id && !uuidValido(id)) return { ok: false, erro: "Identificador de código inválido." };
    const validado = validarCodigoFiscal(entrada.tipo, entrada.codigo);
    if (!validado.ok) return validado;
    const nome = texto(entrada.nome).trim();
    if (nome.length < 3 || nome.length > 180) return { ok: false, erro: "Informe uma descrição de 3 a 180 caracteres." };
    const resultado = await db.transaction(async (tx) => {
      const [duplicado] = await tx.select({ id: parametrosFiscais.id }).from(parametrosFiscais).where(and(
        eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, validado.tipo), eq(parametrosFiscais.codigo, validado.codigo),
        id ? ne(parametrosFiscais.id, id) : undefined,
      )).limit(1);
      if (duplicado) return { ok: false as const, erro: "Já existe um código desse tipo para esta empresa." };
      let registroId = id;
      let anterior: { tipo: string; codigo: string; nome: string } | null = null;
      if (id) {
        const [atual] = await tx.select().from(parametrosFiscais).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId), ne(parametrosFiscais.tipo, "perfil"))).for("update");
        if (!atual) return { ok: false as const, erro: "Código fiscal não encontrado nesta empresa." };
        anterior = { tipo: atual.tipo, codigo: atual.codigo, nome: atual.nome };
        await tx.update(parametrosFiscais).set({ tipo: validado.tipo, codigo: validado.codigo, nome, atualizadoEm: new Date() }).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId)));
      } else {
        const [novo] = await tx.insert(parametrosFiscais).values({ empresaId, tipo: validado.tipo, codigo: validado.codigo, nome, regime: "todos", dados: {}, ativo: true }).returning({ id: parametrosFiscais.id });
        registroId = novo.id;
      }
      await registrarAuditoria({ empresaId, usuario, acao: id ? "fiscal.codigo_editar" : "fiscal.codigo_criar", entidade: "fiscal_parametro", registroId,
        resumo: `${id ? "Código fiscal atualizado" : "Código fiscal cadastrado"}: ${validado.tipo.toUpperCase()} ${validado.codigo}`,
        alteracoes: { antes: anterior, depois: { tipo: validado.tipo, codigo: validado.codigo, nome } } }, tx);
      return { ok: true as const, id: registroId, aviso: "Código salvo. Produtos e perfis existentes não foram alterados." };
    });
    if (resultado.ok) atualizarTelas();
    return resultado;
  } catch (e) { return falha(e); }
}

/** Um perfil é um modelo; alterar o modelo não altera produtos já parametrizados. */
export async function salvarPerfilFiscal(bruto: unknown): Promise<ResultadoTributacao> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const entrada = corpo<{ id?: unknown; nome?: unknown; regime?: unknown; dados?: unknown }>(bruto);
    const id = texto(entrada.id), nome = texto(entrada.nome).trim(), regime = texto(entrada.regime) || "todos";
    if (id && !uuidValido(id)) return { ok: false, erro: "Identificador do perfil inválido." };
    if (nome.length < 3 || nome.length > 120) return { ok: false, erro: "Informe um nome de perfil com 3 a 120 caracteres." };
    if (!REGIMES_FISCAIS.some((r) => r.id === regime)) return { ok: false, erro: "Selecione um regime tributário válido." };
    const validado = validarParametrosTributarios(entrada.dados);
    if (!validado.ok) return validado;
    const crt = crtSugeridoParaRegime(regime);
    const incompatibilidade = crt ? validarRegimeTributario(validado.dados, crt) : null;
    if (incompatibilidade) return { ok: false, erro: incompatibilidade };
    const resultado = await db.transaction(async (tx) => {
      const [duplicado] = await tx.select({ id: parametrosFiscais.id }).from(parametrosFiscais).where(and(
        eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil"),
        sql`lower(${parametrosFiscais.nome}) = lower(${nome})`, id ? ne(parametrosFiscais.id, id) : undefined,
      )).limit(1);
      if (duplicado) return { ok: false as const, erro: "Já existe um perfil com esse nome nesta empresa." };
      let registroId = id;
      let anterior: unknown = null;
      if (id) {
        const [atual] = await tx.select().from(parametrosFiscais).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil"))).for("update");
        if (!atual) return { ok: false as const, erro: "Perfil fiscal não encontrado nesta empresa." };
        anterior = { nome: atual.nome, regime: atual.regime, dados: atual.dados };
        await tx.update(parametrosFiscais).set({ nome, regime, dados: validado.dados, atualizadoEm: new Date() }).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil")));
      } else {
        const [novo] = await tx.insert(parametrosFiscais).values({ empresaId, tipo: "perfil", codigo: "", nome, regime, dados: validado.dados, ativo: true }).returning({ id: parametrosFiscais.id });
        registroId = novo.id;
      }
      await registrarAuditoria({ empresaId, usuario, acao: id ? "fiscal.perfil_editar" : "fiscal.perfil_criar", entidade: "fiscal_parametro", registroId,
        resumo: `${id ? "Perfil fiscal atualizado" : "Perfil fiscal cadastrado"}: ${nome}`,
        alteracoes: { antes: anterior, depois: { nome, regime, dados: validado.dados } } }, tx);
      return { ok: true as const, id: registroId, aviso: "Perfil salvo. Produtos existentes só mudam quando o perfil for aplicado e salvo em cada produto." };
    });
    if (resultado.ok) atualizarTelas();
    return resultado;
  } catch (e) { return falha(e); }
}

/** Desativar preserva produtos, referências e trilha histórica. */
export async function alterarStatusParametroFiscal(bruto: unknown): Promise<ResultadoTributacao> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const entrada = corpo<{ id?: unknown; ativo?: unknown }>(bruto);
    const id = texto(entrada.id);
    if (!uuidValido(id)) return { ok: false, erro: "Identificador fiscal inválido." };
    if (typeof entrada.ativo !== "boolean") return { ok: false, erro: "Informe se o registro deve ser ativado ou desativado." };
    const ativo = entrada.ativo;
    const resultado = await db.transaction(async (tx) => {
      const [atual] = await tx.select().from(parametrosFiscais).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId))).for("update");
      if (!atual) return { ok: false as const, erro: "Registro fiscal não encontrado nesta empresa." };
      await tx.update(parametrosFiscais).set({ ativo, atualizadoEm: new Date() }).where(and(eq(parametrosFiscais.id, id), eq(parametrosFiscais.empresaId, empresaId)));
      await registrarAuditoria({ empresaId, usuario, acao: "fiscal.parametro_status", entidade: "fiscal_parametro", registroId: id,
        resumo: `${atual.tipo === "perfil" ? "Perfil" : "Código"} fiscal ${ativo ? "ativado" : "desativado"}: ${atual.nome}`,
        alteracoes: { antes: { ativo: atual.ativo }, depois: { ativo } } }, tx);
      return { ok: true as const, id, aviso: ativo ? "Registro ativado." : "Registro desativado; os produtos existentes foram preservados." };
    });
    if (resultado.ok) atualizarTelas();
    return resultado;
  } catch (e) { return falha(e); }
}

/** Grava o complemento e os campos existentes do produto em uma transação isolada por empresa. */
export async function salvarTributacaoProduto(bruto: unknown): Promise<ResultadoTributacao> {
  try {
    const { empresaId, empresa, usuario } = await exigirPermissao("config.gerenciar");
    const entrada = corpo<{ produtoId?: unknown; perfilId?: unknown; dados?: unknown; sobrescreverNcmCest?: unknown }>(bruto);
    // Etapa 3: a central não sobrescreve NCM/CEST silenciosamente; só com escolha explícita auditada.
    const sobrescreverNcmCest = entrada.sobrescreverNcmCest === true;
    const produtoId = texto(entrada.produtoId), perfilId = texto(entrada.perfilId);
    if (!uuidValido(produtoId) || (perfilId && !uuidValido(perfilId))) return { ok: false, erro: "Produto ou perfil fiscal inválido." };
    if (!entrada.dados || typeof entrada.dados !== "object" || Array.isArray(entrada.dados) || CAMPOS_TRIBUTARIOS.some((campo) => !Object.prototype.hasOwnProperty.call(entrada.dados, campo))) {
      return { ok: false, erro: "Envie o formulário fiscal completo para não sobrescrever dados existentes." };
    }
    const validado = validarParametrosTributarios(entrada.dados);
    if (!validado.ok) return validado;
    const crt = resolverCrtFiscal(empresa.regime, empresa.fiscal).crt;
    const incompatibilidade = validarRegimeTributario(validado.dados, crt);
    if (incompatibilidade) return { ok: false, erro: incompatibilidade };
    const resultado = await db.transaction(async (tx) => {
      const [produto] = await tx.select().from(produtos).where(and(eq(produtos.id, produtoId), eq(produtos.empresaId, empresaId))).for("update");
      if (!produto) return { ok: false as const, erro: "Produto não encontrado nesta empresa." };
      const [complemento] = await tx.select().from(produtoTributacoes).where(eq(produtoTributacoes.produtoId, produtoId)).for("update");
      if (complemento && complemento.empresaId !== empresaId) return { ok: false as const, erro: "Parâmetros do produto indisponíveis para esta empresa." };
      if (perfilId) {
        const [perfil] = await tx.select().from(parametrosFiscais).where(and(eq(parametrosFiscais.id, perfilId), eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil"))).limit(1).for("share");
        if (!perfil || (!perfil.ativo && complemento?.perfilId !== perfilId)) return { ok: false as const, erro: "Perfil fiscal ativo não encontrado nesta empresa." };
        if (perfil.regime !== "todos" && perfil.regime !== empresa.regime && complemento?.perfilId !== perfilId) return { ok: false as const, erro: "O perfil escolhido não corresponde ao regime da empresa." };
      }
      const d = validado.dados;
      const atualizado = {
        ncm: sobrescreverNcmCest ? (d.ncm || produto.ncm) : produto.ncm,
        cest: sobrescreverNcmCest ? d.cest : produto.cest,
        cfop: d.cfop || produto.cfop, csosn: d.tipoIcms === "csosn" ? (d.csosn || produto.csosn) : produto.csosn,
        icmsAliq: d.icmsAliq === "" ? produto.icmsAliq : Number(d.icmsAliq),
        pisAliq: d.pisAliq === "" ? produto.pisAliq : Number(d.pisAliq),
        cofinsAliq: d.cofinsAliq === "" ? produto.cofinsAliq : Number(d.cofinsAliq),
        ibsAliq: d.ibsAliq === "" ? produto.ibsAliq : Number(d.ibsAliq),
        cbsAliq: d.cbsAliq === "" ? produto.cbsAliq : Number(d.cbsAliq), atualizadoEm: new Date(),
      };
      await tx.update(produtos).set(atualizado).where(and(eq(produtos.id, produtoId), eq(produtos.empresaId, empresaId)));
      if (complemento) {
        await tx.update(produtoTributacoes).set({ perfilId: perfilId || null, dados: d, atualizadoEm: new Date() }).where(and(eq(produtoTributacoes.id, complemento.id), eq(produtoTributacoes.empresaId, empresaId)));
      } else {
        await tx.insert(produtoTributacoes).values({ empresaId, produtoId, perfilId: perfilId || null, dados: d });
      }
      await registrarAuditoria({ empresaId, usuario, acao: "fiscal.produto_parametrizar", entidade: "produto", registroId: produtoId,
        resumo: `Tributação do produto ${produto.nome} atualizada${sobrescreverNcmCest ? " (NCM/CEST sobrescritos por escolha explícita)" : " (NCM/CEST preservados)"}`,
        alteracoes: { antes: { ncm: produto.ncm, cest: produto.cest, cfop: produto.cfop, csosn: produto.csosn, complemento: complemento?.dados ?? null }, depois: { ...d, perfilId: perfilId || null }, sobrescreverNcmCest, ncmCestPreservados: !sobrescreverNcmCest } }, tx);
      return { ok: true as const, id: produtoId, aviso: "Tributação do produto salva e registrada na auditoria." };
    });
    if (resultado.ok) atualizarTelas();
    return resultado;
  } catch (e) { return falha(e); }
}

export type PreviaPerfilDto = {
  ok: true;
  produto: { id: string; nome: string };
  perfil: { id: string; nome: string; regime: string; ativo: boolean; atualizadoEm: string; hash: string };
  antes: ParametrosTributarios;
  depois: ParametrosTributarios;
  camposAfetados: { campo: string; de: string; para: string }[];
  avisos: string[];
  compativel: boolean;
  motivo?: string;
  sobrescreverNcmCest: boolean;
} | { ok: false; erro: string };

/**
 * Etapa 3 — prévia SOMENTE LEITURA do que a aplicação explícita de um perfil alteraria.
 * Nunca aplica nada; o hash permite que a aplicação recuse um perfil alterado depois da prévia.
 */
export async function preverPerfilProduto(bruto: unknown): Promise<PreviaPerfilDto> {
  try {
    const { empresaId, empresa } = await exigirPermissao("cadastros.produtos");
    const entrada = corpo<{ produtoId?: unknown; perfilId?: unknown; sobrescreverNcmCest?: unknown }>(bruto);
    const produtoId = texto(entrada.produtoId), perfilId = texto(entrada.perfilId);
    if (!uuidValido(produtoId) || !uuidValido(perfilId)) return { ok: false, erro: "Produto ou perfil fiscal inválido." };
    const sobrescrever = entrada.sobrescreverNcmCest === true;
    const [produto] = await db.select().from(produtos).where(and(eq(produtos.id, produtoId), eq(produtos.empresaId, empresaId))).limit(1);
    if (!produto) return { ok: false, erro: "Produto não encontrado nesta empresa." };
    const [perfil] = await db.select().from(parametrosFiscais).where(and(eq(parametrosFiscais.id, perfilId), eq(parametrosFiscais.empresaId, empresaId), eq(parametrosFiscais.tipo, "perfil"))).limit(1);
    if (!perfil) return { ok: false, erro: "Perfil fiscal não encontrado nesta empresa." };
    const [complemento] = await db.select().from(produtoTributacoes).where(and(eq(produtoTributacoes.produtoId, produtoId), eq(produtoTributacoes.empresaId, empresaId))).limit(1);
    const jaVinculado = complemento?.perfilId === perfilId;
    let compativel = true; let motivo: string | undefined;
    if (!perfil.ativo && !jaVinculado) { compativel = false; motivo = "Perfil inativo não pode ser aplicado como novo vínculo; vínculos históricos são apenas exibidos."; }
    if (perfil.regime !== "todos" && perfil.regime !== empresa.regime && !jaVinculado) { compativel = false; motivo = "O regime do perfil não corresponde ao regime da empresa."; }
    const crt = resolverCrtFiscal(empresa.regime, empresa.fiscal).crt;
    const antes: ParametrosTributarios = {
      ...lerParametrosSalvos(complemento?.dados),
      ncm: produto.ncm, cest: produto.cest, cfop: produto.cfop, csosn: produto.csosn,
      icmsAliq: String(produto.icmsAliq), pisAliq: String(produto.pisAliq), cofinsAliq: String(produto.cofinsAliq),
      ibsAliq: String(produto.ibsAliq), cbsAliq: String(produto.cbsAliq),
    };
    const depois = aplicarPerfilTributarioPreservando(antes, lerParametrosSalvos(perfil.dados), sobrescrever);
    const incompat = validarRegimeTributario(depois, crt);
    if (incompat) { compativel = false; motivo = incompat; }
    return {
      ok: true,
      produto: { id: produto.id, nome: produto.nome },
      perfil: { id: perfil.id, nome: perfil.nome, regime: perfil.regime, ativo: perfil.ativo, atualizadoEm: perfil.atualizadoEm?.toISOString() ?? "", hash: hashPerfilFiscal(perfil) },
      antes, depois,
      camposAfetados: diffPerfilTributario(antes, depois),
      avisos: [...avisosTributariosLocal(depois, crt), ...(perfilDadosTemClassificacao(perfil.dados) && !sobrescrever ? ["O perfil contém NCM/CEST, que NÃO serão aplicados: a classificação do produto é preservada por padrão."] : [])],
      compativel, ...(motivo ? { motivo } : {}),
      sobrescreverNcmCest: sobrescrever,
    };
  } catch (e) { return falha(e) as { ok: false; erro: string }; }
}

function avisosTributariosLocal(dados: ParametrosTributarios, crt: number): string[] {
  const avisos: string[] = [];
  if (!dados.ncm || dados.ncm === "00000000") avisos.push("NCM não informado ou genérico.");
  const incompat = validarRegimeTributario(dados, crt);
  if (incompat) avisos.push(incompat);
  return avisos;
}
function perfilDadosTemClassificacao(dados: unknown): boolean {
  const d = dados && typeof dados === "object" ? dados as Record<string, unknown> : {};
  return Boolean(String(d.ncm ?? "") || String(d.cest ?? ""));
}

/** Carga administrativa das tabelas fiscais de referência (CST, CFOP, cClassTrib, origem) a partir dos instantâneos embutidos. Idempotente e auditada. */
export async function carregarTabelasFiscaisReferencia(): Promise<{ ok: true; resultados: ResultadoCargaDominio[]; aviso: string } | { ok: false; erro: string }> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const resultados = await carregarTabelasDominioEmbutidas(db, { empresaId, id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    atualizarTelas();
    const novas = resultados.reduce((s, r) => s + r.inseridas, 0), mudadas = resultados.reduce((s, r) => s + r.atualizadas, 0);
    return { ok: true, resultados, aviso: `Tabelas de referência carregadas: ${novas} código(s) novo(s), ${mudadas} atualizado(s), ${resultados.length} tabelas. Seleção de código não certifica enquadramento.` };
  } catch (e) { const f = falha(e); return { ok: false, erro: f.ok ? "Falha inesperada." : f.erro }; }
}
