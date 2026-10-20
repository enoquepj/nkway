import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl, uid, type Fornecedor } from "../types";
import { consultarCnpj, formatDoc, tipoDocumento, validarCnpj } from "../receita";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import { casaTexto, dataLocal, diasEntre, useFiltrosSalvos } from "../filtros";
import { BuscaGlobal, ChipAtivo, LinhaFiltros, MultiSelectFiltro, PainelFiltros, SelectFiltro } from "../FiltroUI";
import { BotaoExportar, Paginacao, ThOrd, exportarCsv, useOrdenacao, usePaginacao } from "../Tabela";
import { cn } from "../../utils/cn";

const vazio: Omit<Fornecedor, "id"> = {
  nome: "", cnpj: "", uf: "", telefone: "", email: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "",
  cidade: "", codMunicipio: "", indIe: "1", ie: "", prazoPagDias: 30,
};

type Financeiro = "aberto" | "vencido" | "semDebito";
type Movimento = "comNotas" | "semNotas" | "comDevolucao";
type Col = "nome" | "cnpj" | "cidade" | "prazo" | "aberto" | "notas" | "comprado" | "ultima";

const FINANCEIRO: { valor: Financeiro; rotulo: string }[] = [
  { valor: "aberto", rotulo: "Com contas a pagar em aberto" },
  { valor: "vencido", rotulo: "Com contas vencidas" },
  { valor: "semDebito", rotulo: "Sem débitos" },
];
const MOVIMENTO: { valor: Movimento; rotulo: string }[] = [
  { valor: "comNotas", rotulo: "Com notas de compra" },
  { valor: "semNotas", rotulo: "Sem nenhuma compra" },
  { valor: "comDevolucao", rotulo: "Com devoluções" },
];
const CONTRIBUINTE: { valor: "1" | "2" | "9"; rotulo: string }[] = [
  { valor: "1", rotulo: "Contribuinte ICMS" },
  { valor: "2", rotulo: "Isento de IE" },
  { valor: "9", rotulo: "Não contribuinte" },
];

const FILTROS_PADRAO = {
  busca: "",
  ufs: [] as string[],
  cidade: "",
  sefaz: "todos" as "todos" | "ok" | "incompleto",
  financeiro: [] as Financeiro[],
  prazo: "todos" as "todos" | "0-15" | "16-30" | "31-60" | "60+",
  movimento: [] as Movimento[],
  contribuinte: [] as ("1" | "2" | "9")[],
  compras: "todos" as "todos" | "recente30" | "60" | "90" | "180",
  avancado: false,
};

const dig = (s: string) => (s ?? "").replace(/\D/g, "");
const unicos = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "pt-BR"));
const sefazOkDe = (x: Fornecedor) => !!(x.cep && x.logradouro && x.cidade && x.codMunicipio);

