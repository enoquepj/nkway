import { Fragment, useRef, useState } from "react";
import { useStore } from "../store";
import { brl, uid, type Entrada } from "../types";
import { lerXmlNfe, XML_EXEMPLO } from "../xmlNfe";
import { Badge, Button, Card, PageHeader } from "../ui";

export default function Entradas() {
  const { db, addEntrada, lancarEntrada, delEntrada } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Entrada | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  function processar(conteudo: string) {
    const r = lerXmlNfe(conteudo);
    if (!r.ok) return setErro(r.erro);
    setErro(null);
    setPrevia(r.entrada);
  }

  function onFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => processar(String(reader.result));
    reader.readAsText(f, "ISO-8859-1");
  }

  const pendentes = db.entradas.filter((e) => e.status !== "lancada");
  const totalPendente = pendentes.reduce((s, e) => s + e.total, 0);

  return (
    <div>
      <PageHeader
        title="Entrada de mercadoria"
        subtitle="Importe o XML da NF-e do fornecedor e dê entrada no estoque automaticamente"
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => processar(XML_EXEMPLO)}>
              Usar XML de exemplo
            </Button>
            <Button onClick={() => fileRef.current?.click()}>⬆ Importar XML</Button>
          </div>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept=".xml,text/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      {/* Área de arrastar */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        className="mb-5 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-sky-400 hover:bg-sky-50/40"
      >
        <p className="text-3xl">📥</p>
        <p className="mt-2 text-sm font-semibold text-slate-700">
          Arraste aqui o XML da NF-e do fornecedor
        </p>
        <p className="text-xs text-slate-400">
          Lê automaticamente produtos, NCM, CFOP, quantidades e custos
        </p>
      </div>

      {erro && (
        <div className="mb-5 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          ⚠️ {erro}
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">Notas a conferir</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{pendentes.length}</p>
        </Card>
        <Card className="border-l-4 border-l-rose-500 p-4">
          <p className="text-xs uppercase text-slate-500">Valor pendente</p>
          <p className="mt-1 text-xl font-bold text-rose-600">{brl(totalPendente)}</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Notas lançadas</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">
            {db.entradas.filter((e) => e.status === "lancada").length}
          </p>
        </Card>
      </div>

      {db.entradas.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          Nenhuma nota de entrada. Importe um XML para começar.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nota</th>
                  <th className="px-4 py-3">Fornecedor</th>
                  <th className="px-4 py-3">Emissão</th>
                  <th className="px-4 py-3">Itens</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.entradas.map((e) => (
                  <Fragment key={e.id}>
                    <tr
                      className="cursor-pointer hover:bg-slate-50/70"
                      onClick={() => setAberta(aberta === e.id ? null : e.id)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-semibold text-sky-700">NF-e {e.numeroNota}</p>
                        <p className="text-[10px] text-slate-400">Série {e.serie} · {e.origem === "xml" ? "XML" : "manual"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{e.fornecedor}</p>
                        <p className="text-[10px] text-slate-400">{e.cnpjFornecedor}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(e.emissao + "T12:00").toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{e.itens.length}</td>
                      <td className="px-4 py-3">
                        {e.status === "lancada" ? (
                          <Badge tone="green">Lançada no estoque</Badge>
                        ) : (
                          <Badge tone="amber">Aguardando conferência</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {brl(e.total)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {e.status !== "lancada" && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); lancarEntrada(e.id); }}
                            className="mr-3 text-xs font-semibold text-emerald-600 hover:underline"
                          >
                            Lançar estoque
                          </button>
                        )}
                        <button
                          onClick={(ev) => { ev.stopPropagation(); delEntrada(e.id); }}
                          className="text-xs font-semibold text-rose-500 hover:underline"
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                    {aberta === e.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="px-8 py-3">
                          <table className="w-full text-xs">
                            <thead className="text-slate-400">
                              <tr>
                                <th className="py-1 text-left">Produto</th>
                                <th className="py-1 text-left">SKU</th>
                                <th className="py-1 text-left">NCM</th>
                                <th className="py-1 text-left">CFOP</th>
                                <th className="py-1 text-right">Qtd</th>
                                <th className="py-1 text-right">Custo</th>
                                <th className="py-1 text-right">Venda sug.</th>
                              </tr>
                            </thead>
                            <tbody className="text-slate-600">
                              {e.itens.map((i, k) => (
                                <tr key={k}>
                                  <td className="py-1">{i.nome}</td>
                                  <td className="py-1">{i.sku}</td>
                                  <td className="py-1">{i.ncm}</td>
                                  <td className="py-1">{i.cfop}</td>
                                  <td className="py-1 text-right">{i.qtd} {i.unidade}</td>
                                  <td className="py-1 text-right">{brl(i.custo)}</td>
                                  <td className="py-1 text-right text-emerald-600">{brl(i.preco)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Prévia da importação */}
      {previa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4" onClick={() => setPrevia(null)}>
          <div className="my-auto w-full max-w-3xl rounded-xl bg-white p-6 shadow-xl" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Conferir XML importado</h3>
            <p className="text-sm text-slate-500">
              Revise os dados antes de dar entrada no estoque.
            </p>

            <div className="my-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><span className="text-slate-400">Fornecedor:</span> <b>{previa.fornecedor}</b></div>
              <div><span className="text-slate-400">CNPJ:</span> {previa.cnpjFornecedor}</div>
              <div><span className="text-slate-400">Nota:</span> {previa.numeroNota} / série {previa.serie}</div>
              <div><span className="text-slate-400">Emissão:</span> {new Date(previa.emissao + "T12:00").toLocaleDateString("pt-BR")}</div>
              <div className="sm:col-span-2 break-all text-[10px] text-slate-400">
                Chave: {previa.chave}
              </div>
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2 text-right">Qtd</th>
                    <th className="px-3 py-2 text-right">Custo</th>
                    <th className="px-3 py-2 text-right">Venda sug.</th>
                    <th className="px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previa.itens.map((i, k) => {
                    const existe = db.produtos.some(
                      (p) => p.sku && p.sku.toLowerCase() === i.sku.toLowerCase(),
                    );
                    return (
                      <tr key={k}>
                        <td className="px-3 py-2 text-slate-700">{i.nome}</td>
                        <td className="px-3 py-2 text-slate-500">{i.sku}</td>
                        <td className="px-3 py-2 text-right">{i.qtd}</td>
                        <td className="px-3 py-2 text-right">{brl(i.custo)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{brl(i.preco)}</td>
                        <td className="px-3 py-2">
                          {existe ? <Badge tone="sky">Atualiza</Badge> : <Badge tone="green">Novo</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={previa.gerarFinanceiro}
                  onChange={(ev) => setPrevia({ ...previa, gerarFinanceiro: ev.target.checked })}
                  className="accent-sky-600"
                />
                Gerar conta a pagar (30 dias)
              </label>
              <p className="text-xl font-bold text-slate-900">{brl(previa.total)}</p>
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setPrevia(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  addEntrada({ ...previa, id: previa.id || uid() });
                  setPrevia(null);
                }}
              >
                Importar nota
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
