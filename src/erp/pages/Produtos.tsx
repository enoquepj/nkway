import { useState } from "react";
import { useStore } from "../store";
import { brl, type Produto } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import Barcode from "../Barcode";
import { UNIDADES, gerarGtin, validarGtin } from "../types";
import { usePlan } from "../plan";

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

export default function Produtos() {
  const { db, addProduto, updProduto, delProduto } = useStore();
  const [form, setForm] = useState<typeof vazio & { id?: string }>(vazio);
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [bloqueio, setBloqueio] = useState(false);
  const [etiqueta, setEtiqueta] = useState<Produto | null>(null);
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
                <th className="px-4 py-3">Fiscal</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((p) => {
                const fiscalOk = !!p.impostos?.ncm && !!p.impostos?.cfop && (p.gtin === "" || validarGtin(p.gtin));
                return (
                <tr key={p.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{p.nome}</p>
                    <p className="text-xs text-slate-400">
                      {p.sku} · {p.marca || "s/ marca"} · {p.unidade || "UN"}
                    </p>
                    {p.gtin && <p className="font-mono text-[10px] text-slate-400">{p.gtin}</p>}
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
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => { setForm(p); setOpen(true); }} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">
                      Editar
                    </button>
                    <button onClick={() => delProduto(p.id)} className="text-xs font-semibold text-rose-500 hover:underline">
                      Excluir
                    </button>
                  </td>
                </tr>
                );
              })}
              {lista.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-slate-400">Nenhum produto encontrado.</td></tr>
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
