"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Badge, Button, cn } from "@/components/ui";
import { dataHoraBR } from "@/lib/dominio";
import { codigoNcmDigitado } from "@/lib/ncm";
import { codigoCestDigitado, formatarCest, NOTA_FONTE_CEST, type ConsultaCestDto, type ItemCest } from "@/lib/cest";

export type OrigemCest = "manual" | "referencia_local";

/**
 * Etapa 2 — CEST como referência LOCAL por empresa (CEST ↔ NCM), com proveniência declarada.
 * A sugestão nunca é aplicada sozinha: só um clique explícito coloca o CEST no rascunho,
 * e nenhum outro campo (CST/CSOSN, alíquotas, perfil) é inferido. Não é validação oficial.
 */
export function ConsultaCest({ valor, ncm, aoMudar, podeGerenciar, disabled = false }: {
  valor: string;
  ncm: string;
  aoMudar: (cest: string, origem: OrigemCest) => void;
  podeGerenciar: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const buscaRef = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<ConsultaCestDto | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [gerenciar, setGerenciar] = useState(false);
  const [form, setForm] = useState({ cest: "", descricao: "", ncm: "", fonte: "", ato: "", vigencia: "" });
  const [salvandoRef, setSalvandoRef] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const controller = new AbortController();
    setBuscando(true); setErro("");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: consulta, pagina: String(pagina) });
        const resposta = await fetch(`/api/fiscal/cest?${params}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const json = await resposta.json();
        if (!resposta.ok || !json.ok || !json.dados) throw new Error(resposta.status === 401 ? "Sessão expirada. Entre novamente." : resposta.status === 403 ? "Seu perfil não permite esta consulta." : "Não foi possível consultar a referência local.");
        if (!controller.signal.aborted) { setDados(json.dados as ConsultaCestDto); setBuscando(false); }
      } catch (e) {
        if (!controller.signal.aborted) { setErro(e instanceof Error && e.message.startsWith("Sessão expirada") ? e.message : "Consulta indisponível. O CEST do formulário foi preservado; o preenchimento manual continua disponível."); setBuscando(false); }
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [aberto, consulta, pagina]);

  function sugerirPeloNcm() {
    const codigo = codigoNcmDigitado(ncm);
    if (!codigo) { setErro("Informe um NCM de 8 dígitos no campo acima para sugerir CEST relacionado."); return; }
    setConsulta(codigo); setPagina(1); setErro(""); setAberto(true);
  }

  function escolher(item: ItemCest) {
    if (disabled) return;
    aoMudar(item.cest, "referencia_local");
    setAviso(`CEST ${formatarCest(item.cest)} colocado no formulário a partir da referência local (${item.fonte}${item.ato ? ` · ${item.ato}` : ""}). Não é validação oficial. Revise e clique em Salvar produto; nada mais foi alterado.`);
  }

  async function salvarReferencia(operacao: "upsert" | "remover", cest?: string) {
    if (salvandoRef || disabled) return;
    setSalvandoRef(true); setAviso(""); setErro("");
    try {
      const corpo = operacao === "upsert"
        ? { operacao, registro: { cest: form.cest, descricao: form.descricao, ncm: form.ncm, fonte: form.fonte, ato: form.ato, vigencia: form.vigencia } }
        : { operacao, cest };
      const r = await fetch("/api/fiscal/cest", { method: "POST", headers: { "Content-Type": "application/json", "X-NKWAY-CEST": "referencia" }, cache: "no-store", body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.erro || "Não foi possível alterar a referência local.");
      setAviso(j.mensagem || "Referência local atualizada e auditada.");
      if (operacao === "upsert") setForm({ cest: "", descricao: "", ncm: "", fonte: "", ato: "", vigencia: "" });
      setDados(null); setPagina(1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar a referência local. Nada foi alterado.");
    } finally { setSalvandoRef(false); }
  }

  const cat = dados?.catalogo;
  return (
    <section className="rounded-xl border border-ink-200 bg-ink-50/40 p-3.5" aria-labelledby={`${id}-titulo`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 id={`${id}-titulo`} className="text-[13px] font-bold text-ink-800">CEST (substituição tributária)</h3><p className="mt-0.5 text-[11px] text-ink-500">Referência local por empresa; nunca aplicada automaticamente e sem certificação oficial.</p></div>
        <Badge tom="alerta">Referência local — não oficial</Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-44 flex-1">
          <label htmlFor={`${id}-valor`} className="mb-1 block text-[11.5px] font-semibold text-ink-600">CEST no formulário · 7 dígitos</label>
          <input id={`${id}-valor`} value={valor} onChange={(e) => { aoMudar(e.target.value, "manual"); setAviso("Preenchimento informado pelo usuário; o CEST não foi certificado pelo sistema."); }} disabled={disabled} inputMode="numeric" maxLength={12} placeholder="03.002.00 (opcional)" aria-describedby={`${id}-orientacao`} className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 font-mono text-xs text-ink-800 outline-none focus:border-way-500 focus:ring-2 focus:ring-way-100 disabled:opacity-60" />
        </div>
        <button type="button" disabled={disabled} onClick={sugerirPeloNcm} className="rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-way-600 disabled:opacity-60">
          Sugerir pelo NCM
        </button>
        <button type="button" disabled={disabled} aria-expanded={aberto} onClick={() => setAberto(!aberto)} className="rounded-md border border-ink-200 bg-white px-3 py-2 text-[12px] font-semibold text-ink-700 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-way-600 disabled:opacity-60">
          {aberto ? "Fechar consulta" : "Consultar referência local"}
        </button>
      </div>
      <p id={`${id}-orientacao`} className="mt-2 text-[11px] leading-relaxed text-ink-500">{NOTA_FONTE_CEST} O CEST complementa o NCM e não define CST/CSOSN ou alíquotas. Confirme o enquadramento com a contabilidade.</p>
      {valor !== "" && !codigoCestDigitado(valor) && <p className="mt-1 text-[11px] font-medium text-amber-800">CEST incompleto: use 7 dígitos (SS.III.DD). Códigos curtos nunca são completados automaticamente.</p>}
      {aviso && <p role="status" className="mt-2 rounded-lg bg-way-50 px-3 py-2 text-[11.5px] text-way-800">{aviso}</p>}
      {aberto && (
        <div className="mt-4 space-y-3 border-t border-ink-200 pt-3">
          <div>
            <label htmlFor={`${id}-busca`} className="mb-1 block text-[11.5px] font-semibold text-ink-700">Buscar por CEST, NCM ou descrição</label>
            <input ref={buscaRef} id={`${id}-busca`} type="search" value={consulta} onChange={(e) => { setConsulta(e.target.value); setPagina(1); }} maxLength={80} disabled={disabled} placeholder="Ex.: 03.002, 22030000, cerveja…" className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-xs text-ink-800 outline-none focus:border-way-500 focus:ring-2 focus:ring-way-100" />
          </div>
          <div role="status" aria-live="polite" className="text-[11.5px] text-ink-600">
            {buscando ? "Consultando a referência local…" : erro || (dados ? `${dados.total} referência(s) encontrada(s).` : "")}
          </div>
          {cat && (
            <div className="rounded-lg border border-ink-100 bg-white p-3 text-[11px] text-ink-600">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <Badge tom={cat.estado === "disponivel" ? "info" : "neutro"}>{cat.estado === "disponivel" ? "Referência local disponível" : "Sem referência cadastrada"}</Badge>
                {podeGerenciar && <Button tipo="button" tamanho="sm" variante="secundario" disabled={disabled || salvandoRef} onClick={() => setGerenciar(!gerenciar)}>{gerenciar ? "Fechar cadastro" : "Cadastrar/editar referência"}</Button>}
              </div>
              <p><b>Fonte declarada:</b> {cat.fonte} · <b>Registros:</b> {cat.totalRegistros} · <b>Atualizado em:</b> {cat.atualizadoEm ? dataHoraBR(cat.atualizadoEm) : "—"}</p>
            </div>
          )}
          {dados && dados.itens.length > 0 && (
            <ul className="max-h-64 space-y-2 overflow-auto pr-1" aria-label="Referências encontradas">
              {dados.itens.map((item) => (
                <li key={item.cest} className="rounded-lg border border-ink-100 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-[13px] font-bold text-ink-800">{formatarCest(item.cest)}</span>
                      <span className="ml-2 text-[10.5px] text-ink-400">segmento {item.segmento}</span>
                      <p className="mt-0.5 text-[12px] text-ink-700">{item.descricao}</p>
                      {item.ncm.length > 0 && <p className="mt-0.5 font-mono text-[10.5px] text-ink-500">NCM: {item.ncm.join(" · ")}</p>}
                      <p className="mt-0.5 text-[10.5px] text-ink-400">Fonte: {item.fonte}{item.ato ? ` · ${item.ato}` : ""}{item.vigencia ? ` · ${item.vigencia}` : ""}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button tipo="button" tamanho="sm" disabled={disabled} onClick={() => escolher(item)}>Usar este CEST</Button>
                      {dados.podeGerenciar && <Button tipo="button" tamanho="sm" variante="perigo" disabled={disabled || salvandoRef} onClick={() => void salvarReferencia("remover", item.cest)}>Remover</Button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dados && dados.total > dados.porPagina && (
            <div className="flex items-center gap-2 text-[11.5px]">
              <Button tipo="button" tamanho="sm" variante="secundario" disabled={pagina <= 1 || buscando} onClick={() => setPagina(pagina - 1)}>← Anterior</Button>
              <span className="text-ink-500">página {dados.pagina} de {Math.max(1, Math.ceil(dados.total / dados.porPagina))}</span>
              <Button tipo="button" tamanho="sm" variante="secundario" disabled={pagina >= Math.ceil(dados.total / dados.porPagina) || buscando} onClick={() => setPagina(pagina + 1)}>Próxima →</Button>
            </div>
          )}
          {gerenciar && dados?.podeGerenciar && (
            <div className="space-y-2 rounded-lg border border-dashed border-ink-200 bg-white p-3">
              <p className="text-[11.5px] font-semibold text-ink-700">Nova/atualização de referência local (auditada; nunca aplicada automaticamente)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input value={form.cest} onChange={(e) => setForm({ ...form, cest: e.target.value })} placeholder="CEST 7 dígitos" maxLength={12} inputMode="numeric" className="rounded-md border border-ink-200 px-3 py-2 font-mono text-xs" />
                <input value={form.ncm} onChange={(e) => setForm({ ...form, ncm: e.target.value })} placeholder="NCMs relacionados (espaço)" maxLength={200} className="rounded-md border border-ink-200 px-3 py-2 font-mono text-xs" />
                <input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Descrição do item" maxLength={300} className="rounded-md border border-ink-200 px-3 py-2 text-xs sm:col-span-2" />
                <input value={form.fonte} onChange={(e) => setForm({ ...form, fonte: e.target.value })} placeholder="Fonte declarada (ex.: CONFAZ Conv. 142/2018)" maxLength={120} className="rounded-md border border-ink-200 px-3 py-2 text-xs" />
                <input value={form.ato} onChange={(e) => setForm({ ...form, ato: e.target.value })} placeholder="Ato (ex.: Convênio ICMS 142/2018)" maxLength={120} className="rounded-md border border-ink-200 px-3 py-2 text-xs" />
                <input value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} placeholder="Vigência declarada" maxLength={40} className="rounded-md border border-ink-200 px-3 py-2 text-xs" />
              </div>
              <Button tipo="button" tamanho="sm" disabled={disabled || salvandoRef} onClick={() => void salvarReferencia("upsert")}>{salvandoRef ? "Salvando…" : "Salvar referência local"}</Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
