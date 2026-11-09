"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caixaMovimentos, caixaQuebraLogs, caixaSessoes, usuarios } from "@/db/schema";
import { calcularConferenciaCaixa, FUNDO_TROCO_PADRAO } from "@/lib/caixa";
import { FORMAS_PAGAMENTO, moeda, round2 } from "@/lib/dominio";
import { temPermissao } from "@/lib/permissoes";
import { confereSenha } from "@/lib/session";
import { registrarAuditoria } from "@/server/auditoria";
import { apurarSessaoNoBanco, fecharSessaoCaixaTransacional } from "@/server/caixaCore";
import { comoErro, corpo, exigirPermissao, logico, numero, texto } from "@/server/tenant";

export type ResultadoCaixa =
  | { ok: true; id?: string; numero?: number; aviso?: string; diverge?: boolean; pendenteHomologacao?: boolean }
  | { ok: false; erro: string; requerHomologacao?: boolean };

function revalidarCaixa() {
  ["/caixa", "/pdv", "/", "/relatorios", "/usuarios", "/dashboard/auditoria-caixa", "/dashboard/relatorios/pdv"].forEach((p) => revalidatePath(p));
}

export async function abrirCaixa(bruto: {
  saldoInicial?: number | string;
  terminal?: string;
  observacao?: string;
  operadorNome?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.abrir");
    const input = corpo<{ saldoInicial?: number | string; terminal?: string; observacao?: string; operadorNome?: string }>(bruto);
    // Operador identificado na abertura: deve existir e estar ativo na empresa;
    // caso contrário, usa o nome do usuário logado. (operadorId segue = usuário logado,
    // preservando o vínculo das vendas à sessão.)
    const nomeOperadorSelecionado = texto(input.operadorNome).trim();
    let operadorNome = usuario.nome;
    if (nomeOperadorSelecionado) {
      const [usuarioOperador] = await db
        .select({ nome: usuarios.nome })
        .from(usuarios)
        .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.nome, nomeOperadorSelecionado), eq(usuarios.ativo, true)))
        .limit(1);
      if (usuarioOperador) operadorNome = usuarioOperador.nome;
    }
    const brutoSaldo = input.saldoInicial;
    const informouSaldo = brutoSaldo !== undefined && brutoSaldo !== null && String(brutoSaldo).trim() !== "";
    let saldoInicial = informouSaldo ? round2(numero(brutoSaldo)) : 0;
    // Fundo de troco automático: se o operador não digitar, herda o provisionamento
    // do último turno encerrado (ou R$ 100,00 na primeira abertura).
    if (!informouSaldo) {
      const [ultima] = await db
        .select({ fundoTroco: caixaSessoes.fundoTroco })
        .from(caixaSessoes)
        .where(and(eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.status, "fechado")))
        .orderBy(desc(caixaSessoes.fechadoEm))
        .limit(1);
      saldoInicial = round2(Number(ultima?.fundoTroco) || FUNDO_TROCO_PADRAO);
    }
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
          operadorNome,
          status: "aberto",
          saldoInicial,
          fundoTroco: FUNDO_TROCO_PADRAO,
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
      alteracoes: { numero: criada.numero, terminal, saldoInicial, fundoTroco: FUNDO_TROCO_PADRAO, observacao },
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
    const input = corpo<{ sessaoId?: unknown; tipo?: unknown; forma?: unknown; valor?: unknown; motivo?: unknown }>(bruto);
    const tipo = texto(input.tipo).toLowerCase();
    if (tipo !== "suprimento" && tipo !== "sangria") return { ok: false, erro: "Tipo de movimentação inválido. Escolha suprimento ou sangria." };
    const forma = texto(input.forma) || "dinheiro";
    if (!FORMAS_PAGAMENTO.some((f) => f.id === forma)) return { ok: false, erro: "Forma de pagamento inválida para movimentação de caixa." };
    const valor = round2(numero(input.valor));
    if (!Number.isFinite(valor) || !(valor > 0) || valor > 9_999_999_999.99) return { ok: false, erro: "Informe um valor válido maior que zero." };
    const motivo = texto(input.motivo);
    if (motivo.length < 3) return { ok: false, erro: "Informe o motivo da movimentação (mín. 3 caracteres)." };
    const sessaoId = texto(input.sessaoId);
    if (sessaoId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessaoId)) return { ok: false, erro: "Informe uma sessão de caixa válida." };

    const resultado = await db.transaction(async (tx) => {
      const condicao = sessaoId
        ? and(eq(caixaSessoes.id, sessaoId), eq(caixaSessoes.empresaId, empresaId))
        : and(eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.operadorId, usuario.id), eq(caixaSessoes.status, "aberto"));
      const [sessao] = await tx.select().from(caixaSessoes).where(condicao).limit(1).for("update");
      if (!sessao) return { ok: false as const, erro: "Caixa fechado: nenhuma sessão aberta encontrada para registrar a movimentação." };
      if (sessao.status !== "aberto") return { ok: false as const, erro: "Caixa fechado: não é permitido registrar suprimento ou sangria em sessão encerrada." };
      if (sessao.operadorId !== usuario.id && !temPermissao(usuario.papel, "caixa.relatorio_todos")) return { ok: false as const, erro: "Você só pode movimentar a sua própria sessão de caixa." };
      if (tipo === "sangria") {
        const apuracao = await apurarSessaoNoBanco(empresaId, sessao, tx);
        const disponivel = round2(apuracao.esperadosMap[forma] ?? 0);
        if (valor > disponivel + 0.01) return { ok: false as const, erro: `Saldo insuficiente em ${forma} para sangria.` };
      }
      const [mov] = await tx.insert(caixaMovimentos).values({ empresaId, sessaoId: sessao.id, tipo, forma, valor, motivo, usuarioId: usuario.id, usuarioNome: usuario.nome }).returning({ id: caixaMovimentos.id });
      await registrarAuditoria({
        empresaId, usuario, acao: `caixa.${tipo}`, entidade: "caixa_sessao", registroId: sessao.id,
        resumo: `${tipo === "suprimento" ? "Suprimento" : "Sangria"} de ${moeda(valor)} (${forma}) no Caixa #${sessao.numero}: ${motivo}`,
        alteracoes: { movimentoId: mov.id, tipo, forma, valor, motivo, sessaoNumero: sessao.numero },
      }, tx);
      return { ok: true as const, id: mov.id, numero: sessao.numero };
    });
    if (!resultado.ok) return resultado;
    revalidarCaixa();
    return { ok: true, id: resultado.id, aviso: `${tipo === "suprimento" ? "Suprimento" : "Sangria"} de ${moeda(valor)} registrado no Caixa #${resultado.numero}.` };
  } catch (e) {
    return comoErro(e);
  }
}

