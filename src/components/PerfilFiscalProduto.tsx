"use client";

import { useState } from "react";
import { Badge, Button, Campo, Select } from "@/components/ui";
import { aplicarPerfilTributarioPreservando, diffPerfilTributario, PARAMETROS_TRIBUTARIOS_VAZIOS, type ParametrosTributarios } from "@/lib/tributacao";
import { preverPerfilProduto } from "@/server/acoes/tributacao";
import type { PerfilFiscalResumoDto } from "@/server/dados";

/**
 * Etapa 3 — perfil fiscal no próprio cadastro de produtos.
 * Seleção ≠ aplicação: nada muda até "Aplicar no rascunho" + salvar. A prévia é recalculada no servidor
 * para produto existente; NCM/CEST são preservados por padrão, com sobrescrita explícita opcional.
 */
export function PerfilFiscalProduto({
  produtoId, perfilIdVinculado, perfis, perfilSelecionado, aoSelecionarPerfil,
  sobrescreverNcmCest, aoMudarSobrescrever, aoAplicarRascunho, aoDesvincularRascunho,
  dadosBase, regime, disabled = false,
}: {
  produtoId: string | null;
  perfilIdVinculado: string | null;
  perfis: PerfilFiscalResumoDto[];
  perfilSelecionado: string;
  aoSelecionarPerfil: (id: string) => void;
  sobrescreverNcmCest: boolean;
  aoMudarSobrescrever: (v: boolean) => void;
  aoAplicarRascunho: (perfilHash: string) => void;
  aoDesvincularRascunho: () => void;
  dadosBase: ParametrosTributarios;
  regime: string;
  disabled?: boolean;
}) {
  const [previa, setPrevia] = useState<null | { campos: { campo: string; de: string; para: string }[]; avisos: string[]; hash: string; compativel: boolean; motivo?: string; perfilNome: string }>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const vinculado = perfis.find((p) => p.id === perfilIdVinculado) ?? null;
  const selecionado = perfis.find((p) => p.id === perfilSelecionado) ?? null;
  const opcoes = [
    { valor: "", rotulo: "Nenhum perfil (desvincular ao salvar)" },
    ...perfis
      .filter((p) => p.ativo || p.id === perfilIdVinculado)
      .map((p) => ({
        valor: p.id,
        rotulo: `${p.nome} · ${p.regime === "todos" ? "todos os regimes" : p.regime}${p.ativo ? "" : " · INATIVO (vínculo histórico)"}${p.regime !== "todos" && p.regime !== regime ? " · regime diferente da empresa" : ""}`,
      })),
  ];
  const perfilTemClassificacao = Boolean(selecionado && (selecionado.dados.ncm || selecionado.dados.cest));
  const classificacaoDifere = Boolean(selecionado && ((selecionado.dados.ncm && selecionado.dados.ncm !== dadosBase.ncm) || (selecionado.dados.cest && selecionado.dados.cest !== (dadosBase.cest ?? ""))));

  async function verPrevia() {
    if (!perfilSelecionado || carregando || disabled) return;
    setCarregando(true); setErro(""); setPrevia(null);
    try {
      if (produtoId) {
        const r = await preverPerfilProduto({ produtoId, perfilId: perfilSelecionado, sobrescreverNcmCest });
        if (!r.ok) { setErro(r.erro); return; }
        setPrevia({ campos: r.camposAfetados, avisos: r.avisos, hash: r.perfil.hash, compativel: r.compativel, ...(r.motivo ? { motivo: r.motivo } : {}), perfilNome: r.perfil.nome });
      } else {
        const perfil = perfis.find((p) => p.id === perfilSelecionado);
        if (!perfil) return;
        const depois = aplicarPerfilTributarioPreservando(dadosBase, perfil.dados, sobrescreverNcmCest);
        setPrevia({ campos: diffPerfilTributario(dadosBase, depois), avisos: [], hash: "", compativel: true, perfilNome: perfil.nome });
      }
    } catch {
      setErro("Não foi possível montar a prévia. Nada foi aplicado; revise e tente novamente.");
    } finally { setCarregando(false); }
  }

  return (
    <section className="rounded-xl border border-ink-200 bg-ink-50/40 p-3.5" aria-label="Perfil fiscal do produto">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-bold text-ink-800">Perfil fiscal (modelo da empresa)</h3>
          <p className="mt-0.5 text-[11px] text-ink-500">Selecionar não aplica nada. A aplicação é explícita, com prévia, e preserva NCM/CEST por padrão.</p>
        </div>
        {vinculado
          ? <Badge tom={vinculado.ativo ? "info" : "alerta"}>{vinculado.ativo ? "Vinculado" : "Vínculo histórico inativo"}: {vinculado.nome}</Badge>
          : <Badge tom="neutro">Sem perfil vinculado</Badge>}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Campo rotulo="Perfil para aplicar (rascunho)">
          <Select valor={perfilSelecionado} aoMudar={(v) => { aoSelecionarPerfil(v); setPrevia(null); setErro(""); }} opcoes={opcoes} disabled={disabled} />
        </Campo>
        <Button tipo="button" tamanho="sm" variante="secundario" disabled={!perfilSelecionado || carregando || disabled} onClick={() => void verPrevia()}>
          {carregando ? "Montando prévia…" : "Ver prévia antes/depois"}
        </Button>
        <Button tipo="button" tamanho="sm" disabled={!perfilSelecionado || !previa?.compativel || carregando || disabled} onClick={() => { aoAplicarRascunho(previa?.hash ?? ""); }}>
          Aplicar no rascunho
        </Button>
      </div>
      {perfilIdVinculado && perfilSelecionado === "" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-[11px] text-ink-500">Salvar com “Nenhum perfil” desvincula sem apagar os valores já copiados.</p>
          <Button tipo="button" tamanho="sm" variante="perigo" disabled={disabled} onClick={aoDesvincularRascunho}>Desvincular no rascunho</Button>
        </div>
      )}
      {perfilTemClassificacao && classificacaoDifere && (
        <label className="mt-2 flex items-start gap-2 text-[11.5px] text-amber-800">
          <input type="checkbox" checked={sobrescreverNcmCest} onChange={(e) => { aoMudarSobrescrever(e.target.checked); setPrevia(null); }} disabled={disabled} className="mt-0.5" />
          <span>O perfil contém NCM/CEST diferentes. Marcar aplica esses códigos ao produto (sobrescrita explícita e auditada). Sem marcar, a classificação atual é preservada.</span>
        </label>
      )}
      {erro && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] text-rose-700">{erro}</p>}
      {previa && (
        <div className="mt-3 rounded-lg border border-ink-100 bg-white p-3 text-[11.5px]">
          <p className="font-semibold text-ink-700">Prévia do perfil “{previa.perfilNome}”{previa.compativel ? "" : " — não aplicável"}</p>
          {previa.motivo && <p className="mt-1 text-rose-700">{previa.motivo}</p>}
          {previa.campos.length === 0
            ? <p className="mt-1 text-ink-500">Nenhum campo seria alterado (campos vazios do perfil nunca apagam dados).</p>
            : <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {previa.campos.map((c) => <li key={c.campo} className="font-mono text-[11px] text-ink-600">{c.campo}: “{c.de || "—"}” → “{c.para || "—"}”</li>)}
              </ul>}
          {previa.avisos.map((a) => <p key={a} className="mt-1 text-amber-700">{a}</p>)}
          <p className="mt-1 text-ink-400">A aplicação só ocorre ao clicar em “Aplicar no rascunho” e depois “Salvar produto”, em uma única transação com auditoria.</p>
        </div>
      )}
    </section>
  );
}
