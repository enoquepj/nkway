import { brl, formatChave, type Venda } from "./types";
import { Button } from "./ui";

/** Pseudo-QR Code determinístico só para representar o DANFE/NFC-e */
function FakeQR({ seed }: { seed: string }) {
  const cells = Array.from({ length: 144 }, (_, i) => {
    const c = seed.charCodeAt(i % seed.length) + i * 7;
    return c % 3 !== 0;
  });
  return (
    <div className="grid h-24 w-24 grid-cols-12 gap-0 border-2 border-slate-900 p-0.5">
      {cells.map((on, i) => (
        <div key={i} className={on ? "bg-slate-900" : "bg-white"} />
      ))}
    </div>
  );
}

export default function Documento({
  venda,
  empresa,
  cnpj,
  onClose,
}: {
  venda: Venda;
  empresa: string;
  cnpj: string;
  onClose: () => void;
}) {
  const isDav = venda.tipo === "dav";
  const subtotal = venda.itens.reduce((s, i) => s + i.qtd * i.preco, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-auto w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
      >
        {/* Cabeçalho */}
        <div className="border-b-2 border-dashed border-slate-300 pb-3 text-center">
          <p className="text-sm font-black uppercase tracking-wide text-slate-900">{empresa}</p>
          <p className="text-[10px] text-slate-500">CNPJ {cnpj || "—"}</p>
          <p className="mt-2 text-xs font-bold uppercase text-slate-700">
            {isDav
              ? "DAV — Documento Auxiliar de Venda"
              : `${venda.fiscal?.modelo} — Documento Fiscal Eletrônico`}
          </p>
          {isDav && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
              NÃO É DOCUMENTO FISCAL · Não é válido como comprovante de pagamento
            </p>
          )}
        </div>

        {/* Dados */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-dashed border-slate-300 py-3 text-[11px] text-slate-600">
          <span>Documento: <b className="text-slate-900">#{venda.numero}</b></span>
          <span className="text-right">
            {new Date(venda.data).toLocaleString("pt-BR")}
          </span>
          <span className="col-span-2 truncate">Cliente: <b className="text-slate-900">{venda.clienteNome}</b></span>
          {isDav && venda.validade && (
            <span className="col-span-2">
              Válido até: <b className="text-slate-900">
                {new Date(venda.validade + "T12:00").toLocaleDateString("pt-BR")}
              </b>
            </span>
          )}
          {venda.fiscal && (
            <>
              <span>Série: {venda.fiscal.serie}</span>
              <span className="text-right">Nº {String(venda.fiscal.numeroNota).padStart(6, "0")}</span>
            </>
          )}
        </div>

        {/* Itens */}
        <table className="w-full py-2 text-[11px]">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-400">
              <th className="py-1 font-medium">ITEM</th>
              <th className="py-1 text-center font-medium">QTD</th>
              <th className="py-1 text-right font-medium">UNIT</th>
              <th className="py-1 text-right font-medium">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {venda.itens.map((i, idx) => (
              <tr key={i.produtoId} className="text-slate-700">
                <td className="py-1">
                  <span className="text-slate-400">{String(idx + 1).padStart(2, "0")} </span>
                  {i.nome}
                </td>
                <td className="py-1 text-center">{i.qtd}</td>
                <td className="py-1 text-right">{i.preco.toFixed(2)}</td>
                <td className="py-1 text-right font-medium">{(i.qtd * i.preco).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totais */}
        <div className="border-t-2 border-dashed border-slate-300 pt-3 text-sm">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Subtotal ({venda.itens.length} itens)</span>
            <span>{brl(subtotal)}</span>
          </div>
          {venda.desconto > 0 && (
            <div className="flex justify-between text-xs text-rose-600">
              <span>Desconto</span>
              <span>- {brl(venda.desconto)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between text-lg font-black text-slate-900">
            <span>TOTAL</span>
            <span>{brl(venda.total)}</span>
          </div>
          <p className="mt-1 text-[11px] capitalize text-slate-500">
            Pagamento: {venda.pagamento === "prazo" ? "a prazo" : venda.pagamento}
          </p>
        </div>

        {/* Área fiscal */}
        {venda.fiscal && (
          <div className="mt-4 border-t border-dashed border-slate-300 pt-3 text-center">
            <p className="text-[9px] leading-tight text-slate-500">
              Consulte pela chave de acesso em www.nfce.fazenda.sp.gov.br
            </p>
            <p className="my-2 break-all font-mono text-[9px] leading-tight text-slate-700">
              {formatChave(venda.fiscal.chave)}
            </p>
            <div className="flex justify-center py-1">
              <FakeQR seed={venda.fiscal.chave} />
            </div>
            <p className="mt-2 text-[9px] text-emerald-700">
              ✓ Autorizado o uso da {venda.fiscal.modelo}
            </p>
            <p className="text-[9px] text-slate-500">
              Protocolo {venda.fiscal.protocolo} ·{" "}
              {new Date(venda.fiscal.autorizadaEm).toLocaleString("pt-BR")}
            </p>
          </div>
        )}

        {venda.observacao && (
          <p className="mt-3 border-t border-dashed border-slate-300 pt-2 text-[10px] text-slate-500">
            Obs.: {venda.observacao}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
            🖨 Imprimir
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </div>
  );
}
