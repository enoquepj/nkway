"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { empresas, entradas, fornecedores, produtos, type EntradaItem } from "@/db/schema";
import { MANIFESTOS_DFE, padNsu, type StatusManifesto } from "@/lib/dfe";
import { hojeISO, round2, soDigitos, validarChaveAcesso } from "@/lib/dominio";
import { parseNfeXml } from "@/lib/xmlNfe";
import {
  ambienteDfeServidor,
  cifrarSegredo,
  executarCapturaDfeEmpresa,
  inspecionarPfx,
  lerDocumentosDfeFiscal,
  montarXmlNfeDemo,
  removerPfxArmazenamento,
  salvarPfxArmazenamento,
  unzipDocZip,
  zipDocZip,
} from "@/server/dfeCore";
import { comoErro, corpo, exigirPermissao, logico, numero, texto } from "@/server/tenant";

export type ResultadoDfe =
  | { ok: true; id?: string; entradaId?: string; aviso?: string }
  | { ok: false; erro: string };

function revalidarDfe() {
  ["/dfe", "/config", "/entradas", "/estoque", "/"].forEach((p) => revalidatePath(p));
}

export async function salvarCertificadoA1(input: {
  pfxBase64?: string;
  nomeArquivo?: string;
  senha?: string;
  titular?: string;
  validade?: string;
  serial?: string;
  ambiente?: number;
}): Promise<ResultadoDfe> {
  try {
    const { empresaId, empresa } = await exigirPermissao("config.gerenciar");
    input = corpo(input);
    const b64 = texto(input.pfxBase64).replace(/^data:[^;]+;base64,/, "");
    const senha = String(input.senha ?? "");
    if (!b64) return { ok: false, erro: "Selecione o arquivo .pfx ou .p12 do Certificado Digital A1." };
    if (!senha) return { ok: false, erro: "Informe a senha do Certificado Digital A1." };

    const pfxBuffer = Buffer.from(b64, "base64");
    const inspecao = inspecionarPfx(pfxBuffer, senha);
    if (!inspecao.ok) return { ok: false, erro: inspecao.erro };

    const amb = numero(input.ambiente) === 1 ? 1 : 2;
    const cnpjEmpresa = soDigitos(empresa.cnpj);
    if (amb === 1 && inspecao.cnpjExtraido && cnpjEmpresa && inspecao.cnpjExtraido !== cnpjEmpresa) {
      return {
        ok: false,
        erro: `O CNPJ do certificado (${inspecao.cnpjExtraido}) difere do CNPJ da empresa (${cnpjEmpresa}).`,
      };
    }

    const anterior = (empresa.fiscal ?? {}) as Record<string, unknown>;
    await removerPfxArmazenamento(anterior);

    const salvo = await salvarPfxArmazenamento({
      empresaId,
      cnpj: empresa.cnpj,
      pfxBuffer,
    });

    const titularFinal =
      texto(input.titular) ||
      inspecao.titularExtraido ||
      texto(input.nomeArquivo).replace(/\.(pfx|p12)$/i, "") ||
      `${empresa.nome} (A1)`;

    const validadeFinal = texto(input.validade) || String(anterior.certificadoValidade ?? "");
    const serialFinal = texto(input.serial) || String(anterior.certificadoSerial ?? `A1-${Date.now().toString(16).toUpperCase()}`);

    await db
      .update(empresas)
      .set({
        fiscal: {
          ...anterior,
          ambiente: amb,
          certificadoNome: titularFinal,
          certificadoValidade: validadeFinal,
          certificadoSerial: serialFinal,
          dfeAtivo: true,
          dfeCertPath: salvo.certPath,
          dfePfxCifrado: salvo.pfxCifradoFallback,
          dfeSenhaCifrada: cifrarSegredo(senha),
          dfeCertCnpj: inspecao.cnpjExtraido || cnpjEmpresa,
          dfeUltimoNsu: padNsu(String(anterior.dfeUltimoNsu ?? "0")),
          dfeMaxNsu: padNsu(String(anterior.dfeMaxNsu ?? "0")),
        },
      })
      .where(eq(empresas.id, empresaId));

    revalidarDfe();
    const destino = salvo.modo === "bucket" ? "bucket privado certificados-a1" : "cofre criptografado AES-256-GCM";
    return {
      ok: true,
      aviso: inspecao.aviso ?? `Certificado A1 validado e salvo no ${destino}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function removerCertificadoA1(bruto?: Record<string, unknown>): Promise<ResultadoDfe> {
  try {
    const { empresaId, empresa } = await exigirPermissao("config.gerenciar");
    corpo(bruto);
    const anterior = (empresa.fiscal ?? {}) as Record<string, unknown>;
    await removerPfxArmazenamento(anterior);

    await db
      .update(empresas)
      .set({
        fiscal: {
          ...anterior,
          dfeCertPath: "",
          dfePfxCifrado: null,
          dfeSenhaCifrada: null,
          dfeCertCnpj: "",
        },
      })
      .where(eq(empresas.id, empresaId));

    revalidarDfe();
    return { ok: true, aviso: "Arquivo .pfx e senha cifrada removidos com segurança." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function capturarDfeAgora(bruto?: { chave?: string }): Promise<ResultadoDfe> {
  try {
    const { empresa } = await exigirPermissao("fiscal.eventos");
    const input = corpo<{ chave?: string }>(bruto);
    const chaveBruta = soDigitos(texto(input.chave));
    if (chaveBruta) {
      if (chaveBruta.length !== 44) {
        return { ok: false, erro: "A chave de acesso deve ter exatamente 44 dígitos." };
      }
      if (!validarChaveAcesso(chaveBruta)) {
        return { ok: false, erro: "Dígito verificador da chave de acesso inválido." };
      }
    }

    const r = await executarCapturaDfeEmpresa(empresa, {
      chave: chaveBruta || undefined,
    });
    if (!r.ok) return r;

    revalidarDfe();
    return {
      ok: true,
      aviso: `SEFAZ [${r.modo.toUpperCase()}] cStat ${r.cStat}: ${r.novos} documento(s) novo(s) · NSU ${r.ultNSU}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function manifestarDocumentoDfe(bruto: {
  id?: string;
  manifesto?: string;
  justificativa?: string;
}): Promise<ResultadoDfe> {
  try {
    const { empresaId, empresa } = await exigirPermissao("fiscal.eventos");
    const input = corpo<{ id?: string; manifesto?: string; justificativa?: string }>(bruto);
    const id = texto(input.id);
    const manifestoId = texto(input.manifesto) as Exclude<StatusManifesto, "pendente" | "resumo">;
    const just = texto(input.justificativa);

    if (!id) return { ok: false, erro: "Selecione o documento DF-e para manifestar." };
    const cfg = MANIFESTOS_DFE.find((m) => m.id === manifestoId);
    if (!cfg) return { ok: false, erro: "Tipo de manifestação inválido." };
    if (cfg.exigeJustificativa && (just.length < 15 || just.length > 255)) {
      return {
        ok: false,
        erro: "Para desconhecimento ou operação não realizada, informe justificativa entre 15 e 255 caracteres.",
      };
    }

    const fiscal = (empresa.fiscal ?? {}) as Record<string, unknown>;
    const docs = lerDocumentosDfeFiscal(fiscal, false);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return { ok: false, erro: "Documento DF-e não encontrado nesta empresa." };

    const doc = docs[idx];
    const protocolo = `191${Date.now().toString().slice(-12)}`;
    const env = ambienteDfeServidor();
    const modoDemo = !(env.modoLiveSolicitado && fiscal.dfeSenhaCifrada && (env.workerConfigurado || env.modoEnv === "direct"));

    let xmlZipNovo = doc.xmlZip;
    let temXmlCompleto = doc.temXmlCompleto;
    let schemaNovo = doc.schema;

    // Em modo demo, ao registrar Ciência/Confirmação em um resNFe, libera o procNFe completo como na SEFAZ
    if (modoDemo && !doc.temXmlCompleto && (manifestoId === "ciencia" || manifestoId === "confirmada")) {
      const gerado = montarXmlNfeDemo({
        chave: doc.chave,
        ufDest: empresa.uf || "RO",
        cnpjDest: empresa.cnpj,
        nomeDest: empresa.nome,
        indice: Number(soDigitos(doc.nsu)) || 1,
        dataIso: doc.dataEmissao || hojeISO(),
      });
      xmlZipNovo = zipDocZip(gerado.xml);
      temXmlCompleto = true;
      schemaNovo = "procNFe_v4.00.xsd";
    }

    docs[idx] = {
      ...doc,
      schema: schemaNovo,
      temXmlCompleto,
      xmlZip: xmlZipNovo,
      statusManifesto: manifestoId,
      protocoloManifesto: protocolo,
      justificativaManifesto: just || undefined,
    };

    await db
      .update(empresas)
      .set({
        fiscal: {
          ...fiscal,
          dfeDocumentos: docs,
        },
      })
      .where(eq(empresas.id, empresaId));

    revalidarDfe();
    return {
      ok: true,
      aviso: `${cfg.rotulo} (${cfg.tpEvento}) registrada · protocolo ${protocolo}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function importarDfeParaEntrada(bruto: {
  id?: string;
  gerarFinanceiro?: boolean;
}): Promise<ResultadoDfe> {
  try {
    const { empresaId, empresa } = await exigirPermissao("estoque.ajustar");
    const input = corpo<{ id?: string; gerarFinanceiro?: boolean }>(bruto);
    const id = texto(input.id);
    if (!id) return { ok: false, erro: "Informe o documento DF-e para importar." };
    const gerarFin = input.gerarFinanceiro === undefined ? true : logico(input.gerarFinanceiro);

    const fiscal = (empresa.fiscal ?? {}) as Record<string, unknown>;
    const docs = lerDocumentosDfeFiscal(fiscal, false);
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) return { ok: false, erro: "Documento DF-e não encontrado." };

    const doc = docs[idx];
    if (!doc.temXmlCompleto || !doc.xmlZip) {
      return {
        ok: false,
        erro: "Este registro ainda é um resumo (resNFe). Registre Ciência da Operação para liberar o XML completo da NF-e.",
      };
    }

    const xml = unzipDocZip(doc.xmlZip);
    const nota = parseNfeXml(xml);
    const chaveFinal = nota.chave || doc.chave;

    if (chaveFinal) {
      const [existente] = await db
        .select({ id: entradas.id, status: entradas.status })
        .from(entradas)
        .where(and(eq(entradas.empresaId, empresaId), eq(entradas.chave, chaveFinal)))
        .limit(1);
      if (existente) {
        docs[idx] = { ...doc, importadoErp: true, entradaId: existente.id };
        await db
          .update(empresas)
          .set({ fiscal: { ...fiscal, dfeDocumentos: docs } })
          .where(eq(empresas.id, empresaId));
        revalidarDfe();
        return {
          ok: false,
          erro: `Esta NF-e (${nota.numero}) já consta em Entrada de mercadoria (${existente.status}).`,
        };
      }
    }

    const [ catalogo, forns ] = await Promise.all([
      db
        .select({
          id: produtos.id,
          nome: produtos.nome,
          sku: produtos.sku,
          gtin: produtos.gtin,
          preco: produtos.preco,
        })
        .from(produtos)
        .where(eq(produtos.empresaId, empresaId)),
      db
        .select({ id: fornecedores.id, cnpj: fornecedores.cnpj })
        .from(fornecedores)
        .where(eq(fornecedores.empresaId, empresaId)),
    ]);

    const cnpjEmit = soDigitos(nota.cnpjFornecedor);
    const fornAchado = forns.find((f) => soDigitos(f.cnpj) === cnpjEmit);

    const normal = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .trim();

    const itens: EntradaItem[] = nota.itens.map((i, pos) => {
      const alvo = normal(i.nome);
      const achado =
        catalogo.find((c) => i.gtin && i.gtin !== "SEM GTIN" && c.gtin === i.gtin) ??
        catalogo.find((c) => normal(c.nome) === alvo) ??
        catalogo.find((c) => alvo.length > 6 && normal(c.nome).startsWith(alvo.slice(0, 12)));
      const custo = round2(i.custo);
      return {
        produtoId: achado?.id ?? null,
        nome: achado?.nome ?? i.nome.toUpperCase(),
        nomeFornecedor: i.nome,
        sku: achado?.sku ?? `DF${String(Date.now()).slice(-6)}${pos}`,
        ncm: i.ncm || "00000000",
        cfop: i.cfop || "5102",
        unidade: i.unidade || "UN",
        gtin: i.gtin || "SEM GTIN",
        qtd: i.qtd,
        qtdNota: i.qtd,
        custo,
        preco: round2(achado?.preco ?? custo * 1.4),
      };
    });

    const totalItens = round2(itens.reduce((s, i) => s + i.qtd * i.custo, 0));
    const [nova] = await db
      .insert(entradas)
      .values({
        empresaId,
        numeroNota: nota.numero,
        serie: nota.serie,
        chave: chaveFinal,
        fornecedor: nota.fornecedor,
        cnpjFornecedor: nota.cnpjFornecedor,
        fornecedorId: fornAchado?.id ?? null,
        emissao: nota.emissao,
        valorProdutos: nota.valorProdutos || totalItens,
        valorFrete: nota.valorFrete,
        total: nota.total || round2(totalItens + nota.valorFrete),
        status: itens.every((i) => i.produtoId) ? "conferida" : "pendente",
        origem: "dfe",
        gerarFinanceiro: gerarFin,
        itens,
        observacao: `Capturada via Distribuição DF-e (NSU ${doc.nsu})`,
      })
      .returning({ id: entradas.id });

    docs[idx] = { ...doc, importadoErp: true, entradaId: nova.id };
    await db
      .update(empresas)
      .set({ fiscal: { ...fiscal, dfeDocumentos: docs } })
      .where(eq(empresas.id, empresaId));

    revalidarDfe();
    ["/financeiro", "/produtos"].forEach((p) => revalidatePath(p));

    const pendentes = itens.filter((i) => !i.produtoId).length;
    return {
      ok: true,
      id: doc.id,
      entradaId: nova.id,
      aviso: pendentes
        ? `NF-e ${nota.numero} enviada para Entrada de mercadoria (${pendentes} item(ns) aguardando vínculo).`
        : `NF-e ${nota.numero} importada e conferida (${itens.length} item(ns) vinculados automaticamente).`,
    };
  } catch (e) {
    return comoErro(e);
  }
}

export async function configurarAutomacaoDfe(bruto: {
  ativo?: boolean;
  reiniciarNsu?: boolean;
  ambiente?: number;
}): Promise<ResultadoDfe> {
  try {
    const { empresaId, empresa } = await exigirPermissao("config.gerenciar");
    const input = corpo<{ ativo?: boolean; reiniciarNsu?: boolean; ambiente?: number }>(bruto);
    const fiscal = (empresa.fiscal ?? {}) as Record<string, unknown>;

    const novoFiscal: Record<string, unknown> = { ...fiscal };
    if (input.ativo !== undefined) novoFiscal.dfeAtivo = logico(input.ativo);
    if (input.ambiente !== undefined) novoFiscal.ambiente = numero(input.ambiente) === 1 ? 1 : 2;
    if (logico(input.reiniciarNsu)) {
      novoFiscal.dfeUltimoNsu = "000000000000000";
      novoFiscal.dfeMaxNsu = "000000000000000";
      novoFiscal.dfeUltimoCstat = "";
      novoFiscal.dfeUltimoXmotivo = "NSU reiniciado manualmente";
    }

    await db.update(empresas).set({ fiscal: novoFiscal }).where(eq(empresas.id, empresaId));
    revalidarDfe();
    return {
      ok: true,
      aviso: logico(input.reiniciarNsu)
        ? "Ponteiro NSU reiniciado para 000000000000000."
        : "Preferências de automação DF-e atualizadas.",
    };
  } catch (e) {
    return comoErro(e);
  }
}
