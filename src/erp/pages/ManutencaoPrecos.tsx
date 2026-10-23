import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, type Produto, type TipoMov } from "../types";
import { Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";
import { casaTexto, lerNumero, useFiltrosSalvos } from "../filtros";
import {
  BuscaGlobal,
  ChipAtivo,
  LinhaFiltros,
  MultiSelectFiltro,
  PainelFiltros,
  inputFiltro,
} from "../FiltroUI";
import { BotaoExportar, Paginacao, ThOrd, exportarCsv, useOrdenacao, usePaginacao } from "../Tabela";

/**
 * Manutenção de preços e estoque — padrão Bling / Tiny / TOTVS / Sankhya:
 * lista editável + markup por linha + alteração em massa (R$ ou %) + ajuste de estoque.
 */

type Col = "sku" | "nome" | "categoria" | "custo" | "preco" | "markup" | "estoque";
type SitEstoque = "ok" | "baixo" | "zerado" | "negativo";

const SIT: { valor: SitEstoque; rotulo: string }[] = [
  { valor: "ok", rotulo: "Estoque OK" },
  { valor: "baixo", rotulo: "Abaixo do mínimo" },
  { valor: "zerado", rotulo: "Zerado" },
  { valor: "negativo", rotulo: "Negativo" },
];

const FILTROS_PADRAO = {
  busca: "",
  categorias: [] as string[],
  marcas: [] as string[],
  estoque: [] as SitEstoque[],
};

const sitDe = (p: Produto): SitEstoque =>
  p.estoque < 0 ? "negativo" : p.estoque === 0 ? "zerado" : p.estoque <= p.estoqueMin ? "baixo" : "ok";

const markupPct = (custo: number, preco: number) =>
  custo > 0 ? Math.round(((preco - custo) / custo) * 1000) / 10 : preco > 0 ? 100 : 0;

const margemPct = (custo: number, preco: number) =>
  preco > 0 ? Math.round(((preco - custo) / preco) * 1000) / 10 : 0;

const r2 = (n: number) => Math.round(n * 100) / 100;
const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));

type Draft = { preco: string; markup: string; estoque: string };

