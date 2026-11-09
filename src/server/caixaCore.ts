/**
 * NKWAY — Núcleo server-side do Caixa por Operador (correção 2026-11).
 * Fonte única para: carregar insumos da sessão (SEM filtro por tipo fiscal), apurar pela regra
 * `apurarSessaoCaixa` e fechar a sessão dentro de transação com trava de linha.
 * Reutilizado por `src/server/acoes/caixa.ts`, `src/server/dados.ts` e pela bateria de testes.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { caixaMovimentos, caixaQuebraLogs, caixaSessoes, usuarios, vendas } from "@/db/schema";
import {
  apurarSessaoCaixa,
  calcularConferenciaCaixa,
  FUNDO_TROCO_PADRAO,
  LIMITE_DINHEIRO_GAVETA,
  type ApuracaoSessaoCaixa,
  type MovimentoCaixaInput,
  type VendaCaixaInput,
  lerValorDinheiro,
} from "@/lib/caixa";
import { FORMAS_PAGAMENTO, moeda, round2 } from "@/lib/dominio";
import { temPermissao } from "@/lib/permissoes";
import { confereSenha } from "@/lib/session";
import { registrarAuditoria } from "@/server/auditoria";

/** `db` ou a transação `tx` — ambos expõem `select` */
type Executor = Pick<typeof db, "select">;

function N(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function normalizarVendaCaixa(v: {
  id: string;
  empresaId: string;
  caixaSessaoId: string | null;
  tipo: string;
  status: string;
  total: unknown;
  formaPagamento: string;
  pagamentos: unknown;
  davOrigemId: string | null;
  origem: string | null;
}): VendaCaixaInput {
  return {
    id: v.id,
    empresaId: v.empresaId,
    caixaSessaoId: v.caixaSessaoId,
    tipo: v.tipo,
    status: v.status,
    total: N(v.total),
    formaPagamento: v.formaPagamento,
    pagamentos: (Array.isArray(v.pagamentos) ? v.pagamentos : []) as { forma: string; valor: number }[],
    davOrigemId: v.davOrigemId,
    origem: v.origem,
  };
}

export function normalizarMovimentoCaixa(m: {
  id: string;
  tipo: string;
  forma: string;
  valor: unknown;
  motivo: string | null;
  vendaId: string | null;
  usuarioNome: string | null;
  createdAt: Date | null;
}): MovimentoCaixaInput {
  return {
    id: m.id,
    tipo: m.tipo as MovimentoCaixaInput["tipo"],
    forma: m.forma,
    valor: N(m.valor),
    motivo: m.motivo ?? "",
    vendaId: m.vendaId,
    usuarioNome: m.usuarioNome ?? "",
    criadoEm: m.createdAt ? new Date(m.createdAt).toISOString() : "",
  };
}

/**
 * Carrega TODAS as vendas vinculadas às sessões (qualquer tipo/status — a seleção é do motor) e os
 * movimentos. Inclui também os DAVs de origem das vendas filhas para resolver a identidade econômica.
 */
export async function carregarInsumosSessoes(empresaId: string, sessaoIds: string[], exec: Executor = db) {
  if (sessaoIds.length === 0) {
    return { vendasPorSessao: new Map<string, VendaCaixaInput[]>(), movsPorSessao: new Map<string, MovimentoCaixaInput[]>() };
  }
  const colunas = {
    id: vendas.id,
    empresaId: vendas.empresaId,
    caixaSessaoId: vendas.caixaSessaoId,
    tipo: vendas.tipo,
    status: vendas.status,
    total: vendas.total,
    formaPagamento: vendas.formaPagamento,
    pagamentos: vendas.pagamentos,
    davOrigemId: vendas.davOrigemId,
    origem: vendas.origem,
  };
  const [vds, movs] = await Promise.all([
    exec
      .select(colunas)
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), inArray(vendas.caixaSessaoId, sessaoIds))),
    exec
      .select()
      .from(caixaMovimentos)
      .where(and(eq(caixaMovimentos.empresaId, empresaId), inArray(caixaMovimentos.sessaoId, sessaoIds))),
  ]);

  // DAVs de origem (mesma empresa) que não estejam na lista: necessários para classificar vendas filhas
  const idsPresentes = new Set(vds.map((v) => v.id));
  const paisFaltantes = [...new Set(vds.map((v) => v.davOrigemId).filter((id): id is string => Boolean(id) && !idsPresentes.has(id!)))];
  const pais = paisFaltantes.length
    ? await exec
        .select(colunas)
        .from(vendas)
        .where(and(eq(vendas.empresaId, empresaId), inArray(vendas.id, paisFaltantes)))
    : [];

  const vendasPorSessao = new Map<string, VendaCaixaInput[]>();
  const movsPorSessao = new Map<string, MovimentoCaixaInput[]>();
  for (const id of sessaoIds) {
    vendasPorSessao.set(id, []);
    movsPorSessao.set(id, []);
  }
  for (const v of vds) {
    if (v.caixaSessaoId) vendasPorSessao.get(v.caixaSessaoId)?.push(normalizarVendaCaixa(v));
  }
  // o DAV pai acompanha cada sessão que tenha uma filha dele (o motor decide se ele compõe ou não)
  const paisNorm = pais.map(normalizarVendaCaixa);
  for (const [sessaoId, lista] of vendasPorSessao) {
    const paisDaSessao = new Set(lista.map((v) => v.davOrigemId).filter(Boolean));
    for (const p of paisNorm) if (paisDaSessao.has(p.id)) lista.push(p);
    void sessaoId;
  }
  for (const m of movs) movsPorSessao.get(m.sessaoId)?.push(normalizarMovimentoCaixa(m));

  return { vendasPorSessao, movsPorSessao };
}

