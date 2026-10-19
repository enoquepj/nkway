import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  gerarChave,
  proximaNotaFiscal,
  seed,
  uid,
  type Cancelamento,
  type Cliente,
  type ConfigFiscal,
  type DB,
  type Entrada,
  type Devolucao,
  type Fornecedor,
  type ItemEntrada,
  type Lancamento,
  type MDFe,
  type ModeloFiscal,
  type Movimento,
  type Produto,
  type TipoMov,
  type Venda,
} from "./types";

type Ctx = {
  db: DB;
  addProduto: (p: Omit<Produto, "id">) => void;
  updProduto: (p: Produto) => void;
  delProduto: (id: string) => void;
  addCliente: (c: Omit<Cliente, "id">) => void;
  updCliente: (c: Cliente) => void;
  delCliente: (id: string) => void;
  registrarVenda: (v: Omit<Venda, "id" | "numero" | "data">) => void;
  faturarDav: (
    id: string,
    info: { modelo: ModeloFiscal; pagamento: Venda["pagamento"] },
  ) => void;
  cancelarVenda: (id: string, motivo?: string) => void;
  /** Inutiliza um intervalo de numeração fiscal (SEFAZ exige quudo um número pula sem nota) */
  inutilizar: (inicio: number, fim: number, justificativa: string) => void;
  addEntrada: (e: Entrada) => void;
  lancarEntrada: (id: string) => void;
  delEntrada: (id: string) => void;
  ajustarEstoque: (
    produtoId: string,
    novaQtd: number,
    tipo: TipoMov,
    obs: string,
  ) => void;
  emitirMdfe: (m: Omit<MDFe, "id" | "numero" | "chave" | "protocolo" | "status" | "emitidoEm">) => void;
  encerrarMdfe: (id: string) => void;
  setConfigFiscal: (c: ConfigFiscal) => void;
  addFornecedor: (f: Fornecedor) => void;
  updFornecedor: (f: Fornecedor) => void;
  delFornecedor: (id: string) => void;
  /** Emite NF-e de devolução, baixa estoque e estorna o contas a pagar */
  devolverEntrada: (
    entradaId: string,
    itens: ItemEntrada[],
  ) => void;
  addLancamento: (l: Omit<Lancamento, "id">) => void;
  toggleLancamento: (id: string) => void;
  delLancamento: (id: string) => void;
  reset: () => void;
};

const StoreCtx = createContext<Ctx | null>(null);
const KEY_BASE = "nkway.db.v1";

const proximaNota = (s: DB) => proximaNotaFiscal(s.vendas, s.inutilizacoes);

/** Efeitos colaterais de uma venda faturada: baixa de estoque e financeiro */
function efeitos(s: DB, venda: Venda) {
  const movimentos: Movimento[] = [];
  const produtos = s.produtos.map((p) => {
    const item = venda.itens.find((i) => i.produtoId === p.id);
    if (!item) return p;
    const saldo = Math.max(0, p.estoque - item.qtd);
    movimentos.push({
      id: uid(),
      produtoId: p.id,
      produtoNome: p.nome,
      tipo: "venda",
      qtd: -item.qtd,
      saldoApos: saldo,
      custoUnit: p.custo,
      documento: `${venda.fiscal?.modelo ?? "Venda"} #${venda.numero}`,
      observacao: venda.clienteNome,
      data: Date.now(),
    });
    return { ...p, estoque: saldo };
  });
  const aPrazo = venda.pagamento === "boleto" || venda.pagamento === "prazo";
  const lancamentos = aPrazo
    ? [
        {
          id: uid(),
          descricao: `Venda #${venda.numero} — ${venda.clienteNome}`,
          valor: venda.total,
          tipo: "receber" as const,
          vencimento: new Date(Date.now() + 2592e6).toISOString().slice(0, 10),
          pago: false,
          categoria: "Vendas",
        },
        ...s.lancamentos,
      ]
    : s.lancamentos;
  return { produtos, lancamentos, movimentos: [...movimentos, ...s.movimentos] };
}

