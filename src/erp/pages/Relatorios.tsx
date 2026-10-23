import { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { brl, valorAPrazo, type Venda } from "../types";
import { Badge, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";
import {
  ROTULO_PERIODO,
  dataLocal,
  dentroDoIntervalo,
  intervaloPeriodo,
  useFiltrosSalvos,
  type PresetPeriodo,
} from "../filtros";
import {
  ChipAtivo,
  IntervaloFiltro,
  LinhaFiltros,
  MultiSelectFiltro,
  PainelFiltros,
  SelectFiltro,
  inputFiltro,
} from "../FiltroUI";
import { BotaoExportar, exportarCsv } from "../Tabela";

/**
 * Relatórios no padrão dos ERPs de varejo (TOTVS, Sankhya, Bling, Tiny, ContaAzul):
 * escolher o relatório → filtrar período/critérios → ver indicadores + tabela →
 * pré-visualizar / imprimir / exportar CSV.
 */

const ABAS = [
  ["vendas", "💰 Vendas"],
  ["produtos", "📦 Produtos / ABC"],
  ["clientes", "👥 Clientes"],
  ["financeiro", "🏦 Financeiro"],
  ["fiscal", "🧾 Fiscal"],
  ["estoque", "🏷️ Estoque"],
] as const;

type AbaId = (typeof ABAS)[number][0];
type Forma = Venda["pagamento"];

const FORMAS: Forma[] = ["dinheiro", "pix", "debito", "credito", "boleto", "prazo"];
const rotuloForma = (p: string) =>
  p === "prazo" ? "a prazo" : p === "debito" ? "débito" : p === "credito" ? "crédito" : p;

const PRESETS: PresetPeriodo[] = ["hoje", "ontem", "ult7", "ult30", "mes", "mesAnterior", "personalizado", "todos"];

const FILTROS_PADRAO = {
  periodo: "ult30" as PresetPeriodo,
  de: "",
  ate: "",
  formas: [] as Forma[],
  modelos: [] as ("NFC-e" | "NF-e" | "SAT")[],
  status: "faturado" as "todos" | "faturado" | "cancelado",
  tipoDoc: "todos" as "todos" | "fiscal" | "dav",
  clienteId: "",
  categoria: "",
  avancado: false,
};

const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);
const fmtData = (iso: string) => (iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "");
const fmtTs = (ts: number) => new Date(ts).toLocaleDateString("pt-BR");

const TITULO: Record<AbaId, string> = {
  vendas: "Relatório de vendas",
  produtos: "Curva ABC de produtos",
  clientes: "Ranking de clientes",
  financeiro: "Contas a pagar e a receber",
  fiscal: "Emissões fiscais",
  estoque: "Posição de estoque",
};

export default function Relatorios() {
  const { db } = useStore();
  const [aba, setAba] = useState<AbaId>("vendas");
  const [preview, setPreview] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const { f, set, toggle, limpar } = useFiltrosSalvos("relatorios", FILTROS_PADRAO);

  const intervalo = intervaloPeriodo(f.periodo, f.de, f.ate);
  const clientes = useMemo(
    () => [...db.clientes].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [db.clientes],
  );
  const categorias = useMemo(
    () => [...new Set(db.produtos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [db.produtos],
  );

  /** Vendas no período / status / tipo / forma / cliente */
  const vendasBase = useMemo(() => {
    return db.vendas.filter((v) => {
      if (!dentroDoIntervalo(dataLocal(new Date(v.data)), intervalo)) return false;
      if (f.status === "faturado" && v.status !== "faturado") return false;
      if (f.status === "cancelado" && v.status !== "cancelado") return false;
      if (f.tipoDoc === "fiscal" && v.tipo !== "fiscal") return false;
      if (f.tipoDoc === "dav" && v.tipo !== "dav") return false;
      if (f.formas.length) {
        const formas = v.pagamentos?.length ? v.pagamentos.map((p) => p.forma) : [v.pagamento];
        if (!formas.some((x) => f.formas.includes(x))) return false;
      }
      if (f.modelos.length && !(v.fiscal && f.modelos.includes(v.fiscal.modelo))) return false;
      if (f.clienteId && v.clienteId !== f.clienteId) return false;
      return true;
    });
  }, [db.vendas, f, intervalo]);

  // indicadores de faturamento usam só vendas faturadas (não canceladas)
  const faturadas = useMemo(() => vendasBase.filter((v) => v.status === "faturado"), [vendasBase]);

  /* ---------------------------------- VENDAS ---------------------------------- */
  const fatTotal = faturadas.reduce((s, v) => s + v.total, 0);
  const ticket = faturadas.length ? fatTotal / faturadas.length : 0;
  const topVendas = [...faturadas].sort((a, b) => b.total - a.total).slice(0, 50);
  const porPagamento = FORMAS.map((p) => {
    let total = 0;
    faturadas.forEach((v) => {
      if (v.pagamentos?.length) {
        v.pagamentos.filter((x) => x.forma === p).forEach((x) => {
          let valor = x.valor;
          if (p === "dinheiro" && (v.vTroco ?? 0) > 0) valor = Math.max(0, valor - (v.vTroco ?? 0));
          total += valor;
        });
      } else if (v.pagamento === p) {
        total += p === "dinheiro" ? v.total - (v.vTroco ?? 0) : v.total;
      }
    });
    return { nome: p, total: Math.round(total * 100) / 100 };
  })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  const porDia = useMemo(() => {
    const map = new Map<string, number>();
    faturadas.forEach((v) => {
      const k = dataLocal(new Date(v.data));
      map.set(k, (map.get(k) ?? 0) + v.total);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, total]) => ({ dia, total }));
  }, [faturadas]);

  /* ---------------------------------- PRODUTOS -------------------------------- */
  const curvaData = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; qtd: number; receita: number; estoque: number; categoria: string }>();
    faturadas.forEach((v) =>
      v.itens.forEach((i) => {
        const prod = db.produtos.find((x) => x.id === i.produtoId);
        if (f.categoria && prod?.categoria !== f.categoria) return;
        const cur = map.get(i.produtoId) ?? {
          id: i.produtoId,
          nome: i.nome,
          qtd: 0,
          receita: 0,
          estoque: prod?.estoque ?? 0,
          categoria: prod?.categoria ?? "",
        };
        cur.qtd += i.qtd;
        cur.receita += i.qtd * i.preco;
        cur.estoque = prod?.estoque ?? cur.estoque;
        map.set(i.produtoId, cur);
      }),
    );
    const lista = [...map.values()].sort((a, b) => b.receita - a.receita);
    const totalReceita = lista.reduce((s, p) => s + p.receita, 0);
    let soma = 0;
    return lista.map((p) => {
      soma += p.receita;
      const acum = totalReceita > 0 ? (soma / totalReceita) * 100 : 0;
      return { ...p, acum, classe: (acum <= 80 ? "A" : acum <= 95 ? "B" : "C") as "A" | "B" | "C" };
    });
  }, [faturadas, db.produtos, f.categoria]);

  /* ---------------------------------- CLIENTES -------------------------------- */
  const topClientes = useMemo(() => {
    const map = new Map<string, { nome: string; compras: number; total: number }>();
    faturadas.forEach((v) => {
      const c = db.clientes.find((x) => x.id === v.clienteId);
      const k = c?.id ?? "consumidor";
      const cur = map.get(k) ?? { nome: c?.nome ?? "Consumidor final", compras: 0, total: 0 };
      cur.compras += 1;
      cur.total += v.total;
      map.set(k, cur);
    });
    return [...map.values()]
      .filter((c) => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .map((c) => ({ ...c, ticket: c.compras > 0 ? c.total / c.compras : 0 }));
  }, [faturadas, db.clientes]);

  /* ---------------------------------- FINANCEIRO ------------------------------ */
  const hojeStr = dataLocal();
  const receber = useMemo(() => {
    return db.lancamentos.filter((l) => {
      if (l.tipo !== "receber" || l.pago) return false;
      // no financeiro o período filtra por vencimento
      if (f.periodo !== "todos" && !dentroDoIntervalo(l.vencimento, intervalo)) return false;
      return true;
    });
  }, [db.lancamentos, f.periodo, intervalo]);
  const pagar = useMemo(() => {
    return db.lancamentos.filter((l) => {
      if (l.tipo !== "pagar" || l.pago) return false;
      if (f.periodo !== "todos" && !dentroDoIntervalo(l.vencimento, intervalo)) return false;
      return true;
    });
  }, [db.lancamentos, f.periodo, intervalo]);

  const porFaixa = (lista: typeof receber) => [
    { label: "Vencido", valor: lista.filter((l) => l.vencimento < hojeStr).reduce((s, l) => s + l.valor, 0), tone: "red" as const },
    {
      label: "0–7 dias",
      valor: lista
        .filter((l) => {
          const d = Math.ceil((new Date(l.vencimento + "T12:00").getTime() - Date.now()) / 864e5);
          return d >= 0 && d <= 7;
        })
        .reduce((s, l) => s + l.valor, 0),
      tone: "amber" as const,
    },
    {
      label: "8–30 dias",
      valor: lista
        .filter((l) => {
          const d = Math.ceil((new Date(l.vencimento + "T12:00").getTime() - Date.now()) / 864e5);
          return d > 7 && d <= 30;
        })
        .reduce((s, l) => s + l.valor, 0),
      tone: "sky" as const,
    },
    {
      label: "+30 dias",
      valor: lista
        .filter((l) => Math.ceil((new Date(l.vencimento + "T12:00").getTime() - Date.now()) / 864e5) > 30)
        .reduce((s, l) => s + l.valor, 0),
      tone: "slate" as const,
    },
  ];

  /* ---------------------------------- FISCAL ---------------------------------- */
  const comNota = useMemo(
    () =>
      vendasBase.filter((v) => v.fiscal && (f.status === "cancelado" ? v.status === "cancelado" : v.status !== "cancelado" || f.status === "todos")),
    [vendasBase, f.status],
  );
  const canceladas = vendasBase.filter((v) => v.status === "cancelado").length;
  const porModelo = (["NFC-e", "NF-e", "SAT"] as const).map((m) => ({
    modelo: m,
    total: comNota.filter((v) => v.fiscal?.modelo === m).length,
    valor: comNota.filter((v) => v.fiscal?.modelo === m).reduce((s, v) => s + v.total, 0),
  }));

  /* ---------------------------------- ESTOQUE --------------------------------- */
  const posicao = useMemo(() => {
    return db.produtos
      .filter((p) => !f.categoria || p.categoria === f.categoria)
      .map((p) => ({
        ...p,
        totalCusto: p.custo * Math.max(0, p.estoque),
        totalVenda: p.preco * Math.max(0, p.estoque),
        sit: p.estoque < 0 ? "Negativo" : p.estoque === 0 ? "Zerado" : p.estoque <= p.estoqueMin ? "Abaixo do mínimo" : "OK",
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [db.produtos, f.categoria]);

  // ---- chips
  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.periodo !== "todos")
    ativos.push({
      id: "p",
      rotulo: f.periodo === "personalizado" ? `${f.de ? fmtData(f.de) : "…"} a ${f.ate ? fmtData(f.ate) : "…"}` : ROTULO_PERIODO[f.periodo],
      remover: () => set("periodo", "ult30"),
    });
  f.formas.forEach((x) => ativos.push({ id: `f-${x}`, rotulo: rotuloForma(x), remover: () => toggle("formas", x) }));
  f.modelos.forEach((m) => ativos.push({ id: `m-${m}`, rotulo: m, remover: () => toggle("modelos", m) }));
  if (f.status !== "faturado" && aba !== "estoque")
    ativos.push({ id: "st", rotulo: f.status === "todos" ? "Todos os status" : "Só cancelados", remover: () => set("status", "faturado") });
  if (f.tipoDoc !== "todos")
    ativos.push({ id: "td", rotulo: f.tipoDoc === "fiscal" ? "Só notas fiscais" : "Só DAV", remover: () => set("tipoDoc", "todos") });
  if (f.clienteId)
    ativos.push({ id: "cl", rotulo: `Cliente: ${db.clientes.find((c) => c.id === f.clienteId)?.nome ?? "…"}`, remover: () => set("clienteId", "") });
  if (f.categoria) ativos.push({ id: "cat", rotulo: `Categoria: ${f.categoria}`, remover: () => set("categoria", "") });

  const periodoLabel =
    f.periodo === "personalizado"
      ? `${f.de ? fmtData(f.de) : "…"} a ${f.ate ? fmtData(f.ate) : "…"}`
      : ROTULO_PERIODO[f.periodo];

  function exportar() {
    if (aba === "vendas") {
      exportarCsv(
        "relatorio-vendas",
        ["Nº", "Data", "Cliente", "Tipo", "Status", "Pagamento", "Total", "Desconto", "Modelo", "Nº nota", "Chave"],
        topVendas.map((v) => [
          v.numero,
          fmtTs(v.data),
          v.clienteNome,
          v.tipo,
          v.status,
          v.pagamentos?.length ? v.pagamentos.map((p) => `${rotuloForma(p.forma)} ${p.valor}`).join(" + ") : rotuloForma(v.pagamento),
          v.total,
          v.desconto,
          v.fiscal?.modelo ?? "",
          v.fiscal?.numeroNota ?? "",
          v.fiscal?.chave ?? "",
        ]),
      );
    } else if (aba === "produtos") {
      exportarCsv(
        "relatorio-curva-abc",
        ["#", "Produto", "Categoria", "Classe", "Qtd", "Receita", "% acum.", "Estoque"],
        curvaData.map((p, i) => [i + 1, p.nome, p.categoria, p.classe, p.qtd, p.receita, p.acum.toFixed(1), p.estoque]),
      );
    } else if (aba === "clientes") {
      exportarCsv(
        "relatorio-clientes",
        ["#", "Cliente", "Compras", "Ticket médio", "Total"],
        topClientes.map((c, i) => [i + 1, c.nome, c.compras, c.ticket, c.total]),
      );
    } else if (aba === "financeiro") {
      exportarCsv(
        "relatorio-financeiro",
        ["Tipo", "Descrição", "Categoria", "Vencimento", "Valor", "Situação"],
        [
          ...receber.map((l) => ["Receber", l.descricao, l.categoria, l.vencimento, l.valor, l.vencimento < hojeStr ? "Vencido" : "A vencer"]),
          ...pagar.map((l) => ["Pagar", l.descricao, l.categoria, l.vencimento, l.valor, l.vencimento < hojeStr ? "Vencido" : "A vencer"]),
        ],
      );
    } else if (aba === "fiscal") {
      exportarCsv(
        "relatorio-fiscal",
        ["Nº venda", "Data", "Cliente", "Modelo", "Nº nota", "Série", "Chave", "Protocolo", "Status", "Total"],
        comNota.map((v) => [
          v.numero,
          fmtTs(v.data),
          v.clienteNome,
          v.fiscal?.modelo,
          v.fiscal?.numeroNota,
          v.fiscal?.serie,
          v.fiscal?.chave,
          v.fiscal?.protocolo,
          v.status,
          v.total,
        ]),
      );
    } else {
      exportarCsv(
        "relatorio-estoque",
        ["SKU", "Produto", "Categoria", "Saldo", "Mínimo", "Custo", "Total custo", "Preço", "Total venda", "Situação"],
        posicao.map((p) => [p.sku, p.nome, p.categoria, p.estoque, p.estoqueMin, p.custo, p.totalCusto, p.preco, p.totalVenda, p.sit]),
      );
    }
  }

  function imprimir() {
    setPreview(true);
    // aguarda o modal renderizar e imprime só a área do relatório
    setTimeout(() => window.print(), 300);
  }

  const cabecalhoImpressao = (
    <div className="mb-4 hidden border-b border-slate-300 pb-3 print:block">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-black text-slate-900">NKWAY</p>
          <p className="text-sm text-slate-600">{TITULO[aba]}</p>
          <p className="text-xs text-slate-500">Período: {periodoLabel}</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Emitido em {new Date().toLocaleString("pt-BR")}</p>
          <p>Relatório gerencial · demonstração</p>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #relatorio-print, #relatorio-print * { visibility: visible !important; }
          #relatorio-print {
            position: absolute !important;
            left: 0; top: 0; width: 100%;
            padding: 12mm;
            background: white;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <PageHeader
        title="Relatórios"
        subtitle="Filtros · pré-visualização · impressão · exportação — padrão de ERPs de varejo"
        action={
          <div className="no-print flex flex-wrap gap-2">
            <BotaoExportar onClick={exportar} total={1} />
            <button
              type="button"
              onClick={() => setPreview(true)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              👁 Pré-visualizar
            </button>
            <button
              type="button"
              onClick={imprimir}
              className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700"
            >
              🖨 Imprimir
            </button>
          </div>
        }
      />

      <div className="no-print mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {ABAS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============================ FILTROS ============================ */}
      <div className="no-print">
        <PainelFiltros>
          <LinhaFiltros>
            <SelectFiltro
              rotulo="Período"
              valor={f.periodo}
              padrao="ult30"
              onChange={(v) => set("periodo", v)}
              opcoes={PRESETS.map((p) => ({
                valor: p,
                rotulo: p === "personalizado" ? "Personalizado (de / até)…" : ROTULO_PERIODO[p],
              }))}
            />
            {f.periodo === "personalizado" && (
              <IntervaloFiltro rotulo="Datas">
                de <input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} className={inputFiltro} aria-label="Data de" />
                até <input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} className={inputFiltro} aria-label="Data até" />
              </IntervaloFiltro>
            )}

            {(aba === "vendas" || aba === "fiscal" || aba === "produtos" || aba === "clientes") && (
              <SelectFiltro
                rotulo="Status"
                valor={f.status}
                padrao="faturado"
                onChange={(v) => set("status", v)}
                opcoes={[
                  { valor: "faturado", rotulo: "Faturadas / autorizadas" },
                  { valor: "cancelado", rotulo: "Canceladas" },
                  { valor: "todos", rotulo: "Todos" },
                ]}
              />
            )}

            {(aba === "vendas" || aba === "fiscal") && (
              <SelectFiltro
                rotulo="Tipo de documento"
                valor={f.tipoDoc}
                padrao="todos"
                onChange={(v) => set("tipoDoc", v)}
                opcoes={[
                  { valor: "todos", rotulo: "Notas e DAV" },
                  { valor: "fiscal", rotulo: "Só notas fiscais" },
                  { valor: "dav", rotulo: "Só DAV" },
                ]}
              />
            )}

            {(aba === "vendas" || aba === "clientes") && (
              <SelectFiltro
                rotulo="Cliente"
                valor={f.clienteId}
                padrao=""
                largura="min-w-[200px]"
                onChange={(v) => set("clienteId", v)}
                opcoes={[{ valor: "", rotulo: "Todos" }, ...clientes.map((c) => ({ valor: c.id, rotulo: c.nome }))]}
              />
            )}

            {(aba === "produtos" || aba === "estoque") && (
              <SelectFiltro
                rotulo="Categoria"
                valor={f.categoria}
                padrao=""
                onChange={(v) => set("categoria", v)}
                opcoes={[{ valor: "", rotulo: "Todas" }, ...categorias.map((c) => ({ valor: c, rotulo: c }))]}
              />
            )}
          </LinhaFiltros>

          <button type="button" onClick={() => set("avancado", !f.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
            {f.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (pagamento, modelo fiscal)"}
          </button>

          {f.avancado && (
            <div className="rounded-lg bg-slate-50 p-3">
              <LinhaFiltros>
                {(aba === "vendas" || aba === "fiscal" || aba === "clientes" || aba === "produtos") && (
                  <MultiSelectFiltro
                    rotulo="Forma de pagamento"
                    opcoes={FORMAS.map((p) => ({ valor: p, rotulo: rotuloForma(p) }))}
                    selecionados={f.formas}
                    onToggle={(v) => toggle("formas", v)}
                    onLimpar={() => set("formas", [])}
                  />
                )}
                {(aba === "vendas" || aba === "fiscal") && (
                  <MultiSelectFiltro
                    rotulo="Modelo fiscal"
                    opcoes={(["NFC-e", "NF-e", "SAT"] as const).map((m) => ({ valor: m, rotulo: m }))}
                    selecionados={f.modelos}
                    onToggle={(v) => toggle("modelos", v)}
                    onLimpar={() => set("modelos", [])}
                  />
                )}
              </LinhaFiltros>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
            {ativos.length === 0 ? (
              <span className="text-xs text-slate-400">Filtro padrão: últimos 30 dias · faturadas</span>
            ) : (
              <>
                {ativos.map((a) => (
                  <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>
                ))}
                <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">
                  Limpar filtros
                </button>
              </>
            )}
          </div>
        </PainelFiltros>
      </div>

      {/* ============================ CONTEÚDO (também na impressão) ============================ */}
      <div id="relatorio-print" ref={printRef}>
        {cabecalhoImpressao}

        {/* VENDAS */}
        {aba === "vendas" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">Faturamento</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(fatTotal)}</p>
                <p className="text-[11px] text-slate-400">{faturadas.length} venda(s)</p>
              </Card>
              <Card className="border-l-4 border-l-sky-500 p-5">
                <p className="text-xs uppercase text-slate-500">Ticket médio</p>
                <p className="mt-1 text-2xl font-bold text-sky-700">{brl(ticket)}</p>
              </Card>
              <Card className="border-l-4 border-l-violet-500 p-5">
                <p className="text-xs uppercase text-slate-500">A prazo / boleto no período</p>
                <p className="mt-1 text-2xl font-bold text-violet-600">
                  {brl(faturadas.reduce((s, v) => s + valorAPrazo(v), 0))}
                </p>
              </Card>
              <Card className="border-l-4 border-l-amber-500 p-5">
                <p className="text-xs uppercase text-slate-500">Canceladas (filtro)</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{vendasBase.filter((v) => v.status === "cancelado").length}</p>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-bold text-slate-900">Por forma de pagamento</h3>
                <ul className="space-y-3">
                  {porPagamento.map((p) => (
                    <li key={p.nome}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="capitalize text-slate-600">{rotuloForma(p.nome)}</span>
                        <span className="font-bold text-slate-900">
                          {brl(p.total)} · {Math.round(pct(p.total, fatTotal))}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct(p.total, fatTotal)}%` }} />
                      </div>
                    </li>
                  ))}
                  {porPagamento.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Sem vendas no período.</p>}
                </ul>
              </Card>

              <Card className="p-5">
                <h3 className="mb-4 text-sm font-bold text-slate-900">Faturamento por dia</h3>
                {porDia.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">Sem dados.</p>
                ) : (
                  <div className="flex h-36 items-end gap-1">
                    {porDia.map((d) => {
                      const max = Math.max(1, ...porDia.map((x) => x.total));
                      return (
                        <div key={d.dia} className="flex flex-1 flex-col items-center gap-1" title={`${fmtData(d.dia)}: ${brl(d.total)}`}>
                          <div className="w-full rounded-t bg-emerald-500" style={{ height: `${(d.total / max) * 100}%`, minHeight: 3 }} />
                        </div>
                      );
                    })}
                  </div>
                )}
                {porDia.length > 0 && (
                  <div className="mt-2 flex justify-between text-[10px] text-slate-400">
                    <span>{fmtData(porDia[0].dia)}</span>
                    <span>{fmtData(porDia[porDia.length - 1].dia)}</span>
                  </div>
                )}
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                Vendas do período (até 50 maiores)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Nº</th>
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Cliente</th>
                      <th className="px-4 py-2">Pagamento</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topVendas.map((v) => (
                      <tr key={v.id}>
                        <td className="px-4 py-2 font-medium text-sky-700">#{v.numero}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtTs(v.data)}</td>
                        <td className="px-4 py-2 text-slate-700">{v.clienteNome}</td>
                        <td className="px-4 py-2 capitalize text-slate-600">
                          {v.pagamentos?.length
                            ? v.pagamentos.map((p) => rotuloForma(p.forma)).join(" + ")
                            : rotuloForma(v.pagamento)}
                        </td>
                        <td className="px-4 py-2 text-right font-bold">{brl(v.total)}</td>
                      </tr>
                    ))}
                    {topVendas.length === 0 && (
                      <tr><td colSpan={5} className="py-10 text-center text-slate-400">Nenhuma venda no filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* PRODUTOS ABC */}
        {aba === "produtos" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">Curva A (≈80% da receita)</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{curvaData.filter((c) => c.classe === "A").length} produtos</p>
              </Card>
              <Card className="border-l-4 border-l-amber-500 p-5">
                <p className="text-xs uppercase text-slate-500">Curva B</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{curvaData.filter((c) => c.classe === "B").length}</p>
              </Card>
              <Card className="border-l-4 border-l-rose-500 p-5">
                <p className="text-xs uppercase text-slate-500">Curva C</p>
                <p className="mt-1 text-2xl font-bold text-rose-600">{curvaData.filter((c) => c.classe === "C").length}</p>
              </Card>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3 text-center">Classe</th>
                      <th className="px-4 py-3 text-center">Qtd</th>
                      <th className="px-4 py-3 text-right">Receita</th>
                      <th className="px-4 py-3 text-right">% acum.</th>
                      <th className="px-4 py-3 text-center">Estoque</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {curvaData.slice(0, 50).map((p, k) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{k + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{p.nome}</td>
                        <td className="px-4 py-2.5 text-center">
                          <Badge tone={p.classe === "A" ? "green" : p.classe === "B" ? "amber" : "red"}>{p.classe}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-center text-slate-600">{p.qtd}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{brl(p.receita)}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">{p.acum.toFixed(1)}%</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", p.estoque < 1 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                            {p.estoque}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {curvaData.length === 0 && (
                      <tr><td colSpan={7} className="py-12 text-center text-slate-400">Sem vendas no período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* CLIENTES */}
        {aba === "clientes" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-l-4 border-l-sky-500 p-5">
                <p className="text-xs uppercase text-slate-500">Clientes que compraram</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{topClientes.length}</p>
              </Card>
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">Valor total</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(topClientes.reduce((s, c) => s + c.total, 0))}</p>
              </Card>
              <Card className="border-l-4 border-l-amber-500 p-5">
                <p className="text-xs uppercase text-slate-500">Ticket médio geral</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">{brl(ticket)}</p>
              </Card>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">#</th>
                      <th className="px-4 py-3">Cliente</th>
                      <th className="px-4 py-3 text-center">Compras</th>
                      <th className="px-4 py-3 text-right">Ticket</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {topClientes.slice(0, 40).map((c, k) => (
                      <tr key={k}>
                        <td className="px-4 py-2.5 text-xs text-slate-400">{k + 1}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{c.nome}</td>
                        <td className="px-4 py-2.5 text-center text-slate-600">{c.compras}</td>
                        <td className="px-4 py-2.5 text-right text-slate-600">{brl(c.ticket)}</td>
                        <td className="px-4 py-2.5 text-right font-bold">{brl(c.total)}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                          {Math.round(pct(c.total, topClientes.reduce((s, x) => s + x.total, 0)))}%
                        </td>
                      </tr>
                    ))}
                    {topClientes.length === 0 && (
                      <tr><td colSpan={6} className="py-12 text-center text-slate-400">Sem clientes no período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* FINANCEIRO */}
        {aba === "financeiro" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">A receber (aberto)</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(receber.reduce((s, l) => s + l.valor, 0))}</p>
              </Card>
              <Card className="border-l-4 border-l-rose-500 p-5">
                <p className="text-xs uppercase text-slate-500">A pagar (aberto)</p>
                <p className="mt-1 text-2xl font-bold text-rose-600">{brl(pagar.reduce((s, l) => s + l.valor, 0))}</p>
              </Card>
              <Card className="border-l-4 border-l-sky-500 p-5">
                <p className="text-xs uppercase text-slate-500">Saldo projetado</p>
                <p className="mt-1 text-2xl font-bold text-sky-700">
                  {brl(receber.reduce((s, l) => s + l.valor, 0) - pagar.reduce((s, l) => s + l.valor, 0))}
                </p>
              </Card>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-bold text-slate-900">A receber por faixa</h3>
                <ul className="space-y-3">
                  {porFaixa(receber).map((x) => (
                    <li key={x.label} className="flex items-center justify-between">
                      <span className={cn("text-[11px] font-bold uppercase", x.tone === "red" ? "text-rose-600" : x.tone === "amber" ? "text-amber-600" : x.tone === "sky" ? "text-sky-700" : "text-slate-500")}>
                        {x.label}
                      </span>
                      <span className="text-sm font-bold">{brl(x.valor)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-bold text-slate-900">A pagar por faixa</h3>
                <ul className="space-y-3">
                  {porFaixa(pagar).map((x) => (
                    <li key={x.label} className="flex items-center justify-between">
                      <span className={cn("text-[11px] font-bold uppercase", x.tone === "red" ? "text-rose-600" : x.tone === "amber" ? "text-amber-600" : x.tone === "sky" ? "text-sky-700" : "text-slate-500")}>
                        {x.label}
                      </span>
                      <span className="text-sm font-bold">{brl(x.valor)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Títulos em aberto (filtro por vencimento)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Tipo</th>
                      <th className="px-4 py-2">Descrição</th>
                      <th className="px-4 py-2">Vencimento</th>
                      <th className="px-4 py-2 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...receber.map((l) => ({ ...l, _t: "Receber" as const })), ...pagar.map((l) => ({ ...l, _t: "Pagar" as const }))]
                      .sort((a, b) => a.vencimento.localeCompare(b.vencimento))
                      .slice(0, 60)
                      .map((l) => (
                        <tr key={l.id}>
                          <td className="px-4 py-2">
                            <Badge tone={l._t === "Receber" ? "green" : "red"}>{l._t}</Badge>
                          </td>
                          <td className="px-4 py-2 text-slate-800">{l.descricao}</td>
                          <td className={cn("px-4 py-2 text-xs", l.vencimento < hojeStr ? "font-bold text-rose-600" : "text-slate-500")}>
                            {fmtData(l.vencimento)}
                          </td>
                          <td className="px-4 py-2 text-right font-bold">{brl(l.valor)}</td>
                        </tr>
                      ))}
                    {receber.length + pagar.length === 0 && (
                      <tr><td colSpan={4} className="py-10 text-center text-slate-400">Nenhum título no filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* FISCAL */}
        {aba === "fiscal" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-l-4 border-l-sky-500 p-5">
                <p className="text-xs uppercase text-slate-500">Notas no filtro</p>
                <p className="mt-1 text-2xl font-bold text-sky-700">{comNota.length}</p>
              </Card>
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">Valor</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(comNota.reduce((s, v) => s + v.total, 0))}</p>
              </Card>
              <Card className="border-l-4 border-l-rose-500 p-5">
                <p className="text-xs uppercase text-slate-500">Canceladas</p>
                <p className="mt-1 text-2xl font-bold text-rose-600">{canceladas}</p>
              </Card>
            </div>
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Por modelo fiscal</h3>
              <ul className="space-y-3">
                {porModelo.map((m) => (
                  <li key={m.modelo} className="flex items-center justify-between gap-3">
                    <span className="w-16 text-sm text-slate-700">{m.modelo}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-sky-500" style={{ width: `${pct(m.total, comNota.length || 1)}%` }} />
                    </div>
                    <span className="w-28 text-right text-sm font-bold">{m.total} · {brl(m.valor)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold">Documentos fiscais</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">Doc</th>
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Cliente</th>
                      <th className="px-4 py-2">Chave</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {comNota.slice(0, 50).map((v) => (
                      <tr key={v.id}>
                        <td className="px-4 py-2 font-medium text-sky-700">
                          {v.fiscal?.modelo} #{v.fiscal?.numeroNota ?? v.numero}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500">{fmtTs(v.data)}</td>
                        <td className="px-4 py-2 text-slate-700">{v.clienteNome}</td>
                        <td className="px-4 py-2 font-mono text-[10px] text-slate-500">…{v.fiscal?.chave.slice(-12)}</td>
                        <td className="px-4 py-2">
                          <Badge tone={v.status === "cancelado" ? "red" : "green"}>
                            {v.status === "cancelado" ? "Cancelada" : "Autorizada"}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 text-right font-bold">{brl(v.total)}</td>
                      </tr>
                    ))}
                    {comNota.length === 0 && (
                      <tr><td colSpan={6} className="py-10 text-center text-slate-400">Nenhuma nota no filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ESTOQUE */}
        {aba === "estoque" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="border-l-4 border-l-sky-500 p-5">
                <p className="text-xs uppercase text-slate-500">Itens</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{posicao.length}</p>
              </Card>
              <Card className="border-l-4 border-l-emerald-500 p-5">
                <p className="text-xs uppercase text-slate-500">Valor a custo</p>
                <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(posicao.reduce((s, p) => s + p.totalCusto, 0))}</p>
              </Card>
              <Card className="border-l-4 border-l-amber-500 p-5">
                <p className="text-xs uppercase text-slate-500">A repor / zerados</p>
                <p className="mt-1 text-2xl font-bold text-amber-600">
                  {posicao.filter((p) => p.sit !== "OK").length}
                </p>
              </Card>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-2">SKU</th>
                      <th className="px-4 py-2">Produto</th>
                      <th className="px-4 py-2 text-center">Saldo</th>
                      <th className="px-4 py-2 text-center">Mín.</th>
                      <th className="px-4 py-2 text-right">Custo</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {posicao.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-500">{p.sku}</td>
                        <td className="px-4 py-2 font-medium text-slate-800">{p.nome}</td>
                        <td className="px-4 py-2 text-center font-bold">{p.estoque}</td>
                        <td className="px-4 py-2 text-center text-slate-500">{p.estoqueMin}</td>
                        <td className="px-4 py-2 text-right text-slate-600">{brl(p.custo)}</td>
                        <td className="px-4 py-2 text-right font-bold">{brl(p.totalCusto)}</td>
                        <td className="px-4 py-2">
                          <Badge tone={p.sit === "OK" ? "green" : p.sit === "Abaixo do mínimo" ? "amber" : "red"}>{p.sit}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        <p className="mt-6 hidden text-center text-[10px] text-slate-400 print:block">
          NKWAY · relatório gerencial · {periodoLabel} · página impressa em {new Date().toLocaleString("pt-BR")}
        </p>
      </div>

      {/* Modal de pré-visualização */}
      {preview && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setPreview(false)}>
          <div
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h3 className="font-bold text-slate-900">Pré-visualização · {TITULO[aba]}</h3>
                <p className="text-xs text-slate-500">Período: {periodoLabel}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700"
                >
                  🖨 Imprimir
                </button>
                <button
                  type="button"
                  onClick={() => setPreview(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-6">
              <p className="mb-4 text-sm text-slate-600">
                Esta é a mesma visão que será impressa. Use <b>Imprimir</b> para abrir a caixa de diálogo do navegador
                (PDF, impressora ou Microsoft Print to PDF).
              </p>
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
                <p><b>{TITULO[aba]}</b></p>
                <p>Período: {periodoLabel}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {aba === "vendas" && `${faturadas.length} venda(s) · total ${brl(fatTotal)}`}
                  {aba === "produtos" && `${curvaData.length} produto(s) na curva ABC`}
                  {aba === "clientes" && `${topClientes.length} cliente(s)`}
                  {aba === "financeiro" && `${receber.length + pagar.length} título(s) em aberto`}
                  {aba === "fiscal" && `${comNota.length} documento(s) fiscal(is)`}
                  {aba === "estoque" && `${posicao.length} item(ns) de estoque`}
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  O conteúdo completo (gráficos e tabelas) está na página atrás deste modal e será enviado à impressora.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
