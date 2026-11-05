/**
 * NKWAY — Motor Puro de Pré-Validação SEFAZ e Payload Fiscal NF-e / NFC-e 4.00.
 * Detecta rejeições reais da SEFAZ antes da transmissão e monta o contrato canônico
 * compatível com emissores REST homologados (Focus NFe, Nuvem Fiscal, Fiscalo / Webhook).
 */
import {
  FORMAS_PAGAMENTO,
  MODELO_NUMERO,
  UF_NUMERO,
  UFS,
  documentoValido,
  round2,
  soDigitos,
  tipoDocumento,
  validarCnpj,
  validarGtin,
} from "@/lib/dominio";
import { CST_ICMS_FISCAIS, validarParametrosTributarios, validarRegimeTributario, type ParametrosTributarios } from "@/lib/tributacao";

export type ProvedorEmissorFiscal = "local" | "focusnfe" | "nuvemfiscal" | "webhook_custom";

export type StatusSefazVenda =
  | "simulado"
  | "pendente_envio"
  | "contingencia"
  | "autorizada"
  | "rejeitada"
  | "cancelada_sefaz";

export const ROTULO_STATUS_SEFAZ: Record<
  StatusSefazVenda,
  { rotulo: string; tom: "ok" | "info" | "alerta" | "erro" | "neutro" | "roxo" }
> = {
  autorizada: { rotulo: "Autorizada SEFAZ", tom: "ok" },
  simulado: { rotulo: "Homologação local", tom: "info" },
  pendente_envio: { rotulo: "Pendente envio", tom: "alerta" },
  contingencia: { rotulo: "Contingência offline", tom: "roxo" },
  rejeitada: { rotulo: "Rejeitada SEFAZ", tom: "erro" },
  cancelada_sefaz: { rotulo: "Cancelada (110111)", tom: "neutro" },
};

export const ROTULO_PROVEDOR_FISCAL: Record<ProvedorEmissorFiscal, string> = {
  local: "Homologação Local (Simulador)",
  focusnfe: "Focus NFe API v2",
  nuvemfiscal: "Nuvem Fiscal API",
  webhook_custom: "Emissor Homologado REST (Fiscalo / Custom)",
};

export type RegraFiscalAchado = {
  codigoSefaz: string;
  severidade: "bloqueio" | "alerta";
  campo: string;
  mensagem: string;
};

export type InsumoPreValidacaoFiscal = {
  ambiente: 1 | 2;
  modelo: "NFC-e" | "NF-e" | "SAT";
  serie: string;
  numeroNota: number;
  chave: string | null;
  emitente: {
    nome: string;
    fantasia?: string;
    cnpj: string;
    ie: string;
    uf: string;
    municipio: string;
    codMunicipio: string;
    endereco: string;
    numero: string;
    bairro: string;
    cep: string;
    crt: number;
    cscId: string;
    cscToken: string;
    certificadoValidade: string;
  };
  destinatario: {
    identificado: boolean;
    nome: string;
    documento: string;
    uf: string;
    cidade: string;
    cep: string;
    logradouro: string;
    numero: string;
    bairro: string;
    indIe: string;
  };
  itens: {
    numeroItem: number;
    sku: string;
    nome: string;
    ncm: string;
    cfop: string;
    csosn: string;
    gtin: string;
    unidade: string;
    qtd: number;
    precoUnit: number;
    total: number;
    icmsAliq: number;
    pisAliq: number;
    cofinsAliq: number;
    ibsAliq: number;
    cbsAliq: number;
    /** Complemento opcional, explicitamente cadastrado para o produto. */
    tributacao?: ParametrosTributarios | null;
  }[];
  totais: {
    subtotal: number;
    desconto: number;
    frete: number;
    total: number;
  };
  pagamentos: { forma: string; valor: number }[];
};

export type ResultadoPreValidacaoFiscal = {
  aprovada: boolean;
  bloqueios: RegraFiscalAchado[];
  alertas: RegraFiscalAchado[];
};

const CSOSN_VALIDOS = new Set(["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"]);

export function codigoTpagSefaz(forma: string): string {
  return FORMAS_PAGAMENTO.find((f) => f.id === forma)?.tPag ?? "99";
}

/**
 * Executa pré-validação técnica contra as regras de rejeição da NF-e / NFC-e 4.00.
 * Em ambiente 1 (Produção), exigências cadastrais viram bloqueios estritos;
 * em ambiente 2 (Homologação), cadastros simplificados geram alertas educativos sem travar testes de PDV.
 */
