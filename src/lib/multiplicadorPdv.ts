/**
 * NKWAY — Máquina de estados tipada do multiplicador de quantidade (`X + Qtd + Enter`)
 * e motor puro de adição/soma de itens na Frente de Caixa (/pdv).
 *
 * Ciclo único de estados:
 *   inativo → digitando → armado → consumida (volta a inativo / qtd padrão 1)
 *                                ↘ cancelada (volta a inativo / qtd padrão 1)
 */

export const LIMITE_MAX_MULTIPLICADOR = 9999;
export const CASAS_DECIMAIS_MAX_PDV = 3;

export type LinhaItemPdv = {
  produtoId: string;
  nome: string;
  qtd: number;
  preco: number;
  unidade: string;
  estoque: number;
  pesavel: boolean;
};

export type ProdutoAdicaoPdv = {
  id: string;
  nome: string;
  sku?: string;
  gtin?: string;
  preco: number;
  unidade: string;
  estoque: number;
  pesavel: boolean;
};

export type UltimaTransicaoMultiplicador =
  | "inicial"
  | "iniciada"
  | "editada"
  | "rejeitada"
  | "armada"
  | "mantida_erro"
  | "consumida"
  | "cancelada"
  | "convertida_busca";

export type EstadoMultiplicadorPdv =
  | {
      status: "inativo";
      ultimaTransicao: UltimaTransicaoMultiplicador;
    }
  | {
      status: "digitando";
      rascunho: string;
      teclaInicial: "x" | "X";
      erro: string | null;
      ultimaTransicao: UltimaTransicaoMultiplicador;
    }
  | {
      status: "armado";
      quantidade: number;
      temDecimal: boolean;
      rotulo: string;
      erro: string | null;
      ultimaTransicao: UltimaTransicaoMultiplicador;
    };

export const ESTADO_MULTIPLICADOR_INICIAL: EstadoMultiplicadorPdv = {
  status: "inativo",
  ultimaTransicao: "inicial",
};

export type EventoMultiplicadorPdv =
  | { tipo: "INICIAR"; teclaInicial?: string }
  | { tipo: "DIGITAR_TECLA"; tecla: string }
  | { tipo: "DEFINIR_RASCUNHO"; rascunho: string }
  | { tipo: "BACKSPACE" }
  | { tipo: "LIMPAR_RASCUNHO" }
  | { tipo: "ARMAR" }
  | { tipo: "REGISTRAR_ERRO_LEITURA"; erro: string }
  | { tipo: "CONSUMIR" }
  | { tipo: "CANCELAR" }
  | { tipo: "CONVERTER_PARA_BUSCA_X" };

export type ResultadoTransicaoMultiplicador = {
  estado: EstadoMultiplicadorPdv;
  /** Quando preenchido, sai do multiplicador e transfere os caracteres para a busca textual */
  converterParaTermoBusca?: string;
};

/** Arredonda quantidades em milésimos (escala 3 do banco) eliminando ruído de ponto flutuante IEEE-754 */
export function normalizarQtdPdv(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  const sinal = valor < 0 ? -1 : 1;
  return sinal * (Math.round((Math.abs(valor) + Number.EPSILON) * 1000) / 1000);
}

/** Formata quantidade em pt-BR sem zeros supérfluos (ex.: 5 → "5", 1.5 → "1,5", 0.25 → "0,25") */
export function formatarQtdPdv(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: CASAS_DECIMAIS_MAX_PDV,
  }).format(normalizarQtdPdv(valor));
}

/** Gera o texto oficial do indicador visível e acessível quando a quantidade está armada */
export function rotuloMultiplicadorArmado(quantidade: number): string {
  return `Próximo item × ${formatarQtdPdv(quantidade)}`;
}

export type ValidacaoQuantidadeMultiplicador =
  | { ok: true; quantidade: number; temDecimal: boolean; textoFormatado: string }
  | { ok: false; erro: string };

/**
 * Valida o texto digitado no modo quantidade antes de armar com Enter.
 * Rejeita vazio, zero, negativo, acima de LIMITE_MAX_MULTIPLICADOR, sintaxe inválida e > 3 casas decimais.
 */