export default function Fornecedores() {
  const { db, addFornecedor, updFornecedor, delFornecedor } = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<(typeof vazio) & { id?: string }>(vazio);
  const [consultando, setConsultando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { f: fl, set, toggle, limpar } = useFiltrosSalvos("fornecedores", FILTROS_PADRAO);
  const hoje = dataLocal();

  const uso = useMemo(() => {
    const map = new Map<string, { aberto: number; vencido: number }>();
    db.lancamentos
      .filter((l) => l.tipo === "pagar" && !l.pago)
      .forEach((l) => {
        const forn = db.fornecedores.find((x) => l.descricao.includes(x.nome.split(" ")[0]));
        if (!forn) return;
        const cur = map.get(forn.id) ?? { aberto: 0, vencido: 0 };
        cur.aberto += l.valor;
        if (l.vencimento < hoje) cur.vencido += l.valor;
        map.set(forn.id, cur);
      });
    return map;
  }, [db, hoje]);

  /** Compras por fornecedor: liga a nota pelo CNPJ (ou pelo nome, se a nota não tiver CNPJ) */
  const movimento = useMemo(() => {
    const map = new Map<string, { notas: number; total: number; ultima: string; devolucoes: number; totalDev: number }>();
    db.fornecedores.forEach((forn) => {
      const cnpj = dig(forn.cnpj);
      const notas = db.entradas.filter((e) =>
        cnpj && dig(e.cnpjFornecedor) ? dig(e.cnpjFornecedor) === cnpj : e.fornecedor.includes(forn.nome.split(" ")[0]));
      const devs = db.devolucoes.filter((d) => dig(d.cnpjFornecedor) === cnpj && cnpj !== "");
      map.set(forn.id, {
        notas: notas.length,
        total: notas.reduce((s, e) => s + e.total, 0),
        ultima: notas.reduce((m, e) => (e.emissao > m ? e.emissao : m), ""),
        devolucoes: devs.length,
        totalDev: devs.reduce((s, d) => s + d.total, 0),
      });
    });
    return map;
  }, [db.fornecedores, db.entradas, db.devolucoes]);

  const ufs = useMemo(() => unicos(db.fornecedores.map((x) => x.uf?.toUpperCase())), [db.fornecedores]);
  const cidades = useMemo(() => unicos(db.fornecedores.filter((x) => !fl.ufs.length || fl.ufs.includes((x.uf ?? "").toUpperCase())).map((x) => x.cidade)), [db.fornecedores, fl.ufs]);

  const usoDe = (x: Fornecedor) => uso.get(x.id) ?? { aberto: 0, vencido: 0 };
  const movDe = (x: Fornecedor) => movimento.get(x.id) ?? { notas: 0, total: 0, ultima: "", devolucoes: 0, totalDev: 0 };

  const filtrados = db.fornecedores.filter((x) => {
    if (fl.ufs.length && !fl.ufs.includes((x.uf ?? "").toUpperCase())) return false;
    if (fl.cidade && x.cidade !== fl.cidade) return false;
    if (fl.sefaz !== "todos" && (fl.sefaz === "ok") !== sefazOkDe(x)) return false;
    const u = usoDe(x), m = movDe(x);
    for (const k of fl.financeiro) {
      if (k === "aberto" && !(u.aberto > 0)) return false;
      if (k === "vencido" && !(u.vencido > 0)) return false;
      if (k === "semDebito" && u.aberto > 0) return false;
    }
    if (fl.prazo !== "todos") {
      const p = x.prazoPagDias ?? 30;
      const ok = fl.prazo === "0-15" ? p <= 15 : fl.prazo === "16-30" ? p > 15 && p <= 30 : fl.prazo === "31-60" ? p > 30 && p <= 60 : p > 60;
      if (!ok) return false;
    }
    for (const k of fl.movimento) {
      if (k === "comNotas" && !(m.notas > 0)) return false;
      if (k === "semNotas" && m.notas > 0) return false;
      if (k === "comDevolucao" && !(m.devolucoes > 0)) return false;
    }
    if (fl.contribuinte.length && !fl.contribuinte.includes((x.indIe ?? "1") as "1" | "2" | "9")) return false;
    if (fl.compras !== "todos") {
      const dias = m.ultima ? diasEntre(m.ultima, hoje) : Infinity;
      if (fl.compras === "recente30" ? !(dias <= 30) : !(m.notas > 0 && dias > Number(fl.compras))) return false;
    }
    return casaTexto(fl.busca, [x.nome, x.cnpj, x.email, x.telefone, x.cidade, x.bairro, x.uf, x.cep, x.ie]);
  });

  const ord = useOrdenacao<Fornecedor, Col>(filtrados, {
    nome: (x) => x.nome,
    cnpj: (x) => x.cnpj,
    cidade: (x) => x.cidade,
    prazo: (x) => x.prazoPagDias ?? 30,
    aberto: (x) => usoDe(x).aberto,
    notas: (x) => movDe(x).notas,
    comprado: (x) => movDe(x).total,
    ultima: (x) => movDe(x).ultima || null,
  }, { col: "nome", dir: "asc" });
  const pag = usePaginacao(ord.ordenada, "fornecedores");

  const totAberto = filtrados.reduce((s, x) => s + usoDe(x).aberto, 0);
  const totVencido = filtrados.reduce((s, x) => s + usoDe(x).vencido, 0);
  const totComprado = filtrados.reduce((s, x) => s + movDe(x).total, 0);

  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (fl.busca.trim()) ativos.push({ id: "b", rotulo: `Busca: “${fl.busca.trim()}”`, remover: () => set("busca", "") });
  fl.ufs.forEach((u) => ativos.push({ id: `u-${u}`, rotulo: `UF: ${u}`, remover: () => toggle("ufs", u) }));
  if (fl.cidade) ativos.push({ id: "ci", rotulo: `Cidade: ${fl.cidade}`, remover: () => set("cidade", "") });
  if (fl.sefaz !== "todos") ativos.push({ id: "s", rotulo: fl.sefaz === "ok" ? "Endereço OK p/ NF-e" : "Endereço incompleto", remover: () => set("sefaz", "todos") });
  fl.financeiro.forEach((k) => ativos.push({ id: `fi-${k}`, rotulo: FINANCEIRO.find((x) => x.valor === k)!.rotulo, remover: () => toggle("financeiro", k) }));
  if (fl.prazo !== "todos") ativos.push({ id: "pz", rotulo: `Prazo ${fl.prazo === "60+" ? "acima de 60" : fl.prazo} dias`, remover: () => set("prazo", "todos") });
  fl.movimento.forEach((k) => ativos.push({ id: `mv-${k}`, rotulo: MOVIMENTO.find((x) => x.valor === k)!.rotulo, remover: () => toggle("movimento", k) }));
  fl.contribuinte.forEach((k) => ativos.push({ id: `ct-${k}`, rotulo: CONTRIBUINTE.find((x) => x.valor === k)!.rotulo, remover: () => toggle("contribuinte", k) }));
  if (fl.compras !== "todos") ativos.push({ id: "cp", rotulo: fl.compras === "recente30" ? "Comprou nos últimos 30 dias" : `Sem comprar há +${fl.compras} dias`, remover: () => set("compras", "todos") });

  function excluir(x: Fornecedor) {
    if (confirm(`Excluir o fornecedor "${x.nome}"?`)) delFornecedor(x.id);
  }

  function exportar() {
    exportarCsv("fornecedores",
      ["Razão social", "CNPJ", "IE", "E-mail", "Telefone", "CEP", "Endereço", "Número", "Bairro", "Cidade", "UF", "Prazo (dias)", "A pagar em aberto", "Vencido", "Notas de compra", "Total comprado", "Última compra", "Devoluções", "Endereço SEFAZ"],
      ord.ordenada.map((x) => {
        const u = usoDe(x), m = movDe(x);
        return [x.nome, x.cnpj, x.ie, x.email, x.telefone, x.cep, x.logradouro, x.numero, x.bairro, x.cidade, x.uf, x.prazoPagDias ?? 30,
          u.aberto, u.vencido, m.notas, m.total, m.ultima ? new Date(m.ultima + "T12:00").toLocaleDateString("pt-BR") : "", m.devolucoes, sefazOkDe(x) ? "OK" : "Incompleto"];
      }));
  }

  const th = { atual: ord.col, dir: ord.dir, onOrdenar: ord.ordenar };

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.nome.trim()) return;
    const n = f.cnpj.replace(/\D/g, "");
    if (n.length === 14 && !validarCnpj(n)) return alert("CNPJ inválido — DV não confere.");
    if (f.id) updFornecedor({ ...(f as Fornecedor), cnpj: formatDoc(f.cnpj) });
    else addFornecedor({ ...f, id: uid(), cnpj: formatDoc(f.cnpj) });
    setF(vazio);
    setOpen(false);
  }

  async function consultar() {
    if (tipoDocumento(f.cnpj) !== "cnpj") return setMsg("Informe um CNPJ válido (14 dígitos).");
    setConsultando(true);
    setMsg(null);
    const r = await consultarCnpj(f.cnpj);
    setConsultando(false);
    if (!r.ok) return setMsg(`⚠️ ${r.erro}`);
    setF((p) => ({
      ...p,
      nome: r.dados.razaoSocial || r.dados.nomeFantasia || p.nome,
      cep: r.dados.cep, logradouro: r.dados.logradouro, numero: r.dados.numero || "S/N",
      complemento: r.dados.complemento, bairro: r.dados.bairro, cidade: r.dados.municipio,
      uf: r.dados.uf, codMunicipio: r.dados.codMunicipio,
      telefone: r.dados.telefone || p.telefone, email: r.dados.email || p.email,
    }));
    setMsg("✓ Dados da Receita/IBGE preenchidos. Revise antes de salvar.");
  }

  const endOk = !!(f.cep && f.logradouro && f.bairro && f.cidade && f.uf && f.codMunicipio);

  return (
    <div>
      <PageHeader
        title="Fornecedores"
        subtitle={`${db.fornecedores.length} cadastrados · devoluções fiscais e contas a pagar integradas`}
        action={
          <div className="flex gap-2">
            <BotaoExportar onClick={exportar} total={filtrados.length} />
            <Button onClick={() => { setF(vazio); setOpen(true); }}>+ Novo fornecedor</Button>
          </div>
        }
      />

      <PainelFiltros>
        <BuscaGlobal value={fl.busca} onChange={(v) => set("busca", v)}
          placeholder="Buscar por razão social, CNPJ (com ou sem pontos), e-mail, telefone, cidade, IE…" />
        <LinhaFiltros>
          <MultiSelectFiltro rotulo="UF" opcoes={ufs.map((u) => ({ valor: u, rotulo: u }))} selecionados={fl.ufs}
            onToggle={(v) => { toggle("ufs", v); set("cidade", ""); }} onLimpar={() => set("ufs", [])} largura="min-w-[110px]" />
          <SelectFiltro rotulo="Cidade" valor={fl.cidade} padrao="" onChange={(v) => set("cidade", v)}
            opcoes={[{ valor: "", rotulo: "Todas" }, ...cidades.map((c) => ({ valor: c, rotulo: c }))]} />
          <MultiSelectFiltro rotulo="Financeiro" opcoes={FINANCEIRO} selecionados={fl.financeiro}
            onToggle={(v) => toggle("financeiro", v)} onLimpar={() => set("financeiro", [])} />
          <SelectFiltro rotulo="Prazo de pagamento" valor={fl.prazo} padrao="todos" onChange={(v) => set("prazo", v)}
            opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "0-15", rotulo: "Até 15 dias" }, { valor: "16-30", rotulo: "16 a 30 dias" }, { valor: "31-60", rotulo: "31 a 60 dias" }, { valor: "60+", rotulo: "Acima de 60 dias" }]} />
          <SelectFiltro rotulo="Endereço SEFAZ" valor={fl.sefaz} padrao="todos" onChange={(v) => set("sefaz", v)}
            opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "ok", rotulo: "OK para NF-e" }, { valor: "incompleto", rotulo: "Incompleto" }]} />
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !fl.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {fl.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (compras, devoluções, contribuinte)"}
        </button>
        {fl.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              <MultiSelectFiltro rotulo="Movimentação" opcoes={MOVIMENTO} selecionados={fl.movimento}
                onToggle={(v) => toggle("movimento", v)} onLimpar={() => set("movimento", [])} />
              <SelectFiltro rotulo="Última compra" valor={fl.compras} padrao="todos" onChange={(v) => set("compras", v)} largura="min-w-[200px]"
                opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "recente30", rotulo: "Comprou nos últimos 30 dias" }, { valor: "60", rotulo: "Sem comprar há +60 dias" }, { valor: "90", rotulo: "Sem comprar há +90 dias" }, { valor: "180", rotulo: "Sem comprar há +180 dias" }]} />
              <MultiSelectFiltro rotulo="Contribuinte ICMS" opcoes={CONTRIBUINTE} selecionados={fl.contribuinte}
                onToggle={(v) => toggle("contribuinte", v)} onLimpar={() => set("contribuinte", [])} />
            </LinhaFiltros>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? <span className="text-xs text-slate-400">Nenhum filtro ativo</span> : (
            <>
              {ativos.map((a) => <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>)}
              <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">Limpar filtros</button>
            </>
          )}
        </div>
      </PainelFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <span><b className="text-slate-900">{filtrados.length}</b> de {db.fornecedores.length} fornecedor(es)</span>
        <span>A pagar em aberto: <b className="text-slate-900">{brl(totAberto)}</b></span>
        {totVencido > 0 && <span>Vencido: <b className="text-rose-600">{brl(totVencido)}</b></span>}
        <span>Total comprado: <b className="text-indigo-700">{brl(totComprado)}</b></span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <ThOrd col="nome" {...th}>Fornecedor</ThOrd>
                <ThOrd col="cnpj" {...th}>CNPJ</ThOrd>
                <th className="px-4 py-3 uppercase tracking-wide">Contato</th>
                <ThOrd col="cidade" {...th}>Cidade / UF</ThOrd>
                <ThOrd col="prazo" {...th} alinhar="center">Prazo</ThOrd>
                <ThOrd col="aberto" {...th} alinhar="right">A pagar</ThOrd>
                <ThOrd col="comprado" {...th} alinhar="right">Comprado</ThOrd>
                <ThOrd col="ultima" {...th}>Última compra</ThOrd>
                <th className="px-4 py-3 uppercase tracking-wide">SEFAZ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pag.itens.map((forn) => {
                const u = usoDe(forn), m = movDe(forn);
                return (
                  <tr key={forn.id} className="hover:bg-slate-50/70" onDoubleClick={() => { setF({ ...forn }); setOpen(true); }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-700">
                          {forn.nome.slice(0, 2).toUpperCase()}
                        </div>
                        <button type="button" onClick={() => { setF({ ...forn }); setOpen(true); }} className="max-w-[240px] truncate text-left font-medium text-slate-800 hover:text-sky-700 hover:underline">
                          {forn.nome}
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{forn.cnpj || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>{forn.telefone || "—"}</p>
                      <p className="max-w-[200px] truncate text-slate-400">{forn.email}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{forn.cidade || "—"}{forn.uf ? `/${forn.uf.toUpperCase()}` : ""}</td>
                    <td className="px-4 py-3 text-center"><Badge tone="sky">{forn.prazoPagDias ?? 30}d</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("font-semibold", u.vencido > 0 ? "text-rose-600" : "text-slate-800")}>{brl(u.aberto)}</span>
                      {u.vencido > 0 && <p className="text-[10px] font-bold text-rose-600">vencido {brl(u.vencido)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {brl(m.total)}
                      <p className="text-[10px] font-normal text-slate-400">
                        {m.notas} nota(s){m.devolucoes > 0 ? ` · ${m.devolucoes} devol. (${brl(m.totalDev)})` : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {m.ultima ? new Date(m.ultima + "T12:00").toLocaleDateString("pt-BR") : <span className="text-slate-300">nunca</span>}
                    </td>
                    <td className="px-4 py-3">
                      {sefazOkDe(forn) ? <Badge tone="green">✓ OK</Badge> : <Badge tone="red">⚠ Endereço</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => { setF({ ...forn }); setOpen(true); }} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">Editar</button>
                      <button onClick={() => excluir(forn)} className="text-xs font-semibold text-rose-500 hover:underline">Excluir</button>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={10} className="py-12 text-center text-slate-400">
                  {db.fornecedores.length === 0 ? "Nenhum fornecedor cadastrado." : (
                    <>Nenhum fornecedor com esses filtros. <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button></>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao {...pag} />
      </Card>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/50 p-4" onClick={() => setOpen(false)}>
          <form onSubmit={salvar} onClick={(e) => e.stopPropagation()} className="my-auto flex max-h-[92vh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">{f.id ? "Editar fornecedor" : "Novo fornecedor"}</h3>
              <button type="button" onClick={() => setOpen(false)} className="text-slate-400">✕</button>
            </div>

            <div className="overflow-y-auto pr-1">
              <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-4">
                <div className="flex gap-2">
                  <Field label="CNPJ" className="flex-1" value={f.cnpj} onChange={(e) => { setF({ ...f, cnpj: e.target.value }); setMsg(null); }} placeholder="14 dígitos" />
                  <Button variant="soft" className="mt-5 whitespace-nowrap" onClick={consultar}>
                    {consultando ? "Consultando..." : "🔍 Consultar Receita"}
                  </Button>
                </div>
                {f.cnpj && tipoDocumento(f.cnpj) === "cnpj" && (
                  <p className={`mt-2 text-[11px] font-medium ${validarCnpj(f.cnpj) ? "text-emerald-700" : "text-rose-600"}`}>
                    {validarCnpj(f.cnpj) ? "↳ ✓ CNPJ válido (DV confere)" : "↳ ✕ CNPJ inválido"}
                  </p>
                )}
                {msg && (
                  <p className={`mt-2 rounded px-2 py-1 text-[11px] font-medium ${msg.startsWith("✓") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {msg}
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Razão social" className="sm:col-span-2" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
                <Field label="Telefone" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
                <Field label="E-mail p/ NF-e" value={f.email ?? ""} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </div>

              <h4 className="mb-2 mt-5 flex items-center justify-between text-xs font-bold uppercase text-slate-500">
                <span>Endereço (necessário para devolução fiscal)</span>
                {!endOk && <span className="rounded bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">incompleto</span>}
              </h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="CEP" value={f.cep ?? ""} onChange={(e) => setF({ ...f, cep: e.target.value.replace(/\D/g, "").slice(0, 8) })} />
                <Field label="Logradouro" className="sm:col-span-2" value={f.logradouro ?? ""} onChange={(e) => setF({ ...f, logradouro: e.target.value })} />
                <Field label="Número" value={f.numero ?? ""} onChange={(e) => setF({ ...f, numero: e.target.value })} />
                <Field label="Complemento" value={f.complemento ?? ""} onChange={(e) => setF({ ...f, complemento: e.target.value })} />
                <Field label="Bairro" value={f.bairro ?? ""} onChange={(e) => setF({ ...f, bairro: e.target.value })} />
                <Field label="Município" value={f.cidade ?? ""} onChange={(e) => setF({ ...f, cidade: e.target.value })} />
                <Field label="UF" value={f.uf} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase().slice(0, 2) })} />
                <Field label="Cód. IBGE" value={f.codMunicipio ?? ""} onChange={(e) => setF({ ...f, codMunicipio: e.target.value.replace(/\D/g, "").slice(0, 7) })} />
              </div>

              <h4 className="mb-2 mt-5 text-xs font-bold uppercase text-slate-500">Fiscal e comercial</h4>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Indicador IE</span>
                  <select value={f.indIe} onChange={(e) => setF({ ...f, indIe: e.target.value as Fornecedor["indIe"] })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                    <option value="1">1 — Contribuinte</option>
                    <option value="2">2 — Isento</option>
                    <option value="9">9 — Não contribuinte</option>
                  </select>
                </label>
                {f.indIe === "1" && (
                  <Field label="Inscrição estadual" value={f.ie ?? ""} onChange={(e) => setF({ ...f, ie: e.target.value })} />
                )}
                <Field label="Prazo padrão (dias)" type="number" value={f.prazoPagDias ?? 30} onChange={(e) => setF({ ...f, prazoPagDias: Number(e.target.value) })} />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button type="submit">Salvar fornecedor</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