export function diagnosticarPreValidacaoFiscal(input: InsumoPreValidacaoFiscal): ResultadoPreValidacaoFiscal {
  const bloqueios: RegraFiscalAchado[] = [];
  const alertas: RegraFiscalAchado[] = [];
  const emProducao = input.ambiente === 1;

  const add = (codigoSefaz: string, severidade: "bloqueio" | "alerta", campo: string, mensagem: string) => {
    const item: RegraFiscalAchado = { codigoSefaz, severidade, campo, mensagem };
    if (severidade === "bloqueio") bloqueios.push(item);
    else alertas.push(item);
  };

  /* ---------------- 1. Emitente ---------------- */
  if (!validarCnpj(input.emitente.cnpj)) {
    add("207", "bloqueio", "emit.CNPJ", "CNPJ do emitente inválido (verifique os 14 dígitos e o DV em Configurações).");
  }
  const ufEmit = (input.emitente.uf || "").toUpperCase();
  if (!UFS[ufEmit] || !UF_NUMERO[ufEmit]) {
    add("226", "bloqueio", "emit.UF", "UF do emitente inválida ou não suportada pela tabela IBGE.");
  }
  if (!/^\d{7}$/.test(soDigitos(input.emitente.codMunicipio))) {
    add(
      "270",
      emProducao ? "bloqueio" : "alerta",
      "emit.cMun",
      "Código IBGE do município do emitente deve ter exatamente 7 dígitos.",
    );
  }
  if (![1, 2, 3, 4].includes(Number(input.emitente.crt))) {
    add("481", "bloqueio", "emit.CRT", "Código de Regime Tributário (CRT) deve ser 1, 2, 3 ou 4.");
  }
  if (!/^\d{1,3}$/.test(String(input.serie || ""))) {
    add("205", "bloqueio", "ide.serie", "Série fiscal deve conter de 1 a 3 dígitos numéricos.");
  }

  if (input.modelo === "NFC-e") {
    if (!String(input.emitente.cscId || "").trim() || !String(input.emitente.cscToken || "").trim()) {
      add(
        "462",
        emProducao ? "bloqueio" : "alerta",
        "infNFeSupl.qrCode",
        "CSC ID / CSC Token não configurados para assinatura do QR Code da NFC-e.",
      );
    }
  }

  if (input.emitente.certificadoValidade) {
    const dtVal = new Date(`${input.emitente.certificadoValidade.slice(0, 10)}T23:59:59`);
    if (!Number.isNaN(dtVal.getTime()) && dtVal < new Date()) {
      add(
        "291",
        emProducao ? "bloqueio" : "alerta",
        "Certificado A1",
        `Certificado Digital A1 expirado em ${input.emitente.certificadoValidade}.`,
      );
    }
  } else if (emProducao) {
    add("290", "bloqueio", "Certificado A1", "Produção exige Certificado Digital A1 válido configurado.");
  }

  /* ---------------- 2. Destinatário ---------------- */
  const docDest = soDigitos(input.destinatario.documento);
  const ufDest = (input.destinatario.uf || ufEmit).toUpperCase();

  if (input.modelo === "NF-e") {
    if (!docDest || !documentoValido(docDest)) {
      add(
        "208",
        "bloqueio",
        "dest.CPF/CNPJ",
        "NF-e (modelo 55) exige cliente identificado com CPF ou CNPJ válido.",
      );
    }
    if (soDigitos(input.destinatario.cep).length !== 8 || !input.destinatario.logradouro.trim() || !input.destinatario.cidade.trim()) {
      add(
        "728",
        emProducao ? "bloqueio" : "alerta",
        "dest.enderDest",
        "NF-e (modelo 55) exige endereço completo do destinatário (CEP 8 dígitos, logradouro e município).",
      );
    }
    if (!["1", "2", "9"].includes(String(input.destinatario.indIe || "9"))) {
      add("732", "bloqueio", "dest.indIEDest", "Indicador de IE do destinatário deve ser 1, 2 ou 9.");
    }
  } else if (input.modelo === "NFC-e") {
    if (input.totais.total >= 10_000 && (!docDest || !documentoValido(docDest))) {
      add(
        "750",
        "bloqueio",
        "dest.CPF/CNPJ",
        "NFC-e com valor igual ou superior a R$ 10.000,00 exige identificação de CPF ou CNPJ do consumidor.",
      );
    } else if (docDest && !documentoValido(docDest)) {
      add("209", "bloqueio", "dest.CPF/CNPJ", "CPF/CNPJ informado para o consumidor possui dígito verificador inválido.");
    }
  }

  /* ---------------- 3. Itens e Impostos ---------------- */
  if (input.itens.length === 0) {
    add("225", "bloqueio", "det", "O documento fiscal deve possuir ao menos 1 item.");
  }

  const interestadual = Boolean(ufDest && ufEmit && ufDest !== ufEmit && input.modelo === "NF-e");

  for (const it of input.itens) {
    const ncm = soDigitos(it.ncm);
    if (ncm.length !== 8) {
      add("778", "bloqueio", `det[${it.numeroItem}].NCM`, `Item "${it.nome}": NCM deve ter 8 dígitos.`);
    } else if (ncm === "00000000") {
      add(
        "778",
        emProducao ? "bloqueio" : "alerta",
        `det[${it.numeroItem}].NCM`,
        `Item "${it.nome}": NCM genérico 00000000 é aceito só em homologação/serviço; informe a tabela TIPI real para produção.`,
      );
    }

    const cfop = soDigitos(it.cfop);
    if (cfop.length !== 4) {
      add("733", "bloqueio", `det[${it.numeroItem}].CFOP`, `Item "${it.nome}": CFOP deve ter 4 dígitos.`);
    } else if (input.modelo === "NFC-e" && !cfop.startsWith("5")) {
      add("725", "bloqueio", `det[${it.numeroItem}].CFOP`, `Item "${it.nome}": NFC-e só permite operação interna (CFOP iniciado em 5).`);
    } else if (interestadual && cfop.startsWith("5")) {
      add(
        "523",
        emProducao ? "bloqueio" : "alerta",
        `det[${it.numeroItem}].CFOP`,
        `Item "${it.nome}": operação interestadual (${ufEmit} → ${ufDest}) exige CFOP iniciado em 6.`,
      );
    }

    const complemento = it.tributacao;
    const usaCst = complemento?.tipoIcms === "cst";
    if (complemento) {
      const formato = validarParametrosTributarios(complemento);
      if (!formato.ok) add("NKWAY-PARAM", "bloqueio", `det[${it.numeroItem}].imposto`, `Item "${it.nome}": ${formato.erro}`);
      const incompatibilidade = validarRegimeTributario(complemento, input.emitente.crt);
      if (incompatibilidade) add("NKWAY-CRT", "bloqueio", `det[${it.numeroItem}].ICMS`, `Item "${it.nome}": ${incompatibilidade}`);
      if (Boolean(complemento.cstIbsCbs) !== Boolean(complemento.classTrib)) add("NKWAY-IBSCBS", emProducao ? "bloqueio" : "alerta", `det[${it.numeroItem}].IBSCBS`, `Item "${it.nome}": informe e revise CST IBS/CBS e cClassTrib em conjunto.`);
    }
    if (usaCst && !(CST_ICMS_FISCAIS as readonly string[]).includes(complemento?.cstIcms ?? "")) add("NKWAY-CST", "bloqueio", `det[${it.numeroItem}].ICMS`, `Item "${it.nome}": CST ICMS não reconhecido.`);
    if ((input.emitente.crt === 1 || input.emitente.crt === 4) && !usaCst && !CSOSN_VALIDOS.has(String(it.csosn || ""))) {
      add("590", "bloqueio", `det[${it.numeroItem}].CSOSN`, `Item "${it.nome}": CSOSN "${it.csosn}" inválido para Simples Nacional / MEI.`);
    }
    if ([2, 3].includes(input.emitente.crt) && (!usaCst || !complemento?.cstIcms)) add("NKWAY-CST", emProducao ? "bloqueio" : "alerta", `det[${it.numeroItem}].ICMS`, `Item "${it.nome}": CST ICMS não parametrizado para o CRT informado. Revise o produto antes da operação fiscal.`);
    if (input.emitente.crt === 3 && !complemento?.cstIbsCbs && !complemento?.classTrib) add("NKWAY-IBSCBS-AUSENTE", "alerta", `det[${it.numeroItem}].IBSCBS`, `Item "${it.nome}": CST IBS/CBS e cClassTrib não informados. Verifique a obrigatoriedade e a configuração com a contabilidade.`);
    if (!complemento?.origem) add("NKWAY-ORIGEM", "alerta", `det[${it.numeroItem}].orig`, `Item "${it.nome}": origem não cadastrada; o contrato legado utiliza origem 0. Revise antes da operação fiscal.`);

    if (it.gtin && it.gtin !== "SEM GTIN" && !validarGtin(it.gtin)) {
      add("883", "bloqueio", `det[${it.numeroItem}].cEAN`, `Item "${it.nome}": GTIN "${it.gtin}" possui dígito verificador inválido.`);
    }

    if (!(it.qtd > 0) || it.precoUnit < 0) {
      add("629", "bloqueio", `det[${it.numeroItem}].vProd`, `Item "${it.nome}": quantidade deve ser positiva e valor unitário não negativo.`);
    }
  }

  /* ---------------- 4. Fechamento Aritmético e Pagamentos ---------------- */
  const somaItens = round2(input.itens.reduce((s, i) => s + round2(i.qtd * i.precoUnit), 0));
  const totalCalculado = round2(somaItens - round2(input.totais.desconto) + round2(input.totais.frete));
  if (Math.abs(totalCalculado - round2(input.totais.total)) > 0.03) {
    add(
      "610",
      "bloqueio",
      "ICMSTot.vNF",
      `Total da NF (${input.totais.total.toFixed(2)}) difere de itens − desconto + frete (${totalCalculado.toFixed(2)}).`,
    );
  }

  const somaPag = round2(input.pagamentos.reduce((s, p) => s + round2(p.valor), 0));
  if (input.pagamentos.length === 0 || somaPag + 0.01 < round2(input.totais.total)) {
    add(
      "866",
      "bloqueio",
      "pag.detPag",
      `Soma dos pagamentos (R$ ${somaPag.toFixed(2)}) é inferior ao total da nota (R$ ${input.totais.total.toFixed(2)}).`,
    );
  }

  return {
    aprovada: bloqueios.length === 0,
    bloqueios,
    alertas,
  };
}

