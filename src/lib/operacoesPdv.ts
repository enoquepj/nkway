/**
 * NKWAY — Operações de Pós-Venda, Bobina Térmica 80 mm, Gaveta Rápida,
 * Carregamento/Cancelamento de Documentos (F3) e Inspetor de Fila Offline (Complemento PDV 3 de 3).
 *
 * Módulo 100% puro e tipado, compartilhado entre a Frente de Caixa (`src/views/Pdv.tsx`),
 * o Console do Dev (`src/server/diagnostico.ts`) e as suítes automatizadas.
 */

import {
  normalizarTextoBalcaoPdv,
  suspenderVendaParaEsperaPdv,
  type ProdutoBalcaoPdv,
  type RascunhoVendaAtivaPdv,
  type VendaEmEsperaPdv,
} from "@/lib/balcaoPdv";
import type { DocFiscal } from "@/lib/danfe";
import { FORMAS_PAGAMENTO, formatChave, moeda, rotuloForma, round2, tributosEstimados } from "@/lib/dominio";
import { verificarPrazoLegalCancelamento } from "@/lib/emissorFiscal";
import { normalizarQtdPdv, type LinhaItemPdv } from "@/lib/multiplicadorPdv";
import { lerValorMonetarioPdv, type ParcelaPagamentoPdv } from "@/lib/pagamentoPdv";
import type { ProtocoloOrigemVenda, SituacaoFiscalVenda } from "@/lib/situacaoFiscal";

export const MIN_MOTIVO_CANCELAMENTO_PDV = 15;
export const MAX_MOTIVO_CANCELAMENTO_PDV = 255;
export const MIN_MOTIVO_GAVETA_PDV = 3;

export const SUGESTOES_MOTIVO_GAVETA_PDV: Record<"suprimento" | "sangria", readonly string[]> = {
  suprimento: [
    "Reforço de fundo de troco em moedas e cédulas",
    "Suprimento operacional da tesouraria",
    "Troco complementar para abertura de movimento",
  ],
  sangria: [
    "Sangria de segurança para o cofre",
    "Retirada de excesso de numerário da gaveta",
    "Pagamento de despesa operacional autorizada",
  ],
};

/* ------------------------------------------- 1. Recibo Térmico 80 mm (Pós-Venda e Reimpressão F3) */

export type ItemReciboTermicoPdv = {
  numero: number;
  nome: string;
  qtd: number;
  unidade: string;
  precoUnit: number;
  total: number;
  /** Etapa 1 PDV/impressão: desconto/acréscimo do item (opcional, só exibe se > 0). */
  desconto?: number;
  acrescimo?: number;
};

export type ItemCanceladoPdv = {
  nome: string;
  qtd: number;
  unidade: string;
  total: number;
  motivo?: string;
};

export type ReciboTermicoPdv = {
  id: string;
  tipo: "fiscal" | "sem_nota" | "dav";
  status: string;
  numeroVenda: number;
  numeroNota: number | null;
  serie: string;
  modelo: "NFC-e" | "NF-e" | "SAT" | null;
  tituloBobina: string;
  subtituloBobina: string;
  documentoRotulo: string;
  dataIso: string;
  operador: string;
  terminal: string;
  ambiente: "1" | "2";
  clienteNome: string;
  clienteDocumento: string;
  itens: ItemReciboTermicoPdv[];
  qtdLinhas: number;
  unidadesTotais: number;
  subtotal: number;
  desconto: number;
  frete: number;
  total: number;
  parcelas: { forma: string; rotulo: string; valor: number }[];
  formaPrincipal: string;
  troco: number;
  tributosTotal: number;
  ibsEstimado: number;
  cbsEstimado: number;
  situacaoFiscal: SituacaoFiscalVenda;
  chave: string | null;
  chaveFormatada: string | null;
  protocolo: string | null;
  avisoFiscal: string;
  validadeDav: string | null;
  /** Etapa 1 PDV/impressão: itens removidos no caixa (só impressos se a config permitir). */
  itensCancelados?: ItemCanceladoPdv[];
};

function calcularTributosRecibo(total: number) {
  const trib = tributosEstimados(round2(Math.max(0, total)), {
    icms: 0,
    pis: 0,
    cofins: 0,
    ibs: 0.1,
    cbs: 0.9,
  });
  return {
    tributosTotal: trib.total,
    ibsEstimado: trib.itens[3]?.valor ?? 0,
    cbsEstimado: trib.itens[4]?.valor ?? 0,
  };
}