export async function carregarInsumosSessao(empresaId: string, sessaoId: string, exec: Executor = db) {
  const { vendasPorSessao, movsPorSessao } = await carregarInsumosSessoes(empresaId, [sessaoId], exec);
  return { vendasNorm: vendasPorSessao.get(sessaoId) ?? [], movsNorm: movsPorSessao.get(sessaoId) ?? [] };
}

/** Apuração ao vivo de uma sessão direto do banco (regra única do motor). */
export async function apurarSessaoNoBanco(
  empresaId: string,
  sessao: { id: string; saldoInicial: unknown },
  exec: Executor = db,
): Promise<ApuracaoSessaoCaixa> {
  const { vendasNorm, movsNorm } = await carregarInsumosSessao(empresaId, sessao.id, exec);
  return apurarSessaoCaixa({
    sessaoId: sessao.id,
    empresaId,
    saldoInicial: N(sessao.saldoInicial),
    vendas: vendasNorm,
    movimentos: movsNorm,
  });
}

export function lerInformados(mapaBruto: Record<string, unknown>): { ok: true; valores: Record<string, number> } | { ok: false; erro: string } {
  const valores: Record<string, number> = {};
  let total = 0;
  for (const fp of FORMAS_PAGAMENTO) {
    const bruto = mapaBruto?.[fp.id];
    // Aceita "150,50", "150.50", "1.500,50" e "1,500.50": o último separador é o decimal (ver lerValorDinheiro).
    const v = lerValorDinheiro(bruto);
    if (v === null || v < 0 || v > 9_999_999_999.99) return { ok: false, erro: `Informe um valor válido e não negativo em ${fp.label}.` };
    valores[fp.id] = round2(v);
    total = round2(total + valores[fp.id]);
    if (total > 9_999_999_999.99) return { ok: false, erro: "A soma informada excede o limite permitido para o fechamento." };
  }
  return { ok: true, valores };
}

export type ResultadoFechamentoCaixa =
  | {
      ok: true;
      sessaoId: string;
      numero: number;
      operadorNome: string;
      /** Houve divergência/inconsistência real (turno marcado DIVERGE na auditoria). */
      diverge?: boolean;
      /** DIVERGE aceito sem gerente presente: aguarda homologação em /dashboard/auditoria-caixa. */
      pendenteHomologacao?: boolean;
      apuracao: ApuracaoSessaoCaixa;
      conferencia: ReturnType<typeof calcularConferenciaCaixa>;
      justificativa: string;
    }
  | { ok: false; erro: string; requerHomologacao?: boolean };

/**
 * Núcleo único de fechamento. Em modo cego, sessão, apuração, aprovação, snapshot,
 * recolhimento, logs de quebra e auditoria são confirmados na mesma transação.
 * A opção cega é obrigatória nos dois pontos públicos de fechamento.
 */
