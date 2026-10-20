import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, type Produto } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import Barcode from "../Barcode";
import { UNIDADES, gerarGtin, validarGtin } from "../types";
import { usePlan } from "../plan";
import { casaTexto, lerNumero, useFiltrosSalvos } from "../filtros";
import { BuscaGlobal, ChipAtivo, IntervaloFiltro, LinhaFiltros, MultiSelectFiltro, PainelFiltros, SelectFiltro, inputFiltro } from "../FiltroUI";
import { BotaoExportar, Paginacao, ThOrd, exportarCsv, useOrdenacao, usePaginacao } from "../Tabela";
import { cn } from "../../utils/cn";

const vazio = {
  nome: "",
  sku: "",
  categoria: "",
  custo: 0,
  preco: 0,
  estoque: 0,
  estoqueMin: 0,
  gtin: "",
  unidade: "UN",
  marca: "",
  impostos: {
    ncm: "",
    cest: "",
    cfop: "5102",
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

type SitEstoque = "ok" | "baixo" | "zerado" | "negativo";
type Extra = "semGtin" | "gtinInvalido" | "semNcm" | "margemNegativa" | "custoZero";
type Col = "sku" | "nome" | "categoria" | "custo" | "preco" | "margem" | "estoque";

const SIT_ESTOQUE: { valor: SitEstoque; rotulo: string }[] = [
  { valor: "ok", rotulo: "Estoque OK" },
  { valor: "baixo", rotulo: "Abaixo do mínimo" },
  { valor: "zerado", rotulo: "Zerado" },
  { valor: "negativo", rotulo: "Negativo" },
];
const EXTRAS: { valor: Extra; rotulo: string }[] = [
  { valor: "semGtin", rotulo: "Sem código de barras" },
  { valor: "gtinInvalido", rotulo: "Código de barras inválido" },
  { valor: "semNcm", rotulo: "Sem NCM / CFOP" },
  { valor: "margemNegativa", rotulo: "Margem negativa" },
  { valor: "custoZero", rotulo: "Custo zerado" },
];

const FILTROS_PADRAO = {
  busca: "",
  categorias: [] as string[],
  marcas: [] as string[],
  estoque: [] as SitEstoque[],
  unidades: [] as string[],
  fiscal: "todos" as "todos" | "ok" | "incompleto",
  tipo: "todos" as "todos" | "unitario" | "pesavel",
  extras: [] as Extra[],
  precoDe: "",
  precoAte: "",
  margemDe: "",
  margemAte: "",
  estoqueDe: "",
  estoqueAte: "",
  avancado: false,
};

const sitEstoque = (p: Produto): SitEstoque =>
  p.estoque < 0 ? "negativo" : p.estoque === 0 ? "zerado" : p.estoque <= p.estoqueMin ? "baixo" : "ok";
const fiscalOkDe = (p: Produto) => !!p.impostos?.ncm && !!p.impostos?.cfop && (p.gtin === "" || validarGtin(p.gtin));
const margemDe = (p: Produto) => (p.preco > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : 0);
const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

export default function Produtos() {
  const { db, addProduto, updProduto, delProduto } = useStore();
  const [form, setForm] = useState<typeof vazio & { id?: string }>(vazio);
  const [open, setOpen] = useState(false);
  const [bloqueio, setBloqueio] = useState(false);
  const [etiqueta, setEtiqueta] = useState<Produto | null>(null);
  const { plano, dentroDoLimite } = usePlan();
  const { f, set, toggle, limpar } = useFiltrosSalvos("produtos", FILTROS_PADRAO);

  const categorias = useMemo(() => unicos(db.produtos.map((p) => p.categoria)), [db.produtos]);
  const marcas = useMemo(() => unicos(db.produtos.map((p) => p.marca)), [db.produtos]);
  const unidades = useMemo(() => unicos(db.produtos.map((p) => p.unidade || "UN")), [db.produtos]);

  const pMin = lerNumero(f.precoDe), pMax = lerNumero(f.precoAte);
  const mMin = lerNumero(f.margemDe), mMax = lerNumero(f.margemAte);
  const eMin = lerNumero(f.estoqueDe), eMax = lerNumero(f.estoqueAte);

  const aplicar = (ignorarEstoque = false) =>
    db.produtos.filter((p) => {
      if (f.categorias.length && !f.categorias.includes(p.categoria)) return false;
      if (f.marcas.length && !f.marcas.includes(p.marca)) return false;
      if (!ignorarEstoque && f.estoque.length && !f.estoque.includes(sitEstoque(p))) return false;
      if (f.unidades.length && !f.unidades.includes(p.unidade || "UN")) return false;
      if (f.fiscal !== "todos" && (f.fiscal === "ok") !== fiscalOkDe(p)) return false;
      if (f.tipo !== "todos" && (f.tipo === "pesavel") !== !!p.pesavel) return false;
      for (const x of f.extras) {
        if (x === "semGtin" && p.gtin && p.gtin !== "SEM GTIN") return false;
        if (x === "gtinInvalido" && (!p.gtin || p.gtin === "SEM GTIN" || validarGtin(p.gtin))) return false;
        if (x === "semNcm" && p.impostos?.ncm && p.impostos?.cfop) return false;
        if (x === "margemNegativa" && !(p.preco < p.custo)) return false;
        if (x === "custoZero" && p.custo > 0) return false;
      }
      if (Number.isFinite(pMin) && p.preco < pMin) return false;
      if (Number.isFinite(pMax) && p.preco > pMax) return false;
      if (Number.isFinite(mMin) && margemDe(p) < mMin) return false;
      if (Number.isFinite(mMax) && margemDe(p) > mMax) return false;
      if (Number.isFinite(eMin) && p.estoque < eMin) return false;
      if (Number.isFinite(eMax) && p.estoque > eMax) return false;
      return casaTexto(f.busca, [p.nome, p.sku, p.gtin, p.codBalanca, p.marca, p.categoria, p.impostos?.ncm, p.impostos?.cest, p.preco]);
    });

  const filtrados = aplicar();
  const contEstoque = useMemo(() => {
    const c: Partial<Record<SitEstoque, number>> = {};
    aplicar(true).forEach((p) => { const s = sitEstoque(p); c[s] = (c[s] ?? 0) + 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.produtos, f]);

  const ord = useOrdenacao<Produto, Col>(filtrados, {
    sku: (p) => p.sku,
    nome: (p) => p.nome,
    categoria: (p) => p.categoria,
    custo: (p) => p.custo,
    preco: (p) => p.preco,
    margem: (p) => margemDe(p),
    estoque: (p) => p.estoque,
  }, { col: "nome", dir: "asc" });
  const pag = usePaginacao(ord.ordenada, "produtos");

  const valorCusto = filtrados.reduce((s, p) => s + Math.max(0, p.estoque) * p.custo, 0);
  const valorVenda = filtrados.reduce((s, p) => s + Math.max(0, p.estoque) * p.preco, 0);
  const abaixoMin = filtrados.filter((p) => sitEstoque(p) !== "ok").length;

  // ---- chips de filtros ativos
  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.busca.trim()) ativos.push({ id: "b", rotulo: `Busca: “${f.busca.trim()}”`, remover: () => set("busca", "") });
  f.categorias.forEach((c) => ativos.push({ id: `c-${c}`, rotulo: `Categoria: ${c}`, remover: () => toggle("categorias", c) }));
  f.marcas.forEach((m) => ativos.push({ id: `m-${m}`, rotulo: `Marca: ${m}`, remover: () => toggle("marcas", m) }));
  f.estoque.forEach((e) => ativos.push({ id: `e-${e}`, rotulo: SIT_ESTOQUE.find((x) => x.valor === e)!.rotulo, remover: () => toggle("estoque", e) }));
  f.unidades.forEach((u) => ativos.push({ id: `u-${u}`, rotulo: `Unidade: ${u}`, remover: () => toggle("unidades", u) }));
  if (f.fiscal !== "todos") ativos.push({ id: "fi", rotulo: f.fiscal === "ok" ? "Fiscal OK" : "Fiscal incompleto", remover: () => set("fiscal", "todos") });
  if (f.tipo !== "todos") ativos.push({ id: "ti", rotulo: f.tipo === "pesavel" ? "Pesável (balança)" : "Unitário", remover: () => set("tipo", "todos") });
  f.extras.forEach((x) => ativos.push({ id: `x-${x}`, rotulo: EXTRAS.find((e) => e.valor === x)!.rotulo, remover: () => toggle("extras", x) }));
  if (Number.isFinite(pMin) || Number.isFinite(pMax)) ativos.push({ id: "pr", rotulo: `Preço ${Number.isFinite(pMin) ? brl(pMin) : "…"} a ${Number.isFinite(pMax) ? brl(pMax) : "…"}`, remover: () => { set("precoDe", ""); set("precoAte", ""); } });
  if (Number.isFinite(mMin) || Number.isFinite(mMax)) ativos.push({ id: "mg", rotulo: `Margem ${Number.isFinite(mMin) ? mMin : "…"}% a ${Number.isFinite(mMax) ? mMax : "…"}%`, remover: () => { set("margemDe", ""); set("margemAte", ""); } });
  if (Number.isFinite(eMin) || Number.isFinite(eMax)) ativos.push({ id: "es", rotulo: `Estoque ${Number.isFinite(eMin) ? eMin : "…"} a ${Number.isFinite(eMax) ? eMax : "…"}`, remover: () => { set("estoqueDe", ""); set("estoqueAte", ""); } });

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return;
    if (form.id) updProduto(form as Produto);
    else {
      if (!dentroDoLimite("produtos", db.produtos.length)) {
        setBloqueio(true);
        setOpen(false);
        return;
      }
      addProduto(form);
    }
    setForm(vazio);
    setOpen(false);
  }

  function excluir(p: Produto) {
    if (confirm(`Excluir o produto "${p.nome}"?`)) delProduto(p.id);
  }

  function exportar() {
    exportarCsv("produtos",
      ["Código (SKU)", "Produto", "Categoria", "Marca", "Unidade", "Código de barras", "NCM", "CFOP", "Custo", "Preço", "Margem %", "Estoque", "Estoque mínimo", "Situação", "Fiscal"],
      ord.ordenada.map((p) => [p.sku, p.nome, p.categoria, p.marca, p.unidade, p.gtin, p.impostos?.ncm, p.impostos?.cfop, p.custo, p.preco, margemDe(p), p.estoque, p.estoqueMin,
        SIT_ESTOQUE.find((x) => x.valor === sitEstoque(p))!.rotulo, fiscalOkDe(p) ? "OK" : "Incompleto"]));
  }

  const num = (v: string) => v.replace(/[^\d.,-]/g, "");
  const th = { atual: ord.col, dir: ord.dir, onOrdenar: ord.ordenar };

  return (
    <div>
      <PageHeader
        title="Produtos"
        subtitle={`${db.produtos.length} itens cadastrados`}
        action={
          <div className="flex gap-2">
            <BotaoExportar onClick={exportar} total={filtrados.length} />
            <Button onClick={() => { setForm(vazio); setOpen(true); }}>+ Novo produto</Button>
          </div>
        }
      />

      <PainelFiltros>
        <BuscaGlobal value={f.busca} onChange={(v) => set("busca", v)}
          placeholder="Buscar por nome, código (SKU), código de barras, marca, categoria, NCM…" />
        <LinhaFiltros>
          <MultiSelectFiltro rotulo="Categoria" opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))} selecionados={f.categorias}
            onToggle={(v) => toggle("categorias", v)} onLimpar={() => set("categorias", [])} />
          <MultiSelectFiltro rotulo="Marca" opcoes={marcas.map((m) => ({ valor: m, rotulo: m }))} selecionados={f.marcas}
            onToggle={(v) => toggle("marcas", v)} onLimpar={() => set("marcas", [])} />
          <MultiSelectFiltro rotulo="Estoque" opcoes={SIT_ESTOQUE} selecionados={f.estoque} contagem={contEstoque}
            onToggle={(v) => toggle("estoque", v)} onLimpar={() => set("estoque", [])} />
          <SelectFiltro rotulo="Situação fiscal" valor={f.fiscal} padrao="todos" onChange={(v) => set("fiscal", v)}
            opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "ok", rotulo: "OK para NF-e" }, { valor: "incompleto", rotulo: "Dados incompletos" }]} />
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !f.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {f.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (unidade, tipo, preço, margem, estoque, exceções)"}
        </button>
        {f.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              <MultiSelectFiltro rotulo="Unidade" opcoes={unidades.map((u) => ({ valor: u, rotulo: u }))} selecionados={f.unidades}
                onToggle={(v) => toggle("unidades", v)} onLimpar={() => set("unidades", [])} largura="min-w-[120px]" />
              <SelectFiltro rotulo="Tipo" valor={f.tipo} padrao="todos" onChange={(v) => set("tipo", v)} largura="min-w-[150px]"
                opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "unitario", rotulo: "Unitário" }, { valor: "pesavel", rotulo: "Pesável (balança)" }]} />
              <MultiSelectFiltro rotulo="Exceções" opcoes={EXTRAS} selecionados={f.extras}
                onToggle={(v) => toggle("extras", v)} onLimpar={() => set("extras", [])} />
              <IntervaloFiltro rotulo="Preço de venda (R$)">
                de <input inputMode="decimal" value={f.precoDe} onChange={(e) => set("precoDe", num(e.target.value))} placeholder="0,00" className={cn(inputFiltro, "w-24 text-right")} aria-label="Preço de" />
                até <input inputMode="decimal" value={f.precoAte} onChange={(e) => set("precoAte", num(e.target.value))} placeholder="sem limite" className={cn(inputFiltro, "w-24 text-right")} aria-label="Preço até" />
              </IntervaloFiltro>
              <IntervaloFiltro rotulo="Margem (%)">
                de <input inputMode="decimal" value={f.margemDe} onChange={(e) => set("margemDe", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Margem de" />
                até <input inputMode="decimal" value={f.margemAte} onChange={(e) => set("margemAte", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Margem até" />
              </IntervaloFiltro>
              <IntervaloFiltro rotulo="Estoque (qtd.)">
                de <input inputMode="decimal" value={f.estoqueDe} onChange={(e) => set("estoqueDe", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Estoque de" />
                até <input inputMode="decimal" value={f.estoqueAte} onChange={(e) => set("estoqueAte", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Estoque até" />
              </IntervaloFiltro>
            </LinhaFiltros>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? <span className="text-xs text-slate-400">Nenhum filtro ativo</span> : (
            <>
              {ativos.map((a) => <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>)}
              <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">Limpar filtros</button>
            </>
          )}
        </div>
      </PainelFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span><b className="text-slate-900">{filtrados.length}</b> de {db.produtos.length} produto(s)</span>
        <span>Estoque a custo: <b className="text-slate-900">{brl(valorCusto)}</b></span>
        <span>Estoque a preço de venda: <b className="text-emerald-700">{brl(valorVenda)}</b></span>
        {abaixoMin > 0 && <span>Precisam de reposição: <b className="text-amber-700">{abaixoMin}</b></span>}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <ThOrd col="sku" {...th}>Código</ThOrd>
                <ThOrd col="nome" {...th}>Produto</ThOrd>
                <ThOrd col="categoria" {...th}>Categoria</ThOrd>
                <ThOrd col="custo" {...th} alinhar="right">Custo</ThOrd>
                <ThOrd col="preco" {...th} alinhar="right">Venda</ThOrd>
                <ThOrd col="margem" {...th} alinhar="right">Margem</ThOrd>
                <ThOrd col="estoque" {...th} alinhar="center">Estoque</ThOrd>
                <th className="px-4 py-3 uppercase tracking-wide">Fiscal</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pag.itens.map((p) => {
                const fiscalOk = fiscalOkDe(p);
                const sit = sitEstoque(p);
                const mg = margemDe(p);
                return (
                <tr key={p.id} className="hover:bg-slate-50/70" onDoubleClick={() => { setForm(p); setOpen(true); }}>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.sku}</td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => { setForm(p); setOpen(true); }} className="text-left font-medium text-slate-800 hover:text-sky-700 hover:underline">
                      {p.nome}
                    </button>
                    <p className="text-xs text-slate-400">
                      {p.marca || "s/ marca"} · {p.unidade || "UN"}{p.pesavel ? " · ⚖ pesável" : ""}
                    </p>
                    {p.gtin && <p className="font-mono text-[10px] text-slate-400">{p.gtin}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.categoria}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{brl(p.custo)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{brl(p.preco)}</td>
                  <td className={cn("px-4 py-3 text-right", mg < 0 ? "font-bold text-rose-600" : "text-emerald-600")}>{mg}%</td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={sit === "ok" ? "green" : sit === "baixo" ? "amber" : "red"}>
                      {p.estoque} {(p.unidade || "un").toLowerCase()}
                    </Badge>
                    {sit !== "ok" && <p className="mt-0.5 text-[10px] text-slate-400">mín. {p.estoqueMin}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge tone={fiscalOk ? "green" : "red"}>
                        {fiscalOk ? "OK p/ NF-e" : "Dados fiscais incompletos"}
                      </Badge>
                      <button onClick={() => setEtiqueta(p)} className="text-left text-[10px] font-semibold text-sky-600 hover:underline">
                        🏷️ Etiqueta
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button onClick={() => { setForm(p); setOpen(true); }} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => excluir(p)} className="text-xs font-semibold text-rose-500 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">
                  {db.produtos.length === 0 ? "Nenhum produto cadastrado." : (
                    <>Nenhum produto com esses filtros. <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button></>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao {...pag} />
      </Card>

      {bloqueio && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setBloqueio(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">⭐</div>
            <h3 className="text-lg font-bold text-slate-900">Limite do plano atingido</h3>
            <p className="mt-2 text-sm text-slate-500">
              O plano <b>{plano.nome}</b> permite até {plano.limites.produtos} produtos.
              Faça upgrade para cadastrar itens ilimitados e emitir notas fiscais.
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setBloqueio(false)}>
                Agora não
              </Button>
              <Button className="flex-1" onClick={() => setBloqueio(false)}>
                Ver planos ⭐
              </Button>
            </div>
          </div>
        </div>
      )}

      {etiqueta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEtiqueta(null)}>
          <div className="w-full max-w-xs rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-center text-sm font-bold text-slate-900">Etiqueta — gôndola</h3>
            <div className="rounded-lg border-2 border-dashed border-slate-300 p-4 text-center">
              <p className="text-xs font-medium text-slate-500">{etiqueta.nome}</p>
              <p className="text-[10px] text-slate-400">{etiqueta.sku} · {etiqueta.unidade}</p>
              <div className="mt-3 bg-white p-2">
                <Barcode valor={etiqueta.gtin} />
              </div>
              <p className="mt-3 text-2xl font-black text-slate-900">{brl(etiqueta.preco)}</p>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setEtiqueta(null)}>Fechar</Button>
              <Button className="flex-1" onClick={() => window.print()}>🖨 Imprimir</Button>
            </div>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {form.id ? "Editar produto" : "Novo produto"}
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="overflow-y-auto pr-2">
              <div className="mb-5">
                <h4 className="mb-3 text-xs font-bold uppercase text-slate-500">Dados comerciais</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nome" className="sm:col-span-2" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
                  <Field label="SKU / Código" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
                  <Field label="Marca" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Unidade de medida (NF-e)</span>
                    <select
                      value={form.unidade}
                      onChange={(e) => setForm({ ...form, unidade: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                    >
                      {UNIDADES.map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <Field label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />

                  <div className="sm:col-span-2">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Código de barras (GTIN/EAN-13)
                    </span>
                    <div className="flex gap-2">
                      <input
                        value={form.gtin}
                        onChange={(e) => setForm({ ...form, gtin: e.target.value.replace(/\D/g, "").slice(0, 13) })}
                        placeholder="7890000000000 ou deixe vazio se isento"
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                      />
                      <Button
                        variant="soft"
                        onClick={() => setForm({ ...form, gtin: gerarGtin(Date.now() % 1e9) })}
                      >
                        Gerar código
                      </Button>
                    </div>
                    {form.gtin && (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
                        <Barcode valor={form.gtin.length === 13 ? form.gtin : ""} />
                        {!validarGtin(form.gtin) && form.gtin.length === 13 && (
                          <p className="mt-1 text-[11px] font-medium text-rose-600">
                            ⚠️ Dígito verificador inválido — passe o mouse sobre "Gerar código" para criar um válido.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Field label="Preço de custo" type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: Number(e.target.value) })} />
                  <Field label="Preço de venda" type="number" step="0.01" value={form.preco} onChange={(e) => setForm({ ...form, preco: Number(e.target.value) })} />
                  <Field label="Estoque atual" type="number" value={form.estoque} onChange={(e) => setForm({ ...form, estoque: Number(e.target.value) })} />
                  <Field label="Estoque mínimo" type="number" value={form.estoqueMin} onChange={(e) => setForm({ ...form, estoqueMin: Number(e.target.value) })} />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4">
                <h4 className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-slate-500">
                  <span>📄 Dados fiscais (obrigatório para NF-e)</span>
                  <span className="rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700">
                    definidos por NCM e origem
                  </span>
                </h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="NCM" value={form.impostos.ncm} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, ncm: e.target.value } })} placeholder="61091000" />
                  <Field label="CEST" value={form.impostos.cest} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, cest: e.target.value } })} placeholder="28.038.00" />
                  <Field label="CFOP" value={form.impostos.cfop} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, cfop: e.target.value } })} placeholder="5102" />
                  <Field label="CST/CSOSN ICMS" value={form.impostos.csosn} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, csosn: e.target.value } })} placeholder="101" />
                  <Field label="ICMS %" type="number" step="0.01" value={form.impostos.icmsAliq} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, icmsAliq: Number(e.target.value) } })} />
                  <Field label="Reduz. BC ICMS %" type="number" step="0.01" value={form.impostos.icmsReducao} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, icmsReducao: Number(e.target.value) } })} />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Field label="CST PIS" value={form.impostos.cstPis} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, cstPis: e.target.value } })} placeholder="01" />
                  <Field label="PIS %" type="number" step="0.01" value={form.impostos.pisAliq} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, pisAliq: Number(e.target.value) } })} />
                  <Field label="IPI %" type="number" step="0.01" value={form.impostos.ipiAliq} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, ipiAliq: Number(e.target.value) } })} />
                  <Field label="CST COFINS" value={form.impostos.cstCofins} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, cstCofins: e.target.value } })} placeholder="01" />
                  <Field label="COFINS %" type="number" step="0.01" value={form.impostos.cofinsAliq} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, cofinsAliq: Number(e.target.value) } })} />
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Origem mercadoria</span>
                    <select value={form.impostos.origemMercadoria} onChange={(e) => setForm({ ...form, impostos: { ...form.impostos, origemMercadoria: Number(e.target.value) } })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500">
                      <option value={0}>0 - Nacional</option>
                      <option value={1}>1 - Estrangeira (importação)</option>
                      <option value={2}>2 - Estrangeira (adquirida internamente)</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar produto</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
