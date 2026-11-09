"use client";

import { useMemo, useState } from "react";
import { Campo, Input, Select } from "@/components/ui";
import { CSOSN_FISCAIS, CST_ICMS_FISCAIS, ORIGENS_MERCADORIA, type CampoTributario, type ParametrosTributarios, type TipoCodigoFiscal } from "@/lib/tributacao";
import type { CodigoFiscalDto } from "@/server/tributacaoCore";
import { descricaoFiscal, opcoesTabelaFiscal, tabelaFiscal, type IdTabelaFiscal } from "@/lib/tabelasFiscais";
import { CLASS_TRIB_VERSAO, classTribPorCodigo, listarClassTrib } from "@/lib/tabelaClassTrib";

type LinhaTabela = { codigo: string; descricao: string };
type TabelasDominio = Record<string, LinhaTabela[]> | undefined;
const OUTRO = "__outro__";
/** Campos que viram lista "código — descrição". Fonte em cascata: tabela do banco (`nk_tabela_dominio`) → instantâneo oficial embutido. */
const TABELA_DO_CAMPO: Partial<Record<CampoTributario, IdTabelaFiscal>> = { cstPis: "cst_pis", cstCofins: "cst_cofins", cstIpi: "cst_ipi", cstIbsCbs: "cst_ibs_cbs", cstIcms: "cst_icms", csosn: "csosn" };
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function opcoesDoCampo(id: IdTabelaFiscal, tabelas: TabelasDominio): { opcoes: { valor: string; rotulo: string }[]; origem: string } {
  const doBanco = tabelas?.[id];
  if (doBanco && doBanco.length) return { opcoes: doBanco.map((l) => ({ valor: l.codigo, rotulo: `${l.codigo} — ${l.descricao}` })), origem: "tabela oficial carregada" };
  const t = tabelaFiscal(id);
  return { opcoes: opcoesTabelaFiscal(id, "saida").map((o) => ({ valor: o.valor, rotulo: o.rotulo })), origem: `${t.fonte} · ${t.ato}` };
}

function SeletorTabela({ id, valor, aoMudar, rotulo, dica, codigosEmpresa, tabelas }: { id: IdTabelaFiscal; valor: string; aoMudar: (v: string) => void; rotulo: string; dica?: string; codigosEmpresa: CodigoFiscalDto[]; tabelas: TabelasDominio }) {
  const { opcoes, origem } = useMemo(() => opcoesDoCampo(id, tabelas), [id, tabelas]);
  const locais = codigosEmpresa.filter((c) => c.ativo && c.tipo === id && !opcoes.some((o) => o.valor === c.codigo));
  const conhecido = valor === "" || opcoes.some((o) => o.valor === valor) || locais.some((c) => c.codigo === valor);
  const [manual, setManual] = useState(!conhecido);
  const descricao = valor ? (opcoes.find((o) => o.valor === valor)?.rotulo ?? descricaoFiscal(id, valor) ?? locais.find((c) => c.codigo === valor)?.nome ?? null) : null;
  return <Campo rotulo={rotulo} dica={dica ?? origem}>
    {manual || !conhecido ? (
      <div className="flex gap-1.5">
        <Input valor={valor} aoMudar={aoMudar} inputMode="numeric" className="font-mono" maxLength={6} placeholder="código" />
        <button type="button" className="shrink-0 rounded-lg px-2 text-[11px] font-semibold text-way-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50" onClick={() => { setManual(false); if (!opcoes.some((o) => o.valor === valor) && !locais.some((c) => c.codigo === valor)) aoMudar(""); }}>lista</button>
      </div>
    ) : (
      <Select valor={valor} aoMudar={(v) => { if (v === OUTRO) { setManual(true); return; } aoMudar(v); }} className="font-mono text-[12px]" data-testid={`seletor-${id}`}
        opcoes={[{ valor: "", rotulo: "Não informado" }, ...opcoes, ...locais.map((c) => ({ valor: c.codigo, rotulo: `${c.codigo} — ${c.nome} (código da empresa)` })), { valor: OUTRO, rotulo: "Outro código…" }]} />
    )}
    {valor && !descricao && <p className="mt-1 text-[10.5px] text-amber-700">Código fora da tabela de referência; confirme com a contabilidade.</p>}
  </Campo>;
}