function resolverCabecalhoEAvisoFiscal(params: {
  tipo: "fiscal" | "sem_nota" | "dav";
  status: string;
  modelo: string | null;
  situacaoFiscal: SituacaoFiscalVenda;
  chave: string | null;
  protocolo: string | null;
  validadeDav: string | null;
}): {
  tituloBobina: string;
  subtituloBobina: string;
  chave: string | null;
  chaveFormatada: string | null;
  protocolo: string | null;
  avisoFiscal: string;
} {
  if (params.status === "cancelado" || params.situacaoFiscal === "cancelada") {
    return {
      tituloBobina: "DOCUMENTO CANCELADO / ESTORNADO",
      subtituloBobina: "Comprovante de cancelamento — sem validade fiscal para circulação",
      chave: params.chave,
      chaveFormatada: params.chave ? formatChave(params.chave) : null,
      protocolo: params.protocolo,
      avisoFiscal: "Operação cancelada e estornada no caixa e estoque.",
    };
  }

  if (params.tipo === "dav") {
    return {
      tituloBobina: "DAV — PRÉ-VENDA / ORÇAMENTO",
      subtituloBobina: "Documento Auxiliar de Venda — NÃO É DOCUMENTO FISCAL",
      chave: null,
      chaveFormatada: null,
      protocolo: null,
      avisoFiscal: params.validadeDav
        ? `Pré-venda sem baixa de estoque · Validade ${params.validadeDav}.`
        : "Pré-venda sem baixa de estoque e sem valor fiscal.",
    };
  }

  if (params.tipo === "sem_nota") {
    return {
      tituloBobina: "RECIBO DE VENDA — CONTROLE INTERNO",
      subtituloBobina: "Comprovante não fiscal — emissão de NFC-e disponível em Documentos (F3)",
      chave: null,
      chaveFormatada: null,
      protocolo: null,
      avisoFiscal: "Venda concluída sem emissão fiscal imediata.",
    };
  }

  const mod = params.modelo || "NFC-e";
  if (params.situacaoFiscal === "autorizada" && params.chave && params.protocolo) {
    return {
      tituloBobina: `EXTRATO ${mod} — AUTORIZADA SEFAZ`,
      subtituloBobina: "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica",
      chave: params.chave,
      chaveFormatada: formatChave(params.chave),
      protocolo: params.protocolo,
      avisoFiscal: `Autorizada na SEFAZ · Protocolo ${params.protocolo}.`,
    };
  }

  if (params.situacaoFiscal === "simulado" && params.chave) {
    return {
      tituloBobina: `EXTRATO ${mod} — AMBIENTE SIMULADO`,
      subtituloBobina: "Homologação interna — sem valor jurídico perante a SEFAZ",
      chave: params.chave,
      chaveFormatada: formatChave(params.chave),
      protocolo: params.protocolo,
      avisoFiscal: "Documento gerado em modo simulado (sem transmissão SEFAZ live).",
    };
  }

  // Regra estrita (Etapas 7 e 8): pendente_transmissao ou rejeitada nunca inventa chave/protocolo!
  return {
    tituloBobina: `EXTRATO ${mod} — PENDENTE DE TRANSMISSÃO`,
    subtituloBobina: "Venda registrada no caixa — aguardando transmissão à SEFAZ",
    chave: null,
    chaveFormatada: null,
    protocolo: null,
    avisoFiscal: "Pendente de transmissão à SEFAZ: nenhum protocolo ou autorização fictícia foi gerado.",
  };
}

