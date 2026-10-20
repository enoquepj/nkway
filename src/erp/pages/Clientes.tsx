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
import { casaTexto, citaNome, dataLocal, diasEntre, lerNumero, useFiltrosSalvos } from "../filtros";
import { BuscaGlobal, ChipAtivo, IntervaloFiltro, LinhaFiltros, MultiSelectFiltro, PainelFiltros, SelectFiltro, inputFiltro } from "../FiltroUI";
import { BotaoExportar, Paginacao, ThOrd, exportarCsv, useOrdenacao, usePaginacao } from "../Tabela";
import { cn } from "../../utils/cn";

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

type Credito = "aberto" | "vencido" | "limite85" | "semLimite";
type Col = "nome" | "documento" | "cidade" | "uf" | "aberto" | "comprado" | "ultima";

const CREDITO: { valor: Credito; rotulo: string }[] = [
  { valor: "aberto", rotulo: "Com valores em aberto" },
  { valor: "vencido", rotulo: "Com títulos vencidos" },
  { valor: "limite85", rotulo: "Acima de 85% do limite" },
  { valor: "semLimite", rotulo: "Sem limite definido" },
];
const CONTRIBUINTE: { valor: "1" | "2" | "9"; rotulo: string }[] = [
  { valor: "1", rotulo: "Contribuinte ICMS" },
  { valor: "2", rotulo: "Isento de IE" },
  { valor: "9", rotulo: "Não contribuinte" },
];
const CONDICOES = ["a vista", "7d", "14d", "30d", "60d"] as const;

const FILTROS_PADRAO = {
  busca: "",
  pessoa: "todos" as "todos" | "pf" | "pj",
  ufs: [] as string[],
  cidade: "",
  sefaz: "todos" as "todos" | "ok" | "incompleto",
  credito: [] as Credito[],
  contribuinte: [] as ("1" | "2" | "9")[],
  condicoes: [] as string[],
  compras: "todos" as "todos" | "nunca" | "30" | "60" | "90" | "recente30",
  compradoDe: "",
  compradoAte: "",
  limiteDe: "",
  limiteAte: "",
  avancado: false,
};

const pessoaDe = (doc: string) => {
  const n = (doc ?? "").replace(/\D/g, "").length;
  return n === 14 ? "pj" : n === 11 ? "pf" : "";
};
const unicos = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "pt-BR"));

