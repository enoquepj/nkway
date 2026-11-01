"use server";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { assinaturaFaturas, assinaturas, empresas, produtos, usuarios } from "@/db/schema";
import {
  calcularPrecoAssinatura,
  calcularProximoVencimento,
  detectarBandeiraCartao,
  planoPagoValido,
  validarCartaoLuhn,
  validarCnpjAssinatura,
  type CicloAssinatura,
  type FormaAssinatura,
} from "@/lib/assinatura";
import { hojeISO, mascaraDocumento, moeda, planoById, soDigitos, somaDias } from "@/lib/dominio";
import {
  cancelarAssinaturaNoGateway,
  criarFaturaCicloRenovacao,
  processarEventoWebhookAssinatura,
  provisionarAssinaturaNoGateway,
} from "@/server/assinaturaGateway";
import { registrarAuditoria } from "@/server/auditoria";
import { comoErro, corpo, exigirPermissao, logico, texto } from "@/server/tenant";

export type ResultadoAssinatura =
  | {
      ok: true;
      assinaturaId?: string;
      faturaId?: string;
      checkoutUrl?: string;
      statusFatura?: string;
      aviso?: string;
    }
  | { ok: false; erro: string };

function revalidarAssinatura() {
  ["/assinatura", "/config", "/", "/produtos", "/usuarios"].forEach((p) => revalidatePath(p));
  revalidatePath("/", "layout");
}

function validarValidadeCartao(mmAa: string): boolean {
  const m = String(mmAa || "").trim().match(/^(\d{2})\s*\/\s*(\d{2,4})$/);
  if (!m) return false;
  const mes = Number(m[1]);
  const anoRaw = Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  const ano = anoRaw < 100 ? 2000 + anoRaw : anoRaw;
  const agora = new Date();
  const anoAtual = agora.getFullYear();
  const mesAtual = agora.getMonth() + 1;
  return ano > anoAtual || (ano === anoAtual && mes >= mesAtual);
}

