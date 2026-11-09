"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Badge, Button, cn } from "@/components/ui";
import { dataHoraBR } from "@/lib/dominio";
import { codigoNcmDigitado, dataNcmBR, formatarCodigoNcm, FONTE_NCM, selecionavelNcm, URL_CLASSIF, type ConsultaNcmDto, type ItemNcm } from "@/lib/ncm";

/** A consulta só modifica o NCM do rascunho por um clique explícito. Nenhum outro campo é inferido. */
export function ConsultaNcm({ valor, aoMudar, podeAtualizar, disabled = false }: {
  valor: string; aoMudar: (ncm: string) => void; podeAtualizar: boolean; disabled?: boolean;
}) {
  const id = useId();
  const buscaRef = useRef<HTMLInputElement>(null);
  const aberturaRef = useRef<HTMLButtonElement>(null);
  const escolhas = useRef<(HTMLButtonElement | null)[]>([]);
  const [aberto, setAberto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [revisao, setRevisao] = useState(0);
  const [dados, setDados] = useState<ConsultaNcmDto | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!aberto) return;
    const controller = new AbortController();
    setBuscando(true); setErro(""); setDados(null);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: consulta, pagina: String(pagina) });
        const resposta = await fetch(`/api/fiscal/ncm?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const json = await resposta.json();
        if (!resposta.ok || !json.ok || !json.dados) throw new Error(resposta.status === 401 ? "Sessão expirada. Entre novamente." : resposta.status === 403 ? "Seu perfil não permite esta consulta." : "Não foi possível consultar o catálogo. Mantenha o código atual ou preencha manualmente com orientação contábil.");
        if (!controller.signal.aborted) { setDados(json.dados as ConsultaNcmDto); setBuscando(false); }
      } catch (e) {
        if (!controller.signal.aborted) { setErro(e instanceof Error && e.message.startsWith("Sessão expirada") ? e.message : "Consulta indisponível. O NCM do formulário foi preservado; você pode usar o preenchimento manual orientado."); setBuscando(false); }
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [aberto, consulta, pagina, revisao]);

  useEffect(() => {
    if (!aberto || !dados?.catalogo.atualizando) return;
    // Só consulta o estado. Nunca repete o POST nem dispara download externo automaticamente.
    const timer = setTimeout(() => setRevisao((n) => n + 1), 2000);
    return () => clearTimeout(timer);
  }, [aberto, dados]);

  async function atualizar() {
    if (atualizando || disabled) return;
    setAtualizando(true); setAviso("");
    try {
      const r = await fetch("/api/fiscal/ncm", { method: "POST", headers: { "X-NKWAY-NCM": "atualizar" }, cache: "no-store", signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      setAviso(typeof j.mensagem === "string" ? j.mensagem : "Não foi possível atualizar. Preserve os dados atuais e tente novamente mais tarde.");
    } catch { setAviso("A atualização não foi confirmada. Consulte novamente o estado; nenhum produto foi alterado por esta consulta."); }
    finally { setAtualizando(false); setRevisao((n) => n + 1); }
  }

  function escolher(item: ItemNcm) {
    if (disabled || buscando || !dados || !selecionavelNcm(item, dados.hoje)) return;
    aoMudar(item.codigo);
    setAviso(`NCM ${formatarCodigoNcm(item.codigo)} colocado no formulário${dados.catalogo.estado === "atual" ? "" : " como referência manual desatualizada"}. Revise e clique em Salvar produto; não houve alteração de CEST, perfil ou alíquotas.`);
  }
  function navegar(event: KeyboardEvent<HTMLElement>, atual = -1) {
    const disponiveis = escolhas.current.map((botao, indice) => ({ botao, indice })).filter((x) => x.botao && !x.botao.disabled);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setAberto(false); aberturaRef.current?.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !disponiveis.length) return;
    event.preventDefault();
    const pos = disponiveis.findIndex((x) => x.indice === atual);
    const proximo = event.key === "Home" ? 0 : event.key === "End" ? disponiveis.length - 1 : event.key === "ArrowDown" ? Math.min(pos + 1, disponiveis.length - 1) : pos - 1;
    if (proximo < 0) buscaRef.current?.focus(); else disponiveis[proximo]?.botao?.focus();
  }

  const cat = dados?.catalogo;
  return (
    <section className="rounded-xl border border-ink-200 bg-ink-50/40 p-3.5" aria-labelledby={`${id}-titulo`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 id={`${id}-titulo`} className="text-[13px] font-bold text-ink-800">NCM da mercadoria</h3><p className="mt-0.5 text-[11px] text-ink-500">Consulte a classificação sem preencher impostos automaticamente.</p></div>
        <Badge tom="info">Fonte pública oficial</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor={`${id}-valor`} className="mb-1 block text-[11.5px] font-semibold text-ink-600">NCM no formulário · 8 dígitos</label>
          <input id={`${id}-valor`} value={valor} onChange={(e) => { aoMudar(e.target.value); setAviso("Preenchimento informado pelo usuário; a classificação não foi certificada pelo sistema."); }} disabled={disabled} inputMode="numeric" maxLength={16} aria-describedby={`${id}-orientacao`} className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 font-mono text-xs text-ink-800 outline-none focus:border-way-500 focus:ring-2 focus:ring-way-100 disabled:opacity-60" />
        </div>
        <button ref={aberturaRef} type="button" disabled={disabled} aria-expanded={aberto} aria-controls={`${id}-consulta`} onClick={() => { if (!aberto) { setConsulta(valor !== "00000000" ? valor : ""); setPagina(1); } setAberto(!aberto); }} className="rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-way-600 disabled:opacity-60">
          {aberto ? "Fechar consulta" : "Consultar NCM"}
        </button>
      </div>
      <p id={`${id}-orientacao`} className="mt-2 text-[11px] leading-relaxed text-ink-500">NCM classifica a mercadoria, não define CEST, CST/CSOSN ou alíquotas. O preenchimento manual continua disponível e será auditado ao salvar uma alteração. Confirme o enquadramento com a contabilidade.</p>
      {(!codigoNcmDigitado(valor) || valor === "00000000") && <p className="mt-1 text-[11px] font-medium text-amber-800">Código ausente, genérico ou incompleto. Um grupo hierárquico não é um NCM de 8 dígitos.</p>}
      {aberto && (
        <div id={`${id}-consulta`} className="mt-4 space-y-3 border-t border-ink-200 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <a href={URL_CLASSIF} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-way-700 hover:underline">{FONTE_NCM} ↗</a>
            <span className="text-[10.5px] text-ink-400">Cópia local por empresa · coleta sob demanda · cache de até 24h</span>
          </div>
          <div>
            <label htmlFor={`${id}-busca`} className="mb-1 block text-[11.5px] font-semibold text-ink-700">Buscar por código ou descrição</label>
            <input ref={buscaRef} id={`${id}-busca`} type="search" value={consulta} onChange={(e) => { setConsulta(e.target.value); setPagina(1); }} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Escape") navegar(e); }} maxLength={80} aria-controls={`${id}-resultados`} aria-describedby={`${id}-teclado`} disabled={disabled} placeholder="Ex.: 0101.21.00, café torrado, bovinos…" className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-xs text-ink-800 outline-none focus:border-way-500 focus:ring-2 focus:ring-way-100" />
            <p id={`${id}-teclado`} className="mt-1 text-[10.5px] text-ink-400">Digite para buscar. Use ↓ para entrar na lista, ↑/↓ para navegar e Enter para escolher. Esc fecha apenas a consulta.</p>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" className="text-[11.5px] text-ink-600">
            {buscando ? "Consultando a cópia local…" : erro || (dados ? `${dados.total} código(s) completo(s) encontrado(s).` : "")}
          </div>
          {cat && (
            <div className="rounded-lg border border-ink-100 bg-white p-3 text-[11px]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <Badge tom={cat.estado === "atual" ? "info" : "alerta"}>{cat.estado === "atual" ? "Cópia recente · não é homologação" : cat.estado === "ausente" ? "Sem catálogo coletado" : "Referência desatualizada"}</Badge>
                {podeAtualizar && dados?.podeAtualizar ? <Button tipo="button" tamanho="sm" variante="secundario" disabled={disabled || atualizando || cat.atualizando} onClick={() => void atualizar()}>{atualizando || cat.atualizando ? "Atualizando…" : "Atualizar catálogo oficial"}</Button> : <span className="text-ink-400">Solicite a atualização a quem gerencia as configurações.</span>}
              </div>
              <dl className="grid gap-2 sm:grid-cols-2">
                <div><dt className="text-ink-400">Vigência declarada da tabela</dt><dd className="font-semibold text-ink-700">{cat.referenciaFonte ?? "Não informada"}</dd></div>
                <div><dt className="text-ink-400">Última coleta íntegra</dt><dd className="font-semibold text-ink-700">{cat.coletadoEm ? dataHoraBR(cat.coletadoEm) : "Nenhuma coleta bem-sucedida"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-ink-400">Ato informado pela fonte</dt><dd className="text-ink-700">{cat.ato ?? "Não informado"}</dd></div>
              </dl>
              <p className="mt-2 text-ink-400">A data de coleta não é a data de vigência nem a última alteração legal. O download contém somente a tabela vigente na referência declarada, não o histórico completo ou códigos futuros.</p>
              {cat.estado !== "atual" && <p className="mt-2 text-amber-800">{cat.estado === "ausente" ? "Atualize o catálogo ou informe o código manualmente com orientação contábil. Nenhum NCM foi validado oficialmente." : "A referência precisa de atualização. A última versão íntegra foi mantida; use-a apenas como apoio à conferência manual."}</p>}
              {cat.erro && <p className="mt-2 text-amber-800">{cat.erro}{cat.falhaEm ? ` Tentativa: ${dataHoraBR(cat.falhaEm)}.` : ""}</p>}
              {cat.repetirApos && (cat.erro || cat.estado === "desatualizado") && <p className="mt-1 text-ink-400">Nova tentativa a partir de {dataHoraBR(cat.repetirApos)}.</p>}
            </div>
          )}
          {!!dados?.grupos.length && <nav aria-label="Níveis hierárquicos NCM" className="rounded-lg border border-ink-100 p-2.5"><p className="mb-2 text-[11px] font-semibold text-ink-500">Grupos para navegar · não podem ser selecionados como NCM</p><div className="flex flex-wrap gap-1.5">{dados.grupos.map((g) => <button key={g.codigo} type="button" disabled={disabled || buscando} onClick={() => { setConsulta(g.codigo); setPagina(1); buscaRef.current?.focus(); }} className="rounded-md border border-ink-200 bg-white px-2 py-1 text-left text-[11px] text-ink-600 hover:border-way-400 focus-visible:outline-2 focus-visible:outline-way-600"><span className="font-mono font-semibold">{g.codigo}</span> · {g.descricao} →</button>)}</div></nav>}
          <ul id={`${id}-resultados`} aria-label="Códigos NCM completos" aria-busy={buscando} className="max-h-72 divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-100 bg-white">
            {dados?.itens.map((item, indice) => {
              const disponivel = selecionavelNcm(item, dados.hoje);
              return <li key={item.codigo}><button type="button" ref={(el) => { escolhas.current[indice] = el; }} disabled={disabled || buscando || !disponivel} onKeyDown={(e) => navegar(e, indice)} onClick={() => escolher(item)} className={cn("w-full px-3 py-3 text-left transition hover:bg-way-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-way-600 disabled:cursor-not-allowed disabled:opacity-50", codigoNcmDigitado(valor) === item.codigo && "bg-way-50")}>
                <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-[12px] font-bold text-way-800">{formatarCodigoNcm(item.codigo)}</span><span className="text-[10px] font-semibold text-way-700">{!disponivel ? "Fora da vigência atual" : dados.catalogo.estado === "atual" ? "Usar este NCM →" : "Usar como referência manual →"}</span></span>
                {item.caminho && <span className="mt-1 block text-[10.5px] leading-relaxed text-ink-400">{item.caminho}</span>}
                <span className="mt-1 block text-[12px] font-semibold leading-relaxed text-ink-800">{item.descricao}</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-ink-500">Vigência do código: {dataNcmBR(item.inicio)} a {dataNcmBR(item.fim)} · {item.ato}</span>
              </button></li>;
            })}
          </ul>
          {dados && dados.total > 0 && <div className="flex items-center justify-between gap-2"><Button tipo="button" tamanho="sm" variante="secundario" disabled={disabled || buscando || dados.pagina <= 1} onClick={() => setPagina(dados.pagina - 1)}>Anterior</Button><span className="text-[11px] text-ink-500">Página {dados.pagina} de {Math.ceil(dados.total / dados.porPagina)} · até {dados.porPagina} itens</span><Button tipo="button" tamanho="sm" variante="secundario" disabled={disabled || buscando || dados.pagina >= Math.ceil(dados.total / dados.porPagina)} onClick={() => setPagina(dados.pagina + 1)}>Próxima</Button></div>}
          {dados && !dados.total && dados.catalogo.estado !== "ausente" && <p className="text-[11px] text-ink-500">Nenhum código completo encontrado. Tente outro termo, navegue pelo grupo ou consulte o Classif. O valor atual não foi apagado.</p>}
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-2 text-[11px] leading-relaxed text-way-800">{aviso}</p>
    </section>
  );
}
