"use client";

import { Button, Icon, Modal, cn } from "@/components/ui";
import { QrCode } from "@/components/QrCode";
import { dataHoraBR, moeda, num, round2 } from "@/lib/dominio";
import {
  chaveBlocos,
  payloadQrNfce,
  rotuloFormaImpresso,
  tributosDoDoc,
  type DocFiscal,
  type Emitente,
  type MdfeImpresso,
} from "@/lib/danfe";

/* --------------------------------------------------------------- folha A4 */
const Linha = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("flex items-start gap-1.5 text-[9.5px] leading-tight", className)}>{children}</div>
);
const Rotulo = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 text-[7.5px] font-bold uppercase tracking-wide text-ink-400">{children}</span>
);
const Caixa = ({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) => (
  <div className={cn("rounded border border-ink-300 px-1.5 py-1", className)}>
    <p className="text-[7px] font-bold uppercase tracking-wide text-ink-400">{titulo}</p>
    <div className="mt-0.5">{children}</div>
  </div>
);

/* ------------------------------------------------------- DANFE NFC-e 80 mm */
function CupomNfce({ doc, emit, qr }: { doc: DocFiscal; emit: Emitente; qr: string }) {
  const tributos = tributosDoDoc(doc.itens, new Map());
  return (
    <div className="mx-auto w-[302px] bg-white px-3 py-3 font-mono text-[10px] leading-[1.35] text-ink-900">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase">{emit.fantasia || emit.nome}</p>
        <p>{emit.nome}</p>
        <p>
          {emit.endereco} · {emit.municipio}/{emit.uf}
        </p>
        <p>CNPJ {emit.cnpj} · IE {emit.ie || "ISENTO"}</p>
      </div>

      <p className="my-2 border-y border-dashed border-ink-300 py-1 text-center font-bold uppercase">
        DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
      </p>
      <p className="text-center uppercase">Não permite aproveitamento de crédito de ICMS</p>

      <div className="mt-2 space-y-0.5">
        <Linha><Rotulo>Nº</Rotulo><span className="font-bold">{String(doc.numero).padStart(9, "0")}</span><Rotulo>SÉRIE</Rotulo><span className="font-bold">{doc.serie}</span></Linha>
        <Linha><Rotulo>EMISSÃO</Rotulo><span>{dataHoraBR(doc.autorizadaEm || doc.data)}</span></Linha>
        {doc.cliente !== "CONSUMIDOR" && <Linha><Rotulo>CONSUMIDOR</Rotulo><span>{doc.cliente}</span></Linha>}
        {doc.ambiente === 2 && <p className="text-center font-bold uppercase">Emitida em homologação — sem valor fiscal</p>}
      </div>

      <table className="mt-2 w-full border-y border-dashed border-ink-300 text-[9.5px]">
        <thead>
          <tr className="text-[8px] uppercase">
            <th className="py-0.5 text-left">#</th>
            <th className="py-0.5 text-left">Descrição</th>
            <th className="py-0.5 text-right">Qtd</th>
            <th className="py-0.5 text-right">Unit</th>
            <th className="py-0.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {doc.itens.map((i, k) => (
            <tr key={k} className="border-t border-ink-100">
              <td className="align-top py-0.5">{k + 1}</td>
              <td className="align-top py-0.5">
                {i.nome}
                <span className="block text-[8px] text-ink-400">
                  {i.unidade} · un {moeda(i.precoUnit)}
                </span>
              </td>
              <td className="align-top py-0.5 text-right">{num(i.qtd, 3)}</td>
              <td className="align-top py-0.5 text-right">{moeda(i.precoUnit)}</td>
              <td className="align-top py-0.5 text-right font-bold">{moeda(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-1.5 space-y-0.5">
        <Linha className="justify-between"><Rotulo>QTD. TOTAL DE ITENS</Rotulo><span>{doc.itens.length}</span></Linha>
        <Linha className="justify-between"><Rotulo>VALOR TOTAL</Rotulo><span className="font-bold">{moeda(doc.subtotal)}</span></Linha>
        {doc.desconto > 0 && <Linha className="justify-between"><Rotulo>DESCONTO</Rotulo><span>− {moeda(doc.desconto)}</span></Linha>}
        {doc.frete > 0 && <Linha className="justify-between"><Rotulo>FRETE</Rotulo><span>{moeda(doc.frete)}</span></Linha>}
        <Linha className="justify-between text-[12px]"><Rotulo>TOTAL A PAGAR</Rotulo><span className="font-bold">{moeda(doc.total)}</span></Linha>
      </div>

      <div className="mt-1.5 border-t border-dashed border-ink-300 pt-1.5">
        {doc.pagamentos.length > 0 ? (
          doc.pagamentos.map((p, k) => (
            <Linha key={k} className="justify-between">
              <span>{rotuloFormaImpresso(p.forma)}</span>
              <span>{moeda(p.valor)}</span>
            </Linha>
          ))
        ) : (
          <Linha className="justify-between"><span>{rotuloFormaImpresso(doc.forma)}</span><span>{moeda(doc.total)}</span></Linha>
        )}
        {doc.troco > 0 && <Linha className="justify-between"><span>Troco</span><span>{moeda(doc.troco)}</span></Linha>}
      </div>

      <div className="mt-1.5 border-t border-dashed border-ink-300 pt-1.5 text-center">
        <p className="font-bold uppercase">Tributos aproximados</p>
        <p>Federal {moeda(round2(tributos.total - tributos.itens[0].valor))} · Municipal/Estadual {moeda(tributos.itens[0].valor)}</p>
        <p className="text-[9px]">Total estimado {moeda(tributos.total)} — Lei 12.741/2012</p>
      </div>

      <div className="mt-2 border-t border-dashed border-ink-300 pt-2 text-center">
        <p className="text-[9px] leading-tight">
          Consulte pela Chave de Acesso em<br />
          <span className="break-all">https://dfe-nkway.com.br/consulta</span>
        </p>
        {qr ? (
          <div className="mt-1.5 flex justify-center">
            <QrCode valor={qr} tamanho={124} nivel="M" />
          </div>
        ) : (
          <p className="mt-1 font-bold uppercase">documento sem chave de acesso</p>
        )}
        <p className="mt-1 text-[8.5px] uppercase">Chave de acesso</p>
        <p className="break-all text-[9px] font-bold">{chaveBlocos(doc.chave)}</p>
        {doc.protocolo && (
          <p className="mt-0.5 text-[8.5px]">
            Protocolo {doc.protocolo} · {dataHoraBR(doc.autorizadaEm || doc.data)}
          </p>
        )}
      </div>

      <p className="mt-2 border-t border-dashed border-ink-300 pt-1 text-center text-[8.5px]">
        {doc.observacao || `Consumidor: ${doc.cliente} · Operador: ${doc.operador || "—"}`}
      </p>
    </div>
  );
}

/* ---------------------------------------------------- DANFE NF-e A4 simplificado */
function DanfeA4({ doc, emit, qr }: { doc: DocFiscal; emit: Emitente; qr: string }) {
  const tributos = tributosDoDoc(doc.itens, new Map());
  const totQtd = doc.itens.reduce((s, i) => s + i.qtd, 0);
  return (
    <div className="mx-auto w-[780px] bg-white p-5 text-[10px] leading-tight text-ink-900">
      <div className="flex gap-2">
        <div className="w-28 shrink-0 space-y-1 text-center">
          <div className="rounded border border-ink-300 p-1">
            <p className="text-[7.5px] font-bold uppercase">DANFE</p>
            <p className="text-[8px]">Documento Auxiliar da Nota Fiscal Eletrônica</p>
            <p className="mt-1 text-[9px] font-bold">0 - Entrada</p>
            <p className="text-[9px] font-bold">1 - Saída</p>
            <p className="mt-1 inline-block border border-ink-300 px-1.5 text-[14px] font-bold">1</p>
          </div>
          <div className="rounded border border-ink-300 p-1">
            <p className="text-[7px] uppercase">Modelo</p>
            <p className="text-[11px] font-bold">{doc.modelo}</p>
            <div className="mt-0.5 flex justify-between text-[8px]">
              <span>SÉRIE {doc.serie}</span>
              <span>Nº {String(doc.numero).padStart(9, "0")}</span>
            </div>
            <p className="mt-0.5 text-[7.5px]">FOLHA 1/1</p>
          </div>
          <div className="rounded border border-ink-300 p-1">
            <p className="text-[7px] uppercase">Consulta de autenticidade</p>
            <p className="mt-0.5 text-[7px] leading-tight">https://dfe-nkway.com.br/consulta</p>
          </div>
        </div>

        <div className="flex-1 rounded border border-ink-300 p-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-bold uppercase">{emit.nome}</p>
              <p className="text-[9px] uppercase">{emit.fantasia}</p>
            </div>
            <div className="shrink-0 rounded border border-ink-300 px-2 py-1 text-center">
              <p className="text-[7.5px] uppercase">DANFE</p>
              <p className="text-[13px] font-bold">{doc.modelo === "NF-e" ? "NF-e" : doc.modelo}</p>
            </div>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Caixa titulo="CNPJ"><span className="text-[10px] font-bold">{emit.cnpj}</span></Caixa>
            <Caixa titulo="Inscrição estadual"><span className="text-[10px]">{emit.ie || "ISENTO"}</span></Caixa>
            <Caixa titulo="Regime tributário"><span className="text-[9px] uppercase">{emit.regime}</span></Caixa>
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Caixa titulo="Endereço" className="col-span-2"><span className="text-[9.5px]">{emit.endereco}</span></Caixa>
            <Caixa titulo="Município / UF"><span className="text-[9.5px]">{emit.municipio}/{emit.uf}</span></Caixa>
          </div>
        </div>
      </div>

      <div className="mt-2 rounded border border-ink-300 p-2">
        <p className="text-[8px] font-bold uppercase">Chave de acesso</p>
        <div className="flex items-start gap-3">
          <p className="flex-1 break-all font-mono text-[11px] font-bold tracking-wide">{chaveBlocos(doc.chave) || "—"}</p>
          {qr && <QrCode valor={qr} tamanho={92} nivel="M" className="shrink-0" />}
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1">
          <Caixa titulo="Nº da nota"><span className="text-[10px] font-bold">{String(doc.numero).padStart(9, "0")}</span></Caixa>
          <Caixa titulo="Série"><span className="text-[10px] font-bold">{doc.serie}</span></Caixa>
          <Caixa titulo="Data / hora de emissão"><span className="text-[9.5px]">{dataHoraBR(doc.autorizadaEm || doc.data)}</span></Caixa>
          <Caixa titulo="Ambiente"><span className="text-[9.5px]">{doc.ambiente === 1 ? "Produção" : "Homologação — sem valor fiscal"}</span></Caixa>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <Caixa titulo="Destinatário" className="col-span-2"><span className="text-[10px] font-bold uppercase">{doc.cliente}</span></Caixa>
          <Caixa titulo="Protocolo de autorização"><span className="font-mono text-[9px]">{doc.protocolo || "—"}</span></Caixa>
        </div>
      </div>

      <p className="mt-2 border-y border-ink-300 py-0.5 text-center text-[9px] font-bold uppercase">Cálculo do imposto</p>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {[
          ["Valor dos produtos", doc.subtotal],
          ["Desconto", -doc.desconto],
          ["Frete", doc.frete],
          ["Total da nota", doc.total],
          ["Tributos aprox.", tributos.total],
        ].map(([r, v]) => (
          <Caixa key={r as string} titulo={r as string}>
            <span className="text-[10.5px] font-bold">{moeda(v as number)}</span>
          </Caixa>
        ))}
      </div>

      <p className="mt-2 border-y border-ink-300 py-0.5 text-center text-[9px] font-bold uppercase">Dados dos produtos e serviços</p>
      <table className="mt-1 w-full border-collapse text-[9px]">
        <thead>
          <tr className="bg-ink-50 text-[7.5px] uppercase">
            <th className="border border-ink-200 px-1 py-0.5 text-left">Código</th>
            <th className="border border-ink-200 px-1 py-0.5 text-left">Descrição</th>
            <th className="border border-ink-200 px-1 py-0.5 text-left">NCM</th>
            <th className="border border-ink-200 px-1 py-0.5 text-left">CFOP</th>
            <th className="border border-ink-200 px-1 py-0.5 text-left">CST/CSOSN</th>
            <th className="border border-ink-200 px-1 py-0.5 text-center">Un</th>
            <th className="border border-ink-200 px-1 py-0.5 text-right">Qtd</th>
            <th className="border border-ink-200 px-1 py-0.5 text-right">V. unit</th>
            <th className="border border-ink-200 px-1 py-0.5 text-right">V. total</th>
            <th className="border border-ink-200 px-1 py-0.5 text-right">ICMS %</th>
          </tr>
        </thead>
        <tbody>
          {doc.itens.map((i, k) => (
            <tr key={k}>
              <td className="border border-ink-200 px-1 py-0.5">{String(k + 1).padStart(6, "0")}</td>
              <td className="border border-ink-200 px-1 py-0.5">{i.nome}</td>
              <td className="border border-ink-200 px-1 py-0.5">{i.ncm || "—"}</td>
              <td className="border border-ink-200 px-1 py-0.5">{i.cfop || "—"}</td>
              <td className="border border-ink-200 px-1 py-0.5">{i.csosn || "—"}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-center">{i.unidade}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-right">{num(i.qtd, 3)}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-right">{moeda(i.precoUnit)}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-right">{moeda(i.total)}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-right">{num(i.icmsAliq ?? 0, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <Caixa titulo="Quantidade total de itens"><span className="text-[10px] font-bold">{num(totQtd, 3)}</span></Caixa>
        <Caixa titulo="Forma de pagamento"><span className="text-[9.5px]">{rotuloFormaImpresso(doc.forma)}</span></Caixa>
        <Caixa titulo="Valor pago" className="col-span-2">
          <span className="text-[9.5px]">
            {(doc.pagamentos.length ? doc.pagamentos : [{ forma: doc.forma, valor: doc.total }])
              .map((p) => `${rotuloFormaImpresso(p.forma)} ${moeda(p.valor)}`)
              .join(" · ")}
            {doc.troco > 0 ? ` · troco ${moeda(doc.troco)}` : ""}
          </span>
        </Caixa>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1">
        <Caixa titulo="Informações complementares" className="col-span-2">
          <p className="min-h-[38px] text-[8.5px] leading-snug">
            {doc.observacao || "Documento emitido por ME ou EPP optante pelo Simples Nacional."}{" "}
            Tributos aproximados ao consumidor: {moeda(tributos.total)} (Lei 12.741/2012). IBS/CBS em fase de
            transição conforme LC 214/2025.
          </p>
        </Caixa>
        <Caixa titulo="Resumo da carga tributária">
          {tributos.itens.map((t) => (
            <Linha key={t.label} className="justify-between">
              <span className="text-[8px]">{t.label}</span>
              <span className="text-[8px] font-bold">{moeda(t.valor)}</span>
            </Linha>
          ))}
        </Caixa>
      </div>

      <p className="mt-2 text-center text-[7.5px] text-ink-400">
        Emitido pelo NKWAY · {emit.fantasia || emit.nome} · {doc.operador || "—"} · {dataHoraBR(new Date())}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------- DAMDFE A4 */
function DamdfeA4({ mdfe, emit }: { mdfe: MdfeImpresso; emit: Emitente }) {
  const totalDocs = mdfe.documentos.reduce((s, d) => s + d.valor, 0);
  return (
    <div className="mx-auto w-[780px] bg-white p-5 text-[10px] leading-tight text-ink-900">
      <div className="flex gap-2">
        <div className="w-28 shrink-0 space-y-1 text-center">
          <div className="rounded border border-ink-300 p-1">
            <p className="text-[9px] font-bold uppercase">DAMDFE</p>
            <p className="text-[7.5px] leading-tight">Documento Auxiliar do Manifesto Eletrônico de Documentos Fiscais</p>
            <p className="mt-1 text-[13px] font-bold">58</p>
            <p className="text-[7.5px] uppercase">Modelo · Série {mdfe.serie}</p>
          </div>
          <div className="rounded border border-ink-300 p-1">
            <p className="text-[7px] uppercase">Consulta</p>
            <p className="text-[7px] leading-tight">https://dfe-nkway.com.br/mdfe</p>
          </div>
        </div>
        <div className="flex-1 rounded border border-ink-300 p-2">
          <p className="text-[12px] font-bold uppercase">{emit.nome}</p>
          <p className="text-[9px] uppercase">{emit.fantasia}</p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Caixa titulo="CNPJ"><span className="text-[10px] font-bold">{emit.cnpj}</span></Caixa>
            <Caixa titulo="IE"><span className="text-[10px]">{emit.ie || "ISENTO"}</span></Caixa>
            <Caixa titulo="Município / UF"><span className="text-[9.5px]">{emit.municipio}/{emit.uf}</span></Caixa>
          </div>
          <p className="mt-1.5 text-[8px] font-bold uppercase">Chave de acesso do MDF-e</p>
          <p className="break-all font-mono text-[11px] font-bold">{chaveBlocos(mdfe.chave) || "—"}</p>
          <div className="mt-1 grid grid-cols-3 gap-1">
            <Caixa titulo="Nº do manifesto"><span className="text-[10px] font-bold">{String(mdfe.numero).padStart(9, "0")}</span></Caixa>
            <Caixa titulo="Protocolo"><span className="font-mono text-[9px]">{mdfe.protocolo || "—"}</span></Caixa>
            <Caixa titulo="Situação"><span className="text-[9.5px] uppercase">{mdfe.status}</span></Caixa>
          </div>
        </div>
      </div>

      <p className="mt-2 border-y border-ink-300 py-0.5 text-center text-[9px] font-bold uppercase">Modal rodoviário de carga</p>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <Caixa titulo="UF de carregamento"><span className="text-[10px] font-bold">{mdfe.ufInicio}</span></Caixa>
        <Caixa titulo="Município de carregamento"><span className="text-[9.5px]">{mdfe.municipioCarregamento || "—"}</span></Caixa>
        <Caixa titulo="UF de descarregamento"><span className="text-[10px] font-bold">{mdfe.ufFim}</span></Caixa>
        <Caixa titulo="Município de descarregamento"><span className="text-[9.5px]">{mdfe.municipioDescarregamento || "—"}</span></Caixa>
      </div>
      <div className="mt-1 grid grid-cols-5 gap-1">
        <Caixa titulo="Placa do veículo"><span className="text-[10px] font-bold">{mdfe.placa}</span></Caixa>
        <Caixa titulo="RNTRC"><span className="text-[10px]">{mdfe.rntrc || "—"}</span></Caixa>
        <Caixa titulo="Condutor"><span className="text-[9.5px] uppercase">{mdfe.condutor || "—"}</span></Caixa>
        <Caixa titulo="CPF do condutor"><span className="font-mono text-[9.5px]">{mdfe.cpfCondutor || "—"}</span></Caixa>
        <Caixa titulo="Km rodado"><span className="text-[10px] font-bold">{mdfe.kmRodado ? num(mdfe.kmRodado, 0) : "—"}</span></Caixa>
      </div>

      <p className="mt-2 border-y border-ink-300 py-0.5 text-center text-[9px] font-bold uppercase">Documentos fiscal vinculados</p>
      <table className="mt-1 w-full border-collapse text-[9px]">
        <thead>
          <tr className="bg-ink-50 text-[7.5px] uppercase">
            <th className="border border-ink-200 px-1 py-0.5 text-left">Tipo</th>
            <th className="border border-ink-200 px-1 py-0.5 text-left">Chave de acesso</th>
            <th className="border border-ink-200 px-1 py-0.5 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {mdfe.documentos.map((d, k) => (
            <tr key={k}>
              <td className="border border-ink-200 px-1 py-0.5 font-bold">{d.tipo}</td>
              <td className="border border-ink-200 px-1 py-0.5 font-mono">{chaveBlocos(d.chave)}</td>
              <td className="border border-ink-200 px-1 py-0.5 text-right font-bold">{moeda(d.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 grid grid-cols-4 gap-1">
        <Caixa titulo="Quantidade de documentos"><span className="text-[10px] font-bold">{mdfe.documentos.length}</span></Caixa>
        <Caixa titulo="Valor total da carga"><span className="text-[10.5px] font-bold">{moeda(round2(totalDocs))}</span></Caixa>
        <Caixa titulo="Peso bruto total"><span className="text-[10.5px] font-bold">{num(mdfe.pesoBruto, 3)} kg</span></Caixa>
        <Caixa titulo="Divergência de carga">
          <span className={cn("text-[10px] font-bold", Math.abs(round2(totalDocs - mdfe.valorCarga)) > 0.02 ? "text-rose-600" : "text-way-700")}>
            {moeda(round2(totalDocs - mdfe.valorCarga))}
          </span>
        </Caixa>
      </div>

      <p className="mt-2 text-[8.5px] leading-snug">
        Emitido em {dataHoraBR(mdfe.emitidoEm)}
        {mdfe.encerradoEm ? ` · encerrado em ${dataHoraBR(mdfe.encerradoEm)}` : " · manifesto em trânsito"}.
        A safety note: transporte de mercadoria sem MDF-e vinculado sujeita o emitente à multa prevista no convênio ICMS 25/2016.
      </p>
      <p className="mt-2 text-center text-[7.5px] text-ink-400">Emitido pelo NKWAY · {dataHoraBR(new Date())}</p>
    </div>
  );
}

/* ------------------------------------------------------------- contêiner */
export type AlvoImpresso =
  | { tipo: "nfe"; doc: DocFiscal; emit: Emitente; cscId: string }
  | { tipo: "mdfe"; mdfe: MdfeImpresso; emit: Emitente };

/** Modal de impressão: escolhe 80 mm (cupom) ou A4 conforme o documento */
export function Impressao({ alvo, aoFechar }: { alvo: AlvoImpresso | null; aoFechar: () => void }) {
  if (!alvo) return null;
  const cupom = alvo.tipo === "nfe" && (alvo.doc.modelo === "NFC-e" || alvo.doc.modelo === "SAT");
  const qr = alvo.tipo === "nfe" ? payloadQrNfce(alvo.doc, alvo.emit, alvo.cscId) : "";
  const nome =
    alvo.tipo === "mdfe"
      ? `damdfe-${alvo.mdfe.numero}`
      : `danfe-${alvo.doc.modelo.toLowerCase()}-${String(alvo.doc.numero).padStart(9, "0")}`;

  return (
    <Modal aberto aoFechar={aoFechar} largura={cupom ? "max-w-xl" : "max-w-[940px]"}
      titulo="Pré-visualização do documento"
      descricao="Layout pronto para impressão">
      <div className="no-print mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-way-50 text-way-700">
            <Icon name="imprimir" className="size-4" />
          </span>
          <div>
            <p className="text-[13px] font-bold text-ink-900">
              {alvo.tipo === "mdfe" ? "DAMDFE" : `DANFE ${alvo.doc.modelo}`}
            </p>
            <p className="text-[11.5px] text-ink-400">
              {cupom ? "Bobina de 80 mm" : "Papel A4"} · use “Imprimir” e escolha o tamanho correto do papel
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variante="secundario" icone="lixo" onClick={aoFechar}>
            Fechar
          </Button>
          <Button icone="imprimir" onClick={() => window.print()}>
            Imprimir
          </Button>
        </div>
      </div>

      <div className="print-area max-h-[72vh] overflow-auto rounded-xl bg-ink-100 p-3">
        {alvo.tipo === "nfe" ? (
          cupom ? (
            <CupomNfce doc={alvo.doc} emit={alvo.emit} qr={qr} />
          ) : (
            <DanfeA4 doc={alvo.doc} emit={alvo.emit} qr={qr} />
          )
        ) : (
          <DamdfeA4 mdfe={alvo.mdfe} emit={alvo.emit} />
        )}
      </div>
    </Modal>
  );
}
