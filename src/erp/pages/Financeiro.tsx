import { useState } from "react";
import { useStore } from "../store";
import { brl, type Lancamento } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";

const hojeStr = new Date().toISOString().slice(0, 10);
const vazio = {
  descricao: "",
  valor: 0,
  tipo: "pagar" as Lancamento["tipo"],
  vencimento: hojeStr,
  pago: false,
  categoria: "Geral",
};

export default function Financeiro() {
  const { db, addLancamento, toggleLancamento, delLancamento } = useStore();
  const [form, setForm] = useState(vazio);
  const [open, setOpen] = useState(false);
  const [aba, setAba] = useState<"todos" | "receber" | "pagar">("todos");

  const lista = db.lancamentos
    .filter((l) => (aba === "todos" ? true : l.tipo === aba))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  const receber = db.lancamentos.filter((l) => l.tipo === "receber" && !l.pago).reduce((s, l) => s + l.valor, 0);
  const pagar = db.lancamentos.filter((l) => l.tipo === "pagar" && !l.pago).reduce((s, l) => s + l.valor, 0);
  const caixa = db.vendas.filter((v) => v.status === "faturado" && v.pagamento !== "boleto" && v.pagamento !== "prazo").reduce((s, v) => s + v.total, 0);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descricao.trim()) return;
    addLancamento(form);
    setForm(vazio);
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

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 sm:w-fit">
        {(["todos", "receber", "pagar"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`flex-1 rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition ${
              aba === a ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
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
            {lista.map((l) => {
              const atrasado = !l.pago && l.vencimento < hojeStr;
              return (
                <tr key={l.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <span className={`mr-2 ${l.tipo === "receber" ? "text-emerald-500" : "text-rose-500"}`}>
                      {l.tipo === "receber" ? "↓" : "↑"}
                    </span>
                    <span className="font-medium text-slate-800">{l.descricao}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{l.categoria}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(l.vencimento + "T12:00").toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">
                    {l.pago ? (
                      <Badge tone="green">{l.tipo === "receber" ? "Recebido" : "Pago"}</Badge>
                    ) : atrasado ? (
                      <Badge tone="red">Atrasado</Badge>
                    ) : (
                      <Badge tone="amber">Em aberto</Badge>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${l.tipo === "receber" ? "text-emerald-600" : "text-rose-600"}`}>
                    {brl(l.valor)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
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
            {lista.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-slate-400">Nenhum lançamento.</td></tr>
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
              <Field label="Categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} />
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