/** Monta o contrato JSON estruturado NF-e / NFC-e 4.00 para envio ao provedor homologado */
export function montarPayloadEmissaoFiscal(input: InsumoPreValidacaoFiscal, referenciaVendaId: string) {
  const somaPag = round2(input.pagamentos.reduce((s, p) => s + round2(p.valor), 0));
  const troco = round2(Math.max(0, somaPag - round2(input.totais.total)));
  const docDest = soDigitos(input.destinatario.documento);
  const tipoDoc = tipoDocumento(docDest);

  return {
    referencia: referenciaVendaId,
    versaoLayout: "4.00",
    ambiente: input.ambiente,
    modelo: MODELO_NUMERO[input.modelo] ?? "65",
    modeloRotulo: input.modelo,
    serie: Number(input.serie || 1),
    numero: input.numeroNota,
    chaveSugerida: input.chave,
    naturezaOperacao: "VENDA DE MERCADORIA",
    dataEmissao: new Date().toISOString(),
    presencaComprador: input.modelo === "NFC-e" ? 1 : 9,
    emitente: {
      cnpj: soDigitos(input.emitente.cnpj),
      razaoSocial: input.emitente.nome,
      nomeFantasia: input.emitente.fantasia || input.emitente.nome,
      inscricaoEstadual: soDigitos(input.emitente.ie) || "ISENTO",
      crt: input.emitente.crt,
      uf: input.emitente.uf,
      codigoMunicipioIbge: soDigitos(input.emitente.codMunicipio),
      municipio: input.emitente.municipio,
      logradouro: input.emitente.endereco || "NAO INFORMADO",
      numero: input.emitente.numero || "S/N",
      bairro: input.emitente.bairro || "CENTRO",
      cep: soDigitos(input.emitente.cep),
    },
    destinatario:
      tipoDoc === "cpf" || tipoDoc === "cnpj"
        ? {
            [tipoDoc]: docDest,
            nome: input.ambiente === 2 ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : input.destinatario.nome,
            indicadorIe: Number(input.destinatario.indIe || 9),
            uf: input.destinatario.uf || input.emitente.uf,
            municipio: input.destinatario.cidade || input.emitente.municipio,
            cep: soDigitos(input.destinatario.cep),
            logradouro: input.destinatario.logradouro,
            numero: input.destinatario.numero || "S/N",
            bairro: input.destinatario.bairro,
          }
        : null,
    itens: input.itens.map((it) => ({
      numeroItem: it.numeroItem,
      codigoProduto: it.sku || `ITEM-${it.numeroItem}`,
      descricao:
        input.ambiente === 2 && it.numeroItem === 1 && input.modelo === "NFC-e"
          ? "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"
          : it.nome,
      codigoBarrasGtin: it.gtin || "SEM GTIN",
      ncm: soDigitos(it.ncm).padEnd(8, "0").slice(0, 8),
      ...(it.tributacao?.cest ? { cest: it.tributacao.cest } : {}),
      cfop: soDigitos(it.cfop).padEnd(4, "5102").slice(0, 4),
      unidadeComercial: it.unidade || "UN",
      quantidadeComercial: round2(it.qtd * 1000) / 1000,
      valorUnitarioComercial: round2(it.precoUnit),
      valorBruto: round2(it.qtd * it.precoUnit),
      impostos: {
        origem: it.tributacao?.origem && /^[0-8]$/.test(it.tributacao.origem) ? Number(it.tributacao.origem) : 0,
        ...(it.tributacao?.tipoIcms === "cst" && it.tributacao.cstIcms ? { cstIcms: it.tributacao.cstIcms } : { csosn: it.csosn || "102" }),
        icmsAliquota: round2(it.icmsAliq),
        pisAliquota: round2(it.pisAliq),
        cofinsAliquota: round2(it.cofinsAliq),
        ...(it.tributacao?.cstPis ? { cstPis: it.tributacao.cstPis } : {}),
        ...(it.tributacao?.cstCofins ? { cstCofins: it.tributacao.cstCofins } : {}),
        ...(it.tributacao?.cstIpi ? { cstIpi: it.tributacao.cstIpi } : {}),
        ...(it.tributacao?.ipiAliq ? { ipiAliquota: Number(it.tributacao.ipiAliq) } : {}),
        ...(it.tributacao?.icmsStAliq ? { icmsStAliquota: Number(it.tributacao.icmsStAliq) } : {}),
        ...(it.tributacao?.fcpAliq ? { fcpAliquota: Number(it.tributacao.fcpAliq) } : {}),
        ...(it.tributacao?.beneficioFiscal ? { beneficioFiscal: it.tributacao.beneficioFiscal } : {}),
        reformaTributaria2026: {
          ...(it.tributacao?.cstIbsCbs ? { cst: it.tributacao.cstIbsCbs } : {}),
          ...(it.tributacao?.classTrib ? { cClassTrib: it.tributacao.classTrib } : {}),
          ibsAliquotaTeste: round2(it.ibsAliq),
          cbsAliquotaTeste: round2(it.cbsAliq),
          valorIbsEstimado: round2((it.total * it.ibsAliq) / 100),
          valorCbsEstimado: round2((it.total * it.cbsAliq) / 100),
        },
      },
    })),
    totais: {
      valorProdutos: round2(input.totais.subtotal),
      valorDesconto: round2(input.totais.desconto),
      valorFrete: round2(input.totais.frete),
      valorTotalNota: round2(input.totais.total),
      valorTroco: troco,
    },
    pagamentos: input.pagamentos.map((p) => ({
      formaInterna: p.forma,
      meioPagamentoSefaz: codigoTpagSefaz(p.forma),
      valor: round2(p.valor),
    })),
  };
}