export async function contratarAssinaturaCnpj(bruto: {
  planoId?: string;
  ciclo?: string;
  formaPagamento?: string;
  cnpj?: string;
  razaoSocial?: string;
  emailCobranca?: string;
  cartaoNumero?: string;
  cartaoTitular?: string;
  cartaoValidade?: string;
  cartaoCvv?: string;
}): Promise<ResultadoAssinatura> {
  try {
    const { empresaId, empresa, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{
      planoId?: string;
      ciclo?: string;
      formaPagamento?: string;
      cnpj?: string;
      razaoSocial?: string;
      emailCobranca?: string;
      cartaoNumero?: string;
      cartaoTitular?: string;
      cartaoValidade?: string;
      cartaoCvv?: string;
    }>(bruto);

    const planoId = texto(input.planoId);
    if (planoId === "start") {
      return await cancelarAssinaturaCnpj({
        motivo: "Retorno solicitado ao plano gratuito MEI Start",
        imediato: true,
      });
    }
    if (!planoPagoValido(planoId)) {
      return { ok: false, erro: "Selecione um plano comercial válido (ME / Simples ou Loja+)." };
    }

    const ciclo: CicloAssinatura = texto(input.ciclo) === "anual" ? "anual" : "mensal";
    const formaBruta = texto(input.formaPagamento);
    const forma: FormaAssinatura =
      formaBruta === "boleto" || formaBruta === "cartao" ? formaBruta : "pix";

    const validacaoCnpj = validarCnpjAssinatura(texto(input.cnpj) || empresa.cnpj);
    if (!validacaoCnpj.ok) return validacaoCnpj;
    const cnpj14 = validacaoCnpj.cnpj14;

    const razaoSocial = (texto(input.razaoSocial) || empresa.nome).slice(0, 140);
    if (razaoSocial.length < 3) {
      return { ok: false, erro: "Informe a razão social vinculada ao CNPJ da assinatura." };
    }

    const emailCobranca = (texto(input.emailCobranca) || empresa.email || usuario.email).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(emailCobranca)) {
      return { ok: false, erro: "Informe um e-mail financeiro válido para envio das faturas e NFS-e." };
    }

    let cartaoBandeira = "";
    let cartaoUltimos4 = "";
    if (forma === "cartao") {
      const numLimpo = soDigitos(input.cartaoNumero);
      const titular = texto(input.cartaoTitular);
      const validade = texto(input.cartaoValidade);
      const cvv = soDigitos(input.cartaoCvv);

      if (!validarCartaoLuhn(numLimpo)) {
        return { ok: false, erro: "Número do cartão inválido (verificação Luhn não confere)." };
      }
      if (titular.length < 3) {
        return { ok: false, erro: "Informe o nome impresso no cartão." };
      }
      if (!validarValidadeCartao(validade)) {
        return { ok: false, erro: "Validade do cartão inválida ou expirada (use MM/AA)." };
      }
      if (cvv.length < 3 || cvv.length > 4) {
        return { ok: false, erro: "Código de segurança (CVV) inválido." };
      }

      cartaoBandeira = detectarBandeiraCartao(numLimpo);
      cartaoUltimos4 = numLimpo.slice(-4);
    }

    const preco = calcularPrecoAssinatura(planoId, ciclo);
    const hoje = hojeISO();
    const vencimentoFatura = forma === "cartao" ? hoje : somaDias(hoje, forma === "boleto" ? 3 : 1);

    const [ultFatura] = await db
      .select({ n: sql<string | null>`max(${assinaturaFaturas.numero})` })
      .from(assinaturaFaturas)
      .where(eq(assinaturaFaturas.empresaId, empresaId));
    const numeroFatura = Number(ultFatura?.n ?? 0) + 1;

    // Encerra assinaturas anteriores em aberto desta empresa antes de abrir o novo contrato
    const anteriores = await db
      .select()
      .from(assinaturas)
      .where(
        and(
          eq(assinaturas.empresaId, empresaId),
          inArray(assinaturas.status, ["ativa", "aguardando_pagamento", "inadimplente"]),
        ),
      );

    for (const ant of anteriores) {
      await cancelarAssinaturaNoGateway({
        gateway: ant.gateway,
        gatewaySubscriptionId: ant.gatewaySubscriptionId || "",
      });
      await db
        .update(assinaturas)
        .set({
          status: "cancelada",
          canceladaEm: new Date(),
          motivoCancelamento: `Substituída por contratação do plano ${preco.planoNome} (${ciclo})`,
          atualizadoEm: new Date(),
        })
        .where(eq(assinaturas.id, ant.id));
      await db
        .update(assinaturaFaturas)
        .set({ status: "cancelada" })
        .where(and(eq(assinaturaFaturas.assinaturaId, ant.id), eq(assinaturaFaturas.status, "pendente")));
    }

    const gw = await provisionarAssinaturaNoGateway({
      empresaId,
      cnpj14,
      razaoSocial,
      emailCobranca,
      municipio: empresa.municipio || "PORTO VELHO",
      planoId,
      ciclo,
      forma,
      valor: preco.valorCiclo,
      vencimentoIso: vencimentoFatura,
      numeroFatura,
    });

    const jaPaga = gw.faturaStatus === "paga";
    const proximoVencimento = jaPaga ? calcularProximoVencimento(hoje, ciclo) : vencimentoFatura;

    const [novaAssinatura] = await db
      .insert(assinaturas)
      .values({
        empresaId,
        cnpj: cnpj14,
        razaoSocial,
        emailCobranca,
        planoId,
        ciclo,
        formaPagamento: forma,
        valorCiclo: preco.valorCiclo,
        status: jaPaga ? "ativa" : "aguardando_pagamento",
        gateway: gw.gateway,
        gatewayCustomerId: gw.customerId,
        gatewaySubscriptionId: gw.subscriptionId,
        cartaoBandeira,
        cartaoUltimos4,
        proximoVencimento,
        cancelarAoFimDoCiclo: false,
      })
      .returning({ id: assinaturas.id });

    const [novaFatura] = await db
      .insert(assinaturaFaturas)
      .values({
        empresaId,
        assinaturaId: novaAssinatura.id,
        numero: numeroFatura,
        cnpj: cnpj14,
        planoId,
        ciclo,
        competencia: vencimentoFatura.slice(0, 7),
        valor: preco.valorCiclo,
        formaPagamento: forma,
        status: gw.faturaStatus,
        vencimento: vencimentoFatura,
        pagoEm: jaPaga ? new Date() : null,
        gateway: gw.gateway,
        gatewayPaymentId: gw.paymentId,
        checkoutUrl: gw.checkoutUrl,
        pixPayload: gw.pixPayload,
        linhaDigitavel: gw.linhaDigitavel,
        nsuAutorizacao: gw.nsuAutorizacao,
      })
      .returning({ id: assinaturaFaturas.id });

    // Atualiza CNPJ formatado da empresa caso tenha sido regularizado e ativa o plano se pago
    await db
      .update(empresas)
      .set({
        cnpj: mascaraDocumento(cnpj14),
        ...(jaPaga ? { plano: planoId, assinaturaPagoEm: hoje, trialUntil: null } : {}),
      })
      .where(eq(empresas.id, empresaId));

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "assinatura.contratar",
      entidade: "assinatura",
      registroId: novaAssinatura.id,
      resumo: `Assinatura ${preco.planoNome} (${ciclo} · ${moeda(preco.valorCiclo)}) iniciada via ${gw.gateway.toUpperCase()} para CNPJ ${mascaraDocumento(cnpj14)}`,
      alteracoes: {
        cnpj: cnpj14,
        planoId,
        ciclo,
        formaPagamento: forma,
        valorCiclo: preco.valorCiclo,
        gateway: gw.gateway,
        statusInicial: jaPaga ? "ativa" : "aguardando_pagamento",
        cartaoFinal: cartaoUltimos4 || null,
      },
    });

    revalidarAssinatura();

    return {
      ok: true,
      assinaturaId: novaAssinatura.id,
      faturaId: novaFatura.id,
      checkoutUrl: gw.checkoutUrl || undefined,
      statusFatura: gw.faturaStatus,
      aviso: jaPaga
        ? `Assinatura ${preco.planoNome} ativada para o CNPJ ${mascaraDocumento(cnpj14)} (${cartaoBandeira} final ${cartaoUltimos4}).`
        : forma === "pix"
          ? `Fatura PIX #${numeroFatura} gerada para o CNPJ ${mascaraDocumento(cnpj14)}. Pague o QR Code para ativar o plano ${preco.planoNome}.`
          : `Boleto #${numeroFatura} registrado para o CNPJ ${mascaraDocumento(cnpj14)} com vencimento em ${vencimentoFatura.split("-").reverse().join("/")}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function confirmarPagamentoSandbox(bruto: { faturaId?: string }): Promise<ResultadoAssinatura> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{ faturaId?: string }>(bruto);
    const faturaId = texto(input.faturaId);
    if (!faturaId) return { ok: false, erro: "Informe a fatura a ser liquidada." };

    const [fat] = await db
      .select()
      .from(assinaturaFaturas)
      .where(and(eq(assinaturaFaturas.id, faturaId), eq(assinaturaFaturas.empresaId, empresaId)))
      .limit(1);

    if (!fat) return { ok: false, erro: "Fatura não encontrada nesta empresa." };
    if (fat.gateway !== "sandbox") {
      return {
        ok: false,
        erro: `Esta fatura pertence ao gateway real (${fat.gateway.toUpperCase()}). A confirmação ocorre automaticamente via webhook autenticado.`,
      };
    }

    const r = await processarEventoWebhookAssinatura({
      evento: "PAYMENT_CONFIRMED",
      faturaId: fat.id,
      origem: `${usuario.nome} (Webhook Sandbox)`,
    });
    if (!r.ok) return r;

    revalidarAssinatura();
    return {
      ok: true,
      faturaId: fat.id,
      assinaturaId: r.assinaturaId,
      aviso: `Webhook de pagamento processado: fatura #${fat.numero} quitada e plano ${planoById(fat.planoId).nome} ativado.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function atualizarPreferenciaRecorrencia(bruto: {
  assinaturaId?: string;
  ciclo?: string;
  formaPagamento?: string;
  emailCobranca?: string;
}): Promise<ResultadoAssinatura> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{
      assinaturaId?: string;
      ciclo?: string;
      formaPagamento?: string;
      emailCobranca?: string;
    }>(bruto);

    const id = texto(input.assinaturaId);
    const [ass] = id
      ? await db
          .select()
          .from(assinaturas)
          .where(and(eq(assinaturas.id, id), eq(assinaturas.empresaId, empresaId)))
          .limit(1)
      : await db
          .select()
          .from(assinaturas)
          .where(eq(assinaturas.empresaId, empresaId))
          .orderBy(desc(assinaturas.createdAt))
          .limit(1);

    if (!ass || ass.status === "cancelada") {
      return { ok: false, erro: "Nenhuma assinatura ativa encontrada para atualizar." };
    }

    const ciclo: CicloAssinatura =
      texto(input.ciclo) === "anual" ? "anual" : texto(input.ciclo) === "mensal" ? "mensal" : (ass.ciclo as CicloAssinatura);
    const formaBruta = texto(input.formaPagamento);
    const forma: FormaAssinatura =
      formaBruta === "pix" || formaBruta === "boleto" || formaBruta === "cartao"
        ? formaBruta
        : (ass.formaPagamento as FormaAssinatura);
    const email = texto(input.emailCobranca).toLowerCase() || ass.emailCobranca;
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      return { ok: false, erro: "E-mail financeiro inválido." };
    }

    const preco = calcularPrecoAssinatura(ass.planoId, ciclo);

    await db
      .update(assinaturas)
      .set({
        ciclo,
        formaPagamento: forma,
        valorCiclo: preco.valorCiclo,
        emailCobranca: email,
        atualizadoEm: new Date(),
      })
      .where(and(eq(assinaturas.id, ass.id), eq(assinaturas.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "assinatura.atualizar_recorrencia",
      entidade: "assinatura",
      registroId: ass.id,
      resumo: `Recorrência atualizada para ${ciclo} via ${forma.toUpperCase()} (${moeda(preco.valorCiclo)})`,
      alteracoes: {
        antes: { ciclo: ass.ciclo, formaPagamento: ass.formaPagamento, valorCiclo: Number(ass.valorCiclo) },
        depois: { ciclo, formaPagamento: forma, valorCiclo: preco.valorCiclo, emailCobranca: email },
      },
    });

    revalidarAssinatura();
    return {
      ok: true,
      assinaturaId: ass.id,
      aviso: `Preferências da próxima renovação atualizadas (${ciclo} · ${forma.toUpperCase()} · ${moeda(preco.valorCiclo)}).`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function emitirProximaFaturaAssinatura(bruto: { assinaturaId?: string }): Promise<ResultadoAssinatura> {
  try {
    const { empresaId, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{ assinaturaId?: string }>(bruto);
    const assinaturaId = texto(input.assinaturaId);
    if (!assinaturaId) return { ok: false, erro: "Informe a assinatura." };

    const nova = await criarFaturaCicloRenovacao(assinaturaId, empresaId);

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "assinatura.emitir_fatura",
      entidade: "assinatura_fatura",
      registroId: nova.id,
      resumo: `Fatura #${nova.numero} emitida para renovação (${moeda(Number(nova.valor))} · ${nova.formaPagamento.toUpperCase()})`,
      alteracoes: { numero: nova.numero, valor: Number(nova.valor), vencimento: nova.vencimento, status: nova.status },
    });

    revalidarAssinatura();
    return {
      ok: true,
      assinaturaId,
      faturaId: nova.id,
      statusFatura: nova.status,
      aviso:
        nova.status === "paga"
          ? `Renovação #${nova.numero} cobrada automaticamente no cartão cadastrado.`
          : `Fatura de renovação #${nova.numero} gerada com sucesso.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function cancelarAssinaturaCnpj(bruto: {
  motivo?: string;
  imediato?: boolean;
}): Promise<ResultadoAssinatura> {
  try {
    const { empresaId, empresa, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{ motivo?: string; imediato?: boolean }>(bruto);
    const motivo = texto(input.motivo);
    const imediato = logico(input.imediato);

    if (motivo.length < 5) {
      return { ok: false, erro: "Informe o motivo do cancelamento (mín. 5 caracteres)." };
    }

    const [ass] = await db
      .select()
      .from(assinaturas)
      .where(
        and(
          eq(assinaturas.empresaId, empresaId),
          inArray(assinaturas.status, ["ativa", "aguardando_pagamento", "inadimplente"]),
        ),
      )
      .orderBy(desc(assinaturas.createdAt))
      .limit(1);

    const [[qtdProds], [qtdUsers]] = await Promise.all([
      db
        .select({ n: sql<string>`count(*)` })
        .from(produtos)
        .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true))),
      db
        .select({ n: sql<string>`count(*)` })
        .from(usuarios)
        .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.ativo, true))),
    ]);
    const cfgStart = planoById("start");
    const excedeLimites =
      Number(qtdProds?.n ?? 0) > cfgStart.limiteProdutos || Number(qtdUsers?.n ?? 0) > cfgStart.limiteUsuarios;
    const notaLimites = excedeLimites
      ? " Seus cadastros atuais foram preservados, mas novos cadastros acima do limite MEI Start ficarão bloqueados."
      : "";

    if (!ass) {
      if (empresa.plano === "start") {
        return { ok: false, erro: "A empresa já está no plano gratuito MEI Start." };
      }
      await db
        .update(empresas)
        .set({ plano: "start", assinaturaPagoEm: null })
        .where(eq(empresas.id, empresaId));

      await registrarAuditoria({
        empresaId,
        usuario,
        acao: "assinatura.downgrade_start",
        entidade: "empresa",
        registroId: empresaId,
        resumo: `Retorno ao plano gratuito MEI Start: ${motivo}`,
        alteracoes: { planoAnterior: empresa.plano, planoNovo: "start", motivo },
      });

      revalidarAssinatura();
      return { ok: true, aviso: `Plano alterado para MEI Start.${notaLimites}` };
    }

    await cancelarAssinaturaNoGateway({
      gateway: ass.gateway,
      gatewaySubscriptionId: ass.gatewaySubscriptionId || "",
    });

    await db
      .update(assinaturaFaturas)
      .set({ status: "cancelada" })
      .where(and(eq(assinaturaFaturas.assinaturaId, ass.id), eq(assinaturaFaturas.status, "pendente")));

    if (!imediato && ass.status === "ativa") {
      await db
        .update(assinaturas)
        .set({
          cancelarAoFimDoCiclo: true,
          motivoCancelamento: motivo,
          atualizadoEm: new Date(),
        })
        .where(eq(assinaturas.id, ass.id));

      await registrarAuditoria({
        empresaId,
        usuario,
        acao: "assinatura.agendar_cancelamento",
        entidade: "assinatura",
        registroId: ass.id,
        resumo: `Renovação automática cancelada — acesso ${planoById(ass.planoId).nome} mantido até ${ass.proximoVencimento}`,
        alteracoes: { motivo, vigenciAte: ass.proximoVencimento },
      });

      revalidarAssinatura();
      return {
        ok: true,
        assinaturaId: ass.id,
        aviso: `Renovação automática encerrada. Seu acesso ao plano ${planoById(ass.planoId).nome} permanece ativo até ${String(ass.proximoVencimento).split("-").reverse().join("/")}.`,
      };
    }

    await db
      .update(assinaturas)
      .set({
        status: "cancelada",
        cancelarAoFimDoCiclo: false,
        canceladaEm: new Date(),
        motivoCancelamento: motivo,
        atualizadoEm: new Date(),
      })
      .where(eq(assinaturas.id, ass.id));

    await db
      .update(empresas)
      .set({ plano: "start", assinaturaPagoEm: null })
      .where(eq(empresas.id, empresaId));

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "assinatura.cancelar",
      entidade: "assinatura",
      registroId: ass.id,
      resumo: `Assinatura CNPJ ${mascaraDocumento(ass.cnpj)} cancelada imediatamente — retorno ao MEI Start`,
      alteracoes: { motivo, planoAnterior: ass.planoId, planoNovo: "start" },
    });

    revalidarAssinatura();
    return {
      ok: true,
      assinaturaId: ass.id,
      aviso: `Assinatura encerrada e conta migrada para o plano gratuito MEI Start.${notaLimites}`,
    };
  } catch (e) {
    return comoErro(e);
  }
}
