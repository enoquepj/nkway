import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, type TipoMov } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

const ROTULO: Record<TipoMov, { label: string; tone: "green" | "red" | "amber" | "sky" | "slate" }> = {
  entrada: { label: "Entrada NF-e", tone: "green" },
  venda: { label: "Venda", tone: "sky" },
  ajuste: { label: "Ajuste", tone: "amber" },
  perda: { label: "Perda/Quebra", tone: "red" },
  devolucao: { label: "Devolução", tone: "green" },
  inventario: { label: "Inventário", tone: "slate" },
  transferencia: { label: "Transferência", tone: "slate" },
};

export default function Estoque() {
  const { db, ajustarEstoque } = useStore();
  const [aba, setAba] = useState<"posicao" | "kardex">("posicao");
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoMov | "todos">("todos");
  const [ajuste, setAjuste] = useState<{ id: string; nome: string; atual: number } | null>(null);
  const [nova, setNova] = useState(0);
  const [tipoAj, setTipoAj] = useState<TipoMov>("inventario");
  const [obs, setObs] = useState("");

  const produtos = db.produtos.filter((p) =>
    (p.nome + p.sku + p.categoria).toLowerCase().includes(busca.toLowerCase()),
  );

  const movs = db.movimentos.filter(
    (m) =>
      (filtroTipo === "todos" || m.tipo === filtroTipo) &&
      m.produtoNome.toLowerCase().includes(busca.toLowerCase()),
  );

  const resumo = useMemo(() => {
    const valorCusto = db.produtos.reduce((s, p) => s + p.custo * p.estoque, 0);
    const valorVenda = db.produtos.reduce((s, p) => s + p.preco * p.estoque, 0);
    const unidades = db.produtos.reduce((s, p) => s + p.estoque, 0);
    const criticos = db.produtos.filter((p) => p.estoque <= p.estoqueMin).length;
    const zerados = db.produtos.filter((p) => p.estoque === 0).length;
    return { valorCusto, valorVenda, unidades, criticos, zerados };
  }, [db.produtos]);

  return (
    <div>
      <PageHeader
        title="Gestão de estoque"
        subtitle="Posição atual, kardex de movimentações e inventário"
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor a custo</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{brl(resumo.valorCusto)}</p>
          <p className="text-[11px] text-slate-400">{resumo.unidades} unidades</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor a venda</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{brl(resumo.valorVenda)}</p>
          <p className="text-[11px] text-slate-400">
            Lucro potencial {brl(resumo.valorVenda - resumo.valorCusto)}
          </p>
        </Card>
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">Abaixo do mínimo</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{resumo.criticos}</p>
        </Card>
        <Card className="border-l-4 border-l-rose-500 p-4">
          <p className="text-xs uppercase text-slate-500">Sem estoque</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{resumo.zerados}</p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1">
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
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto..."
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm outline-none focus:border-sky-500 sm:max-w-xs"
        />
        {aba === "kardex" && (
          <select
            value={filtroTipo}
            onChange={(e) => setFiltroTipo(e.target.value as TipoMov | "todos")}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          >
            <option value="todos">Todos os tipos</option>
            {Object.entries(ROTULO).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        )}
      </div>

      {aba === "posicao" ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3 text-center">Saldo</th>
                  <th className="px-4 py-3 text-center">Mínimo</th>
                  <th className="px-4 py-3 text-right">Custo médio</th>
                  <th className="px-4 py-3 text-right">Total a custo</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {produtos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{p.nome}</p>
                      <p className="text-xs text-slate-400">{p.sku} · {p.categoria}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-slate-900">{p.estoque}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{p.estoqueMin}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{brl(p.custo)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {brl(p.custo * p.estoque)}
                    </td>
                    <td className="px-4 py-3">
                      {p.estoque === 0 ? (
                        <Badge tone="red">Sem estoque</Badge>
                      ) : p.estoque <= p.estoqueMin ? (
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {movs.length === 0 ? (
            <p className="py-12 text-center text-slate-400">
              Nenhuma movimentação registrada ainda.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Data</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3 text-center">Qtd</th>
                    <th className="px-4 py-3 text-center">Saldo</th>
                    <th className="px-4 py-3 text-right">Custo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movs.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(m.data).toLocaleString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{m.produtoNome}</td>
                      <td className="px-4 py-3">
                        <Badge tone={ROTULO[m.tipo].tone}>{ROTULO[m.tipo].label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {m.documento}
                        {m.observacao && <span className="text-slate-400"> · {m.observacao}</span>}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-center font-bold",
                          m.qtd > 0 ? "text-emerald-600" : "text-rose-600",
                        )}
                      >
                        {m.qtd > 0 ? "+" : ""}{m.qtd}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-900">{m.saldoApos}</td>
                      <td className="px-4 py-3 text-right text-slate-500">{brl(m.custoUnit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <Button variant="ghost" className="flex-1" onClick={() => setAjuste(null)}>
                Cancelar
              </Button>
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
