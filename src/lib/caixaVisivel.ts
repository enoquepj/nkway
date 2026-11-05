import type { CaixaSessaoDto } from "@/server/dados";
import type { EstadoGaveta, MovimentoCaixaInput } from "@/lib/caixa";

/** Nenhum valor esperado ou snapshot de turno aberto pode ser enviado ao navegador. */
export type CaixaSessaoAbertaVisivel = {
  id: string;
  numero: number;
  terminal: string;
  operadorId: string;
  operadorNome: string;
  status: "aberto";
  saldoInicial: number;
  abertoEm: string;
  reabertoEm: string;
  justificativaReabertura: string;
  estadoGaveta: EstadoGaveta;
  bloquearVendaDinheiro: boolean;
  qtdVendasAtivas: number;
  qtdVendasCanceladas: number;
  movimentos: MovimentoCaixaInput[];
};

export type CaixaSessaoFechadaVisivel = CaixaSessaoDto & { status: "fechado" };
export type CaixaSessaoVisivel = CaixaSessaoAbertaVisivel | CaixaSessaoFechadaVisivel;

/** Projeção explícita: não espalhe o DTO original ao projetar uma sessão aberta. */
export function projetarCaixaVisivel(s: CaixaSessaoDto): CaixaSessaoVisivel {
  if (s.status === "fechado") return { ...s, status: "fechado" };
  return {
    id: s.id,
    numero: s.numero,
    terminal: s.terminal,
    operadorId: s.operadorId,
    operadorNome: s.operadorNome,
    status: "aberto",
    saldoInicial: s.saldoInicial,
    abertoEm: s.abertoEm,
    reabertoEm: s.reabertoEm,
    justificativaReabertura: s.justificativaReabertura,
    estadoGaveta: s.apuracao.estadoGaveta,
    bloquearVendaDinheiro: s.apuracao.bloquearVendaDinheiro,
    qtdVendasAtivas: s.apuracao.qtdVendasAtivas,
    qtdVendasCanceladas: s.apuracao.qtdVendasCanceladas,
    movimentos: s.movimentos,
  };
}
