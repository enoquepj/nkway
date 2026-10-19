import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { usePlan } from "../plan";
import {
  brl,
  gerarChave,
  tributosEstimados,
  type ItemVenda,
  type Produto,
  type Venda,
} from "../types";
import { enfileirar } from "../offline";
import { useOffline } from "../useOffline";
import {
  buscarProduto,
  carregarConfig,
  interpretarEntrada,
  salvarConfig,
  type PdvConfig,
} from "../checkout/pdvConfig";
import Documento from "../Documento";
import { cn } from "../../utils/cn";

const PAGAMENTOS: Venda["pagamento"][] = ["dinheiro", "pix", "debito", "credito", "boleto", "prazo"];

/** código tPag da tag <pag> da NF-e — usado no XML e no tributário */
const T_PAG_MAP: Record<Venda["pagamento"], string> = {
  dinheiro: "01",
  pix: "17",
  credito: "03",
  debito: "04",
  boleto: "16",
  prazo: "90",
};
// Protege contra NaN/Infinity/undefined vindo do banco — evita crash do painel
// inteiro quando algum preco esta corrompido (ex.: produto sem preço).
const fmt = (n: number) =>
  typeof n === "number" && Number.isFinite(n) ? brl(n) : brl(0);
const fmtQtd = (n: number, un: string) =>
  un === "KG" ? `${n.toFixed(3).replace(".", ",")} kg` : `${n}`;

