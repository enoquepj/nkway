/**
 * NKWAY — Adaptador Server-Side de Gateway de Assinatura (Recorrência por CNPJ).
 * Suporta Asaas API v3 (PIX/Boleto/Cartão B2B por CNPJ), Stripe Checkout e Sandbox Homologação.
 * Nenhum segredo, token, número completo de cartão ou CVV é exposto ou persistido.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assinaturaFaturas, assinaturas, empresas } from "@/db/schema";
import {
  calcularPrecoAssinatura,
  calcularProximoVencimento,
  gerarLinhaDigitavelBoleto,
  gerarPayloadPixEmv,
  type CicloAssinatura,
  type FormaAssinatura,
} from "@/lib/assinatura";
import { hojeISO, planoById, soDigitos, somaDias } from "@/lib/dominio";
import { registrarAuditoria } from "@/server/auditoria";

export type ProvedorGateway = "asaas" | "stripe" | "sandbox";

export function diagnosticoGatewayServidor(): {
  provedor: ProvedorGateway;
  modoLive: boolean;
  webhookProtegido: boolean;
  asaasAmbiente: "producao" | "sandbox";
} {
  const asaasKey = (process.env.ASAAS_API_KEY || "").trim();
  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = (
    process.env.ASAAS_WEBHOOK_TOKEN ||
    process.env.BILLING_WEBHOOK_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ""
  ).trim();
  const asaasAmb = (process.env.ASAAS_AMBIENTE || "producao").toLowerCase() === "sandbox" ? "sandbox" : "producao";

  if (asaasKey) {
    return {
      provedor: "asaas",
      modoLive: true,
      webhookProtegido: Boolean(webhookSecret),
      asaasAmbiente: asaasAmb,
    };
  }
  if (stripeKey) {
    return {
      provedor: "stripe",
      modoLive: true,
      webhookProtegido: Boolean(webhookSecret),
      asaasAmbiente: "producao",
    };
  }
  return {
    provedor: "sandbox",
    modoLive: false,
    webhookProtegido: Boolean(webhookSecret),
    asaasAmbiente: "sandbox",
  };
}

function asaasBaseUrl(): string {
  const amb = (process.env.ASAAS_AMBIENTE || "producao").toLowerCase();
  return amb === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://api.asaas.com/v3";
}

export type ResultadoCriacaoGateway = {
  gateway: ProvedorGateway;
  customerId: string;
  subscriptionId: string;
  paymentId: string;
  faturaStatus: "pendente" | "paga";
  checkoutUrl: string;
  pixPayload: string;
  linhaDigitavel: string;
  nsuAutorizacao: string;
};

/* ------------------------------------------- Integração Real: Asaas v3 B2B */

