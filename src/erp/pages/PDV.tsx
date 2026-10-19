import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { usePlan } from "../plan";
import { brl, gerarChave, type ItemVenda, type ModeloFiscal, type Venda } from "../types";
import { Badge, Button, Card, Empty, PageHeader } from "../ui";
import Documento from "../Documento";
import StatusConexao from "../StatusConexao";
import { enfileirar } from "../offline";
import { useOffline } from "../useOffline";
import { cn } from "../../utils/cn";

const PAGAMENTOS: Venda["pagamento"][] = ["dinheiro", "pix", "debito", "credito", "boleto", "prazo"];
const MODELOS: ModeloFiscal[] = ["NFC-e", "NF-e", "SAT"];

export default function PDV() {
  const { db, registrarVenda } = useStore();
  const { conta } = useAuth();
  const { podeUsar } = usePlan();

  const [modo, setModo] = useState<"fiscal" | "dav">("fiscal");
  const [busca, setBusca] = useState("");
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [pagamento, setPagamento] = useState<Venda["pagamento"]>("pix");
  const [modelo, setModelo] = useState<ModeloFiscal>("NFC-e");
  const [desconto, setDesconto] = useState(0);
  const [validade, setValidade] = useState(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [obs, setObs] = useState("");
  const [recibo, setRecibo] = useState<Venda | null>(null);
  const [semFiscal, setSemFiscal] = useState(false);

  const fiscalLiberado = podeUsar("fiscal");
  const { online, fila, sincronizando, sync } = useOffline(conta?.id);

  const lista = useMemo(
    () => db.produtos.filter((p) => (p.nome + p.sku).toLowerCase().includes(busca.toLowerCase())),
    [db.produtos, busca],
  );

  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const total = Math.max(0, subtotal - desconto);

  function addItem(id: string) {
    const p = db.produtos.find((x) => x.id === id);
    if (!p) return;
    setItens((prev) => {
      const ex = prev.find((i) => i.produtoId === id);
      if (ex)
        return prev.map((i) =>
          i.produtoId === id ? { ...i, qtd: Math.min(i.qtd + 1, p.estoque) } : i,
        );
      return [...prev, { produtoId: p.id, nome: p.nome, qtd: 1, preco: p.preco }];
    });
  }

  function setQtd(id: string, qtd: number) {
    const max = db.produtos.find((p) => p.id === id)?.estoque ?? 99;
    setItens((prev) =>
      prev
        .map((i) => (i.produtoId === id ? { ...i, qtd: Math.min(Math.max(1, qtd), max) } : i))
        .filter((i) => i.qtd > 0),
    );
  }

  function finalizar() {
    if (itens.length === 0) return;
    if (modo === "fiscal" && !fiscalLiberado) {
      setSemFiscal(true);
      return;
    }
    const cliente = db.clientes.find((c) => c.id === clienteId);
    const numeroNota = db.vendas.filter((v) => v.fiscal).length + 1;

    const base = {
      clienteId: clienteId || null,
      clienteNome: cliente?.nome ?? "Consumidor final",
      itens,
      total,
      desconto,
      pagamento,
      observacao: obs || undefined,
    };

    const venda: Venda =
      modo === "dav"
        ? { ...base, id: "", numero: 0, data: Date.now(), tipo: "dav", status: "aberto", validade }
        : {
            ...base,
            id: "",
            numero: 0,
            data: Date.now(),
            tipo: "fiscal",
            status: "faturado",
            fiscal: {
              modelo,
              serie: "001",
              numeroNota,
              chave: gerarChave(numeroNota),
              protocolo: `135${Date.now()}`.slice(0, 15),
              autorizadaEm: Date.now(),
            },
          };

    const numeroFinal = (db.vendas[0]?.numero ?? 1000) + 1;
    const registrada = { ...venda, numero: numeroFinal, id: crypto.randomUUID() };

    // 1) grava local imediatamente — a venda nunca depende da internet
    const { id: _i, numero: _n, data: _d, ...payload } = registrada;
    registrarVenda(payload);

    // 2) entra na fila de sincronização com o servidor
    enfileirar(registrada);

    setRecibo(registrada);
    setItens([]);
    setDesconto(0);
    setClienteId("");
    setObs("");
  }

  return (
    <div>
      <PageHeader
        title="PDV — Frente de caixa"
        subtitle="Offline-first: venda sem internet, sincroniza sozinho quando conectar"
        action={<StatusConexao empresaId={conta?.id} />}
      />

      {!online && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border-l-4 border-rose-500 bg-rose-50 p-4">
          <span className="text-xl">📴</span>
          <div>
            <p className="text-sm font-bold text-rose-800">
              Caixa operando offline — pode continuar vendendo
            </p>
            <p className="text-xs text-rose-700">
              As vendas ficam salvas neste computador e sobem automaticamente quando a
              internet voltar. A emissão fiscal é transmitida à SEFAZ na reconexão
              (contingência).
            </p>
          </div>
        </div>
      )}

      {online && fila.length > 0 && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            <b>{fila.length}</b> venda(s) aguardando envio ao servidor.
          </p>
          <Button variant="soft" onClick={sync}>
            {sincronizando ? "Enviando..." : "Sincronizar agora"}
          </Button>
        </div>
      )}

      {/* Seletor de modo */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => setModo("fiscal")}
          className={cn(
            "rounded-xl border-2 p-4 text-left transition",
            modo === "fiscal"
              ? "border-sky-600 bg-sky-50"
              : "border-slate-200 bg-white hover:border-slate-300",
          )}
        >
          <p className="flex items-center gap-2 font-bold text-slate-900">
            🧾 Venda Fiscal
            {!fiscalLiberado && <Badge tone="amber">Plano Pro</Badge>}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Emite NFC-e, NF-e ou SAT. Baixa o estoque e lança no financeiro na hora.
          </p>
        </button>
        <button
          onClick={() => setModo("dav")}
          className={cn(
            "rounded-xl border-2 p-4 text-left transition",
            modo === "dav"
              ? "border-amber-500 bg-amber-50"
              : "border-slate-200 bg-white hover:border-slate-300",
          )}
        >
          <p className="font-bold text-slate-900">📄 DAV — Documento Auxiliar de Venda</p>
          <p className="mt-1 text-xs text-slate-500">
            Orçamento/pedido sem valor fiscal. Não baixa estoque até ser faturado.
          </p>
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card className="p-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto por nome ou SKU..."
            className="mb-4 w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
          <div className="grid max-h-[520px] gap-2 overflow-auto pr-1 sm:grid-cols-2">
            {lista.map((p) => (
              <button
                key={p.id}
                onClick={() => addItem(p.id)}
                disabled={p.estoque === 0}
                className="rounded-lg border border-slate-200 p-3 text-left transition hover:border-sky-400 hover:bg-sky-50/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <p className="truncate text-sm font-medium text-slate-800">{p.nome}</p>
                <p className="text-[11px] text-slate-400">{p.sku} · {p.categoria}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-sky-700">{brl(p.preco)}</span>
                  <Badge tone={p.estoque <= p.estoqueMin ? "amber" : "slate"}>{p.estoque} un</Badge>
                </div>
              </button>
            ))}
            {lista.length === 0 && (
              <div className="sm:col-span-2"><Empty>Nenhum produto encontrado.</Empty></div>
            )}
          </div>
        </Card>

        <Card className={cn("flex flex-col p-5", modo === "dav" && "ring-2 ring-amber-400")}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              {modo === "dav" ? "Itens do DAV" : "Carrinho"}
            </h2>
            {modo === "dav" && <Badge tone="amber">Sem valor fiscal</Badge>}
          </div>

          <div className="min-h-[140px] flex-1 space-y-2 overflow-auto">
            {itens.length === 0 && <Empty>Clique nos produtos para adicionar.</Empty>}
            {itens.map((i) => (
              <div key={i.produtoId} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{i.nome}</p>
                  <p className="text-xs text-slate-400">{brl(i.preco)} un</p>
                </div>
                <input
                  type="number"
                  min={1}
                  value={i.qtd}
                  onChange={(e) => setQtd(i.produtoId, Number(e.target.value))}
                  className="w-14 rounded border border-slate-300 px-2 py-1 text-center text-sm"
                />
                <span className="w-20 text-right text-sm font-semibold text-slate-900">
                  {brl(i.qtd * i.preco)}
                </span>
                <button
                  onClick={() => setItens((p) => p.filter((x) => x.produtoId !== i.produtoId))}
                  className="text-slate-300 transition hover:text-rose-500"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <select
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value="">Consumidor final</option>
              {db.clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>

            {modo === "fiscal" && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Modelo do documento</p>
                <div className="flex gap-1.5">
                  {MODELOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setModelo(m)}
                      className={cn(
                        "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                        modelo === m ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {modo === "dav" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Validade do DAV</span>
                <input
                  type="date"
                  value={validade}
                  onChange={(e) => setValidade(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                />
              </label>
            )}

            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-500">
                {modo === "dav" ? "Condição prevista" : "Forma de pagamento"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {PAGAMENTOS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPagamento(p)}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
                      pagamento === p ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {p === "prazo" ? "a prazo" : p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-600">
              <span>Desconto (R$)</span>
              <input
                type="number"
                min={0}
                value={desconto}
                onChange={(e) => setDesconto(Number(e.target.value))}
                className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm"
              />
            </div>

            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Observação (opcional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />

            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-3xl font-bold text-slate-900">{brl(total)}</span>
            </div>

            <Button
              onClick={finalizar}
              className={cn("w-full py-3", modo === "dav" && "bg-amber-500 hover:bg-amber-600")}
            >
              {modo === "dav"
                ? "📄 Gerar DAV"
                : online
                  ? `🧾 Emitir ${modelo} e finalizar`
                  : `📴 Vender em contingência (${modelo})`}
            </Button>
            {!online && modo === "fiscal" && (
              <p className="text-center text-[11px] text-slate-400">
                A nota será transmitida à SEFAZ assim que a conexão voltar.
              </p>
            )}
          </div>
        </Card>
      </div>

      {recibo && (
        <Documento
          venda={recibo}
          empresa={conta?.empresa ?? "Minha Empresa"}
          cnpj={conta?.cnpj ?? ""}
          onClose={() => setRecibo(null)}
        />
      )}

      {semFiscal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSemFiscal(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">🧾</div>
            <h3 className="text-lg font-bold text-slate-900">Emissão fiscal é do plano Pro</h3>
            <p className="mt-2 text-sm text-slate-500">
              No plano Grátis você pode usar o <b>DAV</b> à vontade e faturar depois.
              Assine o Pro para emitir NFC-e, NF-e e SAT ilimitados.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => { setModo("dav"); setSemFiscal(false); }}>
                Usar DAV
              </Button>
              <Button className="flex-1" onClick={() => setSemFiscal(false)}>Ver planos ⭐</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