export async function fecharSessaoCaixaTransacional(params: {
  empresaId: string;
  sessaoId: string;
  usuario: { id: string; nome: string; papel: string };
  valoresInformados: Record<string, unknown>;
  justificativa: string;
  cego?: { gerenteEmail: string; gerenteSenha: string; origem: "pdv" | "caixa" };
}): Promise<ResultadoFechamentoCaixa> {
  const justificativa = String(params.justificativa ?? "").trim();
  const informados = lerInformados(params.valoresInformados ?? {});
  if (!informados.ok) return informados;

  return db.transaction(async (tx) => {
    const [sessao] = await tx
      .select()
      .from(caixaSessoes)
      .where(and(eq(caixaSessoes.id, params.sessaoId), eq(caixaSessoes.empresaId, params.empresaId)))
      .for("update");

    if (!sessao) return { ok: false as const, erro: "Sessão de caixa não encontrada." };
    if (sessao.operadorId !== params.usuario.id && !temPermissao(params.usuario.papel, "caixa.relatorio_todos")) {
      return { ok: false as const, erro: "Você só pode fechar a sua própria sessão de caixa." };
    }
    if (sessao.status !== "aberto") {
      return { ok: false as const, erro: `O Caixa #${sessao.numero} já está fechado. Fechamento duplicado impedido.` };
    }

    const apuracao = await apurarSessaoNoBanco(params.empresaId, sessao, tx);
    const conferencia = calcularConferenciaCaixa(apuracao.esperadosMap, informados.valores);

    // Nunca use apenas a diferença líquida: uma falta e uma sobra podem se anular.
    const exigeHomologacao = conferencia.temDivergencia || apuracao.inconsistencias.length > 0;
    const somaSobra = round2(Object.values(conferencia.diferencas).reduce((s, d) => s + Math.max(0, d), 0));
    const somaFalta = round2(Object.values(conferencia.diferencas).reduce((s, d) => s + Math.max(0, -d), 0));
    let gerenteId: string | null = null;
    // Divergência real (fechamento cego): o turno é ACEITO e marcado "DIVERGE" (status pendente + log de quebra + auditoria crítica).
    // O gerente pode homologar na hora (e-mail + PIN) ou depois em /dashboard/auditoria-caixa. Justificativa continua obrigatória.
    let divergeAceito = false;
    if (params.cego && exigeHomologacao) {
      if (justificativa.length < 10) {
        return { ok: false as const, erro: "Há divergência ou inconsistência. Informe a justificativa (mín. 10 caracteres); a homologação do gerente pode ser feita agora ou depois na auditoria.", requerHomologacao: true };
      }
      const email = params.cego.gerenteEmail.trim().toLowerCase();
      const senha = params.cego.gerenteSenha;
      if (email || senha) {
        // Credencial informada: precisa ser válida — credencial errada nunca é "aceita como pendente" em silêncio.
        if (!email || !senha) {
          return { ok: false as const, erro: "Informe e-mail e PIN/senha do gerente juntos, ou deixe ambos em branco para registrar como DIVERGE pendente.", requerHomologacao: true };
        }
        const [gerente] = await tx.select({ id: usuarios.id, papel: usuarios.papel, senhaHash: usuarios.senhaHash })
          .from(usuarios)
          .where(and(eq(usuarios.empresaId, params.empresaId), eq(usuarios.email, email), eq(usuarios.ativo, true)))
          .limit(1).for("share");
        if (!gerente || !temPermissao(gerente.papel, "caixa.homologar") || !confereSenha(senha, gerente.senhaHash)) {
          return { ok: false as const, erro: "Homologação negada: credencial inválida ou usuário sem permissão. Corrija ou deixe em branco para registrar como DIVERGE pendente.", requerHomologacao: true };
        }
        gerenteId = gerente.id;
      } else {
        divergeAceito = true;
      }
    } else if (!params.cego) {
      if (apuracao.inconsistencias.length > 0 && justificativa.length < 10) {
        const lista = apuracao.inconsistencias.map((i) => `${i.vendaId.slice(0, 8)}: ${i.motivo}`).join(" · ");
        return { ok: false as const, erro: `Recebimento inconsistente em ${apuracao.inconsistencias.length} venda(s) desta sessão (${lista}). Corrija a venda ou informe uma justificativa com no mínimo 10 caracteres.` };
      }
      if (conferencia.temDivergencia && justificativa.length < 10) {
        return { ok: false as const, erro: `Há divergência de ${moeda(conferencia.diferencaTotal)} na conferência. Informe uma justificativa com no mínimo 10 caracteres.` };
      }
    }

    const [fechado] = await tx
      .update(caixaSessoes)
      .set({
        status: "fechado",
        valoresEsperados: apuracao.esperadosMap,
        valoresInformados: conferencia.informados,
        diferencas: conferencia.diferencas,
        totalEsperado: conferencia.totalEsperado,
        totalInformado: conferencia.totalInformado,
        diferencaTotal: conferencia.diferencaTotal,
        justificativaFechamento: justificativa,
        fechadoEm: new Date(),
        fechadoPorId: params.usuario.id,
        fechadoPorNome: params.usuario.nome,
        ...(params.cego ? { fundoTroco: FUNDO_TROCO_PADRAO, statusAprovacao: exigeHomologacao ? (divergeAceito ? "pendente" : "homologado") : null, homologadoPorUsuarioId: gerenteId } : {}),
      })
      .where(
        and(eq(caixaSessoes.id, sessao.id), eq(caixaSessoes.empresaId, params.empresaId), eq(caixaSessoes.status, "aberto")),
      )
      .returning({ id: caixaSessoes.id });

    if (!fechado) {
      return { ok: false as const, erro: `O Caixa #${sessao.numero} já foi fechado em outro acesso simultâneo.` };
    }

    if (params.cego) {
      const recolhido = round2(Math.max(0, (informados.valores.dinheiro ?? 0) - FUNDO_TROCO_PADRAO));
      if (recolhido > 0) {
        await tx.insert(caixaMovimentos).values({
          empresaId: params.empresaId, sessaoId: sessao.id, tipo: "cofre", forma: "dinheiro", valor: recolhido,
          motivo: `Recolhimento líquido ao cofre · fundo de troco de ${moeda(FUNDO_TROCO_PADRAO)} provisionado`,
          usuarioId: params.usuario.id, usuarioNome: params.usuario.nome,
        });
      }
      const homologadoEm = new Date();
      const registrosQuebra = [
        ...(somaFalta >= 0.01 ? [{ tipo: "FALTA", valorDiferenca: somaFalta }] : []),
        ...(somaSobra >= 0.01 ? [{ tipo: "SOBRA", valorDiferenca: somaSobra }] : []),
      ];
      if (registrosQuebra.length) {
        await tx.insert(caixaQuebraLogs).values(registrosQuebra.map((q) => ({
          empresaId: params.empresaId, sessaoId: sessao.id, usuarioId: params.usuario.id,
          tipo: q.tipo, valorDiferenca: q.valorDiferenca, justificativa,
          homologadoPorUsuarioId: gerenteId, homologadoEm: gerenteId ? homologadoEm : null,
        })));
      }
      const tipoQuebra = somaFalta >= 0.01 && somaSobra >= 0.01 ? "MISTA" : somaFalta >= 0.01 ? "FALTA" : somaSobra >= 0.01 ? "SOBRA" : null;
      await registrarAuditoria({
        empresaId: params.empresaId,
        usuario: params.usuario,
        acao: params.cego.origem === "caixa" ? "caixa.fechar" : "caixa.fechamento_cego",
        entidade: "caixa_sessao",
        registroId: sessao.id,
        resumo: exigeHomologacao
          ? `DIVERGE · Turno #${sessao.numero} encerrado às cegas com ${tipoQuebra ?? "inconsistência"} de ${moeda(round2(somaFalta + somaSobra))} · ${divergeAceito ? "PENDENTE de homologação" : "homologado pelo gerente"} · cofre ${moeda(recolhido)}`
          : `Turno #${sessao.numero} encerrado às cegas · sem divergência · cofre ${moeda(recolhido)}`,
        alteracoes: {
          criticidade: exigeHomologacao ? "critica" : "normal", diverge: exigeHomologacao, statusAprovacao: exigeHomologacao ? (divergeAceito ? "pendente" : "homologado") : null,
          numero: sessao.numero, operador: sessao.operadorNome, esperados: apuracao.esperadosMap,
          informados: conferencia.informados, diferencas: conferencia.diferencas,
          diferencaTotal: conferencia.diferencaTotal, tipoQuebra, somaFalta, somaSobra,
          justificativa: justificativa || null, homologadoPorUsuarioId: gerenteId,
          fundoTroco: FUNDO_TROCO_PADRAO, recolhidoCofre: recolhido,
          limiteGaveta: LIMITE_DINHEIRO_GAVETA, estadoGaveta: apuracao.estadoGaveta,
          inconsistencias: apuracao.inconsistencias,
        },
      }, tx);
    }

    return {
      ok: true as const,
      sessaoId: sessao.id,
      numero: sessao.numero,
      operadorNome: sessao.operadorNome,
      diverge: exigeHomologacao,
      pendenteHomologacao: divergeAceito,
      apuracao,
      conferencia,
      justificativa,
    };
  });
}

