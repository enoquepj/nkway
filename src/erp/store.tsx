import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  gerarChave,
  seed,
  uid,
  type Cliente,
  type DB,
  type Entrada,
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
  delCliente: (id: string) => void;
  registrarVenda: (v: Omit<Venda, "id" | "numero" | "data">) => void;
  faturarDav: (
    id: string,
    info: { modelo: ModeloFiscal; pagamento: Venda["pagamento"] },
  ) => void;
  cancelarVenda: (id: string) => void;
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
  addLancamento: (l: Omit<Lancamento, "id">) => void;
  toggleLancamento: (id: string) => void;
  delLancamento: (id: string) => void;
  reset: () => void;
};

const StoreCtx = createContext<Ctx | null>(null);
const KEY = "nkway.db.v1";

const proximaNota = (s: DB) =>
  s.vendas.filter((v) => v.fiscal).length + 1;

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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as DB) : seed;
    } catch {
      return seed;
    }
  });

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(db));
  }, [db]);

  const value: Ctx = {
    db,
    addProduto: (p) => setDb((s) => ({ ...s, produtos: [{ ...p, id: uid() }, ...s.produtos] })),
    updProduto: (p) =>
      setDb((s) => ({ ...s, produtos: s.produtos.map((x) => (x.id === p.id ? p : x)) })),
    delProduto: (id) => setDb((s) => ({ ...s, produtos: s.produtos.filter((x) => x.id !== id) })),
    addCliente: (c) => setDb((s) => ({ ...s, clientes: [{ ...c, id: uid() }, ...s.clientes] })),
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

    cancelarVenda: (id) =>
      setDb((s) => ({
        ...s,
        vendas: s.vendas.map((v) => (v.id === id ? { ...v, status: "cancelado" } : v)),
      })),
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
