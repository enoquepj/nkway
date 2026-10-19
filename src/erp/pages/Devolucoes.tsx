import { useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { brl, formatChave, type Entrada } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";

export default function Devolucoes() {
  const { db, devolverEntrada } = useStore();
  const { conta } = useAuth();
  const [fazer, setFazer] = useState<Entrada | null>(null);
  const [qtds, setQtds] = useState<Record<string, number>>({});
  const [ver, setVer] = useState<typeof db.devolucoes[number] | null>(null);
  const [aba, setAba] = useState<"nova" | "emitidas">("emitidas");

  const elegiveis = db.entradas.filter((e) => e.status === "lancada");

  function abrir(e: Entrada) {
    setFazer(e);
    setQtds(Object.fromEntries(e.itens.map((i) => [i.sku, 0])));
  }

  function emitir() {
    if (!fazer) return;
    const itens = fazer.itens
      .filter((i) => (qtds[i.sku] ?? 0) > 0)
      .map((i) => ({ ...i, qtd: Math.min(qtds[i.sku], i.qtd) }));
    if (itens.length === 0) return alert("Selecione ao menos um item para devolver.");
    devolverEntrada(fazer.id, itens);
    setFazer(null);
    setAba("emitidas");
  }

  const totalNova = fazer
    ? fazer.itens.reduce((s, i) => s + (qtds[i.sku] ?? 0) * i.custo, 0)
    : 0;

  return (
    <div>
      <PageHeader
        title="Devoluções de compra"
        subtitle="NF-e de devolução ao fornecedor (CFOP 5201/6201) com baixa de estoque e estorno automático"
        action={aba === "nova" ? undefined : <Button onClick={() => setAba("nova")}>+ Nova devolução</Button>}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-indigo-500 p-4">
          <p className="text-xs uppercase text-slate-500">Notas elegíveis</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{elegiveis.length}</p>
        </Card>
        <Card className="border-l-4 border-l-rose-500 p-4">
          <p className="text-xs uppercase text-slate-500">Devoluções emitidas</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{db.devolucoes.length}</p>
        </Card>
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">Total devolvido</p>
          <p className="mt-1 text-xl font-bold text-amber-600">
            {brl(db.devolucoes.reduce((s, d) => s + d.total, 0))}
          </p>
        </Card>
      </div>

      {aba === "nova" ? (
        elegiveis.length === 0 ? (
          <Card className="p-12 text-center text-slate-400">
            Nenhuma nota lançada disponível. Dê entrada no XML primeiro.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nota de entrada</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">Itens</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {elegiveis.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-semibold text-sky-700">NF-e {e.numeroNota}</td>
                    <td className="px-4 py-3 text-slate-700">{e.fornecedor}</td>
                    <td className="px-4 py-3 text-slate-500">{e.itens.length}</td>
                    <td className="px-4 py-3 text-right font-semibold">{brl(e.total)}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => abrir(e)} className="rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100">
                        ↩ Devolver itens
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      ) : db.devolucoes.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          Nenhuma devolução emitida ainda. Use "+ Nova devolução" acima.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Devolução</th>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3">Nota referenciada</th>
                <th className="px-4 py-3">CFOP</th>
                <th className="px-4 py-3">Estorno</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.devolucoes.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-sky-700">#{String(d.numero).padStart(4, "0")}</p>
                    <p className="text-[10px] text-slate-400">
                      {new Date(d.emitidoEm).toLocaleDateString("pt-BR")}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{d.fornecedor}</td>
                  <td className="px-4 py-3 font-mono text-[10px] text-slate-500">
                    ...{d.chaveReferente.slice(-12)}
                  </td>
                  <td className="px-4 py-3"><Badge tone="sky">{d.cfop}</Badge></td>
                  <td className="px-4 py-3">
                    {d.estorno === "estorno_pagar" ? (
                      <Badge tone="green">Estornou contas a pagar</Badge>
                    ) : (
                      <Badge tone="amber">Fornecedor deve devolver</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{brl(d.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setVer(d)} className="text-xs font-semibold text-sky-600 hover:underline">
                      DANFE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Modal: seleção de itens */}
      {fazer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4" onClick={() => setFazer(null)}>
          <div className="my-auto w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">
              Devolver NF-e {fazer.numeroNota} — {fazer.fornecedor}
            </h3>
            <p className="text-sm text-slate-500">
              Escolha quanto devolver de cada item. Estoque será baixado e o contas a pagar estornado.
            </p>

            <div className="mt-4 max-h-64 space-y-2 overflow-auto">
              {fazer.itens.map((i) => {
                const disp = i.qtd;
                const sel = qtds[i.sku] ?? 0;
                return (
                  <div key={i.sku} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{i.nome}</p>
                      <p className="text-xs text-slate-400">
                        {i.sku} · {brl(i.custo)} und · recebido {disp} {i.unidade}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setQtds({ ...qtds, [i.sku]: Math.max(0, sel - 1) })}
                        className="h-8 w-8 rounded-lg bg-slate-100 text-lg font-bold text-slate-600 hover:bg-slate-200"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={disp}
                        value={sel}
                        onChange={(e) =>
                          setQtds({ ...qtds, [i.sku]: Math.min(Math.max(0, Number(e.target.value)), disp) })}
                        className="w-16 rounded border border-slate-300 px-2 py-1.5 text-center text-sm"
                      />
                      <button
                        onClick={() => setQtds({ ...qtds, [i.sku]: Math.min(disp, sel + 1) })}
                        className="h-8 w-8 rounded-lg bg-slate-100 text-lg font-bold text-slate-600 hover:bg-slate-200"
                      >
                        +
                      </button>
                      <button
                        onClick={() => setQtds({ ...qtds, [i.sku]: disp })}
                        className="rounded-lg bg-indigo-50 px-2 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                      >
                        tudo
                      </button>
                    </div>
                    <span className="w-20 text-right text-sm font-semibold">
                      {brl(sel * i.custo)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-lg bg-rose-50 p-3">
              <span className="text-sm text-rose-700">Total da devolução</span>
              <span className="text-xl font-black text-rose-700">{brl(totalNova)}</span>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              A loja emitirá NF-e de devolução com CFOP 5201/6201 referenciando a chave {fazer.chave.slice(0, 20)}...
            </p>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setFazer(null)}>Cancelar</Button>
              <Button className="flex-1 bg-rose-600 hover:bg-rose-700" onClick={emitir}>
                ↩ Emitir NF-e de devolução
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* DANFE da devolução */}
      {ver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/60 p-4" onClick={() => setVer(null)}>
          <div className="my-auto w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b-2 border-slate-900 pb-2 text-center">
              <p className="text-sm font-black uppercase">NF-e de Devolução — DANFE</p>
              <p className="text-[10px] text-slate-500">
                Documento Auxiliar da Nota Fiscal Eletrônica (saída)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-dashed border-slate-300 py-3 text-[11px] text-slate-600">
              <span>Nº <b className="text-slate-900">{String(ver.numero).padStart(6, "0")}</b></span>
              <span className="text-right">Série 1 · CFOP {ver.cfop}</span>
              <span className="col-span-2">Emissão: {new Date(ver.emitidoEm).toLocaleString("pt-BR")}</span>
              <span className="col-span-2">Emitente: {conta?.empresa}</span>
              <span className="col-span-2">Destinatário: <b>{ver.fornecedor}</b> · {ver.cnpjFornecedor}</span>
              <span className="col-span-2 break-all font-mono text-[9px]">
                Referência (NFref): {ver.chaveReferente}
              </span>
            </div>

            <table className="w-full py-2 text-[11px]">
              <thead className="text-left text-slate-400">
                <tr><th className="py-1">Item</th><th className="text-center">Qtd</th><th className="text-right">Total</th></tr>
              </thead>
              <tbody>
                {ver.itens.map((i, k) => (
                  <tr key={k} className="text-slate-700">
                    <td className="py-1">{i.nome}</td>
                    <td className="text-center">{i.qtd} {i.unidade}</td>
                    <td className="text-right">{brl(i.qtd * i.custo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t-2 border-dashed border-slate-300 pt-3">
              <div className="flex justify-between text-lg font-black text-slate-900">
                <span>TOTAL DEVOLUÇÃO</span><span>{brl(ver.total)}</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                Estorno: {ver.estorno === "estorno_pagar" ? "baixado do contas a pagar" : "gerado título a receber"}
              </p>
            </div>

            <div className="mt-3 border-t border-dashed border-slate-300 pt-3 text-center">
              <p className="break-all font-mono text-[9px] text-slate-700">{formatChave(ver.chave)}</p>
              <p className="mt-2 text-[10px] font-semibold text-emerald-700">✓ Autorizado o uso da NF-e</p>
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
