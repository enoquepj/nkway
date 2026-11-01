import { NextResponse, type NextRequest } from "next/server";
import {
  processarEventoWebhookAssinatura,
  verificarAutenticacaoWebhookAssinatura,
  type EventoWebhookInput,
} from "@/server/assinaturaGateway";

export const dynamic = "force-dynamic";

function normalizarTipoEvento(raw: string): EventoWebhookInput["evento"] | null {
  const e = String(raw || "").trim();
  if (
    e === "PAYMENT_CONFIRMED" ||
    e === "PAYMENT_RECEIVED" ||
    e === "invoice.paid" ||
    e === "checkout.session.completed"
  ) {
    return "PAYMENT_CONFIRMED";
  }
  if (e === "PAYMENT_OVERDUE" || e === "invoice.payment_failed") {
    return "PAYMENT_OVERDUE";
  }
  if (e === "SUBSCRIPTION_DELETED" || e === "customer.subscription.deleted") {
    return "SUBSCRIPTION_DELETED";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const corpoBruto = await req.text();
  const autenticado = verificarAutenticacaoWebhookAssinatura({
    corpoBruto,
    asaasTokenHeader: req.headers.get("asaas-access-token") || "",
    assinaturaHmacHeader: req.headers.get("x-nkway-signature") || req.headers.get("stripe-signature") || "",
    authorizationHeader: req.headers.get("authorization") || "",
  });

  if (!autenticado) {
    return NextResponse.json(
      { ok: false, erro: "Webhook não autorizado: token ou assinatura HMAC inválida." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(corpoBruto || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, erro: "JSON malformado no corpo do webhook." }, { status: 400 });
  }

  const tipoBruto = String(body.event ?? body.type ?? body.evento ?? "");
  const evento = normalizarTipoEvento(tipoBruto);
  if (!evento) {
    return NextResponse.json({ ok: true, ignorado: true, eventoRecebido: tipoBruto });
  }

  const payment = (body.payment ?? {}) as Record<string, unknown>;
  const subscription = (body.subscription ?? {}) as Record<string, unknown>;
  const dataObj = ((body.data as Record<string, unknown> | undefined)?.object ?? {}) as Record<string, unknown>;
  const meta = (dataObj.metadata ?? {}) as Record<string, unknown>;

  const resultado = await processarEventoWebhookAssinatura({
    evento,
    faturaId: String(body.faturaId ?? ""),
    gatewayPaymentId: String(payment.id ?? dataObj.id ?? body.gatewayPaymentId ?? ""),
    gatewaySubscriptionId: String(
      payment.subscription ?? subscription.id ?? dataObj.subscription ?? body.gatewaySubscriptionId ?? "",
    ),
    empresaId: String(
      payment.externalReference ??
        subscription.externalReference ??
        dataObj.client_reference_id ??
        meta.empresa_id ??
        body.empresaId ??
        "",
    ),
    cnpj: String(meta.cnpj ?? body.cnpj ?? ""),
    nsuAutorizacao: String(payment.transactionReceiptUrl ? payment.id : body.nsuAutorizacao ?? ""),
    origem: "Webhook Gateway",
  });

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 });
  }

  return NextResponse.json(resultado);
}
