import { useState } from "react";
import { useStore } from "../store";
import { brl } from "../types";
import { Button, Card, Field, PageHeader } from "../ui";

const vazio = { nome: "", documento: "", email: "", telefone: "", cidade: "" };

export default function Clientes() {
  const { db, addCliente, delCliente } = useStore();
  const [form, setForm] = useState(vazio);
  const [open, setOpen] = useState(false);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) return;
    addCliente(form);
    setForm(vazio);
    setOpen(false);
  }

  const totalCliente = (id: string) =>
    db.vendas.filter((v) => v.clienteId === id && v.status === "faturado").reduce((s, v) => s + v.total, 0);

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={`${db.clientes.length} cadastrados`}
        action={<Button onClick={() => setOpen(true)}>+ Novo cliente</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {db.clientes.map((c) => (
          <Card key={c.id} className="group p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                {c.nome.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{c.nome}</p>
                <p className="text-xs text-slate-400">{c.documento}</p>
              </div>
              <button
                onClick={() => delCliente(c.id)}
                className="text-slate-300 opacity-0 transition hover:text-rose-500 group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
            <dl className="mt-4 space-y-1.5 text-sm text-slate-600">
              <div className="flex gap-2"><dt>✉️</dt><dd className="truncate">{c.email || "—"}</dd></div>
              <div className="flex gap-2"><dt>📞</dt><dd>{c.telefone || "—"}</dd></div>
              <div className="flex gap-2"><dt>📍</dt><dd>{c.cidade || "—"}</dd></div>
            </dl>
            <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Total comprado:{" "}
              <span className="font-semibold text-slate-800">{brl(totalCliente(c.id))}</span>
            </div>
          </Card>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-bold text-slate-900">Novo cliente</h3>
            <div className="grid gap-3">
              <Field label="Nome / Razão social" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
              <Field label="CPF / CNPJ" value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />
              <Field label="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Field label="Telefone" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
              <Field label="Cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
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