/** cClassTrib: lista filtrada pelo CST IBS/CBS escolhido, com busca; aceita digitar código fora do instantâneo (com aviso). */
function SeletorClassTrib({ valor, cst, aoMudar, tabelas }: { valor: string; cst: string; aoMudar: (v: string) => void; tabelas: TabelasDominio }) {
  const [busca, setBusca] = useState("");
  const base = useMemo<{ codigo: string; cst: string; nome: string }[]>(() => {
    const doBanco = tabelas?.cclass_trib;
    if (doBanco && doBanco.length) return doBanco.map((l) => ({ codigo: l.codigo, cst: l.codigo.slice(0, 3), nome: l.descricao }));
    return [...listarClassTrib()];
  }, [tabelas]);
  const origem = tabelas?.cclass_trib?.length ? "tabela oficial carregada" : `IT 2025.002 v${CLASS_TRIB_VERSAO.versao}`;
  const doCst = useMemo(() => (cst ? base.filter((i) => i.cst === cst) : base), [base, cst]);
  const q = norm(busca.trim()); const digitos = q.replace(/\D/g, "");
  const lista = useMemo(() => (q ? doCst.filter((i) => (digitos && i.codigo.startsWith(digitos)) || norm(i.nome).includes(q)) : doCst).slice(0, 80), [doCst, q, digitos]);
  const atual = base.find((i) => i.codigo === valor) ?? (classTribPorCodigo(valor) ?? null);
  const [manual, setManual] = useState(() => Boolean(valor) && !atual);
  const dica = cst ? (doCst.length ? `${doCst.length} código(s) para o CST ${cst} · ${origem}` : `CST ${cst} sem cClassTrib em ${origem}; informe manualmente se a tabela vigente previr`) : `Escolha o CST IBS/CBS para filtrar · ${origem}`;
  return <Campo rotulo="cClassTrib" dica={dica}>
    {manual ? (
      <div className="flex gap-1.5">
        <Input valor={valor} aoMudar={aoMudar} inputMode="numeric" className="font-mono" maxLength={6} placeholder="6 dígitos" />
        <button type="button" className="shrink-0 rounded-lg px-2 text-[11px] font-semibold text-way-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50" onClick={() => { setManual(false); if (!base.some((i) => i.codigo === valor)) aoMudar(""); }}>lista</button>
      </div>
    ) : (
      <div className="space-y-1">
        {doCst.length > 12 && <Input valor={busca} aoMudar={setBusca} placeholder="filtrar por código ou palavra" className="text-[12px]" />}
        <Select valor={valor} aoMudar={(v) => { if (v === OUTRO) { setManual(true); return; } aoMudar(v); }} className="font-mono text-[12px]" data-testid="seletor-cclass_trib"
          opcoes={[{ valor: "", rotulo: "Não informado" }, ...(valor && atual && !lista.some((i) => i.codigo === valor) ? [{ valor, rotulo: `${valor} — ${atual.nome}` }] : []), ...lista.map((i) => ({ valor: i.codigo, rotulo: `${i.codigo} — ${i.nome}` })), { valor: OUTRO, rotulo: "Outro código…" }]} />
      </div>
    )}
    {valor && !atual && <p className="mt-1 text-[10.5px] text-amber-700">Código fora da tabela embutida ({origem}); confirme na planilha oficial vigente.</p>}
    {valor && atual && cst && atual.cst !== cst && <p className="mt-1 text-[10.5px] text-rose-700">Os 3 primeiros dígitos não coincidem com o CST {cst}.</p>}
  </Campo>;
}