/**
 * Estado lógico da gaveta para o PDV (Etapa 2/2026).
 * REGRA: devolve APENAS o estado e o boolean de bloqueio — nenhum valor esperado
 * ou saldo em dinheiro sai do servidor para a tela do operador (blind balance).
 */
export async function obterEstadoGavetaSessao(empresaId: string, usuarioId: string) {
  const [sessao] = await db
    .select({
      id: caixaSessoes.id,
      numero: caixaSessoes.numero,
      terminal: caixaSessoes.terminal,
      saldoInicial: caixaSessoes.saldoInicial,
      operadorNome: caixaSessoes.operadorNome,
    })
    .from(caixaSessoes)
    .where(
      and(
        eq(caixaSessoes.empresaId, empresaId),
        eq(caixaSessoes.operadorId, usuarioId),
        eq(caixaSessoes.status, "aberto"),
      ),
    )
    .limit(1);
  if (!sessao) return null;

  const apuracao = await apurarSessaoNoBanco(empresaId, sessao);
  return {
    sessaoId: sessao.id,
    numero: sessao.numero,
    terminal: sessao.terminal,
    operadorNome: sessao.operadorNome,
    estadoGaveta: apuracao.estadoGaveta,
    bloquearVendaDinheiro: apuracao.bloquearVendaDinheiro,
  };
}

