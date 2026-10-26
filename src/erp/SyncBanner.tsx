import { isCloud } from "../lib/supabase";
import { useStore } from "./store";
import { LIMITE_BYTES, usoStorageLabel } from "./syncErp";
import { cn } from "../utils/cn";

/** Uso do snapshot erp_estados (limite 10 MB/empresa) + ações de sync */
export default function SyncBanner() {
  const { syncBytes, syncMsg, syncSalvando, syncVersion, empurrarNuvem, puxarNuvem } = useStore();
  if (!isCloud) return null;

  const pct = Math.min(100, (syncBytes / LIMITE_BYTES) * 100);
  const critico = pct >= 90;
  const alerta = pct >= 75;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs",
        critico ? "border-rose-200 bg-rose-50 text-rose-900" : alerta ? "border-amber-200 bg-amber-50 text-amber-950" : "border-slate-200 bg-slate-50 text-slate-700",
      )}
    >
      <span className="font-semibold">Nuvem ERP</span>
      <span>
        {usoStorageLabel(syncBytes)}
        {syncVersion > 0 ? ` · v${syncVersion}` : ""}
        {syncSalvando ? " · salvando…" : ""}
      </span>
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/80">
        <div
          className={cn("h-full rounded-full", critico ? "bg-rose-500" : alerta ? "bg-amber-500" : "bg-emerald-500")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {critico && (
        <span className="font-medium">
          Limite de 10 MB quase cheio. Ao ultrapassar, o save na nuvem é recusado até reduzir dados.
        </span>
      )}
      {syncMsg && !critico && <span className="text-[11px] opacity-80">{syncMsg}</span>}
      <span className="ml-auto flex gap-2">
        <button type="button" onClick={() => void puxarNuvem()} className="font-semibold underline">
          Puxar
        </button>
        <button type="button" onClick={() => void empurrarNuvem(true)} className="font-semibold underline">
          Forçar save
        </button>
      </span>
    </div>
  );
}