async function executarFechamentoCego(bruto: unknown, origem: "pdv" | "caixa"): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.fechar");
    const input = corpo<{
      sessaoId?: unknown; valoresInformados?: unknown; confirmado?: unknown;
      justificativa?: unknown; gerenteEmail?: unknown; gerenteSenha?: unknown;
    }>(bruto);
    const sessaoId = texto(input.sessaoId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessaoId)) {
      return { ok: false, erro: "Informe uma sessão de caixa válida." };
    }
    if (origem === "caixa" && !logico(input.confirmado)) {
      return { ok: false, erro: "Confirme a conferência dos valores antes de concluir o fechamento do caixa." };
    }
    const resultado = await fecharSessaoCaixaTransacional({
      empresaId, sessaoId, usuario,
      valoresInformados: corpo<Record<string, unknown>>(input.valoresInformados),
      justificativa: texto(input.justificativa),
      cego: {
        origem,
        gerenteEmail: texto(input.gerenteEmail),
        gerenteSenha: typeof input.gerenteSenha === "string" ? input.gerenteSenha : "",
      },
    });
    if (!resultado.ok) return resultado;
    revalidarCaixa();
    const diverge = resultado.conferencia.temDivergencia || resultado.apuracao.inconsistencias.length > 0;
    return {
      ok: true, id: resultado.sessaoId, numero: resultado.numero, diverge, pendenteHomologacao: Boolean(resultado.pendenteHomologacao),
      aviso: diverge
        ? (resultado.pendenteHomologacao
          ? `DIVERGE · Turno #${resultado.numero} encerrado com divergência de ${moeda(Math.abs(resultado.conferencia.diferencaTotal))}, registrado como crítico na auditoria e PENDENTE de homologação do gerente. Fundo de troco de ${moeda(FUNDO_TROCO_PADRAO)} provisionado.`
          : `DIVERGE · Turno #${resultado.numero} encerrado com divergência homologada pelo gerente e registrada na auditoria. Fundo de troco de ${moeda(FUNDO_TROCO_PADRAO)} provisionado.`)
        : `Turno #${resultado.numero} encerrado sem divergências. Fundo de troco de ${moeda(FUNDO_TROCO_PADRAO)} provisionado para o próximo turno.`,
    };
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "";
    if (mensagem.startsWith("Sessão expirada") || mensagem.startsWith("Acesso negado")) return { ok: false, erro: mensagem };
    console.error("[caixa] Não foi possível concluir o fechamento:", e instanceof Error ? e.name : "erro inesperado");
    return { ok: false, erro: "Não foi possível concluir o fechamento. Confira o estado do turno antes de tentar novamente." };
  }
}

