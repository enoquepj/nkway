/**
 * NKWAY — Motor Server-Side de Exportação de XML de Documentos de Venda (Fase 3).
 * Regra estrita: exporta EXCLUSIVAMENTE o XML fiscal efetivamente armazenado em `nk_venda.xml_fiscal`
 * ou retornado por integração fiscal configurada (`EMISSOR_FISCAL_XML_URL`).
 * NUNCA gera ou inventa XML fictício.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { vendas, type VendaRow } from "@/db/schema";
import { hojeISO, soDigitos } from "@/lib/dominio";
import { gerarZipBuffer } from "@/lib/zip";
import { registrarAuditoria } from "@/server/auditoria";

export type ItemSemXml = {
  id: string;
  rotulo: string;
  motivo: string;
};

export type ResultadoExportacaoXml =
  | {
      ok: true;
      modo: "xml" | "zip";
      nomeArquivo: string;
      mimeType: string;
      buffer: Buffer;
      exportados: { id: string; rotulo: string; nomeArquivo: string }[];
      semXml: ItemSemXml[];
      aviso: string;
    }
  | {
      ok: false;
      erro: string;
      semXml: ItemSemXml[];
    };

export function xmlFiscalArmazenadoValido(xml: string | null | undefined): boolean {
  const s = String(xml ?? "").trim();
  if (!s.startsWith("<")) return false;
  return /<\s*(?:nfeProc|NFe|infNFe|CFe|enviNFe)\b/i.test(s);
}

/**
 * Busca o XML real armazenado no banco ou, quando configurada, na integração externa oficial.
 * Nunca fabrica XML sintético.
 */
export async function obterXmlRealDaVenda(venda: Pick<VendaRow, "id" | "empresaId" | "tipo" | "chave" | "xmlFiscal">): Promise<string | null> {
  if (venda.tipo !== "fiscal") return null;

  if (xmlFiscalArmazenadoValido(venda.xmlFiscal)) {
    return String(venda.xmlFiscal).trim();
  }

  // Integração externa opcional com emissor fiscal homologado (quando configurado em produção)
  const urlBase = (process.env.EMISSOR_FISCAL_XML_URL || "").trim().replace(/\/$/, "");
  const token = (process.env.EMISSOR_FISCAL_TOKEN || "").trim();
  if (urlBase && venda.chave) {
    try {
      const res = await fetch(`${urlBase}/${encodeURIComponent(venda.chave)}`, {
        method: "GET",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const xmlRemoto = (await res.text()).trim();
        if (xmlFiscalArmazenadoValido(xmlRemoto)) {
          await db
            .update(vendas)
            .set({ xmlFiscal: xmlRemoto })
            .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, venda.empresaId)));
          return xmlRemoto;
        }
      }
    } catch {
      // Se o serviço externo falhar, não gera XML fictício; retorna null com segurança
    }
  }

  return null;
}

function rotuloDocumento(v: Pick<VendaRow, "tipo" | "modelo" | "numeroNota" | "numero">): string {
  if (v.tipo === "dav") return `DAV ${v.numero}`;
  return `${v.modelo ?? "NFC-e"} ${v.numeroNota ?? v.numero}`;
}

function nomeArquivoXmlVenda(v: Pick<VendaRow, "modelo" | "serie" | "numeroNota" | "numero" | "chave">): string {
  const chave44 = soDigitos(v.chave).slice(0, 44);
  const prefixo = v.modelo === "NF-e" ? "NFe" : v.modelo === "SAT" ? "CFe" : "NFCe";
  if (chave44.length === 44) return `${prefixo}-${chave44}.xml`;
  return `${prefixo}-serie${v.serie ?? "1"}-num${v.numeroNota ?? v.numero}.xml`;
}