export function StoreProvider({
  empresaId,
  children,
}: {
  empresaId: string;
  children: ReactNode;
}) {
  // No modo demo os dados são isolados por empresa — cada empresa só enxerga
  // a própria base, evitando vazamento entre contas no mesmo navegador.
  const KEY = `${KEY_BASE}.${empresaId}`;

  const [db, setDb] = useState<DB>(() => {
    try {
      const porEmpresa = localStorage.getItem(KEY);
      if (porEmpresa) return JSON.parse(porEmpresa) as DB;
      // Migração única: se existir a chave antiga compartilhada, copia pra
      // esta empresa uma única vez (não apaga a original).
      const legada = localStorage.getItem(KEY_BASE);
      if (legada) return JSON.parse(legada) as DB;
      return seed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      /* quota estourada — ignora em vez de quebrar a tela */
    }
  }, [KEY, db]);

  const value: Ctx = {
    db,
    addProduto: (p) => setDb((s) => ({ ...s, produtos: [{ ...p, id: uid() }, ...s.produtos] })),
    updProduto: (p) =>
      setDb((s) => ({ ...s, produtos: s.produtos.map((x) => (x.id === p.id ? p : x)) })),
    delProduto: (id) => setDb((s) => ({ ...s, produtos: s.produtos.filter((x) => x.id !== id) })),
    addCliente: (c) => setDb((s) => ({ ...s, clientes: [{ ...c, id: uid() }, ...s.clientes] })),
    updCliente: (c) =>
      setDb((s) => ({ ...s, clientes: s.clientes.map((x) => (x.id === c.id ? c : x)) })),
    delCliente: (id) => setDb((s) => ({ ...s, clientes: s.clientes.filter((x) => x.id !== id) })),
    registrarVenda: (v) =>
      setDb((s) => {
        const numero = (s.vendas[0]?.numero ?? 1000) + 1;
        const venda: Venda = { ...v, id: uid(), numero, data: Date.now() };
        // DAV não movimenta estoque nem financeiro — é apenas um documento de venda
        if (venda.tipo === "dav")
          return { ...s, vendas: [venda, ...s.vendas] };
        return { ...s, vendas: [venda, ...s.vendas], ...efeitos(s, venda) };
      }),

    faturarDav: (id, fiscalInfo) =>
      setDb((s) => {
        const dav = s.vendas.find((x) => x.id === id);
        if (!dav || dav.status !== "aberto") return s;
        const numeroNota = proximaNota(s);
        const venda: Venda = {
          ...dav,
          tipo: "fiscal",
          status: "faturado",
          pagamento: fiscalInfo.pagamento,
          fiscal: {
            modelo: fiscalInfo.modelo,
            serie: "001",
            numeroNota,
            chave: gerarChave(numeroNota),
            protocolo: `135${Date.now()}`.slice(0, 15),
            autorizadaEm: Date.now(),
          },
        };
        return {
          ...s,
          vendas: s.vendas.map((x) => (x.id === id ? venda : x)),
          ...efeitos(s, venda),
        };
      }),

    cancelarVenda: (id, motivo?) =>
      setDb((s) => {
        const venda = s.vendas.find((v) => v.id === id);
        if (!venda || venda.status === "cancelado") return s;

        const isFiscal = venda.tipo === "fiscal" && !!venda.fiscal;
        const agora = Date.now();
        const limiteMs = s.configFiscal.ambiente === 2 ? 24 * 3600e3 : 30 * 60e3;
        const expirou = isFiscal && agora - (venda.fiscal?.autorizadaEm ?? venda.data) > limiteMs;
        if (expirou) return s; // SEFAZ: prazo para cancelamento expirado

        // devolve o estoque dos itens (apenas se a venda foi faturada)
        const produtos =
          venda.status === "faturado"
            ? s.produtos.map((p) => {
                const item = venda.itens.find((i) => i.produtoId === p.id);
                return item ? { ...p, estoque: p.estoque + item.qtd } : p;
              })
            : s.produtos;

        const movimentos: Movimento[] =
          venda.status === "faturado"
            ? venda.itens.map((i) => {
                const p = produtos.find((x) => x.id === i.produtoId)!;
                return {
                  id: uid(),
                  produtoId: i.produtoId,
                  produtoNome: i.nome,
                  tipo: "devolucao" as const,
                  qtd: i.qtd,
                  saldoApos: p.estoque,
                  custoUnit: i.preco,
                  documento: `Cancelamento ${venda.fiscal?.modelo ?? "Venda"} #${venda.numero}`,
                  observacao: motivo ?? "venda cancelada",
                  data: agora,
                };
              })
            : [];

        // estorna financeiro: dispara título a receber aberto
        const lancamentos = s.lancamentos.map((l) =>
          l.tipo === "receber" && !l.pago && l.descricao.includes(`#${venda.numero}`)
            ? { ...l, pago: true }
            : l,
        );

        const eventoCancelamento: Cancelamento | null = isFiscal
          ? {
              vendaId: id,
              motivo: motivo ?? "Venda efetuada por erro no PDV",
              numeroEvento: s.cancelamentos.length + 1,
              protocolo: `135${agora}`.slice(0, 15),
              autenticadoEm: agora,
            }
          : null;

        return {
          ...s,
          produtos,
          movimentos: [...movimentos, ...s.movimentos],
          lancamentos,
          cancelamentos: eventoCancelamento
            ? [eventoCancelamento, ...s.cancelamentos]
            : s.cancelamentos,
          vendas: s.vendas.map((v) =>
            v.id === id ? { ...v, status: "cancelado" as const } : v,
          ),
        };
      }),
    // ------------------------------------------------ ENTRADA DE MERCADORIA
    addEntrada: (e) => setDb((s) => ({ ...s, entradas: [e, ...s.entradas] })),

    delEntrada: (id) =>
      setDb((s) => ({ ...s, entradas: s.entradas.filter((e) => e.id !== id) })),

    /** Lança a nota: cria/atualiza produtos, soma estoque, gera movimentos e conta a pagar */
    lancarEntrada: (id) =>
      setDb((s) => {
        const ent = s.entradas.find((e) => e.id === id);
        if (!ent || ent.status === "lancada") return s;

        const produtos = [...s.produtos];
        const movimentos: Movimento[] = [];

        ent.itens.forEach((item) => {
          // casa por id, senão por SKU, senão cria novo produto
          let idx = item.produtoId
            ? produtos.findIndex((p) => p.id === item.produtoId)
            : produtos.findIndex(
                (p) => p.sku && item.sku && p.sku.toLowerCase() === item.sku.toLowerCase(),
              );

          if (idx === -1) {
            const novo: Produto = {
              id: uid(),
              nome: item.nome,
              sku: item.sku,
              categoria: "Importado XML",
              custo: item.custo,
              preco: item.preco,
              estoque: 0,
              estoqueMin: 0,
              gtin: item.gtin || "SEM GTIN",
              unidade: item.unidade || "UN",
              marca: "",
              impostos: {
                ncm: item.ncm || "61091000",
                cest: "",
                cfop: item.cfop || "5102",
                cstIcms: "00",
                csosn: "101",
                icmsAliq: 18,
                icmsReducao: 0,
                cstIpi: "55",
                ipiAliq: 0,
                cstPis: "01",
                pisAliq: 1.65,
                cstCofins: "01",
                cofinsAliq: 7.6,
                origemMercadoria: 0,
                cbsAliq: 0.9,
                ibsAliq: 0.1,
              },
            };
            produtos.push(novo);
            idx = produtos.length - 1;
          }

          const p = produtos[idx];
          // custo médio ponderado
          const qtdTotal = p.estoque + item.qtd;
          const custoMedio =
            qtdTotal > 0
              ? (p.estoque * p.custo + item.qtd * item.custo) / qtdTotal
              : item.custo;

          produtos[idx] = {
            ...p,
            estoque: qtdTotal,
            custo: Math.round(custoMedio * 100) / 100,
            preco: item.preco || p.preco,
            gtin: item.gtin || p.gtin,
            unidade: item.unidade || p.unidade,
          };

          movimentos.push({
            id: uid(),
            produtoId: p.id,
            produtoNome: p.nome,
            tipo: "entrada",
            qtd: item.qtd,
            saldoApos: qtdTotal,
            custoUnit: item.custo,
            documento: `NF-e ${ent.numeroNota}`,
            observacao: ent.fornecedor,
            data: Date.now(),
          });
        });

        const lancamentos = ent.gerarFinanceiro
          ? [
              {
                id: uid(),
                descricao: `NF-e ${ent.numeroNota} — ${ent.fornecedor}`,
                valor: ent.total,
                tipo: "pagar" as const,
                vencimento: new Date(Date.now() + 2592e6).toISOString().slice(0, 10),
                pago: false,
                categoria: "Compras",
              },
              ...s.lancamentos,
            ]
          : s.lancamentos;

        return {
          ...s,
          produtos,
          lancamentos,
          movimentos: [...movimentos, ...s.movimentos],
          entradas: s.entradas.map((e) =>
            e.id === id ? { ...e, status: "lancada" as const } : e,
          ),
        };
      }),

    // ------------------------------------------------------- AJUSTE ESTOQUE
    ajustarEstoque: (produtoId, novaQtd, tipo, obs) =>
      setDb((s) => {
        const p = s.produtos.find((x) => x.id === produtoId);
        if (!p) return s;
        const delta = novaQtd - p.estoque;
        if (delta === 0) return s;
        return {
          ...s,
          produtos: s.produtos.map((x) =>
            x.id === produtoId ? { ...x, estoque: novaQtd } : x,
          ),
          movimentos: [
            {
              id: uid(),
              produtoId,
              produtoNome: p.nome,
              tipo,
              qtd: delta,
              saldoApos: novaQtd,
              custoUnit: p.custo,
              documento: tipo === "inventario" ? "Inventário" : "Ajuste manual",
              observacao: obs,
              data: Date.now(),
            },
            ...s.movimentos,
          ],
        };
      }),

    // ---------------------------------------------------------------- MDF-e
    emitirMdfe: (m) =>
      setDb((s) => {
        const numero = (s.mdfes[0]?.numero ?? 0) + 1;
        return {
          ...s,
          mdfes: [
            {
              ...m,
              id: uid(),
              numero,
              chave: gerarChave(numero),
              protocolo: `141${Date.now()}`.slice(0, 15),
              status: "autorizado",
              emitidoEm: Date.now(),
            },
            ...s.mdfes,
          ],
        };
      }),

    encerrarMdfe: (id) =>
      setDb((s) => ({
        ...s,
        mdfes: s.mdfes.map((m) =>
          m.id === id ? { ...m, status: "encerrado" as const, encerradoEm: Date.now() } : m,
        ),
      })),

    setConfigFiscal: (c) => setDb((s) => ({ ...s, configFiscal: c })),

    inutilizar: (inicio, fim, justificativa) =>
      setDb((s) => {
        if (inicio > fim || inicio < 1) return s;
        const agora = Date.now();
        return {
          ...s,
          inutilizacoes: [
            {
              id: uid(),
              inicio,
              fim,
              justificativa,
              protocolo: `135${agora}`.slice(0, 15),
              chave: `INUT${String(inicio).padStart(9, "0")}${String(fim).padStart(9, "0")}`,
              autorizadaEm: agora,
              ...({}),
            },
            ...s.inutilizacoes,
          ],
        };
      }),

    devolverEntrada: (entradaId, itens) =>
      setDb((s) => {
        const entrada = s.entradas.find((e) => e.id === entradaId);
        if (!entrada || entrada.status !== "lancada") return s;

        const numero = (s.devolucoes[0]?.numero ?? 0) + 1;
        const total = itens.reduce((x, i) => x + i.qtd * i.custo, 0);
        const fornecedor = s.fornecedores.find((f) =>
          entrada.fornecedor.includes(f.nome.split(" ")[0]),
        );
        const mesmaUf = (fornecedor?.uf ?? s.configFiscal.ufPadrao) === s.configFiscal.ufPadrao;

        // 1. Baixa o estoque com movimento de devolução
        const produtos = s.produtos.map((p) => {
          const item = itens.find((i) => i.sku === p.sku);
          if (!item) return p;
          return { ...p, estoque: Math.max(0, p.estoque - item.qtd) };
        });
        const movimentos: Movimento[] = itens.map((i) => {
          const p = s.produtos.find((x) => x.sku === i.sku);
          return {
            id: uid(),
            produtoId: p?.id ?? "",
            produtoNome: i.nome,
            tipo: "devolucao" as const,
            qtd: -i.qtd,
            saldoApos: Math.max(0, (p?.estoque ?? 0) - i.qtd),
            custoUnit: i.custo,
            documento: `Devolução #${numero} (NF-e ${entrada.numeroNota})`,
            observacao: entrada.fornecedor,
            data: Date.now(),
          };
        });

        // 2. Estorno no contas a pagar: libera título aberto se houver, senão vira a receber
        const tituloAberto = s.lancamentos.find(
          (l) =>
            l.tipo === "pagar" &&
            !l.pago &&
            l.descricao.includes(entrada.numeroNota) &&
            l.valor >= total - 0.01,
        );
        let lancamentos;
        let estorno: Devolucao["estorno"];
        if (tituloAberto && Math.abs(tituloAberto.valor - total) < 0.01) {
          // mesma nota e valor exato → baixa automática (tá pago e cancela a nota)
          lancamentos = s.lancamentos.map((l) =>
            l.id === tituloAberto.id ? { ...l, pago: true } : l,
          );
          estorno = "estorno_pagar";
        } else if (tituloAberto) {
          // valor parcial → reduz o título
          lancamentos = s.lancamentos.map((l) =>
            l.id === tituloAberto.id
              ? { ...l, valor: Math.round((l.valor - total) * 100) / 100 }
              : l,
          );
          estorno = "estorno_pagar";
        } else {
          // já foi pago → fornecedor deve devolver dinheiro (a receber)
          lancamentos = [
            {
              id: uid(),
              descricao: `Devolução NF-e ${entrada.numeroNota} — ${entrada.fornecedor}`,
              valor: total,
              tipo: "receber" as const,
              vencimento: new Date(Date.now() + 1296e6).toISOString().slice(0, 10),
              pago: false,
              categoria: "Devoluções",
            },
            ...s.lancamentos,
          ];
          estorno = "a_receber";
        }

        const devolucao: Devolucao = {
          id: uid(),
          numero,
          fornecedor: entrada.fornecedor,
          cnpjFornecedor: fornecedor?.cnpj ?? entrada.cnpjFornecedor,
          itens,
          total,
          chaveReferente: entrada.chave,
          cfop: mesmaUf ? "5201" : "6201",
          chave: gerarChave(numero),
          protocolo: `135${Date.now()}`.slice(0, 15),
          emitidoEm: Date.now(),
          estorno,
          entradaId,
        };

        return {
          ...s,
          produtos,
          lancamentos,
          movimentos: [...movimentos, ...s.movimentos],
          devolucoes: [devolucao, ...s.devolucoes],
        };
      }),

    addFornecedor: (f) => setDb((s) => ({ ...s, fornecedores: [f, ...s.fornecedores] })),
    updFornecedor: (f) =>
      setDb((s) => ({ ...s, fornecedores: s.fornecedores.map((x) => (x.id === f.id ? f : x)) })),
    delFornecedor: (id) =>
      setDb((s) => ({ ...s, fornecedores: s.fornecedores.filter((x) => x.id !== id) })),

    addLancamento: (l) =>
      setDb((s) => ({ ...s, lancamentos: [{ ...l, id: uid() }, ...s.lancamentos] })),
    toggleLancamento: (id) =>
      setDb((s) => ({
        ...s,
        lancamentos: s.lancamentos.map((l) => (l.id === id ? { ...l, pago: !l.pago } : l)),
      })),
    delLancamento: (id) =>
      setDb((s) => ({ ...s, lancamentos: s.lancamentos.filter((l) => l.id !== id) })),
    reset: () => setDb(seed),
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore fora do provider");
  return ctx;
}
