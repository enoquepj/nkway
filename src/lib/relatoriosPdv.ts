/** Contrato público dos relatórios gerenciais de PDV; nenhuma credencial ou dado de outra empresa. */
export const ABAS_RELATORIOS_PDV = [
  { id: "visao", rotulo: "Visão geral", descricao: "Vendas e recebimentos" },
  { id: "produtos", rotulo: "Produtos", descricao: "Giro e curva ABC" },
  { id: "caixa", rotulo: "Auditoria de caixa", descricao: "Turnos e sangrias" },
  { id: "operadores", rotulo: "Operadores", descricao: "Produtividade da equipe" },
  { id: "cancelamentos", rotulo: "Cancelamentos", descricao: "Cancelamentos e descontos" },
] as const;

export type AbaRelatorioPdv = (typeof ABAS_RELATORIOS_PDV)[number]["id"];
export type DetalheCaixaRelatorio = "turnos" | "sangrias";
export type FormatoRelatorio = "texto" | "identificador" | "numero" | "quantidade" | "moeda" | "percentual" | "datahora" | "diferenca" | "estoque" | "classe";
export type ValorRelatorio = string | number | null;

/** Formatação única para tela e impressão; datas usam o fuso da empresa. */
export function formatarValorRelatorioPdv(valor: ValorRelatorio | undefined, formato: FormatoRelatorio | undefined, fuso: string): string {
  if (valor == null || valor === "") return "—";
  if (formato === "datahora") {
    const data = new Date(String(valor));
    return Number.isFinite(data.getTime()) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso }).format(data) : "—";
  }
  if (typeof valor !== "number") return String(valor);
  if (formato === "moeda" || formato === "diferenca") return `${formato === "diferenca" && valor > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor)}`;
  if (formato === "percentual") return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(valor)}%`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: formato === "quantidade" ? 3 : 0 }).format(valor);
}

export type LinhaRelatorioPdv = Record<string, ValorRelatorio>;
export type ColunaRelatorioPdv = { chave: string; rotulo: string; formato?: FormatoRelatorio };
export type IndicadorRelatorioPdv = { rotulo: string; valor: ValorRelatorio; formato?: FormatoRelatorio; detalhe: string; icone: string; tom?: "verde" | "azul" | "laranja" | "roxo" };

export type FiltrosRelatorioPdv = {
  inicio: string;
  fim: string;
  terminal: string;
  operador: string;
  categoria: string;
  statusTurno: "todos" | "aberto" | "fechado";
  top: 10 | 50 | 100;
  aba: AbaRelatorioPdv;
  detalhe: DetalheCaixaRelatorio;
  pagina: number;
  tamanhoPagina: number;
};

export type RespostaRelatorioPdv = {
  ok: true;
  aba: AbaRelatorioPdv;
  detalhe: DetalheCaixaRelatorio;
  empresa: string;
  fuso: string;
  filtros: FiltrosRelatorioPdv;
  colunas: ColunaRelatorioPdv[];
  indicadores: IndicadorRelatorioPdv[];
  linhas: LinhaRelatorioPdv[];
  total: number;
  paginas: number;
  avisos: string[];
  opcoes: { terminais: string[]; categorias: string[] };
};

const COLUNAS: Record<AbaRelatorioPdv | "sangrias", ColunaRelatorioPdv[]> = {
  visao: [
    { chave: "forma", rotulo: "Forma de pagamento" },
    { chave: "lancamentos", rotulo: "Vendas", formato: "numero" },
    { chave: "valor", rotulo: "Valor líquido", formato: "moeda" },
    { chave: "percentual", rotulo: "Participação", formato: "percentual" },
  ],
  produtos: [
    { chave: "posicao", rotulo: "Posição", formato: "numero" },
    { chave: "sku", rotulo: "Código / SKU" },
    { chave: "produto", rotulo: "Produto" },
    { chave: "categoria", rotulo: "Categoria" },
    { chave: "quantidade", rotulo: "Qtd. vendida", formato: "quantidade" },
    { chave: "faturamento", rotulo: "Receita estimada", formato: "moeda" },
    { chave: "lucro", rotulo: "Lucro estimado", formato: "moeda" },
    { chave: "margem", rotulo: "Margem estimada", formato: "percentual" },
    { chave: "classe", rotulo: "Curva ABC", formato: "classe" },
    { chave: "estoque", rotulo: "Estoque atual", formato: "quantidade" },
    { chave: "alertaEstoque", rotulo: "Estoque", formato: "estoque" },
  ],
  caixa: [
    { chave: "sessaoId", rotulo: "ID do turno", formato: "identificador" },
    { chave: "turno", rotulo: "Turno" },
    { chave: "terminal", rotulo: "Terminal" },
    { chave: "operador", rotulo: "Operador" },
    { chave: "abertoEm", rotulo: "Abertura", formato: "datahora" },
    { chave: "fechadoEm", rotulo: "Fechamento", formato: "datahora" },
    { chave: "status", rotulo: "Status" },
    { chave: "dinheiroEsperado", rotulo: "Dinheiro esperado", formato: "moeda" },
    { chave: "dinheiroDeclarado", rotulo: "Dinheiro declarado", formato: "moeda" },
    { chave: "dinheiroDiferenca", rotulo: "Dinheiro diferença", formato: "diferenca" },
    { chave: "pixEsperado", rotulo: "PIX esperado", formato: "moeda" },
    { chave: "pixDeclarado", rotulo: "PIX declarado", formato: "moeda" },
    { chave: "pixDiferenca", rotulo: "PIX diferença", formato: "diferenca" },
    { chave: "cartoesEsperado", rotulo: "Cartões esperados", formato: "moeda" },
    { chave: "cartoesDeclarado", rotulo: "Cartões declarados", formato: "moeda" },
    { chave: "cartoesDiferenca", rotulo: "Cartões diferença", formato: "diferenca" },
    { chave: "aprovacao", rotulo: "Aprovação" },
    { chave: "lacre", rotulo: "Lacre" },
  ],
  sangrias: [
    { chave: "data", rotulo: "Data e hora", formato: "datahora" },
    { chave: "turno", rotulo: "Turno" },
    { chave: "terminal", rotulo: "Terminal" },
    { chave: "operador", rotulo: "Operador do turno" },
    { chave: "responsavel", rotulo: "Registrado por" },
    { chave: "forma", rotulo: "Forma" },
    { chave: "valor", rotulo: "Valor", formato: "moeda" },
    { chave: "motivo", rotulo: "Motivo" },
  ],
  operadores: [
    { chave: "operador", rotulo: "Operador" },
    { chave: "usuarioId", rotulo: "ID do usuário da sessão", formato: "identificador" },
    { chave: "vendas", rotulo: "Vendas", formato: "numero" },
    { chave: "faturamento", rotulo: "Faturamento líquido", formato: "moeda" },
    { chave: "quebra", rotulo: "Quebras absolutas", formato: "moeda" },
    { chave: "acuracia", rotulo: "Acurácia estimada", formato: "percentual" },
    { chave: "tempo", rotulo: "Tempo de atendimento" },
  ],
  cancelamentos: [
    { chave: "canceladoEm", rotulo: "Cancelado em", formato: "datahora" },
    { chave: "numero", rotulo: "Cupom / venda" },
    { chave: "valor", rotulo: "Valor", formato: "moeda" },
    { chave: "operador", rotulo: "Operador da venda" },
    { chave: "responsavel", rotulo: "Quem cancelou" },
    { chave: "motivo", rotulo: "Motivo" },
    { chave: "autorizador", rotulo: "Autorizador" },
  ],
};

export function colunasRelatorioPdv(aba: AbaRelatorioPdv, detalhe: DetalheCaixaRelatorio): ColunaRelatorioPdv[] {
  return COLUNAS[aba === "caixa" && detalhe === "sangrias" ? "sangrias" : aba];
}

/** O sistema não tem tabela de filiais; o fuso é inferido a partir da UF da empresa atual. */
export function fusoRelatorioPdv(uf: string | null | undefined): string {
  const fusos: Record<string, string> = {
    AC: "America/Rio_Branco", AM: "America/Manaus", RO: "America/Porto_Velho", RR: "America/Boa_Vista",
    MT: "America/Cuiaba", MS: "America/Campo_Grande", PA: "America/Belem",
  };
  return fusos[String(uf ?? "").toUpperCase()] ?? "America/Sao_Paulo";
}

function diaAtual(fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

function diaValido(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number(s.slice(0, 4)) < 1) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function periodoPadraoRelatorioPdv(fuso: string): { inicio: string; fim: string } {
  const fim = diaAtual(fuso);
  const d = new Date(`${fim}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return { inicio: d.toISOString().slice(0, 10), fim };
}