/** Monta recibo térmico 80 mm completo imediatamente após o fechamento no PDV */
export function montarReciboDeFechamentoPdv(params: {
  id: string;
  modo: "dav" | "sem_nota" | "emitir_nfce";
  numeroVenda: number;
  numeroNota: number | null;
  serie?: string | null;
  modelo: "NFC-e" | "NF-e" | "SAT" | null;
  situacaoFiscal: SituacaoFiscalVenda;
  chave: string | null;
  protocolo: string | null;
  clienteNome: string;
  clienteDocumento?: string;
  operador: string;
  terminal: string;
  ambiente: string;
  itens: readonly { nome: string; qtd: number; precoUnit: number; total?: number; unidade?: string | null; desconto?: number; acrescimo?: number }[];
  subtotal: number;
  desconto: number;
  frete?: number;
  total: number;
  pagamentosBrutos: readonly ParcelaPagamentoPdv[];
  troco: number;
  validadeDav?: string | null;
  dataIso?: string;
  /** Venda guardada na fila offline: comprovante provisório, sem número definitivo nem validade fiscal. */
  offline?: boolean;
  itensCancelados?: ItemCanceladoPdv[];
}): ReciboTermicoPdv {
  const tipo: "fiscal" | "sem_nota" | "dav" =
    params.modo === "dav" ? "dav" : params.modo === "sem_nota" ? "sem_nota" : "fiscal";
  const modeloEfetivo = tipo === "fiscal" ? params.modelo ?? "NFC-e" : null;
  const documentoRotulo = params.offline
    ? `COMPROVANTE PROVISÓRIO · OFFLINE · ${params.id.slice(-8).toUpperCase()}`
    : tipo === "dav"
      ? `DAV #${params.numeroVenda}`
      : tipo === "sem_nota"
        ? `Venda #${params.numeroVenda} (sem nota)`
        : `${modeloEfetivo} nº ${params.numeroNota ?? params.numeroVenda}`;

  const itens: ItemReciboTermicoPdv[] = params.itens.map((it, idx) => {
    const qtd = normalizarQtdPdv(Number(it.qtd) || 0);
    const precoUnit = round2(Number(it.precoUnit) || 0);
    const desconto = round2(Math.max(0, Number((it as { desconto?: unknown }).desconto) || 0));
    const acrescimo = round2(Math.max(0, Number((it as { acrescimo?: unknown }).acrescimo) || 0));
    return {
      numero: idx + 1,
      nome: String(it.nome || "ITEM"),
      qtd,
      unidade: String(it.unidade || "UN"),
      precoUnit,
      total: it.total !== undefined ? round2(Number(it.total)) : round2(qtd * precoUnit),
      ...(desconto > 0 ? { desconto } : {}),
      ...(acrescimo > 0 ? { acrescimo } : {}),
    };
  });

  const unidadesTotais = normalizarQtdPdv(itens.reduce((s, i) => s + i.qtd, 0));
  const parcelasBase =
    tipo === "dav"
      ? []
      : params.pagamentosBrutos.length > 0
        ? params.pagamentosBrutos.filter((p) => round2(p.valor) > 0)
        : [{ forma: "dinheiro", valor: round2(params.total) }];

  const parcelas = parcelasBase.map((p) => ({
    forma: p.forma,
    rotulo: rotuloForma(p.forma),
    valor: round2(p.valor),
  }));
  const formaPrincipal =
    parcelas.length > 0 ? parcelas.slice().sort((a, b) => b.valor - a.valor)[0].forma : "dinheiro";

  const { tributosTotal, ibsEstimado, cbsEstimado } = calcularTributosRecibo(params.total);
  const cab = resolverCabecalhoEAvisoFiscal({
    tipo,
    status: tipo === "dav" ? "aberto" : "faturado",
    modelo: modeloEfetivo,
    situacaoFiscal: params.situacaoFiscal,
    chave: params.chave,
    protocolo: params.protocolo,
    validadeDav: tipo === "dav" ? (params.validadeDav ?? null) : null,
  });

  return {
    id: params.id,
    tipo,
    status: tipo === "dav" ? "aberto" : "faturado",
    numeroVenda: params.numeroVenda,
    numeroNota: params.numeroNota,
    serie: String(params.serie || "1"),
    modelo: modeloEfetivo,
    tituloBobina: cab.tituloBobina,
    subtituloBobina: cab.subtituloBobina,
    documentoRotulo,
    dataIso: params.dataIso || new Date().toISOString(),
    operador: params.operador || "Operador",
    terminal: params.terminal || "CAIXA 1",
    ambiente: params.ambiente === "1" ? "1" : "2",
    clienteNome: params.clienteNome || "CONSUMIDOR",
    clienteDocumento: params.clienteDocumento || "",
    itens,
    qtdLinhas: itens.length,
    unidadesTotais,
    subtotal: round2(params.subtotal),
    desconto: round2(params.desconto),
    frete: round2(params.frete ?? 0),
    total: round2(params.total),
    parcelas,
    formaPrincipal,
    troco: round2(Math.max(0, params.troco)),
    tributosTotal,
    ibsEstimado,
    cbsEstimado,
    situacaoFiscal: params.situacaoFiscal,
    chave: cab.chave,
    chaveFormatada: cab.chaveFormatada,
    protocolo: cab.protocolo,
    avisoFiscal: params.offline
      ? "SEM CONEXÃO: venda registrada na fila offline deste terminal e ainda NÃO enviada ao servidor. Este comprovante é provisório, sem número definitivo e sem validade fiscal; a numeração e a NFC-e (se houver) serão geradas na sincronização."
      : cab.avisoFiscal,
    validadeDav: tipo === "dav" ? (params.validadeDav ?? null) : null,
    ...(params.itensCancelados?.length ? { itensCancelados: params.itensCancelados } : {}),
  };
}