export default function Clientes() {
  const { db, addCliente, delCliente, updCliente } = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<(typeof vazio) & { id?: string }>(vazio);
  const [consultando, setConsultando] = useState(false);
  const [msgConsulta, setMsgConsulta] = useState<string | null>(null);

  const { f: fl, set, toggle, limpar } = useFiltrosSalvos("clientes", FILTROS_PADRAO);
  const hoje = dataLocal();

  /** Uso de crédito por cliente: títulos a receber em aberto */
  const usoCredito = useMemo(() => {
    const map = new Map<string, { aberto: number; vencido: number }>();
    db.lancamentos
      .filter((l) => l.tipo === "receber" && !l.pago)
      .forEach((l) => {
        const c = db.clientes.find((cli) => citaNome(l.descricao, cli.nome));
        if (!c) return;
        const cur = map.get(c.id) ?? { aberto: 0, vencido: 0 };
        cur.aberto += l.valor;
        if (l.vencimento < hoje) cur.vencido += l.valor;
        map.set(c.id, cur);
      });
    return map;
  }, [db, hoje]);

  /** Histórico de compras: total faturado e data da última compra */
  const compras = useMemo(() => {
    const map = new Map<string, { total: number; ultima: number; qtd: number }>();
    db.vendas
      .filter((v) => v.clienteId && v.status === "faturado")
      .forEach((v) => {
        const cur = map.get(v.clienteId!) ?? { total: 0, ultima: 0, qtd: 0 };
        cur.total += v.total;
        cur.qtd += 1;
        cur.ultima = Math.max(cur.ultima, v.data);
        map.set(v.clienteId!, cur);
      });
    return map;
  }, [db.vendas]);

  const ufs = useMemo(() => unicos(db.clientes.map((c) => c.uf?.toUpperCase())), [db.clientes]);
  const cidades = useMemo(() => unicos(db.clientes.filter((c) => !fl.ufs.length || fl.ufs.includes((c.uf ?? "").toUpperCase())).map((c) => c.cidade)), [db.clientes, fl.ufs]);

  const cMin = lerNumero(fl.compradoDe), cMax = lerNumero(fl.compradoAte);
  const lMin = lerNumero(fl.limiteDe), lMax = lerNumero(fl.limiteAte);
  const usoDe = (c: Cliente) => usoCredito.get(c.id) ?? { aberto: 0, vencido: 0 };
  const compraDe = (c: Cliente) => compras.get(c.id) ?? { total: 0, ultima: 0, qtd: 0 };

  const filtrados = db.clientes.filter((c) => {
    if (fl.pessoa !== "todos" && pessoaDe(c.documento) !== fl.pessoa) return false;
    if (fl.ufs.length && !fl.ufs.includes((c.uf ?? "").toUpperCase())) return false;
    if (fl.cidade && c.cidade !== fl.cidade) return false;
    if (fl.sefaz !== "todos" && (fl.sefaz === "ok") !== statusSefazCliente(c).ok) return false;
    const u = usoDe(c), lim = c.limiteCredito ?? 0;
    for (const x of fl.credito) {
      if (x === "aberto" && !(u.aberto > 0)) return false;
      if (x === "vencido" && !(u.vencido > 0)) return false;
      if (x === "limite85" && !(lim > 0 && u.aberto / lim >= 0.85)) return false;
      if (x === "semLimite" && lim > 0) return false;
    }
    if (fl.contribuinte.length && !fl.contribuinte.includes((c.indIe ?? "9") as "1" | "2" | "9")) return false;
    if (fl.condicoes.length && !fl.condicoes.includes(c.condicaoPadrao ?? "a vista")) return false;
    const cp = compraDe(c);
    if (fl.compras !== "todos") {
      const dias = cp.ultima ? diasEntre(dataLocal(new Date(cp.ultima)), hoje) : Infinity;
      if (fl.compras === "nunca" && cp.qtd > 0) return false;
      if (fl.compras === "recente30" && !(dias <= 30)) return false;
      if (["30", "60", "90"].includes(fl.compras) && !(cp.qtd > 0 && dias > Number(fl.compras))) return false;
    }
    if (Number.isFinite(cMin) && cp.total < cMin) return false;
    if (Number.isFinite(cMax) && cp.total > cMax) return false;
    if (Number.isFinite(lMin) && lim < lMin) return false;
    if (Number.isFinite(lMax) && lim > lMax) return false;
    return casaTexto(fl.busca, [c.nome, c.documento, c.email, c.telefone, c.cidade, c.bairro, c.logradouro, c.cep, c.uf, c.ie]);
  });

  const ord = useOrdenacao<Cliente, Col>(filtrados, {
    nome: (c) => c.nome,
    documento: (c) => c.documento,
    cidade: (c) => c.cidade,
    uf: (c) => c.uf,
    aberto: (c) => usoDe(c).aberto,
    comprado: (c) => compraDe(c).total,
    ultima: (c) => compraDe(c).ultima || null,
  }, { col: "nome", dir: "asc" });
  const pag = usePaginacao(ord.ordenada, "clientes");

  const totAberto = filtrados.reduce((s, c) => s + usoDe(c).aberto, 0);
  const totVencido = filtrados.reduce((s, c) => s + usoDe(c).vencido, 0);
  const totComprado = filtrados.reduce((s, c) => s + compraDe(c).total, 0);

  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (fl.busca.trim()) ativos.push({ id: "b", rotulo: `Busca: “${fl.busca.trim()}”`, remover: () => set("busca", "") });
  if (fl.pessoa !== "todos") ativos.push({ id: "p", rotulo: fl.pessoa === "pf" ? "Pessoa física" : "Pessoa jurídica", remover: () => set("pessoa", "todos") });
  fl.ufs.forEach((u) => ativos.push({ id: `u-${u}`, rotulo: `UF: ${u}`, remover: () => toggle("ufs", u) }));
  if (fl.cidade) ativos.push({ id: "ci", rotulo: `Cidade: ${fl.cidade}`, remover: () => set("cidade", "") });
  if (fl.sefaz !== "todos") ativos.push({ id: "s", rotulo: fl.sefaz === "ok" ? "Cadastro OK p/ NF-e" : "Cadastro incompleto", remover: () => set("sefaz", "todos") });
  fl.credito.forEach((x) => ativos.push({ id: `cr-${x}`, rotulo: CREDITO.find((c) => c.valor === x)!.rotulo, remover: () => toggle("credito", x) }));
  fl.contribuinte.forEach((x) => ativos.push({ id: `ct-${x}`, rotulo: CONTRIBUINTE.find((c) => c.valor === x)!.rotulo, remover: () => toggle("contribuinte", x) }));
  fl.condicoes.forEach((x) => ativos.push({ id: `cd-${x}`, rotulo: `Condição: ${x}`, remover: () => toggle("condicoes", x) }));
  if (fl.compras !== "todos") ativos.push({ id: "cp", rotulo: fl.compras === "nunca" ? "Nunca comprou" : fl.compras === "recente30" ? "Comprou nos últimos 30 dias" : `Sem comprar há +${fl.compras} dias`, remover: () => set("compras", "todos") });
  if (Number.isFinite(cMin) || Number.isFinite(cMax)) ativos.push({ id: "tc", rotulo: `Comprado ${Number.isFinite(cMin) ? brl(cMin) : "…"} a ${Number.isFinite(cMax) ? brl(cMax) : "…"}`, remover: () => { set("compradoDe", ""); set("compradoAte", ""); } });
  if (Number.isFinite(lMin) || Number.isFinite(lMax)) ativos.push({ id: "li", rotulo: `Limite ${Number.isFinite(lMin) ? brl(lMin) : "…"} a ${Number.isFinite(lMax) ? brl(lMax) : "…"}`, remover: () => { set("limiteDe", ""); set("limiteAte", ""); } });

  function excluir(c: Cliente) {
    if (confirm(`Excluir o cliente "${c.nome}"?`)) delCliente(c.id);
  }

  function exportar() {
    exportarCsv("clientes",
      ["Nome / Razão social", "CPF/CNPJ", "Tipo", "E-mail", "Telefone", "CEP", "Endereço", "Número", "Bairro", "Cidade", "UF", "IE", "Limite de crédito", "Em aberto", "Vencido", "Total comprado", "Última compra", "Situação SEFAZ"],
      ord.ordenada.map((c) => {
        const u = usoDe(c), cp = compraDe(c);
        return [c.nome, c.documento, pessoaDe(c.documento) === "pj" ? "PJ" : pessoaDe(c.documento) === "pf" ? "PF" : "", c.email, c.telefone, c.cep, c.logradouro, c.numero, c.bairro, c.cidade, c.uf, c.ie,
          c.limiteCredito ?? 0, u.aberto, u.vencido, cp.total, cp.ultima ? new Date(cp.ultima).toLocaleDateString("pt-BR") : "", statusSefazCliente(c).ok ? "OK" : "Incompleto"];
      }));
  }

  const num = (v: string) => v.replace(/[^\d.,]/g, "");
  const th = { atual: ord.col, dir: ord.dir, onOrdenar: ord.ordenar };

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
        action={
          <div className="flex gap-2">
            <BotaoExportar onClick={exportar} total={filtrados.length} />
            <Button onClick={() => { setF(vazio); setOpen(true); }}>+ Novo cliente</Button>
          </div>
        }
      />

      <PainelFiltros>
        <BuscaGlobal value={fl.busca} onChange={(v) => set("busca", v)}
          placeholder="Buscar por nome, CPF/CNPJ (com ou sem pontos), e-mail, telefone, cidade, bairro, CEP, IE…" />
        <LinhaFiltros>
          <SelectFiltro rotulo="Tipo de pessoa" valor={fl.pessoa} padrao="todos" onChange={(v) => set("pessoa", v)} largura="min-w-[150px]"
            opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "pf", rotulo: "Pessoa física (CPF)" }, { valor: "pj", rotulo: "Pessoa jurídica (CNPJ)" }]} />
          <MultiSelectFiltro rotulo="UF" opcoes={ufs.map((u) => ({ valor: u, rotulo: u }))} selecionados={fl.ufs}
            onToggle={(v) => { toggle("ufs", v); set("cidade", ""); }} onLimpar={() => set("ufs", [])} largura="min-w-[110px]" />
          <SelectFiltro rotulo="Cidade" valor={fl.cidade} padrao="" onChange={(v) => set("cidade", v)}
            opcoes={[{ valor: "", rotulo: "Todas" }, ...cidades.map((c) => ({ valor: c, rotulo: c }))]} />
          <MultiSelectFiltro rotulo="Crédito / Financeiro" opcoes={CREDITO} selecionados={fl.credito}
            onToggle={(v) => toggle("credito", v)} onLimpar={() => set("credito", [])} />
          <SelectFiltro rotulo="Cadastro SEFAZ" valor={fl.sefaz} padrao="todos" onChange={(v) => set("sefaz", v)}
            opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "ok", rotulo: "OK para NF-e" }, { valor: "incompleto", rotulo: "Faltam dados" }]} />
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !fl.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {fl.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (última compra, contribuinte, condição, total comprado, limite)"}
        </button>
        {fl.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              <SelectFiltro rotulo="Última compra" valor={fl.compras} padrao="todos" onChange={(v) => set("compras", v)} largura="min-w-[200px]"
                opcoes={[
                  { valor: "todos", rotulo: "Todos" },
                  { valor: "recente30", rotulo: "Comprou nos últimos 30 dias" },
                  { valor: "30", rotulo: "Sem comprar há +30 dias" },
                  { valor: "60", rotulo: "Sem comprar há +60 dias" },
                  { valor: "90", rotulo: "Sem comprar há +90 dias" },
                  { valor: "nunca", rotulo: "Nunca comprou" },
                ]} />
              <MultiSelectFiltro rotulo="Contribuinte ICMS" opcoes={CONTRIBUINTE} selecionados={fl.contribuinte}
                onToggle={(v) => toggle("contribuinte", v)} onLimpar={() => set("contribuinte", [])} />
              <MultiSelectFiltro rotulo="Condição de pagamento" opcoes={CONDICOES.map((c) => ({ valor: c, rotulo: c === "a vista" ? "À vista" : c }))} selecionados={fl.condicoes}
                onToggle={(v) => toggle("condicoes", v)} onLimpar={() => set("condicoes", [])} />
              <IntervaloFiltro rotulo="Total comprado (R$)">
                de <input inputMode="decimal" value={fl.compradoDe} onChange={(e) => set("compradoDe", num(e.target.value))} placeholder="0,00" className={cn(inputFiltro, "w-24 text-right")} aria-label="Comprado de" />
                até <input inputMode="decimal" value={fl.compradoAte} onChange={(e) => set("compradoAte", num(e.target.value))} placeholder="sem limite" className={cn(inputFiltro, "w-24 text-right")} aria-label="Comprado até" />
              </IntervaloFiltro>
              <IntervaloFiltro rotulo="Limite de crédito (R$)">
                de <input inputMode="decimal" value={fl.limiteDe} onChange={(e) => set("limiteDe", num(e.target.value))} placeholder="0,00" className={cn(inputFiltro, "w-24 text-right")} aria-label="Limite de" />
                até <input inputMode="decimal" value={fl.limiteAte} onChange={(e) => set("limiteAte", num(e.target.value))} placeholder="sem limite" className={cn(inputFiltro, "w-24 text-right")} aria-label="Limite até" />
              </IntervaloFiltro>
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
        <span><b className="text-slate-900">{filtrados.length}</b> de {db.clientes.length} cliente(s)</span>
        <span>A receber em aberto: <b className="text-slate-900">{brl(totAberto)}</b></span>
        {totVencido > 0 && <span>Vencido: <b className="text-rose-600">{brl(totVencido)}</b></span>}
        <span>Total comprado: <b className="text-emerald-700">{brl(totComprado)}</b></span>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <ThOrd col="nome" {...th}>Cliente</ThOrd>
                <ThOrd col="documento" {...th}>CPF / CNPJ</ThOrd>
                <th className="px-4 py-3 uppercase tracking-wide">Contato</th>
                <ThOrd col="cidade" {...th}>Cidade / UF</ThOrd>
                <ThOrd col="aberto" {...th} alinhar="right">Crédito</ThOrd>
                <ThOrd col="comprado" {...th} alinhar="right">Comprado</ThOrd>
                <ThOrd col="ultima" {...th}>Última compra</ThOrd>
                <th className="px-4 py-3 uppercase tracking-wide">SEFAZ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pag.itens.map((c) => {
                const st = statusSefazCliente(c);
                const uso = usoDe(c);
                const cp = compraDe(c);
                const limite = c.limiteCredito ?? 0;
                const pct = limite > 0 ? Math.min(100, (uso.aberto / limite) * 100) : 0;
                const pes = pessoaDe(c.documento);
                return (
                  <tr key={c.id} className="hover:bg-slate-50/70" onDoubleClick={() => { setF({ ...c }); setOpen(true); }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-700">
                          {c.nome.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <button type="button" onClick={() => { setF({ ...c }); setOpen(true); }} className="max-w-[240px] truncate text-left font-medium text-slate-800 hover:text-sky-700 hover:underline">
                            {c.nome}
                          </button>
                          {pes && <p className="text-[11px] text-slate-400">{pes === "pj" ? "Pessoa jurídica" : "Pessoa física"}{c.condicaoPadrao ? ` · ${c.condicaoPadrao}` : ""}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{c.documento || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <p>{c.telefone || "—"}</p>
                      <p className="max-w-[200px] truncate text-slate-400">{c.email}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {c.cidade || "—"}{c.uf ? `/${c.uf.toUpperCase()}` : ""}
                      {c.bairro && <p className="text-[11px] text-slate-400">{c.bairro}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("font-semibold", uso.vencido > 0 ? "text-rose-600" : "text-slate-800")}>{brl(uso.aberto)}</span>
                      {limite > 0 && (
                        <>
                          <p className="text-[10px] text-slate-400">de {brl(limite)}</p>
                          <div className="ml-auto mt-1 h-1 w-20 overflow-hidden rounded-full bg-slate-200">
                            <div className={cn("h-full rounded-full", pct > 85 ? "bg-rose-500" : pct > 60 ? "bg-amber-400" : "bg-sky-500")} style={{ width: `${pct}%` }} />
                          </div>
                        </>
                      )}
                      {uso.vencido > 0 && <p className="text-[10px] font-bold text-rose-600">vencido {brl(uso.vencido)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {brl(cp.total)}
                      {cp.qtd > 0 && <p className="text-[10px] font-normal text-slate-400">{cp.qtd} compra(s)</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {cp.ultima ? new Date(cp.ultima).toLocaleDateString("pt-BR") : <span className="text-slate-300">nunca</span>}
                    </td>
                    <td className="px-4 py-3">
                      {st.ok ? <Badge tone="green">✓ OK</Badge> : (
                        <span title={`Faltam: ${st.faltando.join(", ")}`}><Badge tone="red">⚠ {st.faltando.length} pendência(s)</Badge></span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => { setF({ ...c }); setOpen(true); }} className="mr-3 text-xs font-semibold text-sky-600 hover:underline">Editar</button>
                      <button onClick={() => excluir(c)} className="text-xs font-semibold text-rose-500 hover:underline">Excluir</button>
                    </td>
                  </tr>
                );
              })}
              {filtrados.length === 0 && (
                <tr><td colSpan={9} className="py-12 text-center text-slate-400">
                  {db.clientes.length === 0 ? "Nenhum cliente cadastrado." : (
                    <>Nenhum cliente com esses filtros. <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button></>
                  )}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Paginacao {...pag} />
      </Card>

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