/** Validação server-side de todos os parâmetros. A empresa nunca vem do cliente. */
export function lerFiltrosRelatorioPdv(params: URLSearchParams, fuso: string): FiltrosRelatorioPdv {
  const padrao = periodoPadraoRelatorioPdv(fuso);
  const inicio = params.get("inicio") || padrao.inicio;
  const fim = params.get("fim") || padrao.fim;
  if (!diaValido(inicio) || !diaValido(fim) || inicio > fim) throw new RangeError("Informe um período válido, com a data inicial anterior à final.");
  const dias = (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000 + 1;
  if (dias > 366) throw new RangeError("Selecione um período de até 366 dias.");
  const aba = params.get("aba") || "visao";
  if (!ABAS_RELATORIOS_PDV.some((x) => x.id === aba)) throw new RangeError("Relatório inválido.");
  const detalhe = params.get("detalhe") || "turnos";
  if (detalhe !== "turnos" && detalhe !== "sangrias") throw new RangeError("Detalhe de caixa inválido.");
  const statusTurno = params.get("statusTurno") || "todos";
  if (statusTurno !== "todos" && statusTurno !== "aberto" && statusTurno !== "fechado") throw new RangeError("Status de turno inválido.");
  const top = Number(params.get("top") || 10);
  if (top !== 10 && top !== 50 && top !== 100) throw new RangeError("Escolha Top 10, 50 ou 100.");
  const pagina = Number(params.get("pagina") || 1);
  const tamanhoPagina = Number(params.get("tamanho") || 10);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 100_000 || !Number.isSafeInteger(tamanhoPagina) || tamanhoPagina < 1 || tamanhoPagina > 100) throw new RangeError("Paginação inválida.");
  if (params.get("autorizador")) throw new RangeError("O autorizador de cancelamento não é registrado no sistema atual.");
  const texto = (chave: string) => String(params.get(chave) ?? "").trim().slice(0, 120);
  return { inicio, fim, terminal: texto("terminal"), operador: texto("operador"), categoria: texto("categoria"), statusTurno, top, aba: aba as AbaRelatorioPdv, detalhe, pagina, tamanhoPagina };
}
