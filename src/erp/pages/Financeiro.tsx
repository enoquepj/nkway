import { Fragment, useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, valorAPrazo, type Lancamento } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import {
  ROTULO_PERIODO,
  casaTexto,
  dataLocal,
  dentroDoIntervalo,
  diasEntre,
  intervaloPeriodo,
  lerNumero,
  useFiltrosSalvos,
  type PresetPeriodo,
} from "../filtros";
import { BuscaGlobal, ChipAtivo, IntervaloFiltro, LinhaFiltros, MultiSelectFiltro, PainelFiltros, SelectFiltro, inputFiltro } from "../FiltroUI";
import { cn } from "../../utils/cn";

const vazio = () => ({
  descricao: "",
  valor: 0,
  tipo: "pagar" as Lancamento["tipo"],
  vencimento: dataLocal(),
  pago: false,
  categoria: "Geral",
});

type Situacao = "avencer" | "hoje" | "vencido" | "pago";
type Faixa = "avencer" | "1-30" | "31-60" | "61-90" | "90+";
type Agrupar = "nenhum" | "categoria" | "mes" | "situacao" | "tipo";

const SITUACOES: { valor: Situacao; rotulo: string; tom: "sky" | "amber" | "red" | "green" }[] = [
  { valor: "avencer", rotulo: "A vencer", tom: "sky" },
  { valor: "hoje", rotulo: "Vence hoje", tom: "amber" },
  { valor: "vencido", rotulo: "Vencido", tom: "red" },
  { valor: "pago", rotulo: "Pago / Recebido", tom: "green" },
];
const FAIXAS: { valor: Faixa; rotulo: string; tom: "sky" | "amber" | "red" }[] = [
  { valor: "avencer", rotulo: "A vencer", tom: "sky" },
  { valor: "1-30", rotulo: "1–30 dias", tom: "amber" },
  { valor: "31-60", rotulo: "31–60", tom: "amber" },
  { valor: "61-90", rotulo: "61–90", tom: "red" },
  { valor: "90+", rotulo: "+90 dias", tom: "red" },
];
const PRESETS: PresetPeriodo[] = ["todos", "hoje", "7dias", "30dias", "vencidos30", "mes", "mesAnterior", "personalizado"];
const ROTULO_AGRUPAR: Record<Agrupar, string> = {
  nenhum: "Sem agrupamento",
  categoria: "Categoria",
  mes: "Mês de vencimento",
  situacao: "Situação",
  tipo: "Receber / Pagar",
};

const FILTROS_PADRAO = {
  tipo: "todos" as "todos" | "receber" | "pagar",
  busca: "",
  situacoes: [] as Situacao[],
  periodo: "todos" as PresetPeriodo,
  de: "",
  ate: "",
  categorias: [] as string[],
  categoriaModo: "inclui" as "inclui" | "exclui",
  faixas: [] as Faixa[],
  valorDe: "",
  valorAte: "",
  agrupar: "nenhum" as Agrupar,
  avancado: false,
};

function situacaoDe(l: Lancamento, hoje: string): Situacao {
  if (l.pago) return "pago";
  if (l.vencimento < hoje) return "vencido";
  if (l.vencimento === hoje) return "hoje";
  return "avencer";
}

function faixaDe(l: Lancamento, hoje: string): Faixa | null {
  if (l.pago) return null;
  const atraso = diasEntre(l.vencimento, hoje);
  if (atraso <= 0) return "avencer";
  if (atraso <= 30) return "1-30";
  if (atraso <= 60) return "31-60";
  if (atraso <= 90) return "61-90";
  return "90+";
}

