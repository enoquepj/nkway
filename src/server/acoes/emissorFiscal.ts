"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { vendas } from "@/db/schema";
import type { RegraFiscalAchado } from "@/lib/emissorFiscal";
import { registrarAuditoria } from "@/server/auditoria";
import { montarInsumoFiscalDaVenda, transmitirVendaParaEmissor } from "@/server/emissorFiscalCore";
import { comoErro, corpo, exigirPermissao, texto } from "@/server/tenant";

export type RespostaInspecaoFiscal =
  | {
      ok: true;
      aprovada: boolean;
      bloqueios: RegraFiscalAchado[];
      alertas: RegraFiscalAchado[];
      payloadJson: string;
    }
  | { ok: false; erro: string };

export type RespostaRetransmissao =
  | {
      ok: true;
      statusSefaz: string;
      cstat: string;
      aviso: string;
    }
  | {
      ok: false;
      erro: string;
      bloqueios?: RegraFiscalAchado[];
    };

function revalidarFiscal() {
  ["/emissor", "/documentos", "/pdv", "/", "/usuarios"].forEach((p) => revalidatePath(p));
}

export async function inspecionarDocumentoFiscal(bruto: { vendaId?: string }): Promise<RespostaInspecaoFiscal> {
  try {
    const { empresaId } = await exigirPermissao("documentos.ver");
    const input = corpo<{ vendaId?: string }>(bruto);
    const vendaId = texto(input.vendaId);
    if (!vendaId) return { ok: false, erro: "Informe o documento de venda para inspeção." };

    const ctx = await montarInsumoFiscalDaVenda(empresaId, vendaId);
    if (!ctx) return { ok: false, erro: "Documento não encontrado nesta empresa." };
    if (ctx.venda.tipo !== "fiscal") {
      return { ok: false, erro: "DAV / orçamento não possui payload fiscal SEFAZ até ser faturado." };
    }

    return {
      ok: true,
      aprovada: ctx.validacao.aprovada,
      bloqueios: ctx.validacao.bloqueios,
      alertas: ctx.validacao.alertas,
      payloadJson: JSON.stringify(ctx.payload, null, 2),
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function retransmitirVendaSefaz(bruto: { vendaId?: string }): Promise<RespostaRetransmissao> {
  try {
    const { empresaId, usuario } = await exigirPermissao("fiscal.eventos");
    const input = corpo<{ vendaId?: string }>(bruto);
    const vendaId = texto(input.vendaId);
    if (!vendaId) return { ok: false, erro: "Informe o documento fiscal para retransmissão." };

    const r = await transmitirVendaParaEmissor({
      empresaId,
      vendaId,
      usuario,
      registrarNaAuditoria: true,
    });

    revalidarFiscal();

    if (!r.ok) {
      return {
        ok: false,
        erro: r.motivo,
        bloqueios: r.bloqueios,
      };
    }

    return {
      ok: true,
      statusSefaz: r.statusSefaz,
      cstat: r.cstat,
      aviso:
        r.statusSefaz === "autorizada"
          ? `Nota autorizada na SEFAZ (cStat ${r.cstat})${r.temXmlReal ? " com XML fiscal armazenado." : "."}`
          : `Pré-validação 4.00 concluída (${r.motivo}).`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function retransmitirFilaContingencia(bruto?: { limite?: number }): Promise<{
  ok: true;
  processadas: number;
  aprovadas: number;
  rejeitadas: number;
  aviso: string;
} | { ok: false; erro: string }> {
  try {
    const { empresaId, usuario } = await exigirPermissao("fiscal.eventos");
    corpo(bruto);

    const fila = await db
      .select({ id: vendas.id })
      .from(vendas)
      .where(
        and(
          eq(vendas.empresaId, empresaId),
          eq(vendas.tipo, "fiscal"),
          eq(vendas.status, "faturado"),
          inArray(vendas.statusSefaz, ["contingencia", "rejeitada", "pendente_envio"]),
        ),
      )
      .orderBy(desc(vendas.data))
      .limit(40);

    if (fila.length === 0) {
      return {
        ok: true,
        processadas: 0,
        aprovadas: 0,
        rejeitadas: 0,
        aviso: "Nenhuma nota pendente, rejeitada ou em contingência na fila no momento.",
      };
    }

    let aprovadas = 0;
    let rejeitadas = 0;
    for (const item of fila) {
      const r = await transmitirVendaParaEmissor({
        empresaId,
        vendaId: item.id,
        usuario,
        registrarNaAuditoria: false,
      });
      if (r.ok) aprovadas++;
      else rejeitadas++;
    }

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "fiscal.retransmitir_lote",
      entidade: "venda",
      registroId: `lote:${fila.length}`,
      resumo: `Fila SEFAZ processada em lote: ${aprovadas} aprovada(s) · ${rejeitadas} com pendência`,
      alteracoes: { processadas: fila.length, aprovadas, rejeitadas },
    });

    revalidarFiscal();
    return {
      ok: true,
      processadas: fila.length,
      aprovadas,
      rejeitadas,
      aviso: `Lote concluído (${fila.length} documento(s)): ${aprovadas} aprovado(s) e ${rejeitadas} com pendência/rejeição.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}
