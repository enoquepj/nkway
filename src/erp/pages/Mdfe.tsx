import { useState } from "react";
import { useStore } from "../store";
import { usePlan } from "../plan";
import { brl, formatChave, type MDFe } from "../types";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const vazio = {
  serie: "1",
  ufInicio: "SP",
  ufFim: "SP",
  municipioCarregamento: "",
  municipioDescarregamento: "",
  placa: "",
  ufVeiculo: "SP",
  rntrc: "",
  condutor: "",
  cpfCondutor: "",
  pesoBruto: 0,
};

export default function Mdfe() {
  const { db, emitirMdfe, encerrarMdfe } = useStore();
  const { podeUsar } = usePlan();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(vazio);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [ver, setVer] = useState<MDFe | null>(null);

  // Só NF-e modelo 55 entram no manifesto (NFC-e não é transportada)
  const notas = db.vendas.filter((v) => v.fiscal?.modelo === "NF-e" && v.status === "faturado");
  const docs = notas.filter((n) => selecionadas.includes(n.id));
  const valorCarga = docs.reduce((s, d) => s + d.total, 0);

  const abertos = db.mdfes.filter((m) => m.status === "autorizado");

  function emitir() {
    if (docs.length === 0) return;
    emitirMdfe({
      ...f,
      documentos: docs.map((d) => ({
        chave: d.fiscal!.chave,
        tipo: "NF-e" as const,
        valor: d.total,
      })),
      valorCarga,
    });
    setF(vazio);
    setSelecionadas([]);
    setOpen(false);
  }

  return (
    <div>
      <PageHeader
        title="MDF-e — Manifesto de Documentos Fiscais"
        subtitle="Obrigatório para transporte de carga própria entre municípios/estados"
        action={
          <Button onClick={() => setOpen(true)} >+ Emitir MDF-e</Button>
        }
      />

      {!podeUsar("fiscal") && (
        <div className="mb-5 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠️ A emissão de MDF-e faz parte do plano <b>Pro</b>. No Grátis você pode
          montar o manifesto, mas não transmitir à SEFAZ.
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Manifestos emitidos</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{db.mdfes.length}</p>
        </Card>
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">Em trânsito (a encerrar)</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{abertos.length}</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor transportado</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">
            {brl(db.mdfes.reduce((s, m) => s + m.valorCarga, 0))}
          </p>
        </Card>
      </div>

      {abertos.length > 0 && (
        <div className="mb-5 rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-800">
          🚚 Você tem <b>{abertos.length}</b> manifesto(s) em aberto. O MDF-e deve ser
          <b> encerrado</b> ao fim do percurso, senão bloqueia novas emissões.
        </div>
      )}

      {db.mdfes.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          Nenhum MDF-e emitido. Emita um manifesto ao transportar mercadoria própria.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">MDF-e</th>
                  <th className="px-4 py-3">Percurso</th>
                  <th className="px-4 py-3">Veículo / Condutor</th>
                  <th className="px-4 py-3 text-center">Docs</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Carga</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.mdfes.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-sky-700">
                        Nº {String(m.numero).padStart(6, "0")}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Série {m.serie} · {new Date(m.emitidoEm).toLocaleDateString("pt-BR")}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.ufInicio} → {m.ufFim}
                      <p className="text-[10px] text-slate-400">
                        {m.municipioCarregamento} → {m.municipioDescarregamento}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {m.placa}
                      <p className="text-[10px] text-slate-400">{m.condutor}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-slate-700">{m.documentos.length}</td>
                    <td className="px-4 py-3">
                      {m.status === "encerrado" ? (
                        <Badge tone="slate">Encerrado</Badge>
                      ) : m.status === "cancelado" ? (
                        <Badge tone="red">Cancelado</Badge>
                      ) : (
                        <Badge tone="green">Autorizado</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {brl(m.valorCarga)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => setVer(m)} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">
                        DAMDFE
                      </button>
                      {m.status === "autorizado" && (
                        <button
                          onClick={() => encerrarMdfe(m.id)}
                          className="text-xs font-semibold text-emerald-600 hover:underline"
                        >
                          Encerrar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Emissão */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <div className="my-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Emitir MDF-e</h3>
            <p className="text-sm text-slate-500">
              Selecione as NF-e transportadas e informe veículo e percurso.
            </p>

            <p className="mt-4 mb-2 text-xs font-bold uppercase text-slate-500">Percurso</p>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">UF início</span>
                <select value={f.ufInicio} onChange={(e) => setF({ ...f, ufInicio: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {UFS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
              <Field label="Município carregamento" className="sm:col-span-3" value={f.municipioCarregamento} onChange={(e) => setF({ ...f, municipioCarregamento: e.target.value })} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">UF fim</span>
                <select value={f.ufFim} onChange={(e) => setF({ ...f, ufFim: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {UFS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
              <Field label="Município descarregamento" className="sm:col-span-3" value={f.municipioDescarregamento} onChange={(e) => setF({ ...f, municipioDescarregamento: e.target.value })} />
            </div>

            <p className="mt-4 mb-2 text-xs font-bold uppercase text-slate-500">Veículo e condutor</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Placa" placeholder="ABC1D23" value={f.placa} onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() })} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">UF veículo</span>
                <select value={f.ufVeiculo} onChange={(e) => setF({ ...f, ufVeiculo: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                  {UFS.map((u) => <option key={u}>{u}</option>)}
                </select>
              </label>
              <Field label="RNTRC" value={f.rntrc} onChange={(e) => setF({ ...f, rntrc: e.target.value })} />
              <Field label="Condutor" className="sm:col-span-2" value={f.condutor} onChange={(e) => setF({ ...f, condutor: e.target.value })} />
              <Field label="CPF do condutor" value={f.cpfCondutor} onChange={(e) => setF({ ...f, cpfCondutor: e.target.value })} />
              <Field label="Peso bruto (kg)" type="number" value={f.pesoBruto} onChange={(e) => setF({ ...f, pesoBruto: Number(e.target.value) })} />
            </div>

            <p className="mt-4 mb-2 text-xs font-bold uppercase text-slate-500">
              Documentos transportados ({selecionadas.length})
            </p>
            {notas.length === 0 ? (
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                Nenhuma NF-e disponível. Emita uma venda com modelo <b>NF-e</b> no PDV
                (NFC-e não entra em manifesto).
              </p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-auto rounded-lg border border-slate-200 p-2">
                {notas.map((n) => (
                  <label key={n.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={selecionadas.includes(n.id)}
                      onChange={(e) =>
                        setSelecionadas((p) =>
                          e.target.checked ? [...p, n.id] : p.filter((x) => x !== n.id),
                        )
                      }
                      className="accent-sky-600"
                    />
                    <span className="flex-1 truncate text-slate-700">
                      NF-e #{n.numero} · {n.clienteNome}
                    </span>
                    <span className="font-semibold text-slate-900">{brl(n.total)}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 p-3">
              <span className="text-sm text-slate-500">Valor total da carga</span>
              <span className="text-xl font-bold text-slate-900">{brl(valorCarga)}</span>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={emitir}>
                Transmitir MDF-e
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* DAMDFE */}
      {ver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/60 p-4" onClick={() => setVer(null)}>
          <div className="my-auto w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b-2 border-slate-900 pb-2 text-center">
              <p className="text-sm font-black uppercase">DAMDFE</p>
              <p className="text-[10px] text-slate-500">
                Documento Auxiliar do Manifesto Eletrônico de Documentos Fiscais
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-dashed border-slate-300 py-3 text-[11px] text-slate-600">
              <span>Nº <b className="text-slate-900">{String(ver.numero).padStart(6, "0")}</b></span>
              <span className="text-right">Série {ver.serie}</span>
              <span className="col-span-2">Emissão: {new Date(ver.emitidoEm).toLocaleString("pt-BR")}</span>
              <span>Início: <b>{ver.ufInicio}</b> {ver.municipioCarregamento}</span>
              <span>Fim: <b>{ver.ufFim}</b> {ver.municipioDescarregamento}</span>
              <span>Placa: <b>{ver.placa}</b> ({ver.ufVeiculo})</span>
              <span>RNTRC: {ver.rntrc || "—"}</span>
              <span className="col-span-2">Condutor: {ver.condutor} · CPF {ver.cpfCondutor}</span>
              <span>Peso bruto: {ver.pesoBruto} kg</span>
              <span className="text-right">Carga: <b>{brl(ver.valorCarga)}</b></span>
            </div>

            <p className="py-2 text-[10px] font-bold uppercase text-slate-500">
              Documentos vinculados ({ver.documentos.length})
            </p>
            <ul className="max-h-32 space-y-1 overflow-auto">
              {ver.documentos.map((d, i) => (
                <li key={i} className="flex justify-between gap-2 text-[9px]">
                  <span className="truncate font-mono text-slate-600">{d.chave}</span>
                  <span className="shrink-0 font-semibold">{brl(d.valor)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 border-t border-dashed border-slate-300 pt-3 text-center">
              <p className="break-all font-mono text-[9px] text-slate-700">
                {formatChave(ver.chave)}
              </p>
              <p className={cn("mt-2 text-[10px] font-semibold", ver.status === "encerrado" ? "text-slate-500" : "text-emerald-700")}>
                {ver.status === "encerrado" ? "● Manifesto encerrado" : "✓ Autorizado o uso do MDF-e"}
              </p>
              <p className="text-[9px] text-slate-500">Protocolo {ver.protocolo}</p>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => window.print()}>🖨 Imprimir</Button>
              <Button className="flex-1" onClick={() => setVer(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