export async function executarExportacaoXmlVendas(params: {
  empresaId: string;
  usuario: { id: string; nome: string; papel: string };
  ids: string[];
}): Promise<ResultadoExportacaoXml> {
  const idsUnicos = [...new Set((params.ids ?? []).map((i) => String(i ?? "").trim()).filter(Boolean))].slice(0, 500);
  if (idsUnicos.length === 0) {
    return {
      ok: false,
      erro: "Selecione ao menos um documento de venda para exportar o XML.",
      semXml: [],
    };
  }

  const linhas = await db
    .select()
    .from(vendas)
    .where(and(eq(vendas.empresaId, params.empresaId), inArray(vendas.id, idsUnicos)));

  if (linhas.length === 0) {
    return {
      ok: false,
      erro: "Nenhum documento válido desta empresa foi encontrado na seleção.",
      semXml: [],
    };
  }

  // Preserva a ordem solicitada e sinaliza ids que não pertençam à empresa
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const arquivos: { id: string; rotulo: string; nome: string; conteudo: string }[] = [];
  const semXml: ItemSemXml[] = [];

  for (const id of idsUnicos) {
    const v = porId.get(id);
    if (!v) continue; // ID de outra empresa ou inexistente: ignorado com segurança multi-tenant
    const rotulo = rotuloDocumento(v);

    if (v.tipo === "dav") {
      semXml.push({
        id: v.id,
        rotulo,
        motivo: "DAV / orçamento é pré-venda e não possui XML fiscal autorizado",
      });
      continue;
    }

    const xml = await obterXmlRealDaVenda(v);
    if (!xml) {
      semXml.push({
        id: v.id,
        rotulo,
        motivo: "XML fiscal não disponível/armazenado para este documento",
      });
      continue;
    }

    arquivos.push({
      id: v.id,
      rotulo,
      nome: nomeArquivoXmlVenda(v),
      conteudo: xml,
    });
  }

  if (arquivos.length === 0) {
    await registrarAuditoria({
      empresaId: params.empresaId,
      usuario: params.usuario,
      acao: "documento.exportar_xml",
      entidade: "venda",
      registroId: idsUnicos.length === 1 ? idsUnicos[0] : `lote:${idsUnicos.length}`,
      resumo: `Tentativa de exportação de XML sem arquivo disponível (${semXml.length} documento(s) sem XML armazenado)`,
      alteracoes: {
        status: "sem_xml_disponivel",
        solicitados: idsUnicos.length,
        semXml: semXml.map((s) => ({ rotulo: s.rotulo, motivo: s.motivo })),
      },
    });

    const msgUnico =
      semXml.length === 1
        ? `${semXml[0].rotulo}: ${semXml[0].motivo}.`
        : `Nenhum dos ${semXml.length} documentos selecionados possui XML fiscal armazenado para exportação.`;

    return {
      ok: false,
      erro: msgUnico,
      semXml,
    };
  }

  if (arquivos.length === 1) {
    const arq = arquivos[0];
    const buffer = Buffer.from(arq.conteudo, "utf8");

    await registrarAuditoria({
      empresaId: params.empresaId,
      usuario: params.usuario,
      acao: "documento.exportar_xml",
      entidade: "venda",
      registroId: arq.id,
      resumo: `XML fiscal exportado (${arq.rotulo} → ${arq.nome})${semXml.length > 0 ? ` · ${semXml.length} sem XML ignorado(s)` : ""}`,
      alteracoes: {
        modo: "individual",
        arquivo: arq.nome,
        exportadosCount: 1,
        semXmlCount: semXml.length,
        semXml: semXml.map((s) => s.rotulo),
      },
    });

    return {
      ok: true,
      modo: "xml",
      nomeArquivo: arq.nome,
      mimeType: "application/xml;charset=utf-8",
      buffer,
      exportados: [{ id: arq.id, rotulo: arq.rotulo, nomeArquivo: arq.nome }],
      semXml,
      aviso:
        semXml.length > 0
          ? `1 XML exportado (${arq.rotulo}). Atenção: ${semXml.length} documento(s) da seleção não possuíam XML disponível.`
          : `XML de ${arq.rotulo} exportado com sucesso.`,
    };
  }

  const zipBuf = gerarZipBuffer(
    arquivos.map((a) => ({ nome: a.nome, conteudo: a.conteudo })),
  );
  const nomeZip = `nkway-xml-documentos-${hojeISO()}.zip`;

  await registrarAuditoria({
    empresaId: params.empresaId,
    usuario: params.usuario,
    acao: "documento.exportar_xml",
    entidade: "venda",
    registroId: `lote:${arquivos.length}`,
    resumo: `Lote ZIP com ${arquivos.length} XML(s) exportado por ${params.usuario.nome}${semXml.length > 0 ? ` · ${semXml.length} sem XML` : ""}`,
    alteracoes: {
      modo: "lote_zip",
      nomeZip,
      exportadosCount: arquivos.length,
      semXmlCount: semXml.length,
      arquivos: arquivos.map((a) => a.nome),
      semXml: semXml.map((s) => s.rotulo),
    },
  });

  return {
    ok: true,
    modo: "zip",
    nomeArquivo: nomeZip,
    mimeType: "application/zip",
    buffer: zipBuf,
    exportados: arquivos.map((a) => ({ id: a.id, rotulo: a.rotulo, nomeArquivo: a.nome })),
    semXml,
    aviso:
      semXml.length > 0
        ? `Pacote ZIP gerado com ${arquivos.length} XML(s). ${semXml.length} documento(s) da seleção não possuíam XML disponível.`
        : `Pacote ZIP gerado com ${arquivos.length} arquivos XML.`,
  };
}