type CampoFiscal = { campo: CampoTributario; rotulo: string; dica?: string; tipo?: TipoCodigoFiscal; placeholder?: string; aliquota?: boolean };
const IDENTIFICACAO: CampoFiscal[] = [
  { campo: "ncm", rotulo: "NCM", tipo: "ncm", dica: "8 dígitos; confirme na tabela vigente.", placeholder: "00000000" },
  { campo: "cest", rotulo: "CEST", tipo: "cest", dica: "7 dígitos quando aplicável.", placeholder: "Opcional" },
  { campo: "cfop", rotulo: "CFOP de saída padrão", tipo: "cfop", dica: "Não determina a operação automaticamente.", placeholder: "5.102" },
  { campo: "cfopInterestadual", rotulo: "CFOP interestadual", tipo: "cfop", dica: "Opcional; saída iniciada em 6.", placeholder: "6.102" },
  { campo: "beneficioFiscal", rotulo: "Código de benefício fiscal", dica: "Informe somente quando orientado pela contabilidade.", placeholder: "Opcional" },
];
const PIS_COFINS: CampoFiscal[] = [
  { campo: "cstPis", rotulo: "CST PIS", tipo: "cst_pis", placeholder: "2 dígitos" },
  { campo: "pisAliq", rotulo: "PIS (%)", aliquota: true, placeholder: "Não informado" },
  { campo: "cstCofins", rotulo: "CST COFINS", tipo: "cst_cofins", placeholder: "2 dígitos" },
  { campo: "cofinsAliq", rotulo: "COFINS (%)", aliquota: true, placeholder: "Não informado" },
  { campo: "cstIpi", rotulo: "CST IPI", tipo: "cst_ipi", placeholder: "2 dígitos" },
  { campo: "ipiAliq", rotulo: "IPI (%)", aliquota: true, placeholder: "Não informado" },
];
const REFORMA: CampoFiscal[] = [
  { campo: "cstIbsCbs", rotulo: "CST IBS/CBS", tipo: "cst_ibs_cbs", placeholder: "3 dígitos" },
  { campo: "classTrib", rotulo: "cClassTrib", tipo: "class_trib", dica: "Os 3 primeiros dígitos devem coincidir com o CST IBS/CBS.", placeholder: "6 dígitos" },
  { campo: "ibsAliq", rotulo: "IBS (%)", aliquota: true, placeholder: "Não informado" },
  { campo: "cbsAliq", rotulo: "CBS (%)", aliquota: true, placeholder: "Não informado" },
];