export type VendaDocumentoResumoPdv = {
  id: string;
  numero: number;
  numeroNota: number | null;
  serie: string | null;
  modelo: string | null;
  tipo: string;
  status: string;
  situacaoFiscal: SituacaoFiscalVenda;
  protocoloOrigem?: ProtocoloOrigemVenda;
  chave: string | null;
  protocolo: string | null;
  clienteId: string | null;
  clienteNome: string;
  subtotal: number;
  desconto: number;
  vFrete: number;
  total: number;
  formaPagamento: string;
  pagamentos: { forma: string; valor: number }[];
  validade: string | null;
  observacao: string | null;
  operador: string | null;
  caixa: string;
  ambiente: string;
  data: string;
  itens: {
    produtoId?: string | null;
    gtin?: string | null;
    nome: string;
    qtd: number;
    precoUnit: number;
    total: number;
    unidade: string | null;
  }[];
};

/** Monta recibo térmico 80 mm para reimpressão de qualquer documento localizado em `F3` (DAV, Sem Nota ou Fiscal) */
export function montarReciboDeVendaDtoPdv(
  venda: VendaDocumentoResumoPdv,
  clienteDocumento = "",
): ReciboTermicoPdv {
  const tipo: "fiscal" | "sem_nota" | "dav" =
    venda.tipo === "dav" ? "dav" : venda.tipo === "sem_nota" ? "sem_nota" : "fiscal";
  const modBruto = venda.modelo;
  const modelo: "NFC-e" | "NF-e" | "SAT" | null =
    tipo === "fiscal"
      ? modBruto === "NF-e" || modBruto === "SAT"
        ? modBruto
        : "NFC-e"
      : null;

  const itens: ItemReciboTermicoPdv[] = (venda.itens ?? []).map((it, idx) => ({
    numero: idx + 1,
    nome: it.nome,
    qtd: normalizarQtdPdv(it.qtd),
    unidade: it.unidade || "UN",
    precoUnit: round2(it.precoUnit),
    total: round2(it.total),
  }));

  const unidadesTotais = normalizarQtdPdv(itens.reduce((s, i) => s + i.qtd, 0));
  const parcelas =
    tipo === "dav"
      ? []
      : venda.pagamentos && venda.pagamentos.length > 0
        ? venda.pagamentos.map((p) => ({
            forma: p.forma,
            rotulo: rotuloForma(p.forma),
            valor: round2(p.valor),
          }))
        : [
            {
              forma: venda.formaPagamento || "dinheiro",
              rotulo: rotuloForma(venda.formaPagamento || "dinheiro"),
              valor: round2(venda.total),
            },
          ];

  const { tributosTotal, ibsEstimado, cbsEstimado } = calcularTributosRecibo(venda.total);
  const cab = resolverCabecalhoEAvisoFiscal({
    tipo,
    status: venda.status,
    modelo,
    situacaoFiscal: venda.situacaoFiscal,
    chave: venda.chave,
    protocolo: venda.protocolo,
    validadeDav: venda.validade,
  });

  const documentoRotulo =
    tipo === "dav"
      ? `DAV #${venda.numero}`
      : tipo === "sem_nota"
        ? `Venda #${venda.numero} (sem nota)`
        : `${modelo ?? "NFC-e"} nº ${venda.numeroNota ?? venda.numero}`;

  return {
    id: venda.id,
    tipo,
    status: venda.status,
    numeroVenda: venda.numero,
    numeroNota: venda.numeroNota,
    serie: venda.serie || "1",
    modelo,
    tituloBobina: cab.tituloBobina,
    subtituloBobina: cab.subtituloBobina,
    documentoRotulo,
    dataIso: venda.data || new Date().toISOString(),
    operador: venda.operador || "Operador",
    terminal: venda.caixa || "CAIXA 1",
    ambiente: venda.ambiente === "1" ? "1" : "2",
    clienteNome: venda.clienteNome || "CONSUMIDOR",
    clienteDocumento,
    itens,
    qtdLinhas: itens.length,
    unidadesTotais,
    subtotal: round2(venda.subtotal),
    desconto: round2(venda.desconto),
    frete: round2(venda.vFrete),
    total: round2(venda.total),
    parcelas,
    formaPrincipal: venda.formaPagamento || "dinheiro",
    troco: 0,
    tributosTotal,
    ibsEstimado,
    cbsEstimado,
    situacaoFiscal: venda.situacaoFiscal,
    chave: cab.chave,
    chaveFormatada: cab.chaveFormatada,
    protocolo: cab.protocolo,
    avisoFiscal: cab.avisoFiscal,
    validadeDav: venda.validade,
  };
}

