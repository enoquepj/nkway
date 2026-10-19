import { useEffect, useMemo, useState } from "react";
import { restaurarSenhaPadrao, trocarSenha, usandoSenhaPadrao } from "../dev/devAuth";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { usePlan, PLANOS, type PlanId } from "../plan";
import { modo as modoApp } from "../../lib/supabase";
import { rodarTestes, type Resultado } from "../dev/testes";
import { filaAtual, limparFila } from "../offline";
import { brl } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

const ABAS = [
  ["testes", "✅ Testes de módulo"],
  ["estado", "🗄️ Inspetor de estado"],
  ["ambiente", "⚙️ Ambiente"],
  ["simular", "🧪 Simuladores"],
] as const;

type Aba = (typeof ABAS)[number][0];

export default function DevConsole() {
  const { db, reset } = useStore();
  const { conta, atualizar } = useAuth();
  const { plano, setPlano } = usePlan();
  const [aba, setAba] = useState<Aba>("testes");
  const [tabela, setTabela] = useState<keyof typeof db>("produtos");
  const [exec, setExec] = useState(0);
  const [sAtual, setSAtual] = useState("");
  const [sNova, setSNova] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [padrao, setPadrao] = useState(false);

  useEffect(() => {
    void usandoSenhaPadrao().then(setPadrao);
  }, []);

  const resultados = useMemo<Resultado[]>(() => rodarTestes(db), [db, exec]);

  const porModulo = useMemo(() => {
    const m = new Map<string, Resultado[]>();
    resultados.forEach((r) => m.set(r.modulo, [...(m.get(r.modulo) ?? []), r]));
    return [...m.entries()];
  }, [resultados]);

  const total = resultados.length;
  const passou = resultados.filter((r) => r.passou).length;
  const falhasCriticas = resultados.filter((r) => !r.passou && r.critico).length;
  const pct = Math.round((passou / total) * 100);

  const fila = filaAtual();

  return (
    <div>
      <PageHeader
        title="Console do desenvolvedor"
        subtitle="Verificação automatizada de cada módulo, inspeção de estado e simuladores"
        action={<Button onClick={() => setExec((x) => x + 1)}>▶ Rodar testes</Button>}
      />

      {/* Placar */}
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Card className={cn("border-l-4 p-4", falhasCriticas ? "border-l-rose-500" : "border-l-emerald-500")}>
          <p className="text-xs uppercase text-slate-500">Saúde geral</p>
          <p className={cn("mt-1 text-2xl font-bold", falhasCriticas ? "text-rose-600" : "text-emerald-600")}>
            {pct}%
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn("h-full rounded-full", falhasCriticas ? "bg-rose-500" : "bg-emerald-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Testes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{passou}/{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Falhas críticas</p>
          <p className={cn("mt-1 text-2xl font-bold", falhasCriticas ? "text-rose-600" : "text-slate-900")}>
            {falhasCriticas}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase text-slate-500">Modo de dados</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {modoApp === "cloud" ? "☁️ Nuvem" : "💾 Local"}
          </p>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {ABAS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* --------------------------------------------------------- TESTES */}
      {aba === "testes" && (
        <div className="space-y-4">
          {porModulo.map(([modulo, lista]) => {
            const okCount = lista.filter((l) => l.passou).length;
            const tudoOk = okCount === lista.length;
            return (
              <Card key={modulo} className="overflow-hidden">
                <div className={cn("flex items-center justify-between px-5 py-3", tudoOk ? "bg-emerald-50" : "bg-rose-50")}>
                  <h3 className="font-bold text-slate-900">{modulo}</h3>
                  <Badge tone={tudoOk ? "green" : "red"}>
                    {okCount}/{lista.length} {tudoOk ? "OK" : "com falha"}
                  </Badge>
                </div>
                <ul className="divide-y divide-slate-100">
                  {lista.map((t) => (
                    <li key={t.id} className="flex items-start gap-3 px-5 py-2.5">
                      <span className={cn("mt-0.5 text-sm", t.passou ? "text-emerald-500" : "text-rose-500")}>
                        {t.passou ? "✓" : "✕"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">
                          {t.nome}
                          {t.critico && !t.passou && (
                            <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
                              CRÍTICO
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{t.detalhe}</p>
                      </div>
                      <code className="text-[10px] text-slate-300">{t.id}</code>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {/* --------------------------------------------------------- ESTADO */}
      {aba === "estado" && (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(Object.keys(db) as (keyof typeof db)[]).map((k) => (
              <button
                key={k}
                onClick={() => setTabela(k)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  tabela === k ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}
              >
                {k} <span className="opacity-60">({(db[k] as unknown[]).length})</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `nkway-estado-${Date.now()}.json`;
                a.click();
              }}
            >
              ⬇ Exportar JSON
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(db[tabela], null, 2))}
            >
              📋 Copiar tabela
            </Button>
          </div>

          <pre className="mt-4 max-h-[460px] overflow-auto rounded-lg bg-slate-900 p-4 text-[11px] leading-relaxed text-emerald-300">
            {JSON.stringify(db[tabela], null, 2)}
          </pre>
        </Card>
      )}

      {/* ------------------------------------------------------- AMBIENTE */}
      {aba === "ambiente" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-3 font-bold text-slate-900">Runtime</h3>
            <dl className="space-y-2 text-sm">
              {[
                ["Modo de dados", modoApp === "cloud" ? "Supabase (nuvem)" : "localStorage (demo)"],
                ["Supabase URL", import.meta.env.VITE_SUPABASE_URL ? "configurada" : "não configurada"],
                ["Service Worker", "serviceWorker" in navigator ? "suportado" : "indisponível"],
                ["Conexão", navigator.onLine ? "online" : "offline"],
                ["Fila de sync", `${fila.length} venda(s)`],
                ["Idioma", navigator.language],
                ["Build", import.meta.env.MODE],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 pb-1.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5">
            <h3 className="mb-3 font-bold text-slate-900">Sessão e plano</h3>
            <dl className="space-y-2 text-sm">
              {[
                ["Empresa", conta?.empresa ?? "—"],
                ["CNPJ", conta?.cnpj || "—"],
                ["Usuário", conta?.nome ?? "—"],
                ["E-mail", conta?.email ?? "—"],
                ["Plano efetivo", plano.nome],
                ["Limite produtos", String(plano.limites.produtos)],
                ["Trial até", conta ? new Date(conta.trialFim).toLocaleString("pt-BR") : "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-slate-100 pb-1.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="truncate pl-3 font-medium text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-3 font-bold text-slate-900">Chaves no localStorage</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400">
                  <tr><th className="py-1">Chave</th><th className="py-1 text-right">Tamanho</th><th className="py-1"></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.keys(localStorage)
                    .filter((k) => k.startsWith("nkway"))
                    .map((k) => (
                      <tr key={k}>
                        <td className="py-1.5 font-mono text-slate-700">{k}</td>
                        <td className="py-1.5 text-right text-slate-500">
                          {((localStorage.getItem(k)?.length ?? 0) / 1024).toFixed(1)} KB
                        </td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => { localStorage.removeItem(k); location.reload(); }}
                            className="text-rose-500 hover:underline"
                          >
                            remover
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------ SIMULADORES */}
      {aba === "simular" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <h3 className="mb-1 font-bold text-slate-900">Planos</h3>
            <p className="mb-3 text-xs text-slate-500">Troca o plano efetivo para testar paywalls.</p>
            <div className="flex flex-wrap gap-2">
              {PLANOS.map((p) => (
                <Button
                  key={p.id}
                  variant={plano.id === p.id ? "primary" : "ghost"}
                  onClick={() => setPlano(p.id as PlanId)}
                >
                  {p.nome}
                </Button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 font-bold text-slate-900">Trial</h3>
            <p className="mb-3 text-xs text-slate-500">Simula o ciclo de 14 dias.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => atualizar({ trialFim: Date.now() + 14 * 864e5, plano: "free" })}>
                14 dias
              </Button>
              <Button variant="ghost" onClick={() => atualizar({ trialFim: Date.now() + 2 * 864e5, plano: "free" })}>
                2 dias
              </Button>
              <Button variant="ghost" onClick={() => atualizar({ trialFim: Date.now() - 864e5, plano: "free" })}>
                Expirado
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 font-bold text-slate-900">Fila offline</h3>
            <p className="mb-3 text-xs text-slate-500">
              {fila.length} venda(s) aguardando · {brl(fila.reduce((s, f) => s + f.venda.total, 0))}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => { limparFila(); setExec((x) => x + 1); }}>
                Limpar fila
              </Button>
            </div>
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">
              Para testar offline: <b>F12 → Network → Offline</b>, faça vendas e volte a conectar.
            </p>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-1 font-bold text-slate-900">🔐 Senha do console</h3>
            <p className="mb-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              {padrao ? (
                <>
                  🔑 Em uso: <b>senha definitiva do desenvolvedor</b> (definida no código).
                  Você pode substituí-la por uma pessoal abaixo.
                </>
              ) : (
                <>✓ Em uso: senha personalizada deste navegador.</>
              )}
            </p>
            {!padrao && (
              <button
                onClick={async () => {
                  await restaurarSenhaPadrao();
                  setPadrao(true);
                  setMsg("✓ Senha restaurada para a definitiva do código.");
                }}
                className="mb-3 text-xs font-semibold text-sky-600 hover:underline"
              >
                ↺ Restaurar senha definitiva
              </button>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                type="password"
                placeholder="Senha atual"
                value={sAtual}
                onChange={(e) => setSAtual(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <input
                type="password"
                placeholder="Nova senha (mín. 8)"
                value={sNova}
                onChange={(e) => setSNova(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
              <Button
                onClick={async () => {
                  const r = await trocarSenha(sAtual, sNova);
                  setMsg(r ?? "✓ Senha alterada com sucesso.");
                  if (!r) { setSAtual(""); setSNova(""); setPadrao(false); }
                }}
              >
                Alterar senha
              </Button>
            </div>
            {msg && (
              <p className={cn("mt-2 text-xs font-medium", msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600")}>
                {msg}
              </p>
            )}
            <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-500">
              A senha é guardada como <b>hash SHA-256</b> no navegador, com bloqueio de
              5 minutos após 5 erros. Isso impede acesso acidental, mas <b>não é segurança
              real</b> — para produção, controle o acesso pelo servidor (papel do usuário
              no Supabase).
            </p>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 font-bold text-slate-900">Base de dados</h3>
            <p className="mb-3 text-xs text-slate-500">Restaura o seed de demonstração.</p>
            <Button variant="danger" onClick={() => confirm("Restaurar dados de demonstração?") && reset()}>
              ↺ Resetar base
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
