/**
 * NKWAY — Central de prontidão (modelo puro, sem acesso a banco ou a variáveis).
 *
 * Regra de segurança: este DTO transporta SOMENTE rótulos, booleanos e contagens.
 * Nenhum valor de variável de ambiente, URL de conexão, token, senha ou conteúdo
 * de certificado A1 pode aparecer aqui. Os nomes das variáveis são permitidos
 * apenas como dica de configuração.
 */

export type StatusProntidao = "pronto" | "pendente" | "opcional";

export type ItemProntidao = {
  id: string;
  titulo: string;
  descricao: string;
  status: StatusProntidao;
  /** Nome da variável de ambiente (nunca o valor). */
  variavel?: string;
  observacao?: string;
};

export type BlocoProntidao = {
  id: string;
  titulo: string;
  descricao: string;
  icone: string;
  rota: string;
  itens: ItemProntidao[];
};

export type ContagensProntidao = {
  documentos: number;
  entradas: number;
  assinaturas: number;
  faturas: number;
  tabelasNk: number;
  tabelasLegadas: number;
  tabelasLegadasAcessiveis: number;
};

export type ResumoProntidao = {
  prontos: number;
  pendentes: number;
  opcionais: number;
  total: number;
  percentual: number;
};

export type ProntidaoDto = {
  geradoEm: string;
  empresaNome: string;
  bancoConectado: boolean;
  resumo: ResumoProntidao;
  contagens: ContagensProntidao;
  blocos: BlocoProntidao[];
  legado: {
    empresaEncontrada: boolean;
    faltaPermissaoLeitura: boolean;
    ultimaMigracaoEm: string | null;
  };
};

export const ROTULO_STATUS_PRONTIDAO: Record<StatusProntidao, string> = {
  pronto: "Pronto",
  pendente: "Pendente",
  opcional: "Opcional",
};

export const TOM_STATUS_PRONTIDAO: Record<StatusProntidao, "ok" | "alerta" | "neutro"> = {
  pronto: "ok",
  pendente: "alerta",
  opcional: "neutro",
};

/** Resumo calculado no servidor e reaproveitado pela API e pela tela. */
export function resumoProntidao(blocos: BlocoProntidao[]): ResumoProntidao {
  const itens = blocos.flatMap((b) => b.itens);
  const prontos = itens.filter((i) => i.status === "pronto").length;
  const pendentes = itens.filter((i) => i.status === "pendente").length;
  const opcionais = itens.filter((i) => i.status === "opcional").length;
  const relevantes = prontos + pendentes;
  return {
    prontos,
    pendentes,
    opcionais,
    total: itens.length,
    percentual: relevantes === 0 ? 100 : Math.round((prontos / relevantes) * 100),
  };
}

/** Monta um item com validação mínima para evitar status inesperado na UI. */
export function itemProntidao(
  id: string,
  titulo: string,
  descricao: string,
  condicao: boolean,
  extras: { variavel?: string; observacao?: string; opcionalQuandoFaltar?: boolean } = {},
): ItemProntidao {
  return {
    id,
    titulo,
    descricao,
    status: condicao ? "pronto" : extras.opcionalQuandoFaltar ? "opcional" : "pendente",
    ...(extras.variavel ? { variavel: extras.variavel } : {}),
    ...(extras.observacao ? { observacao: extras.observacao } : {}),
  };
}
