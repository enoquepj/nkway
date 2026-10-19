import { useState } from "react";
import { useOffline } from "./useOffline";
import { brl } from "./types";
import { cn } from "../utils/cn";

export default function StatusConexao({
  empresaId,
  compacto = false,
}: {
  empresaId?: string;
  compacto?: boolean;
}) {
  const { online, fila, sincronizando, ultimoSync, sync } = useOffline(empresaId);
  const [aberto, setAberto] = useState(false);

  const pendentes = fila.length;
  const totalPendente = fila.reduce((s, f) => s + f.venda.total, 0);

  const cor = !online
    ? "bg-rose-50 text-rose-700 ring-rose-200"
    : pendentes > 0
      ? "bg-amber-50 text-amber-700 ring-amber-200"
      : "bg-emerald-50 text-emerald-700 ring-emerald-200";

  const rotulo = !online
    ? "Offline"
    : sincronizando
      ? "Sincronizando..."
      : pendentes > 0
        ? `${pendentes} para enviar`
        : "Sincronizado";

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((a) => !a)}
        className={cn(
          "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition",
          cor,
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full",
            !online ? "bg-rose-500" : pendentes > 0 ? "bg-amber-500 animate-pulse" : "bg-emerald-500",
          )}
        />
        {compacto ? (!online ? "Offline" : pendentes || "OK") : rotulo}
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-900">
                {online ? "Conectado" : "Sem conexão"}
              </p>
              <span className={cn("h-2.5 w-2.5 rounded-full", online ? "bg-emerald-500" : "bg-rose-500")} />
            </div>

            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {online
                ? "As vendas são enviadas automaticamente ao servidor."
                : "Você pode continuar vendendo normalmente. As vendas ficam salvas no caixa e sobem sozinhas quando a internet voltar."}
            </p>

            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="flex justify-between text-xs text-slate-500">
                <span>Vendas na fila</span>
                <span className="font-bold text-slate-900">{pendentes}</span>
              </div>
              {pendentes > 0 && (
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>Valor retido</span>
                  <span className="font-bold text-slate-900">{brl(totalPendente)}</span>
                </div>
              )}
              {ultimoSync && (
                <p className="mt-2 text-[10px] text-slate-400">
                  Último envio: {new Date(ultimoSync).toLocaleTimeString("pt-BR")}
                </p>
              )}
            </div>

            {pendentes > 0 && (
              <ul className="mt-3 max-h-32 space-y-1 overflow-auto">
                {fila.slice(0, 6).map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-xs">
                    <span className="truncate text-slate-600">
                      {f.venda.tipo === "dav" ? "DAV" : "Nota"} #{f.venda.numero}
                    </span>
                    <span className="text-slate-400">
                      {f.tentativas > 0 ? `${f.tentativas} tentativas` : "aguardando"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <button
              onClick={sync}
              disabled={!online || sincronizando || pendentes === 0}
              className="mt-3 w-full rounded-lg bg-sky-600 py-2 text-xs font-bold text-white transition hover:bg-sky-700 disabled:opacity-40"
            >
              {sincronizando ? "Enviando..." : "Sincronizar agora"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
