import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, type Movimento, type Produto, type TipoMov } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";
import {
  ROTULO_PERIODO,
  casaTexto,
  dataLocal,
  dentroDoIntervalo,
  intervaloPeriodo,
  lerNumero,
  useFiltrosSalvos,
  type PresetPeriodo,
} from "../filtros";
import {
  BuscaGlobal,
  ChipAtivo,
  IntervaloFiltro,
  LinhaFiltros,
  MultiSelectFiltro,
  PainelFiltros,
  SelectFiltro,
  inputFiltro,
} from "../FiltroUI";
import { BotaoExportar, Paginacao, ThOrd, exportarCsv, useOrdenacao, usePaginacao } from "../Tabela";

const ROTULO: Record<TipoMov, { label: string; tone: "green" | "red" | "amber" | "sky" | "slate" }> = {
  entrada: { label: "Entrada NF-e", tone: "green" },
  venda: { label: "Venda", tone: "sky" },
  ajuste: { label: "Ajuste", tone: "amber" },
  perda: { label: "Perda/Quebra", tone: "red" },
  devolucao: { label: "Devolução", tone: "green" },
  inventario: { label: "Inventário", tone: "slate" },
  transferencia: { label: "Transferência", tone: "slate" },
};

type SitEstoque = "ok" | "baixo" | "zerado" | "negativo";
type ColPos = "sku" | "nome" | "categoria" | "saldo" | "minimo" | "custo" | "total" | "situacao";
type ColKar = "data" | "produto" | "tipo" | "documento" | "qtd" | "saldo" | "custo";

const SIT: { valor: SitEstoque; rotulo: string }[] = [
  { valor: "ok", rotulo: "Estoque OK" },
  { valor: "baixo", rotulo: "Abaixo do mínimo" },
  { valor: "zerado", rotulo: "Zerado" },
  { valor: "negativo", rotulo: "Negativo" },
];
const TIPOS_MOV: { valor: TipoMov; rotulo: string }[] = (Object.keys(ROTULO) as TipoMov[]).map((k) => ({
  valor: k,
  rotulo: ROTULO[k].label,
}));
const PRESETS: PresetPeriodo[] = ["todos", "hoje", "ontem", "ult7", "ult30", "mes", "mesAnterior", "personalizado"];

const FILTROS_PADRAO = {
  busca: "",
  categorias: [] as string[],
  marcas: [] as string[],
  estoque: [] as SitEstoque[],
  unidades: [] as string[],
  tiposMov: [] as TipoMov[],
  direcao: "todos" as "todos" | "entrada" | "saida",
  divergencias: false,
  periodo: "todos" as PresetPeriodo,
  de: "",
  ate: "",
  produtoId: "",
  saldoDe: "",
  saldoAte: "",
  valorDe: "",
  valorAte: "",
  avancado: false,
};

const sitDe = (p: Produto): SitEstoque =>
  p.estoque < 0 ? "negativo" : p.estoque === 0 ? "zerado" : p.estoque <= p.estoqueMin ? "baixo" : "ok";
const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
const fmtData = (iso: string) => (iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "");
const num = (v: string) => v.replace(/[^\d.,-]/g, "");