async function criarNoAsaas(params: {
  empresaId: string;
  cnpj14: string;
  razaoSocial: string;
  emailCobranca: string;
  planoId: string;
  ciclo: CicloAssinatura;
  forma: FormaAssinatura;
  valor: number;
  vencimentoIso: string;
}): Promise<ResultadoCriacaoGateway> {
  const apiKey = (process.env.ASAAS_API_KEY || "").trim();
  const base = asaasBaseUrl();
  const headers = {
    "Content-Type": "application/json",
    access_token: apiKey,
  };

  // 1. Localiza ou cria cliente corporativo pelo CNPJ (14 dígitos)
  const buscaRes = await fetch(`${base}/customers?cpfCnpj=${params.cnpj14}`, { headers });
  const buscaJson = (await buscaRes.json().catch(() => ({}))) as { data?: { id: string }[]; errors?: { description?: string }[] };
  if (!buscaRes.ok) {
    throw new Error(buscaJson.errors?.[0]?.description || `Asaas clientes HTTP ${buscaRes.status}`);
  }

  let customerId = buscaJson.data?.[0]?.id || "";
  if (!customerId) {
    const cliRes = await fetch(`${base}/customers`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: params.razaoSocial,
        cpfCnpj: params.cnpj14,
        email: params.emailCobranca || undefined,
        externalReference: params.empresaId,
      }),
    });
    const cliJson = (await cliRes.json().catch(() => ({}))) as { id?: string; errors?: { description?: string }[] };
    if (!cliRes.ok || !cliJson.id) {
      throw new Error(cliJson.errors?.[0]?.description || `Falha ao cadastrar CNPJ no Asaas (HTTP ${cliRes.status})`);
    }
    customerId = cliJson.id;
  }

  // 2. Cria assinatura recorrente (MONTHLY / YEARLY)
  const billingType = params.forma === "pix" ? "PIX" : params.forma === "boleto" ? "BOLETO" : "CREDIT_CARD";
  const cycle = params.ciclo === "anual" ? "YEARLY" : "MONTHLY";
  const subRes = await fetch(`${base}/subscriptions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      customer: customerId,
      billingType,
      cycle,
      value: params.valor,
      nextDueDate: params.vencimentoIso,
      description: `NKWAY ERP · Plano ${planoById(params.planoId).nome} (${params.ciclo}) · CNPJ ${params.cnpj14}`,
      externalReference: params.empresaId,
    }),
  });
  const subJson = (await subRes.json().catch(() => ({}))) as { id?: string; errors?: { description?: string }[] };
  if (!subRes.ok || !subJson.id) {
    throw new Error(subJson.errors?.[0]?.description || `Falha ao criar assinatura Asaas (HTTP ${subRes.status})`);
  }

  // 3. Obtém a primeira cobrança da recorrência
  const payRes = await fetch(`${base}/subscriptions/${subJson.id}/payments`, { headers });
  const payJson = (await payRes.json().catch(() => ({}))) as {
    data?: { id: string; status: string; invoiceUrl?: string; bankSlipUrl?: string }[];
  };
  const cobranca = payJson.data?.[0];
  const paymentId = cobranca?.id || `asaas_${Date.now()}`;
  const checkoutUrl = cobranca?.invoiceUrl || cobranca?.bankSlipUrl || "";
  const paga = cobranca?.status === "CONFIRMED" || cobranca?.status === "RECEIVED";

  let pixPayload = "";
  let linhaDigitavel = "";

  if (cobranca?.id && params.forma === "pix") {
    const qrRes = await fetch(`${base}/payments/${cobranca.id}/pixQrCode`, { headers });
    const qrJson = (await qrRes.json().catch(() => ({}))) as { payload?: string };
    pixPayload = qrJson.payload || "";
  } else if (cobranca?.id && params.forma === "boleto") {
    const bolRes = await fetch(`${base}/payments/${cobranca.id}/identificationField`, { headers });
    const bolJson = (await bolRes.json().catch(() => ({}))) as { identificationField?: string };
    linhaDigitavel = bolJson.identificationField || "";
  }

  return {
    gateway: "asaas",
    customerId,
    subscriptionId: subJson.id,
    paymentId,
    faturaStatus: paga ? "paga" : "pendente",
    checkoutUrl,
    pixPayload,
    linhaDigitavel,
    nsuAutorizacao: paga ? paymentId : "",
  };
}

/* ------------------------------------ Integração Real: Stripe Subscription */

async function criarNoStripe(params: {
  empresaId: string;
  cnpj14: string;
  razaoSocial: string;
  emailCobranca: string;
  planoId: string;
  ciclo: CicloAssinatura;
  valor: number;
}): Promise<ResultadoCriacaoGateway> {
  const stripeKey = (process.env.STRIPE_SECRET_KEY || "").trim();
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://nkway.vercel.app").replace(/\/$/, "");
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("client_reference_id", params.empresaId);
  if (params.emailCobranca) form.set("customer_email", params.emailCobranca);
  form.set("success_url", `${appUrl}/assinatura?checkout=sucesso`);
  form.set("cancel_url", `${appUrl}/assinatura?checkout=cancelado`);
  form.set("metadata[empresa_id]", params.empresaId);
  form.set("metadata[cnpj]", params.cnpj14);
  form.set("metadata[plano_id]", params.planoId);
  form.set("metadata[ciclo]", params.ciclo);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", "brl");
  form.set("line_items[0][price_data][unit_amount]", String(Math.round(params.valor * 100)));
  form.set("line_items[0][price_data][recurring][interval]", params.ciclo === "anual" ? "year" : "month");
  form.set(
    "line_items[0][price_data][product_data][name]",
    `NKWAY ${planoById(params.planoId).nome} (${params.ciclo}) — CNPJ ${params.cnpj14}`,
  );

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    url?: string;
    customer?: string;
    subscription?: string;
    error?: { message?: string };
  };
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `Falha ao abrir sessão Stripe (HTTP ${res.status})`);
  }

  return {
    gateway: "stripe",
    customerId: String(json.customer ?? ""),
    subscriptionId: String(json.subscription ?? json.id),
    paymentId: json.id,
    faturaStatus: "pendente",
    checkoutUrl: json.url || "",
    pixPayload: "",
    linhaDigitavel: "",
    nsuAutorizacao: "",
  };
}

/* ------------------------------- Orquestrador Unificado (Live + Sandbox) */

export async function provisionarAssinaturaNoGateway(params: {
  empresaId: string;
  cnpj14: string;
  razaoSocial: string;
  emailCobranca: string;
  municipio: string;
  planoId: string;
  ciclo: CicloAssinatura;
  forma: FormaAssinatura;
  valor: number;
  vencimentoIso: string;
  numeroFatura: number;
}): Promise<ResultadoCriacaoGateway> {
  const diag = diagnosticoGatewayServidor();

  if (diag.provedor === "asaas") {
    return criarNoAsaas(params);
  }
  if (diag.provedor === "stripe") {
    return criarNoStripe(params);
  }

  // Modo Sandbox Homologação integrado (sem chaves externas configuradas)
  const carimbo = Date.now().toString(36).toUpperCase();
  const customerId = `cus_nk_${params.cnpj14}`;
  const subscriptionId = `sub_nk_${params.cnpj14.slice(0, 8)}_${carimbo}`;
  const paymentId = `pay_nk_${params.numeroFatura}_${carimbo}`;

  if (params.forma === "cartao") {
    return {
      gateway: "sandbox",
      customerId,
      subscriptionId,
      paymentId,
      faturaStatus: "paga",
      checkoutUrl: "",
      pixPayload: "",
      linhaDigitavel: "",
      nsuAutorizacao: `NSU${Date.now().toString().slice(-10)}`,
    };
  }

  if (params.forma === "pix") {
    const pixPayload = gerarPayloadPixEmv({
      valor: params.valor,
      cidade: params.municipio || "PORTO VELHO",
      txid: `NK${params.numeroFatura}${params.cnpj14.slice(0, 8)}`,
    });
    return {
      gateway: "sandbox",
      customerId,
      subscriptionId,
      paymentId,
      faturaStatus: "pendente",
      checkoutUrl: "",
      pixPayload,
      linhaDigitavel: "",
      nsuAutorizacao: "",
    };
  }

  const linhaDigitavel = gerarLinhaDigitavelBoleto({
    valor: params.valor,
    vencimentoIso: params.vencimentoIso,
    nossoNumero: params.numeroFatura * 1000 + Number(params.cnpj14.slice(-3)),
  });

  return {
    gateway: "sandbox",
    customerId,
    subscriptionId,
    paymentId,
    faturaStatus: "pendente",
    checkoutUrl: "",
    pixPayload: "",
    linhaDigitavel,
    nsuAutorizacao: "",
  };
}

export async function cancelarAssinaturaNoGateway(params: {
  gateway: string;
  gatewaySubscriptionId: string;
}): Promise<void> {
  if (params.gateway === "asaas" && params.gatewaySubscriptionId && process.env.ASAAS_API_KEY) {
    const base = asaasBaseUrl();
    await fetch(`${base}/subscriptions/${encodeURIComponent(params.gatewaySubscriptionId)}`, {
      method: "DELETE",
      headers: { access_token: process.env.ASAAS_API_KEY.trim() },
    }).catch(() => undefined);
  }
}

/* ------------------------------------- Autenticação e Processamento Webhook */

export function verificarAutenticacaoWebhookAssinatura(params: {
  corpoBruto: string;
  asaasTokenHeader: string;
  assinaturaHmacHeader: string;
  authorizationHeader: string;
}): boolean {
  const segredoAsaas = (process.env.ASAAS_WEBHOOK_TOKEN || "").trim();
  const segredoHmac = (
    process.env.BILLING_WEBHOOK_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    process.env.AUTH_SECRET ||
    "nkway-segredo-local-dev-troque-em-producao"
  ).trim();

  // Sem nenhum segredo específico e sem header enviado → bloqueia imediatamente
  const bearer = params.authorizationHeader.startsWith("Bearer ")
    ? params.authorizationHeader.slice(7).trim()
    : "";

  if (segredoAsaas) {
    if (params.asaasTokenHeader === segredoAsaas || bearer === segredoAsaas) return true;
  }

  const segredoEfetivo = segredoHmac || segredoAsaas;
  if (!segredoEfetivo) return false;

  if (bearer && bearer === segredoEfetivo) return true;

  if (params.assinaturaHmacHeader) {
    // Aceita formato direto hex ou "v1=<hex>"
    const recebidoHex = params.assinaturaHmacHeader.includes("=")
      ? (params.assinaturaHmacHeader.split("v1=")[1]?.split(",")[0]?.trim() ?? "")
      : params.assinaturaHmacHeader.trim();
    const esperadoHex = createHmac("sha256", segredoEfetivo).update(params.corpoBruto).digest("hex");
    const a = Buffer.from(recebidoHex);
    const b = Buffer.from(esperadoHex);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  return false;
}

export type EventoWebhookInput = {
  evento: "PAYMENT_CONFIRMED" | "PAYMENT_RECEIVED" | "PAYMENT_OVERDUE" | "SUBSCRIPTION_DELETED";
  faturaId?: string;
  gatewayPaymentId?: string;
  gatewaySubscriptionId?: string;
  empresaId?: string;
  cnpj?: string;
  nsuAutorizacao?: string;
  origem?: string;
};

/**
 * Liquida, vence ou cancela faturas/assinaturas de forma idempotente e sincroniza `nk_empresa.plano`.
 */
export async function processarEventoWebhookAssinatura(
  ev: EventoWebhookInput,
): Promise<{ ok: true; acaoAplicada: string; faturaId?: string; assinaturaId?: string } | { ok: false; erro: string }> {
  // Localiza fatura pelo id interno ou gatewayPaymentId
  let fatura = ev.faturaId
    ? (await db.select().from(assinaturaFaturas).where(eq(assinaturaFaturas.id, ev.faturaId)).limit(1))[0]
    : undefined;

  if (!fatura && ev.gatewayPaymentId) {
    fatura = (
      await db
        .select()
        .from(assinaturaFaturas)
        .where(eq(assinaturaFaturas.gatewayPaymentId, ev.gatewayPaymentId))
        .limit(1)
    )[0];
  }

  let assinatura = fatura
    ? (await db.select().from(assinaturas).where(eq(assinaturas.id, fatura.assinaturaId)).limit(1))[0]
    : undefined;

  if (!assinatura && ev.gatewaySubscriptionId) {
    assinatura = (
      await db
        .select()
        .from(assinaturas)
        .where(eq(assinaturas.gatewaySubscriptionId, ev.gatewaySubscriptionId))
        .limit(1)
    )[0];
  }

  if (!assinatura && ev.cnpj) {
    const cnpj14 = soDigitos(ev.cnpj);
    if (cnpj14.length === 14) {
      assinatura = (
        await db
          .select()
          .from(assinaturas)
          .where(eq(assinaturas.cnpj, cnpj14))
          .orderBy(desc(assinaturas.createdAt))
          .limit(1)
      )[0];
    }
  }

  if (!assinatura) {
    return { ok: false, erro: "Assinatura ou fatura correspondente não localizada." };
  }

  // Se não veio fatura explícita, pega a mais recente da assinatura
  if (!fatura) {
    fatura = (
      await db
        .select()
        .from(assinaturaFaturas)
        .where(eq(assinaturaFaturas.assinaturaId, assinatura.id))
        .orderBy(desc(assinaturaFaturas.createdAt))
        .limit(1)
    )[0];
  }

  const hoje = hojeISO();

  if (ev.evento === "PAYMENT_CONFIRMED" || ev.evento === "PAYMENT_RECEIVED") {
    if (fatura && fatura.status === "paga" && assinatura.status === "ativa") {
      return { ok: true, acaoAplicada: "idempotente_ja_paga", faturaId: fatura.id, assinaturaId: assinatura.id };
    }

    const ciclo = (assinatura.ciclo === "anual" ? "anual" : "mensal") as CicloAssinatura;
    const proxVenc = calcularProximoVencimento(hoje, ciclo);

    if (fatura) {
      await db
        .update(assinaturaFaturas)
        .set({
          status: "paga",
          pagoEm: new Date(),
          nsuAutorizacao: ev.nsuAutorizacao || fatura.nsuAutorizacao || `WH${Date.now().toString().slice(-10)}`,
        })
        .where(eq(assinaturaFaturas.id, fatura.id));
    }

    await db
      .update(assinaturas)
      .set({
        status: "ativa",
        proximoVencimento: proxVenc,
        atualizadoEm: new Date(),
      })
      .where(eq(assinaturas.id, assinatura.id));

    await db
      .update(empresas)
      .set({
        plano: assinatura.planoId,
        assinaturaPagoEm: hoje,
        trialUntil: null,
      })
      .where(eq(empresas.id, assinatura.empresaId));

    await registrarAuditoria({
      empresaId: assinatura.empresaId,
      usuario: { nome: ev.origem || `Webhook ${assinatura.gateway.toUpperCase()}`, papel: "sistema" },
      acao: "assinatura.pagamento_confirmado",
      entidade: "assinatura",
      registroId: assinatura.id,
      resumo: `Pagamento confirmado (${planoById(assinatura.planoId).nome} · ${assinatura.ciclo}) para CNPJ ${assinatura.cnpj}`,
      alteracoes: {
        faturaId: fatura?.id ?? null,
        planoId: assinatura.planoId,
        ciclo: assinatura.ciclo,
        valor: fatura ? Number(fatura.valor) : Number(assinatura.valorCiclo),
        proximoVencimento: proxVenc,
      },
    });

    return { ok: true, acaoAplicada: "pagamento_confirmado", faturaId: fatura?.id, assinaturaId: assinatura.id };
  }

  if (ev.evento === "PAYMENT_OVERDUE") {
    if (fatura && fatura.status === "pendente") {
      await db
        .update(assinaturaFaturas)
        .set({ status: "vencida" })
        .where(and(eq(assinaturaFaturas.id, fatura.id), eq(assinaturaFaturas.status, "pendente")));
    }

    await db
      .update(assinaturas)
      .set({ status: "inadimplente", atualizadoEm: new Date() })
      .where(eq(assinaturas.id, assinatura.id));

    await registrarAuditoria({
      empresaId: assinatura.empresaId,
      usuario: { nome: ev.origem || `Webhook ${assinatura.gateway.toUpperCase()}`, papel: "sistema" },
      acao: "assinatura.fatura_vencida",
      entidade: "assinatura",
      registroId: assinatura.id,
      resumo: `Fatura em atraso identificada para CNPJ ${assinatura.cnpj} (${planoById(assinatura.planoId).nome})`,
      alteracoes: { faturaId: fatura?.id ?? null, status: "inadimplente" },
    });

    return { ok: true, acaoAplicada: "marcada_inadimplente", faturaId: fatura?.id, assinaturaId: assinatura.id };
  }

  if (ev.evento === "SUBSCRIPTION_DELETED") {
    await db
      .update(assinaturas)
      .set({
        status: "cancelada",
        canceladaEm: new Date(),
        motivoCancelamento: assinatura.motivoCancelamento || "Cancelada via evento do gateway",
        atualizadoEm: new Date(),
      })
      .where(eq(assinaturas.id, assinatura.id));

    await db
      .update(empresas)
      .set({ plano: "start", assinaturaPagoEm: null })
      .where(eq(empresas.id, assinatura.empresaId));

    await registrarAuditoria({
      empresaId: assinatura.empresaId,
      usuario: { nome: ev.origem || `Webhook ${assinatura.gateway.toUpperCase()}`, papel: "sistema" },
      acao: "assinatura.cancelada_webhook",
      entidade: "assinatura",
      registroId: assinatura.id,
      resumo: `Assinatura encerrada no gateway — empresa retornou ao plano MEI Start`,
      alteracoes: { planoAnterior: assinatura.planoId, planoAtual: "start" },
    });

    return { ok: true, acaoAplicada: "assinatura_cancelada", assinaturaId: assinatura.id };
  }

  return { ok: false, erro: "Evento de webhook não suportado." };
}

/** Gera cobrança de renovação para o próximo ciclo da assinatura */
export async function criarFaturaCicloRenovacao(assinaturaId: string, empresaId: string) {
  const [ass] = await db
    .select()
    .from(assinaturas)
    .where(and(eq(assinaturas.id, assinaturaId), eq(assinaturas.empresaId, empresaId)))
    .limit(1);
  if (!ass) throw new Error("Assinatura não encontrada.");
  if (ass.status === "cancelada") throw new Error("Assinatura cancelada não gera nova fatura.");

  const existentes = await db
    .select({ numero: assinaturaFaturas.numero, status: assinaturaFaturas.status })
    .from(assinaturaFaturas)
    .where(eq(assinaturaFaturas.assinaturaId, ass.id));

  if (existentes.some((f) => f.status === "pendente")) {
    throw new Error("Já existe uma fatura aguardando pagamento para esta assinatura.");
  }

  const proximoNumero = existentes.reduce((m, f) => Math.max(m, f.numero), 0) + 1;
  const ciclo = (ass.ciclo === "anual" ? "anual" : "mensal") as CicloAssinatura;
  const forma = (ass.formaPagamento as FormaAssinatura) || "pix";
  const calc = calcularPrecoAssinatura(ass.planoId, ciclo);
  const vencimento = somaDias(hojeISO(), forma === "boleto" ? 3 : 1);
  const competencia = vencimento.slice(0, 7);

  const pixPayload =
    forma === "pix"
      ? gerarPayloadPixEmv({
          valor: calc.valorCiclo,
          txid: `NK${proximoNumero}${ass.cnpj.slice(0, 8)}`,
        })
      : "";
  const linhaDigitavel =
    forma === "boleto"
      ? gerarLinhaDigitavelBoleto({
          valor: calc.valorCiclo,
          vencimentoIso: vencimento,
          nossoNumero: proximoNumero * 1000 + Number(ass.cnpj.slice(-3)),
        })
      : "";
  const pagaCartao = forma === "cartao" && ass.gateway === "sandbox";

  const [nova] = await db
    .insert(assinaturaFaturas)
    .values({
      empresaId,
      assinaturaId: ass.id,
      numero: proximoNumero,
      cnpj: ass.cnpj,
      planoId: ass.planoId,
      ciclo,
      competencia,
      valor: calc.valorCiclo,
      formaPagamento: forma,
      status: pagaCartao ? "paga" : "pendente",
      vencimento,
      pagoEm: pagaCartao ? new Date() : null,
      gateway: ass.gateway,
      gatewayPaymentId: `pay_ren_${proximoNumero}_${Date.now().toString(36).toUpperCase()}`,
      pixPayload,
      linhaDigitavel,
      nsuAutorizacao: pagaCartao ? `NSU${Date.now().toString().slice(-10)}` : "",
    })
    .returning();

  if (pagaCartao) {
    const novoProx = calcularProximoVencimento(hojeISO(), ciclo);
    await db
      .update(assinaturas)
      .set({ status: "ativa", proximoVencimento: novoProx, atualizadoEm: new Date() })
      .where(eq(assinaturas.id, ass.id));
    await db
      .update(empresas)
      .set({ plano: ass.planoId, assinaturaPagoEm: hojeISO() })
      .where(eq(empresas.id, empresaId));
  }

  return nova;
}
