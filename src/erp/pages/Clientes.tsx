import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  brl,
  statusSefazCliente,
  type Cliente,
} from "../types";
import {
  consultarCnpj,
  formatDoc,
  tipoDocumento,
  validarCnpj,
  validarCpf,
} from "../receita";
import { Badge, Button, Card, Field, PageHeader } from "../ui";

const vazio: Omit<Cliente, "id"> = {
  nome: "",
  documento: "",
  email: "",
  telefone: "",
  cidade: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  uf: "",
  codMunicipio: "",
  indIe: "9",
  ie: "",
  limiteCredito: 0,
  condicaoPadrao: "a vista",
};

const hoje = new Date().toISOString().slice(0, 10);

export default function Clientes() {
  const { db, addCliente, delCliente, updCliente } = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<(typeof vazio) & { id?: string }>(vazio);
  const [consultando, setConsultando] = useState(false);
  const [msgConsulta, setMsgConsulta] = useState<string | null>(null);

  /** Uso de crédito por cliente: títulos a receber em aberto */
  const usoCredito = useMemo(() => {
    const map = new Map<string, { aberto: number; vencido: number }>();
    db.lancamentos
      .filter((l) => l.tipo === "receber" && !l.pago)
      .forEach((l) => {
        const c = db.clientes.find((cli) => l.descricao.includes(cli.nome));
        if (!c) return;
        const cur = map.get(c.id) ?? { aberto: 0, vencido: 0 };
        cur.aberto += l.valor;
        if (l.vencimento < hoje) cur.vencido += l.valor;
        map.set(c.id, cur);
      });
    return map;
  }, [db]);

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nome.trim()) return;
    const doc = f.documento.replace(/\D/g, "");
    if ((doc.length === 14 && !validarCnpj(doc)) || (doc.length === 11 && !validarCpf(doc))) {
      alert("Documento inválido — dígito verificador não confere.");
      return;
    }
    if (f.id)
      updCliente({ ...(f as Cliente), documento: formatDoc(f.documento) });
    else addCliente({ ...f, documento: formatDoc(f.documento) });
    setF(vazio);
    setOpen(false);
  }

  async function buscarReceita() {
    if (tipoDocumento(f.documento) !== "cnpj") {
      setMsgConsulta("Informe um CNPJ (14 dígitos) para consultar a Receita.");
      return;
    }
    setConsultando(true);
    setMsgConsulta(null);
    const r = await consultarCnpj(f.documento);
    setConsultando(false);
    if (!r.ok) return setMsgConsulta(`⚠️ ${r.erro}`);
    if (r.dados.situacao && r.dados.situacao !== "ATIVA")
      setMsgConsulta(`⚠️ Situação cadastral: ${r.dados.situacao}`);
    setF((prev) => ({
      ...prev,
      nome: r.dados.razaoSocial || r.dados.nomeFantasia || prev.nome,
      cep: r.dados.cep,
      logradouro: r.dados.logradouro,
      numero: r.dados.numero || "S/N",
      complemento: r.dados.complemento,
      bairro: r.dados.bairro,
      cidade: r.dados.municipio,
      uf: r.dados.uf,
      codMunicipio: r.dados.codMunicipio,
      telefone: r.dados.telefone || prev.telefone,
      email: r.dados.email || prev.email,
      indIe: "1",
    }));
    setMsgConsulta("✓ Dados preenchidos com a Consulta CNPJ (Base Receita/IBGE). Revise.");
  }

  const previewStatus = statusSefazCliente({ id: "", ...f });

  return (
    <div>
      <PageHeader
        title="Clientes"
        subtitle={`${db.clientes.length} cadastrados · campos exigidos pela SEFAZ + limite de crédito`}
        action={<Button onClick={() => { setF(vazio); setOpen(true); }}>+ Novo cliente</Button>}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {db.clientes.map((c) => {
          const st = statusSefazCliente(c);
          const uso = usoCredito.get(c.id) ?? { aberto: 0, vencido: 0 };
          const limite = c.limiteCredito ?? 0;
          const pct = limite > 0 ? Math.min(100, (uso.aberto / limite) * 100) : 0;
          const totalComprado = db.vendas
            .filter((v) => v.clienteId === c.id && v.status === "faturado")
            .reduce((s, v) => s + v.total, 0);

          return (
            <Card key={c.id} className="p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-700">
                  {c.nome.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{c.nome}</p>
                  <p className="text-xs text-slate-400">{c.documento}</p>
                </div>
                <button
                  onClick={() => delCliente(c.id)}
                  className="text-slate-300 transition hover:text-rose-500"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3">
                {st.ok ? (
                  <Badge tone="green">✓ OK para autorização NF-e</Badge>
                ) : (
                  <div>
                    <Badge tone="red">⚠ Faltam dados p/ SEFAZ</Badge>
                    <p className="mt-1 text-[11px] text-rose-600">
                      {st.faltando.slice(0, 2).join(", ")}
                      {st.faltando.length > 2 ? ` +${st.faltando.length - 2}` : ""}
                    </p>
                  </div>
                )}
              </div>

              <dl className="mt-3 space-y-1.5 text-sm text-slate-600">
                <div className="flex gap-2 truncate"><dt>✉️</dt><dd className="truncate">{c.email || "—"}</dd></div>
                <div className="flex gap-2"><dt>📞</dt><dd>{c.telefone || "—"}</dd></div>
                <div className="flex gap-2">
                  <dt>📍</dt>
                  <dd className="text-xs leading-tight">
                    {c.logradouro
                      ? `${c.logradouro}, ${c.numero} — ${c.bairro}, ${c.cidade}/${c.uf} · ${c.cep}`
                      : c.cidade || "—"}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 rounded-lg bg-slate-50 p-3">
                <div className="flex justify-between text-[11px] text-slate-500">
                  <span>
                    Crédito: {brl(uso.aberto)}
                    {limite > 0 ? ` / limite ${brl(limite)}` : ""}
                  </span>
                  {uso.vencido > 0 && (
                    <span className="font-bold text-rose-600">vencido {brl(uso.vencido)}</span>
                  )}
                </div>
                {limite > 0 && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full ${
                        pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-400" : "bg-sky-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Total comprado: <b className="text-slate-700">{brl(totalComprado)}</b>
                </p>
              </div>

              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => { setF({ ...c }); setOpen(true); }}
                  className="text-xs font-semibold text-sky-600 hover:underline"
                >
                  Editar
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={salvar}
            onClick={(e) => e.stopPropagation()}
            className="my-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {f.id ? "Editar cliente" : "Novo cliente"}
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">✕</button>
            </div>

            <div className="overflow-y-auto pr-1">
              {/* Documento + Consulta Receita */}
              <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
                <div className="flex gap-2">
                  <Field
                    label="CNPJ ou CPF"
                    className="flex-1"
                    value={f.documento}
                    onChange={(e) => {
                      setF({ ...f, documento: e.target.value });
                      setMsgConsulta(null);
                    }}
                    placeholder="Digite 14 dígitos do CNPJ"
                  />
                  <Button
                    variant="soft"
                    className="mt-5 whitespace-nowrap"
                    onClick={buscarReceita}
                  >
                    {consultando ? "Consultando..." : "🔍 Consultar Receita"}
                  </Button>
                </div>
                {f.documento && (
                  <p
                    className={`mt-2 text-[11px] font-medium ${
                      tipoDocumento(f.documento) === "cnpj"
                        ? validarCnpj(f.documento)
                          ? "text-emerald-700"
                          : "text-rose-600"
                        : tipoDocumento(f.documento) === "cpf"
                          ? validarCpf(f.documento)
                            ? "text-emerald-700"
                            : "text-rose-600"
                          : "text-slate-400"
                    }`}
                  >
                    {tipoDocumento(f.documento) === "invalido" && "↳ Aguardando 11 ou 14 dígitos"}
                    {tipoDocumento(f.documento) === "cnpj" &&
                      (validarCnpj(f.documento) ? "↳ ✓ CNPJ válido (DV confere)" : "↳ ✕ CNPJ inválido")}
                    {tipoDocumento(f.documento) === "cpf" &&
                      (validarCpf(f.documento) ? "↳ ✓ CPF válido (DV confere)" : "↳ ✕ CPF inválido")}
                  </p>
                )}
                {msgConsulta && (
                  <p
                    className={`mt-2 rounded px-2 py-1 text-[11px] font-medium ${
                      msgConsulta.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {msgConsulta}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Razão social / Nome" className="sm:col-span-2" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
                <Field label="E-mail" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                <Field label="Telefone" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
              </div>

              <h4 className="mb-2 mt-5 flex items-center justify-between text-xs font-bold uppercase text-slate-500">
                <span>Endereço (obrigatório na NF-e)</span>
                {!previewStatus.ok && (
                  <span className="rounded bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                    {previewStatus.faltando.length} pendente(s)
                  </span>
                )}
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="CEP" value={f.cep ?? ""} onChange={(e) => setF({ ...f, cep: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
                <Field label="Logradouro" className="sm:col-span-2" value={f.logradouro ?? ""} onChange={(e) => setF({ ...f, logradouro: e.target.value })} />
                <Field label="Número" value={f.numero ?? ""} onChange={(e) => setF({ ...f, numero: e.target.value })} />
                <Field label="Complemento" value={f.complemento ?? ""} onChange={(e) => setF({ ...f, complemento: e.target.value })} />
                <Field label="Bairro" value={f.bairro ?? ""} onChange={(e) => setF({ ...f, bairro: e.target.value })} />
                <Field label="Município" value={f.cidade} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
                <Field label="UF" value={f.uf ?? ""} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase().slice(0, 2) })} />
                <Field label="Cód. IBGE do município" value={f.codMunicipio ?? ""} onChange={(e) => setF({ ...f, codMunicipio: e.target.value.replace(/\D/g, "").slice(0, 7) })} />
              </div>

              <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-slate-500">Inscrição estadual</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Indicador (indIEDest)</span>
                  <select
                    value={f.indIe}
                    onChange={(e) => setF({ ...f, indIe: e.target.value as Cliente["indIe"] })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="1">1 — Contribuinte (tem IE)</option>
                    <option value="2">2 — Isento</option>
                    <option value="9">9 — Não contribuinte</option>
                  </select>
                </label>
                {f.indIe === "1" && (
                  <Field label="Inscrição estadual" value={f.ie ?? ""} onChange={(e) => setF({ ...f, ie: e.target.value })} />
                )}
              </div>

              <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-slate-500">
                Crédito (integração com o financeiro)
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Limite de crédito (R$)"
                  type="number"
                  step="0.01"
                  value={f.limiteCredito ?? 0}
                  onChange={(e) => setF({ ...f, limiteCredito: Number(e.target.value) })}
                />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Condição de pagamento padrão</span>
                  <select
                    value={f.condicaoPadrao}
                    onChange={(e) => setF({ ...f, condicaoPadrao: e.target.value as Cliente["condicaoPadrao"] })}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                  >
                    <option value="a vista">À vista</option>
                    <option value="7d">7 dias</option>
                    <option value="14d">14 dias</option>
                    <option value="30d">30 dias</option>
                    <option value="60d">60 dias</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              {previewStatus.ok ? (
                <Badge tone="green">✓ Dados completos p/ autorização NF-e</Badge>
              ) : (
                <Badge tone="amber">venda OK · NF-e só depois de completar</Badge>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button type="submit">Salvar cliente</Button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
