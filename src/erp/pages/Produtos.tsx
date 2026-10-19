import { useState } from "react";
import { useStore } from "../store";
import { brl, type Produto } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import { usePlan } from "../plan";

const vazio = {
  nome: "",
  sku: "",
  categoria: "",
  custo: 0,
  preco: 0,
  estoque: 0,
  estoqueMin: 0,
};

export default function Produtos() {
  const { db, addProduto, updProduto, delProduto } = useStore();
  const [form, setForm] = useState<typeof vazio & { id?: string }>(vazio);
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [bloqueio, setBloqueio] = useState(false);
  const { plano, dentroDoLimite } = usePlan();

  const lista = db.produtos.filter((p) =>
    (p.nome + p.sku + p.categoria).toLowerCase().includes(busca.toLowerCase()),
  );

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

  const margem = (p: Produto) =>
    p.preco > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Produtos"
        subtitle={`${db.produtos.length} itens cadastrados`}
        action={
          <Button onClick={() => { setForm(vazio); setOpen(true); }}>+ Novo produto</Button>
        }
      />

      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome, SKU ou categoria..."
        className="mb-4 w-full max-w-md rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Custo</th>
                <th className="px-4 py-3 text-right">Venda</th>
                <th className="px-4 py-3 text-right">Margem</th>
                <th className="px-4 py-3 text-center">Estoque</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{p.nome}</p>
                    <p className="text-xs text-slate-400">{p.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{p.categoria}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{brl(p.custo)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{brl(p.preco)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600">{margem(p)}%</td>
                  <td className="px-4 py-3 text-center">
                    <Badge tone={p.estoque === 0 ? "red" : p.estoque <= p.estoqueMin ? "amber" : "green"}>
                      {p.estoque} un
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setForm(p); setOpen(true); }} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => delProduto(p.id)} className="text-xs font-semibold text-rose-500 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={7} className="py-12 text-center text-slate-400">Nenhum produto encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">
              {form.id ? "Editar produto" : "Novo produto"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" className="sm:col-span-2" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <Field label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              <Field label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
              <Field label="Preço de custo" type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: Number(e.target.value) })} />
              <Field label="Preço de venda" type="number" step="0.01" value={form.preco} onChange={(e) => setForm({ ...form, preco: Number(e.target.value) })} />
              <Field label="Estoque atual" type="number" value={form.estoque} onChange={(e) => setForm({ ...form, estoque: Number(e.target.value) })} />
              <Field label="Estoque mínimo" type="number" value={form.estoqueMin} onChange={(e) => setForm({ ...form, estoqueMin: Number(e.target.value) })} />
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
