/**
 * NKWAY — Motor Server-Side de Emissão Fiscal de Saída, Contingência e Webhook SEFAZ.
 * Integra o PDV e Documentos de Venda com provedores homologados (Focus NFe / Nuvem Fiscal / Fiscalo REST)
 * e com o modo Homologação Local, preservando 100% os segredos no servidor e a regra estrita de zero XML fictício.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { clientes, empresas, eventosFiscais, produtos, vendaItens, vendas } from "@/db/schema";
import { MODELO_NUMERO, UF_NUMERO, gerarChave, round2, soDigitos, validarChaveAcesso } from "@/lib/dominio";
import {
  diagnosticarPreValidacaoFiscal,
  montarPayloadEmissaoFiscal,
  type InsumoPreValidacaoFiscal,
  type ProvedorEmissorFiscal,
  type ResultadoPreValidacaoFiscal,
  type StatusSefazVenda,
} from "@/lib/emissorFiscal";
import { registrarAuditoria } from "@/server/auditoria";
import { xmlFiscalArmazenadoValido } from "@/server/exportacaoXmlCore";

export function diagnosticoEmissorServidor(): {
  provedor: ProvedorEmissorFiscal;
  modoLive: boolean;
  urlConfigurada: boolean;
  tokenConfigurado: boolean;
  webhookProtegido: boolean;
} {
  const url = (process.env.EMISSOR_FISCAL_URL || "").trim();
  const token = (process.env.EMISSOR_FISCAL_TOKEN || "").trim();
  const provRaw = (process.env.EMISSOR_FISCAL_PROVIDER || "").trim().toLowerCase();
  const whSecret = (process.env.EMISSOR_WEBHOOK_SECRET || "").trim();

  let provedor: ProvedorEmissorFiscal = "local";
  if (url) {
    if (provRaw === "focusnfe" || url.includes("focusnfe")) provedor = "focusnfe";
    else if (provRaw === "nuvemfiscal" || url.includes("nuvemfiscal")) provedor = "nuvemfiscal";
    else provedor = "webhook_custom";
  }

  return {
    provedor,
    modoLive: Boolean(url && token),
    urlConfigurada: Boolean(url),
    tokenConfigurado: Boolean(token),
    webhookProtegido: Boolean(whSecret || process.env.AUTH_SECRET),
  };
}

export async function montarInsumoFiscalDaVenda(
  empresaId: string,
  vendaId: string,
): Promise<{
  venda: typeof vendas.$inferSelect;
  empresa: typeof empresas.$inferSelect;
  insumo: InsumoPreValidacaoFiscal;
  validacao: ResultadoPreValidacaoFiscal;
  payload: ReturnType<typeof montarPayloadEmissaoFiscal>;
} | null> {
  const [[emp], [venda]] = await Promise.all([
    db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1),
    db.select().from(vendas).where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId))).limit(1),
  ]);
  if (!emp || !venda) return null;

  const [itensVenda, cliRow] = await Promise.all([
    db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id)),
    venda.clienteId
      ? db
          .select()
          .from(clientes)
          .where(and(eq(clientes.id, venda.clienteId), eq(clientes.empresaId, empresaId)))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const prodIds = itensVenda.map((i) => i.produtoId).filter((x): x is string => Boolean(x));
  const prodsRows = prodIds.length
    ? await db
        .select()
        .from(produtos)
        .where(and(eq(produtos.empresaId, empresaId), inArray(produtos.id, prodIds)))
    : [];
  const prodPorId = new Map(prodsRows.map((p) => [p.id, p]));

  const fiscalCfg = (emp.fiscal ?? {}) as Record<string, unknown>;
  const ambiente = (Number(fiscalCfg.ambiente ?? venda.ambiente ?? 2) === 1 ? 1 : 2) as 1 | 2;
  const modelo = (["NFC-e", "NF-e", "SAT"].includes(String(venda.modelo ?? "")) ? venda.modelo : "NFC-e") as
    | "NFC-e"
    | "NF-e"
    | "SAT";
  const serie = String(
    venda.serie ?? fiscalCfg[modelo === "NF-e" ? "serieNfe" : "serieNfce"] ?? "1",
  );
  const numeroNota = Number(venda.numeroNota ?? venda.numero);

  const pagsSalvos = (venda.pagamentos ?? []) as { forma: string; valor: number }[];
  const pagamentos =
    pagsSalvos.length > 0
      ? pagsSalvos.map((p) => ({ forma: p.forma, valor: round2(Number(p.valor)) }))
      : [{ forma: venda.formaPagamento || "dinheiro", valor: round2(Number(venda.total)) }];

  const insumo: InsumoPreValidacaoFiscal = {
    ambiente,
    modelo,
    serie,
    numeroNota,
    chave: venda.chave,
    emitente: {
      nome: emp.nome,
      fantasia: emp.nomeFantasia || emp.nome,
      cnpj: emp.cnpj,
      ie: emp.ie || "",
      uf: emp.uf,
      municipio: emp.municipio || "",
      codMunicipio: emp.codMunicipio || "",
      endereco: emp.endereco || "",
      numero: emp.numero || "",
      bairro: emp.bairro || "",
      cep: emp.cep || "",
      crt: Number(fiscalCfg.crt ?? (emp.regime === "mei" ? 4 : 1)),
      cscId: String(fiscalCfg.cscId ?? ""),
      cscToken: String(fiscalCfg.cscToken ?? ""),
      certificadoValidade: String(fiscalCfg.certificadoValidade ?? ""),
    },
    destinatario: {
      identificado: Boolean(cliRow && soDigitos(cliRow.documento).length >= 11),
      nome: cliRow?.nome || venda.clienteNome || "CONSUMIDOR",
      documento: cliRow?.documento || "",
      uf: cliRow?.uf || emp.uf,
      cidade: cliRow?.cidade || emp.municipio || "",
      cep: cliRow?.cep || "",
      logradouro: cliRow?.logradouro || "",
      numero: cliRow?.numero || "",
      bairro: cliRow?.bairro || "",
      indIe: cliRow?.indIe || "9",
    },
    itens: itensVenda.map((it, idx) => {
      const p = it.produtoId ? prodPorId.get(it.produtoId) : undefined;
      return {
        numeroItem: idx + 1,
        sku: p?.sku || `IT${idx + 1}`,
        nome: it.nome,
        ncm: p?.ncm || "00000000",
        cfop: p?.cfop || "5102",
        csosn: p?.csosn || "102",
        gtin: it.gtin || p?.gtin || "SEM GTIN",
        unidade: it.unidade || p?.unidade || "UN",
        qtd: Number(it.qtd),
        precoUnit: Number(it.precoUnit),
        total: Number(it.total),
        icmsAliq: Number(p?.icmsAliq ?? 0),
        pisAliq: Number(p?.pisAliq ?? 0),
        cofinsAliq: Number(p?.cofinsAliq ?? 0),
        ibsAliq: Number(p?.ibsAliq ?? 0.1),
        cbsAliq: Number(p?.cbsAliq ?? 0.9),
      };
    }),
    totais: {
      subtotal: round2(Number(venda.subtotal)),
      desconto: round2(Number(venda.desconto)),
      frete: round2(Number(venda.vFrete)),
      total: round2(Number(venda.total)),
    },
    pagamentos,
  };

  const validacao = diagnosticarPreValidacaoFiscal(insumo);
  const payload = montarPayloadEmissaoFiscal(insumo, venda.id);

  return { venda, empresa: emp, insumo, validacao, payload };
}

export type ResultadoTransmissaoSaida = {
  ok: boolean;
  statusSefaz: StatusSefazVenda;
  cstat: string;
  motivo: string;
  chave: string | null;
  protocolo: string | null;
  provedor: ProvedorEmissorFiscal;
  temXmlReal: boolean;
  bloqueios: ResultadoPreValidacaoFiscal["bloqueios"];
  alertas: ResultadoPreValidacaoFiscal["alertas"];
};

/**
 * Transmite (ou revalida em homologação local) uma venda fiscal de saída.
 * - Se houver bloqueio na pré-validação SEFAZ: grava `statusSefaz = "rejeitada"` com o código e motivo exatos.
 * - Se `EMISSOR_FISCAL_URL` + `EMISSOR_FISCAL_TOKEN` estiverem ativos: envia via HTTPS ao provedor;
 *   em caso de queda de rede, entra automaticamente em `contingencia` sem perder a venda!
 * - Só preenche `xml_fiscal` quando um XML fiscal real válido é retornado pelo emissor.
 */
