"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Campo, Card, Icon, Input, Modal, Select, cn, useToast } from "@/components/ui";
import { registrarVenda, type ItemPdv, type Pagamento } from "@/server/acoes/pdv";
import {
  FORMAS_PAGAMENTO,
  moeda,
  hojeISO,
  formatChave,
  round2,
  somaDias,
  tributosEstimados,
} from "@/lib/dominio";
import type { ProdutoDto } from "@/server/dados";

type Linha = { produtoId: string; nome: string; qtd: number; preco: number; unidade: string; estoque: number; pesavel: boolean };
type ClienteOpcao = { id: string; nome: string; documento: string; condicaoPadrao: string; limiteCredito: number; saldoEmAberto: number };
type Cupom = {
  total: number;
  troco: number;
  numeroNota: number | null;
  chave: string | null;
  documento: string;
  forma: string;
};

const CHAVE_FILA = "nkway.fila";

export function PdvView({
  produtos,
  clientes,
  empresa,
}: {
  produtos: ProdutoDto[];
  clientes: ClienteOpcao[];
  empresa: { nome: string; fantasia: string; cnpj: string; documento: string; endereco: string; municipio: string; ambiente: string };
}) {
  const toast = useToast();
  const router = useRouter();
  const ativos = useMemo(() => produtos.filter((p) => p.ativo), [produtos]);
  const porId = useMemo(() => new Map(ativos.map((p) => [p.id, p])), [ativos]);

  const [termo, setTermo] = useState("");
  const [cursor, setCursor] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [descontoModo, setDescontoModo] = useState<"real" | "percentual">("real");
  const [descontoValor, setDescontoValor] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [recebido, setRecebido] = useState("");
  const [modelo, setModelo] = useState<"NFC-e" | "NF-e" | "SAT">("NFC-e");
  const [validadeDav, setValidadeDav] = useState(somaDias(hojeISO(), 3));
  const [cupom, setCupom] = useState<Cupom | null>(null);
  const [abertoCliente, setAbertoCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fila, setFila] = useState<number>(0);
  const [editando, setEditando] = useState<string | null>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    buscaRef.current?.focus();
    try {
      setFila(JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]").length);
    } catch {
      /* sem fila */
    }
  }, []);

  const resultados = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return ativos.slice(0, 8);
    const digitado = t.replace(/\s+/g, " ");
    return ativos
      .map((p) => {
        const nome = p.nome.toLowerCase();
        let pontos = -1;
        if (p.gtin && digitado.length >= 8 && p.gtin.includes(digitado)) pontos = 1000;
        else if (p.sku.toLowerCase().startsWith(digitado)) pontos = 800;
        else if (nome.startsWith(digitado)) pontos = 500 + (digitado.length * 2);
        else if (nome.includes(digitado)) pontos = 200;
        else if (nome.split(" ").some((w) => w.startsWith(digitado.split(" ")[0]))) pontos = 60;
        if (pontos < 0) return null;
        return { p, pontos: pontos + Math.min(50, p.estoque) };
      })
      .filter((x): x is { p: ProdutoDto; pontos: number } => !!x)
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 10)
      .map((x) => x.p);
  }, [termo, ativos]);

  const subtotal = round2(linhas.reduce((s, l) => s + l.qtd * l.preco, 0));
  const desconto = round2(
    Math.min(subtotal, descontoModo === "percentual" ? (subtotal * (Number(descontoValor.replace(",", ".")) || 0)) / 100 : Number(descontoValor.replace(",", ".")) || 0),
  );
  const total = round2(subtotal - desconto);
  const pago = round2(pagamentos.reduce((s, p) => s + p.valor, 0));
  const falta = round2(Math.max(0, total - pago));
  const troco = round2(Math.max(0, pago - total));
  const cliente = clientes.find((c) => c.id === clienteId) ?? null;

  const adicionar = useCallback(
    (p: ProdutoDto, qtd = p.pesavel ? 0 : 1) => {
      setLinhas((atual) => {
        const i = atual.findIndex((l) => l.produtoId === p.id);
        if (i >= 0) {
          const copia = [...atual];
          copia[i] = { ...copia[i], qtd: round2(copia[i].qtd * 1000) / 1000 + 1 };
          return copia;
        }
        return [
          ...atual,
          { produtoId: p.id, nome: p.nome, qtd, preco: p.preco, unidade: p.unidade, estoque: p.estoque, pesavel: p.pesavel },
        ];
      });
      if (qtd === 0) setEditando(p.id);
      setTermo("");
      setCursor(0);
      buscaRef.current?.focus();
    },
    [],
  );

  const definirPagamentoAutomatico = useCallback(
    (forma: string) => {
      const valor = falta > 0 ? falta : total;
      setPagamentos((atual) => {
        if (atual.length === 1 && atual[0].forma === forma) return atual;
        return [...atual, { forma, valor: round2(valor) }];
      });
    },
    [falta, total],
  );

  function teclaBusca(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(resultados.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = resultados[cursor];
      if (alvo) adicionar(alvo);
    } else if (e.key === "Escape") {
      setTermo("");
      setLinhas([]);
      setPagamentos([]);
      setDescontoValor("");
      toast("Venda cancelada e tela limpa.", "info");
    } else if (e.key === "F10") {
      e.preventDefault();
      void finalizar("fiscal");
    }
  }

  async function finalizar(tipo: "fiscal" | "dav") {
    if (linhas.length === 0) return toast("Coloque ao menos um item na venda.", "erro");
    const itens: ItemPdv[] = linhas.map((l) => ({ produtoId: l.produtoId, qtd: l.qtd, preco: l.preco }));
    if (itens.some((i) => i.qtd <= 0)) return toast("Informe a quantidade/peso de todos os itens.", "erro");
    if (tipo === "fiscal" && pagamentos.length === 0) definirPagamentoAutomatico("dinheiro");

    const payloadPagamentos = pagamentos.length ? pagamentos : tipo === "fiscal" ? [{ forma: "dinheiro", valor: total }] : [];
    setOcupado(true);
    try {
      const r = await registrarVenda({
        itens,
        clienteId,
        clienteNome: cliente?.nome ?? "CONSUMIDOR",
        desconto,
        pagamentos: payloadPagamentos,
        tipo,
        modelo,
        validade: tipo === "dav" ? validadeDav : undefined,
      });
      if (!r.ok) return toast(r.erro, "erro");
      setCupom({
        total,
        troco: r.troco,
        numeroNota: r.numeroNota,
        chave: r.chave,
        documento: tipo === "dav" ? `DAV ${r.numero}` : `${modelo} ${r.numeroNota}`,
        forma: payloadPagamentos.slice().sort((a, b) => b.valor - a.valor)[0]?.forma ?? "dinheiro",
      });
      setLinhas([]);
      setPagamentos([]);
      setDescontoValor("");
      setRecebido("");
      toast(r.aviso ?? (tipo === "dav" ? "DAV gerado e reservado." : `Venda finalizada · ${moeda(total)}`));
      router.refresh();
    } catch (e) {
      // offline-first: guarda na fila local para sincronizar depois
      const filaAtual = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
      filaAtual.push({ tipo, itens, clienteId, desconto, pagamentos: payloadPagamentos, modelo, criadoEm: Date.now() });
      localStorage.setItem(CHAVE_FILA, JSON.stringify(filaAtual));
      setFila(filaAtual.length);
      toast(`Sem conexão com o servidor. Venda nº ${filaAtual.length} ficou na fila local.`, "erro");
      void e;
    } finally {
      setOcupado(false);
    }
  }

  async function sincronizar() {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
    if (bruto.length === 0) return;
    setOcupado(true);
    let ok = 0;
    const restante: unknown[] = [];
    for (const v of bruto) {
      const r = await registrarVenda(v as never);
      if (r.ok) ok++;
      else restante.push(v);
    }
    localStorage.setItem(CHAVE_FILA, JSON.stringify(restante));
    setFila(restante.length);
    setOcupado(false);
    toast(ok ? `${ok} venda(s) da fila sincronizadas.` : "Nada sincronizado — servidor indisponível.", ok ? "ok" : "erro");
    router.refresh();
  }

  const trib = tributosEstimados(total, { icms: 0, pis: 0, cofins: 0, ibs: 0.1, cbs: 0.9 });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink-900">Frente de caixa</h1>
            <p className="text-[12.5px] text-ink-400">
              ↑ ↓ navegam · Enter adiciona · F10 finaliza · Esc limpa · leitor de código de barras funciona no campo de busca
            </p>
          </div>
          <div className="flex items-center gap-2">
            {fila > 0 && (
              <button
                type="button"
                onClick={sincronizar}
                className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
              >
                <Icon name="atualizar" className="size-3.5" />
                {fila} venda(s) na fila local · sincronizar
              </button>
            )}
            <Badge tom={empresa.ambiente === "1" ? "erro" : "info"}>
              {empresa.ambiente === "1" ? "Produção" : "Homologação"}
            </Badge>
          </div>
        </div>

        <Card className="p-2.5">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-way-600">
              <Icon name="busca" className="size-5" />
            </span>
            <input
              ref={buscaRef}
              value={termo}
              onChange={(e) => {
                setTermo(e.target.value);
                setCursor(0);
                const digitado = e.target.value.replace(/\D/g, "");
                if (digitado.length === 13) {
                  const p = ativos.find((x) => x.gtin === digitado);
                  if (p) adicionar(p);
                }
              }}
              onKeyDown={teclaBusca}
              placeholder="Bipe o código de barras ou digite início do nome / SKU"
              className="w-full rounded-lg border-0 bg-ink-50/70 px-10 py-3 text-[15px] font-medium text-ink-900 outline-none ring-1 ring-inset ring-ink-100 placeholder:text-ink-300 focus:bg-white focus:ring-2 focus:ring-way-500"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-400 ring-1 ring-inset ring-ink-100">
              F10
            </kbd>
          </div>

          {resultados.length > 0 && (
            <ul className="mt-2 max-h-64 divide-y divide-ink-50 overflow-y-auto">
              {resultados.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => adicionar(p)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition",
                      cursor === i ? "bg-way-50 ring-1 ring-inset ring-way-200" : "hover:bg-ink-50",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-ink-800">{p.nome}</span>
                      <span className="block font-mono text-[10.5px] text-ink-400">
                        {p.sku} · {p.gtin} · {p.categoria}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "tabular shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold",
                        p.estoque <= 0 ? "bg-rose-50 text-rose-600" : p.estoque <= p.estoqueMin ? "bg-amber-50 text-amber-700" : "bg-ink-50 text-ink-500",
                      )}
                    >
                      {p.estoque} {p.unidade}
                    </span>
                    <span className="tabular w-20 shrink-0 text-right text-[13.5px] font-bold text-ink-900">{moeda(p.preco)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="mt-3 p-0" padding={false}>
          <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
            <p className="micro text-ink-400">Itens da venda · {linhas.length}</p>
            {linhas.length > 0 && (
              <Button tamanho="sm" variante="fantasma" icone="x" onClick={() => setLinhas([])}>
                Limpar
              </Button>
            )}
          </div>
          {linhas.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[13px] font-semibold text-ink-500">Nenhum item ainda</p>
              <p className="mt-1 text-[12px] text-ink-400">Busque um produto acima ou use o leitor de código de barras.</p>
            </div>
          ) : (
            <ul className="divide-y divide-ink-50">
              {linhas.map((l, idx) => (
                <li key={l.produtoId} className="flex items-center gap-2 px-3 py-2">
                  <span className="tabular w-5 shrink-0 text-[11px] font-bold text-ink-300">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{l.nome}</p>
                    <p className="tabular text-[10.5px] text-ink-400">
                      {moeda(l.preco)} / {l.unidade} · saldo {l.estoque}
                    </p>
                  </div>
                  {editando === l.produtoId ? (
                    <input
                      autoFocus
                      defaultValue={l.qtd || ""}
                      placeholder={l.pesavel ? "peso KG" : "qtd"}
                      onChange={(e) =>
                        setLinhas((atual) => atual.map((x) => (x.produtoId === l.produtoId ? { ...x, qtd: Number(e.target.value.replace(",", ".")) || 0 } : x)))
                      }
                      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setEditando(null)}
                      onBlur={() => setEditando(null)}
                      className="tabular w-24 rounded-lg px-2 py-1 text-right text-[13px] font-semibold ring-1 ring-inset ring-way-400 outline-none"
                    />
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setLinhas((atual) => atual.map((x) => (x.produtoId === l.produtoId ? { ...x, qtd: Math.max(0, round2(x.qtd * 1000 - 1) / 1000) } : x)))
                        }
                        className="grid size-6 place-items-center rounded-md text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                      >
                        <Icon name="menos" className="size-3" strokeWidth={2.4} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditando(l.produtoId)}
                        className="tabular w-12 rounded-md py-1 text-center text-[13px] font-bold text-ink-900 hover:bg-ink-50"
                        title="Clique para digitar a quantidade"
                      >
                        {l.qtd}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setLinhas((atual) => atual.map((x) => (x.produtoId === l.produtoId ? { ...x, qtd: round2(x.qtd * 1000 + 1) / 1000 } : x)))
                        }
                        className="grid size-6 place-items-center rounded-md text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                      >
                        <Icon name="mais" className="size-3" strokeWidth={2.4} />
                      </button>
                    </div>
                  )}
                  <span className="tabular w-20 shrink-0 text-right text-[13px] font-bold text-ink-900">{moeda(l.qtd * l.preco)}</span>
                  <button
                    type="button"
                    onClick={() => setLinhas((atual) => atual.filter((x) => x.produtoId !== l.produtoId))}
                    className="shrink-0 rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Icon name="lixo" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Card>
            <p className="micro mb-2 text-ink-400">Forma de pagamento · divisão aceita</p>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMAS_PAGAMENTO.map((f) => {
                const usado = pagamentos.filter((p) => p.forma === f.id).reduce((s, p) => s + p.valor, 0);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => (usado > 0 ? setPagamentos(pagamentos.filter((p) => p.forma !== f.id)) : definirPagamentoAutomatico(f.id))}
                    className={cn(
                      "rounded-lg px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition",
                      usado > 0 ? "bg-way-600 text-white ring-way-600" : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
                    )}
                  >
                    {f.label}
                    {usado > 0 && <span className="tabular mt-0.5 block text-[10px] font-medium opacity-90">{moeda(usado)}</span>}
                  </button>
                );
              })}
            </div>
            {pagamentos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pagamentos.map((p, i) => (
                  <li key={`${p.forma}-${i}`} className="flex items-center gap-2 rounded-md bg-ink-50 px-2 py-1">
                    <span className="flex-1 text-[12px] font-semibold text-ink-700">
                      {FORMAS_PAGAMENTO.find((f) => f.id === p.forma)?.label ?? p.forma}
                    </span>
                    <input
                      value={p.valor}
                      onChange={(e) =>
                        setPagamentos(atual => atual.map((x, xi) => (xi === i ? { ...x, valor: Number(e.target.value.replace(",", ".")) || 0 } : x)))
                      }
                      className="tabular w-24 rounded bg-white px-1.5 py-0.5 text-right text-[12px] font-semibold ring-1 ring-inset ring-ink-200 outline-none"
                    />
                    <button type="button" onClick={() => setPagamentos(pagamentos.filter((_, xi) => xi !== i))} className="text-ink-300 hover:text-rose-600">
                      <Icon name="x" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Campo rotulo="Valor recebido (dinheiro)" className="flex-1">
                <Input
                  dinheiro
                  valor={recebido}
                  aoMudar={setRecebido}
                  placeholder="0,00"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = Number(recebido.replace(",", ".")) || 0;
                      if (v > 0) {
                        setPagamentos((a) => [...a.filter((p) => p.forma !== "dinheiro"), { forma: "dinheiro", valor: round2(v) }]);
                        setRecebido("");
                      }
                    }
                  }}
                />
              </Campo>
              <Button variante="secundario" className="mt-5" onClick={() => setPagamentos([])} disabled={pagamentos.length === 0}>
                Zerar
              </Button>
            </div>
          </Card>

          <Card>
            <p className="micro mb-2 text-ink-400">Cliente e desconto</p>
            <button
              type="button"
              onClick={() => {
                setAbertoCliente(true);
                setBuscaCliente("");
              }}
              className="flex w-full items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-2 text-left transition hover:bg-ink-100"
            >
              <Icon name="pessoas" className="size-4 text-ink-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink-800">{cliente?.nome ?? "CONSUMIDOR"}</span>
                <span className="block truncate text-[10.5px] text-ink-400">
                  {cliente ? `${cliente.documento || "sem documento"} · ${cliente.condicaoPadrao}` : "clique para identificar"}
                </span>
              </span>
              {cliente && cliente.saldoEmAberto > 0 && <Badge tom="alerta">{moeda(cliente.saldoEmAberto)}</Badge>}
            </button>
            <div className="mt-2 flex items-end gap-2">
              <Campo rotulo="Desconto" className="flex-1">
                <Input dinheiro valor={descontoValor} aoMudar={setDescontoValor} placeholder="0,00" />
              </Campo>
              <div className="flex rounded-lg bg-ink-50 p-0.5">
                {(["real", "percentual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDescontoModo(m)}
                    className={cn("rounded px-2 py-1.5 text-[12px] font-bold transition", descontoModo === m ? "bg-white text-ink-900 shadow-sm" : "text-ink-400")}
                  >
                    {m === "real" ? "R$" : "%"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Campo rotulo="Documento fiscal">
                <Select
                  valor={modelo}
                  aoMudar={(v) => setModelo(v as "NFC-e" | "NF-e" | "SAT")}
                  opcoes={[
                    { valor: "NFC-e", rotulo: "NFC-e (consumidor)" },
                    { valor: "NF-e", rotulo: "NF-e (pessoa jurídica)" },
                    { valor: "SAT", rotulo: "SAT / NFC-e Sat" },
                  ]}
                />
              </Campo>
              <Campo rotulo="Validade do DAV">
                <Input type="date" valor={validadeDav} aoMudar={setValidadeDav} />
              </Campo>
            </div>
          </Card>
        </div>
      </div>

      {/* resumo */}
      <aside className="xl:sticky xl:top-16 xl:h-fit">
        <Card className="p-0">
          <div className="border-b border-ink-100 bg-ink-900 px-4 py-3 text-white">
            <p className="micro text-ink-300">Resumo da operação</p>
            <p className="tabular mt-1 text-[30px] font-black leading-none tracking-[-0.03em]">{moeda(total)}</p>
            <p className="mt-1 text-[11.5px] text-ink-300">
              {linhas.reduce((s, l) => s + l.qtd, 0)} item(ns) · subtotal {moeda(subtotal)}
            </p>
          </div>
          <dl className="space-y-1.5 px-4 py-3 text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-500">Desconto aplicado</dt>
              <dd className="tabular font-semibold text-rose-600">− {moeda(desconto)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Recebido</dt>
              <dd className="tabular font-semibold text-ink-800">{moeda(pago)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">{falta > 0 ? "Falta receber" : "Troco"}</dt>
              <dd className={cn("tabular font-bold", falta > 0 ? "text-amber-600" : "text-way-700")}>{moeda(falta > 0 ? falta : troco)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-100 pt-1.5">
              <dt className="text-ink-500">Tributos approx. (IBS/CBS teste)</dt>
              <dd className="tabular font-semibold text-ink-600">{moeda(trib.total)}</dd>
            </div>
          </dl>
          <div className="space-y-2 border-t border-ink-100 px-4 py-3">
            <Button className="w-full pulse-way" disabled={ocupado || total <= 0 || falta > 0.01} onClick={() => finalizar("fiscal")}>
              {ocupado ? "Enviando à SEFAZ…" : `Finalizar venda · ${moeda(total)}`}
            </Button>
            <Button variante="secundario" className="w-full" disabled={ocupado || total <= 0} onClick={() => finalizar("dav")}>
              Gerar DAV (sem valor fiscal)
            </Button>
            <p className="text-center text-[10.5px] leading-snug text-ink-400">
              DAV é uma reserva: o estoque baixa no faturamento, não na emissão do documento auxiliar.
            </p>
          </div>
        </Card>
      </aside>

      {/* seleção de cliente */}
      <Modal aberto={abertoCliente} aoFechar={() => setAbertoCliente(false)} titulo="Identificar cliente" descricao="Busque por nome ou documento (CPF/CNPJ)">
        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300">
            <Icon name="busca" className="size-4" />
          </span>
          <input
            autoFocus
            value={buscaCliente}
            onChange={(e) => setBuscaCliente(e.target.value)}
            placeholder="nome, CPF ou CNPJ"
            className="w-full rounded-lg py-2 pl-9 pr-3 text-[13px] ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
          />
        </div>
        <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto">
          <li>
            <button
              type="button"
              onClick={() => {
                setClienteId(null);
                setAbertoCliente(false);
              }}
              className="w-full px-2 py-2.5 text-left text-[13px] font-semibold text-ink-600 hover:bg-way-50"
            >
              CONSUMIDOR (sem identificação)
            </button>
          </li>
          {clientes
            .filter((c) => !buscaCliente.trim() || c.nome.toLowerCase().includes(buscaCliente.toLowerCase()) || c.documento.includes(buscaCliente))
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setClienteId(c.id);
                    setAbertoCliente(false);
                    if (c.condicaoPadrao === "30d" || c.condicaoPadrao === "14d" || c.condicaoPadrao === "7d" || c.condicaoPadrao === "60d") {
                      setPagamentos([{ forma: "prazo", valor: total }]);
                    }
                  }}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-left transition hover:bg-way-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{c.nome}</p>
                    <p className="text-[11px] text-ink-400">
                      {c.documento || "sem documento"} · {c.condicaoPadrao}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-[11px] font-semibold text-ink-500">lim. {moeda(c.limiteCredito)}</p>
                    <p className={cn("tabular text-[11px] font-semibold", c.saldoEmAberto > 0 ? "text-amber-600" : "text-way-600")}>
                      em aberto {moeda(c.saldoEmAberto)}
                    </p>
                  </div>
                </button>
              </li>
            ))}
        </ul>
      </Modal>

      {/* cupom */}
      <Modal
        aberto={!!cupom}
        aoFechar={() => setCupom(null)}
        titulo="Documento emitido"
        descricao="Cupom resumido — o XML/DANFE completo fica em Documentos fiscais"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
              Imprimir
            </Button>
            <Button onClick={() => setCupom(null)}>Nova venda</Button>
          </>
        }
      >
        {cupom && (
          <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-4 font-mono text-[11.5px] leading-relaxed text-ink-700">
            <p className="text-center text-[13px] font-bold text-ink-900">{empresa.fantasia.toUpperCase()}</p>
            <p className="text-center">{empresa.endereco}, {empresa.municipio} - {empresa.nome}</p>
            <p className="text-center">CNPJ {empresa.documento}</p>
            <p className="my-2 border-t border-dashed border-ink-300" />
            {linhas.length === 0 && (
              <ul className="space-y-1">
                <li className="flex justify-between font-semibold">
                  <span>{cupom.documento}</span>
                  <span className="tabular">{moeda(cupom.total)}</span>
                </li>
              </ul>
            )}
            <p className="mt-2 flex justify-between font-bold text-ink-900">
              <span>TOTAL</span>
              <span className="tabular">{moeda(cupom.total)}</span>
            </p>
            <p className="flex justify-between">
              <span>{FORMAS_PAGAMENTO.find((f) => f.id === cupom.forma)?.label}</span>
              <span className="tabular">{moeda(cupom.total)}</span>
            </p>
            {cupom.troco > 0 && (
              <p className="flex justify-between">
                <span>TROCO</span>
                <span className="tabular">{moeda(cupom.troco)}</span>
              </p>
            )}
            <p className="my-2 border-t border-dashed border-ink-300" />
            {cupom.chave ? (
              <>
                <p className="break-all leading-tight">chave de acesso</p>
                <p className="mb-1 break-all font-bold tracking-tight text-ink-900">{formatChave(cupom.chave)}</p>
                <p className="text-[10.5px] text-ink-400">
                  Documento autorizado em homologação · sem valor jurídico. Protocolo {cupom.numeroNota ? `111${cupom.numeroNota}` : "—"}
                </p>
              </>
            ) : (
              <p className="text-[10.5px] text-ink-400">DAV sem valor fiscal: documento de reserva para retirada de mercadoria.</p>
            )}
            <p className="mt-2 text-center text-[10px] text-ink-400">
              NKWAY · {new Date().toLocaleString("pt-BR")} · consumidos {moeda(trib.total)} em tributos approx.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
