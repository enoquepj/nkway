"use client";

import { useMemo, useRef, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltrosSalvos,
  FiltroTexto,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  Vazio,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { dataBR, formatChave, moeda, round2, hojeISO } from "@/lib/dominio";
import type { EntradaItem } from "@/db/schema";
import {
  excluirEntrada,
  importarPorChave,
  importarXml,
  lancarEntrada,
  preVisualizarXml,
  registrarEntradaManual,
  salvarTratamento,
  simularChave,
  type Resultado,
} from "@/server/acoes/entradas";
import type { listarEntradas } from "@/server/dados";

type Entrada = Awaited<ReturnType<typeof listarEntradas>>[number];
type ProdutoOpcao = { id: string; nome: string; sku: string; gtin: string; estoque: number; custo: number; preco: number; unidade: string };
type FornecedorOpcao = { id: string; nome: string; cnpj: string; prazoPagDias: number };

const ORIGEM: Record<string, { rotulo: string; tom: "ok" | "info" | "neutro" | "roxo" }> = {
  xml: { rotulo: "XML", tom: "roxo" },
  sefaz: { rotulo: "Chave SEFAZ", tom: "info" },
  manual: { rotulo: "Manual", tom: "neutro" },
};

export function EntradasView({
  entradas,
  produtos,
  fornecedores,
}: {
  entradas: Entrada[];
  produtos: ProdutoOpcao[];
  fornecedores: FornecedorOpcao[];
}) {
  const toast = useToast();
  const [aba, setAba] = useState("lista");

  /* ------------------------------------------------------------ filtros */
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [status, setStatus] = useState<string[]>([]);
  const [origens, setOrigens] = useState<string[]>([]);
  const [fornecedoresSel, setFornecedoresSel] = useState<string[]>([]);
  const [minimo, setMinimo] = useState("");
  const [maximo, setMaximo] = useState("");
  const [soDivergencia, setSoDivergencia] = useState(false);
  const [soSemVinculo, setSoSemVinculo] = useState(false);

  const filtroAtual = {
    busca,
    inicio: periodo.inicio,
    fim: periodo.fim,
    status,
    origens,
    fornecedoresSel,
    minimo,
    maximo,
    soDivergencia,
    soSemVinculo,
  };
  type FiltroCfg = typeof filtroAtual;
  const aplicar = (f: FiltroCfg) => {
    setBusca(f.busca);
    setPeriodo({ inicio: f.inicio, fim: f.fim });
    setStatus(f.status);
    setOrigens(f.origens);
    setFornecedoresSel(f.fornecedoresSel);
    setMinimo(f.minimo);
    setMaximo(f.maximo);
    setSoDivergencia(f.soDivergencia);
    setSoSemVinculo(f.soSemVinculo);
  };
  const limpar = () =>
    aplicar({
      busca: "",
      inicio: "",
      fim: "",
      status: [],
      origens: [],
      fornecedoresSel: [],
      minimo: "",
      maximo: "",
      soDivergencia: false,
      soSemVinculo: false,
    });

  const comDivergencia = (e: Entrada) => e.itens.some((i) => i.qtd !== i.qtdNota);
  const comSemVinculo = (e: Entrada) => e.itens.some((i) => !i.produtoId);

  const linhas = useMemo(
    () =>
      entradas.filter((e) => {
        if (!casaTexto(`${e.fornecedor} ${e.numeroNota} ${e.chave} ${e.observacao} ${e.itens.map((i) => i.nome).join(" ")}`, busca)) return false;
        if (status.length && !status.includes(e.status)) return false;
        if (origens.length && !origens.includes(e.origem)) return false;
        if (fornecedoresSel.length && !fornecedoresSel.includes(e.fornecedor)) return false;
        if ((periodo.inicio || periodo.fim) && !emPeriodo(e.emissao, periodo)) return false;
        const v = Number(minimo.replace(",", ".")) || 0;
        const vMax = Number(maximo.replace(",", ".")) || 0;
        if (minimo && e.total < v) return false;
        if (maximo && e.total > vMax) return false;
        if (soDivergencia && !comDivergencia(e)) return false;
        if (soSemVinculo && !comSemVinculo(e)) return false;
        return true;
      }),
    [entradas, busca, status, origens, fornecedoresSel, periodo, minimo, maximo, soDivergencia, soSemVinculo],
  );

  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...(periodo.inicio || periodo.fim
      ? [{ r: `emissão ${periodo.inicio ? dataBR(periodo.inicio) : "…"} → ${periodo.fim ? dataBR(periodo.fim) : "…"}`, limpar: () => setPeriodo({ inicio: "", fim: "" }) }]
      : []),
    ...status.map((s) => ({ r: `status: ${s}`, limpar: () => setStatus(status.filter((x) => x !== s)) })),
    ...origens.map((o) => ({ r: `origem: ${ORIGEM[o]?.rotulo ?? o}`, limpar: () => setOrigens(origens.filter((x) => x !== o)) })),
    ...fornecedoresSel.map((f) => ({ r: `fornecedor: ${f.split(" ").slice(0, 2).join(" ")}`, limpar: () => setFornecedoresSel(fornecedoresSel.filter((x) => x !== f)) })),
    ...(minimo ? [{ r: `total ≥ ${minimo}`, limpar: () => setMinimo("") }] : []),
    ...(maximo ? [{ r: `total ≤ ${maximo}`, limpar: () => setMaximo("") }] : []),
    ...(soDivergencia ? [{ r: "só com divergência de qtd", limpar: () => setSoDivergencia(false) }] : []),
    ...(soSemVinculo ? [{ r: "só com item sem vínculo", limpar: () => setSoSemVinculo(false) }] : []),
  ];

  const valorFiltrado = round2(linhas.reduce((s, e) => s + e.total, 0));
  const pendentes = entradas.filter((e) => e.status === "pendente").length;
  const aguardandoLancamento = entradas.filter((e) => e.status === "conferida").length;

  /* -------------------------------------------------------- tratamento */
  const [tratando, setTratando] = useState<Entrada | null>(null);
  const [itens, setItens] = useState<EntradaItem[]>([]);
  const [obs, setObs] = useState("");
  const [gerarFin, setGerarFin] = useState(true);
  const [markup, setMarkup] = useState("40");
  const [ocupado, setOcupado] = useState(false);

  function abrirTratamento(e: Entrada) {
    setTratando(e);
    setItens(e.itens.map((i) => ({ ...i })));
    setObs(e.observacao ?? "");
    setGerarFin(e.gerarFinanceiro);
  }

  async function salvar(sauLancar: boolean) {
    if (!tratando) return;
    setOcupado(true);
    const r: Resultado = await salvarTratamento({ entradaId: tratando.id, itens, gerarFinanceiro: gerarFin, observacao: obs });
    let r2: Resultado | null = null;
    if (r.ok && sauLancar) r2 = await lancarEntrada(tratando.id);
    setOcupado(false);
    if (!r.ok) return toast(r.erro, "erro");
    if (r2) {
      if (!r2.ok) return toast(r2.erro, "erro");
      toast(r2.aviso ?? "Entrada lançada no estoque com custo médio.");
    } else toast("Tratamento salvo.");
    setTratando(null);
  }

  /* --------------------------------------------------------- importadores */
  const [xml, setXml] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof preVisualizarXml>> | null>(null);
  const [chave, setChave] = useState("");
  const [previewChave, setPreviewChave] = useState<Awaited<ReturnType<typeof simularChave>> | null>(null);
  const [fornecedorSel, setFornecedorSel] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    const texto = await f.text();
    setXml(texto);
    const r = await preVisualizarXml(texto);
    if (!r.ok) return toast(r.erro, "erro");
    setPreview(r);
    toast(`XML lido: ${r.nota.itens.length} item(ns) · NF ${r.nota.numero}`);
  }

  const [manual, setManual] = useState({
    fornecedor: "",
    cnpj: "",
    numeroNota: "",
    serie: "1",
    emissao: hojeISO(),
    frete: "",
    obs: "",
  });
  const [manualItens, setManualItens] = useState([
    { produtoId: "", nome: "", qtd: "1", custo: "", preco: "", unidade: "UN", sku: "", ncm: "" },
  ]);

  const colunas: Coluna<Entrada>[] = [
    {
      id: "nota",
      rotulo: "Nota / emissão",
      valor: (e) => Number(e.numeroNota) || 0,
      render: (e) => (
        <div>
          <p className="tabular text-[12.5px] font-bold text-ink-900">
            NF-e {e.numeroNota} <span className="font-normal text-ink-400">série {e.serie}</span>
          </p>
          <p className="text-[10.5px] text-ink-400">
            {dataBR(e.emissao)} · {ORIGEM[e.origem]?.rotulo ?? e.origem}
          </p>
        </div>
      ),
    },
    {
      id: "fornecedor",
      rotulo: "Fornecedor",
      valor: (e) => e.fornecedor,
      render: (e) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium text-ink-800">{e.fornecedor}</p>
          <p className="truncate font-mono text-[10px] text-ink-400">{e.chave ? formatChave(e.chave).slice(0, 24) + "…" : "sem chave"}</p>
        </div>
      ),
    },
    { id: "origem", rotulo: "Origem", alinhar: "centro", valor: (e) => e.origem, render: (e) => <Badge tom={ORIGEM[e.origem]?.tom ?? "neutro"}>{ORIGEM[e.origem]?.rotulo ?? e.origem}</Badge> },
    {
      id: "itens",
      rotulo: "Itens",
      alinhar: "centro",
      valor: (e) => e.itens.length,
      render: (e) => {
        const semV = e.itens.filter((i) => !i.produtoId).length;
        const div = e.itens.filter((i) => i.qtd !== i.qtdNota).length;
        return (
          <div className="leading-tight">
            <p className="tabular text-[12px] font-semibold text-ink-700">{e.itens.length}</p>
            {(semV > 0 || div > 0) && (
              <p className="text-[10px] font-semibold text-amber-600">
                {semV > 0 && `${semV} s/ vínculo`} {div > 0 && `${div} diverg.`}
              </p>
            )}
          </div>
        );
      },
    },
    { id: "produtos", rotulo: "Mercadoria", alinhar: "direita", valor: (e) => e.valorProdutos, render: (e) => <span className="tabular text-[12px] text-ink-600">{moeda(e.valorProdutos)}</span> },
    { id: "frete", rotulo: "Frete", alinhar: "direita", valor: (e) => e.valorFrete, render: (e) => <span className="tabular text-[12px] text-ink-400">{moeda(e.valorFrete)}</span> },
    { id: "total", rotulo: "Total", alinhar: "direita", valor: (e) => e.total, render: (e) => <span className="tabular text-[13px] font-bold text-ink-900">{moeda(e.total)}</span> },
    {
      id: "status",
      rotulo: "Status",
      alinhar: "centro",
      valor: (e) => e.status,
      render: (e) => (
        <Badge tom={e.status === "lancada" ? "ok" : e.status === "pendente" ? "alerta" : "info"}>
          {e.status === "lancada" ? "lançada no estoque" : e.status === "conferida" ? "pronta p/ lançar" : "aguardando tratamento"}
        </Badge>
      ),
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (e) => (
        <div className="flex items-center justify-end gap-1">
          {e.status !== "lancada" && (
            <Button tamanho="sm" variante="secundario" onClick={() => abrirTratamento(e)}>
              Tratar
            </Button>
          )}
          {e.status === "conferida" && (
            <Button
              tamanho="sm"
              variante="suave"
              disabled={ocupado}
              onClick={async () => {
                const r = await lancarEntrada(e.id);
                toast(r.ok ? (r.aviso ?? "Entrada lançada.") : r.erro, r.ok ? "ok" : "erro");
              }}
            >
              Lançar
            </Button>
          )}
          {e.status !== "lancada" && (
            <button
              type="button"
              title="Excluir"
              onClick={async () => {
                const r = await excluirEntrada(e.id);
                toast(r.ok ? "Entrada removida." : r.erro, r.ok ? "ok" : "erro");
              }}
              className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
            >
              <Icon name="lixo" className="size-3.5" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Entrada de mercadoria"
        subtitulo="Importe o XML da SEFAZ, consulte pela chave ou digite a nota — custo médio ponderado e financeiro aplicados no lançamento"
        acao={
          <>
            <Badge tom={pendentes ? "alerta" : "ok"}>{pendentes} aguardando tratamento</Badge>
            <Badge tom="info">{aguardandoLancamento} prontas para lançar</Badge>
          </>
        }
      />

      <Abas
        abas={[
          { id: "lista", rotulo: "Lista de entradas", contagem: entradas.length },
          { id: "xml", rotulo: "Importar XML" },
          { id: "chave", rotulo: "Chave SEFAZ" },
          { id: "manual", rotulo: "Digitação manual" },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      {aba === "lista" && (
        <>
          <BarraFiltros>
            <FiltroTexto rotulo="Busca livre" valor={busca} aoMudar={setBusca} placeholder="fornecedor, nº, chave, produto" largura="w-60" />
            <FiltroPeriodo rotulo="Emissão" valor={periodo} aoMudar={setPeriodo} />
            <FiltroMulti
              rotulo="Status"
              opcoes={[
                { valor: "pendente", rotulo: "Aguardando tratamento", contagem: entradas.filter((e) => e.status === "pendente").length },
                { valor: "conferida", rotulo: "Pronta para lançar", contagem: entradas.filter((e) => e.status === "conferida").length },
                { valor: "lancada", rotulo: "Lançada no estoque", contagem: entradas.filter((e) => e.status === "lancada").length },
              ]}
              selecionados={status}
              aoAlternar={(v) => setStatus(alternarItem(status, v))}
            />
            <FiltroMulti
              rotulo="Origem"
              opcoes={[
                { valor: "xml", rotulo: "XML importado", contagem: entradas.filter((e) => e.origem === "xml").length },
                { valor: "sefaz", rotulo: "Chave SEFAZ", contagem: entradas.filter((e) => e.origem === "sefaz").length },
                { valor: "manual", rotulo: "Digiteção manual", contagem: entradas.filter((e) => e.origem === "manual").length },
              ]}
              selecionados={origens}
              aoAlternar={(v) => setOrigens(alternarItem(origens, v))}
            />
            <FiltroMulti
              rotulo="Fornecedor"
              opcoes={[...new Set(entradas.map((e) => e.fornecedor))].sort().map((f) => ({ valor: f, rotulo: f, contagem: entradas.filter((e) => e.fornecedor === f).length }))}
              selecionados={fornecedoresSel}
              aoAlternar={(v) => setFornecedoresSel(alternarItem(fornecedoresSel, v))}
            />
            <Campo rotulo="Total de" className="w-24">
              <Input dinheiro valor={minimo} aoMudar={setMinimo} placeholder="0,00" />
            </Campo>
            <Campo rotulo="até" className="w-24">
              <Input dinheiro valor={maximo} aoMudar={setMaximo} placeholder="0,00" />
            </Campo>
            <div className="flex flex-col gap-1 pb-0.5">
              {[
                { l: "Só divergência de qtd", v: soDivergencia, s: setSoDivergencia },
                { l: "Só item sem vínculo", v: soSemVinculo, s: setSoSemVinculo },
              ].map((t) => (
                <label key={t.l} className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-ink-500">
                  <input type="checkbox" checked={t.v} onChange={(e) => t.s(e.target.checked)} className="size-3.5 accent-way-600" />
                  {t.l}
                </label>
              ))}
            </div>
          </BarraFiltros>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            {chips.map((c) => (
              <Chip key={c.r} onClick={c.limpar}>
                {c.r}
              </Chip>
            ))}
            <Button tamanho="sm" variante="fantasma" onClick={limpar} disabled={chips.length === 0}>
              Limpar filtros
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <span className="tabular text-[12px] text-ink-500">
                {linhas.length} nota(s) · <b className="font-bold text-ink-900">{moeda(valorFiltrado)}</b> em mercadoria
              </span>
              <FiltrosSalvos chave="entradas" atual={filtroAtual} aoAplicar={aplicar} />
            </div>
          </div>

          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(e) => e.id}
            nomeExportar="nkway-entradas"
            tamanhoPagina={12}
            vazio={
              entradas.length === 0
                ? "Nenhuma entrada registrada. Use as abas XML, Chave SEFAZ ou Digitação manual acima."
                : "Nenhuma entrada casa os filtros aplicados."
            }
          />
        </>
      )}

      {aba === "xml" && (
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <Card>
            <p className="micro mb-2 text-ink-400">XML da NF-e de entrada</p>
            <button
              type="button"
              onClick={() => arquivoRef.current?.click()}
              className="mb-3 flex w-full flex-col items-center gap-1 rounded-xl border-2 border-dashed border-ink-200 bg-ink-50/40 px-4 py-8 text-center transition hover:border-way-400 hover:bg-way-50/40"
            >
              <Icon name="entrada" className="size-6 text-way-600" />
              <span className="text-[13px] font-semibold text-ink-700">Arraste ou clique para escolher o arquivo .xml</span>
              <span className="text-[11.5px] text-ink-400">formatos aceitos: procNfe.xml, NFe.xml (zip não suportado nesta versão)</span>
            </button>
            <input ref={arquivoRef} type="file" accept=".xml,text/xml" className="hidden" onChange={(e) => void lerArquivo(e.target.files?.[0])} />
            <Campo rotulo="…ou cole o conteúdo do XML">
              <textarea
                rows={9}
                value={xml}
                onChange={(e) => setXml(e.target.value)}
                placeholder="<nfeProc>…<NFe>…</NFe>…</nfeProc>"
                className="w-full rounded-lg bg-ink-50/60 p-2.5 font-mono text-[11.5px] leading-snug text-ink-700 ring-1 ring-inset ring-ink-100 outline-none focus:bg-white focus:ring-2 focus:ring-way-500"
              />
            </Campo>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variante="secundario"
                onClick={async () => {
                  const r = await preVisualizarXml(xml);
                  if (!r.ok) return toast(r.erro, "erro");
                  setPreview(r);
                  toast("Pré-visualização pronta — confira antes de registrar.");
                }}
                disabled={xml.trim().length < 40}
                icone="busca"
              >
                Pré-visualizar
              </Button>
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
                <input type="checkbox" checked={gerarFin} onChange={(e) => setGerarFin(e.target.checked)} className="size-3.5 accent-way-600" />
                Gerar conta a pagar
              </label>
              <Select
                className="w-56"
                valor={fornecedorSel}
                aoMudar={setFornecedorSel}
                opcoes={[{ valor: "", rotulo: "Fornecedor do XML (detectar)" }, ...fornecedores.map((f) => ({ valor: f.id, rotulo: f.nome }))]}
              />
              <Button
                icone="check"
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  const r = await importarXml({ xml, gerarFinanceiro: gerarFin, fornecedorId: fornecedorSel || null });
                  setOcupado(false);
                  if (!r.ok) return toast(r.erro, "erro");
                  toast(r.aviso ?? "Entrada registrada.");
                  setXml("");
                  setPreview(null);
                  setAba("lista");
                }}
              >
                Registrar entrada
              </Button>
            </div>
          </Card>
          <Card>
            <p className="micro mb-2 text-ink-400">O que a leitura extraiu</p>
            {!preview || !preview.ok ? (
              <Vazio>Cole um XML e clique em “Pré-visualizar”. Nada é gravado até você registrar.</Vazio>
            ) : (
              <ResumoNota nota={preview.nota} />
            )}
          </Card>
        </div>
      )}

      {aba === "chave" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <p className="micro mb-2 text-ink-400">Consulta por chave de acesso</p>
            <Campo rotulo="Chave da NF-e (44 dígitos)" dica="Em produção esta chamada sai do navegador e vai ao worker mTLS com o certificado A1 (roteiro DF-e do repositório).">
              <Input
                valor={formatChave(chave)}
                aoMudar={(v) => setChave(v.replace(/\D/g, "").slice(0, 44))}
                placeholder="35 2603 23567891000102 55 001 000129481 1 98765432 8"
                className="font-mono"
              />
            </Campo>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variante="secundario"
                disabled={chave.length !== 44}
                onClick={async () => {
                  const r = await simularChave(chave);
                  if (!r.ok) return toast(r.erro, "erro");
                  setPreviewChave(r);
                  toast("Nota localizada no distribution (modo demonstração).");
                }}
              >
                Consultar
              </Button>
              <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
                <input type="checkbox" checked={gerarFin} onChange={(e) => setGerarFin(e.target.checked)} className="size-3.5 accent-way-600" />
                Gerar conta a pagar
              </label>
              <Button
                disabled={ocupado || !previewChave || !previewChave.ok}
                icone="check"
                onClick={async () => {
                  setOcupado(true);
                  const r = await importarPorChave({ chave, gerarFinanceiro: gerarFin, fornecedorId: fornecedorSel || null });
                  setOcupado(false);
                  if (!r.ok) return toast(r.erro, "erro");
                  toast(r.aviso ?? "Entrada criada a partir da consulta.");
                  setChave("");
                  setPreviewChave(null);
                  setAba("lista");
                }}
              >
                Importar no ERP
              </Button>
            </div>
          </Card>
          <Card>
            <p className="micro mb-2 text-ink-400">Conteúdo retornado</p>
            {!previewChave || !previewChave.ok ? (
              <Vazio>Digite uma chave de 44 dígitos e consulte. Você pode testar com a chave de qualquer nota lançada na lista.</Vazio>
            ) : (
              <ResumoNota nota={previewChave.nota} />
            )}
          </Card>
        </div>
      )}

      {aba === "manual" && (
        <Card>
          <p className="micro mb-3 text-ink-400">Nota avulsa (fornecedor sem XML)</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Campo rotulo="Fornecedor" className="lg:col-span-2" obrigatorio>
              <Input valor={manual.fornecedor} aoMudar={(v) => setManual({ ...manual, fornecedor: v })} placeholder="COMERCIAL X LTDA" />
            </Campo>
            <Campo rotulo="CNPJ">
              <Input valor={manual.cnpj} aoMudar={(v) => setManual({ ...manual, cnpj: v })} placeholder="00.000.000/0000-00" />
            </Campo>
            <Campo rotulo="Nº nota">
              <Input valor={manual.numeroNota} aoMudar={(v) => setManual({ ...manual, numeroNota: v })} placeholder="1204" />
            </Campo>
            <Campo rotulo="Emissão">
              <Input type="date" valor={manual.emissao} aoMudar={(v) => setManual({ ...manual, emissao: v })} />
            </Campo>
            <Campo rotulo="Frete (R$)">
              <Input dinheiro valor={manual.frete} aoMudar={(v) => setManual({ ...manual, frete: v })} placeholder="0,00" />
            </Campo>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead>
                <tr className="border-b border-ink-100 text-left">
                  {["Produto do cadastro", "Descrição na nota", "Qtd", "Custo unit.", "Preço venda", "Un.", ""].map((h) => (
                    <th key={h} className="micro px-1.5 py-1.5 text-ink-400">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {manualItens.map((it, i) => {
                  const custo = Number(it.custo.replace(",", ".")) || 0;
                  return (
                    <tr key={i} className="border-b border-ink-50">
                      <td className="py-1 pr-1">
                        <Select
                          valor={it.produtoId}
                          aoMudar={(v) => {
                            const p = produtos.find((x) => x.id === v);
                            setManualItens((a) =>
                              a.map((x, xi) =>
                                xi === i
                                  ? { ...x, produtoId: v, nome: p?.nome ?? x.nome, preco: p ? String(p.preco) : x.preco, unidade: p?.unidade ?? x.unidade, sku: p?.sku ?? x.sku }
                                  : x,
                              ),
                            );
                          }}
                          opcoes={[{ valor: "", rotulo: "— criar novo —" }, ...produtos.map((p) => ({ valor: p.id, rotulo: `${p.nome} (${p.sku})` }))]}
                        />
                      </td>
                      <td className="py-1 pr-1">
                        <Input valor={it.nome} aoMudar={(v) => setManualItens((a) => a.map((x, xi) => (xi === i ? { ...x, nome: v } : x)))} placeholder="nome como veio na nota" />
                      </td>
                      <td className="w-16 py-1 pr-1">
                        <Input valor={it.qtd} aoMudar={(v) => setManualItens((a) => a.map((x, xi) => (xi === i ? { ...x, qtd: v } : x)))} />
                      </td>
                      <td className="w-24 py-1 pr-1">
                        <Input dinheiro valor={it.custo} aoMudar={(v) => setManualItens((a) => a.map((x, xi) => (xi === i ? { ...x, custo: v, preco: String(round2((Number(v.replace(",", ".")) || 0) * (1 + (Number(markup) || 0) / 100))) } : x)))} placeholder="0,00" />
                      </td>
                      <td className="w-24 py-1 pr-1">
                        <Input dinheiro valor={it.preco} aoMudar={(v) => setManualItens((a) => a.map((x, xi) => (xi === i ? { ...x, preco: v } : x)))} placeholder="0,00" />
                      </td>
                      <td className="w-16 py-1 pr-1">
                        <Input valor={it.unidade} aoMudar={(v) => setManualItens((a) => a.map((x, xi) => (xi === i ? { ...x, unidade: v } : x)))} />
                      </td>
                      <td className="py-1">
                        <button
                          type="button"
                          onClick={() => setManualItens((a) => a.filter((_, xi) => xi !== i))}
                          className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Icon name="x" className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button tamanho="sm" variante="secundario" icone="mais" onClick={() => setManualItens((a) => [...a, { produtoId: "", nome: "", qtd: "1", custo: "", preco: "", unidade: "UN", sku: "", ncm: "" }])}>
              Adicionar item
            </Button>
            <Campo rotulo="Markup s/ custo (%)" className="w-32">
              <Input dinheiro valor={markup} aoMudar={setMarkup} />
            </Campo>
            <label className="flex items-center gap-1.5 pb-1 text-[12px] font-medium text-ink-600">
              <input type="checkbox" checked={gerarFin} onChange={(e) => setGerarFin(e.target.checked)} className="size-3.5 accent-way-600" />
              Gerar conta a pagar
            </label>
            <Button
              className="ml-auto"
              disabled={ocupado}
              icone="check"
              onClick={async () => {
                setOcupado(true);
                const r = await registrarEntradaManual({
                  fornecedor: manual.fornecedor,
                  cnpjFornecedor: manual.cnpj,
                  numeroNota: manual.numeroNota,
                  serie: manual.serie,
                  emissao: manual.emissao,
                  valorFrete: Number(manual.frete.replace(",", ".")) || 0,
                  gerarFinanceiro: gerarFin,
                  observacao: manual.obs,
                  itens: manualItens.map((i) => ({
                    produtoId: i.produtoId || null,
                    nome: i.nome,
                    qtd: Number(i.qtd.replace(",", ".")) || 0,
                    custo: Number(i.custo.replace(",", ".")) || 0,
                    preco: Number(i.preco.replace(",", ".")) || 0,
                    unidade: i.unidade,
                    sku: i.sku,
                    ncm: i.ncm,
                  })),
                });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(r.aviso ?? "Entrada manual registrada.");
                setManualItens([{ produtoId: "", nome: "", qtd: "1", custo: "", preco: "", unidade: "UN", sku: "", ncm: "" }]);
                setAba("lista");
              }}
            >
              Registrar entrada manual
            </Button>
          </div>
          <Campo rotulo="Observação" className="mt-3">
            <Input valor={manual.obs} aoMudar={(v) => setManual({ ...manual, obs: v })} placeholder="ex.: nota avulsa do caminhão, pago em dinheiro" />
          </Campo>
        </Card>
      )}

      {/* ------------------------------------------------------------ modal tratamento */}
      <Modal
        aberto={!!tratando}
        aoFechar={() => setTratando(null)}
        titulo={tratando ? `Tratar entrada · NF ${tratando.numeroNota}` : ""}
        descricao="Vincule cada item ao cadastro, ajuste a quantidade recebida e defina o preço de venda"
        largura="max-w-5xl"
        rodape={
          <>
            <label className="mr-auto flex items-center gap-1.5 text-[12px] font-medium text-ink-600">
              <input type="checkbox" checked={gerarFin} onChange={(e) => setGerarFin(e.target.checked)} className="size-3.5 accent-way-600" />
              Gerar conta a pagar no financeiro
            </label>
            <Button variante="secundario" disabled={ocupado} onClick={() => salvar(false)}>
              Só salvar
            </Button>
            <Button disabled={ocupado} icone="entrada" onClick={() => salvar(true)}>
              {ocupado ? "Processando…" : "Salvar e lançar no estoque"}
            </Button>
          </>
        }
      >
        {tratando && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { r: "Fornecedor", v: tratando.fornecedor },
                { r: "Emissão", v: dataBR(tratando.emissao) },
                { r: "Valor produtos", v: moeda(tratando.valorProdutos) },
                { r: "Total da nota", v: moeda(tratando.total) },
              ].map((x) => (
                <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
                  <p className="micro text-ink-400">{x.r}</p>
                  <p className="mt-0.5 truncate text-[12.5px] font-semibold text-ink-800">{x.v}</p>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <Campo rotulo="Aplicar markup a todos os preços (%)" className="w-52">
                <Input dinheiro valor={markup} aoMudar={setMarkup} />
              </Campo>
              <Button
                tamanho="sm"
                variante="secundario"
                className="mb-1"
                onClick={() => {
                  const m = Number(markup.replace(",", ".")) || 0;
                  setItens((a) => a.map((i) => ({ ...i, preco: round2(i.custo * (1 + m / 100)) })));
                  toast(`Preços recalculados com ${m}% sobre o custo.`);
                }}
              >
                Recalcular
              </Button>
              <span className="mb-2 text-[11.5px] text-ink-400">
                custo total {moeda(round2(itens.reduce((s, i) => s + i.qtd * i.custo, 0)))}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full min-w-[900px] text-[12px]">
                <thead className="bg-ink-50">
                  <tr className="text-left">
                    {["Item como veio", "Produto interno", "Qtd nota", "Qtd recebida", "Custo unit.", "Preço venda", "Custo total"].map((h) => (
                      <th key={h} className="micro px-2 py-1.5 text-ink-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => {
                    const diverg = it.qtd !== it.qtdNota;
                    return (
                      <tr key={i} className={cn("border-t border-ink-50", !it.produtoId && "bg-amber-50/40")}>
                        <td className="px-2 py-1.5">
                          <p className="font-semibold text-ink-800">{it.nomeFornecedor || it.nome}</p>
                          <p className="font-mono text-[10px] text-ink-400">
                            {it.gtin && it.gtin !== "SEM GTIN" ? it.gtin : "sem GTIN"} · NCM {it.ncm}
                          </p>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            valor={it.produtoId ?? ""}
                            aoMudar={(v) => setItens((a) => a.map((x, xi) => (xi === i ? { ...x, produtoId: v || null, nome: produtos.find((p) => p.id === v)?.nome ?? x.nome } : x)))}
                            opcoes={[{ valor: "", rotulo: "criar produto novo" }, ...produtos.map((p) => ({ valor: p.id, rotulo: `${p.nome} · ${p.sku}` }))]}
                          />
                        </td>
                        <td className="tabular px-2 py-1.5 text-ink-500">{it.qtdNota}</td>
                        <td className="px-2 py-1.5">
                          <input
                            value={String(it.qtd)}
                            onChange={(e) => setItens((a) => a.map((x, xi) => (xi === i ? { ...x, qtd: Number(e.target.value.replace(",", ".")) || 0 } : x)))}
                            className={cn("tabular w-16 rounded px-1.5 py-1 text-right ring-1 ring-inset outline-none focus:ring-2 focus:ring-way-500", diverg ? "bg-amber-50 text-amber-800 ring-amber-300" : "ring-ink-200")}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={String(it.custo)}
                            onChange={(e) => setItens((a) => a.map((x, xi) => (xi === i ? { ...x, custo: Number(e.target.value.replace(",", ".")) || 0 } : x)))}
                            className="tabular w-20 rounded px-1.5 py-1 text-right ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={String(it.preco)}
                            onChange={(e) => setItens((a) => a.map((x, xi) => (xi === i ? { ...x, preco: Number(e.target.value.replace(",", ".")) || 0 } : x)))}
                            className="tabular w-20 rounded px-1.5 py-1 text-right ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
                          />
                        </td>
                        <td className="tabular px-2 py-1.5 font-semibold text-ink-900">{moeda(round2(it.qtd * it.custo))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Campo rotulo="Observação da entrada">
              <Input valor={obs} aoMudar={setObs} placeholder="ex.: recebimento parcial, restante chega amanhã" />
            </Campo>
          </div>
        )}
      </Modal>
    </>
  );
}

function ResumoNota({ nota }: { nota: { numero: string; serie: string; emissao: string; fornecedor: string; cnpjFornecedor: string; valorProdutos: number; valorFrete: number; total: number; chave: string; itens: { nome: string; qtd: number; custo: number; unidade: string; ncm: string }[] } }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
        {[
          { r: "NF-e", v: `${nota.numero} · série ${nota.serie}` },
          { r: "Emissão", v: dataBR(nota.emissao) },
          { r: "Chave", v: nota.chave.slice(0, 8) + "…" },
          { r: "Fornecedor", v: nota.fornecedor },
          { r: "CNPJ", v: nota.cnpjFornecedor || "—" },
          { r: "Total", v: moeda(nota.total) },
        ].map((x) => (
          <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
            <p className="micro text-ink-400">{x.r}</p>
            <p className="mt-0.5 truncate font-semibold text-ink-800" title={String(x.v)}>
              {x.v}
            </p>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-ink-50 rounded-lg border border-ink-100">
        {nota.itens.slice(0, 8).map((i, idx) => (
          <li key={idx} className="flex items-center gap-3 px-2.5 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink-800">{i.nome}</span>
              <span className="block font-mono text-[10px] text-ink-400">NCM {i.ncm}</span>
            </span>
            <span className="tabular text-[11.5px] text-ink-500">
              {i.qtd} {i.unidade}
            </span>
            <span className="tabular w-20 text-right text-[12px] font-semibold text-ink-900">{moeda(i.qtd * i.custo)}</span>
          </li>
        ))}
      </ul>
      {nota.itens.length > 8 && <p className="text-[11.5px] text-ink-400">…e mais {nota.itens.length - 8} item(ns) na nota.</p>}
    </div>
  );
}
