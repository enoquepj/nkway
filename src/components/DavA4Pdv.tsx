import type { ReactNode } from "react";
import { cn } from "@/components/ui";
import { dataBR, dataHoraBR, mascaraDocumento, moeda, num } from "@/lib/dominio";
import { iniciaisLogoPdv, type PdvImpressaoConfig } from "@/lib/pdvImpressao";
import { type ReciboTermicoPdv } from "@/lib/operacoesPdv";
import { formatarQtdPdv } from "@/lib/multiplicadorPdv";

function QuadroDav({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 rounded border border-ink-300 px-2 py-1.5", className)}>
      <p className="text-[7.5px] font-bold uppercase tracking-wide text-ink-500">{titulo}</p>
      <div className="mt-0.5 min-w-0 text-[9.5px] leading-snug text-ink-900">{children}</div>
    </div>
  );
}

export function DavA4Pdv({
  cupom,
  empresa,
  config,
  logoTexto,
  rotuloVia,
  viaIndex,
}: {
  cupom: ReciboTermicoPdv;
  empresa: { nome: string; fantasia: string; documento: string; endereco: string; municipio: string };
  config: PdvImpressaoConfig;
  logoTexto: string;
  rotuloVia: string;
  viaIndex: number;
}) {
  const cancelado = cupom.status === "cancelado" || cupom.situacaoFiscal === "cancelada";
  const cancelados = config.imprimirItensCancelados ? cupom.itensCancelados ?? [] : [];

  return (
    <article className={cn("dav-pdv-a4 mx-auto mb-3 w-full max-w-[760px] bg-white p-4 text-[10px] leading-tight text-ink-900 shadow-sm last:mb-0", viaIndex > 0 && "break-before-page")}>
      {rotuloVia && <p className="mb-1 text-center text-[8px] font-bold uppercase tracking-wide text-ink-500">{rotuloVia}</p>}

      <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-1.5">
        <header className="rounded border border-ink-300 p-2.5">
          <div className="flex items-start gap-2">
            {config.imprimeLogo && (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink-900 text-[13px] font-bold text-white">
                {iniciaisLogoPdv(logoTexto)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              {config.imprimeLogo && <p className="text-[8px] font-bold uppercase tracking-wide text-ink-500">{logoTexto}</p>}
              <p className="text-[12px] font-black uppercase">{empresa.fantasia || empresa.nome}</p>
              {empresa.fantasia && empresa.fantasia !== empresa.nome && <p className="text-[9px] font-semibold">{empresa.nome}</p>}
              {config.imprimeCabecalho && <p className="mt-0.5 text-[8.5px] text-ink-600">{[empresa.endereco, empresa.municipio].filter(Boolean).join(" · ")}</p>}
              <p className="mt-1 text-[8.5px] font-semibold">CNPJ {mascaraDocumento(empresa.documento)}</p>
            </div>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center rounded border-2 border-ink-700 px-2 py-1.5 text-center">
          <p className="text-[7px] font-bold uppercase tracking-wide text-ink-500">Documento auxiliar de venda</p>
          <p className="mt-0.5 text-[24px] font-black leading-none tracking-wide">DAV</p>
          <p className="mt-1 text-[8px] font-bold uppercase">Pré-venda / orçamento</p>
          <p className={cn("mt-1 border-t border-ink-200 pt-1 text-[8px] font-bold uppercase", cancelado ? "text-rose-700" : "text-rose-700")}>
            {cancelado ? "Documento cancelado · não fiscal" : "Não é documento fiscal"}
          </p>
        </div>
      </div>

      <div className="mt-1.5 grid grid-cols-4 gap-1">
        <QuadroDav titulo="Número do DAV"><strong className="text-[11px]">{String(cupom.numeroVenda).padStart(8, "0")}</strong></QuadroDav>
        <QuadroDav titulo="Data / hora"><strong>{dataHoraBR(cupom.dataIso)}</strong></QuadroDav>
        <QuadroDav titulo="Validade do orçamento"><strong>{dataBR(cupom.validadeDav)}</strong></QuadroDav>
        <QuadroDav titulo="Caixa / operador">{config.exibirOperadorCaixa ? <strong>{cupom.terminal} · {cupom.operador}</strong> : <span>—</span>}</QuadroDav>
      </div>

      {config.exibirCliente && (
        <section className="mt-1.5 rounded border border-ink-300 p-2">
          <p className="border-b border-ink-200 pb-1 text-[8px] font-bold uppercase tracking-wide text-ink-500">Destinatário / cliente</p>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_230px] gap-2">
            <div className="min-w-0">
              <p className="text-[7.5px] font-bold uppercase text-ink-500">Nome / razão social</p>
              <p className="truncate text-[10px] font-bold uppercase">{cupom.clienteNome || "CONSUMIDOR"}</p>
            </div>
            <div>
              <p className="text-[7.5px] font-bold uppercase text-ink-500">CPF / CNPJ</p>
              <p className="text-[10px] font-semibold">{cupom.clienteDocumento ? mascaraDocumento(cupom.clienteDocumento) : "Não informado"}</p>
            </div>
          </div>
        </section>
      )}

      <section className="mt-2">
        <p className="border-y border-ink-300 py-1 text-center text-[8px] font-bold uppercase tracking-wide">Dados dos produtos e serviços</p>
        <table className="mt-1 w-full border-collapse text-[8.5px]">
          <thead>
            <tr className="bg-ink-50 text-[7px] uppercase">
              <th className="border border-ink-300 px-1 py-1 text-center">Item</th>
              <th className="border border-ink-300 px-1 py-1 text-left">Descrição</th>
              <th className="border border-ink-300 px-1 py-1 text-center">Un.</th>
              <th className="border border-ink-300 px-1 py-1 text-right">Quantidade</th>
              <th className="border border-ink-300 px-1 py-1 text-right">V. unitário</th>
              {config.imprimirDescontoAcrescimoItens && <th className="border border-ink-300 px-1 py-1 text-right">Desc. / acrésc.</th>}
              <th className="border border-ink-300 px-1 py-1 text-right">V. total</th>
            </tr>
          </thead>
          <tbody>
            {cupom.itens.map((item, idx) => (
              <tr key={`${item.numero}-${item.nome}`} className="dav-pdv-a4-row">
                <td className="border border-ink-200 px-1 py-1 text-center tabular">{String(idx + 1).padStart(3, "0")}</td>
                <td className="border border-ink-200 px-1 py-1 font-semibold">{item.nome}</td>
                <td className="border border-ink-200 px-1 py-1 text-center">{item.unidade}</td>
                <td className="border border-ink-200 px-1 py-1 text-right tabular">{num(item.qtd, 3)}</td>
                <td className="border border-ink-200 px-1 py-1 text-right tabular">{moeda(item.precoUnit)}</td>
                {config.imprimirDescontoAcrescimoItens && (
                  <td className="border border-ink-200 px-1 py-1 text-right tabular">
                    {(item.desconto ?? 0) > 0 ? `− ${moeda(item.desconto ?? 0)}` : ""}
                    {(item.desconto ?? 0) > 0 && (item.acrescimo ?? 0) > 0 ? " · " : ""}
                    {(item.acrescimo ?? 0) > 0 ? `+ ${moeda(item.acrescimo ?? 0)}` : ""}
                    {(item.desconto ?? 0) <= 0 && (item.acrescimo ?? 0) <= 0 ? "—" : ""}
                  </td>
                )}
                <td className="border border-ink-200 px-1 py-1 text-right tabular font-bold">{moeda(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {cancelados.length > 0 && (
        <section className="mt-1.5 rounded border border-ink-300 p-2 text-[8.5px] text-ink-500">
          <p className="mb-1 font-bold uppercase">Itens cancelados antes da gravação — não somam</p>
          {cancelados.map((item, idx) => (
            <p key={`cancelado-${idx}-${item.nome}`} className="line-through">
              {formatarQtdPdv(item.qtd)} {item.unidade} · {item.nome} · {moeda(item.total)}
            </p>
          ))}
        </section>
      )}

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_250px] gap-2">
        <section className="rounded border border-ink-300 p-2">
          <p className="mb-1 text-[7.5px] font-bold uppercase tracking-wide text-ink-500">Observações e condições</p>
          <p className="text-[8.5px]">Orçamento válido até {dataBR(cupom.validadeDav)}. Preços e disponibilidade devem ser confirmados no faturamento.</p>
          <p className="mt-1 text-[8px] font-semibold text-rose-700">Este DAV é uma pré-venda: não é nota fiscal, não comprova pagamento e não baixa o estoque.</p>
          {config.mensagemRodape && <p className="mt-1 border-t border-ink-200 pt-1">{config.mensagemRodape}</p>}
        </section>
        <section className="rounded border border-ink-300 p-2">
          <p className="mb-1 border-b border-ink-200 pb-1 text-[7.5px] font-bold uppercase tracking-wide text-ink-500">Resumo do orçamento</p>
          <div className="space-y-1 text-[9px]">
            <div className="flex justify-between gap-2"><span>Quantidade de itens</span><strong>{cupom.qtdLinhas} ({num(cupom.unidadesTotais, 3)} un.)</strong></div>
            <div className="flex justify-between gap-2"><span>Valor dos produtos</span><strong className="tabular">{moeda(cupom.subtotal)}</strong></div>
            {cupom.desconto > 0 && <div className="flex justify-between gap-2"><span>Desconto total</span><strong className="tabular">− {moeda(cupom.desconto)}</strong></div>}
            {cupom.frete > 0 && <div className="flex justify-between gap-2"><span>Frete</span><strong className="tabular">{moeda(cupom.frete)}</strong></div>}
            <div className="flex justify-between gap-2 border-t border-ink-300 pt-1 text-[12px] font-black">
              <span>{cancelado ? "TOTAL CANCELADO" : "TOTAL DO ORÇAMENTO"}</span><span className="tabular">{moeda(cupom.total)}</span>
            </div>
          </div>
        </section>
      </div>

      <footer className="mt-2 grid grid-cols-2 gap-8 pt-5 text-center text-[8px]">
        <div className="border-t border-ink-400 pt-1">Assinatura / aprovação do cliente</div>
        <div className="border-t border-ink-400 pt-1">Data</div>
      </footer>
    </article>
  );
}