/**
 * Verifica a janela legal padrão da SEFAZ para cancelamento extemporâneo/normal:
 * - NFC-e (modelo 65): 30 minutos após autorização
 * - NF-e (modelo 55): 24 horas (1.440 minutos) após autorização
 */
export function verificarPrazoLegalCancelamento(params: {
  modelo: string | null | undefined;
  autorizadaEm: number | null | undefined;
  agoraMs?: number;
}): {
  dentroDoPrazo: boolean;
  limiteMinutos: number;
  decorridoMinutos: number;
  rotuloLimite: string;
} {
  const ehNfe55 = params.modelo === "NF-e";
  const limiteMinutos = ehNfe55 ? 24 * 60 : 30;
  const rotuloLimite = ehNfe55 ? "24 horas (NF-e 55)" : "30 minutos (NFC-e 65)";
  if (!params.autorizadaEm || params.autorizadaEm <= 0) {
    return { dentroDoPrazo: true, limiteMinutos, decorridoMinutos: 0, rotuloLimite };
  }
  const agora = params.agoraMs ?? Date.now();
  const decorridoMinutos = Math.max(0, Math.floor((agora - params.autorizadaEm) / 60_000));
  return {
    dentroDoPrazo: decorridoMinutos <= limiteMinutos,
    limiteMinutos,
    decorridoMinutos,
    rotuloLimite,
  };
}
