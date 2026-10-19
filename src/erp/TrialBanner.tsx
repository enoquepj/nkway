import { useAuth } from "./auth";
import { usePlan } from "./plan";
import { cn } from "../utils/cn";

export default function TrialBanner({ onUpgrade }: { onUpgrade: () => void }) {
  const { diasRestantes, emTrial, trialExpirado } = useAuth();
  const { plano } = usePlan();

  if (!emTrial && !trialExpirado) return null;
  if (plano.id !== "pro" && !trialExpirado) return null;

  const urgente = diasRestantes <= 3;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium text-white",
        trialExpirado ? "bg-rose-600" : urgente ? "bg-amber-500" : "bg-sky-600",
      )}
    >
      <span className="flex items-center gap-2">
        {trialExpirado ? (
          <>⚠️ Seu teste grátis terminou. O sistema voltou para o plano Grátis com limites reduzidos.</>
        ) : (
          <>
            🎁 Teste do plano <b>Pro</b> — restam{" "}
            <b>{diasRestantes} {diasRestantes === 1 ? "dia" : "dias"}</b>. Sem cartão de crédito.
          </>
        )}
      </span>
      <button
        onClick={onUpgrade}
        className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-bold backdrop-blur transition hover:bg-white/30"
      >
        {trialExpirado ? "Reativar agora →" : "Assinar e manter os recursos →"}
      </button>
    </div>
  );
}
