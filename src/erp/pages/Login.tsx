import { useState } from "react";
import { TRIAL_DIAS, useAuth } from "../auth";

export default function Login() {
  const { entrar, cadastrar } = useAuth();
  const [modo, setModo] = useState<"login" | "signup">("signup");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [f, setF] = useState({
    empresa: "",
    cnpj: "",
    nome: "",
    email: "",
    senha: "",
    porte: "mei" as "mei" | "me" | "epp" | "outros",
    regime: "mei" as "mei" | "simples" | "simples_excedente" | "presumido" | "real",
    uf: "SP",
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const r =
      modo === "login"
        ? await entrar(f.email, f.senha)
        : await cadastrar({
            empresa: f.empresa || "Minha Empresa",
            cnpj: f.cnpj,
            nome: f.nome || "Administrador",
            email: f.email,
            senha: f.senha,
            porte: f.porte,
            regime: f.porte === "mei" ? "mei" : f.regime === "mei" ? "simples" : f.regime,
            uf: f.uf,
          });
    setErro(r);
    setEnviando(false);
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100";

  return (
    <div className="flex min-h-screen">
      {/* Painel esquerdo */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_10%,rgba(14,165,233,0.35),transparent)]" />
        <div className="relative flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 text-lg font-black">
            N
          </div>
          <span className="text-lg font-black tracking-tight">NKWAY</span>
        </div>

        <div className="relative">
          <h1 className="text-4xl font-extrabold leading-tight">
            Toda a gestão do seu negócio em um só lugar.
          </h1>
          <p className="mt-4 max-w-md text-slate-300">
            PDV com DAV e emissão fiscal, estoque, clientes e financeiro. Comece hoje com{" "}
            <b className="text-sky-300">{TRIAL_DIAS} dias grátis do plano Pro</b> — sem cartão de crédito.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            {[
              "Feito para MEI, ME e Simples Nacional",
              "PDV, DAV, estoque e financeiro em um só lugar",
              "Entrada de mercadoria e preparação para NFC-e",
              "Nuvem Supabase opcional — seus dados em qualquer PC",
              "14 dias de trial Pro, sem cartão",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="text-emerald-400">✓</span> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex gap-6 text-xs text-slate-400">
          <span>🔒 Dados criptografados</span>
          <span>🇧🇷 Suporte em português</span>
        </div>
      </div>

      {/* Formulário */}
      <div className="flex w-full items-center justify-center bg-slate-100 p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 font-black text-white">
              N
            </div>
            <span className="text-lg font-black tracking-tight text-slate-900">NKWAY</span>
          </div>

          <div className="mb-5 flex gap-1 rounded-lg bg-slate-200 p-1">
            {(["signup", "login"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setModo(m); setErro(null); }}
                className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold transition ${
                  modo === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                }`}
              >
                {m === "signup" ? "Criar conta" : "Entrar"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">
              {modo === "signup" ? `Teste ${TRIAL_DIAS} dias grátis` : "Bem-vindo de volta"}
            </h2>
            <p className="mb-5 text-sm text-slate-500">
              {modo === "signup"
                ? "Sem cartão de crédito. Acesso completo ao Pro."
                : "Acesse o painel da sua empresa."}
            </p>

            <div className="space-y-3">
              {modo === "signup" && (
                <>
                  <input className={input} placeholder="Nome da empresa / nome fantasia" value={f.empresa} onChange={set("empresa")} />
                  <input className={input} placeholder="CNPJ (opcional no trial)" value={f.cnpj} onChange={set("cnpj")} />
                  <input className={input} placeholder="Seu nome" value={f.nome} onChange={set("nome")} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs font-medium text-slate-600">
                      Porte
                      <select
                        className={input + " mt-1"}
                        value={f.porte}
                        onChange={(e) => {
                          const porte = e.target.value as typeof f.porte;
                          setF({
                            ...f,
                            porte,
                            regime: porte === "mei" ? "mei" : f.regime === "mei" ? "simples" : f.regime,
                          });
                        }}
                      >
                        <option value="mei">MEI</option>
                        <option value="me">ME (Microempresa)</option>
                        <option value="epp">EPP</option>
                        <option value="outros">Outros</option>
                      </select>
                    </label>
                    <label className="block text-xs font-medium text-slate-600">
                      UF
                      <input className={input + " mt-1"} maxLength={2} value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} />
                    </label>
                  </div>
                  {f.porte !== "mei" && (
                    <label className="block text-xs font-medium text-slate-600">
                      Regime tributário
                      <select
                        className={input + " mt-1"}
                        value={f.regime}
                        onChange={(e) => setF({ ...f, regime: e.target.value as typeof f.regime })}
                      >
                        <option value="simples">Simples Nacional</option>
                        <option value="simples_excedente">Simples com excesso</option>
                        <option value="presumido">Lucro Presumido</option>
                        <option value="real">Lucro Real</option>
                      </select>
                    </label>
                  )}
                  {f.porte === "mei" && (
                    <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11px] text-sky-800">
                      MEI: regime e CRT 4 aplicados automaticamente. DAS e limites de faturamento do MEI continuam sendo
                      obrigação sua com o contador — o NKWAY organiza a loja e o caixa.
                    </p>
                  )}
                </>
              )}
              <input className={input} type="email" required placeholder="E-mail" value={f.email} onChange={set("email")} />
              <input className={input} type="password" required placeholder="Senha" value={f.senha} onChange={set("senha")} />
            </div>

            {erro && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{erro}</p>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="mt-5 w-full rounded-lg bg-sky-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 active:scale-95 disabled:opacity-60"
            >
              {enviando
                ? "Processando..."
                : modo === "signup"
                  ? `Começar teste de ${TRIAL_DIAS} dias`
                  : "Entrar no sistema"}
            </button>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
              Ao continuar você aceita os Termos de Uso e a Política de Privacidade.
              Demonstração: os dados ficam apenas neste navegador.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
