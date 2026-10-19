import { Fragment, useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { usePlan } from "../plan";
import { brl, type ModeloFiscal, type Venda } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import Documento from "../Documento";
import { cn } from "../../utils/cn";

const MODELOS: ModeloFiscal[] = ["NFC-e", "NF-e", "SAT"];

export default function Vendas({ abaInicial = "dav" }: { abaInicial?: "dav" | "fiscal" }) {
  const { db, faturarDav, cancelarVenda } = useStore();
  const { conta } = useAuth();
  const { podeUsar } = usePlan();
  const [aba, setAba] = useState<"dav" | "fiscal">(abaInicial);
  const [aberta, setAberta] = useState<string | null>(null);
  const [verDoc, setVerDoc] = useState<Venda | null>(null);
  const [faturar, setFaturar] = useState<Venda | null>(null);
  const [modelo, setModelo] = useState<ModeloFiscal>("NFC-e");
  const [pag, setPag] = useState<Venda["pagamento"]>("pix");
  const [cancelando, setCancelando] = useState<Venda | null>(null);
  const [motivo, setMotivo] = useState("");

  const davs = db.vendas.filter((v) => v.tipo === "dav");
  const fiscais = db.vendas.filter((v) => v.tipo === "fiscal");
  const lista = aba === "dav" ? davs : fiscais;

  const totalFiscal = fiscais.reduce((s, v) => s + v.total, 0);
  const totalDavAberto = davs.filter((d) => d.status === "aberto").reduce((s, v) => s + v.total, 0);

  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Documentos de venda"
        subtitle={`${davs.length} DAVs · ${fiscais.length} notas emitidas · ${brl(totalFiscal)} faturado`}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">DAVs em aberto</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{brl(totalDavAberto)}</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Faturado com nota</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{brl(totalFiscal)}</p>
        </Card>
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Notas autorizadas</p>
          <p className="mt-1 text-xl font-bold text-sky-700">{fiscais.length}</p>
        </Card>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {([
          ["dav", `📄 DAVs (${davs.length})`],
          ["fiscal", `🧾 Notas fiscais (${fiscais.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "flex-1 rounded-md px-5 py-2 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {lista.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          {aba === "dav"
            ? "Nenhum DAV gerado. Use o PDV no modo DAV para criar orçamentos e pedidos."
            : "Nenhuma nota emitida. Use o PDV no modo Venda Fiscal."}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">{aba === "dav" ? "Validade" : "Chave / Protocolo"}</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lista.map((v) => {
                  const vencido = v.tipo === "dav" && v.status === "aberto" && (v.validade ?? "") < hoje;
                  return (
                    <Fragment key={v.id}>
                      <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => setAberta(aberta === v.id ? null : v.id)}>
                        <td className="px-4 py-3 font-semibold text-sky-700">
                          {v.tipo === "dav" ? "DAV" : v.fiscal?.modelo} #{v.numero}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{v.clienteNome}</td>
                        <td className="px-4 py-3 text-slate-500">
                          {new Date(v.data).toLocaleDateString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {v.tipo === "dav"
                            ? v.validade
                              ? new Date(v.validade + "T12:00").toLocaleDateString("pt-BR")
                              : "—"
                            : `...${v.fiscal?.chave.slice(-12)}`}
                        </td>
                        <td className="px-4 py-3">
                          {v.status === "cancelado" ? (
                            <Badge tone="red">Cancelado</Badge>
                          ) : v.status === "faturado" ? (
                            <Badge tone="green">
                              {v.tipo === "fiscal" ? "Autorizada" : "Faturado"}
                            </Badge>
                          ) : vencido ? (
                            <Badge tone="red">Vencido</Badge>
                          ) : (
                            <Badge tone="amber">Em aberto</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-900">{brl(v.total)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); setVerDoc(v); }}
                            className="mr-3 text-xs font-semibold text-sky-600 hover:underline"
                          >
                            Ver
                          </button>
                          {v.tipo === "dav" && v.status === "aberto" && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPag(v.pagamento); setFaturar(v); }}
                                className="mr-3 text-xs font-semibold text-emerald-600 hover:underline"
                              >
                                Faturar
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); cancelarVenda(v.id); }}
                                className="text-xs font-semibold text-rose-500 hover:underline"
                              >
                                Cancelar
                              </button>
                            </>
                          )}
                          {v.tipo === "fiscal" && v.status === "faturado" && (() => {
                            const limiteMin = db.configFiscal.ambiente === 2 ? 24 * 60 : 30;
                            const minutos = Math.floor((Date.now() - (v.fiscal?.autorizadaEm ?? v.data)) / 60000);
                            const dentro = minutos < limiteMin;
                            return (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setCancelando(v); setMotivo("Venda efetuada por erro"); }}
                                  disabled={!dentro}
                                  className={cn(
                                    "mr-3 text-xs font-semibold",
                                    dentro
                                      ? "text-rose-500 hover:underline"
                                      : "text-slate-300 cursor-not-allowed",
                                  )}
                                >
                                  Cancelar{!dentro && ` (${Math.floor(minutos/60)}h)`}
                                </button>
                                {!dentro && (
                                  <span className="text-[10px] text-slate-300" title="Prazo SEFAZ para cancelamento expirado">expirado</span>
                                )}
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                      {aberta === v.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={7} className="px-8 py-3">
                            <ul className="space-y-1 text-xs text-slate-600">
                              {v.itens.map((i) => (
                                <li key={i.produtoId} className="flex justify-between">
                                  <span>{i.qtd}x {i.nome}</span>
                                  <span>{brl(i.qtd * i.preco)}</span>
                                </li>
                              ))}
                              {v.desconto > 0 && (
                                <li className="flex justify-between text-rose-600">
                                  <span>Desconto</span><span>- {brl(v.desconto)}</span>
                                </li>
                              )}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {verDoc && (
        <Documento
          venda={verDoc}
          empresa={conta?.empresa ?? "Minha Empresa"}
          cnpj={conta?.cnpj ?? ""}
          onClose={() => setVerDoc(null)}
        />
      )}

      {faturar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setFaturar(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Faturar DAV #{faturar.numero}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Isso emite o documento fiscal, baixa o estoque e lança no financeiro.
            </p>

            <div className="my-4 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{faturar.clienteNome}</span>
                <span>{faturar.itens.length} itens</span>
              </div>
              <div className="mt-1 flex justify-between text-lg font-bold text-slate-900">
                <span>Total</span><span>{brl(faturar.total)}</span>
              </div>
            </div>

            {!podeUsar("fiscal") ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                ⚠️ Emissão fiscal disponível no plano Pro. Assine para faturar com nota.
              </p>
            ) : (
              <>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Modelo fiscal</p>
                <div className="mb-3 flex gap-1.5">
                  {MODELOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setModelo(m)}
                      className={cn(
                        "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                        modelo === m ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Forma de pagamento</p>
                <div className="flex flex-wrap gap-1.5">
                  {(["dinheiro", "pix", "debito", "credito", "boleto", "prazo"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPag(p)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
                        pag === p ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {p === "prazo" ? "a prazo" : p}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setFaturar(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!podeUsar("fiscal")) return setFaturar(null);
                  faturarDav(faturar.id, { modelo, pagamento: pag });
                  setFaturar(null);
                }}
              >
                {podeUsar("fiscal") ? `Emitir ${modelo}` : "Ver planos ⭐"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cancelamento fiscal */}
      {cancelando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setCancelando(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-xl">
                ⚠️
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cancelar {cancelando.fiscal?.modelo} #{cancelando.numero}
                </h3>
                <p className="text-xs text-slate-500">
                  Cancelamento registra um evento de cancelamento junto à SEFAZ e
                  devolve o estoque dos itens.
                </p>
              </div>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{cancelando.clienteNome}</span>
                <span>{cancelando.itens.length} itens</span>
              </div>
              <div className="mt-1 flex justify-between text-lg font-bold text-slate-900">
                <span>Total da nota</span>
                <span className="text-rose-600">{brl(cancelando.total)}</span>
              </div>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Justificativa do cancelamento (obrigatória)
              </span>
              <textarea
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: Venda efetuada por erro no atendimento"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Atenção:</strong> A SEFAZ permite cancelar uma nota em até 30 minutos em produção
              (24h em homologação). O cancelamento baixa o estoque, estorna o financeiro e
              registra protocolo de cancelamento. Não é possível desfazer.
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  if (!motivo.trim()) return alert("Informe a justificativa.");
                  cancelarVenda(cancelando.id, motivo);
                  setCancelando(null);
                  setMotivo("");
                }}
              >
                Confirmar cancelamento fiscal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