/** Converte um recibo fiscal do PDV no formato `DocFiscal` consumido pelo componente `<Impressao />` (DANFE 80 mm / A4) */
export function converterReciboParaDocFiscalPdv(recibo: ReciboTermicoPdv): DocFiscal | null {
  if (recibo.tipo !== "fiscal") return null;
  return {
    modelo: recibo.modelo ?? "NFC-e",
    serie: recibo.serie || "1",
    numero: recibo.numeroNota ?? recibo.numeroVenda,
    numeroInterno: recibo.numeroVenda,
    chave: recibo.chave,
    protocolo: recibo.protocolo,
    autorizadaEm: recibo.situacaoFiscal === "autorizada" ? recibo.dataIso : null,
    status: recibo.status,
    ambiente: recibo.ambiente === "1" ? 1 : 2,
    data: recibo.dataIso,
    operador: recibo.operador,
    cliente: recibo.clienteNome,
    itens: recibo.itens.map((i) => ({
      nome: i.nome,
      qtd: i.qtd,
      unidade: i.unidade,
      precoUnit: i.precoUnit,
      total: i.total,
      ...(i.desconto ? { desconto: i.desconto } : {}),
      ...(i.acrescimo ? { acrescimo: i.acrescimo } : {}),
    })),
    subtotal: recibo.subtotal,
    desconto: recibo.desconto,
    frete: recibo.frete,
    total: recibo.total,
    pagamentos: recibo.parcelas.map((p) => ({ forma: p.forma, valor: p.valor })),
    forma: recibo.formaPrincipal,
    troco: recibo.troco,
    observacao: null,
  };
}

/* ------------------------------------------- 2. Carregar DAV para Edição no Caixa (F3 → Tela PDV) */

export type ResultadoCarregarDavPdv =
  | {
      ok: true;
      davId: string;
      davNumero: number;
      linhas: LinhaItemPdv[];
      clienteId: string | null;
      descontoModo: "real";
      descontoValor: string;
      listaEsperaAtualizada: VendaEmEsperaPdv[];
      guardouVendaAnteriorEmEspera: boolean;
      itensNaoEncontrados: string[];
    }
  | {
      ok: false;
      erro: string;
    };

/**
 * Carrega os itens de um DAV em aberto para a tela principal do PDV (permitindo editar itens ou dividir pagamento).
 * Caso haja outra venda em andamento na tela, guarda-a automaticamente em `Vendas em Espera (F9)` para zero perda!
 */
export function carregarDavParaTelaPdv<T extends ProdutoBalcaoPdv>(params: {
  dav: VendaDocumentoResumoPdv;
  produtosAtivos: readonly T[];
  listaEsperaAtual: readonly VendaEmEsperaPdv[];
  vendaAtivaNaTela?: RascunhoVendaAtivaPdv | null;
  agora?: number;
}): ResultadoCarregarDavPdv {
  const { dav } = params;
  if (dav.tipo !== "dav") {
    return { ok: false, erro: "Apenas pré-vendas do tipo DAV podem ser carregadas para edição no caixa." };
  }
  if (dav.status !== "aberto") {
    return { ok: false, erro: `O DAV #${dav.numero} já está ${dav.status} e não pode ser reaberto no caixa.` };
  }
  if (!Array.isArray(dav.itens) || dav.itens.length === 0) {
    return { ok: false, erro: `O DAV #${dav.numero} não possui itens válidos.` };
  }

  const porId = new Map<string, T>();
  const porGtin = new Map<string, T>();
  const porNomeNorm = new Map<string, T>();
  for (const p of params.produtosAtivos) {
    porId.set(p.id, p);
    if (p.gtin && p.gtin !== "SEM GTIN") porGtin.set(p.gtin, p);
    porNomeNorm.set(normalizarTextoBalcaoPdv(p.nome), p);
  }

  const mapaLinhas = new Map<string, LinhaItemPdv>();
  const itensNaoEncontrados: string[] = [];

  for (const item of dav.itens) {
    const prod =
      (item.produtoId ? porId.get(item.produtoId) : undefined) ??
      (item.gtin && item.gtin !== "SEM GTIN" ? porGtin.get(item.gtin) : undefined) ??
      porNomeNorm.get(normalizarTextoBalcaoPdv(item.nome));

    if (!prod) {
      itensNaoEncontrados.push(item.nome);
      continue;
    }

    const qtdBruta = normalizarQtdPdv(Number(item.qtd) || 0);
    const qtdItem = prod.pesavel ? qtdBruta : Math.max(1, Math.round(qtdBruta));
    if (qtdItem <= 0) continue;

    const existente = mapaLinhas.get(prod.id);
    if (existente) {
      existente.qtd = normalizarQtdPdv(existente.qtd + qtdItem);
    } else {
      mapaLinhas.set(prod.id, {
        produtoId: prod.id,
        nome: prod.nome,
        qtd: qtdItem,
        preco: round2(Number(item.precoUnit) > 0 ? Number(item.precoUnit) : prod.preco),
        unidade: prod.unidade || item.unidade || "UN",
        estoque: normalizarQtdPdv(prod.estoque),
        pesavel: Boolean(prod.pesavel),
      });
    }
  }

  const linhas = Array.from(mapaLinhas.values());
  if (linhas.length === 0) {
    return {
      ok: false,
      erro: `Nenhum produto ativo do catálogo corresponde aos itens do DAV #${dav.numero}.`,
    };
  }

  let listaEsperaAtualizada = [...params.listaEsperaAtual];
  let guardouVendaAnteriorEmEspera = false;

  const ativa = params.vendaAtivaNaTela;
  const linhasAtivas = ativa ? ativa.linhas.filter((l) => l.qtd > 0) : [];
  if (ativa && linhasAtivas.length > 0) {
    const rSusp = suspenderVendaParaEsperaPdv({
      listaAtual: listaEsperaAtualizada,
      vendaAtiva: { ...ativa, linhas: linhasAtivas },
      identificacao: ativa.clienteId
        ? `${ativa.clienteNome} (antes do DAV #${dav.numero})`
        : `Atendimento salvo antes do DAV #${dav.numero}`,
      agora: params.agora,
    });
    if (!rSusp.ok) {
      return { ok: false, erro: rSusp.erro };
    }
    listaEsperaAtualizada = rSusp.lista;
    guardouVendaAnteriorEmEspera = true;
  }

  const descontoNum = round2(Math.max(0, Number(dav.desconto) || 0));

  return {
    ok: true,
    davId: dav.id,
    davNumero: dav.numero,
    linhas,
    clienteId: dav.clienteId,
    descontoModo: "real",
    descontoValor: descontoNum > 0 ? descontoNum.toFixed(2).replace(".", ",") : "",
    listaEsperaAtualizada,
    guardouVendaAnteriorEmEspera,
    itensNaoEncontrados,
  };
}