export default function ManutencaoPrecos() {
  const { db, updProduto, ajustarEstoque } = useStore();
  const { f, set, toggle, limpar } = useFiltrosSalvos("manutencao-precos", FILTROS_PADRAO);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  // massa
  const [modoMassa, setModoMassa] = useState<"percentual" | "valor" | "markup">("percentual");
  const [valorMassa, setValorMassa] = useState("");
  const [arredondar, setArredondar] = useState<"2" | "0" | "0.05" | "0.10">("2");
  const [aplicarEm, setAplicarEm] = useState<"selecionados" | "filtrados">("selecionados");

  const categorias = useMemo(() => unicos(db.produtos.map((p) => p.categoria)), [db.produtos]);
  const marcas = useMemo(() => unicos(db.produtos.map((p) => p.marca)), [db.produtos]);

  const filtrados = useMemo(() => {
    return db.produtos.filter((p) => {
      if (f.categorias.length && !f.categorias.includes(p.categoria)) return false;
      if (f.marcas.length && !f.marcas.includes(p.marca)) return false;
      if (f.estoque.length && !f.estoque.includes(sitDe(p))) return false;
      return casaTexto(f.busca, [p.nome, p.sku, p.gtin, p.marca, p.categoria]);
    });
  }, [db.produtos, f]);

  const ord = useOrdenacao<Produto, Col>(
    filtrados,
    {
      sku: (p) => p.sku,
      nome: (p) => p.nome,
      categoria: (p) => p.categoria,
      custo: (p) => p.custo,
      preco: (p) => p.preco,
      markup: (p) => markupPct(p.custo, p.preco),
      estoque: (p) => p.estoque,
    },
    { col: "nome", dir: "asc" },
  );
  const pag = usePaginacao(ord.ordenada, "manutencao-precos");
  const th = { atual: ord.col, dir: ord.dir, onOrdenar: ord.ordenar };

  const getDraft = (p: Produto): Draft =>
    draft[p.id] ?? {
      preco: String(p.preco),
      markup: String(markupPct(p.custo, p.preco)),
      estoque: String(p.estoque),
    };

  const setCampo = (p: Produto, campo: keyof Draft, valor: string, origem: "preco" | "markup" | "estoque") => {
    const base = getDraft(p);
    let next: Draft = { ...base, [campo]: valor };
    if (origem === "preco") {
      const preco = lerNumero(valor);
      if (Number.isFinite(preco) && p.custo > 0) next.markup = String(markupPct(p.custo, preco));
    }
    if (origem === "markup") {
      const mk = lerNumero(valor);
      if (Number.isFinite(mk) && p.custo > 0) next.preco = String(r2(p.custo * (1 + mk / 100)));
    }
    setDraft((d) => ({ ...d, [p.id]: next }));
    setMsg(null);
  };

  const sujo = (p: Produto) => {
    const d = draft[p.id];
    if (!d) return false;
    const preco = lerNumero(d.preco);
    const est = lerNumero(d.estoque);
    return (Number.isFinite(preco) && r2(preco) !== r2(p.preco)) || (Number.isFinite(est) && est !== p.estoque);
  };

  const alterar = (ids: string[]) => {
    let ok = 0;
    ids.forEach((id) => {
      const p = db.produtos.find((x) => x.id === id);
      if (!p) return;
      const d = draft[id] ?? getDraft(p);
      const preco = lerNumero(d.preco);
      const est = lerNumero(d.estoque);
      let mudou = false;
      if (Number.isFinite(preco) && preco >= 0 && r2(preco) !== r2(p.preco)) {
        updProduto({ ...p, preco: r2(preco) });
        mudou = true;
      }
      const p2 = mudou ? { ...p, preco: r2(preco) } : p;
      if (Number.isFinite(est) && est !== p.estoque) {
        const tipo: TipoMov = "ajuste";
        ajustarEstoque(p.id, est, tipo, "Manutenção de preços — ajuste de estoque");
        mudou = true;
      }
      // se só preço mudou já salvamos; se estoque mudou o store atualiza o produto
      void p2;
      if (mudou) ok++;
    });
    setDraft((d) => {
      const n = { ...d };
      ids.forEach((id) => delete n[id]);
      return n;
    });
    setMsg({ tipo: "ok", texto: `${ok} produto(s) atualizado(s).` });
  };

  const arred = (n: number) => {
    if (arredondar === "0") return Math.round(n);
    if (arredondar === "0.05") return Math.round(n * 20) / 20;
    if (arredondar === "0.10") return Math.round(n * 10) / 10;
    return r2(n);
  };

  const aplicarMassa = () => {
    const v = lerNumero(valorMassa);
    if (!Number.isFinite(v)) {
      setMsg({ tipo: "erro", texto: "Informe um valor ou percentual válido." });
      return;
    }
    const alvos =
      aplicarEm === "selecionados"
        ? ord.ordenada.filter((p) => sel.has(p.id))
        : ord.ordenada;
    if (!alvos.length) {
      setMsg({ tipo: "erro", texto: aplicarEm === "selecionados" ? "Selecione ao menos um produto." : "Nenhum produto no filtro." });
      return;
    }
    const next: Record<string, Draft> = { ...draft };
    alvos.forEach((p) => {
      const base = next[p.id] ?? getDraft(p);
      let preco = lerNumero(base.preco);
      if (!Number.isFinite(preco)) preco = p.preco;
      if (modoMassa === "percentual") preco = preco * (1 + v / 100);
      else if (modoMassa === "valor") preco = preco + v;
      else if (modoMassa === "markup") preco = p.custo * (1 + v / 100);
      preco = Math.max(0, arred(preco));
      next[p.id] = {
        ...base,
        preco: String(preco),
        markup: String(markupPct(p.custo, preco)),
      };
    });
    setDraft(next);
    setSel(new Set(alvos.map((p) => p.id)));
    setMsg({
      tipo: "ok",
      texto: `Pré-visualização em ${alvos.length} produto(s). Revise a lista e clique em “Salvar alterações”.`,
    });
  };

  const idsSujos = ord.ordenada.filter(sujo).map((p) => p.id);
  const todosPagina = pag.itens.every((p) => sel.has(p.id)) && pag.itens.length > 0;

  const toggleTodos = () => {
    if (todosPagina) {
      const n = new Set(sel);
      pag.itens.forEach((p) => n.delete(p.id));
      setSel(n);
    } else {
      const n = new Set(sel);
      pag.itens.forEach((p) => n.add(p.id));
      setSel(n);
    }
  };

  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.busca.trim()) ativos.push({ id: "b", rotulo: `Busca: “${f.busca.trim()}”`, remover: () => set("busca", "") });
  f.categorias.forEach((c) => ativos.push({ id: `c-${c}`, rotulo: c, remover: () => toggle("categorias", c) }));
  f.marcas.forEach((m) => ativos.push({ id: `m-${m}`, rotulo: m, remover: () => toggle("marcas", m) }));
  f.estoque.forEach((e) => ativos.push({ id: `e-${e}`, rotulo: SIT.find((x) => x.valor === e)!.rotulo, remover: () => toggle("estoque", e) }));

  function exportar() {
    exportarCsv(
      "manutencao-precos",
      ["SKU", "Produto", "Categoria", "Custo", "Preço", "Markup %", "Margem %", "Estoque"],
      ord.ordenada.map((p) => {
        const d = getDraft(p);
        const preco = lerNumero(d.preco);
        const pr = Number.isFinite(preco) ? preco : p.preco;
        return [p.sku, p.nome, p.categoria, p.custo, pr, markupPct(p.custo, pr), margemPct(p.custo, pr), lerNumero(d.estoque) || p.estoque];
      }),
    );
  }

  return (
    <div>
      <PageHeader
        title="Manutenção de preços"
        subtitle="Markup · preço · estoque · alteração em massa (R$ ou %) — padrão Bling / Tiny / TOTVS"
        action={
          <div className="flex flex-wrap gap-2">
            <BotaoExportar onClick={exportar} total={filtrados.length} />
            {idsSujos.length > 0 ? (
              <Button onClick={() => alterar(idsSujos)}>💾 Salvar alterações ({idsSujos.length})</Button>
            ) : (
              <button type="button" disabled className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-400">
                💾 Salvar alterações (0)
              </button>
            )}
          </div>
        }
      />

      {/* Painel de alteração em massa */}
      <Card className="mb-4 border-sky-200 bg-gradient-to-r from-sky-50 to-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900">⚡ Alteração em massa</h3>
          <span className="text-xs text-slate-500">
            {sel.size} selecionado(s) · {filtrados.length} no filtro · {idsSujos.length} com alteração pendente
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Tipo
            <select
              value={modoMassa}
              onChange={(e) => setModoMassa(e.target.value as typeof modoMassa)}
              className={inputFiltro}
            >
              <option value="percentual">Reajustar preço em %</option>
              <option value="valor">Somar / subtrair R$</option>
              <option value="markup">Aplicar markup % sobre o custo</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {modoMassa === "valor" ? "Valor (R$)" : "Percentual (%)"}
            <input
              inputMode="decimal"
              value={valorMassa}
              onChange={(e) => setValorMassa(e.target.value.replace(/[^\d.,-]/g, ""))}
              placeholder={modoMassa === "valor" ? "ex: 5,00 ou -2,00" : "ex: 10 ou -5"}
              className={cn(inputFiltro, "w-36")}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Arredondar
            <select value={arredondar} onChange={(e) => setArredondar(e.target.value as typeof arredondar)} className={inputFiltro}>
              <option value="2">2 casas (R$ 0,01)</option>
              <option value="0">Inteiro (R$ 1)</option>
              <option value="0.05">Múltiplo de R$ 0,05</option>
              <option value="0.10">Múltiplo de R$ 0,10</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            Aplicar em
            <select value={aplicarEm} onChange={(e) => setAplicarEm(e.target.value as typeof aplicarEm)} className={inputFiltro}>
              <option value="selecionados">Só selecionados</option>
              <option value="filtrados">Todos do filtro</option>
            </select>
          </label>
          <Button onClick={aplicarMassa}>Aplicar na lista</Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          A massa só monta a <b>pré-visualização</b> (campos em amarelo). Nada grava até você clicar em{" "}
          <b>Salvar alterações</b>. Markup = (preço − custo) ÷ custo. Margem = (preço − custo) ÷ preço.
        </p>
      </Card>

      {msg && (
        <div
          className={cn(
            "mb-4 rounded-lg px-4 py-3 text-sm font-medium",
            msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700",
          )}
        >
          {msg.texto}
        </div>
      )}

      <PainelFiltros>
        <BuscaGlobal value={f.busca} onChange={(v) => set("busca", v)} placeholder="Buscar nome, SKU, marca, categoria…" />
        <LinhaFiltros>
          <MultiSelectFiltro
            rotulo="Categoria"
            opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))}
            selecionados={f.categorias}
            onToggle={(v) => toggle("categorias", v)}
            onLimpar={() => set("categorias", [])}
          />
          <MultiSelectFiltro
            rotulo="Marca"
            opcoes={marcas.map((m) => ({ valor: m, rotulo: m }))}
            selecionados={f.marcas}
            onToggle={(v) => toggle("marcas", v)}
            onLimpar={() => set("marcas", [])}
          />
          <MultiSelectFiltro
            rotulo="Estoque"
            opcoes={SIT}
            selecionados={f.estoque}
            onToggle={(v) => toggle("estoque", v)}
            onLimpar={() => set("estoque", [])}
          />
        </LinhaFiltros>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? (
            <span className="text-xs text-slate-400">Nenhum filtro</span>
          ) : (
            <>
              {ativos.map((a) => (
                <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>
              ))}
              <button onClick={limpar} className="text-xs font-semibold text-rose-600 hover:underline">Limpar</button>
            </>
          )}
        </div>
      </PainelFiltros>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-3 py-3">
                  <input type="checkbox" checked={todosPagina} onChange={toggleTodos} className="accent-sky-600" aria-label="Selecionar página" />
                </th>
                <ThOrd col="sku" {...th}>SKU</ThOrd>
                <ThOrd col="nome" {...th}>Produto</ThOrd>
                <ThOrd col="custo" {...th} alinhar="right">Custo</ThOrd>
                <ThOrd col="markup" {...th} alinhar="right">Markup %</ThOrd>
                <ThOrd col="preco" {...th} alinhar="right">Preço venda</ThOrd>
                <th className="px-3 py-3 text-right uppercase tracking-wide">Margem %</th>
                <ThOrd col="estoque" {...th} alinhar="center">Estoque</ThOrd>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pag.itens.map((p) => {
                const d = getDraft(p);
                const dirty = sujo(p);
                const precoN = lerNumero(d.preco);
                const preco = Number.isFinite(precoN) ? precoN : p.preco;
                const mg = margemPct(p.custo, preco);
                return (
                  <tr key={p.id} className={cn("hover:bg-slate-50/70", dirty && "bg-amber-50/80")}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={sel.has(p.id)}
                        onChange={() => {
                          const n = new Set(sel);
                          if (n.has(p.id)) n.delete(p.id);
                          else n.add(p.id);
                          setSel(n);
                        }}
                        className="accent-sky-600"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{p.sku}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-800">{p.nome}</p>
                      <p className="text-[11px] text-slate-400">{p.categoria}{p.marca ? ` · ${p.marca}` : ""}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-slate-600">{brl(p.custo)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        inputMode="decimal"
                        value={d.markup}
                        onChange={(e) => setCampo(p, "markup", e.target.value.replace(/[^\d.,-]/g, ""), "markup")}
                        className={cn(inputFiltro, "w-20 text-right", dirty && "border-amber-400 bg-amber-50")}
                        aria-label={`Markup ${p.nome}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        inputMode="decimal"
                        value={d.preco}
                        onChange={(e) => setCampo(p, "preco", e.target.value.replace(/[^\d.,-]/g, ""), "preco")}
                        className={cn(inputFiltro, "w-24 text-right font-semibold", dirty && "border-amber-400 bg-amber-50")}
                        aria-label={`Preço ${p.nome}`}
                      />
                    </td>
                    <td className={cn("px-3 py-2 text-right text-xs font-bold", mg < 0 ? "text-rose-600" : "text-emerald-700")}>
                      {mg}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        inputMode="decimal"
                        value={d.estoque}
                        onChange={(e) => setCampo(p, "estoque", e.target.value.replace(/[^\d.,-]/g, ""), "estoque")}
                        className={cn(inputFiltro, "w-16 text-center", dirty && "border-amber-400 bg-amber-50")}
                        aria-label={`Estoque ${p.nome}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {dirty && (
                        <button
                          type="button"
                          onClick={() => alterar([p.id])}
                          className="text-xs font-semibold text-emerald-700 hover:underline"
                        >
                          Salvar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">Nenhum produto no filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao {...pag} />
      </Card>

      {idsSujos.length > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto mt-4 flex max-w-xl items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-semibold text-amber-900">{idsSujos.length} alteração(ões) pendente(s)</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft({});
                setMsg(null);
              }}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white"
            >
              Descartar
            </button>
            <Button onClick={() => alterar(idsSujos)}>Salvar tudo</Button>
          </div>
        </div>
      )}
    </div>
  );
}
