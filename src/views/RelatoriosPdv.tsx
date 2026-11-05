"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon, cn } from "@/components/ui";
import { ABAS_RELATORIOS_PDV, type AbaRelatorioPdv, type ColunaRelatorioPdv, type DetalheCaixaRelatorio, type FiltrosRelatorioPdv, type FormatoRelatorio, type IndicadorRelatorioPdv, type LinhaRelatorioPdv, type RespostaRelatorioPdv, type ValorRelatorio } from "@/lib/relatoriosPdv";

type FiltrosTela = Pick<FiltrosRelatorioPdv, "inicio" | "fim" | "terminal" | "operador" | "categoria" | "statusTurno" | "top">;
const caixaCampo = "h-10 w-full rounded-lg border border-ink-200 bg-white px-3 text-[13px] text-ink-800 outline-none transition focus:border-way-500 focus:ring-2 focus:ring-way-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400";
const rotuloCampo = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500";

function textoValor(valor: ValorRelatorio | undefined, formato: FormatoRelatorio | undefined, fuso: string): string {
  if (valor == null || valor === "") return "—";
  if (formato === "datahora") {
    const d = new Date(String(valor));
    return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: fuso }).format(d) : "—";
  }
  if (typeof valor !== "number") return String(valor);
  if (formato === "moeda" || formato === "diferenca") return `${formato === "diferenca" && valor > 0 ? "+" : ""}${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor)}`;
  if (formato === "percentual") return `${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(valor)}%`;
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: formato === "quantidade" ? 3 : 0 }).format(valor);
}

function parametros(aba: AbaRelatorioPdv, detalhe: DetalheCaixaRelatorio, pagina: number, filtros: FiltrosTela) {
  const p = new URLSearchParams({ aba, detalhe, pagina: String(pagina), tamanho: "10", inicio: filtros.inicio, fim: filtros.fim, terminal: filtros.terminal, operador: filtros.operador, categoria: aba === "produtos" ? filtros.categoria : "", statusTurno: aba === "caixa" ? filtros.statusTurno : "todos", top: String(filtros.top) });
  return p.toString();
}

function Indicador({ item, fuso }: { item: IndicadorRelatorioPdv; fuso: string }) {
  const cores = {
    verde: "bg-emerald-50 text-emerald-700", azul: "bg-blue-50 text-blue-700",
    laranja: "bg-amber-50 text-amber-700", roxo: "bg-violet-50 text-violet-700",
  };
  return (
    <div className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-ink-500">{item.rotulo}</p>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", cores[item.tom ?? "verde"])}><Icon name={item.icone} className="size-4" /></span>
      </div>
      <p className="tabular mt-2 text-[22px] font-bold tracking-tight text-ink-900 sm:text-[24px]">{item.valor == null ? "—" : textoValor(item.valor, item.formato, fuso)}</p>
      <p className="mt-1.5 min-h-8 text-[11px] leading-4 text-ink-400">{item.detalhe}</p>
    </div>
  );
}

function Celula({ coluna, linha, fuso }: { coluna: ColunaRelatorioPdv; linha: LinhaRelatorioPdv; fuso: string }) {
  const valor = linha[coluna.chave];
  const texto = textoValor(valor, coluna.formato, fuso);
  if (coluna.formato === "estoque") {
    const alerta = texto === "Zerado" || texto === "No mínimo" || texto === "Próximo do mínimo";
    return <span className={cn("inline-flex rounded-full px-2 py-1 text-[11px] font-semibold", alerta ? "bg-amber-50 text-amber-700" : "bg-ink-50 text-ink-500")}>{alerta && "● "}{texto}</span>;
  }
  if (coluna.formato === "classe") return <span className={cn("inline-grid size-7 place-items-center rounded-lg text-xs font-bold", texto === "A" ? "bg-emerald-50 text-emerald-700" : texto === "B" ? "bg-blue-50 text-blue-700" : "bg-ink-50 text-ink-500")}>{texto}</span>;
  if (coluna.formato === "identificador") return <span title={texto} className="font-mono text-[11px] text-ink-400">{texto === "—" ? texto : `${texto.slice(0, 8)}…`}</span>;
  return <span className={cn(coluna.formato === "diferenca" && typeof valor === "number" && (valor < 0 ? "font-bold text-red-600" : valor > 0 ? "font-bold text-blue-600" : "text-ink-500"))}>{texto}</span>;
}

