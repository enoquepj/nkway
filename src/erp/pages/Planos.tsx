import { useState } from "react";
import { PLANOS, usePlan, type Plano } from "../plan";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { brl } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

export default function Planos() {
  const { plano, setPlano } = usePlan();
  const { emTrial, trialExpirado, diasRestantes, atualizar } = useAuth();
  const { db } = useStore();
  const [anual, setAnual] = useState(true);
  const [checkout, setCheckout] = useState<Plano | null>(null);

  const preco = (p: Plano) => (anual ? Math.round(p.preco * 0.8) : p.preco);

  const uso = [
    { label: "Produtos", atual: db.produtos.length, max: plano.limites.produtos },
    { label: "Clientes", atual: db.clientes.length, max: plano.limites.clientes },
    { label: "Vendas no mês", atual: db.vendas.length, max: plano.limites.vendasMes },
  ];

  return (
    <div>
      <PageHeader
        title="Planos e assinatura"
        subtitle="Preços e limites pensados para MEI, ME e Simples Nacional"
      />

      <Card className="mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Seu plano atual</p>
            <p className="text-xl font-bold text-slate-900">
              NKWAY {plano.nome}{" "}
              <span className="text-sm font-normal text-slate-500">
                {plano.preco === 0 ? "· gratuito para sempre" : `· ${brl(plano.preco)}/mês`}
              </span>
            </p>
          </div>
          {emTrial ? (
            <Badge tone="sky">
              🎁 Trial Pro · {diasRestantes} {diasRestantes === 1 ? "dia restante" : "dias restantes"}
            </Badge>
          ) : trialExpirado ? (
            <Badge tone="red">Trial encerrado</Badge>
          ) : plano.id === "free" ? (
            <Badge tone="amber">Limites ativos</Badge>
          ) : (
            <Badge tone="green">Assinatura ativa</Badge>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {uso.map((u) => {
            const pct = Math.min(100, (u.atual / u.max) * 100);
            return (
              <div key={u.label}>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{u.label}</span>
                  <span>
                    {u.atual} / {u.max >= 1e9 ? "∞" : u.max}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-400" : "bg-sky-500",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="mb-6 flex justify-center">
        <div className="flex items-center gap-1 rounded-lg bg-slate-200 p-1">
          <button
            onClick={() => setAnual(false)}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold transition", !anual ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
          >
            Mensal
          </button>
          <button
            onClick={() => setAnual(true)}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold transition", anual ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
          >
            Anual <span className="text-emerald-600">-20%</span>
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {PLANOS.map((p) => {
          const atual = p.id === plano.id;
          return (
            <Card
              key={p.id}
              className={cn(
                "relative flex flex-col p-6",
                p.destaque && "ring-2 ring-sky-500",
              )}
            >
              {p.destaque && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-sky-600 px-3 py-1 text-[11px] font-bold text-white">
                  MAIS POPULAR
                </span>
              )}
              <h3 className="text-lg font-bold text-slate-900">{p.nome}</h3>
              <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700">{p.publicoAlvo}</p>
              <p className="mt-1 min-h-[40px] text-sm text-slate-500">{p.descricao}</p>
              <p className="mt-4">
                <span className="text-4xl font-extrabold text-slate-900">
                  {p.preco === 0 ? "R$ 0" : brl(preco(p))}
                </span>
                <span className="text-sm text-slate-500">/mês</span>
              </p>
              {anual && p.preco > 0 && (
                <p className="text-xs text-emerald-600">
                  Cobrado {brl(preco(p) * 12)} por ano
                </p>
              )}

              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.recursos.map((r) => (
                  <li key={r} className="flex gap-2 text-slate-700">
                    <span className="text-emerald-500">✓</span> {r}
                  </li>
                ))}
                {p.naoInclui.map((r) => (
                  <li key={r} className="flex gap-2 text-slate-400">
                    <span>✕</span> {r}
                  </li>
                ))}
              </ul>

              <Button
                variant={atual ? "ghost" : p.destaque ? "primary" : "soft"}
                className="mt-6 w-full py-2.5"
                onClick={() => (p.preco === 0 ? setPlano("free") : setCheckout(p))}
              >
                {atual ? "Plano atual" : p.preco === 0 ? "Usar plano grátis" : "Assinar agora"}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6 p-6">
        <h3 className="mb-4 font-bold text-slate-900">Perguntas frequentes</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["O plano grátis expira?", "Não. Ele é gratuito para sempre, com limites de cadastro e de vendas mensais."],
            ["Posso cancelar quando quiser?", "Sim. A assinatura é mensal, sem fidelidade, e você mantém acesso até o fim do período pago."],
            ["Quais formas de pagamento?", "Cartão de crédito recorrente, Pix e boleto (plano anual)."],
            ["Meus dados ficam salvos?", "Sim, seus cadastros continuam disponíveis mesmo se você voltar para o plano grátis."],
          ].map(([q, a]) => (
            <div key={q}>
              <p className="text-sm font-semibold text-slate-800">{q}</p>
              <p className="text-sm text-slate-500">{a}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6 border-dashed border-amber-300 bg-amber-50/50 p-5">
        <p className="text-sm font-bold text-amber-800">🧪 Painel de testes (modo demonstração)</p>
        <p className="mt-1 text-xs text-amber-700">
          Use os atalhos abaixo para simular o ciclo de assinatura sem esperar dias reais.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => atualizar({ trialFim: Date.now() + 14 * 864e5, plano: "free" })}>
            Reiniciar trial (14 dias)
          </Button>
          <Button variant="ghost" onClick={() => atualizar({ trialFim: Date.now() + 2 * 864e5, plano: "free" })}>
            Faltam 2 dias (alerta)
          </Button>
          <Button variant="ghost" onClick={() => { atualizar({ trialFim: Date.now() - 864e5, plano: "free" }); setPlano("free"); }}>
            Expirar trial agora
          </Button>
        </div>
      </Card>

      {checkout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setCheckout(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Assinar NKWAY {checkout.nome}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {anual ? "Plano anual" : "Plano mensal"} ·{" "}
              <span className="font-semibold text-slate-800">
                {brl(preco(checkout))}/mês
              </span>
            </p>

            <div className="mt-5 space-y-3">
              <input placeholder="Nome no cartão" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              <input placeholder="0000 0000 0000 0000" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="MM/AA" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
                <input placeholder="CVV" className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              ⚠️ Demonstração: nenhum pagamento é processado. Em produção, conecte Stripe,
              Pagar.me ou Asaas para cobrança recorrente real.
            </p>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setCheckout(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  setPlano(checkout.id);
                  setCheckout(null);
                }}
              >
                Confirmar assinatura
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