export async function transmitirVendaParaEmissor(params: {
  empresaId: string;
  vendaId: string;
  usuario?: { id: string; nome: string; papel: string } | null;
  registrarNaAuditoria?: boolean;
}): Promise<ResultadoTransmissaoSaida> {
  const ctx = await montarInsumoFiscalDaVenda(params.empresaId, params.vendaId);
  if (!ctx) {
    throw new Error("Documento de venda não encontrado nesta empresa.");
  }
  const { venda, empresa, insumo, validacao, payload } = ctx;
  if (venda.tipo !== "fiscal") {
    throw new Error("DAV / orçamento não é transmitido à SEFAZ antes do faturamento.");
  }
  if (venda.status === "cancelado") {
    throw new Error("Documento cancelado não pode ser retransmitido.");
  }

  const diag = diagnosticoEmissorServidor();

  // Garante chave de 44 dígitos consistente caso ainda não exista
  const chaveBase =
    venda.chave && validarChaveAcesso(venda.chave)
      ? venda.chave
      : gerarChave({
          uf: UF_NUMERO[empresa.uf] ?? "11",
          aamm: `${String(new Date().getFullYear()).slice(2)}${String(new Date().getMonth() + 1).padStart(2, "0")}`,
          cnpj: empresa.cnpj,
          modelo: MODELO_NUMERO[insumo.modelo] ?? "65",
          serie: insumo.serie,
          numeroNota: insumo.numeroNota,
        });

  // 1. Falha na Pré-Validação SEFAZ antes de sair para a rede
  if (!validacao.aprovada) {
    const primeiro = validacao.bloqueios[0];
    const motivo = `Rejeição ${primeiro.codigoSefaz} (${primeiro.campo}): ${primeiro.mensagem}`;
    await db
      .update(vendas)
      .set({
        chave: chaveBase,
        statusSefaz: "rejeitada",
        cstatSefaz: primeiro.codigoSefaz,
        motivoSefaz: motivo.slice(0, 300),
        emissorProvedor: diag.provedor,
      })
      .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

    if (params.registrarNaAuditoria && params.usuario) {
      await registrarAuditoria({
        empresaId: params.empresaId,
        usuario: params.usuario,
        acao: "fiscal.rejeicao_prevalidacao",
        entidade: "venda",
        registroId: venda.id,
        resumo: `${insumo.modelo} ${insumo.numeroNota} retida na pré-validação (${motivo.slice(0, 140)})`,
        alteracoes: { cstat: primeiro.codigoSefaz, bloqueios: validacao.bloqueios },
      });
    }

    return {
      ok: false,
      statusSefaz: "rejeitada",
      cstat: primeiro.codigoSefaz,
      motivo,
      chave: chaveBase,
      protocolo: venda.protocolo,
      provedor: diag.provedor,
      temXmlReal: Boolean(venda.xmlFiscal && xmlFiscalArmazenadoValido(venda.xmlFiscal)),
      bloqueios: validacao.bloqueios,
      alertas: validacao.alertas,
    };
  }

  // 2. Modo Provedor Externo Homologado (Focus NFe / Nuvem Fiscal / Webhook Custom)
  if (diag.modoLive) {
    const urlBase = (process.env.EMISSOR_FISCAL_URL || "").trim().replace(/\/$/, "");
    const token = (process.env.EMISSOR_FISCAL_TOKEN || "").trim();
    const endpoint =
      diag.provedor === "focusnfe"
        ? `${urlBase}/v2/${insumo.modelo === "NF-e" ? "nfe" : "nfce"}?ref=${encodeURIComponent(venda.id)}`
        : `${urlBase}/emitir`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(diag.provedor === "focusnfe"
        ? { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` }
        : { Authorization: `Bearer ${token}` }),
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const cstat = String(json.cstat ?? json.status_sefaz ?? (res.ok ? "100" : "999"));
      const motivo = String(
        json.motivo ?? json.mensagem_sefaz ?? (res.ok ? "Autorizado o uso da NF-e" : `Erro HTTP ${res.status} no emissor`),
      );
      const chaveRet = soDigitos(String(json.chave ?? json.chave_nfe ?? ""));
      const chaveFinal = chaveRet.length === 44 && validarChaveAcesso(chaveRet) ? chaveRet : chaveBase;
      const protocoloFinal = String(json.protocolo ?? venda.protocolo ?? `1${UF_NUMERO[empresa.uf] ?? "11"}${Date.now().toString().slice(-12)}`);
      const xmlRet = String(json.xml ?? json.xml_nfe ?? "").trim();
      const xmlValido = xmlFiscalArmazenadoValido(xmlRet) ? xmlRet : venda.xmlFiscal;

      const autorizada = res.ok && (cstat === "100" || cstat === "150" || json.status === "autorizado");
      const emProcessamento = res.ok && (json.status === "processando_autorizacao" || cstat === "103");
      const novoStatusSefaz: StatusSefazVenda = autorizada
        ? "autorizada"
        : emProcessamento
          ? "pendente_envio"
          : "rejeitada";

      await db
        .update(vendas)
        .set({
          chave: chaveFinal,
          protocolo: protocoloFinal,
          protocoloOrigem: autorizada && protocoloFinal ? "autorizado_sefaz" : venda.protocoloOrigem,
          situacaoFiscal: autorizada
            ? "autorizada"
            : emProcessamento
              ? "pendente_transmissao"
              : "rejeitada",
          xmlFiscal: xmlValido,
          statusSefaz: novoStatusSefaz,
          cstatSefaz: cstat,
          motivoSefaz: motivo.slice(0, 300),
          emissorProvedor: diag.provedor,
          autorizadaEm: autorizada ? Date.now() : venda.autorizadaEm,
        })
        .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

      if (params.registrarNaAuditoria && params.usuario) {
        await registrarAuditoria({
          empresaId: params.empresaId,
          usuario: params.usuario,
          acao: autorizada ? "fiscal.autorizada" : "fiscal.transmissao_retorno",
          entidade: "venda",
          registroId: venda.id,
          resumo: `${insumo.modelo} ${insumo.numeroNota} [${diag.provedor}] → ${novoStatusSefaz} (cStat ${cstat}: ${motivo.slice(0, 120)})`,
          alteracoes: { provedor: diag.provedor, cstat, statusSefaz: novoStatusSefaz, temXml: Boolean(xmlValido) },
        });
      }

      return {
        ok: autorizada || emProcessamento,
        statusSefaz: novoStatusSefaz,
        cstat,
        motivo,
        chave: chaveFinal,
        protocolo: protocoloFinal,
        provedor: diag.provedor,
        temXmlReal: Boolean(xmlValido),
        bloqueios: [],
        alertas: validacao.alertas,
      };
    } catch (err) {
      // Queda de rede / timeout: coloca em contingência offline para retransmissão posterior sem travar o caixa!
      const msgRede = err instanceof Error ? err.message : String(err);
      const motivoCont = `Contingência offline: falha de comunicação com ${diag.provedor} (${msgRede.slice(0, 120)}). Pronta para retransmissão.`;

      await db
        .update(vendas)
        .set({
          chave: chaveBase,
          statusSefaz: "contingencia",
          cstatSefaz: "CONT",
          motivoSefaz: motivoCont,
          emissorProvedor: diag.provedor,
        })
        .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

      if (params.registrarNaAuditoria && params.usuario) {
        await registrarAuditoria({
          empresaId: params.empresaId,
          usuario: params.usuario,
          acao: "fiscal.contingencia",
          entidade: "venda",
          registroId: venda.id,
          resumo: `${insumo.modelo} ${insumo.numeroNota} registrada em contingência offline para retransmissão`,
          alteracoes: { provedor: diag.provedor, erroRede: msgRede.slice(0, 160) },
        });
      }

      return {
        ok: false,
        statusSefaz: "contingencia",
        cstat: "CONT",
        motivo: motivoCont,
        chave: chaveBase,
        protocolo: venda.protocolo,
        provedor: diag.provedor,
        temXmlReal: Boolean(venda.xmlFiscal),
        bloqueios: [],
        alertas: validacao.alertas,
      };
    }
  }

  // 3. Modo Homologação Local (sem provedor externo ligado) — pré-validação aprovada, zero XML fictício
  const protocoloSim =
    venda.protocolo || `1${UF_NUMERO[empresa.uf] ?? "11"}${Date.now().toString().padStart(14, "0").slice(-14)}`;
  const motivoSim =
    validacao.alertas.length > 0
      ? `Homologação simulada aprovada (${validacao.alertas.length} alerta(s) para produção: ${validacao.alertas[0].mensagem.slice(0, 120)})`
      : "Pré-validação 4.00 aprovada em homologação local (conecte EMISSOR_FISCAL_URL para autorização e XML SEFAZ)";

  await db
    .update(vendas)
    .set({
      chave: chaveBase,
      protocolo: protocoloSim,
      statusSefaz: "simulado",
      cstatSefaz: "100",
      motivoSefaz: motivoSim.slice(0, 300),
      emissorProvedor: "local",
      autorizadaEm: venda.autorizadaEm || Date.now(),
    })
    .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

  if (params.registrarNaAuditoria && params.usuario) {
    await registrarAuditoria({
      empresaId: params.empresaId,
      usuario: params.usuario,
      acao: "fiscal.validar_homologacao",
      entidade: "venda",
      registroId: venda.id,
      resumo: `${insumo.modelo} ${insumo.numeroNota} validada no motor fiscal 4.00 (${validacao.alertas.length} alerta(s))`,
      alteracoes: { cstat: "100", alertasCount: validacao.alertas.length },
    });
  }

  return {
    ok: true,
    statusSefaz: "simulado",
    cstat: "100",
    motivo: motivoSim,
    chave: chaveBase,
    protocolo: protocoloSim,
    provedor: "local",
    temXmlReal: Boolean(venda.xmlFiscal && xmlFiscalArmazenadoValido(venda.xmlFiscal)),
    bloqueios: [],
    alertas: validacao.alertas,
  };
}

/* ------------------------------------ Webhook Fiscal Assíncrono Autenticado */

export function verificarAutenticacaoWebhookFiscal(params: {
  corpoBruto: string;
  tokenHeader: string;
  assinaturaHmacHeader: string;
  authorizationHeader: string;
}): boolean {
  const segredoExplicito = (process.env.EMISSOR_WEBHOOK_SECRET || "").trim();
  const segredoHmac = (segredoExplicito || process.env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao").trim();

  const bearer = params.authorizationHeader.startsWith("Bearer ")
    ? params.authorizationHeader.slice(7).trim()
    : "";

  if (segredoExplicito && (params.tokenHeader === segredoExplicito || bearer === segredoExplicito)) {
    return true;
  }
  if (bearer && bearer === segredoHmac) return true;

  if (params.assinaturaHmacHeader) {
    const recebidoHex = params.assinaturaHmacHeader.includes("=")
      ? (params.assinaturaHmacHeader.split("v1=")[1]?.split(",")[0]?.trim() ?? "")
      : params.assinaturaHmacHeader.trim();
    const esperadoHex = createHmac("sha256", segredoHmac).update(params.corpoBruto).digest("hex");
    const a = Buffer.from(recebidoHex);
    const b = Buffer.from(esperadoHex);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  return false;
}

export type EventoWebhookFiscalInput = {
  referencia?: string;
  chave?: string;
  status: "autorizado" | "rejeitado" | "cancelado";
  cstat?: string;
  motivo?: string;
  protocolo?: string;
  xml?: string;
  provedor?: string;
};

export async function processarWebhookEmissorFiscal(
  ev: EventoWebhookFiscalInput,
): Promise<{ ok: true; acaoAplicada: string; vendaId: string; temXmlArmazenado: boolean } | { ok: false; erro: string }> {
  let venda = ev.referencia
    ? (await db.select().from(vendas).where(eq(vendas.id, ev.referencia)).limit(1))[0]
    : undefined;

  if (!venda && ev.chave) {
    const ch44 = soDigitos(ev.chave);
    if (ch44.length === 44) {
      venda = (
        await db
          .select()
          .from(vendas)
          .where(eq(vendas.chave, ch44))
          .orderBy(desc(vendas.data))
          .limit(1)
      )[0];
    }
  }

  if (!venda) {
    return { ok: false, erro: "Documento fiscal de venda não encontrado para a referência/chave informada." };
  }

  const chaveLimpa = soDigitos(ev.chave ?? "");
  const chaveFinal = chaveLimpa.length === 44 && validarChaveAcesso(chaveLimpa) ? chaveLimpa : venda.chave;
  const xmlRecebido = String(ev.xml ?? "").trim();
  const xmlValido = xmlFiscalArmazenadoValido(xmlRecebido) ? xmlRecebido : venda.xmlFiscal;
  const prov = (["focusnfe", "nuvemfiscal", "webhook_custom"].includes(String(ev.provedor ?? ""))
    ? ev.provedor
    : "webhook_custom") as ProvedorEmissorFiscal;

  if (ev.status === "autorizado") {
    if (venda.statusSefaz === "autorizada" && Boolean(venda.xmlFiscal) === Boolean(xmlValido)) {
      return {
        ok: true,
        acaoAplicada: "idempotente_ja_autorizada",
        vendaId: venda.id,
        temXmlArmazenado: Boolean(venda.xmlFiscal),
      };
    }

    const cstat = ev.cstat || "100";
    const motivo = (ev.motivo || "Autorizado o uso da NF-e via Webhook Fiscal").slice(0, 300);
    const protocolo = ev.protocolo || venda.protocolo || `191${Date.now().toString().slice(-12)}`;

    await db
      .update(vendas)
      .set({
        chave: chaveFinal,
        protocolo,
        protocoloOrigem: "autorizado_sefaz",
        situacaoFiscal: "autorizada",
        xmlFiscal: xmlValido,
        statusSefaz: "autorizada",
        cstatSefaz: cstat,
        motivoSefaz: motivo,
        emissorProvedor: prov,
        autorizadaEm: Date.now(),
      })
      .where(eq(vendas.id, venda.id));

    await registrarAuditoria({
      empresaId: venda.empresaId,
      usuario: { nome: `Webhook ${prov.toUpperCase()}`, papel: "sistema" },
      acao: "fiscal.webhook_autorizada",
      entidade: "venda",
      registroId: venda.id,
      resumo: `${venda.modelo ?? "NFC-e"} ${venda.numeroNota ?? venda.numero} autorizada pela SEFAZ (cStat ${cstat})${xmlValido ? " · XML real armazenado" : ""}`,
      alteracoes: { chave: chaveFinal, protocolo, cstat, temXml: Boolean(xmlValido) },
    });

    return {
      ok: true,
      acaoAplicada: "venda_autorizada",
      vendaId: venda.id,
      temXmlArmazenado: Boolean(xmlValido),
    };
  }

  if (ev.status === "rejeitado") {
    const cstat = ev.cstat || "999";
    const motivo = (ev.motivo || "Rejeitada pela SEFAZ no retorno do emissor").slice(0, 300);

    await db
      .update(vendas)
      .set({
        statusSefaz: "rejeitada",
        cstatSefaz: cstat,
        motivoSefaz: motivo,
        emissorProvedor: prov,
      })
      .where(eq(vendas.id, venda.id));

    await registrarAuditoria({
      empresaId: venda.empresaId,
      usuario: { nome: `Webhook ${prov.toUpperCase()}`, papel: "sistema" },
      acao: "fiscal.webhook_rejeitada",
      entidade: "venda",
      registroId: venda.id,
      resumo: `${venda.modelo ?? "NFC-e"} ${venda.numeroNota ?? venda.numero} rejeitada (cStat ${cstat}: ${motivo.slice(0, 120)})`,
      alteracoes: { cstat, motivo },
    });

    return {
      ok: true,
      acaoAplicada: "venda_rejeitada",
      vendaId: venda.id,
      temXmlArmazenado: Boolean(venda.xmlFiscal),
    };
  }

  if (ev.status === "cancelado") {
    const cstat = ev.cstat || "135";
    const motivo = (ev.motivo || "Cancelamento homologado pela SEFAZ (evento 110111)").slice(0, 300);
    const protocolo = ev.protocolo || venda.protocolo || `135${Date.now().toString().slice(-12)}`;

    await db
      .update(vendas)
      .set({
        status: "cancelado",
        statusSefaz: "cancelada_sefaz",
        cstatSefaz: cstat,
        motivoSefaz: motivo,
        xmlFiscal: xmlValido,
      })
      .where(eq(vendas.id, venda.id));

    const jaTemEvt = await db
      .select({ id: eventosFiscais.id })
      .from(eventosFiscais)
      .where(and(eq(eventosFiscais.vendaId, venda.id), eq(eventosFiscais.tipo, "cancelamento")))
      .limit(1);

    if (jaTemEvt.length === 0) {
      await db.insert(eventosFiscais).values({
        empresaId: venda.empresaId,
        vendaId: venda.id,
        chave: chaveFinal || "",
        tipo: "cancelamento",
        sequencia: 1,
        descricao: motivo,
        protocolo,
      });
    }

    await registrarAuditoria({
      empresaId: venda.empresaId,
      usuario: { nome: `Webhook ${prov.toUpperCase()}`, papel: "sistema" },
      acao: "fiscal.webhook_cancelada",
      entidade: "venda",
      registroId: venda.id,
      resumo: `Cancelamento SEFAZ (evento 110111) homologado para ${venda.modelo ?? "NFC-e"} ${venda.numeroNota ?? venda.numero}`,
      alteracoes: { cstat, protocolo },
    });

    return {
      ok: true,
      acaoAplicada: "venda_cancelada",
      vendaId: venda.id,
      temXmlArmazenado: Boolean(xmlValido),
    };
  }

  return { ok: false, erro: "Status de webhook fiscal inválido." };
}