export type LinhaAuditoriaCaixa = {
  sessaoId: string;
  numero: number;
  terminal: string;
  operadorNome: string;
  status: string;
  statusAprovacao: string | null;
  abertoEm: string;
  fechadoEm: string;
  valoresEsperados: Record<string, number>;
  valoresInformados: Record<string, number>;
  diferencas: Record<string, number>;
  totalEsperado: number;
  totalInformado: number;
  diferencaTotal: number;
  justificativaFechamento: string;
  quebras: {
    id: string;
    valorDiferenca: number;
    tipo: string;
    justificativa: string;
    homologadoPorUsuarioId: string | null;
    homologadoEm: string | null;
  }[];
};

/** Join `nk_caixa_sessao` × `nk_caixa_quebra_log` para `/dashboard/auditoria-caixa` (somente gerentes). */
export async function listarAuditoriaCaixa(empresaId: string, limite = 100): Promise<LinhaAuditoriaCaixa[]> {
  const sessoes = await db
    .select()
    .from(caixaSessoes)
    .where(and(eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.status, "fechado")))
    .orderBy(desc(caixaSessoes.fechadoEm))
    .limit(Math.min(500, Math.max(1, limite)));
  if (sessoes.length === 0) return [];

  const ids = sessoes.map((s) => s.id);
  const logs = await db
    .select()
    .from(caixaQuebraLogs)
    .where(and(eq(caixaQuebraLogs.empresaId, empresaId), inArray(caixaQuebraLogs.sessaoId, ids)));
  const porSessao = new Map<string, typeof logs>();
  for (const log of logs) {
    const lista = porSessao.get(log.sessaoId) ?? [];
    lista.push(log);
    porSessao.set(log.sessaoId, lista);
  }

  return sessoes.map((s) => ({
    sessaoId: s.id,
    numero: s.numero,
    terminal: s.terminal,
    operadorNome: s.operadorNome,
    status: s.status,
    statusAprovacao: s.statusAprovacao ?? null,
    abertoEm: s.abertoEm ? new Date(s.abertoEm).toISOString() : "",
    fechadoEm: s.fechadoEm ? new Date(s.fechadoEm).toISOString() : "",
    valoresEsperados: (s.valoresEsperados ?? {}) as Record<string, number>,
    valoresInformados: (s.valoresInformados ?? {}) as Record<string, number>,
    diferencas: (s.diferencas ?? {}) as Record<string, number>,
    totalEsperado: N(s.totalEsperado),
    totalInformado: N(s.totalInformado),
    diferencaTotal: N(s.diferencaTotal),
    justificativaFechamento: s.justificativaFechamento ?? "",
    quebras: (porSessao.get(s.id) ?? []).map((q) => ({
      id: q.id,
      valorDiferenca: N(q.valorDiferenca),
      tipo: q.tipo,
      justificativa: q.justificativa,
      homologadoPorUsuarioId: q.homologadoPorUsuarioId ?? null,
      homologadoEm: q.homologadoEm ? new Date(q.homologadoEm).toISOString() : null,
    })),
  }));
}