const fmtData = (iso: string) => (iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "");
const rotuloMes = (iso: string) => {
  const s = new Date(iso + "T12:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default function Financeiro() {
  const { db, addLancamento, toggleLancamento, delLancamento } = useStore();
  const [form, setForm] = useState(vazio);
  const [open, setOpen] = useState(false);
  const { f, set, toggle, limpar } = useFiltrosSalvos("financeiro", FILTROS_PADRAO);

  const hoje = dataLocal();
  const intervalo = intervaloPeriodo(f.periodo, f.de, f.ate);
  const vMin = lerNumero(f.valorDe);
  const vMax = lerNumero(f.valorAte);

  const categorias = useMemo(
    () => [...new Set(db.lancamentos.map((l) => l.categoria || "Geral"))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [db.lancamentos],
  );

  /** aplica todos os filtros, exceto os listados em `ignorar` (para as contagens dos chips) */
  const aplicar = (ignorar: ("situacao" | "faixa")[] = []) =>
    db.lancamentos.filter((l) => {
      if (f.tipo !== "todos" && l.tipo !== f.tipo) return false;
      if (!ignorar.includes("situacao") && f.situacoes.length && !f.situacoes.includes(situacaoDe(l, hoje))) return false;
      if (!ignorar.includes("faixa") && f.faixas.length) {
        const fx = faixaDe(l, hoje);
        if (!fx || !f.faixas.includes(fx)) return false;
      }
      if (!dentroDoIntervalo(l.vencimento, intervalo)) return false;
      if (f.categorias.length) {
        const tem = f.categorias.includes(l.categoria || "Geral");
        if (f.categoriaModo === "inclui" ? !tem : tem) return false;
      }
      if (Number.isFinite(vMin) && l.valor < vMin) return false;
      if (Number.isFinite(vMax) && l.valor > vMax) return false;
      return casaTexto(f.busca, [l.descricao, l.categoria, l.valor, fmtData(l.vencimento), l.tipo === "receber" ? "receber" : "pagar"]);
    });

  const lista = aplicar().sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const contSituacao = useMemo(() => {
    const c: Partial<Record<Situacao, number>> = {};
    aplicar(["situacao"]).forEach((l) => { const s = situacaoDe(l, hoje); c[s] = (c[s] ?? 0) + 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.lancamentos, f, hoje]);
  const contFaixa = useMemo(() => {
    const c: Partial<Record<Faixa, number>> = {};
    aplicar(["faixa"]).forEach((l) => { const x = faixaDe(l, hoje); if (x) c[x] = (c[x] ?? 0) + 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.lancamentos, f, hoje]);

  // ---- totais gerais (cards) e do resultado filtrado
  const receber = db.lancamentos.filter((l) => l.tipo === "receber" && !l.pago).reduce((s, l) => s + l.valor, 0);
  const pagar = db.lancamentos.filter((l) => l.tipo === "pagar" && !l.pago).reduce((s, l) => s + l.valor, 0);
  const caixa = db.vendas.filter((v) => v.status === "faturado").reduce((s, v) => s + (v.total - valorAPrazo(v)), 0);
  const somaF = (tipo: Lancamento["tipo"], pago?: boolean) =>
    lista.filter((l) => l.tipo === tipo && (pago == null || l.pago === pago)).reduce((s, l) => s + l.valor, 0);
  const fRecAberto = somaF("receber", false);
  const fPagAberto = somaF("pagar", false);
  const fRealizado = somaF("receber", true) - somaF("pagar", true);

  // ---- agrupamento
  const grupos = useMemo(() => {
    if (f.agrupar === "nenhum") return [{ chave: "", rotulo: "", itens: lista }];
    const mapa = new Map<string, { rotulo: string; itens: Lancamento[] }>();
    for (const l of lista) {
      let chave: string, rotulo: string;
      if (f.agrupar === "categoria") { chave = l.categoria || "Geral"; rotulo = chave; }
      else if (f.agrupar === "mes") { chave = l.vencimento.slice(0, 7); rotulo = rotuloMes(l.vencimento); }
      else if (f.agrupar === "tipo") { chave = l.tipo; rotulo = l.tipo === "receber" ? "↓ A receber" : "↑ A pagar"; }
      else { const s = situacaoDe(l, hoje); chave = String(SITUACOES.findIndex((x) => x.valor === s)); rotulo = SITUACOES.find((x) => x.valor === s)!.rotulo; }
      if (!mapa.has(chave)) mapa.set(chave, { rotulo, itens: [] });
      mapa.get(chave)!.itens.push(l);
    }
    return [...mapa.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([chave, g]) => ({ chave, ...g }));
  }, [lista, f.agrupar, hoje]);

  // ---- chips de filtros ativos
  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.tipo !== "todos") ativos.push({ id: "tipo", rotulo: f.tipo === "receber" ? "A receber" : "A pagar", remover: () => set("tipo", "todos") });
  if (f.busca.trim()) ativos.push({ id: "busca", rotulo: `Busca: “${f.busca.trim()}”`, remover: () => set("busca", "") });
  f.situacoes.forEach((s) => ativos.push({ id: `s-${s}`, rotulo: SITUACOES.find((x) => x.valor === s)!.rotulo, remover: () => set("situacoes", f.situacoes.filter((x) => x !== s)) }));
  if (f.periodo !== "todos")
    ativos.push({
      id: "periodo",
      rotulo: f.periodo === "personalizado"
        ? `Vencimento ${f.de ? fmtData(f.de) : "…"} a ${f.ate ? fmtData(f.ate) : "…"}`
        : `Vencimento: ${ROTULO_PERIODO[f.periodo]}`,
      remover: () => set("periodo", "todos"),
    });
  f.categorias.forEach((c) => ativos.push({ id: `c-${c}`, rotulo: `${f.categoriaModo === "exclui" ? "Exceto " : ""}${c}`, remover: () => set("categorias", f.categorias.filter((x) => x !== c)) }));
  f.faixas.forEach((x) => ativos.push({ id: `f-${x}`, rotulo: `Atraso: ${FAIXAS.find((y) => y.valor === x)!.rotulo}`, remover: () => set("faixas", f.faixas.filter((y) => y !== x)) }));
  if (Number.isFinite(vMin)) ativos.push({ id: "vmin", rotulo: `Valor ≥ ${brl(vMin)}`, remover: () => set("valorDe", "") });
  if (Number.isFinite(vMax)) ativos.push({ id: "vmax", rotulo: `Valor ≤ ${brl(vMax)}`, remover: () => set("valorAte", "") });

  function atalhoCobranca() {
    limpar();
    set("situacoes", ["vencido", "hoje"]);
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descricao.trim()) return;
    addLancamento(form);
    setForm(vazio());
    setOpen(false);
  }

  return (
    <div>
      <PageHeader
        title="Financeiro"
        subtitle="Contas a pagar, a receber e fluxo de caixa"
        action={<Button onClick={() => setOpen(true)}>+ Novo lançamento</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-emerald-500 p-5">
          <p className="text-xs font-medium uppercase text-slate-500">A receber</p>
          <p className="mt-1 text-2xl font-bold text-emerald-600">{brl(receber)}</p>
        </Card>
        <Card className="border-l-4 border-l-rose-500 p-5">
          <p className="text-xs font-medium uppercase text-slate-500">A pagar</p>
          <p className="mt-1 text-2xl font-bold text-rose-600">{brl(pagar)}</p>
        </Card>
        <Card className="border-l-4 border-l-sky-500 p-5">
          <p className="text-xs font-medium uppercase text-slate-500">Entradas no caixa (vendas)</p>
          <p className="mt-1 text-2xl font-bold text-sky-700">{brl(caixa)}</p>
        </Card>
      </div>

      {/* ============================ FILTROS ============================ */}
      <PainelFiltros>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {(["todos", "receber", "pagar"] as const).map((a) => (
              <button
                key={a}
                onClick={() => set("tipo", a)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition",
                  f.tipo === a ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
                )}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="min-w-[240px] flex-1">
            <BuscaGlobal value={f.busca} onChange={(v) => set("busca", v)} placeholder="Buscar descrição, categoria, nº da venda, valor (ex.: 150,00)…" />
          </div>
          <button onClick={atalhoCobranca} className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100" title="Vencidos OU vencendo hoje">
            ⚡ Cobrança do dia
          </button>
        </div>

        <LinhaFiltros>
          <SelectFiltro
            rotulo="Vencimento"
            valor={f.periodo}
            padrao="todos"
            onChange={(v) => set("periodo", v)}
            opcoes={PRESETS.map((p) => ({ valor: p, rotulo: p === "personalizado" ? "Personalizado (de / até)…" : ROTULO_PERIODO[p] }))}
          />
          {f.periodo === "personalizado" && (
            <IntervaloFiltro rotulo="Datas de vencimento">
              de <input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} className={inputFiltro} aria-label="Vencimento de" />
              até <input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} className={inputFiltro} aria-label="Vencimento até" />
            </IntervaloFiltro>
          )}
          <MultiSelectFiltro
            rotulo="Situação"
            opcoes={SITUACOES}
            selecionados={f.situacoes}
            contagem={contSituacao}
            onToggle={(v) => toggle("situacoes", v)}
            onLimpar={() => set("situacoes", [])}
          />
          {categorias.length > 0 && (
            <MultiSelectFiltro
              rotulo={f.categorias.length && f.categoriaModo === "exclui" ? "Categoria (exceto)" : "Categoria"}
              opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))}
              selecionados={f.categorias}
              onToggle={(v) => toggle("categorias", v)}
              onLimpar={() => set("categorias", [])}
              extra={
                <label className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  Marcadas:
                  <select value={f.categoriaModo} onChange={(e) => set("categoriaModo", e.target.value as "inclui" | "exclui")}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold" aria-label="Modo da categoria">
                    <option value="inclui">mostrar só elas (é)</option>
                    <option value="exclui">esconder (não é)</option>
                  </select>
                </label>
              }
            />
          )}
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !f.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {f.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (faixa de atraso, valor, agrupamento)"}
        </button>

        {f.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              <MultiSelectFiltro
                rotulo="Faixa de atraso"
                opcoes={FAIXAS}
                selecionados={f.faixas}
                contagem={contFaixa}
                onToggle={(v) => toggle("faixas", v)}
                onLimpar={() => set("faixas", [])}
              />
              <IntervaloFiltro rotulo="Valor (R$)">
                de <input inputMode="decimal" value={f.valorDe} onChange={(e) => set("valorDe", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={cn(inputFiltro, "w-28 text-right")} aria-label="Valor de" />
                até <input inputMode="decimal" value={f.valorAte} onChange={(e) => set("valorAte", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="sem limite" className={cn(inputFiltro, "w-28 text-right")} aria-label="Valor até" />
              </IntervaloFiltro>
              <SelectFiltro
                rotulo="Agrupar por"
                valor={f.agrupar}
                padrao="nenhum"
                onChange={(v) => set("agrupar", v)}
                opcoes={(Object.keys(ROTULO_AGRUPAR) as Agrupar[]).map((a) => ({ valor: a, rotulo: ROTULO_AGRUPAR[a] }))}
              />
            </LinhaFiltros>
          </div>
        )}

        {/* filtros ativos + resumo do resultado */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? (
            <span className="text-xs text-slate-400">Nenhum filtro ativo</span>
          ) : (
            <>
              {ativos.map((a) => <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>)}
              <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">Limpar filtros</button>
            </>
          )}
        </div>
      </PainelFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span><b className="text-slate-900">{lista.length}</b> de {db.lancamentos.length} lançamento(s)</span>
        <span>Em aberto a receber: <b className="text-emerald-600">{brl(fRecAberto)}</b></span>
        <span>Em aberto a pagar: <b className="text-rose-600">{brl(fPagAberto)}</b></span>
        <span>Saldo previsto: <b className={fRecAberto - fPagAberto >= 0 ? "text-emerald-700" : "text-rose-700"}>{brl(fRecAberto - fPagAberto)}</b></span>
        <span>Realizado: <b className="text-slate-900">{brl(fRealizado)}</b></span>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Situação</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grupos.map((g) => {
              const rec = g.itens.filter((l) => l.tipo === "receber").reduce((s, l) => s + l.valor, 0);
              const pag = g.itens.filter((l) => l.tipo === "pagar").reduce((s, l) => s + l.valor, 0);
              return (
                <Fragment key={g.chave || "todos"}>
                  {f.agrupar !== "nenhum" && (
                    <tr className="bg-slate-100/80">
                      <td colSpan={4} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                        {g.rotulo} <span className="ml-1 font-medium normal-case text-slate-500">· {g.itens.length} lançamento(s)</span>
                      </td>
                      <td colSpan={2} className="px-4 py-2 text-right text-xs font-semibold">
                        {rec > 0 && <span className="text-emerald-700">↓ {brl(rec)}</span>}
                        {rec > 0 && pag > 0 && <span className="mx-1 text-slate-400">·</span>}
                        {pag > 0 && <span className="text-rose-700">↑ {brl(pag)}</span>}
                      </td>
                    </tr>
                  )}
                  {g.itens.map((l) => {
                    const sit = situacaoDe(l, hoje);
                    const atraso = sit === "vencido" ? diasEntre(l.vencimento, hoje) : 0;
                    return (
                      <tr key={l.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <span className={`mr-2 ${l.tipo === "receber" ? "text-emerald-500" : "text-rose-500"}`}>
                            {l.tipo === "receber" ? "↓" : "↑"}
                          </span>
                          <span className="font-medium text-slate-800">{l.descricao}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{l.categoria}</td>
                        <td className="px-4 py-3 text-slate-600">{fmtData(l.vencimento)}</td>
                        <td className="px-4 py-3">
                          {sit === "pago" ? (
                            <Badge tone="green">{l.tipo === "receber" ? "Recebido" : "Pago"}</Badge>
                          ) : sit === "vencido" ? (
                            <Badge tone="red">Atrasado · {atraso}d</Badge>
                          ) : sit === "hoje" ? (
                            <Badge tone="amber">Vence hoje</Badge>
                          ) : (
                            <Badge tone="sky">A vencer</Badge>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${l.tipo === "receber" ? "text-emerald-600" : "text-rose-600"}`}>
                          {brl(l.valor)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button onClick={() => toggleLancamento(l.id)} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">
                            {l.pago ? "Reabrir" : "Baixar"}
                          </button>
                          <button onClick={() => delLancamento(l.id)} className="text-xs font-semibold text-rose-500 hover:underline">
                            Excluir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
            {lista.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">
                  {db.lancamentos.length === 0 ? "Nenhum lançamento." : (
                    <>Nenhum lançamento com esses filtros. <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button></>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">Novo lançamento</h3>
            <div className="grid gap-3">
              <Field label="Descrição" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor" type="number" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })} />
                <Field label="Vencimento" type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} />
              </div>
              <Field label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} list="fin-categorias" />
              <datalist id="fin-categorias">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
              <div className="flex gap-2">
                {(["pagar", "receber"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm({ ...form, tipo: t })}
                    className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${
                      form.tipo === t ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    Conta a {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