/* ------------------------------------------- 3. Cancelamento / Estorno Seguro em Documentos (F3) */

export type ValidacaoCancelamentoPdv =
  | {
      ok: true;
      motivoLimpo: string;
      exigeEventoSefaz: boolean;
      prazoInfo: {
        dentroDoPrazo: boolean;
        limiteMinutos: number;
        decorridoMinutos: number;
        rotuloLimite: string;
      };
    }
  | {
      ok: false;
      codigo: "ja_cancelado" | "motivo_curto" | "motivo_longo" | "prazo_sefaz_expirado";
      erro: string;
    };

/**
 * Valida pedido de cancelamento/estorno de venda ou DAV feito em `Documentos (F3)`:
 * - Exige motivo entre 15 e 255 caracteres (padrão evento 110111 SEFAZ).
 * - Para notas autorizadas na SEFAZ (`situacaoFiscal === "autorizada"` e `protocoloOrigem === "autorizado_sefaz"`),
 *   aplica `verificarPrazoLegalCancelamento` (30 min NFC-e 65 / 24h NF-e 55).
 */
export function validarCancelamentoDocumentoPdv(params: {
  venda: Pick<
    VendaDocumentoResumoPdv,
    "tipo" | "status" | "modelo" | "situacaoFiscal" | "protocoloOrigem" | "data" | "numero" | "numeroNota"
  >;
  motivo: string;
  agoraMs?: number;
}): ValidacaoCancelamentoPdv {
  const { venda } = params;
  if (venda.status === "cancelado" || venda.situacaoFiscal === "cancelada") {
    return {
      ok: false,
      codigo: "ja_cancelado",
      erro: "Este documento já se encontra cancelado.",
    };
  }

  const motivoLimpo = String(params.motivo ?? "").trim().replace(/\s+/g, " ");
  if (motivoLimpo.length < MIN_MOTIVO_CANCELAMENTO_PDV) {
    return {
      ok: false,
      codigo: "motivo_curto",
      erro: `Informe uma justificativa com pelo menos ${MIN_MOTIVO_CANCELAMENTO_PDV} caracteres (atual: ${motivoLimpo.length}).`,
    };
  }
  if (motivoLimpo.length > MAX_MOTIVO_CANCELAMENTO_PDV) {
    return {
      ok: false,
      codigo: "motivo_longo",
      erro: `A justificativa deve ter no máximo ${MAX_MOTIVO_CANCELAMENTO_PDV} caracteres.`,
    };
  }

  const autorizadaRealSefaz =
    venda.tipo === "fiscal" &&
    venda.situacaoFiscal === "autorizada" &&
    venda.protocoloOrigem === "autorizado_sefaz";

  const tsData = venda.data ? new Date(venda.data).getTime() : NaN;
  const prazoInfo = verificarPrazoLegalCancelamento({
    modelo: venda.modelo ?? "NFC-e",
    autorizadaEm: autorizadaRealSefaz && Number.isFinite(tsData) ? tsData : null,
    agoraMs: params.agoraMs,
  });

  if (autorizadaRealSefaz && !prazoInfo.dentroDoPrazo) {
    return {
      ok: false,
      codigo: "prazo_sefaz_expirado",
      erro: `Prazo legal da SEFAZ expirado para ${venda.modelo ?? "NFC-e"} nº ${venda.numeroNota ?? venda.numero} (${prazoInfo.decorridoMinutos} min decorridos; limite ${prazoInfo.rotuloLimite}). Emita nota de devolução.`,
    };
  }

  return {
    ok: true,
    motivoLimpo,
    exigeEventoSefaz: autorizadaRealSefaz,
    prazoInfo,
  };
}

