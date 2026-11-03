"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caixaMovimentos, caixaSessoes } from "@/db/schema";
import { calcularConferenciaCaixa } from "@/lib/caixa";
import { FORMAS_PAGAMENTO, moeda, round2 } from "@/lib/dominio";
import { temPermissao } from "@/lib/permissoes";
import { registrarAuditoria } from "@/server/auditoria";
import { apurarSessaoNoBanco, fecharSessaoCaixaTransacional } from "@/server/caixaCore";
import { comoErro, corpo, exigirPermissao, logico, numero, texto } from "@/server/tenant";

export type ResultadoCaixa =
  | { ok: true; id?: string; numero?: number; aviso?: string }
  | { ok: false; erro: string };

function revalidarCaixa() {
  ["/caixa", "/pdv", "/", "/relatorios", "/usuarios"].forEach((p) => revalidatePath(p));
}

export async function abrirCaixa(bruto: {
  saldoInicial?: number | string;
  terminal?: string;
  observacao?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.abrir");
    const input = corpo<{ saldoInicial?: number | string; terminal?: string; observacao?: string }>(bruto);
    const saldoInicial = round2(numero(input.saldoInicial));
    const terminal = (texto(input.terminal) || "CAIXA 1").toUpperCase().slice(0, 40);
    const observacao = texto(input.observacao).slice(0, 240);

    if (saldoInicial < 0) return { ok: false, erro: "O saldo inicial de abertura não pode ser negativo." };

    const [jaAberto] = await db
      .select({ id: caixaSessoes.id, numero: caixaSessoes.numero, terminal: caixaSessoes.terminal })
      .from(caixaSessoes)
      .where(
        and(
          eq(caixaSessoes.empresaId, empresaId),
          eq(caixaSessoes.operadorId, usuario.id),
          eq(caixaSessoes.status, "aberto"),
        ),
      )
      .limit(1);

    if (jaAberto) {
      return {
        ok: false,
        erro: `Você já possui o caixa #${jaAberto.numero} (${jaAberto.terminal}) aberto. Feche-o antes de abrir uma nova sessão.`,
      };
    }

    const [ult] = await db
      .select({ n: sql<string | null>`max(${caixaSessoes.numero})` })
      .from(caixaSessoes)
      .where(eq(caixaSessoes.empresaId, empresaId));
    const proximoNumero = Number(ult?.n ?? 0) + 1;

    let criada: { id: string; numero: number } | undefined;
    try {
      const [nova] = await db
        .insert(caixaSessoes)
        .values({
          empresaId,
          numero: proximoNumero,
          terminal,
          operadorId: usuario.id,
          operadorNome: usuario.nome,
          status: "aberto",
          saldoInicial,
          observacaoAbertura: observacao,
          abertoEm: new Date(),
        })
        .returning({ id: caixaSessoes.id, numero: caixaSessoes.numero });
      criada = nova;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("nk_caixa_sessao_operador_aberto_uidx")) {
        return { ok: false, erro: "Já existe uma sessão de caixa aberta para este operador." };
      }
      throw err;
    }

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "caixa.abrir",
      entidade: "caixa_sessao",
      registroId: criada.id,
      resumo: `Caixa #${criada.numero} (${terminal}) aberto por ${usuario.nome} com saldo inicial de ${moeda(saldoInicial)}`,
      alteracoes: { numero: criada.numero, terminal, saldoInicial, observacao },
    });

    revalidarCaixa();
    return {
      ok: true,
      id: criada.id,
      numero: criada.numero,
      aviso: `Caixa #${criada.numero} (${terminal}) aberto com fundo de troco de ${moeda(saldoInicial)}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function registrarMovimentoCaixa(bruto: {
  sessaoId?: string;
  tipo?: string;
  forma?: string;
  valor?: number | string;
  motivo?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.movimentar");
    const input = corpo<{
      sessaoId?: string;
      tipo?: string;
      forma?: string;
      valor?: number | string;
      motivo?: string;
    }>(bruto);

    const tipo = texto(input.tipo).toLowerCase();
    if (tipo !== "suprimento" && tipo !== "sangria") {
      return { ok: false, erro: "Tipo de movimentação inválido. Escolha suprimento ou sangria." };
    }

    const forma = texto(input.forma) || "dinheiro";
    if (!FORMAS_PAGAMENTO.some((f) => f.id === forma)) {
      return { ok: false, erro: "Forma de pagamento inválida para movimentação de caixa." };
    }

    const valor = round2(numero(input.valor));
    if (!(valor > 0)) return { ok: false, erro: "Informe um valor maior que zero." };

    const motivo = texto(input.motivo);
    if (motivo.length < 3) return { ok: false, erro: "Informe o motivo da movimentação (mín. 3 caracteres)." };

    const sessaoId = texto(input.sessaoId);
    const [sessao] = sessaoId
      ? await db
          .select()
          .from(caixaSessoes)
          .where(and(eq(caixaSessoes.id, sessaoId), eq(caixaSessoes.empresaId, empresaId)))
          .limit(1)
      : await db
          .select()
          .from(caixaSessoes)
          .where(
            and(
              eq(caixaSessoes.empresaId, empresaId),
              eq(caixaSessoes.operadorId, usuario.id),
              eq(caixaSessoes.status, "aberto"),
            ),
          )
          .limit(1);

    if (!sessao) {
      return { ok: false, erro: "Caixa fechado: nenhuma sessão aberta encontrada para registrar a movimentação." };
    }
    if (sessao.status !== "aberto") {
      return { ok: false, erro: "Caixa fechado: não é permitido registrar suprimento ou sangria em sessão encerrada." };
    }
    if (sessao.operadorId !== usuario.id && !temPermissao(usuario.papel, "caixa.relatorio_todos")) {
      return { ok: false, erro: "Você só pode movimentar a sua própria sessão de caixa." };
    }

    if (tipo === "sangria") {
      // mesma regra do fechamento: saldo disponível vem do motor corrigido (todas as vendas concretas)
      const apuracao = await apurarSessaoNoBanco(empresaId, sessao);
      const disponivel = round2(apuracao.esperadosMap[forma] ?? 0);
      if (valor > disponivel + 0.01) {
        return {
          ok: false,
          erro: `Saldo insuficiente em ${forma} para sangria (disponível no caixa: ${moeda(disponivel)}).`,
        };
      }
    }

    // Reconfirma estado aberto no momento da inserção
    const [aindaAberto] = await db
      .select({ id: caixaSessoes.id })
      .from(caixaSessoes)
      .where(and(eq(caixaSessoes.id, sessao.id), eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.status, "aberto")))
      .limit(1);
    if (!aindaAberto) {
      return { ok: false, erro: "A sessão de caixa foi encerrada simultaneamente. Movimentação cancelada." };
    }

    const [mov] = await db
      .insert(caixaMovimentos)
      .values({
        empresaId,
        sessaoId: sessao.id,
        tipo,
        forma,
        valor,
        motivo,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
      })
      .returning({ id: caixaMovimentos.id });

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: `caixa.${tipo}`,
      entidade: "caixa_sessao",
      registroId: sessao.id,
      resumo: `${tipo === "suprimento" ? "Suprimento" : "Sangria"} de ${moeda(valor)} (${forma}) no Caixa #${sessao.numero}: ${motivo}`,
      alteracoes: { movimentoId: mov.id, tipo, forma, valor, motivo, sessaoNumero: sessao.numero },
    });

    revalidarCaixa();
    return {
      ok: true,
      id: mov.id,
      aviso: `${tipo === "suprimento" ? "Suprimento" : "Sangria"} de ${moeda(valor)} registrado no Caixa #${sessao.numero}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function fecharCaixa(bruto: {
  sessaoId?: string;
  valoresInformados?: Record<string, number | string>;
  confirmado?: boolean;
  justificativa?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.fechar");
    const input = corpo<{
      sessaoId?: string;
      valoresInformados?: Record<string, number | string>;
      confirmado?: boolean;
      justificativa?: string;
    }>(bruto);

    const sessaoId = texto(input.sessaoId);
    if (!sessaoId) return { ok: false, erro: "Informe a sessão de caixa a ser fechada." };
    if (!logico(input.confirmado)) {
      return { ok: false, erro: "Confirme a conferência dos valores antes de concluir o fechamento do caixa." };
    }

    // Recalcula no servidor, dentro de transação com trava de linha (fecharSessaoCaixaTransacional)
    const r = await fecharSessaoCaixaTransacional({
      empresaId,
      sessaoId,
      usuario,
      valoresInformados: corpo<Record<string, unknown>>(input.valoresInformados),
      justificativa: texto(input.justificativa),
    });
    if (!r.ok) return r;
    const { apuracao, conferencia, justificativa } = r;

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "caixa.fechar",
      entidade: "caixa_sessao",
      registroId: r.sessaoId,
      resumo: `Caixa #${r.numero} (${r.operadorNome}) fechado · esperado ${moeda(conferencia.totalEsperado)} · informado ${moeda(conferencia.totalInformado)} · dif. ${moeda(conferencia.diferencaTotal)}`,
      alteracoes: {
        numero: r.numero,
        operador: r.operadorNome,
        esperados: apuracao.esperadosMap,
        informados: conferencia.informados,
        diferencas: conferencia.diferencas,
        diferencaTotal: conferencia.diferencaTotal,
        vendasConsideradas: apuracao.consideradas,
        vendasExcluidas: apuracao.excluidas.length,
        troco: apuracao.totalTroco,
        naoFisico: apuracao.totalNaoFisico,
        inconsistencias: apuracao.inconsistencias,
        avisos: apuracao.avisos,
        justificativa: justificativa || null,
      },
    });

    revalidarCaixa();
    return {
      ok: true,
      id: r.sessaoId,
      numero: r.numero,
      aviso: conferencia.temDivergencia
        ? `Caixa #${r.numero} fechado com divergência de ${moeda(conferencia.diferencaTotal)} devidamente justificada e auditada.`
        : `Caixa #${r.numero} fechado sem divergências (${moeda(conferencia.totalInformado)}).`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function reabrirCaixa(bruto: {
  sessaoId?: string;
  justificativa?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.reabrir");
    const input = corpo<{ sessaoId?: string; justificativa?: string }>(bruto);
    const sessaoId = texto(input.sessaoId);
    const justificativa = texto(input.justificativa);

    if (!sessaoId) return { ok: false, erro: "Informe a sessão de caixa para reabertura." };
    if (justificativa.length < 10) {
      return { ok: false, erro: "Informe a justificativa de reabertura (mín. 10 caracteres)." };
    }

    const [sessao] = await db
      .select()
      .from(caixaSessoes)
      .where(and(eq(caixaSessoes.id, sessaoId), eq(caixaSessoes.empresaId, empresaId)))
      .limit(1);

    if (!sessao) return { ok: false, erro: "Sessão de caixa não encontrada." };
    if (sessao.status !== "fechado") return { ok: false, erro: "Esta sessão de caixa já está aberta." };

    const [outraAberta] = await db
      .select({ numero: caixaSessoes.numero })
      .from(caixaSessoes)
      .where(
        and(
          eq(caixaSessoes.empresaId, empresaId),
          eq(caixaSessoes.operadorId, sessao.operadorId),
          eq(caixaSessoes.status, "aberto"),
        ),
      )
      .limit(1);

    if (outraAberta) {
      return {
        ok: false,
        erro: `O operador ${sessao.operadorNome} já possui o Caixa #${outraAberta.numero} aberto. Feche-o antes de reabrir esta sessão.`,
      };
    }

    const [reaberto] = await db
      .update(caixaSessoes)
      .set({
        status: "aberto",
        reabertoEm: new Date(),
        reabertoPorNome: usuario.nome,
        justificativaReabertura: justificativa,
      })
      .where(
        and(
          eq(caixaSessoes.id, sessao.id),
          eq(caixaSessoes.empresaId, empresaId),
          eq(caixaSessoes.status, "fechado"),
        ),
      )
      .returning({ id: caixaSessoes.id });

    if (!reaberto) {
      return { ok: false, erro: "Não foi possível reabrir: o estado da sessão mudou simultaneamente." };
    }

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "caixa.reabrir",
      entidade: "caixa_sessao",
      registroId: sessao.id,
      resumo: `Caixa #${sessao.numero} (${sessao.operadorNome}) reaberto por ${usuario.nome}: ${justificativa}`,
      alteracoes: {
        antes: { status: "fechado", totalInformado: Number(sessao.totalInformado), diferencaTotal: Number(sessao.diferencaTotal) },
        depois: { status: "aberto", justificativaReabertura: justificativa },
      },
    });

    revalidarCaixa();
    return {
      ok: true,
      id: sessao.id,
      numero: sessao.numero,
      aviso: `Caixa #${sessao.numero} reaberto e registrado na auditoria.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function ajustarCaixaFechado(bruto: {
  sessaoId?: string;
  valoresInformados?: Record<string, number | string>;
  justificativa?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.ajustar");
    const input = corpo<{
      sessaoId?: string;
      valoresInformados?: Record<string, number | string>;
      justificativa?: string;
    }>(bruto);

    const sessaoId = texto(input.sessaoId);
    const justificativa = texto(input.justificativa);
    if (!sessaoId) return { ok: false, erro: "Informe a sessão de caixa para ajuste." };
    if (justificativa.length < 10) {
      return { ok: false, erro: "Informe a justificativa do ajuste de conferência (mín. 10 caracteres)." };
    }

    const [sessao] = await db
      .select()
      .from(caixaSessoes)
      .where(and(eq(caixaSessoes.id, sessaoId), eq(caixaSessoes.empresaId, empresaId)))
      .limit(1);

    if (!sessao) return { ok: false, erro: "Sessão de caixa não encontrada." };
    if (sessao.status !== "fechado") {
      return { ok: false, erro: "O ajuste de conferência aplica-se apenas a caixas já fechados." };
    }

    // Ajuste explícito e auditado: recalcula pelo motor corrigido e registra esperados antes/depois
    const apuracao = await apurarSessaoNoBanco(empresaId, sessao);

    const informadosNum: Record<string, number> = {};
    const mapaBruto = corpo<Record<string, unknown>>(input.valoresInformados);
    for (const fp of FORMAS_PAGAMENTO) {
      const v = numero(mapaBruto[fp.id]);
      if (v < 0) return { ok: false, erro: `O valor ajustado em ${fp.label} não pode ser negativo.` };
      informadosNum[fp.id] = round2(v);
    }

    const conferencia = calcularConferenciaCaixa(apuracao.esperadosMap, informadosNum);
    const deltaAjuste = round2(conferencia.totalInformado - Number(sessao.totalInformado));

    await db
      .update(caixaSessoes)
      .set({
        valoresEsperados: apuracao.esperadosMap,
        valoresInformados: conferencia.informados,
        diferencas: conferencia.diferencas,
        totalEsperado: conferencia.totalEsperado,
        totalInformado: conferencia.totalInformado,
        diferencaTotal: conferencia.diferencaTotal,
        justificativaFechamento: `${sessao.justificativaFechamento ? `${sessao.justificativaFechamento} | ` : ""}Ajuste (${usuario.nome}): ${justificativa}`,
      })
      .where(and(eq(caixaSessoes.id, sessao.id), eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.status, "fechado")));

    await db.insert(caixaMovimentos).values({
      empresaId,
      sessaoId: sessao.id,
      tipo: "ajuste",
      forma: "dinheiro",
      valor: Math.abs(deltaAjuste),
      motivo: `Ajuste pós-fechamento: ${justificativa}`,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
    });

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "caixa.ajustar",
      entidade: "caixa_sessao",
      registroId: sessao.id,
      resumo: `Conferência do Caixa #${sessao.numero} ajustada por ${usuario.nome} · nova dif. ${moeda(conferencia.diferencaTotal)}`,
      alteracoes: {
        antes: {
          esperados: sessao.valoresEsperados,
          informados: sessao.valoresInformados,
          diferencas: sessao.diferencas,
          totalEsperado: Number(sessao.totalEsperado),
          totalInformado: Number(sessao.totalInformado),
          diferencaTotal: Number(sessao.diferencaTotal),
        },
        depois: {
          informados: conferencia.informados,
          diferencas: conferencia.diferencas,
          totalInformado: conferencia.totalInformado,
          diferencaTotal: conferencia.diferencaTotal,
          justificativa,
        },
      },
    });

    revalidarCaixa();
    return {
      ok: true,
      id: sessao.id,
      numero: sessao.numero,
      aviso: `Conferência do Caixa #${sessao.numero} ajustada e auditada com sucesso.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}
