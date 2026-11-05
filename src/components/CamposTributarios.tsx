"use client";

import { Campo, Input, Select } from "@/components/ui";
import { CSOSN_FISCAIS, CST_ICMS_FISCAIS, ORIGENS_MERCADORIA, type CampoTributario, type ParametrosTributarios, type TipoCodigoFiscal } from "@/lib/tributacao";
import type { CodigoFiscalDto } from "@/server/tributacaoCore";

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

export function CamposTributarios({ dados, aoMudar, codigos, prefixo, crt }: { dados: ParametrosTributarios; aoMudar: (d: ParametrosTributarios) => void; codigos: CodigoFiscalDto[]; prefixo: string; crt: number }) {
  const campo = (item: CampoFiscal) => {
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
        if (tipo === "csosn") CSOSN_FISCAIS.forEach((c) => sugestoes.set(c, `CSOSN ${c}`));
        if (tipo === "cst_icms") CST_ICMS_FISCAIS.forEach((c) => sugestoes.set(c, `CST ICMS ${c}`));
        codigos.filter((c) => c.ativo && c.tipo === tipo).forEach((c) => sugestoes.set(c.codigo, c.nome));
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
