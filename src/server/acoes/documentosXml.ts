"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { vendas } from "@/db/schema";
import { soDigitos } from "@/lib/dominio";
import { registrarAuditoria } from "@/server/auditoria";
import {
  executarExportacaoXmlVendas,
  xmlFiscalArmazenadoValido,
  type ItemSemXml,
} from "@/server/exportacaoXmlCore";
import { comoErro, corpo, exigirPermissao, texto } from "@/server/tenant";

export type RespostaExportarXmlAction =
  | {
      ok: true;
      modo: "xml" | "zip";
      nomeArquivo: string;
      mimeType: string;
      conteudoBase64: string;
      exportados: { id: string; rotulo: string; nomeArquivo: string }[];
      semXml: ItemSemXml[];
      aviso: string;
    }
  | {
      ok: false;
      erro: string;
      semXml?: ItemSemXml[];
    };

export async function exportarXmlDocumentos(bruto: { ids?: string[] }): Promise<RespostaExportarXmlAction> {
  try {
    const { empresaId, usuario } = await exigirPermissao("documentos.exportar_xml");
    const input = corpo<{ ids?: string[] }>(bruto);
    const ids = Array.isArray(input.ids) ? input.ids : [];

    const r = await executarExportacaoXmlVendas({
      empresaId,
      usuario,
      ids,
    });

    if (!r.ok) {
      return { ok: false, erro: r.erro, semXml: r.semXml };
    }

    return {
      ok: true,
      modo: r.modo,
      nomeArquivo: r.nomeArquivo,
      mimeType: r.mimeType,
      conteudoBase64: r.buffer.toString("base64"),
      exportados: r.exportados,
      semXml: r.semXml,
      aviso: r.aviso,
    };
  } catch (e) {
    return comoErro(e);
  }
}

/**
 * Permite anexar/armazenar um XML fiscal real autorizado (retornado pela SEFAZ ou emissor externo)
 * a um documento fiscal existente da empresa, sem nunca fabricar XML fictício.
 */
export async function armazenarXmlFiscalDocumento(bruto: {
  vendaId?: string;
  xml?: string;
}): Promise<{ ok: true; aviso: string } | { ok: false; erro: string }> {
  try {
    const { empresaId, usuario } = await exigirPermissao("fiscal.eventos");
    const input = corpo<{ vendaId?: string; xml?: string }>(bruto);
    const vendaId = texto(input.vendaId);
    const xml = String(input.xml ?? "").trim();

    if (!vendaId) return { ok: false, erro: "Informe o documento fiscal." };
    if (!xmlFiscalArmazenadoValido(xml)) {
      return {
        ok: false,
        erro: "O arquivo enviado não é um XML fiscal válido (esperado procNFe, NFe ou CFe autorizado).",
      };
    }

    const [v] = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId)))
      .limit(1);

    if (!v) return { ok: false, erro: "Documento não encontrado nesta empresa." };
    if (v.tipo !== "fiscal") {
      return { ok: false, erro: "DAV / orçamento não comporta XML fiscal autorizado. Fature o DAV primeiro." };
    }

    // Se o XML trouxer chNFe ou Id="NFe...", verifica compatibilidade quando a chave estiver preenchida
    const matchChave =
      xml.match(/<(?:\w+:)?chNFe>\s*(\d{44})\s*<\/(?:\w+:)?chNFe>/i)?.[1] ??
      xml.match(/\bId\s*=\s*["'](?:NFe|CFe)(\d{44})["']/i)?.[1] ??
      "";
    if (matchChave && v.chave && soDigitos(v.chave) !== matchChave) {
      return {
        ok: false,
        erro: `A chave do XML (${matchChave}) não corresponde à chave deste documento (${v.chave}).`,
      };
    }

    await db
      .update(vendas)
      .set({ xmlFiscal: xml })
      .where(and(eq(vendas.id, v.id), eq(vendas.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "documento.armazenar_xml",
      entidade: "venda",
      registroId: v.id,
      resumo: `XML fiscal real vinculado ao documento ${v.modelo ?? "NFC-e"} ${v.numeroNota ?? v.numero}`,
      alteracoes: { chave: v.chave, tamanhoBytes: Buffer.byteLength(xml, "utf8") },
    });

    revalidatePath("/documentos");
    return {
      ok: true,
      aviso: `XML fiscal vinculado ao documento ${v.modelo ?? "NFC-e"} ${v.numeroNota ?? v.numero}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}