function TabelaRelatorio({ dados, pagina, mudarPagina }: { dados: RespostaRelatorioPdv; pagina: number; mudarPagina: (p: number) => void }) {
  const primeira = dados.total ? (pagina - 1) * dados.filtros.tamanhoPagina + 1 : 0;
  const ultima = Math.min(dados.total, pagina * dados.filtros.tamanhoPagina);
  return (
    <div className="overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-5 py-4">
        <div><h2 className="text-sm font-bold text-ink-800">{dados.aba === "caixa" ? dados.detalhe === "turnos" ? "Histórico de turnos" : "Histórico de sangrias" : dados.aba === "visao" ? "Distribuição por modalidade" : dados.aba === "produtos" ? "Ranking de produtos" : dados.aba === "operadores" ? "Desempenho por operador" : "Cupons cancelados"}</h2><p className="mt-0.5 text-[11px] text-ink-400">{dados.total} {dados.total === 1 ? "registro encontrado" : "registros encontrados"}</p></div>
        <span className="rounded-full bg-ink-50 px-2.5 py-1 text-[10px] font-semibold text-ink-500">Dados da empresa atual</span>
      </div>
      {dados.linhas.length === 0 ? (
        <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center"><span className="grid size-11 place-items-center rounded-2xl bg-ink-50 text-ink-400"><Icon name="busca" className="size-5" /></span><p className="mt-3 text-sm font-semibold text-ink-700">Nenhum registro encontrado</p><p className="mt-1 max-w-sm text-xs leading-5 text-ink-400">Experimente outro período ou ajuste os filtros para encontrar os dados desejados.</p></div>
      ) : (
        <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-[12px]"><thead className="bg-ink-50/80"><tr>{dados.colunas.map((c) => <th key={c.chave} className={cn("whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[0.05em] text-ink-400", ["moeda", "percentual", "numero", "quantidade", "diferenca"].includes(c.formato ?? "") && "text-right")}>{c.rotulo}</th>)}</tr></thead><tbody className="divide-y divide-ink-100">{dados.linhas.map((linha, indice) => <tr key={`${pagina}-${indice}`} className="transition-colors hover:bg-ink-50/60">{dados.colunas.map((coluna) => <td key={coluna.chave} className={cn("max-w-[260px] px-4 py-3 text-ink-600", ["moeda", "percentual", "numero", "quantidade", "diferenca"].includes(coluna.formato ?? "") && "tabular whitespace-nowrap text-right", coluna.chave === "produto" || coluna.chave === "operador" ? "font-semibold text-ink-800" : "")}><Celula coluna={coluna} linha={linha} fuso={dados.fuso} /></td>)}</tr>)}</tbody></table></div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-5 py-3 text-[12px] text-ink-400">
        <span>Mostrando {primeira}–{ultima} de {dados.total}</span>
        <div className="flex items-center gap-2"><button type="button" aria-label="Página anterior" onClick={() => mudarPagina(pagina - 1)} disabled={pagina <= 1} className="grid size-8 place-items-center rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="chevron" className="size-4 rotate-180" /></button><span className="min-w-16 text-center font-semibold text-ink-600">{pagina} / {dados.paginas}</span><button type="button" aria-label="Próxima página" onClick={() => mudarPagina(pagina + 1)} disabled={pagina >= dados.paginas} className="grid size-8 place-items-center rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-40"><Icon name="chevron" className="size-4" /></button></div>
      </div>
    </div>
  );
}

function GraficoPagamentos({ linhas, fuso }: { linhas: LinhaRelatorioPdv[]; fuso: string }) {
  const cores = ["bg-emerald-500", "bg-blue-500", "bg-violet-500", "bg-sky-500", "bg-amber-500", "bg-rose-400"];
  return <div className="rounded-xl border border-ink-100 bg-white p-5 shadow-sm"><div className="mb-5 flex items-start justify-between"><div><h2 className="text-sm font-bold text-ink-800">Recebimentos por modalidade</h2><p className="mt-1 text-xs text-ink-400">Participação no total líquido recebido</p></div><span className="grid size-9 place-items-center rounded-xl bg-way-50 text-way-700"><Icon name="grafico" className="size-4" /></span></div><div className="grid gap-x-8 gap-y-4 md:grid-cols-2">{linhas.map((l, i) => <div key={String(l.forma)}><div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]"><span className="font-semibold text-ink-700">{l.forma}</span><span className="tabular text-ink-500">{textoValor(l.valor, "moeda", fuso)} <span className="ml-1 text-ink-400">· {textoValor(l.percentual, "percentual", fuso)}</span></span></div><div className="h-2 overflow-hidden rounded-full bg-ink-100"><div className={cn("h-full rounded-full transition-all", cores[i % cores.length])} style={{ width: `${Math.min(100, Math.max(0, Number(l.percentual) || 0))}%` }} /></div></div>)}</div></div>;
}

export function RelatoriosPdvView({ empresa, fuso, periodoInicial }: { empresa: string; fuso: string; periodoInicial: { inicio: string; fim: string } }) {
  const inicial: FiltrosTela = { ...periodoInicial, terminal: "", operador: "", categoria: "", statusTurno: "todos", top: 10 };
  const [rascunho, setRascunho] = useState<FiltrosTela>(inicial);
  const [aplicados, setAplicados] = useState<FiltrosTela>(inicial);
  const [aba, setAba] = useState<AbaRelatorioPdv>("visao");
  const [detalhe, setDetalhe] = useState<DetalheCaixaRelatorio>("turnos");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<RespostaRelatorioPdv | null>(null);
  const [opcoes, setOpcoes] = useState<{ terminais: string[]; categorias: string[] }>({ terminais: [], categorias: [] });
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState("");
  const [atualizacao, setAtualizacao] = useState(0);
  const query = useMemo(() => parametros(aba, detalhe, pagina, aplicados), [aba, detalhe, pagina, aplicados]);

  useEffect(() => {
    const controlador = new AbortController();
    setCarregando(true); setErro(""); setDados(null);
    fetch(`/api/relatorios/pdv?${query}`, { cache: "no-store", signal: controlador.signal })
      .then(async (r) => { const json = await r.json(); if (!r.ok || !json.ok) throw new Error(json.erro || "Não foi possível carregar o relatório."); return json as RespostaRelatorioPdv; })
      .then((json) => { if (pagina > json.paginas) { setPagina(json.paginas); return; } setDados(json); setOpcoes(json.opcoes); })
      .catch((e: unknown) => { if (!controlador.signal.aborted) setErro(e instanceof Error ? e.message : "Não foi possível carregar o relatório."); })
      .finally(() => { if (!controlador.signal.aborted) setCarregando(false); });
    return () => controlador.abort();
  }, [query, pagina, atualizacao]);

  function aplicar(e: FormEvent<HTMLFormElement>) { e.preventDefault(); setPagina(1); setAplicados({ ...rascunho }); }
  function limpar() { const limpos = { ...inicial }; setRascunho(limpos); setAplicados(limpos); setPagina(1); }
  function trocarAba(id: AbaRelatorioPdv) { setAba(id); setPagina(1); setDetalhe("turnos"); }
  async function exportar() {
    if (exportando) return;
    setExportando(true); setErro("");
    try {
      const r = await fetch(`/api/relatorios/pdv?${query}&exportar=csv`, { cache: "no-store" });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || "Não foi possível exportar o CSV."); }
      const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `relatorio-pdv-${aba}${aba === "caixa" ? `-${detalhe}` : ""}-${aplicados.inicio}-${aplicados.fim}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível exportar o CSV."); }
    finally { setExportando(false); }
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-way-700"><span className="size-1.5 rounded-full bg-way-500" /> Gestão / Inteligência de vendas</p><h1 className="text-[27px] font-extrabold tracking-tight text-ink-900 sm:text-[31px]">Relatórios de PDV</h1><p className="mt-1 text-[13px] text-ink-500">Uma visão completa das vendas, produtos e operação da sua loja.</p></div>
        <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700"><Icon name="cadeado" className="size-3.5" /> Acesso gerencial</span><Link href="/dashboard/auditoria-caixa" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-600 hover:bg-ink-50">Auditoria de caixa <Icon name="seta" className="size-3.5" /></Link></div>
      </div>

      <form onSubmit={aplicar} className="rounded-xl border border-ink-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg bg-way-50 text-way-700"><Icon name="busca" className="size-4" /></span><div><h2 className="text-[13px] font-bold text-ink-800">Filtros do relatório</h2><p className="text-[11px] text-ink-400">Os filtros são aplicados na consulta ao banco.</p></div></div><button type="button" onClick={limpar} className="text-[11px] font-semibold text-ink-500 hover:text-way-700">Limpar filtros</button></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label><span className={rotuloCampo}>Data inicial</span><input className={caixaCampo} type="date" value={rascunho.inicio} onChange={(e) => setRascunho({ ...rascunho, inicio: e.target.value })} required /></label>
          <label><span className={rotuloCampo}>Data final</span><input className={caixaCampo} type="date" value={rascunho.fim} onChange={(e) => setRascunho({ ...rascunho, fim: e.target.value })} required /></label>
          <label><span className={rotuloCampo}>Loja / empresa</span><input className={caixaCampo} value={empresa} disabled title="Os dados são restritos à empresa da sua sessão." /></label>
          <label><span className={rotuloCampo}>Caixa / terminal</span><select className={caixaCampo} value={rascunho.terminal} onChange={(e) => setRascunho({ ...rascunho, terminal: e.target.value })}><option value="">Todos os terminais</option>{opcoes.terminais.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="sm:col-span-2 lg:col-span-1"><span className={rotuloCampo}>Operador / ID</span><input className={caixaCampo} placeholder="Nome ou ID" value={rascunho.operador} onChange={(e) => setRascunho({ ...rascunho, operador: e.target.value })} maxLength={120} /></label>
          {aba === "produtos" && <><label><span className={rotuloCampo}>Categoria</span><select className={caixaCampo} value={rascunho.categoria} onChange={(e) => setRascunho({ ...rascunho, categoria: e.target.value })}><option value="">Todas as categorias</option>{opcoes.categorias.map((c) => <option key={c} value={c}>{c}</option>)}</select></label><label><span className={rotuloCampo}>Ranking</span><select className={caixaCampo} value={rascunho.top} onChange={(e) => setRascunho({ ...rascunho, top: Number(e.target.value) as 10 | 50 | 100 })}><option value={10}>Top 10</option><option value={50}>Top 50</option><option value={100}>Top 100</option></select></label></>}
          {aba === "caixa" && <label><span className={rotuloCampo}>Status do turno</span><select className={caixaCampo} value={rascunho.statusTurno} onChange={(e) => setRascunho({ ...rascunho, statusTurno: e.target.value as FiltrosTela["statusTurno"] })}><option value="todos">Todos os turnos</option><option value="aberto">Aberto</option><option value="fechado">Fechado</option></select></label>}
          {aba === "cancelamentos" && <label><span className={rotuloCampo}>Autorizador</span><input className={caixaCampo} value="Não registrado" disabled title="O sistema atual não registra autorizador de cancelamento." /></label>}
          <div className="flex items-end"><button type="submit" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 text-[12px] font-bold text-white transition hover:bg-ink-800"><Icon name="busca" className="size-4" /> Aplicar filtros</button></div>
        </div>
        <p className="mt-3 text-[10.5px] text-ink-400">Até 366 dias por consulta · horário de referência: {fuso.replace("America/", "").replaceAll("_", " ")} · somente a empresa atual</p>
      </form>

      <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white p-1 shadow-sm"><div className="flex min-w-max gap-1" role="tablist" aria-label="Relatórios de PDV">{ABAS_RELATORIOS_PDV.map((a) => <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => trocarAba(a.id)} className={cn("min-w-[145px] flex-1 rounded-lg px-4 py-3 text-left transition", aba === a.id ? "bg-ink-900 text-white" : "text-ink-500 hover:bg-ink-50 hover:text-ink-800")}><span className="block text-[12px] font-bold">{a.rotulo}</span><span className={cn("mt-0.5 block text-[10px]", aba === a.id ? "text-ink-300" : "text-ink-400")}>{a.descricao}</span></button>)}</div></div>

      {erro && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"><span>{erro}</span><button type="button" onClick={() => setAtualizacao((x) => x + 1)} className="font-bold underline">Tentar novamente</button></div>}
      {carregando && <div aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((n) => <div key={n} className="h-28 animate-pulse rounded-xl border border-ink-100 bg-white p-4"><div className="h-3 w-1/2 rounded bg-ink-100" /><div className="mt-5 h-6 w-2/3 rounded bg-ink-100" /></div>)}</div>}
      {dados && !carregando && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{dados.indicadores.map((item) => <Indicador key={item.rotulo} item={item} fuso={fuso} />)}</div>
        {aba === "visao" && <GraficoPagamentos linhas={dados.linhas} fuso={fuso} />}
        <div className="flex flex-wrap items-center justify-between gap-3"><div>{aba === "caixa" ? <div className="inline-flex rounded-lg bg-ink-100 p-1" aria-label="Detalhe da auditoria">{(["turnos", "sangrias"] as const).map((d) => <button type="button" key={d} onClick={() => { setDetalhe(d); setPagina(1); }} className={cn("rounded-md px-3 py-1.5 text-[11px] font-bold", detalhe === d ? "bg-white text-ink-800 shadow-sm" : "text-ink-500 hover:text-ink-800")}>{d === "turnos" ? "Turnos" : "Sangrias"}</button>)}</div> : <p className="text-xs text-ink-400">Resultados do período selecionado</p>}</div><button type="button" onClick={() => void exportar()} disabled={exportando || dados.total === 0} className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3.5 text-xs font-bold text-ink-700 shadow-sm transition hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"><Icon name="baixar" className="size-4" />{exportando ? "Exportando…" : "Exportar CSV"}</button></div>
        <TabelaRelatorio dados={dados} pagina={pagina} mudarPagina={setPagina} />
        {dados.avisos.length > 0 && <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-4"><span className="mt-0.5 text-blue-600"><Icon name="ajuda" className="size-4" /></span><div><p className="text-xs font-bold text-blue-900">Como interpretar estes dados</p><ul className="mt-1.5 space-y-1 text-[11px] leading-5 text-blue-800/80">{dados.avisos.map((aviso) => <li key={aviso}>• {aviso}</li>)}</ul></div></div>}
      </>}
    </div>
  );
}
