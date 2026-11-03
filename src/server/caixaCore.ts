/**
 * NKWAY — Núcleo server-side do Caixa por Operador (correção 2026-11).
 * Fonte única para: carregar insumos da sessão (SEM filtro por tipo fiscal), apurar pela regra
 * `apurarSessaoCaixa` e fechar a sessão dentro de transação com trava de linha.
 * Reutilizado por `src/server/acoes/caixa.ts`, `src/server/dados.ts` e pela bateria de testes.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { caixaMovimentos, caixaSessoes, vendas } from "@/db/schema";
import {
  apurarSessaoCaixa,
  calcularConferenciaCaixa,
  type ApuracaoSessaoCaixa,
  type MovimentoCaixaInput,
  type VendaCaixaInput,
} from "@/lib/caixa";
import { FORMAS_PAGAMENTO, moeda, round2 } from "@/lib/dominio";
import { temPermissao } from "@/lib/permissoes";

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
  for (const fp of FORMAS_PAGAMENTO) {
    const bruto = mapaBruto?.[fp.id];
    const v = typeof bruto === "number" ? bruto : Number(String(bruto ?? "0").replace(/\./g, "").replace(",", ".")) || 0;
    if (v < 0) return { ok: false, erro: `O valor informado em ${fp.label} não pode ser negativo.` };
    valores[fp.id] = round2(v);
  }
  return { ok: true, valores };
}

export type ResultadoFechamentoCaixa =
  | {
      ok: true;
      sessaoId: string;
      numero: number;
      operadorNome: string;
      apuracao: ApuracaoSessaoCaixa;
      conferencia: ReturnType<typeof calcularConferenciaCaixa>;
      justificativa: string;
    }
  | { ok: false; erro: string };

/**
 * Fecha a sessão dentro de UMA transação:
 *  1. `SELECT … FOR UPDATE` da sessão (segundo fechamento simultâneo espera a trava e recebe erro claro);
 *  2. recalcula os esperados no servidor pelo motor corrigido (nunca confia em valores do cliente);
 *  3. exige justificativa (≥ 10) para divergência e para inconsistência de recebimento;
 *  4. `UPDATE … WHERE status = 'aberto'` grava o snapshot (esperados/informados/diferenças).
 * Não registra auditoria: o chamador audita após o commit.
 */
export async function fecharSessaoCaixaTransacional(params: {
  empresaId: string;
  sessaoId: string;
  usuario: { id: string; nome: string; papel: string };
  valoresInformados: Record<string, unknown>;
  justificativa: string;
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

    if (apuracao.inconsistencias.length > 0 && justificativa.length < 10) {
      const lista = apuracao.inconsistencias.map((i) => `${i.vendaId.slice(0, 8)}: ${i.motivo}`).join(" · ");
      return {
        ok: false as const,
        erro: `Recebimento inconsistente em ${apuracao.inconsistencias.length} venda(s) desta sessão (${lista}). Corrija a venda ou informe uma justificativa com no mínimo 10 caracteres.`,
      };
    }
    if (conferencia.temDivergencia && justificativa.length < 10) {
      return {
        ok: false as const,
        erro: `Há divergência de ${moeda(conferencia.diferencaTotal)} na conferência. Informe uma justificativa com no mínimo 10 caracteres.`,
      };
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
      })
      .where(
        and(eq(caixaSessoes.id, sessao.id), eq(caixaSessoes.empresaId, params.empresaId), eq(caixaSessoes.status, "aberto")),
      )
      .returning({ id: caixaSessoes.id });

    if (!fechado) {
      return { ok: false as const, erro: `O Caixa #${sessao.numero} já foi fechado em outro acesso simultâneo.` };
    }

    return {
      ok: true as const,
      sessaoId: sessao.id,
      numero: sessao.numero,
      operadorNome: sessao.operadorNome,
      apuracao,
      conferencia,
      justificativa,
    };
  });
}