export async function fecharCaixa(bruto: {
  sessaoId?: string;
  valoresInformados?: Record<string, number | string>;
  confirmado?: boolean;
  justificativa?: string;
  gerenteEmail?: string;
  gerenteSenha?: string;
}): Promise<ResultadoCaixa> {
  return executarFechamentoCego(bruto, "caixa");
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

    // Diferença entre o que foi informado agora e o que estava informado antes
    const informadosAntigos: Record<string, number> = {};
    for (const fp of FORMAS_PAGAMENTO) {
      informadosAntigos[fp.id] = round2(Number(sessao.valoresInformados?.[fp.id] ?? 0));
    }
    const conferenciaAntiga = calcularConferenciaCaixa(sessao.valoresEsperados ?? {}, informadosAntigos);
    const conferencia = calcularConferenciaCaixa(sessao.valoresEsperados ?? {}, informadosNum);
    const deltaAjuste = round2(conferencia.totalInformado - conferenciaAntiga.totalInformado);

    await db
      .update(caixaSessoes)
      .set({
        // valoresEsperados NUNCA muda: snapshot original do fechamento
        valoresInformados: conferencia.informados,
        diferencas: conferencia.diferencas,
        totalEsperado: sessao.totalEsperado,
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

/**
 * FECHAMENTO ÀS CEGAS (blind balance) — usado pelo modal do PDV.
 * O cliente envia SOMENTE o que contou fisicamente; inputs do modal iniciam vazios.
 * Os esperados são recalculados no servidor e NUNCA voltam na resposta.
 * Com diferença: justificativa obrigatória + homologação por gerente (`caixa.homologar`),
 * log em `nk_caixa_quebra_log`, recolhimento líquido ao cofre e provisionamento do fundo.
 */
export async function fecharTurnoCego(bruto: {
  sessaoId?: string;
  valoresInformados?: Record<string, number | string>;
  justificativa?: string;
  gerenteEmail?: string;
  gerenteSenha?: string;
}): Promise<ResultadoCaixa> {
  return executarFechamentoCego(bruto, "pdv");
}

/** Homologação remota de quebra pendente (rota /dashboard/auditoria-caixa). */
export async function homologarQuebraCaixa(bruto: {
  quebraId?: string;
  senha?: string;
}): Promise<ResultadoCaixa> {
  try {
    const { empresaId, usuario } = await exigirPermissao("caixa.homologar");
    const input = corpo<{ quebraId?: string; senha?: string }>(bruto);
    const quebraId = texto(input.quebraId);
    if (!quebraId) return { ok: false, erro: "Informe o registro de quebra." };

    const senha = String(input.senha ?? "");
    if (!confereSenha(senha, usuario.senhaHash)) {
      return { ok: false, erro: "PIN/senha do gerente inválido." };
    }

    const [log] = await db
      .select()
      .from(caixaQuebraLogs)
      .where(and(eq(caixaQuebraLogs.id, quebraId), eq(caixaQuebraLogs.empresaId, empresaId)))
      .limit(1);
    if (!log) return { ok: false, erro: "Registro de quebra não encontrado." };
    if (log.homologadoPorUsuarioId) return { ok: false, erro: "Esta quebra já foi homologada." };

    await db
      .update(caixaQuebraLogs)
      .set({ homologadoPorUsuarioId: usuario.id, homologadoEm: new Date() })
      .where(and(eq(caixaQuebraLogs.id, quebraId), eq(caixaQuebraLogs.empresaId, empresaId)));
    await db
      .update(caixaSessoes)
      .set({ statusAprovacao: "homologado", homologadoPorUsuarioId: usuario.id })
      .where(and(eq(caixaSessoes.id, log.sessaoId), eq(caixaSessoes.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "caixa.homologar_quebra",
      entidade: "caixa_quebra_log",
      registroId: quebraId,
      resumo: `Quebra ${log.tipo} de ${moeda(Number(log.valorDiferenca))} homologada pelo gerente ${usuario.nome}`,
      alteracoes: { sessaoId: log.sessaoId, tipo: log.tipo, valorDiferenca: Number(log.valorDiferenca) },
    });

    revalidarCaixa();
    return { ok: true, id: quebraId, aviso: "Quebra homologada com sucesso." };
  } catch (e) {
    return comoErro(e);
  }
}
