import { useState } from "react";
import { useStore } from "../store";
import type { ConfigFiscal } from "../types";
import { Button, Card, Field, PageHeader } from "../ui";

const REGIMES: { id: ConfigFiscal["regime"]; nome: string; crt: number; desc: string }[] = [
  { id: "simples", nome: "Simples Nacional", crt: 1, desc: "Para ME e EPP com receita até R$ 4,8 mi/ano. CSOSN padrão 101." },
  { id: "simples_excedente", nome: "SN com excesso", crt: 2, desc: "Simples com limite de receita excedido. Usa CST normal." },
  { id: "presumido", nome: "Lucro Presumido", crt: 3, desc: "Tributação por presunção de lucro. CST/CST com base reduzida." },
  { id: "real", nome: "Lucro Real", crt: 3, desc: "Apuração sobre lucro líquido ajustado. Todas as retenções." },
  { id: "mei", nome: "MEI / Simples MEI", crt: 4, desc: "MEI com DAS único. NF-e específica para MEI." },
];

export default function Configuracoes() {
  const { db, setConfigFiscal } = useStore();
  const [f, setF] = useState(db.configFiscal);
  const [salvo, setSalvo] = useState(false);

  function salvar() {
    setConfigFiscal(f);
    setSalvo(true);
    setTimeout(() => setSalvo(false), 2000);
  }

  const atual = REGIMES.find((r) => r.id === f.regime) ?? REGIMES[0];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Configurações fiscais"
        subtitle="Regime tributário e parâmetros de emissão de documentos"
      />

      <Card className="p-6">
        <h3 className="mb-4 text-sm font-bold uppercase text-slate-500">Regime tributário</h3>
        <div className="mb-6 space-y-2">
          {REGIMES.map((r) => (
            <label
              key={r.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition ${
                f.regime === r.id
                  ? "border-sky-500 bg-sky-50/50 ring-2 ring-sky-100"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                name="regime"
                checked={f.regime === r.id}
                onChange={() => setF({ ...f, regime: r.id, crt: r.crt })}
                className="mt-1 accent-sky-600"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{r.nome}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                    CRT {r.crt}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{r.desc}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="UF da empresa" value={f.ufPadrao} onChange={(e) => setF({ ...f, ufPadrao: e.target.value.toUpperCase() })} maxLength={2} />
          <Field label="Inscrição Estadual" value={f.ie ?? ""} onChange={(e) => setF({ ...f, ie: e.target.value })} />
          <Field label="Série NFC-e padrão" value={f.serieNfce ?? "1"} onChange={(e) => setF({ ...f, serieNfce: e.target.value })} />
          <Field label="Série NF-e padrão" value={f.serieNfe ?? "1"} onChange={(e) => setF({ ...f, serieNfe: e.target.value })} />
        </div>

        <div className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          <strong>⚠️ Importante:</strong> O regime tributário define quais campos fiscais o sistema exige no produto.
          No Simples Nacional, usa-se <b>CSOSN</b> (101, 102...). Nos demais regimes, <b>CST</b> (00, 20, 40...).
          Consulte seu contador antes de alterar.
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
          <p className="text-xs text-slate-500">
            Regime atual: <b>{atual.nome}</b> (CRT {atual.crt})
          </p>
          <div className="flex items-center gap-2">
            {salvo && <span className="text-sm font-medium text-emerald-600">✓ Salvo!</span>}
            <Button onClick={salvar}>Salvar configurações</Button>
          </div>
        </div>
      </Card>

      {/* ----------------------- Ambiente ----------------------- */}
      <Card className="mt-6 p-6">
        <h3 className="mb-4 text-sm font-bold uppercase text-slate-500">Ambiente SEFAZ</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition ${
            f.ambiente === 2 ? "border-amber-500 bg-amber-50/50 ring-2 ring-amber-100" : "border-slate-200 hover:bg-slate-50"
          }`}>
            <input
              type="radio"
              checked={f.ambiente === 2}
              onChange={() => setF({ ...f, ambiente: 2 })}
              className="accent-amber-600"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">Homologação</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">TESTES</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Não gera notas válidas — para testar o sistema.</p>
            </div>
          </label>
          <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition ${
            f.ambiente === 1 ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-100" : "border-slate-200 hover:bg-slate-50"
          }`}>
            <input
              type="radio"
              checked={f.ambiente === 1}
              onChange={() => setF({ ...f, ambiente: 1 })}
              className="accent-emerald-600"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">Produção</span>
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">VALE FISCAL</span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">Notas fiscais reais, com valor jurídico.</p>
            </div>
          </label>
        </div>
        <div className={`mt-4 rounded-lg p-3 text-sm font-medium ${
          f.ambiente === 2
            ? "bg-amber-50 text-amber-800"
            : "bg-rose-50 text-rose-800"
        }`}>
          {f.ambiente === 2
            ? "🧪 Ambiente atual: HOMOLOGAÇÃO — notas simuladas, sem valor fiscal."
            : "🔒 Ambiente atual: PRODUÇÃO — notas com valor jurídico. Configure certificado e CSC."}
        </div>
      </Card>

      {/* ----------------------- Certificado A1 ----------------------- */}
      <Card className="mt-6 p-6">
        <h3 className="mb-4 flex items-center justify-between text-sm font-bold uppercase text-slate-500">
          <span>Certificado Digital A1</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">NF-e / NFC-e</span>
        </h3>

        <div className="mb-4 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-5 text-center">
          <p className="text-2xl">🔐</p>
          <p className="text-sm font-semibold text-slate-800">Clique ou arraste o arquivo .pfx aqui</p>
          <p className="mt-1 text-xs text-slate-400">
            O certificado fica salvo localmente neste computador, com senha criptografada.
          </p>
          <input
            type="file"
            accept=".pfx,.p12"
            className="hidden"
            id="cert-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setF((prev) => ({
                ...prev,
                certificadoNome: file.name,
                certificadoValidade: new Date(
                  new Date().setFullYear(new Date().getFullYear() + 1),
                ).toISOString().slice(0, 10),
                certificadoSerial: crypto.randomUUID().toUpperCase().slice(0, 20),
              }));
            }}
          />
          <label htmlFor="cert-file" className="mt-3 inline-block cursor-pointer rounded-lg bg-sky-100 px-4 py-2 text-sm font-bold text-sky-700 hover:bg-sky-200">
            Escolher arquivo
          </label>
        </div>

        {f.certificadoNome && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Arquivo" value={f.certificadoNome} readOnly className="sm:col-span-2 bg-slate-50" />
            <Field label="Validade do certificado" type="date" value={f.certificadoValidade ?? ""} onChange={(e) => setF({ ...f, certificadoValidade: e.target.value })} />
            <Field label="Senha do certificado" type="password" placeholder="••••••••" />
            <Field label="Número de série" value={f.certificadoSerial ?? ""} readOnly className="sm:col-span-2 bg-slate-50" />
          </div>
        )}

        {f.certificadoValidade && (() => {
          const dias = Math.ceil(
            (new Date(f.certificadoValidade).getTime() - Date.now()) / 86400000,
          );
          return dias <= 30 ? (
            <div className={`mt-3 rounded-lg p-3 text-sm font-bold ${
              dias <= 7
                ? "bg-rose-50 text-rose-700"
                : "bg-amber-50 text-amber-700"
            }`}>
              {dias <= 0
                ? `⚠️ CERTIFICADO VENCIDO há ${Math.abs(dias)} dias — emissão fiscal bloqueada. Renove agora.`
                : dias <= 7
                  ? `⚠️ Certificado vence em ${dias} dias! Renovação urgente.`
                  : `⚠️ Certificado vence em ${dias} dias.`}
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
              ✓ Certificado válido por mais {dias} dias.
            </div>
          );
        })()}
      </Card>

      {/* ----------------------- CSC (NFC-e) ----------------------- */}
      <Card className="mt-6 p-6">
        <h3 className="mb-4 flex items-center justify-between text-sm font-bold uppercase text-slate-500">
          <span>CSC — Código de Segurança do Contribuinte</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">NFC-e modelo 65</span>
        </h3>
        <p className="mb-4 text-sm text-slate-600">
          Obrigatório para NFC-e. É gerado na SEFAZ do seu estado e usado para
          construir a URL do QR Code do cupom.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="ID do CSC"
            value={f.cscId ?? ""}
            onChange={(e) => setF({ ...f, cscId: e.target.value.replace(/\D/g, "").slice(0, 6) })}
            placeholder="000001"
          />
          <Field
            label="Token CSC (36 caracteres)"
            value={f.cscToken ?? ""}
            onChange={(e) => setF({ ...f, cscToken: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 36) })}
            placeholder="A1B2C3D4E5F6..."
          />
        </div>
        {f.cscToken && f.cscToken.length === 36 && f.cscId ? (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
            ✓ CSC configurado — QR Code autenticado pronto.
          </div>
        ) : f.cscToken || f.cscId ? (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            ⚠️ CSC incompleto — informe ID (6 dígitos) e Token (36 caracteres).
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
            🚫 CSC não configurado — NFC-e não autoriza em produção até informar na SEFAZ.
          </div>
        )}
      </Card>

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-5">
        {salvo && <span className="mr-2 text-sm font-medium text-emerald-600">✓ Salvo!</span>}
        <Button onClick={salvar}>Salvar configurações fiscais</Button>
      </div>
    </div>
  );
}
