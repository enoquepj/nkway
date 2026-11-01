import { NextResponse, type NextRequest } from "next/server";
import {
  processarWebhookEmissorFiscal,
  verificarAutenticacaoWebhookFiscal,
  type EventoWebhookFiscalInput,
} from "@/server/emissorFiscalCore";

export const dynamic = "force-dynamic";

function mapearStatusWebhook(raw: string): EventoWebhookFiscalInput["status"] | null {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "autorizado" || s === "autorizada" || s === "authorized" || s === "100" || s === "150") {
    return "autorizado";
  }
  if (s === "rejeitado" || s === "rejeitada" || s === "erro_autorizacao" || s === "rejected") {
    return "rejeitado";
  }
  if (s === "cancelado" || s === "cancelada" || s === "canceled" || s === "135") {
    return "cancelado";
  }
  return null;
}

export async function POST(req: NextRequest) {
  const corpoBruto = await req.text();
  const autenticado = verificarAutenticacaoWebhookFiscal({
    corpoBruto,
    tokenHeader: req.headers.get("x-emissor-token") || "",
    assinaturaHmacHeader: req.headers.get("x-nkway-signature") || "",
    authorizationHeader: req.headers.get("authorization") || "",
  });

  if (!autenticado) {
    return NextResponse.json(
      { ok: false, erro: "Webhook fiscal não autorizado: token ou assinatura HMAC inválida." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(corpoBruto || "{}") as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, erro: "JSON inválido no corpo do webhook fiscal." }, { status: 400 });
  }

  const statusMapeado = mapearStatusWebhook(String(body.status ?? body.situacao ?? body.cstat ?? ""));
  if (!statusMapeado) {
    return NextResponse.json({ ok: true, ignorado: true, statusRecebido: body.status ?? null });
  }

  const resultado = await processarWebhookEmissorFiscal({
    referencia: String(body.ref ?? body.referencia ?? body.vendaId ?? ""),
    chave: String(body.chave ?? body.chave_nfe ?? ""),
    status: statusMapeado,
    cstat: String(body.cstat ?? body.status_sefaz ?? ""),
    motivo: String(body.motivo ?? body.mensagem_sefaz ?? ""),
    protocolo: String(body.protocolo ?? ""),
    xml: String(body.xml ?? body.xml_nfe ?? ""),
    provedor: String(body.provedor ?? "webhook_custom"),
  });

  if (!resultado.ok) {
    return NextResponse.json(resultado, { status: 422 });
  }

  return NextResponse.json(resultado);
}
