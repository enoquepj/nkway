import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, isCloud } from "../../lib/supabase";
import { Badge, Button, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";
import { brl } from "../types";
import { lerXmlNfe } from "../xmlNfe";

export type NfeEntradaRow = {
  id: string;
  empresa_id: string;
  cnpj_destinatario: string;
  chave_acesso: string;
  nsu: string;
  schema_tipo: string;
  emitente_cnpj: string | null;
  emitente_nome: string | null;
  valor_total: number | null;
  data_emissao: string | null;
  status_manifesto: string;
  importado_erp: boolean;
  tem_xml?: boolean;
  xml_bruto?: string | null;
  created_at: string;
};

type Props = {
  /** Quando informado, devolve o XML para a tela de Entradas do ERP */
  onImportarXml?: (xml: string, meta: NfeEntradaRow) => void;
};

const PAGE = 15;

function formatCnpj(c: string) {
  const d = (c || "").replace(/\D/g, "");
  if (d.length !== 14) return c || "—";
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Listagem das NF-e capturadas via distribuição DF-e.
 * Botão importa o xml_bruto no fluxo de entrada do ERP (ou download local).
 */
export default function DashboardNfe({ onImportarXml }: Props) {
  const [rows, setRows] = useState<NfeEntradaRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [emitente, setEmitente] = useState("");
  const [chave, setChave] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    if (!supabase || !isCloud) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      let q = supabase
        .from("v_nfe_entrada_lista")
        .select("*", { count: "exact" })
        .order("data_emissao", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);

      const em = emitente.trim();
      if (em) {
        q = q.or(`emitente_nome.ilike.%${em}%,emitente_cnpj.ilike.%${em.replace(/\D/g, "")}%`);
      }
      const ch = chave.replace(/\D/g, "");
      if (ch) q = q.ilike("chave_acesso", `%${ch}%`);

      const { data, error, count } = await q;
      if (error) throw error;
      setRows((data as NfeEntradaRow[]) || []);
      setTotal(count ?? 0);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [page, emitente, chave]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  async function baixarXml(row: NfeEntradaRow, importarErp: boolean) {
    if (!supabase) return;
    setMsg(null);
    const { data, error } = await supabase
      .from("nfe_entrada")
      .select("xml_bruto, id, chave_acesso, emitente_nome, valor_total, data_emissao, schema_tipo, nsu, empresa_id, cnpj_destinatario, emitente_cnpj, status_manifesto, importado_erp, created_at")
      .eq("id", row.id)
      .single();
    if (error || !data?.xml_bruto) {
      setMsg(error?.message || "XML não disponível (pode ser só resumo resNFe — aguarde a NF-e completa ou manifeste ciência).");
      return;
    }

    if (importarErp && onImportarXml) {
      const teste = lerXmlNfe(data.xml_bruto);
      if (!teste.ok) {
        setMsg(teste.erro);
        return;
      }
      onImportarXml(data.xml_bruto, { ...row, xml_bruto: data.xml_bruto });
      await supabase.from("nfe_entrada").update({ importado_erp: true }).eq("id", row.id);
      void carregar();
      return;
    }

    const blob = new Blob([data.xml_bruto], { type: "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${row.chave_acesso || row.id}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function dispararCaptura() {
    if (!supabase) return;
    setRodando(true);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("dfe-dist", {
        body: { origem: "manual-ui" },
      });
      if (error) throw error;
      setMsg(`Captura disparada: ${JSON.stringify(data?.resultados ?? data).slice(0, 240)}`);
      await carregar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRodando(false);
    }
  }

  const resumo = useMemo(() => {
    const valor = rows.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
    return { valor, qtd: total };
  }, [rows, total]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="NF-e de entrada (DF-e)"
        subtitle="Documentos capturados no Ambiente Nacional · XML bruto para o ERP"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => void carregar()}>
              Atualizar
            </Button>
            <Button onClick={() => void dispararCaptura()} className={rodando ? "opacity-70" : ""}>
              {rodando ? "Consultando SEFAZ…" : "⚡ Capturar agora"}
            </Button>
          </div>
        }
      />

      {!isCloud && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Conecte o Supabase (cloud) para listar NF-e capturadas pela Edge Function <code className="text-xs">dfe-dist</code>.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Documentos</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{resumo.qtd}</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Soma da página</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{brl(resumo.valor)}</p>
        </Card>
        <Card className="border-l-4 border-l-violet-500 p-4">
          <p className="text-xs uppercase text-slate-500">Página</p>
          <p className="mt-1 text-2xl font-bold text-violet-700">
            {page + 1} / {pages}
          </p>
        </Card>
      </div>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="text-xs font-medium text-slate-600">
          Emitente (nome ou CNPJ)
          <input
            value={emitente}
            onChange={(e) => {
              setPage(0);
              setEmitente(e.target.value);
            }}
            className="mt-1 block w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
            placeholder="Fornecedor…"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Chave de acesso
          <input
            value={chave}
            onChange={(e) => {
              setPage(0);
              setChave(e.target.value);
            }}
            className="mt-1 block w-64 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500"
            placeholder="44 dígitos"
          />
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            setEmitente("");
            setChave("");
            setPage(0);
          }}
        >
          Limpar filtros
        </Button>
      </Card>

      {msg && (
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 break-all">{msg}</div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Emissão</th>
                <th className="px-4 py-3">Chave</th>
                <th className="px-4 py-3">Emitente</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Schema</th>
                <th className="px-4 py-3">Manifesto</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    Carregando…
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {r.data_emissao ? new Date(r.data_emissao).toLocaleString("pt-BR") : "—"}
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-400">NSU {r.nsu}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-700">
                      <span className="break-all">{r.chave_acesso}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{r.emitente_nome || "—"}</p>
                      <p className="text-[11px] text-slate-400">{formatCnpj(r.emitente_cnpj || "")}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {r.valor_total != null ? brl(Number(r.valor_total)) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{r.schema_tipo}</td>
                    <td className="px-4 py-3">
                      <Badge
                        tone={
                          r.status_manifesto === "confirmada"
                            ? "green"
                            : r.status_manifesto === "resumo"
                              ? "amber"
                              : "sky"
                        }
                      >
                        {r.status_manifesto}
                      </Badge>
                      {r.importado_erp && (
                        <span className="mt-1 block text-[10px] text-emerald-600">importado ERP</span>
                      )}
                    </td>
                    <td className="space-x-2 px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void baixarXml(r, false)}
                        className="text-xs font-semibold text-slate-600 hover:underline"
                        disabled={r.tem_xml === false}
                      >
                        XML
                      </button>
                      <button
                        type="button"
                        onClick={() => void baixarXml(r, true)}
                        className={cn(
                          "rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-sky-700",
                          r.tem_xml === false && "opacity-40",
                        )}
                        disabled={r.tem_xml === false}
                        title="Envia o XML bruto para o fluxo de entrada do ERP"
                      >
                        Importar no ERP (XML)
                      </button>
                    </td>
                  </tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    Nenhuma NF-e capturada. Cadastre o A1 e dispare a captura (ou aguarde o cron de 10 min).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            {total} registro(s)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