export default function Estoque() {
  const { db, ajustarEstoque } = useStore();
  const [aba, setAba] = useState<"posicao" | "kardex">("posicao");
  const [ajuste, setAjuste] = useState<{ id: string; nome: string; atual: number } | null>(null);
  const [nova, setNova] = useState(0);
  const [tipoAj, setTipoAj] = useState<TipoMov>("inventario");
  const [obs, setObs] = useState("");
  const { f, set, toggle, limpar } = useFiltrosSalvos("estoque", FILTROS_PADRAO);

  const categorias = useMemo(() => unicos(db.produtos.map((p) => p.categoria)), [db.produtos]);
  const marcas = useMemo(() => unicos(db.produtos.map((p) => p.marca)), [db.produtos]);
  const unidades = useMemo(() => unicos(db.produtos.map((p) => p.unidade || "UN")), [db.produtos]);
  const produtoPorId = useMemo(() => new Map(db.produtos.map((p) => [p.id, p])), [db.produtos]);

  const intervalo = intervaloPeriodo(f.periodo, f.de, f.ate);
  const sMin = lerNumero(f.saldoDe), sMax = lerNumero(f.saldoAte);
  const vMin = lerNumero(f.valorDe), vMax = lerNumero(f.valorAte);

  // ---- posição atual
  const produtosFiltrados = useMemo(() => {
    return db.produtos.filter((p) => {
      if (f.categorias.length && !f.categorias.includes(p.categoria)) return false;
      if (f.marcas.length && !f.marcas.includes(p.marca)) return false;
      if (f.estoque.length && !f.estoque.includes(sitDe(p))) return false;
      if (f.unidades.length && !f.unidades.includes(p.unidade || "UN")) return false;
      if (f.produtoId && p.id !== f.produtoId) return false;
      if (Number.isFinite(sMin) && p.estoque < sMin) return false;
      if (Number.isFinite(sMax) && p.estoque > sMax) return false;
      const total = p.custo * p.estoque;
      if (Number.isFinite(vMin) && total < vMin) return false;
      if (Number.isFinite(vMax) && total > vMax) return false;
      return casaTexto(f.busca, [p.nome, p.sku, p.gtin, p.codBalanca, p.marca, p.categoria, p.unidade]);
    });
  }, [db.produtos, f, sMin, sMax, vMin, vMax]);

  const contSit = useMemo(() => {
    const c: Partial<Record<SitEstoque, number>> = {};
    // contagem com os outros filtros, exceto situação
    db.produtos.forEach((p) => {
      if (f.categorias.length && !f.categorias.includes(p.categoria)) return;
      if (f.marcas.length && !f.marcas.includes(p.marca)) return;
      if (f.unidades.length && !f.unidades.includes(p.unidade || "UN")) return;
      if (f.produtoId && p.id !== f.produtoId) return;
      if (!casaTexto(f.busca, [p.nome, p.sku, p.gtin, p.marca, p.categoria])) return;
      const s = sitDe(p);
      c[s] = (c[s] ?? 0) + 1;
    });
    return c;
  }, [db.produtos, f]);

  const ordPos = useOrdenacao<Produto, ColPos>(
    produtosFiltrados,
    {
      sku: (p) => p.sku,
      nome: (p) => p.nome,
      categoria: (p) => p.categoria,
      saldo: (p) => p.estoque,
      minimo: (p) => p.estoqueMin,
      custo: (p) => p.custo,
      total: (p) => p.custo * p.estoque,
      situacao: (p) => ({ ok: 0, baixo: 1, zerado: 2, negativo: 3 }[sitDe(p)]),
    },
    { col: "nome", dir: "asc" },
  );
  const pagPos = usePaginacao(ordPos.ordenada, "estoque-pos");

  // ---- kardex
  const movsFiltrados = useMemo(() => {
    return db.movimentos.filter((m) => {
      if (f.tiposMov.length && !f.tiposMov.includes(m.tipo)) return false;
      if (f.divergencias && !["perda", "ajuste", "inventario"].includes(m.tipo)) return false;
      if (f.direcao === "entrada" && !(m.qtd > 0)) return false;
      if (f.direcao === "saida" && !(m.qtd < 0)) return false;
      if (!dentroDoIntervalo(dataLocal(new Date(m.data)), intervalo)) return false;
      if (f.produtoId && m.produtoId !== f.produtoId) return false;
      if (f.categorias.length) {
        const cat = produtoPorId.get(m.produtoId)?.categoria;
        if (!cat || !f.categorias.includes(cat)) return false;
      }
      if (f.marcas.length) {
        const marca = produtoPorId.get(m.produtoId)?.marca;
        if (!marca || !f.marcas.includes(marca)) return false;
      }
      return casaTexto(f.busca, [m.produtoNome, m.documento, m.observacao, m.tipo, ROTULO[m.tipo].label, produtoPorId.get(m.produtoId)?.sku]);
    });
  }, [db.movimentos, f, intervalo, produtoPorId]);

  const contTipo = useMemo(() => {
    const c: Partial<Record<TipoMov, number>> = {};
    db.movimentos.forEach((m) => {
      if (!dentroDoIntervalo(dataLocal(new Date(m.data)), intervalo)) return;
      if (f.produtoId && m.produtoId !== f.produtoId) return;
      if (f.direcao === "entrada" && !(m.qtd > 0)) return;
      if (f.direcao === "saida" && !(m.qtd < 0)) return;
      if (f.divergencias && !["perda", "ajuste", "inventario"].includes(m.tipo)) return;
      if (!casaTexto(f.busca, [m.produtoNome, m.documento, m.observacao])) return;
      c[m.tipo] = (c[m.tipo] ?? 0) + 1;
    });
    return c;
  }, [db.movimentos, f, intervalo]);

  const ordKar = useOrdenacao<Movimento, ColKar>(
    movsFiltrados,
    {
      data: (m) => m.data,
      produto: (m) => m.produtoNome,
      tipo: (m) => m.tipo,
      documento: (m) => m.documento,
      qtd: (m) => m.qtd,
      saldo: (m) => m.saldoApos,
      custo: (m) => m.custoUnit,
    },
    { col: "data", dir: "desc" },
  );
  const pagKar = usePaginacao(ordKar.ordenada, "estoque-kar");

  // ---- resumos
  const resumoGeral = useMemo(() => {
    const valorCusto = db.produtos.reduce((s, p) => s + p.custo * Math.max(0, p.estoque), 0);
    const valorVenda = db.produtos.reduce((s, p) => s + p.preco * Math.max(0, p.estoque), 0);
    const unidades = db.produtos.reduce((s, p) => s + p.estoque, 0);
    const criticos = db.produtos.filter((p) => p.estoque > 0 && p.estoque <= p.estoqueMin).length;
    const zerados = db.produtos.filter((p) => p.estoque === 0).length;
    return { valorCusto, valorVenda, unidades, criticos, zerados };
  }, [db.produtos]);

  const resumoFiltro = useMemo(() => {
    if (aba === "posicao") {
      const custo = produtosFiltrados.reduce((s, p) => s + p.custo * Math.max(0, p.estoque), 0);
      const venda = produtosFiltrados.reduce((s, p) => s + p.preco * Math.max(0, p.estoque), 0);
      const un = produtosFiltrados.reduce((s, p) => s + p.estoque, 0);
      return { n: produtosFiltrados.length, total: db.produtos.length, custo, venda, un, palavra: "produto(s)" };
    }
    const entradas = movsFiltrados.filter((m) => m.qtd > 0).reduce((s, m) => s + m.qtd, 0);
    const saidas = movsFiltrados.filter((m) => m.qtd < 0).reduce((s, m) => s + Math.abs(m.qtd), 0);
    return { n: movsFiltrados.length, total: db.movimentos.length, entradas, saidas, palavra: "movimento(s)" };
  }, [aba, produtosFiltrados, movsFiltrados, db.produtos.length, db.movimentos.length]);

  // ---- chips ativos
  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.busca.trim()) ativos.push({ id: "b", rotulo: `Busca: “${f.busca.trim()}”`, remover: () => set("busca", "") });
  f.categorias.forEach((c) => ativos.push({ id: `c-${c}`, rotulo: `Categoria: ${c}`, remover: () => toggle("categorias", c) }));
  f.marcas.forEach((m) => ativos.push({ id: `m-${m}`, rotulo: `Marca: ${m}`, remover: () => toggle("marcas", m) }));
  f.estoque.forEach((e) => ativos.push({ id: `e-${e}`, rotulo: SIT.find((x) => x.valor === e)!.rotulo, remover: () => toggle("estoque", e) }));
  f.unidades.forEach((u) => ativos.push({ id: `u-${u}`, rotulo: `Unidade: ${u}`, remover: () => toggle("unidades", u) }));
  f.tiposMov.forEach((t) => ativos.push({ id: `t-${t}`, rotulo: ROTULO[t].label, remover: () => toggle("tiposMov", t) }));
  if (f.direcao !== "todos") ativos.push({ id: "dir", rotulo: f.direcao === "entrada" ? "Só entradas" : "Só saídas", remover: () => set("direcao", "todos") });
  if (f.divergencias) ativos.push({ id: "div", rotulo: "Só divergências (perda/ajuste/inventário)", remover: () => set("divergencias", false) });
  if (f.periodo !== "todos")
    ativos.push({
      id: "per",
      rotulo: f.periodo === "personalizado" ? `Período ${f.de ? fmtData(f.de) : "…"} a ${f.ate ? fmtData(f.ate) : "…"}` : ROTULO_PERIODO[f.periodo],
      remover: () => set("periodo", "todos"),
    });
  if (f.produtoId) ativos.push({ id: "pr", rotulo: `Produto: ${produtoPorId.get(f.produtoId)?.nome ?? "…"}`, remover: () => set("produtoId", "") });
  if (Number.isFinite(sMin) || Number.isFinite(sMax))
    ativos.push({ id: "sd", rotulo: `Saldo ${Number.isFinite(sMin) ? sMin : "…"} a ${Number.isFinite(sMax) ? sMax : "…"}`, remover: () => { set("saldoDe", ""); set("saldoAte", ""); } });
  if (Number.isFinite(vMin) || Number.isFinite(vMax))
    ativos.push({ id: "vl", rotulo: `Valor estoque ${Number.isFinite(vMin) ? brl(vMin) : "…"} a ${Number.isFinite(vMax) ? brl(vMax) : "…"}`, remover: () => { set("valorDe", ""); set("valorAte", ""); } });

  function exportar() {
    if (aba === "posicao") {
      exportarCsv(
        "estoque-posicao",
        ["Código", "Produto", "Categoria", "Marca", "Unidade", "Saldo", "Mínimo", "Custo médio", "Total a custo", "Total a venda", "Situação"],
        ordPos.ordenada.map((p) => [
          p.sku, p.nome, p.categoria, p.marca, p.unidade || "UN", p.estoque, p.estoqueMin, p.custo,
          Math.round(p.custo * p.estoque * 100) / 100, Math.round(p.preco * p.estoque * 100) / 100,
          SIT.find((x) => x.valor === sitDe(p))!.rotulo,
        ]),
      );
    } else {
      exportarCsv(
        "estoque-kardex",
        ["Data", "Produto", "SKU", "Tipo", "Documento", "Observação", "Quantidade", "Saldo após", "Custo unitário"],
        ordKar.ordenada.map((m) => [
          new Date(m.data).toLocaleString("pt-BR"), m.produtoNome, produtoPorId.get(m.produtoId)?.sku ?? "",
          ROTULO[m.tipo].label, m.documento, m.observacao ?? "", m.qtd, m.saldoApos, m.custoUnit,
        ]),
      );
    }
  }

  const thPos = { atual: ordPos.col, dir: ordPos.dir, onOrdenar: ordPos.ordenar };
  const thKar = { atual: ordKar.col, dir: ordKar.dir, onOrdenar: ordKar.ordenar };
  const listaAtual = aba === "posicao" ? produtosFiltrados.length : movsFiltrados.length;

  return (
    <div>
      <PageHeader
        title="Gestão de estoque"
        subtitle="Posição atual, kardex de movimentações e inventário"
        action={<BotaoExportar onClick={exportar} total={listaAtual} />}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor a custo</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{brl(resumoGeral.valorCusto)}</p>
          <p className="text-[11px] text-slate-400">{resumoGeral.unidades} unidades</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor a venda</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{brl(resumoGeral.valorVenda)}</p>
          <p className="text-[11px] text-slate-400">Lucro potencial {brl(resumoGeral.valorVenda - resumoGeral.valorCusto)}</p>
        </Card>
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">Abaixo do mínimo</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{resumoGeral.criticos}</p>
        </Card>
        <Card className="border-l-4 border-l-rose-500 p-4">
          <p className="text-xs uppercase text-slate-500">Sem estoque</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{resumoGeral.zerados}</p>
        </Card>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {([
          ["posicao", "📊 Posição atual"],
          ["kardex", `📒 Kardex (${db.movimentos.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ============================ FILTROS ============================ */}
      <PainelFiltros>
        <BuscaGlobal
          value={f.busca}
          onChange={(v) => set("busca", v)}
          placeholder={
            aba === "posicao"
              ? "Buscar por nome, código (SKU), código de barras, marca, categoria…"
              : "Buscar por produto, documento, observação, tipo de movimento…"
          }
        />

        <LinhaFiltros>
          {aba === "posicao" ? (
            <>
              <MultiSelectFiltro rotulo="Situação" opcoes={SIT} selecionados={f.estoque} contagem={contSit}
                onToggle={(v) => toggle("estoque", v)} onLimpar={() => set("estoque", [])} />
              <MultiSelectFiltro rotulo="Categoria" opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))} selecionados={f.categorias}
                onToggle={(v) => toggle("categorias", v)} onLimpar={() => set("categorias", [])} />
              <MultiSelectFiltro rotulo="Marca" opcoes={marcas.map((m) => ({ valor: m, rotulo: m }))} selecionados={f.marcas}
                onToggle={(v) => toggle("marcas", v)} onLimpar={() => set("marcas", [])} />
              <SelectFiltro
                rotulo="Produto"
                valor={f.produtoId}
                padrao=""
                largura="min-w-[200px]"
                onChange={(v) => set("produtoId", v)}
                opcoes={[{ valor: "", rotulo: "Todos" }, ...[...db.produtos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => ({ valor: p.id, rotulo: p.nome }))]}
              />
            </>
          ) : (
            <>
              <SelectFiltro
                rotulo="Período"
                valor={f.periodo}
                padrao="todos"
                onChange={(v) => set("periodo", v)}
                opcoes={PRESETS.map((p) => ({ valor: p, rotulo: p === "personalizado" ? "Personalizado (de / até)…" : ROTULO_PERIODO[p] }))}
              />
              {f.periodo === "personalizado" && (
                <IntervaloFiltro rotulo="Datas">
                  de <input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} className={inputFiltro} aria-label="Data de" />
                  até <input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} className={inputFiltro} aria-label="Data até" />
                </IntervaloFiltro>
              )}
              <MultiSelectFiltro rotulo="Tipo de movimento" opcoes={TIPOS_MOV} selecionados={f.tiposMov} contagem={contTipo}
                onToggle={(v) => toggle("tiposMov", v)} onLimpar={() => set("tiposMov", [])} />
              <SelectFiltro
                rotulo="Direção"
                valor={f.direcao}
                padrao="todos"
                onChange={(v) => set("direcao", v)}
                opcoes={[
                  { valor: "todos", rotulo: "Entradas e saídas" },
                  { valor: "entrada", rotulo: "Só entradas (+)" },
                  { valor: "saida", rotulo: "Só saídas (−)" },
                ]}
              />
              <SelectFiltro
                rotulo="Produto"
                valor={f.produtoId}
                padrao=""
                largura="min-w-[200px]"
                onChange={(v) => set("produtoId", v)}
                opcoes={[{ valor: "", rotulo: "Todos" }, ...[...db.produtos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => ({ valor: p.id, rotulo: p.nome }))]}
              />
            </>
          )}
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !f.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {f.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados"}
        </button>

        {f.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              {aba === "posicao" ? (
                <>
                  <MultiSelectFiltro rotulo="Unidade" opcoes={unidades.map((u) => ({ valor: u, rotulo: u }))} selecionados={f.unidades}
                    onToggle={(v) => toggle("unidades", v)} onLimpar={() => set("unidades", [])} largura="min-w-[120px]" />
                  <IntervaloFiltro rotulo="Saldo (qtd.)">
                    de <input inputMode="decimal" value={f.saldoDe} onChange={(e) => set("saldoDe", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Saldo de" />
                    até <input inputMode="decimal" value={f.saldoAte} onChange={(e) => set("saldoAte", num(e.target.value))} className={cn(inputFiltro, "w-16 text-right")} aria-label="Saldo até" />
                  </IntervaloFiltro>
                  <IntervaloFiltro rotulo="Valor em estoque (R$ a custo)">
                    de <input inputMode="decimal" value={f.valorDe} onChange={(e) => set("valorDe", num(e.target.value))} placeholder="0,00" className={cn(inputFiltro, "w-24 text-right")} aria-label="Valor de" />
                    até <input inputMode="decimal" value={f.valorAte} onChange={(e) => set("valorAte", num(e.target.value))} placeholder="sem limite" className={cn(inputFiltro, "w-24 text-right")} aria-label="Valor até" />
                  </IntervaloFiltro>
                </>
              ) : (
                <>
                  <MultiSelectFiltro rotulo="Categoria do produto" opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))} selecionados={f.categorias}
                    onToggle={(v) => toggle("categorias", v)} onLimpar={() => set("categorias", [])} />
                  <MultiSelectFiltro rotulo="Marca" opcoes={marcas.map((m) => ({ valor: m, rotulo: m }))} selecionados={f.marcas}
                    onToggle={(v) => toggle("marcas", v)} onLimpar={() => set("marcas", [])} />
                  <label className="flex h-9 cursor-pointer items-center gap-2 self-end rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-700">
                    <input type="checkbox" checked={f.divergencias} onChange={(e) => set("divergencias", e.target.checked)} className="h-4 w-4 accent-sky-600" />
                    Só divergências (perda, ajuste, inventário)
                  </label>
                </>
              )}
            </LinhaFiltros>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? (
            <span className="text-xs text-slate-400">Nenhum filtro ativo</span>
          ) : (
            <>
              {ativos.map((a) => (
                <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>
              ))}
              <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">Limpar filtros</button>
            </>
          )}
        </div>
      </PainelFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span><b className="text-slate-900">{resumoFiltro.n}</b> de {resumoFiltro.total} {resumoFiltro.palavra}</span>
        {aba === "posicao" && (
          <>
            <span>A custo: <b className="text-slate-900">{brl(produtosFiltrados.reduce((s, p) => s + p.custo * Math.max(0, p.estoque), 0))}</b></span>
            <span>A venda: <b className="text-emerald-700">{brl(produtosFiltrados.reduce((s, p) => s + p.preco * Math.max(0, p.estoque), 0))}</b></span>
            <span>Unidades: <b className="text-slate-900">{produtosFiltrados.reduce((s, p) => s + p.estoque, 0)}</b></span>
          </>
        )}
        {aba === "kardex" && (
          <>
            <span>Entradas: <b className="text-emerald-700">+{movsFiltrados.filter((m) => m.qtd > 0).reduce((s, m) => s + m.qtd, 0)}</b></span>
            <span>Saídas: <b className="text-rose-700">−{movsFiltrados.filter((m) => m.qtd < 0).reduce((s, m) => s + Math.abs(m.qtd), 0)}</b></span>
          </>
        )}
      </div>

      {aba === "posicao" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <ThOrd col="sku" {...thPos}>Código</ThOrd>
                  <ThOrd col="nome" {...thPos}>Produto</ThOrd>
                  <ThOrd col="categoria" {...thPos}>Categoria</ThOrd>
                  <ThOrd col="saldo" {...thPos} alinhar="center">Saldo</ThOrd>
                  <ThOrd col="minimo" {...thPos} alinhar="center">Mínimo</ThOrd>
                  <ThOrd col="custo" {...thPos} alinhar="right">Custo médio</ThOrd>
                  <ThOrd col="total" {...thPos} alinhar="right">Total a custo</ThOrd>
                  <ThOrd col="situacao" {...thPos}>Situação</ThOrd>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagPos.itens.map((p) => {
                  const sit = sitDe(p);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.sku}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{p.nome}</p>
                        <p className="text-xs text-slate-400">{p.marca || "s/ marca"} · {p.unidade || "UN"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.categoria}</td>
                      <td className="px-4 py-3 text-center font-bold text-slate-900">{p.estoque}</td>
                      <td className="px-4 py-3 text-center text-slate-500">{p.estoqueMin}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{brl(p.custo)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{brl(p.custo * p.estoque)}</td>
                      <td className="px-4 py-3">
                        {sit === "negativo" || sit === "zerado" ? (
                          <Badge tone="red">{sit === "negativo" ? "Negativo" : "Sem estoque"}</Badge>
                        ) : sit === "baixo" ? (
                          <Badge tone="amber">Repor</Badge>
                        ) : (
                          <Badge tone="green">Normal</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setAjuste({ id: p.id, nome: p.nome, atual: p.estoque });
                            setNova(p.estoque);
                            setObs("");
                          }}
                          className="text-xs font-semibold text-sky-600 hover:underline"
                        >
                          Ajustar
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {produtosFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      {db.produtos.length === 0 ? "Nenhum produto cadastrado." : (
                        <>Nenhum produto com esses filtros. <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button></>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Paginacao {...pagPos} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {db.movimentos.length === 0 ? (
            <p className="py-12 text-center text-slate-400">Nenhuma movimentação registrada ainda.</p>
          ) : movsFiltrados.length === 0 ? (
            <p className="py-12 text-center text-slate-400">
              Nenhum movimento com esses filtros.{" "}
              <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button>
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <ThOrd col="data" {...thKar}>Data</ThOrd>
                      <ThOrd col="produto" {...thKar}>Produto</ThOrd>
                      <ThOrd col="tipo" {...thKar}>Tipo</ThOrd>
                      <ThOrd col="documento" {...thKar}>Documento</ThOrd>
                      <ThOrd col="qtd" {...thKar} alinhar="center">Qtd</ThOrd>
                      <ThOrd col="saldo" {...thKar} alinhar="center">Saldo</ThOrd>
                      <ThOrd col="custo" {...thKar} alinhar="right">Custo</ThOrd>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pagKar.itens.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(m.data).toLocaleString("pt-BR")}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {m.produtoNome}
                          {produtoPorId.get(m.produtoId)?.sku && (
                            <span className="ml-1 font-mono text-[10px] text-slate-400">{produtoPorId.get(m.produtoId)!.sku}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={ROTULO[m.tipo].tone}>{ROTULO[m.tipo].label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {m.documento}
                          {m.observacao && <span className="text-slate-400"> · {m.observacao}</span>}
                        </td>
                        <td className={cn("px-4 py-3 text-center font-bold", m.qtd > 0 ? "text-emerald-600" : "text-rose-600")}>
                          {m.qtd > 0 ? "+" : ""}{m.qtd}
                        </td>
                        <td className="px-4 py-3 text-center text-slate-900">{m.saldoApos}</td>
                        <td className="px-4 py-3 text-right text-slate-500">{brl(m.custoUnit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao {...pagKar} />
            </>
          )}
        </Card>
      )}

      {ajuste && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setAjuste(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Ajustar estoque</h3>
            <p className="mt-1 text-sm text-slate-500">{ajuste.nome}</p>

            <div className="my-4 flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm">
              <span className="text-slate-500">Saldo atual</span>
              <span className="text-xl font-bold text-slate-900">{ajuste.atual}</span>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Novo saldo</span>
              <input
                type="number"
                value={nova}
                onChange={(e) => setNova(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {(["inventario", "ajuste", "perda", "devolucao"] as TipoMov[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTipoAj(t)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    tipoAj === t ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {ROTULO[t].label}
                </button>
              ))}
            </div>

            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Motivo do ajuste"
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            />

            {nova !== ajuste.atual && (
              <p className={cn("mt-3 text-sm font-semibold", nova > ajuste.atual ? "text-emerald-600" : "text-rose-600")}>
                {nova > ajuste.atual ? "+" : ""}{nova - ajuste.atual} unidades
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setAjuste(null)}>Cancelar</Button>
              <Button
                className="flex-1"
                onClick={() => {
                  ajustarEstoque(ajuste.id, nova, tipoAj, obs);
                  setAjuste(null);
                }}
              >
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
