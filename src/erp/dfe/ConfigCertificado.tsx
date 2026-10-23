import { useCallback, useEffect, useState } from "react";
import { supabase, isCloud } from "../../lib/supabase";
import { Button, Card, Field, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

type Empresa = {
  id: string;
  cnpj: string;
  razao_social: string;
  certificado_path: string | null;
  ultimo_nsu: string;
  max_nsu: string;
  ambiente: number;
  ativo: boolean;
  ultima_consulta_em: string | null;
  ultimo_cstat: string | null;
  ultimo_xmotivo: string | null;
};

function onlyDigits(s: string) {
  return s.replace(/\D/g, "");
}

function formatCnpj(c: string) {
  const d = onlyDigits(c).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Cadastro de empresa destinatária + upload do certificado A1 (.pfx).
 * A senha nunca fica em texto puro no banco (RPC dfe_salvar_empresa + pgcrypto).
 */
export default function ConfigCertificado() {
  const [cnpj, setCnpj] = useState("");
  const [razao, setRazao] = useState("");
  const [senha, setSenha] = useState("");
  const [ambiente, setAmbiente] = useState<1 | 2>(1);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro" | "info"; texto: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [lista, setLista] = useState<Empresa[]>([]);

  const carregar = useCallback(async () => {
    if (!supabase || !isCloud) return;
    const { data, error } = await supabase
      .from("empresas_config")
      .select(
        "id,cnpj,razao_social,certificado_path,ultimo_nsu,max_nsu,ambiente,ativo,ultima_consulta_em,ultimo_cstat,ultimo_xmotivo",
      )
      .order("created_at", { ascending: false });
    if (error) {
      setMsg({ tipo: "erro", texto: error.message });
      return;
    }
    setLista((data as Empresa[]) || []);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!isCloud || !supabase) {
      setMsg({
        tipo: "erro",
        texto: "Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e rode a migration DF-e.",
      });
      return;
    }

    const cnpj14 = onlyDigits(cnpj);
    if (cnpj14.length !== 14) {
      setMsg({ tipo: "erro", texto: "CNPJ deve ter 14 dígitos." });
      return;
    }
    if (!arquivo) {
      setMsg({ tipo: "erro", texto: "Selecione o arquivo .pfx (certificado A1)." });
      return;
    }
    if (!senha) {
      setMsg({ tipo: "erro", texto: "Informe a senha do certificado." });
      return;
    }

    setLoading(true);
    try {
      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser();
      if (authErr || !user) {
        setMsg({ tipo: "erro", texto: "Faça login no Supabase Auth para enviar o certificado." });
        setLoading(false);
        return;
      }

      const path = `${user.id}/${cnpj14}-${Date.now()}.pfx`;
      const { error: upErr } = await supabase.storage.from("certificados-a1").upload(path, arquivo, {
        contentType: "application/x-pkcs12",
        upsert: true,
      });
      if (upErr) throw new Error(`Storage: ${upErr.message}`);

      const { data, error: rpcErr } = await supabase.rpc("dfe_salvar_empresa", {
        p_cnpj: cnpj14,
        p_razao: razao.trim(),
        p_cert_path: path,
        p_senha_plain: senha,
        p_ambiente: ambiente,
      });
      if (rpcErr) throw new Error(rpcErr.message);

      setMsg({
        tipo: "ok",
        texto: `Empresa ${formatCnpj(cnpj14)} salva. O cron DF-e usará este A1 (id ${data?.id ?? "—"}).`,
      });
      setSenha("");
      setArquivo(null);
      await carregar();
    } catch (err) {
      setMsg({ tipo: "erro", texto: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificado A1 · DF-e"
        subtitle="Upload seguro do .pfx e cadastro da empresa destinatária (NfeDistDFeInteresse)"
      />

      {!isCloud && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Modo demo local: defina <code className="text-xs">VITE_SUPABASE_URL</code> e{" "}
          <code className="text-xs">VITE_SUPABASE_ANON_KEY</code>, aplique{" "}
          <code className="text-xs">supabase/migrations/20260322_dfe_distribuicao.sql</code> e autentique o usuário.
        </div>
      )}

      <Card className="p-5">
        <form onSubmit={salvar} className="grid gap-4 sm:grid-cols-2">
          <Field
            label="CNPJ"
            value={cnpj}
            onChange={(e) => setCnpj(formatCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            required
          />
          <Field
            label="Razão social"
            value={razao}
            onChange={(e) => setRazao(e.target.value)}
            placeholder="Empresa LTDA"
          />
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Certificado digital A1 (.pfx)</span>
            <input
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700"
            />
            {arquivo && (
              <span className="mt-1 block text-xs text-slate-500">
                {arquivo.name} · {(arquivo.size / 1024).toFixed(1)} KB
              </span>
            )}
          </label>
          <Field
            label="Senha do certificado"
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="new-password"
            required
          />
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Ambiente SEFAZ</span>
            <select
              value={ambiente}
              onChange={(e) => setAmbiente(Number(e.target.value) as 1 | 2)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
            >
              <option value={1}>1 — Produção</option>
              <option value={2}>2 — Homologação</option>
            </select>
          </label>

          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" className={loading ? "opacity-70" : ""}>
              {loading ? "Enviando…" : "Salvar certificado e empresa"}
            </Button>
            <p className="text-xs text-slate-500">
              A senha é cifrada no Postgres (pgcrypto). O .pfx vai ao bucket privado{" "}
              <code className="text-[10px]">certificados-a1</code>.
            </p>
          </div>
        </form>

        {msg && (
          <div
            className={cn(
              "mt-4 rounded-lg px-3 py-2 text-sm",
              msg.tipo === "ok" && "bg-emerald-50 text-emerald-800",
              msg.tipo === "erro" && "bg-rose-50 text-rose-800",
              msg.tipo === "info" && "bg-sky-50 text-sky-800",
            )}
          >
            {msg.texto}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800">Empresas configuradas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">CNPJ</th>
                <th className="px-4 py-2">Razão</th>
                <th className="px-4 py-2">NSU</th>
                <th className="px-4 py-2">Última consulta</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-2 font-mono text-xs">{formatCnpj(e.cnpj)}</td>
                  <td className="px-4 py-2">{e.razao_social || "—"}</td>
                  <td className="px-4 py-2 font-mono text-[11px] text-slate-600">
                    {e.ultimo_nsu}
                    <span className="text-slate-400"> / {e.max_nsu}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {e.ultima_consulta_em ? new Date(e.ultima_consulta_em).toLocaleString("pt-BR") : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className={e.ativo ? "text-emerald-700" : "text-slate-400"}>
                      {e.ativo ? "Ativo" : "Inativo"}
                    </span>
                    {e.ultimo_cstat && (
                      <span className="mt-0.5 block text-[10px] text-slate-400">
                        cStat {e.ultimo_cstat}
                        {e.ultimo_xmotivo ? ` — ${e.ultimo_xmotivo}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    Nenhuma empresa cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
