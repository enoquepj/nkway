/**
 * NKWAY — Modelo puro de Situação Fiscal e Origem de Protocolo (Etapa 7).
 * Garante que protocolos simulados ou notas sem transmissão SEFAZ jamais apareçam como "autorizada".
 */

export const SITUACOES_FISCAIS = [
  "nao_emitida",
  "pendente_transmissao",
  "simulado",
  "autorizada",
  "rejeitada",
  "cancelada",
] as const;

export type SituacaoFiscalVenda = (typeof SITUACOES_FISCAIS)[number];

export type ProtocoloOrigemVenda = "autorizado_sefaz" | "simulado" | null;

export const ROTULO_SITUACAO_FISCAL: Record<
  SituacaoFiscalVenda,
  { rotulo: string; tom: "neutro" | "alerta" | "info" | "ok" | "erro" }
> = {
  nao_emitida: { rotulo: "Não emitida", tom: "neutro" },
  pendente_transmissao: { rotulo: "Pendente transmissão", tom: "alerta" },
  simulado: { rotulo: "Simulado (homologação)", tom: "info" },
  autorizada: { rotulo: "Autorizada SEFAZ", tom: "ok" },
  rejeitada: { rotulo: "Rejeitada SEFAZ", tom: "erro" },
  cancelada: { rotulo: "Cancelada", tom: "erro" },
};

export function resolverProtocoloOrigemVenda(v: {
  tipo: string;
  protocolo?: string | null;
  protocoloOrigem?: string | null;
  statusSefaz?: string | null;
  situacaoFiscal?: string | null;
}): ProtocoloOrigemVenda {
  if (v.protocoloOrigem === "autorizado_sefaz" || v.protocoloOrigem === "simulado") {
    return v.protocoloOrigem;
  }
  if (!v.protocolo || v.tipo === "dav" || v.tipo === "sem_nota") {
    return null;
  }
  if (v.situacaoFiscal === "autorizada" || v.statusSefaz === "autorizada") {
    return "autorizado_sefaz";
  }
  return "simulado";
}

export function resolverSituacaoFiscalVenda(v: {
  tipo: string;
  status: string;
  protocolo?: string | null;
  protocoloOrigem?: string | null;
  statusSefaz?: string | null;
  situacaoFiscal?: string | null;
}): SituacaoFiscalVenda {
  if (v.status === "cancelado" || v.statusSefaz === "cancelada_sefaz" || v.situacaoFiscal === "cancelada") {
    return "cancelada";
  }

  if (
    v.situacaoFiscal &&
    (SITUACOES_FISCAIS as readonly string[]).includes(v.situacaoFiscal)
  ) {
    // Regra estrita: nunca reportar "autorizada" se o protocolo for simulado ou ausente
    if (v.situacaoFiscal === "autorizada") {
      const origem = resolverProtocoloOrigemVenda(v);
      return origem === "autorizado_sefaz" ? "autorizada" : "pendente_transmissao";
    }
    return v.situacaoFiscal as SituacaoFiscalVenda;
  }

  if (v.tipo === "dav" || v.tipo === "sem_nota") {
    return "nao_emitida";
  }
  if (v.statusSefaz === "pendente_envio" || v.statusSefaz === "contingencia") {
    return "pendente_transmissao";
  }
  if (v.statusSefaz === "rejeitada") {
    return "rejeitada";
  }
  if (v.statusSefaz === "autorizada" && v.protocolo) {
    return "autorizada";
  }
  return "simulado";
}