export function validarTextoQuantidadeMultiplicador(rascunho: string): ValidacaoQuantidadeMultiplicador {
  const bruto = String(rascunho ?? "").trim();

  if (!bruto) {
    return { ok: false, erro: "Digite a quantidade antes de pressionar Enter." };
  }

  if (bruto.startsWith("-")) {
    return { ok: false, erro: "A quantidade não pode ser negativa." };
  }

  if (!/^\d+([.,]\d+)?$/.test(bruto)) {
    return { ok: false, erro: "Quantidade inválida. Use números como 5 ou 1,5." };
  }

  const normalizadoTexto = bruto.replace(",", ".");
  const partes = normalizadoTexto.split(".");
  const casasDecimais = partes[1]?.length ?? 0;

  if (casasDecimais > CASAS_DECIMAIS_MAX_PDV) {
    return { ok: false, erro: `Use no máximo ${CASAS_DECIMAIS_MAX_PDV} casas decimais (ex.: 1,250).` };
  }

  const numeroBruto = Number(normalizadoTexto);
  if (!Number.isFinite(numeroBruto) || numeroBruto <= 0) {
    return { ok: false, erro: "A quantidade deve ser maior que zero." };
  }

  if (numeroBruto > LIMITE_MAX_MULTIPLICADOR) {
    return { ok: false, erro: "Quantidade máxima por leitura é 9.999." };
  }

  const quantidade = normalizarQtdPdv(numeroBruto);
  if (quantidade <= 0) {
    return { ok: false, erro: "A quantidade deve ser maior que zero." };
  }

  return {
    ok: true,
    quantidade,
    temDecimal: !Number.isInteger(quantidade),
    textoFormatado: formatarQtdPdv(quantidade),
  };
}

/**
 * Verifica se o evento `X`/`x` deve iniciar o modo multiplicador.
 * Nunca dispara em modais, outros inputs/textareas, composição IME, atalhos com modificadores,
 * quando já há texto na busca ou quando já existe quantidade armada/em edição.
 */
