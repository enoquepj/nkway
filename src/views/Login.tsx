"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Campo, Icon, Input, Select, cn } from "@/components/ui";
import { cadastrar, entrar } from "@/server/acoes/auth";
import { UFS, PLANOS_CFG, mascaraDocumento, soDigitos } from "@/lib/dominio";

type Aba = "entrar" | "criar";

const DEMO = { email: "demo@nkway.com.br", senha: "nkway123" };

export function LoginView({ temDemo }: { temDemo: boolean }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>("entrar");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({
    email: temDemo ? DEMO.email : "",
    senha: temDemo ? DEMO.senha : "",
  });
  const [novo, setNovo] = useState({
    empresa: "",
    cnpj: "",
    uf: "RO",
    municipio: "Ji-Paraná",
    regime: "mei",
    porte: "MEI",
    nome: "",
    email: "",
    senha: "",
    comCatalogo: true,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setN = <K extends keyof typeof novo>(k: K, v: (typeof novo)[K]) => setNovo((f) => ({ ...f, [k]: v }));

  async function submeter() {
    setErro("");
    setOcupado(true);
    try {
      if (aba === "entrar") {
        const r = await entrar(form);
        if (!r.ok) return setErro(r.erro);
        router.push("/");
        router.refresh();
      } else {
        const r = await cadastrar({ ...novo, cnpj: soDigitos(novo.cnpj), email: novo.email });
        if (!r.ok) return setErro(r.erro);
        router.push("/");
        router.refresh();
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao acessar o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "linear-gradient(transparent 0 31px, rgba(255,255,255,.08) 31px 32px), linear-gradient(90deg, transparent 0 31px, rgba(255,255,255,.08) 31px 32px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-way-500 text-[17px] font-black text-ink-900">N</span>
            <div>
              <p className="text-[17px] font-extrabold tracking-tight">NKWAY</p>
              <p className="micro text-ink-400">ERP · PDV · Fiscal para pequenos negócios</p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-[30px] font-bold leading-[1.1] tracking-[-0.02em]">
            A loja fecha o caixa e a nota sai.
            <span className="block text-way-300">Sem planilha, sem papel solto.</span>
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-300">
            Frente de caixa com pagamento dividido, DAV com validade, NFC-e/NF-e em homologação, entrada de mercadoria por XML da
            SEFAZ com custo médio ponderado, kardex completo e financeiro com baixa de títulos.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12.5px] text-ink-200">
            {[
              "PDV por teclado (↑ ↓ Enter F10)",
              "Entrada por XML, chave SEFAZ ou manual",
              "Estoque com custo médio e inventário",
              "Curva ABC e relatórios com CSV",
              "MDF-e com DAMDFE e encerramento",
              "Multiempresa com dados isolados",
            ].map((t) => (
              <li key={t} className="flex items-start gap-2">
                <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-way-400" strokeWidth={2.4} />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-3 text-[11.5px] text-ink-400">
          <Badge tom="ok">v2 · fullstack</Badge>
          <span>Next.js + PostgreSQL (Drizzle) · portabilidade do protótipo Vite/Supabase</span>
        </div>
      </div>

      <div className="flex items-center justify-center bg-[#eef0f4] px-4 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-way-600 font-black text-white">N</span>
            <p className="text-[15px] font-extrabold tracking-tight text-ink-900">NKWAY</p>
          </div>

          <div className="rounded-2xl border border-ink-100 bg-white p-5 shadow-[0_20px_50px_-30px_rgba(16,24,40,.5)]">
            <div className="mb-4 flex rounded-lg bg-ink-50 p-1">
              {(["entrar", "criar"] as Aba[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setAba(a);
                    setErro("");
                  }}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[13px] font-semibold transition",
                    aba === a ? "bg-white text-ink-900 shadow-sm" : "text-ink-400 hover:text-ink-600",
                  )}
                >
                  {a === "entrar" ? "Entrar" : "Criar empresa"}
                </button>
              ))}
            </div>

            {aba === "entrar" ? (
              <div className="space-y-3">
                <Campo rotulo="E-mail" obrigatorio>
                  <Input type="email" autoComplete="username" valor={form.email} aoMudar={(v) => set("email", v)} placeholder="voce@loja.com.br" />
                </Campo>
                <Campo rotulo="Senha" obrigatorio>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    valor={form.senha}
                    aoMudar={(v) => set("senha", v)}
                    placeholder="••••••"
                    onKeyDown={(e) => e.key === "Enter" && submeter()}
                  />
                </Campo>
              </div>
            ) : (
              <div className="space-y-3">
                <Campo rotulo="Razão social" obrigatorio>
                  <Input valor={novo.empresa} aoMudar={(v) => setN("empresa", v)} placeholder="COMERCIAL SÃO JORGE LTDA" />
                </Campo>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="CNPJ" obrigatorio>
                    <Input
                      valor={novo.cnpj}
                      aoMudar={(v) => setN("cnpj", mascaraDocumento(v))}
                      placeholder="00.000.000/0000-00"
                      inputMode="numeric"
                    />
                  </Campo>
                  <Campo rotulo="Porte / regime">
                    <Select
                      valor={novo.regime}
                      aoMudar={(v) => {
                        const [porte, regime] = v.split("|");
                        setN("porte", porte);
                        setN("regime", regime);
                      }}
                      opcoes={[
                        { valor: "MEI|mei", rotulo: "MEI · SNEI" },
                        { valor: "ME|simples", rotulo: "ME · Simples Nacional" },
                        { valor: "ME|presumido", rotulo: "ME · Presumido" },
                        { valor: "EPP|presumido", rotulo: "EPP · Presumido" },
                      ]}
                    />
                  </Campo>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="UF">
                    <Select valor={novo.uf} aoMudar={(v) => setN("uf", v)} opcoes={Object.keys(UFS).map((uf) => ({ valor: uf, rotulo: uf }))} />
                  </Campo>
                  <Campo rotulo="Município">
                    <Input valor={novo.municipio} aoMudar={(v) => setN("municipio", v)} placeholder="Ji-Paraná" />
                  </Campo>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Campo rotulo="Seu nome">
                    <Input valor={novo.nome} aoMudar={(v) => setN("nome", v)} placeholder="Proprietário" />
                  </Campo>
                  <Campo rotulo="E-mail de acesso" obrigatorio>
                    <Input type="email" valor={novo.email} aoMudar={(v) => setN("email", v)} placeholder="voce@loja.com.br" />
                  </Campo>
                </div>
                <Campo rotulo="Senha de acesso" obrigatorio dica="Mínimo de 6 caracteres.">
                  <Input type="password" valor={novo.senha} aoMudar={(v) => setN("senha", v)} placeholder="••••••" />
                </Campo>
                <label className="flex items-start gap-2 rounded-lg bg-ink-50 p-2.5 text-[12px] text-ink-600">
                  <input
                    type="checkbox"
                    checked={novo.comCatalogo}
                    onChange={(e) => setN("comCatalogo", e.target.checked)}
                    className="mt-0.5 size-3.5 accent-way-600"
                  />
                  <span>
                    Criar catálogo inicial de mercearia (17 produtos), 3 clientes e 2 fornecedores para eu começar operando hoje.
                  </span>
                </label>
                <p className="text-[11.5px] leading-snug text-ink-400">
                  O acesso começa no trial do plano <b className="text-ink-600">{PLANOS_CFG[1].nome}</b> por 14 dias: notas fiscais,
                  entrada por XML e financeiro liberados.
                </p>
              </div>
            )}

            {erro && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-2 text-[12px] font-medium text-rose-700">
                <Icon name="alerta" className="mt-px size-3.5 shrink-0" />
                {erro}
              </p>
            )}

            <Button className="mt-4 w-full" onClick={submeter} disabled={ocupado} icone={ocupado ? "atualizar" : "seta"}>
              {ocupado ? "Aguarde…" : aba === "entrar" ? "Entrar no sistema" : "Criar conta e entrar"}
            </Button>

            {aba === "entrar" && temDemo && (
              <p className="mt-3 text-center text-[11.5px] text-ink-400">
                Ambiente de demonstração já populado ·{" "}
                <button
                  type="button"
                  className="font-semibold text-way-700 underline decoration-way-200 hover:decoration-way-600"
                  onClick={() => {
                    set("email", DEMO.email);
                    set("senha", DEMO.senha);
                  }}
                >
                  usar {DEMO.email}
                </button>
              </p>
            )}
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-400">
            Dados por empresa com isolamento no Postgres. A emissão fiscal é simulada — para valor jurídico, integre um emissor
            homologado com certificado A1.
          </p>
        </div>
      </div>
    </div>
  );
}