export default function PDV() {
  const { db, registrarVenda, cancelarVenda, inutilizar } = useStore();

  const { conta } = useAuth();
  const { podeUsar } = usePlan();
  const { online, fila } = useOffline(conta?.id);

  // ---------------- config local da frente de caixa ----------------
  const [cfg, setCfg] = useState<PdvConfig>(carregarConfig);
  const [abrirCfg, setAbrirCfg] = useState(false);

  // ---------------- estado da venda em curso ----------------
  const [itens, setItens] = useState<ItemVenda[]>([]);
  const [busca, setBusca] = useState("");
  const [qtdPendente, setQtdPendente] = useState<number | null>(null);
  const [resultados, setResultados] = useState<Produto[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<ItemVenda | null>(null);

  // ---------------- fluxos de operação ----------------
  const [etapa, setEtapa] = useState<"espera" | "venda" | "pagamento">("espera");
  const [pesando, setPesando] = useState<{ produto: Produto; precoKg: number } | null>(null);
  const [pagModal, setPagModal] = useState(false);
  const [recibo, setRecibo] = useState<Venda | null>(null);
  const [pagamento, setPagamento] = useState<Venda["pagamento"]>("dinheiro");
  const [clienteId, setClienteId] = useState("");
  const [modelo, setModelo] = useState<Venda["fiscal"] extends infer _T ? "NFC-e" | "NF-e" | "SAT" : never>("NFC-e");
  const [desconto, setDesconto] = useState(0);
  const [valorPago, setValorPago] = useState("");
  // ---- frete / transporte (novo bloco fiscal) ----
  const [frete, setFrete] = useState(0);
  const [trnCnpj, setTrnCnpj] = useState("");
  const [trnNome, setTrnNome] = useState("");
  const [placa, setPlaca] = useState("");
  const [placaUf, setPlacaUf] = useState("");
  const [consultandoPreco, setConsultandoPreco] = useState(false);
  const [buscaPreco, setBuscaPreco] = useState("");
  const [produtoConsulta, setProdutoConsulta] = useState<Produto | null>(null);
  const [consultaVendas, setConsultaVendas] = useState(false);
  const [reprint, setReprint] = useState<Venda | null>(null);
  const [cancelando, setCancelando] = useState<Venda | null>(null);
  const [motivoCanc, setMotivoCanc] = useState("Venda efetuada por erro no PDV");
  const [inutilizarTela, setInutilizarTela] = useState(false);
  const [inutInicio, setInutInicio] = useState(1);
  const [inutFim, setInutFim] = useState(1);
  const [inutJust, setInutJust] = useState("Numeração pulada sem emissão de nota");

  // ---------------- ponte de saída do PDV de volta ao ERP ----------------
  // (declarada depois dos states de itens/etapa para ler status atual)
  function sairPDV(mostrarConfirmacao = false) {
    if (mostrarConfirmacao && itens.length > 0 && etapa === "venda") {
      if (!confirm("Venda em andamento. Sair para o ERP mesmo assim?")) return;
    }
    window.dispatchEvent(new CustomEvent("nkway:sair-pdv"));
  }

  const inputRef = useRef<HTMLInputElement>(null);
  const timerEspera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fiscalLiberado = podeUsar("fiscal");
  const subtotal = itens.reduce((s, i) => s + i.qtd * i.preco, 0);
  const total = Math.max(0, subtotal - desconto);
  const qtdItens = itens.reduce((s, i) => s + i.qtd, 0);

  // ---- Tributos estimados (transparência Lei 12.741 · Reforma 2026/2027: CBS/IBS) ----
  const tributos = useMemo(() => {
    let cbs = 0;
    let ibs = 0;
    let icms = 0;
    let pisCofins = 0;
    itens.forEach((i) => {
      const p = db.produtos.find((x) => x.id === i.produtoId);
      if (!p) return;
      const t = tributosEstimados(i.qtd * i.preco, p.impostos);
      cbs += t.cbs;
      ibs += t.ibs;
      icms += t.icms;
      pisCofins += t.pisCofins;
    });
    return { cbs, ibs, icms, pisCofins, total: cbs + ibs + icms + pisCofins };
  }, [itens, db.produtos]);

  const produtosEspera = useMemo(
    () => cfg.skusEspera.map((s) => db.produtos.find((p) => p.sku === s)).filter(Boolean) as Produto[],
    [db.produtos, cfg.skusEspera],
  );

  // ---------------- relógio da tela de espera ----------------
  const [agora, setAgora] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ---------------- foco permanente no campo de busca ----------------
  const focar = () => setTimeout(() => inputRef.current?.focus(), 30);
  useEffect(() => {
    if (etapa === "venda" && !pesando) focar();
  }, [etapa, itens, pesando]);

  // ---------------- auto-espera após finalizar ----------------
  useEffect(() => {
    if (!recibo || cfg.autoEspera <= 0) return;
    const t = setTimeout(() => {
      setRecibo(null);
      setEtapa("espera");
    }, cfg.autoEspera * 1000);
    return () => clearTimeout(t);
  }, [recibo, cfg.autoEspera]);

  // ---------------- atalhos de teclado ----------------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // nunca intercepta digitação dentro de campos (config, pagamento, etc.)
      const alvo = e.target as HTMLElement | null;
      const emCampo = !!alvo && ["INPUT", "SELECT", "TEXTAREA"].includes(alvo.tagName);

      if (abrirCfg || pagModal) return;

      if (etapa === "espera" && !recibo) {
        // ESC na tela de espera = voltar ao ERP
        if (e.key === "Escape") { e.preventDefault(); sairPDV(true); return; }
        // qualquer tecla fora de campo inicia a venda
        if (e.key.length === 1 && !emCampo) {
          setEtapa("venda");
          setBusca(e.key);
          focar();
        }
        return;
      }
      if (etapa !== "venda" || pesando) return;
      if (e.key === "F2") { e.preventDefault(); focar(); }
      if (e.key === "F4") { e.preventDefault(); removerUltimo(); }
      if (e.key === "F6") { e.preventDefault(); setConsultaVendas(true); }
      if (e.key === "F7") { e.preventDefault(); setConsultandoPreco(true); }
      if (e.key === "F9") { e.preventDefault(); focar(); }
      if (e.key === "F10") { e.preventDefault(); if (itens.length) abrirPagamento(); }
      if (e.key === "Escape" && !emCampo) {
        if (itens.length && confirm("Cancelar a venda em curso? (ESC p/ sair, ✕ para voltar espera)")) {
          setItens([]); setEtapa("espera"); setUltimo(null);
        } else if (!itens.length) setEtapa("espera");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [etapa, itens, recibo, abrirCfg, pagModal, pesando]);

  // ============================ OPERAÇÕES ============================

  function iniciarVenda() {
    setEtapa("venda");
    timerEspera.current && clearTimeout(timerEspera.current);
    focar();
  }

  function adicionar(produto: Produto, qtd?: number, precoCalculado?: number) {
    if (!produto.pesavel && (qtd == null)) {
      const q = qtdPendente && qtdPendente > 0 ? qtdPendente : 1;
      setItens((prev) => {
        const ex = prev.find((i) => i.produtoId === produto.id);
        if (ex)
          return prev.map((i) =>
            i.produtoId === produto.id
              ? { ...i, qtd: Math.min(i.qtd + q, produto.estoque) }
              : i,
          );
        return [
          ...prev,
          {
            produtoId: produto.id,
            nome: produto.nome,
            qtd: q,
            preco: produto.preco,
            unidade: produto.unidade,
            gtin: produto.gtin || undefined,
          },
        ];
      });
    } else if (produto.pesavel && qtd != null) {
      // pesável com peso já definido (veio da balança)
      setItens((prev) => [
        ...prev,
        {
          produtoId: produto.id,
          nome: produto.nome,
          qtd,
          preco: precoCalculado != null ? Math.round((precoCalculado / qtd) * 100) / 100 : produto.preco,
          unidade: "KG",
          gtin: produto.gtin || undefined,
        },
      ]);
    } else {
      // pesável sem peso → abre a balança
      setPesando({ produto, precoKg: produto.preco });
      return;
    }
    setUltimo({ produtoId: produto.id, nome: produto.nome, qtd: qtd ?? qtdPendente ?? 1, preco: precoCalculado ?? produto.preco, unidade: produto.unidade });
    setQtdPendente(null);
    setResultados([]);
    setBusca("");
    setMsg(null);
  }

  function removerUltimo() {
    setItens((prev) => {
      const novo = [...prev];
      const retirado = novo.pop();
      if (retirado) setMsg(`✕ Cancelado: ${retirado.nome}`);
      return novo;
    });
  }

  // ---------------- entrada principal (form do campo de busca) ----------------
  function processarEntrada(e?: React.FormEvent) {
    e?.preventDefault();
    const texto = busca;
    if (!texto.trim()) return;

    const interp = interpretarEntrada(texto, cfg.etiquetaBalanca);

    // ---- sintaxe "NÚMERO x" — define multiplicador pra próxima execução
    if (interp.tipo === "qtd") {
      if (interp.valor <= 0) return setMsg("Quantidade deve ser positiva.");
      if (interp.resto) {
        // já veio junto: "3x banana" ou bipe após "3x"
        setQtdPendente(interp.valor);
        setBusca(interp.resto);
        setMsg(`Qtd ${interp.valor} definida — agora bipe o produto.`);
        return;
      }
      setQtdPendente(interp.valor);
      setBusca("");
      setMsg(`Qtd ${interp.valor} — bipe/digite o produto.`);
      return;
    }

    // ---- etiqueta da BALANÇA (EAN-13 começando com 2)
    if (interp.tipo === "balanca") {
      const produto = db.produtos.find(
        (p) => p.codBalanca && p.codBalanca.replace(/^0+/, "") === interp.cod.replace(/^0+/, ""),
      );
      if (!produto) {
        setMsg(`Código de balança ${interp.cod} não cadastrado.`);
        setBusca("");
        return;
      }
      if (cfg.etiquetaBalanca === "valor") {
        // etiqueta carrega o preço total → vira item unitário com preço calculado
        adicionar(produto, 1, interp.medida);
        setUltimo({ produtoId: produto.id, nome: `${produto.nome} (etiq. R$)`, qtd: 1, preco: interp.medida, unidade: produto.unidade });
      } else {
        // etiqueta carrega o peso em gramas
        adicionar(produto, interp.medida);
      }
      return;
    }

    // ---- busca convencional por nome / SKU / GTIN
    const r = buscarProduto(String(interp.tipo === "busca" ? interp.termo : texto), db.produtos);

    if (r.tipo === "produto") {
      adicionar(r.produto, qtdPendente ?? undefined);
    } else if (r.tipo === "lista") {
      setResultados(r.produtos);
      setMsg(`${r.produtos.length} produtos — escolha abaixo ou refine a busca.`);
    } else {
      setMsg(`Não encontrado: "${texto}"`);
      setBusca("");
      focar();
    }
  }

  // ---------------- página de pagamento ----------------
  function abrirPagamento() {
    setPagModal(true);
    setValorPago((total + frete).toFixed(2));
  }

  /** Gera DAV (Documento Auxiliar de Venda — sem valor fiscal) */
  function gerarDav() {
    const cliente = db.clientes.find((c) => c.id === clienteId);
    const numero = (db.vendas[0]?.numero ?? 1000) + 1;

    const venda: Venda = {
      id: crypto.randomUUID(),
      numero,
      clienteId: clienteId || null,
      clienteNome: cliente?.nome ?? "Consumidor final",
      itens,
      total: Math.round((total + frete) * 100) / 100,
      desconto,
      vFrete: frete,
      transporte: frete > 0 ? { modFrete: "1" as const, vFrete: frete, transportadorNome: trnNome || undefined, transportadorCnpj: trnCnpj || undefined, placa: placa || undefined, ufVeiculo: placaUf || undefined } : null,
      tPag: "90", // DAV nao tem pagamento fiscal
      pagamento,
      data: Date.now(),
      tipo: "dav",
      status: "aberto",
      validade: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      fiscal: undefined,
    };

    const { id: _i, numero: _n, data: _d, ...payload } = venda;
    registrarVenda(payload);
    enfileirar(venda);

    setRecibo(venda);
    setPagModal(false);
    setItens([]);
    setUltimo(null);
    setDesconto(0);
    setClienteId("");
    setEtapa("espera");
  }

  function finalizar() {
    const cliente = db.clientes.find((c) => c.id === clienteId);
    const totalComFrete = Math.round((total + frete) * 100) / 100;
    const numero = (db.vendas[0]?.numero ?? 1000) + 1;
    const nota = db.vendas.filter((v) => v.fiscal).length + 1;

    const venda: Venda = {
      id: crypto.randomUUID(),
      numero,
      clienteId: clienteId || null,
      clienteNome: cliente?.nome ?? "Consumidor final",
      itens,
      total: Math.round((total + frete) * 100) / 100,
      desconto,
      vFrete: frete,
      transporte: frete > 0 ? { modFrete: "1" as const, vFrete: frete, transportadorCnpj: trnCnpj || undefined, transportadorNome: trnNome || undefined, placa: placa || undefined, ufVeiculo: placaUf || undefined } : null,
      tPag: T_PAG_MAP[pagamento],
      vPago: pagamento === "dinheiro" ? Number(valorPago) : undefined,
      vTroco: pagamento === "dinheiro" && Number(valorPago) > totalComFrete ? Math.round((Number(valorPago) - totalComFrete) * 100) / 100 : undefined,
      pagamento,
      data: Date.now(),
      tipo: "fiscal",
      status: "faturado",
      fiscal: {
        modelo,
        serie: "1",
        numeroNota: nota,
        chave: gerarChave(nota),
        protocolo: `135${Date.now()}`.slice(0, 15),
        autorizadaEm: Date.now(),
      },
    };

    const { id: _i, numero: _n, data: _d, ...payload } = venda;
    registrarVenda(payload);
    enfileirar(venda);

    setRecibo(venda);
    setPagModal(false);
    setItens([]);
    setUltimo(null);
    setDesconto(0);
    setClienteId("");
    setEtapa("espera");
  }

  // ============================ RENDER ============================

  // ---------- TELA DE ESPERA (standby) ----------
  if (etapa === "espera" && !recibo)
    return (
      <div
        className="fixed inset-0 z-40 flex select-none flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white"
        onClick={iniciarVenda}
        onKeyDown={(e) => e.key && iniciarVenda()}
        tabIndex={0}
      >
        <TopoCaixa cfg={cfg} agora={agora} online={online} onConfig={() => setAbrirCfg(true)} conta={conta} onSair={() => sairPDV(true)} />

        <div className="flex flex-1 flex-col items-center justify-center px-8">
          <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-sky-400 to-sky-600 text-5xl font-black shadow-2xl shadow-sky-900/60">
            N
          </div>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">CAIXA LIVRE</h1>
          <p className="mt-3 text-lg text-slate-400">
            Passe o produto no leitor ou toque na tela para iniciar
          </p>
          <p className="mt-2 text-sm font-medium text-slate-500">
            ESC ou botão ✕ Sair no topo para voltar ao ERP
          </p>

          {produtosEspera.length > 0 && (
            <div className="mt-12 w-full max-w-4xl">
              <p className="mb-4 text-center text-xs font-bold uppercase tracking-widest text-slate-500">
                Ofertas de hoje
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {produtosEspera.slice(0, 5).map((p) => (
                  <div key={p.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-center backdrop-blur">
                    <p className="truncate text-sm font-medium text-slate-200">{p.nome}</p>
                    <p className="mt-1 text-xs text-slate-500">{p.unidade}</p>
                    <p className="mt-2 text-xl font-black text-sky-300">{fmt(p.preco)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <RodapeCaixa fila={fila.length} operador={cfg.operador || conta?.nome || ""} />
        {abrirCfg && <ConfigCaixa cfg={cfg} setCfg={setCfg} produtos={db.produtos} fechar={() => setAbrirCfg(false)} />}
      </div>
    );

  // ---------- RECIBO APÓS VENDA ----------
  if (recibo)
    return (
      <DocumentoWrapper recibo={recibo} conta={conta} fechar={() => setRecibo(null)} autoSegundos={cfg.autoEspera} />
    );

  // ---------- TELA DE VENDA (caixa ativo) ----------
  return (
    <div className="fixed inset-0 z-40 flex select-none flex-col bg-slate-100 text-slate-900">
      <TopoCaixa cfg={cfg} agora={agora} online={online} onConfig={() => setAbrirCfg(true)} conta={conta} onSair={() => sairPDV(true)} />

      {/* ------------------------------- corpo ------------------------------- */}
      <div className="flex min-h-0 flex-1">
        {/* itens */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            Itens da venda ({itens.length})
          </div>
          <div className="flex-1 overflow-auto">
            {itens.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-slate-400">
                <p className="text-6xl">🛒</p>
                <p className="mt-4 text-lg font-medium">Nenhum item ainda</p>
                <p className="mt-1 text-sm">bipe o código de barras ou digite "3x" + produto</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="w-10 px-3 py-2">#</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="w-24 px-3 py-2 text-center">Qtd</th>
                    <th className="w-28 px-3 py-2 text-right">Unitário</th>
                    <th className="w-28 px-3 py-2 text-right">Total</th>
                    <th className="w-10 px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...itens].reverse().map((i, idx) => (
                    <tr key={idx} className={idx === 0 ? "bg-sky-50/60" : ""}>
                      <td className="px-3 py-3 text-xs text-slate-400">{itens.length - idx}</td>
                      <td className="px-3 py-3">
                        <p className="text-base font-medium text-slate-900">{i.nome}</p>
                        {i.gtin && <p className="font-mono text-[10px] text-slate-400">{i.gtin}</p>}
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-slate-800">
                        {fmtQtd(i.qtd, i.unidade || "UN")}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmt(i.preco)}</td>
                      <td className="px-3 py-3 text-right text-lg font-bold text-slate-900">
                        {fmt(i.qtd * i.preco)}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() =>
                            setItens((prev) => prev.filter((_, x) => x !== itens.length - 1 - idx))}
                          className="text-slate-300 hover:text-rose-500"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* --------------------------- painel direito --------------------------- */}
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-slate-200 bg-slate-900 text-white">
          {/* último item em destaque */}
          <div className="border-b border-white/10 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Último item</p>
            {ultimo ? (
              <>
                <p className="mt-1.5 line-clamp-2 text-xl font-bold leading-snug">{ultimo.nome}</p>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-slate-400">
                    {fmtQtd(ultimo.qtd, ultimo.unidade || "UN")}
                  </span>
                  <span className="text-3xl font-black text-sky-300">{fmt((ultimo.qtd || 1) * (ultimo.preco || 0))}</span>
                </div>
              </>
            ) : (
              <p className="mt-2 text-slate-500">—</p>
            )}
          </div>

          {/* totalizadores */}
          <div className="space-y-2 border-b border-white/10 p-4">
            <LinhaTotal label="Itens" valor={String(qtdItens)} />
            <LinhaTotal label="Subtotal" valor={fmt(subtotal)} />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Desconto</span>
              <input
                type="number"
                min={0}
                value={desconto}
                onChange={(e) => setDesconto(Number(e.target.value))}
                className="w-24 rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-right text-sm font-bold outline-none focus:border-sky-400"
              />
            </div>
          </div>

          {/* TOTAL gigante */}
          {/* tributos estimados — transparência Lei 12.741 + reforma IBS/CBS */}
          <div className="border-b border-white/10 px-4 py-3 text-[11px] text-slate-400">
            <div className="flex justify-between">
              <span>Tributos estimados</span>
              <span className="font-bold text-slate-300">{fmt(tributos.total)}</span>
            </div>
            <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
              <span>CBS {fmt(tributos.cbs)} · IBS {fmt(tributos.ibs)}</span>
              <span className="rounded bg-violet-500/20 px-1.5 py-0.5 font-bold text-violet-300">
                reforma 2027
              </span>
            </div>
          </div>

          <div className="flex-1 p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total a pagar</p>
            <p className="mt-2 text-6xl font-black leading-none text-emerald-400">
              {brl(total)}
            </p>
          </div>

          {/* botões de função */}
          <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-4">
            <button onClick={abrirPagamento} disabled={!itens.length}
              className="rounded-xl bg-sky-500 py-3.5 text-sm font-black transition hover:bg-sky-400 disabled:opacity-30">
              F10 — TOTAL
            </button>
            <button onClick={removerUltimo} disabled={!itens.length}
              className="rounded-xl bg-rose-500/20 py-3.5 text-sm font-bold text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-30">
              F4 — Cancelar
            </button>
            <button onClick={() => { setClienteId(clienteId ? "" : db.clientes[0]?.id ?? ""); }}
              className="col-span-2 rounded-xl bg-white/10 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-white/20">
              {clienteId ? `Cliente: ${db.clientes.find(c => c.id === clienteId)?.nome}` : "Cliente: Consumidor final (clique p/ alterar)"}
            </button>
          </div>
        </aside>
      </div>

      {/* --------------------------- busca (entrada) --------------------------- */}
      <form onSubmit={processarEntrada} className="border-t-2 border-sky-500 bg-slate-900 p-4">
        {msg && (
          <p className={cn("mb-2 truncate text-sm font-medium",
            msg.startsWith("✕") ? "text-rose-400" : msg.startsWith("✓") ? "text-emerald-400" : "text-amber-400")}>
            {msg}
          </p>
        )}
        <div className="flex items-center gap-3">
          {qtdPendente != null && (
            <div className="flex items-center gap-1 rounded-xl bg-sky-500/20 px-4 py-2">
              <span className="text-xs font-bold uppercase text-sky-300">Qtd</span>
              <span className="text-2xl font-black text-sky-300">{qtdPendente}</span>
              <span className="text-xl font-black text-sky-400">X</span>
            </div>
          )}
          <input
            ref={inputRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder='Digite/bipe o produto, ou "3x" antes · F2 foco'
            className="h-16 flex-1 rounded-2xl border-2 border-white/20 bg-white px-6 text-2xl font-bold tracking-wide text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-sky-400"
            autoComplete="off"
          />
        </div>

        {/* resultados da busca */}
        {resultados.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {resultados.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => adicionar(p)}
                className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-4 py-3 text-left text-sm transition hover:bg-white/20"
              >
                <span className="min-w-0">
                  <span className="block truncate font-bold">{p.nome}</span>
                  <span className="text-xs text-slate-400">{p.sku} · {p.unidade}</span>
                </span>
                <span className="shrink-0 font-black text-sky-300">{fmt(p.preco)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-medium text-slate-500">
          <span><kbd className="rounded bg-white/10 px-1.5">F2</kbd> buscar</span>
          <span><kbd className="rounded bg-white/10 px-1.5">F4</kbd> cancela último</span>
          <span><kbd className="rounded bg-white/10 px-1.5">F6</kbd> vendas</span>
          <span><kbd className="rounded bg-white/10 px-1.5">F7</kbd> consulta preço</span>
          <span><kbd className="rounded bg-white/10 px-1.5">F10</kbd> fecha venda</span>
          <span><kbd className="rounded bg-white/10 px-1.5">ESC</kbd> cancela venda</span>
          <span className="ml-auto">Balança: bipe etiqueta EAN iniciando em 2</span>
        </div>
      </form>

      {/* ----------------------------- balança ----------------------------- */}
      {pesando && (
        <ModalBalanca
          produto={pesando.produto}
          precoKg={pesando.precoKg}
          onOk={(kg) => { adicionar(pesando.produto, kg); setPesando(null); }}
          onCancel={() => setPesando(null)}
        />
      )}

      {/* ----------------------------- pagamento ----------------------------- */}
      {pagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={() => setPagModal(false)}>
          <div className="mx-4 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">TOTAL — Fechamento da venda</h3>
              <button onClick={() => setPagModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mb-4 text-center">
              <p className="text-sm text-slate-500">Total a cobrar</p>
              <p className="text-5xl font-black text-emerald-600">{fmt(total + frete)}</p>
              {frete > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  itens {fmt(total)} · frete {fmt(frete)}
                </p>
              )}
            </div>
            <div className="mb-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Cliente</span>
                <select value={clienteId} onChange={(e) => setClienteId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option value="">Consumidor final</option>
                  {db.clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Modelo fiscal</span>
                <select value={modelo} onChange={(e) => setModelo(e.target.value as any)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  <option>NFC-e</option><option>NF-e</option><option>SAT</option>
                </select>
              </label>
            </div>

            {/* Frete e transporte (bloco necessário na NF-e) */}
            <details className="mb-4 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-left">
              <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wide text-slate-500">
                🚚 Frete e transporte {frete > 0 ? `· ${fmt(frete)}` : "(opcional)"}
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">Valor do frete (R$)</span>
                  <input
                    type="number" step="0.01" min={0} value={frete}
                    onChange={(e) => setFrete(Math.max(0, Number(e.target.value)))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-slate-500">Modalidade</span>
                  <select
                    value={frete > 0 ? "1" : "9"}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    disabled
                  >
                    <option value="9">9 — Sem cobrança de frete</option>
                    <option value="1">1 — Por conta do destinatário</option>
                  </select>
                </label>
                {frete > 0 && (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500">Transportadora (nome)</span>
                      <input value={trnNome} onChange={(e) => setTrnNome(e.target.value)} placeholder="Opcional"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-slate-500">CNPJ da transportadora</span>
                      <input value={trnCnpj} onChange={(e) => setTrnCnpj(e.target.value.replace(/\D/g, "").slice(0, 14))} placeholder="Opcional"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-xs text-slate-500">Placa</span>
                        <input value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8))} placeholder="ex: ABC1D23"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs text-slate-500">UF</span>
                        <input value={placaUf} onChange={(e) => setPlacaUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="ex: SP"
                          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500" />
                      </label>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Frete soma ao total da nota (vProd + vFrete = vNF na SEFAZ).
                    </p>
                  </>
                )}
              </div>
            </details>
            <p className="mb-2 text-xs font-medium text-slate-600">Forma de pagamento</p>
            <div className="grid grid-cols-3 gap-2">
              {PAGAMENTOS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPagamento(p)}
                  className={cn(
                    "rounded-xl py-3 text-sm font-bold capitalize transition",
                    pagamento === p ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                  )}
                >
                  {p === "prazo" ? "a prazo" : p}
                </button>
              ))}
            </div>
            {pagamento === "dinheiro" && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm text-slate-600">Valor recebido</label>
                  <input
                    type="number" step="0.01" value={valorPago}
                    onChange={(e) => setValorPago(e.target.value)}
                    className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-right text-lg font-black outline-none focus:border-sky-500"
                  />
                </div>
                {Number(valorPago) > total && (
                  <p className="mt-2 text-right text-xl font-black text-emerald-600">
                    Troco: {fmt(Number(valorPago) - total)}
                  </p>
                )}
                {Number(valorPago) < total && (
                  <p className="mt-2 text-right text-xs font-bold text-rose-600">Faltam {fmt(total - Number(valorPago))}</p>
                )}
              </div>
            )}
            <button
              onClick={finalizar}
              className="mt-5 w-full rounded-xl bg-emerald-600 py-4 text-lg font-black text-white transition hover:bg-emerald-500 disabled:opacity-40"
              disabled={pagamento === "dinheiro" && Number(valorPago) < total || !fiscalLiberado}
              title={!fiscalLiberado ? "Emissão fiscal é do plano Pro" : ""}
            >
              CONFIRMAR · F10
            </button>

            {/* DAV — sem valor fiscal, disponível em todos os planos */}
            <button
              onClick={gerarDav}
              className="mt-2 w-full rounded-xl border-2 border-amber-400 bg-amber-50 py-3 text-sm font-black text-amber-800 transition hover:bg-amber-100"
            >
              📄 Gerar DAV (sem nota fiscal) — válido por 7 dias
            </button>

            {!fiscalLiberado && (
              <p className="mt-2 text-center text-[11px] text-amber-700">
                Emissão fiscal disponível no plano Pro. No Grátis, emitimos DAV.
              </p>
            )}
          </div>
        </div>
      )}

      {consultandoPreco && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
          onClick={() => { setConsultandoPreco(false); setBuscaPreco(""); setProdutoConsulta(null); }}
        >
          <div
            className="mx-4 w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">F7 — Consulta de preço</h3>
              <button
                onClick={() => { setConsultandoPreco(false); setBuscaPreco(""); setProdutoConsulta(null); }}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <p className="mb-4 text-sm text-slate-500">
              Consulte sem adicionar à venda. Bipe o código de barras ou digite o nome.
            </p>

            <input
              autoFocus
              value={buscaPreco}
              onChange={(e) => {
                const termo = e.target.value;
                setBuscaPreco(termo);
                const r = buscarProduto(termo, db.produtos);
                if (r.tipo === "produto") setProdutoConsulta(r.produto);
                else setProdutoConsulta(db.produtos.find((p) => p.gtin === termo.trim()) || null);
              }}
              placeholder="Código, nome ou código de barras..."
              className="mb-4 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg outline-none focus:border-sky-500"
            />

            {produtoConsulta ? (
              <div className="rounded-xl bg-sky-50 p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-lg font-bold text-slate-900">{produtoConsulta.nome}</p>
                    <p className="text-sm text-slate-500">{produtoConsulta.sku} · {produtoConsulta.marca || "s/ marca"}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-700">
                        {produtoConsulta.categoria}
                      </span>
                      <span className="rounded bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                        {produtoConsulta.unidade}
                      </span>
                      {produtoConsulta.pesavel && (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                          pesável
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-3xl font-black text-sky-700">{fmt(produtoConsulta.preco)}</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center text-xs text-slate-600">
                  <div className="rounded bg-white/60 px-3 py-2">
                    <p className="text-[10px] uppercase text-slate-400">Estoque</p>
                    <p className="font-bold text-slate-800">{produtoConsulta.estoque} {produtoConsulta.unidade}</p>
                  </div>
                  <div className="rounded bg-white/60 px-3 py-2">
                    <p className="text-[10px] uppercase text-slate-400">Tributos est.</p>
                    <p className="font-bold text-slate-800">
                      {(() => {
                        const t = tributosEstimados(produtoConsulta.preco, produtoConsulta.impostos);
                        return fmt(t.total);
                      })()}
                    </p>
                  </div>
                </div>
                {produtoConsulta.pesavel && (
                  <p className="mt-3 text-center text-[11px] text-amber-700">
                    para vender, use F9 na balança
                  </p>
                )}
              </div>
            ) : (
              buscaPreco.trim() && (
                <p className="rounded-lg bg-slate-50 p-3 text-center text-sm text-slate-400">
                  Digite mais caracteres para consultar...
                </p>
              )
            )}
          </div>
        </div>
      )}

      {/* ---------------- F6 — Consulta de vendas (contingência, reimprimir, inutilização) ---------------- */}
      {consultaVendas && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setConsultaVendas(false)}>
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">F6 — Consulta de vendas do dia</h3>
              <div className="flex gap-2">
                <button onClick={() => setInutilizarTela(true)}
                  className="rounded-lg bg-amber-100 px-4 py-2 text-xs font-bold text-amber-800 hover:bg-amber-200">
                  ⚠ Inutilizar numeração
                </button>
                <button onClick={() => setConsultaVendas(false)} className="text-slate-400 hover:text-slate-600">✕</button>
              </div>
            </div>

            <div className="overflow-auto flex-1">
              {db.vendas.filter((v) => {
                const hoje = new Date().setHours(0,0,0,0);
                return v.data >= hoje && v.tipo === "fiscal";
              }).length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                  Nenhuma venda fiscal hoje ainda
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Nº</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Pagto.</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-center">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {db.vendas
                      .filter((v) => {
                        const hoje = new Date().setHours(0,0,0,0);
                        return v.data >= hoje && v.tipo === "fiscal";
                      })
                      .slice(0, 20)
                      .map((v) => {
                        const minutos = Math.floor((Date.now() - (v.fiscal?.autorizadaEm ?? v.data)) / 60000);
                        const podeCancelar = v.status === "faturado";
                        const limiteMin = (db.configFiscal.ambiente === 2 ? 1440 : 30);
                        const dentroDoPrazo = minutos < limiteMin;
                        return (
                          <tr key={v.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-sky-700">#{v.numero}</td>
                            <td className="px-4 py-3 text-slate-700">{v.clienteNome}</td>
                            <td className="px-4 py-3 text-xs text-slate-500">{new Date(v.data).toLocaleTimeString("pt-BR")}</td>
                            <td className="px-4 py-3 capitalize text-slate-600">{v.pagamento === "prazo" ? "a prazo" : v.pagamento}</td>
                            <td className="px-4 py-3">
                              {v.status === "cancelado"
                                ? <span className="rounded-full bg-rose-100 px-2 py-1 text-[11px] font-bold text-rose-700">Cancelada</span>
                                : <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">Autorizada</span>}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-slate-900">{brl(v.total)}</td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              {v.status !== "cancelado" && (
                                <>
                                  <button
                                    onClick={() => setReprint(v)}
                                    className="mr-2 rounded bg-sky-100 px-2 py-1 text-[11px] font-bold text-sky-700 hover:bg-sky-200"
                                    title="Reimprimir cupom"
                                  >
                                    🖨 Reimprimir
                                  </button>
                                  <button
                                    onClick={() => { setCancelando(v); setMotivoCanc("Venda efetuada por erro no PDV, favor cancelar"); }}
                                    disabled={!dentroDoPrazo || !podeCancelar}
                                    className={cn(
                                      "rounded px-2 py-1 text-[11px] font-bold",
                                      dentroDoPrazo && podeCancelar
                                        ? "bg-rose-100 text-rose-700 hover:bg-rose-200"
                                        : "bg-slate-100 text-slate-300 cursor-not-allowed",
                                    )}
                                  >
                                    ↩ Cancelar
                                  </button>
                                  {!dentroDoPrazo && (
                                    <span className="ml-1 text-[10px] text-slate-300" title="Prazo expirado (SEFAZ: até 30 min)">
                                      expirado
                                    </span>
                                  )}
                                </>
                              )}
                              {v.status === "cancelado" && (
                                <span className="text-[10px] text-slate-300">cancelada</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>

            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
              SEFAZ: cancelamento fiscal permite até 30 minutos em produção · Esc = fecha a venda atual
            </p>
          </div>
        </div>
      )}

      {/* Reimpressão do cupom */}
      {reprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setReprint(null)}>
          <div className="my-auto w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sky-100 text-2xl mx-auto">🖨</div>
            <h3 className="text-lg font-black text-slate-900">Reimprimir #{reprint.numero}</h3>
            <p className="text-sm text-slate-500">{reprint.clienteNome} · {brl(reprint.total)}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => window.print()}
                className="rounded-lg bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-700">
                Imprimir
              </button>
              <button onClick={() => setReprint(null)}
                className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal cancelamento (contingência) */}
      {cancelando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          onClick={() => setCancelando(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-xl">⚠️</span>
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Cancelar NFC-e #{cancelando.numero}
                </h3>
                <p className="text-xs text-slate-500">
                  Evento de cancelamento fiscal · devolve estoque automaticamente
                </p>
              </div>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{cancelando.clienteNome}</span>
                <span>{cancelando.itens.length} itens</span>
              </div>
              <div className="mt-1 flex justify-between text-lg font-black text-slate-900">
                <span>Total da nota</span>
                <span className="text-rose-600">{brl(cancelando.total)}</span>
              </div>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Justificativa do cancelamento
              </span>
              <textarea
                rows={2}
                value={motivoCanc}
                onChange={(e) => setMotivoCanc(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-800">
              <strong>Não desfaz:</strong> o cancelamento registra protocolo do evento de cancelamento,
              devolve o estoque e baixa o título a receber, se houver.
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => setCancelando(null)}
                className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Voltar
              </button>
              <button
                onClick={() => {
                  if (!motivoCanc.trim()) return alert("Informe a justificativa.");
                  cancelarVenda(cancelando.id, motivoCanc);
                  setCancelando(null);
                }}
                className="rounded-lg bg-rose-600 py-3 text-sm font-black text-white hover:bg-rose-700"
              >
                Confirmar cancelamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal inutilização de numeração */}
      {inutilizarTela && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setInutilizarTela(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">⚠ Inutilizar numeração fiscal</h3>
            <p className="mt-1 text-sm text-slate-500">
              Quando uma numeração pula sem emitir nota, a SEFAZ exige registro de inutilização.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Número inicial</span>
                <input type="number" value={inutInicio} onChange={(e) => setInutInicio(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Número final</span>
                <input type="number" value={inutFim} onChange={(e) => setInutFim(Math.max(1, Number(e.target.value)))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </label>
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Justificativa</span>
              <textarea rows={2} value={inutJust} onChange={(e) => setInutJust(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500" />
            </label>

            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Uso correto:</strong> inutilize apenas números que NUNCA foram emitidos.
              Se a nota já foi emitida, use F6 → Cancelar.
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button onClick={() => setInutilizarTela(false)}
                className="rounded-lg border border-slate-200 py-3 text-sm font-bold text-slate-600">Voltar</button>
              <button
                onClick={() => {
                  if (!inutJust.trim()) return alert("Informe a justificativa.");
                  inutilizar(inutInicio, inutFim, inutJust);
                  setInutilizarTela(false);
                }}
                className="rounded-lg bg-amber-600 py-3 text-sm font-black text-white">
                Inutilizar {inutInicio} até {inutFim}
              </button>
            </div>
          </div>
        </div>
      )}

      {abrirCfg && <ConfigCaixa cfg={cfg} setCfg={setCfg} produtos={db.produtos} fechar={() => setAbrirCfg(false)} />}
    </div>
  );
}

// ============================ SUB-COMPONENTES ============================

function DocumentoWrapper({ recibo, conta, fechar, autoSegundos }: { recibo: Venda; conta: any; fechar: () => void; autoSegundos: number }) {
  const [verCupom, setVerCupom] = useState(false);
  const { db } = useStore();

  useEffect(() => {
    if (autoSegundos > 0) {
      const t = setTimeout(fechar, autoSegundos * 1000);
      return () => clearTimeout(t);
    }
  }, [recibo, autoSegundos]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 p-6 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-3xl shadow-lg shadow-emerald-900/50">✓</div>
      <h2 className="mt-4 text-3xl font-black">Venda #{recibo.numero} registrada</h2>
      <p className="mt-1 text-xl capitalize text-slate-400">
        {recibo.fiscal ? `${recibo.fiscal.modelo} autorizada` : "registrada"} · {recibo.pagamento === "prazo" ? "a prazo" : recibo.pagamento}
      </p>
      <p className="mt-3 text-5xl font-black text-emerald-400">{brl(recibo.total)}</p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          onClick={() => setVerCupom(true)}
          className="rounded-2xl bg-white/10 px-8 py-4 text-lg font-bold transition hover:bg-white/20"
        >
          🧾 Imprimir cupom
        </button>
        <button
          onClick={fechar}
          className="rounded-2xl bg-sky-600 px-8 py-4 text-lg font-black transition hover:bg-sky-500"
        >
          ↩ Novo cliente
        </button>
      </div>
      <p className="mt-6 text-sm text-slate-500">
        ou aguarde — volta à espera em {autoSegundos}s automaticamente
      </p>

      {verCupom && (
        <Documento
          venda={recibo}
          empresa={conta?.empresa ?? ""}
          cnpj={conta?.cnpj ?? ""}
          onClose={() => setVerCupom(false)}
          produtos={db.produtos}
        />
      )}
    </div>
  );
}

function TopoCaixa({ cfg, agora, online, onConfig, conta, onSair }: any) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-white/10 bg-slate-900 px-5 py-2.5 text-sm text-slate-300">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 font-black text-white">N</span>
        <div>
          <p className="text-xs text-slate-500">NKWAY Frente de Caixa</p>
          <p className="font-bold text-white">
            CAIXA {cfg.numeroCaixa} · {cfg.operador || conta?.nome || "operador"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", online ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
          {online ? "● online" : "● offline — vendas em fila"}
        </span>
        <span className="hidden text-slate-400 sm:block">
          {agora.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
        </span>
        <span className="rounded-lg bg-white/10 px-3 py-1 font-mono text-sm font-bold tabular-nums">
          {agora.toLocaleTimeString("pt-BR")}
        </span>
        <button onClick={onConfig} className="rounded-lg bg-white/10 p-2 transition hover:bg-white/20" title="Configurações do caixa">
          ⚙️
        </button>
        {/* Botão de saída — SEMPRE visível, volta ao ERP */}
        <button
          onClick={onSair}
          className="flex items-center gap-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-black text-rose-300 transition hover:bg-rose-500/30"
          title="Sair do PDV (ESC)"
        >
          ✕ Sair
        </button>
      </div>
    </header>
  );
}

function LinhaTotal({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <span className="text-lg font-bold text-slate-200">{valor}</span>
    </div>
  );
}

function RodapeCaixa({ fila, operador }: { fila: number; operador: string }) {
  return (
    <footer className="flex items-center justify-between bg-slate-950 px-5 py-2 text-xs text-slate-500">
      <span>Operador: {operador || "operador"}</span>
      <span>{fila > 0 ? `☁ ${fila} vendas aguardando sincronização` : "sistema sincronizado"}</span>
      <span>NKWAY · fila rápida</span>
    </footer>
  );
}

// ----------------------------- caixa de configuração -----------------------------

function ConfigCaixa({ cfg, setCfg, produtos, fechar }: {
  cfg: PdvConfig;
  setCfg: (c: PdvConfig) => void;
  produtos: Produto[];
  fechar: () => void;
}) {
  const [f, setF] = useState(cfg);

  function salvar() {
    setCfg(f);
    salvarConfig(f);
    fechar();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={fechar}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-black text-slate-900">Configurações do caixa</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Número do caixa</span>
              <input value={f.numeroCaixa} onChange={(e) => setF({ ...f, numeroCaixa: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-500">Operador</span>
              <input value={f.operador} onChange={(e) => setF({ ...f, operador: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Etiqueta de balança carrega</span>
            <select value={f.etiquetaBalanca} onChange={(e) => setF({ ...f, etiquetaBalanca: e.target.value as any })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500">
              <option value="valor">Valor em R$ (centavos na etiqueta)</option>
              <option value="peso">Peso em Kg (gramas na etiqueta)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Voltar à espera após venda (segundos)</span>
            <input type="number" value={f.autoEspera} onChange={(e) => setF({ ...f, autoEspera: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
          </label>
          <div>
            <span className="mb-2 block text-xs font-medium text-slate-500">
              Produtos exibidos na tela de espera (marque até 5)
            </span>
            <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
              {[...produtos].sort((a, b) => a.nome.localeCompare(b.nome)).map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={f.skusEspera.includes(p.sku)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        skusEspera: e.target.checked
                          ? [...f.skusEspera, p.sku].slice(0, 5)
                          : f.skusEspera.filter((s) => s !== p.sku),
                      })}
                    className="accent-sky-600"
                  />
                  <span className="flex-1 truncate text-slate-700">{p.nome}</span>
                  <span className="font-bold text-slate-900">{brl(p.preco)}/{p.unidade}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={fechar} className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-bold text-slate-600">Cancelar</button>
          <button onClick={salvar} className="flex-1 rounded-lg bg-sky-600 py-2.5 text-sm font-black text-white">Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------- modal da balança (simulação) -----------------------------

function ModalBalanca({ produto, precoKg, onOk, onCancel }: {
  produto: Produto;
  precoKg: number;
  onOk: (kg: number) => void;
  onCancel: () => void;
}) {
  const [peso, setPeso] = useState(0);
  const [estavel, setEstavel] = useState(false);
  const [manual, setManual] = useState<string>("");

  // simula leitura serial da balança: sobe oscilando até estabilizar
  useEffect(() => {
    const alvo = 0.215 + Math.random() * 2.5;
    let t = 0;
    const id = setInterval(() => {
      t += 100;
      if (t >= 1500) {
        // estabilizou: trava o peso definitivo
        setPeso(alvo);
        setEstavel(true);
        clearInterval(id);
        return;
      }
      // oscila convergindo pro peso-alvo (sem ler estado stale)
      const aprox = (t / 1500) * alvo;
      const ruido = (Math.random() - 0.5) * 0.02 * (1 - t / 1500);
      setPeso(Math.max(0, aprox + ruido));
    }, 100);
    return () => clearInterval(id);
  }, []);

  const kg = manual ? parseFloat(manual.replace(",", ".")) : peso;
  const valido = !isNaN(kg) && kg > 0.001;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 text-white shadow-2xl ring-1 ring-white/10">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Balança eletrônica</p>
        <h3 className="mt-1 text-xl font-black">{produto.nome}</h3>
        <p className="text-sm text-slate-400">{fmt(precoKg)}/kg · preço calculado no peso</p>

        {/* visor */}
        <div className="my-5 rounded-2xl bg-slate-950 p-5 text-center ring-2 ring-slate-800">
          <p className={cn("font-mono text-6xl font-black tabular-nums", estavel ? "text-emerald-400" : "text-amber-400")}>
            {kg.toFixed(3).replace(".", ",")}
            <span className="text-3xl">kg</span>
          </p>
          <p className={cn("mt-1 text-xs font-bold uppercase tracking-widest", estavel ? "text-emerald-500" : "text-amber-500")}>
            {estavel ? "● peso estável" : "● estabilizando..."}
          </p>
        </div>

        {/* total */}
        <div className="flex items-baseline justify-between rounded-xl bg-white/10 px-4 py-3">
          <span className="text-sm font-bold text-slate-400">Total do item</span>
          <span className="text-3xl font-black text-sky-300">{valido ? fmt(kg * precoKg) : "—"}</span>
        </div>

        {/* entrada manual (tara / teste sem balança) */}
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-slate-400">
            Ou digite o peso manualmente (kg)
          </span>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="0,500"
            className="w-full rounded-xl border-2 border-white/20 bg-white/10 px-4 py-3 text-2xl font-black outline-none focus:border-sky-400"
          />
        </label>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={onCancel} className="rounded-xl bg-white/10 py-3 text-sm font-bold">Cancelar</button>
          <button disabled={!valido} onClick={() => onOk(kg)}
            className="rounded-xl bg-emerald-600 py-3 text-sm font-black disabled:opacity-30">
            F9 — Lan{valido ? "çar" : "çar"}
          </button>
        </div>
      </div>
    </div>
  );
}