export function podeIniciarMultiplicadorPdv(ctx: {
  estadoAtual: EstadoMultiplicadorPdv;
  algumModalAberto: boolean;
  editandoItem: boolean;
  focoNaBipagem: boolean;
  termoBusca: string;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (ctx.estadoAtual.status !== "inativo") return false;
  if (ctx.algumModalAberto || ctx.editandoItem) return false;
  if (!ctx.focoNaBipagem) return false;
  if (ctx.termoBusca !== "") return false;
  if (ctx.isComposing || ctx.keyCode === 229) return false;
  if (ctx.ctrlKey || ctx.metaKey || ctx.altKey) return false;
  return ctx.key === "x" || ctx.key === "X";
}

/**
 * Máquina de estados pura e determinística do multiplicador de quantidade.
 */
export function transicionarMultiplicadorPdv(
  estado: EstadoMultiplicadorPdv,
  evento: EventoMultiplicadorPdv,
): ResultadoTransicaoMultiplicador {
  switch (evento.tipo) {
    case "INICIAR": {
      if (estado.status !== "inativo") return { estado };
      const teclaInicial: "x" | "X" = evento.teclaInicial === "X" ? "X" : "x";
      return {
        estado: {
          status: "digitando",
          rascunho: "",
          teclaInicial,
          erro: null,
          ultimaTransicao: "iniciada",
        },
      };
    }

    case "CONVERTER_PARA_BUSCA_X": {
      if (estado.status !== "digitando") return { estado };
      return {
        estado: { status: "inativo", ultimaTransicao: "convertida_busca" },
        converterParaTermoBusca: `${estado.teclaInicial}${estado.rascunho}`,
      };
    }

    case "DIGITAR_TECLA": {
      if (estado.status !== "digitando") return { estado };
      const t = evento.tecla;

      // Se o operador digitou X e em seguida letra ou espaço (ex.: "Xampu", "Xarope", "X-Salada", "X Tudo"),
      // devolve automaticamente para a busca textual sem perder nenhuma tecla!
      if ((estado.rascunho === "" || estado.rascunho === "-") && /^[a-zA-ZÀ-ÿ ]$/.test(t)) {
        return {
          estado: { status: "inativo", ultimaTransicao: "convertida_busca" },
          converterParaTermoBusca: `${estado.teclaInicial}${estado.rascunho}${t}`,
        };
      }

      if (/^[0-9.,]$/.test(t) || (t === "-" && estado.rascunho === "")) {
        const proximo = (estado.rascunho + t).slice(0, 12);
        return {
          estado: {
            ...estado,
            rascunho: proximo,
            erro: null,
            ultimaTransicao: "editada",
          },
        };
      }

      if (t.length === 1) {
        return {
          estado: {
            ...estado,
            erro: "Digite apenas números para a quantidade (ex.: 5 ou 1,5).",
            ultimaTransicao: "rejeitada",
          },
        };
      }

      return { estado };
    }

    case "DEFINIR_RASCUNHO": {
      if (estado.status !== "digitando") return { estado };
      const limpo = String(evento.rascunho ?? "").slice(0, 12);
      if ((estado.rascunho === "" || estado.rascunho === "-") && /^[a-zA-ZÀ-ÿ ]/.test(limpo)) {
        return {
          estado: { status: "inativo", ultimaTransicao: "convertida_busca" },
          converterParaTermoBusca: `${estado.teclaInicial}${estado.rascunho}${limpo}`,
        };
      }
      return {
        estado: {
          ...estado,
          rascunho: limpo,
          erro: null,
          ultimaTransicao: "editada",
        },
      };
    }

    case "BACKSPACE": {
      if (estado.status !== "digitando") return { estado };
      return {
        estado: {
          ...estado,
          rascunho: estado.rascunho.slice(0, -1),
          erro: null,
          ultimaTransicao: "editada",
        },
      };
    }

    case "LIMPAR_RASCUNHO": {
      if (estado.status !== "digitando") return { estado };
      return {
        estado: {
          ...estado,
          rascunho: "",
          erro: null,
          ultimaTransicao: "editada",
        },
      };
    }

    case "ARMAR": {
      if (estado.status !== "digitando") return { estado };
      const val = validarTextoQuantidadeMultiplicador(estado.rascunho);
      if (!val.ok) {
        return {
          estado: {
            ...estado,
            erro: val.erro,
            ultimaTransicao: "rejeitada",
          },
        };
      }
      return {
        estado: {
          status: "armado",
          quantidade: val.quantidade,
          temDecimal: val.temDecimal,
          rotulo: rotuloMultiplicadorArmado(val.quantidade),
          erro: null,
          ultimaTransicao: "armada",
        },
      };
    }

    case "REGISTRAR_ERRO_LEITURA": {
      if (estado.status !== "armado") return { estado };
      return {
        estado: {
          ...estado,
          erro: evento.erro,
          ultimaTransicao: "mantida_erro",
        },
      };
    }

    case "CONSUMIR": {
      if (estado.status === "inativo") return { estado };
      return {
        estado: {
          status: "inativo",
          ultimaTransicao: "consumida",
        },
      };
    }

    case "CANCELAR": {
      if (estado.status === "inativo") return { estado };
      return {
        estado: {
          status: "inativo",
          ultimaTransicao: "cancelada",
        },
      };
    }
  }
}

export type ResultadoAdicaoItemPdv =
  | {
      ok: true;
      linhas: LinhaItemPdv[];
      qtdAplicada: number;
      qtdFinalLinha: number;
      abrirEdicaoId: string | null;
    }
  | {
      ok: false;
      erro: string;
    };

/**
 * Aplica adição de produto novo ou já existente respeitando `qtd`, arredondamento exato
 * em 3 casas decimais, regra de produto pesável vs unitário e limite de estoque disponível.
 */
export function aplicarAdicaoItemPdv(
  linhasAtuais: readonly LinhaItemPdv[],
  produto: ProdutoAdicaoPdv,
  qtdExplicita?: number,
): ResultadoAdicaoItemPdv {
  const estoqueDisponivel = normalizarQtdPdv(Number(produto.estoque ?? 0));
  const ehPesavelSemQtd = (qtdExplicita === undefined || qtdExplicita === 0) && Boolean(produto.pesavel);

  if (ehPesavelSemQtd) {
    if (estoqueDisponivel <= 0) {
      return {
        ok: false,
        erro: `Estoque zerado para "${produto.nome}" (saldo ${formatarQtdPdv(Math.max(0, estoqueDisponivel))} ${produto.unidade}).`,
      };
    }

    const idxExistente = linhasAtuais.findIndex((l) => l.produtoId === produto.id);
    if (idxExistente >= 0) {
      // Produto pesável já na lista sem multiplicador: abre edição inline sem sobrescrever o peso já válido
      return {
        ok: true,
        linhas: [...linhasAtuais],
        qtdAplicada: 0,
        qtdFinalLinha: normalizarQtdPdv(linhasAtuais[idxExistente].qtd),
        abrirEdicaoId: produto.id,
      };
    }

    const novaLinha: LinhaItemPdv = {
      produtoId: produto.id,
      nome: produto.nome,
      qtd: 0,
      preco: produto.preco,
      unidade: produto.unidade,
      estoque: estoqueDisponivel,
      pesavel: Boolean(produto.pesavel),
    };
    return {
      ok: true,
      linhas: [...linhasAtuais, novaLinha],
      qtdAplicada: 0,
      qtdFinalLinha: 0,
      abrirEdicaoId: produto.id,
    };
  }

  const qtdBruta = qtdExplicita ?? 1;
  if (!Number.isFinite(qtdBruta) || qtdBruta <= 0) {
    return { ok: false, erro: "A quantidade deve ser maior que zero." };
  }

  if (qtdBruta > LIMITE_MAX_MULTIPLICADOR) {
    return { ok: false, erro: "Quantidade máxima por leitura é 9.999." };
  }

  if (Math.abs(qtdBruta * 1000 - Math.round(qtdBruta * 1000)) > 1e-6) {
    return { ok: false, erro: `Use no máximo ${CASAS_DECIMAIS_MAX_PDV} casas decimais.` };
  }

  const qtdSomar = normalizarQtdPdv(qtdBruta);
  if (!produto.pesavel && !Number.isInteger(qtdSomar)) {
    return {
      ok: false,
      erro: `"${produto.nome}" é vendido por ${produto.unidade || "UN"} e não permite quantidade fracionada.`,
    };
  }

  const idx = linhasAtuais.findIndex((l) => l.produtoId === produto.id);
  const qtdAnterior = idx >= 0 ? normalizarQtdPdv(linhasAtuais[idx].qtd) : 0;
  const novaQtdTotal = normalizarQtdPdv(qtdAnterior + qtdSomar);

  if (estoqueDisponivel <= 0 || novaQtdTotal > estoqueDisponivel) {
    return {
      ok: false,
      erro: `Estoque insuficiente de "${produto.nome}": solicitado ${formatarQtdPdv(novaQtdTotal)} ${produto.unidade}, disponível ${formatarQtdPdv(Math.max(0, estoqueDisponivel))} ${produto.unidade}.`,
    };
  }

  if (idx >= 0) {
    const copia = [...linhasAtuais];
    copia[idx] = {
      ...copia[idx],
      qtd: novaQtdTotal,
      estoque: estoqueDisponivel,
    };
    return {
      ok: true,
      linhas: copia,
      qtdAplicada: qtdSomar,
      qtdFinalLinha: novaQtdTotal,
      abrirEdicaoId: null,
    };
  }

  const novaLinha: LinhaItemPdv = {
    produtoId: produto.id,
    nome: produto.nome,
    qtd: novaQtdTotal,
    preco: produto.preco,
    unidade: produto.unidade,
    estoque: estoqueDisponivel,
    pesavel: Boolean(produto.pesavel),
  };

  return {
    ok: true,
    linhas: [...linhasAtuais, novaLinha],
    qtdAplicada: qtdSomar,
    qtdFinalLinha: novaQtdTotal,
    abrirEdicaoId: null,
  };
}

/**
 * Localiza o produto ao pressionar Enter na busca/bipagem:
 * prioriza casamento exato por GTIN ou SKU (leitor de código + Enter) e cai para o item destacado na lista.
 */
export function resolverProdutoPorCodigoOuBusca<T extends { gtin: string; sku: string }>(
  ativos: readonly T[],
  termo: string,
  resultados: readonly T[],
  cursor: number,
): T | null {
  const limpo = String(termo ?? "").trim();
  if (limpo) {
    const soDig = limpo.replace(/\D/g, "");
    const exatoGtin =
      soDig.length >= 8 && /^\d+$/.test(limpo.replace(/\s+/g, ""))
        ? ativos.find((p) => p.gtin && p.gtin !== "SEM GTIN" && p.gtin === soDig)
        : undefined;
    if (exatoGtin) return exatoGtin;

    const exatoSku = ativos.find((p) => p.sku && p.sku.toLowerCase() === limpo.toLowerCase());
    if (exatoSku) return exatoSku;
  }

  return resultados[cursor] ?? resultados[0] ?? null;
}
