import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, uid, type Fornecedor } from "../types";
import { consultarCnpj, formatDoc, tipoDocumento, validarCnpj } from "../receita";
import { Badge, Button, Card, Field, PageHeader } from "../ui";

const vazio: Omit<Fornecedor, "id"> = {
  nome: "", cnpj: "", uf: "", telefone: "", email: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "",
  cidade: "", codMunicipio: "", indIe: "1", ie: "", prazoPagDias: 30,
};

const hoje = new Date().toISOString().slice(0, 10);

export default function Fornecedores() {
  const { db, addFornecedor, updFornecedor, delFornecedor } = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<(typeof vazio) & { id?: string }>(vazio);
  const [consultando, setConsultando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const uso = useMemo(() => {
    const map = new Map<string, { aberto: number; vencido: number }>();
    db.lancamentos
      .filter((l) => l.tipo === "pagar" && !l.pago)
      .forEach((l) => {
        const forn = db.fornecedores.find((x) => l.descricao.includes(x.nome.split(" ")[0]));
        if (!forn) return;
        const cur = map.get(forn.id) ?? { aberto: 0, vencido: 0 };
        cur.aberto += l.valor;
        if (l.vencimento < hoje) cur.vencido += l.valor;
        map.set(forn.id, cur);
      });
    return map;
  }, [db]);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nome.trim()) return;
    const n = f.cnpj.replace(/\D/g, "");
    if (n.length === 14 && !validarCnpj(n)) return alert("CNPJ inválido — DV não confere.");
    if (f.id) updFornecedor({ ...(f as Fornecedor), cnpj: formatDoc(f.cnpj) });
    else addFornecedor({ ...f, id: uid(), cnpj: formatDoc(f.cnpj) });
    setF(vazio);
    setOpen(false);
  }

  async function consultar() {
    if (tipoDocumento(f.cnpj) !== "cnpj") return setMsg("Informe um CNPJ válido (14 dígitos).");
    setConsultando(true);
    setMsg(null);
    const r = await consultarCnpj(f.cnpj);
    setConsultando(false);
    if (!r.ok) return setMsg(`⚠️ ${r.erro}`);
    setF((p) => ({
      ...p,
      nome: r.dados.razaoSocial || r.dados.nomeFantasia || p.nome,
      cep: r.dados.cep, logradouro: r.dados.logradouro, numero: r.dados.numero || "S/N",
      complemento: r.dados.complemento, bairro: r.dados.bairro, cidade: r.dados.municipio,
      uf: r.dados.uf, codMunicipio: r.dados.codMunicipio,
      telefone: r.dados.telefone || p.telefone, email: r.dados.email || p.email,
    }));
    setMsg("✓ Dados da Receita/IBGE preenchidos. Revise antes de salvar.");
  }

  const endOk = !!(f.cep && f.logradouro && f.bairro && f.cidade && f.uf && f.codMunicipio);

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle={`${db.fornecedores.length} cadastrados · devoluções fiscais e contas a pagar integradas`}
        action={<Button onClick={() => { setF(vazio); setOpen(true); }}>+ Novo fornecedor</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {db.fornecedores.map((forn) => {
          const u = uso.get(forn.id) ?? { aberto: 0, vencido: 0 };
          const sefazOk = !!(forn.cep && forn.logradouro && forn.cidade && forn.codMunicipio);
          const notas = db.entradas.filter((e) => e.fornecedor.includes(forn.nome.split(" ")[0]));
          const devols = db.devolucoes.filter((d) => d.cnpjFornecedor === forn.cnpj);

          return (
            <Card key={forn.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-700">
                  {forn.nome.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{forn.nome}</p>
                  <p className="text-xs text-slate-500">{forn.cnpj}</p>
                </div>
                <button onClick={() => delFornecedor(forn.id)} className="text-slate-300 hover:text-rose-500">✕</button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {sefazOk ? (
                  <Badge tone="green">✓ OK p/ NF-e devolução</Badge>
                ) : (
                  <Badge tone="red">⚠ Endereço SEFAZ incompleto</Badge>
                )}
                <Badge tone="sky">prazo {forn.prazoPagDias ?? 30}d</Badge>
              </div>

              <dl className="mt-3 space-y-1 text-sm text-slate-600">
                <div className="flex gap-2"><dt>📞</dt><dd>{forn.telefone || "—"}</dd></div>
                <div className="flex gap-2"><dt>📍</dt><dd className="text-xs leading-tight">
                  {forn.logradouro
                    ? `${forn.logradouro}, ${forn.numero} — ${forn.bairro}, ${forn.cidade}/${forn.uf}`
                    : `${forn.cidade || "—"}/${forn.uf}`}
                </dd></div>
              </dl>

              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">A pagar em aberto</span>
                  <span className="font-bold text-slate-900">{brl(u.aberto)}</span>
                </div>
                {u.vencido > 0 && (
                  <div className="mt-0.5 flex justify-between font-bold text-rose-600">
                    <span>vencido</span><span>{brl(u.vencido)}</span>
                  </div>
                )}
                <div className="mt-1.5 flex justify-between border-t border-slate-200 pt-1.5 text-slate-500">
                  <span>{notas.length} notas · {devols.length} devoluções ({brl(devols.reduce((s, d) => s + d.total, 0))})</span>
                </div>
              </div>

              <div className="mt-3 flex justify-end gap-3">
                <button onClick={() => { setF({ ...forn }); setOpen(true); }} className="text-xs font-semibold text-sky-600 hover:underline">
                  Editar
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="my-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{f.id ? "Editar fornecedor" : "Novo fornecedor"}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">✕</button>
            </div>

            <div className="overflow-y-auto pr-1">
              <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
                <div className="flex gap-2">
                  <Field label="CNPJ" className="flex-1" value={f.cnpj} onChange={(e) => { setF({ ...f, cnpj: e.target.value }); setMsg(null); }} placeholder="14 dígitos" />
                  <Button variant="soft" className="mt-5 whitespace-nowrap" onClick={consultar}>
                    {consultando ? "Consultando..." : "🔍 Consultar Receita"}
                  </Button>
                </div>
                {f.cnpj && tipoDocumento(f.cnpj) === "cnpj" && (
                  <p className={`mt-2 text-[11px] font-medium ${validarCnpj(f.cnpj) ? "text-emerald-700" : "text-rose-600"}`}>
                    {validarCnpj(f.cnpj) ? "↳ ✓ CNPJ válido (DV confere)" : "↳ ✕ CNPJ inválido"}
                  </p>
                )}
                {msg && (
                  <p className={`mt-2 rounded px-2 py-1 text-[11px] font-medium ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {msg}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Razão social" className="sm:col-span-2" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
                <Field label="Telefone" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
                <Field label="E-mail p/ NF-e" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </div>

              <h4 className="mb-2 mt-5 flex items-center justify-between text-xs font-bold uppercase text-slate-500">
                <span>Endereço (necessário para devolução fiscal)</span>
                {!endOk && <span className="rounded bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">incompleto</span>}
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="CEP" value={f.cep ?? ""} onChange={(e) => setF({ ...f, cep: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
                <Field label="Logradouro" className="sm:col-span-2" value={f.logradouro ?? ""} onChange={(e) => setF({ ...f, logradouro: e.target.value })} />
                <Field label="Número" value={f.numero ?? ""} onChange={(e) => setF({ ...f, numero: e.target.value })} />
                <Field label="Complemento" value={f.complemento ?? ""} onChange={(e) => setF({ ...f, complemento: e.target.value })} />
                <Field label="Bairro" value={f.bairro ?? ""} onChange={(e) => setF({ ...f, bairro: e.target.value })} />
                <Field label="Município" value={f.cidade ?? ""} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
                <Field label="UF" value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase().slice(0, 2) })} />
                <Field label="Cód. IBGE" value={f.codMunicipio ?? ""} onChange={(e) => setF({ ...f, codMunicipio: e.target.value.replace(/\D/g, "").slice(0, 7) })} />
              </div>

              <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-slate-500">Fiscal e comercial</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Indicador IE</span>
                  <select value={f.indIe} onChange={(e) => setF({ ...f, indIe: e.target.value as Fornecedor["indIe"] })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="1">1 — Contribuinte</option>
                    <option value="2">2 — Isento</option>
                    <option value="9">9 — Não contribuinte</option>
                  </select>
                </label>
                {f.indIe === "1" && (
                  <Field label="Inscrição estadual" value={f.ie ?? ""} onChange={(e) => setF({ ...f, ie: e.target.value })} />
                )}
                <Field label="Prazo padrão (dias)" type="number" value={f.prazoPagDias ?? 30} onChange={(e) => setF({ ...f, prazoPagDias: Number(e.target.value) })} />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar fornecedor</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