/* ------------------------------------------- 4. Gaveta Rápida no PDV — Suprimento e Sangria (Alt+G) */

export type ValidacaoMovimentoGavetaPdv =
  | {
      ok: true;
      tipo: "suprimento" | "sangria";
      forma: string;
      valor: number;
      motivoLimpo: string;
      saldoDinheiroApos: number;
    }
  | {
      ok: false;
      codigo: "caixa_fechado" | "tipo_invalido" | "forma_invalida" | "valor_invalido" | "motivo_curto" | "saldo_insuficiente";
      erro: string;
    };

/**
 * Valida suprimento ou sangria rápida na Frente de Caixa sem sair da tela cheia:
 * - Exige sessão de caixa aberta.
 * - Valida valor monetário > 0 e motivo >= 3 caracteres.
 * - Bloqueia sangria em dinheiro acima do saldo em dinheiro disponível na gaveta.
 */
export function validarMovimentoGavetaPdv(params: {
  /** `saldoDinheiro` é opcional: o PDV não recebe valores esperados (blind balance),
   *  e a validação de saldo insuficiente é feita no servidor. Testes legados ainda
   *  podem informar o saldo explicitamente. */
  sessaoAberta: { id: string; numero: number; terminal: string; saldoDinheiro?: number } | null;
  tipo: string;
  forma: string;
  valorInformado: number | string;
  motivo: string;
}): ValidacaoMovimentoGavetaPdv {
  if (!params.sessaoAberta || !params.sessaoAberta.id) {
    return {
      ok: false,
      codigo: "caixa_fechado",
      erro: "Caixa fechado: abra a sessão de caixa antes de registrar suprimento ou sangria.",
    };
  }

  const tipo = String(params.tipo ?? "").trim().toLowerCase();
  if (tipo !== "suprimento" && tipo !== "sangria") {
    return {
      ok: false,
      codigo: "tipo_invalido",
      erro: "Escolha Suprimento (entrada) ou Sangria (retirada).",
    };
  }

  const forma = String(params.forma ?? "dinheiro").trim().toLowerCase() || "dinheiro";
  if (!FORMAS_PAGAMENTO.some((f) => f.id === forma)) {
    return {
      ok: false,
      codigo: "forma_invalida",
      erro: "Selecione uma forma válida para movimentar o caixa.",
    };
  }

  const valor = lerValorMonetarioPdv(params.valorInformado);
  if (!Number.isFinite(valor) || valor <= 0) {
    return {
      ok: false,
      codigo: "valor_invalido",
      erro: "Informe um valor maior que zero para a movimentação.",
    };
  }

  const motivoLimpo = String(params.motivo ?? "").trim().replace(/\s+/g, " ");
  if (motivoLimpo.length < MIN_MOTIVO_GAVETA_PDV) {
    return {
      ok: false,
      codigo: "motivo_curto",
      erro: `Descreva o motivo da ${tipo} (mínimo ${MIN_MOTIVO_GAVETA_PDV} caracteres).`,
    };
  }

  const saldoAtual = round2(Math.max(0, Number(params.sessaoAberta.saldoDinheiro) || 0));
  const saldoConhecido = typeof params.sessaoAberta.saldoDinheiro === "number";
  // Sem saldo conhecido (PDV blind balance), a trava é aplicada pela Server Action.
  if (saldoConhecido && tipo === "sangria" && forma === "dinheiro" && valor > saldoAtual + 0.01) {
    return {
      ok: false,
      codigo: "saldo_insuficiente",
      erro: `Saldo em dinheiro insuficiente na gaveta para sangria (disponível: ${moeda(saldoAtual)}).`,
    };
  }

  const saldoDinheiroApos =
    forma !== "dinheiro"
      ? saldoAtual
      : tipo === "suprimento"
        ? round2(saldoAtual + valor)
        : round2(Math.max(0, saldoAtual - valor));

  return {
    ok: true,
    tipo,
    forma,
    valor,
    motivoLimpo,
    saldoDinheiroApos,
  };
}

/* ------------------------------------------- 5. Inspetor da Fila Offline (nkway.fila) */