export function CamposTributarios({ dados, aoMudar, codigos, prefixo, crt, tabelas }: { dados: ParametrosTributarios; aoMudar: (d: ParametrosTributarios) => void; codigos: CodigoFiscalDto[]; prefixo: string; crt: number; tabelas?: Record<string, { codigo: string; descricao: string }[]> }) {
  const campo = (item: CampoFiscal) => {
    if (item.campo === "classTrib") return <SeletorClassTrib key="classTrib" valor={dados.classTrib} cst={dados.cstIbsCbs} aoMudar={(v) => aoMudar({ ...dados, classTrib: v })} tabelas={tabelas} />;
    const idTabela = TABELA_DO_CAMPO[item.campo];
    if (idTabela) return <SeletorTabela key={item.campo} id={idTabela} valor={dados[item.campo]} aoMudar={(v) => aoMudar({ ...dados, [item.campo]: v })} rotulo={item.rotulo} dica={item.dica} codigosEmpresa={codigos} tabelas={tabelas} />;
    const idLista = item.tipo ? `${prefixo}-${item.tipo}` : undefined;
    return <Campo key={item.campo} rotulo={item.rotulo} dica={item.dica}>
      <Input valor={dados[item.campo]} aoMudar={(v) => aoMudar({ ...dados, [item.campo]: v })} list={idLista} inputMode={item.aliquota ? "decimal" : item.campo === "beneficioFiscal" ? "text" : "numeric"} placeholder={item.placeholder} className="font-mono" maxLength={item.aliquota ? 6 : 20} />
    </Campo>;
  };
  const tiposListas = Array.from(new Set<TipoCodigoFiscal>(["csosn", "cst_icms", ...codigos.filter((c) => c.ativo).map((c) => c.tipo)]));
  return (
    <div className="space-y-4">
      {tiposListas.map((tipo) => {
        const sugestoes = new Map<string, string>();
        // Primeiro as opções da tabela oficial de domínio (fonte registrada em nk_tabela_dominio_meta)...
        (tabelas?.[tipo] ?? []).forEach((l) => sugestoes.set(l.codigo, `${l.codigo} — ${l.descricao}`));
        // ...depois os códigos locais ativos da empresa (complemento, nunca substituem a oficial).
        codigos.filter((c) => c.ativo && c.tipo === tipo).forEach((c) => { if (!sugestoes.has(c.codigo)) sugestoes.set(c.codigo, `${c.codigo} — ${c.nome} (local)`); });
        if (tipo === "csosn" && !tabelas?.csosn?.length) CSOSN_FISCAIS.forEach((c) => sugestoes.set(c, `CSOSN ${c}`));
        if (tipo === "cst_icms" && !tabelas?.cst_icms?.length) CST_ICMS_FISCAIS.forEach((c) => sugestoes.set(c, `CST ICMS ${c}`));
        return <datalist key={tipo} id={`${prefixo}-${tipo}`}>{[...sugestoes].map(([codigo, nome]) => <option key={codigo} value={codigo}>{nome}</option>)}</datalist>;
      })}
      <section className="rounded-xl border border-ink-100 bg-ink-50/35 p-3.5">
        <h3 className="text-[13px] font-bold text-ink-800">Classificação e operação</h3><p className="mt-0.5 text-[11px] text-ink-400">Códigos cadastrais e CFOPs usados como referência para a saída.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{IDENTIFICACAO.map(campo)}<Campo rotulo="Origem da mercadoria"><Select valor={dados.origem} aoMudar={(v) => aoMudar({ ...dados, origem: v })} opcoes={[{ valor: "", rotulo: "Não informado" }, ...ORIGENS_MERCADORIA.map((o) => ({ valor: o.id, rotulo: o.rotulo }))]} /></Campo></div>
      </section>
      <section className="rounded-xl border border-ink-100 bg-ink-50/35 p-3.5">
        <h3 className="text-[13px] font-bold text-ink-800">ICMS e substituição tributária</h3><p className="mt-0.5 text-[11px] text-ink-400">CRT {crt}: escolha a classificação orientada pelo contador. Simples/MEI podem usar CST monofásico quando aplicável.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Classificação de ICMS"><Select valor={dados.tipoIcms} aoMudar={(v) => aoMudar({ ...dados, tipoIcms: v })} opcoes={[{ valor: "", rotulo: "Não revisado" }, { valor: "csosn", rotulo: "CSOSN (Simples/MEI)" }, { valor: "cst", rotulo: "CST ICMS" }]} /></Campo>
          {dados.tipoIcms === "csosn" && campo({ campo: "csosn", rotulo: "CSOSN", tipo: "csosn", placeholder: "3 dígitos" })}
          {dados.tipoIcms === "cst" && campo({ campo: "cstIcms", rotulo: "CST ICMS", tipo: "cst_icms", dica: "Dois dígitos; origem é informada separadamente.", placeholder: "2 dígitos" })}
          {campo({ campo: "icmsAliq", rotulo: "ICMS (%)", aliquota: true, placeholder: "Não informado" })}
          {campo({ campo: "icmsStAliq", rotulo: "ICMS-ST (%)", aliquota: true, dica: "Parâmetro informado; cálculo depende do emissor.", placeholder: "Opcional" })}
          {campo({ campo: "fcpAliq", rotulo: "FCP (%)", aliquota: true, placeholder: "Opcional" })}
        </div>
      </section>
      <section className="rounded-xl border border-ink-100 bg-ink-50/35 p-3.5"><h3 className="text-[13px] font-bold text-ink-800">PIS, COFINS e IPI</h3><p className="mt-0.5 text-[11px] text-ink-400">CSTs e alíquotas informados para cada tributo.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{PIS_COFINS.map(campo)}</div></section>
      <section className="rounded-xl border border-ink-100 bg-ink-50/35 p-3.5"><h3 className="text-[13px] font-bold text-ink-800">IBS / CBS · reforma tributária</h3><p className="mt-0.5 text-[11px] text-ink-400">CST e cClassTrib devem ser confirmados nas tabelas oficiais vigentes.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{REFORMA.map(campo)}</div></section>
    </div>
  );
}