export type ItemFilaOfflinePdv = {
  idFila: string;
  tipo: "fiscal" | "sem_nota" | "dav";
  itens: { produtoId: string; qtd: number; preco: number }[];
  clienteId: string | null;
  clienteNome: string;
  desconto: number;
  pagamentos: ParcelaPagamentoPdv[];
  modelo: "NFC-e" | "NF-e" | "SAT";
  validade?: string;
  criadoEm: number;
  tentativas: number;
  ultimoErro: string | null;
  totalEstimado: number;
  qtdUnidades: number;
  operadorNome?: string;
  terminal?: string;
};

/** Id único da operação gerado no navegador (idempotência no servidor). Só caracteres seguros para a marca `[fila:...]`. */
export function gerarIdFilaPdv(agora = Date.now()): string {
  const aleatorio = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `pdv-${agora.toString(36)}-${aleatorio}`;
}

/** Horas desde o item mais antigo da fila (null se vazia). Usado para alertar fila "esquecida". */
export function idadeFilaOfflineHoras(itens: readonly ItemFilaOfflinePdv[], agora = Date.now()): number | null {
  if (!itens.length) return null;
  const maisAntigo = Math.min(...itens.map((i) => i.criadoEm));
  return Math.max(0, Math.round(((agora - maisAntigo) / 3_600_000) * 10) / 10);
}

/**
 * Sanitiza os registros armazenados em `localStorage["nkway.fila"]`, preservando 100% de compatibilidade
 * com registros antigos e calculando total, unidades, tentativas e último erro de sincronização.
 */
export function sanitizarFilaOfflinePdv(bruto: unknown): ItemFilaOfflinePdv[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object"))
    .map((v, idx) => {
      const itens = Array.isArray(v.itens)
        ? v.itens
            .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === "object" && i.produtoId))
            .map((i) => ({
              produtoId: String(i.produtoId),
              qtd: normalizarQtdPdv(Number(i.qtd) || 0),
              preco: round2(Number(i.preco) || 0),
            }))
            .filter((i) => i.qtd > 0)
        : [];
      const subtotal = round2(itens.reduce((s, i) => s + i.qtd * i.preco, 0));
      const desconto = round2(Math.min(subtotal, Math.max(0, Number(v.desconto) || 0)));
      const totalEstimado = round2(Math.max(0, subtotal - desconto));
      const qtdUnidades = normalizarQtdPdv(itens.reduce((s, i) => s + i.qtd, 0));
      const tipoBruto = String(v.tipo ?? "fiscal");
      const tipo: "fiscal" | "sem_nota" | "dav" =
        tipoBruto === "dav" ? "dav" : tipoBruto === "sem_nota" ? "sem_nota" : "fiscal";
      const modBruto = String(v.modelo ?? "NFC-e");
      const modelo: "NFC-e" | "NF-e" | "SAT" =
        modBruto === "NF-e" || modBruto === "SAT" ? modBruto : "NFC-e";
      const pagamentos = Array.isArray(v.pagamentos)
        ? v.pagamentos
            .filter((p): p is Record<string, unknown> => Boolean(p && typeof p === "object"))
            .map((p) => ({ forma: String(p.forma ?? "dinheiro"), valor: round2(Number(p.valor) || 0) }))
            .filter((p) => p.valor > 0)
        : [];
      const criadoEm = Number(v.criadoEm) || Date.now() + idx;
      return {
        idFila: typeof v.idFila === "string" && v.idFila ? v.idFila : `fila-${criadoEm}-${idx}`,
        tipo,
        itens,
        clienteId: typeof v.clienteId === "string" && v.clienteId ? v.clienteId : null,
        clienteNome: String(v.clienteNome || "CONSUMIDOR"),
        desconto,
        pagamentos,
        modelo,
        ...(typeof v.validade === "string" && v.validade ? { validade: v.validade } : {}),
        criadoEm,
        tentativas: Math.max(0, Math.floor(Number(v.tentativas) || 0)),
        ultimoErro: typeof v.ultimoErro === "string" && v.ultimoErro ? v.ultimoErro : null,
        totalEstimado,
        qtdUnidades,
        ...(typeof v.operadorNome === "string" && v.operadorNome ? { operadorNome: v.operadorNome } : {}),
        ...(typeof v.terminal === "string" && v.terminal ? { terminal: v.terminal } : {}),
      };
    })
    .filter((item) => item.itens.length > 0);
}

/** Calcula resumo financeiro e operacional da fila offline pendente */
export function resumirFilaOfflinePdv(itens: readonly ItemFilaOfflinePdv[]) {
  const quantidade = itens.length;
  const valorTotal = round2(itens.reduce((s, i) => s + i.totalEstimado, 0));
  const comErro = itens.filter((i) => Boolean(i.ultimoErro)).length;
  return {
    quantidade,
    valorTotal,
    comErro,
  };
}
