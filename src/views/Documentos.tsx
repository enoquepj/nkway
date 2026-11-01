"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltrosSalvos,
  Icon,
  Input,
  Modal,
  PageHeader,
  Select,
  FiltroTexto,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { FORMAS_PAGAMENTO, dataHoraBR, formatChave, moeda, round2, rotuloForma, tributosEstimados } from "@/lib/dominio";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import { armazenarXmlFiscalDocumento, exportarXmlDocumentos } from "@/server/acoes/documentosXml";
import { cancelarVenda, faturarDav, excluirDav, type Pagamento } from "@/server/acoes/pdv";
import type { VendaDto } from "@/server/dados";
import { Impressao, type AlvoImpresso } from "@/components/Impressao";
import type { Emitente } from "@/lib/danfe";
import type { InutilizacaoDto } from "@/server/dados";
import { NumeracaoView, type DocumentoResumo } from "@/views/Numeracao";

function dispararDownloadBase64(nomeArquivo: string, mimeType: string, base64: string) {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  URL.revokeObjectURL(url);
}

const MOTIVOS = [
  "01 - Venda sem entrada ou saída de mercadoria",
  "02 - Erro na emissão (valor, destinatário, item)",
  "03 - Emissão duplicada do documento",
  "04 - Operação não concluída pelo destinatário",
];

const STATUS_TOM: Record<string, "ok" | "alerta" | "erro" | "neutro"> = {
  faturado: "ok",
  aberto: "alerta",
  cancelado: "erro",
};

export function DocumentosView({
  vendas,
  empresa,
  emitente,
  inutilizacoes,
  proximoNumero,
  serieAtual,
  usuarioPapel = "administrador",
}: {
  vendas: VendaDto[];
  empresa: { fantasia: string; nome: string; cnpj: string; endereco: string; municipio: string; uf: string };
  emitente: Emitente;
  inutilizacoes: InutilizacaoDto[];
  proximoNumero: number;
  serieAtual: string;
  usuarioPapel?: PerfilUsuario;
}) {
  const toast = useToast();
  const podeExportarXml = temPermissao(usuarioPapel, "documentos.exportar_xml");
  const podeFaturarDav = temPermissao(usuarioPapel, "dav.faturar");
  const podeCancelar = temPermissao(usuarioPapel, "venda.cancelar");
  const podeFiscalEventos = temPermissao(usuarioPapel, "fiscal.eventos");

  const [aba, setAba] = useState<"fiscal" | "dav" | "todos" | "numeracao">("fiscal");
  const [busca, setBusca] = useState("");
  const [numeroFiltro, setNumeroFiltro] = useState("");
  const [clientesSel, setClientesSel] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [status, setStatus] = useState<string[]>([]);
  const [modelos, setModelos] = useState<string[]>([]);
  const [xmlFiltro, setXmlFiltro] = useState<string[]>([]);
  const [formas, setFormas] = useState<string[]>([]);
  const [minimo, setMinimo] = useState("");
  const [selecionadosIds, setSelecionadosIds] = useState<string[]>([]);
  const [resumoXmlModal, setResumoXmlModal] = useState<{
    titulo: string;
    exportados: number;
    modo?: "xml" | "zip";
    semXml: { id: string; rotulo: string; motivo: string }[];
  } | null>(null);
  const inputXmlRef = useRef<HTMLInputElement>(null);

  const [detalhe, setDetalhe] = useState<VendaDto | null>(null);
  const [faturando, setFaturando] = useState<VendaDto | null>(null);
  const [cancelando, setCancelando] = useState<VendaDto | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [novoModelo, setNovoModelo] = useState<"NFC-e" | "NF-e" | "SAT">("NFC-e");
  const [novoPagamento, setNovoPagamento] = useState("dinheiro");
  const [ocupado, setOcupado] = useState(false);
  const [imprimindo, setImprimindo] = useState<AlvoImpresso | null>(null);
  const [corrigindo, setCorrigindo] = useState<DocumentoResumo | null>(null);

  const filtroAtual = {
    busca,
    numeroFiltro,
    clientesSel,
    inicio: periodo.inicio,
    fim: periodo.fim,
    status,
    modelos,
    xmlFiltro,
    formas,
    minimo,
  };
  type FiltroCfg = typeof filtroAtual;
  const aplicar = (f: FiltroCfg) => {
    setBusca(f.busca ?? "");
    setNumeroFiltro(f.numeroFiltro ?? "");
    setClientesSel(f.clientesSel ?? []);
    setPeriodo({ inicio: f.inicio ?? "", fim: f.fim ?? "" });
    setStatus(f.status ?? []);
    setModelos(f.modelos ?? []);
    setXmlFiltro(f.xmlFiltro ?? []);
    setFormas(f.formas ?? []);
    setMinimo(f.minimo ?? "");
  };
  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...(numeroFiltro ? [{ r: `nº: ${numeroFiltro}`, limpar: () => setNumeroFiltro("") }] : []),
    ...clientesSel.map((cl) => ({ r: `cliente: ${cl}`, limpar: () => setClientesSel(clientesSel.filter((x) => x !== cl)) })),
    ...(periodo.inicio || periodo.fim ? [{ r: `período ${periodo.inicio || "…"} → ${periodo.fim || "…"}`, limpar: () => setPeriodo({ inicio: "", fim: "" }) }] : []),
    ...status.map((s2) => ({ r: `situação: ${s2}`, limpar: () => setStatus(status.filter((x) => x !== s2)) })),
    ...modelos.map((m) => ({ r: `tipo/modelo: ${m}`, limpar: () => setModelos(modelos.filter((x) => x !== m)) })),
    ...xmlFiltro.map((xf) => ({ r: `XML: ${xf === "com_xml" ? "disponível" : "sem XML"}`, limpar: () => setXmlFiltro(xmlFiltro.filter((x) => x !== xf)) })),
    ...formas.map((f) => ({ r: `pagamento: ${rotuloForma(f)}`, limpar: () => setFormas(formas.filter((x) => x !== f)) })),
    ...(minimo ? [{ r: `total ≥ ${minimo}`, limpar: () => setMinimo("") }] : []),
  ];

  const clientesUnicos = useMemo(
    () => [...new Set(vendas.map((v) => v.clienteNome).filter(Boolean))].sort(),
    [vendas],
  );

  const linhas = useMemo(() => {
    const numLimpo = numeroFiltro.trim();
    return vendas.filter((v) => {
      if (aba === "fiscal" && v.tipo !== "fiscal") return false;
      if (aba === "dav" && v.tipo !== "dav") return false;
      if (!casaTexto(`${v.clienteNome} ${v.numero} ${v.numeroNota ?? ""} ${v.chave ?? ""} ${v.observacao ?? ""}`, busca)) return false;
      if (numLimpo) {
        const nDoc = String(v.numeroNota ?? "");
        const nInt = String(v.numero);
        if (!nDoc.includes(numLimpo) && !nInt.includes(numLimpo)) return false;
      }
      if (clientesSel.length && !clientesSel.includes(v.clienteNome)) return false;
      if (status.length && !status.includes(v.status)) return false;
      if (modelos.length) {
        const tipoModelo = v.tipo === "dav" ? "DAV" : (v.modelo ?? "NFC-e");
        if (!modelos.includes(tipoModelo)) return false;
      }
      if (xmlFiltro.length) {
        const tag = v.temXml ? "com_xml" : "sem_xml";
        if (!xmlFiltro.includes(tag)) return false;
      }
      if (formas.length && !formas.includes(v.formaPagamento)) return false;
      if (minimo && v.total < (Number(minimo.replace(",", ".")) || 0)) return false;
      if ((periodo.inicio || periodo.fim) && !emPeriodo(v.data, periodo)) return false;
      return true;
    });
  }, [vendas, aba, busca, numeroFiltro, clientesSel, status, modelos, xmlFiltro, formas, minimo, periodo]);

  async function acionarExportacaoXml(idsAlvo: string[]) {
    if (idsAlvo.length === 0) {
      toast("Nenhum documento selecionado ou presente no filtro atual.", "info");
      return;
    }
    setOcupado(true);
    const r = await exportarXmlDocumentos({ ids: idsAlvo });
    setOcupado(false);

    if (!r.ok) {
      if (r.semXml && r.semXml.length > 0) {
        setResumoXmlModal({
          titulo: "XML fiscal não disponível para exportação",
          exportados: 0,
          semXml: r.semXml,
        });
      }
      toast(r.erro, "erro");
      return;
    }

    dispararDownloadBase64(r.nomeArquivo, r.mimeType, r.conteudoBase64);
    toast(r.aviso, "ok");

    if (r.semXml.length > 0) {
      setResumoXmlModal({
        titulo: r.modo === "zip" ? "Exportação em lote (.zip) concluída com avisos" : "Exportação concluída com avisos",
        exportados: r.exportados.length,
        modo: r.modo,
        semXml: r.semXml,
      });
    }
  }

  const totalSelecionado = round2(linhas.reduce((s, v) => s + (v.status === "cancelado" ? 0 : v.total), 0));
  const contagem = (tipo: "fiscal" | "dav") => vendas.filter((v) => v.tipo === tipo).length;
  const documentosParaNumeracao: DocumentoResumo[] = useMemo(
    () =>
      vendas
        .filter((v) => v.tipo === "fiscal")
        .map((v) => ({
          id: v.id,
          numero: v.numero,
          modelo: v.modelo,
          serie: v.serie,
          numeroNota: v.numeroNota,
          chave: v.chave,
          protocolo: v.protocolo,
          status: v.status,
          clienteNome: v.clienteNome,
          data: v.data,
          eventos: (v.eventos ?? []).map((e) => ({ ...e })),
        })),
    [vendas],
  );

  const selecionadosSet = useMemo(() => new Set(selecionadosIds), [selecionadosIds]);
  const todosFiltradosMarcados = linhas.length > 0 && linhas.every((l) => selecionadosSet.has(l.id));

  const colunas: Coluna<VendaDto>[] = [
    ...(podeExportarXml
      ? [
          {
            id: "sel",
            rotulo: "",
            largura: "36px",
            ocultoNoCsv: true,
            render: (v: VendaDto) => (
              <input
                type="checkbox"
                aria-label={`Selecionar documento ${v.numeroNota ?? v.numero}`}
                checked={selecionadosSet.has(v.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  setSelecionadosIds((atual) =>
                    atual.includes(v.id) ? atual.filter((x) => x !== v.id) : [...atual, v.id],
                  );
                }}
                className="size-3.5 accent-way-600"
              />
            ),
          } satisfies Coluna<VendaDto>,
        ]
      : []),
    {
      id: "numero",
      rotulo: aba === "dav" ? "DAV" : "Documento",
      valor: (v) => v.numeroNota ?? v.numero,
      render: (v) => (
        <div>
          <p className="tabular flex items-center gap-1.5 text-[12.5px] font-bold text-ink-900">
            <span>{v.tipo === "dav" ? `DAV ${v.numero}` : `${v.modelo ?? "NFC-e"} ${v.numeroNota ?? "—"}`}</span>
            {v.tipo === "fiscal" && (
              <Badge tom={v.temXml ? "ok" : "neutro"}>
                {v.temXml ? "XML" : "s/ XML"}
              </Badge>
            )}
          </p>
          <p className="text-[10.5px] text-ink-400">{dataHoraBR(v.data)}</p>
        </div>
      ),
    },
    {
      id: "cliente",
      rotulo: "Cliente",
      valor: (v) => v.clienteNome,
      render: (v) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium text-ink-800">{v.clienteNome}</p>
          {v.observacao && <p className="truncate text-[10.5px] text-ink-400">{v.observacao}</p>}
        </div>
      ),
    },
    { id: "itens", rotulo: "Itens", alinhar: "centro", valor: (v) => v.itens.length, render: (v) => <span className="tabular text-[12px]">{v.itens.length}</span> },
    {
      id: "pagamento",
      rotulo: "Pagamento",
      valor: (v) => rotuloForma(v.formaPagamento),
      render: (v) =>
        v.pagamentos.length > 1 ? (
          <span className="flex flex-wrap gap-1">
            {v.pagamentos.map((p, i) => (
              <Badge key={i} tom="neutro">
                {rotuloForma(p.forma)} {moeda(p.valor)}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-[12px] text-ink-600">{v.tipo === "dav" ? "—" : rotuloForma(v.formaPagamento)}</span>
        ),
    },
    {
      id: "status",
      rotulo: "Status",
      alinhar: "centro",
      valor: (v) => v.status,
      render: (v) => (
        <Badge tom={STATUS_TOM[v.status] ?? "neutro"}>
          {v.status === "aberto" && v.validade ? `aberto até ${v.validade.split("-").reverse().join("/")}` : v.status}
        </Badge>
      ),
    },
    { id: "total", rotulo: "Total", alinhar: "direita", valor: (v) => v.total, render: (v) => <span className={cn("tabular text-[13px] font-bold", v.status === "cancelado" ? "text-ink-300 line-through" : "text-ink-900")}>{moeda(v.total)}</span> },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (v) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" title="Abrir documento" onClick={() => setDetalhe(v)} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
            <Icon name="documento" className="size-4" />
          </button>
          {podeExportarXml && v.tipo === "fiscal" && (
            <button
              type="button"
              title={v.temXml ? "Exportar XML fiscal" : "Documento sem XML armazenado"}
              disabled={ocupado}
              onClick={() => void acionarExportacaoXml([v.id])}
              className={cn(
                "rounded-md px-1.5 py-1 text-[11px] font-semibold transition",
                v.temXml
                  ? "bg-way-50 text-way-700 hover:bg-way-100"
                  : "text-ink-300 hover:bg-ink-100 hover:text-ink-600",
              )}
            >
              XML
            </button>
          )}
          {podeFaturarDav && v.tipo === "dav" && v.status === "aberto" && (
            <Button tamanho="sm" variante="suave" onClick={() => { setFaturando(v); setNovoModelo("NFC-e"); }}>
              Faturar
            </Button>
          )}
          {podeCancelar && v.status !== "cancelado" && (
            <button type="button" title="Cancelar" onClick={() => setCancelando(v)} className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600">
              <Icon name="x" className="size-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Documentos de venda"
        subtitulo="Notas fiscais e DAVs emitidos · exportação auditada de XML fiscal (individual e lote ZIP) · eventos e DANFE"
        etiquetas={
          <>
            <Badge tom="info">{linhas.length} documento(s) no filtro</Badge>
            <Badge tom="ok">{moeda(totalSelecionado)}</Badge>
            <Badge tom="neutro">{vendas.filter((v) => v.temXml).length} com XML armazenado</Badge>
          </>
        }
        acao={
          podeExportarXml && aba !== "numeracao" ? (
            <>
              <Link href="/emissor">
                <Button variante="secundario" tamanho="sm" icone="raio">
                  Emissor SEFAZ
                </Button>
              </Link>
              <Button
                variante="secundario"
                tamanho="sm"
                onClick={() => {
                  if (todosFiltradosMarcados) {
                    const remover = new Set(linhas.map((l) => l.id));
                    setSelecionadosIds((atual) => atual.filter((id) => !remover.has(id)));
                  } else {
                    const uniao = new Set([...selecionadosIds, ...linhas.map((l) => l.id)]);
                    setSelecionadosIds([...uniao]);
                  }
                }}
              >
                {todosFiltradosMarcados ? "Desmarcar filtro" : `Selecionar filtrados (${linhas.length})`}
              </Button>
              <Button
                icone="baixar"
                disabled={ocupado || (selecionadosIds.length === 0 && linhas.length === 0)}
                onClick={() =>
                  void acionarExportacaoXml(
                    selecionadosIds.length > 0 ? selecionadosIds : linhas.map((l) => l.id),
                  )
                }
              >
                {ocupado
                  ? "Preparando XML…"
                  : selecionadosIds.length > 0
                    ? `Exportar XML (${selecionadosIds.length})`
                    : "Exportar XML do filtro"}
              </Button>
            </>
          ) : undefined
        }
      />

      <Abas
        abas={[
          { id: "fiscal", rotulo: "Notas fiscais", contagem: contagem("fiscal") },
          { id: "dav", rotulo: "DAVs / orçamentos", contagem: contagem("dav") },
          { id: "todos", rotulo: "Todos os tipos", contagem: vendas.length },
          ...(podeFiscalEventos ? [{ id: "numeracao", rotulo: "Numeração e eventos" }] : []),
        ]}
        atual={aba}
        aoTrocar={(i) => setAba(i as "fiscal" | "dav" | "todos" | "numeracao")}
      />

      {aba !== "numeracao" && (
        <>
          <BarraFiltros>
            <FiltroTexto rotulo="Busca livre" valor={busca} aoMudar={setBusca} placeholder="cliente, chave, observação" largura="w-52" />
            <Campo rotulo="Número" className="w-28">
              <Input valor={numeroFiltro} aoMudar={setNumeroFiltro} placeholder="Nº nota/DAV" className="font-mono" />
            </Campo>
            <FiltroPeriodo valor={periodo} aoMudar={setPeriodo} />
            <FiltroMulti
              rotulo="Cliente"
              opcoes={clientesUnicos.map((cl) => ({
                valor: cl,
                rotulo: cl,
                contagem: vendas.filter((v) => v.clienteNome === cl).length,
              }))}
              selecionados={clientesSel}
              aoAlternar={(v) => setClientesSel(alternarItem(clientesSel, v))}
            />
            <FiltroMulti
              rotulo="Situação"
              opcoes={[
                { valor: "faturado", rotulo: "Autorizadas" },
                { valor: "aberto", rotulo: "Abertos" },
                { valor: "cancelado", rotulo: "Canceladas" },
              ]}
              selecionados={status}
              aoAlternar={(v) => setStatus(alternarItem(status, v))}
            />
            <FiltroMulti
              rotulo="Tipo / Modelo"
              opcoes={[
                { valor: "NFC-e", rotulo: "NFC-e" },
                { valor: "NF-e", rotulo: "NF-e" },
                { valor: "SAT", rotulo: "SAT" },
                { valor: "DAV", rotulo: "DAV / Orçamento" },
              ]}
              selecionados={modelos}
              aoAlternar={(v) => setModelos(alternarItem(modelos, v))}
            />
            <FiltroMulti
              rotulo="Arquivo XML"
              opcoes={[
                { valor: "com_xml", rotulo: "Com XML disponível", contagem: vendas.filter((v) => v.temXml).length },
                { valor: "sem_xml", rotulo: "Sem XML armazenado", contagem: vendas.filter((v) => !v.temXml).length },
              ]}
              selecionados={xmlFiltro}
              aoAlternar={(v) => setXmlFiltro(alternarItem(xmlFiltro, v))}
            />
            <FiltroMulti rotulo="Pagamento" opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} selecionados={formas} aoAlternar={(v) => setFormas(alternarItem(formas, v))} />
            <Campo rotulo="Total ≥" className="w-24">
              <Input dinheiro valor={minimo} aoMudar={setMinimo} placeholder="0,00" />
            </Campo>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <Chip key={c.r} onClick={c.limpar}>
                  {c.r}
                </Chip>
              ))}
              <FiltrosSalvos chave="documentos" atual={filtroAtual} aoAplicar={aplicar} />
              <Button
                tamanho="sm"
                variante="fantasma"
                onClick={() => {
                  setBusca("");
                  setNumeroFiltro("");
                  setClientesSel([]);
                  setPeriodo({ inicio: "", fim: "" });
                  setStatus([]);
                  setModelos([]);
                  setXmlFiltro([]);
                  setFormas([]);
                  setMinimo("");
                  setSelecionadosIds([]);
                }}
              >
                Limpar filtros
              </Button>
            </div>
          </BarraFiltros>

          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(v) => v.id}
            nomeExportar="nkway-documentos"
            tamanhoPagina={15}
            vazio={aba === "dav" ? "Nenhum DAV neste filtro. Gere um na frente de caixa." : "Nenhum documento encontrado neste filtro."}
          />
        </>
      )}

      <Modal
        aberto={!!detalhe}
        aoFechar={() => setDetalhe(null)}
        titulo={detalhe ? (detalhe.tipo === "dav" ? `DAV ${detalhe.numero}` : `${detalhe.modelo} ${detalhe.numeroNota}`) : ""}
        descricao="Pré-visualização do documento — o XML completo fica guardado no cadastro da nota"
        largura="max-w-2xl"
        rodape={
          <>
            {detalhe?.tipo === "fiscal" && (
              <Button
                variante="secundario"
                icone="imprimir"
                onClick={() => {
                  setImprimindo({
                    tipo: "nfe",
                    emit: emitente,
                    cscId: "00000000",
                    doc: {
                      modelo: detalhe.modelo ?? "NFC-e",
                      serie: detalhe.serie,
                      numero: detalhe.numeroNota ?? detalhe.numero,
                      numeroInterno: detalhe.numero,
                      chave: detalhe.chave,
                      protocolo: detalhe.protocolo,
                      autorizadaEm: null,
                      status: detalhe.status,
                      ambiente: 2,
                      data: detalhe.data,
                      operador: detalhe.operador,
                      cliente: detalhe.clienteNome,
                      itens: detalhe.itens.map((i) => ({
                        nome: i.nome,
                        qtd: i.qtd,
                        unidade: i.unidade,
                        precoUnit: i.precoUnit,
                        total: i.total,
                      })),
                      subtotal: detalhe.subtotal,
                      desconto: detalhe.desconto,
                      frete: detalhe.vFrete,
                      total: detalhe.total,
                      pagamentos: detalhe.pagamentos,
                      forma: detalhe.formaPagamento,
                      troco: 0,
                      observacao: detalhe.observacao,
                    },
                  });
                  setDetalhe(null);
                }}
              >
                Imprimir {detalhe.modelo === "NF-e" ? "DANFE A4" : "cupom 80 mm"}
              </Button>
            )}
            {detalhe?.tipo === "fiscal" && podeExportarXml && (
              <Button
                variante="suave"
                icone="baixar"
                disabled={ocupado}
                onClick={() => void acionarExportacaoXml([detalhe.id])}
              >
                Exportar XML
              </Button>
            )}
            {detalhe?.tipo === "fiscal" && podeFiscalEventos && (
              <>
                <input
                  ref={inputXmlRef}
                  type="file"
                  accept=".xml,application/xml,text/xml"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f || !detalhe) return;
                    const conteudo = await f.text();
                    setOcupado(true);
                    const r = await armazenarXmlFiscalDocumento({ vendaId: detalhe.id, xml: conteudo });
                    setOcupado(false);
                    toast(r.ok ? r.aviso : r.erro, r.ok ? "ok" : "erro");
                    if (r.ok) setDetalhe(null);
                  }}
                />
                <Button
                  variante="secundario"
                  onClick={() => inputXmlRef.current?.click()}
                >
                  {detalhe.temXml ? "Substituir XML (.xml)" : "Vincular XML (.xml)"}
                </Button>
              </>
            )}
            {detalhe?.tipo === "dav" && detalhe.status === "aberto" && podeFaturarDav && (
              <Button onClick={() => { setFaturando(detalhe); setDetalhe(null); }}>Faturar em nota</Button>
            )}
            {detalhe?.tipo === "fiscal" && detalhe.status === "faturado" && podeFiscalEventos && (
              <Button
                variante="secundario"
                icone="atualizar"
                onClick={() => {
                  setCorrigindo({
                    id: detalhe.id,
                    numero: detalhe.numero,
                    modelo: detalhe.modelo,
                    serie: detalhe.serie,
                    numeroNota: detalhe.numeroNota,
                    chave: detalhe.chave,
                    protocolo: detalhe.protocolo,
                    status: detalhe.status,
                    clienteNome: detalhe.clienteNome,
                    data: detalhe.data,
                    eventos: detalhe.eventos,
                  });
                  setDetalhe(null);
                }}
              >
                Carta de correção
              </Button>
            )}
            {detalhe?.tipo === "dav" && detalhe.status === "aberto" && (
              <Button
                variante="perigo"
                onClick={async () => {
                  const r = await excluirDav(detalhe.id);
                  toast(r.ok ? "DAV removido." : r.erro, r.ok ? "ok" : "erro");
                  setDetalhe(null);
                }}
              >
                Descartar DAV
              </Button>
            )}
          </>
        }
      >
        {detalhe && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-ink-50 p-3 text-[12px] sm:grid-cols-4">
              {[
                { r: "Emitido", v: dataHoraBR(detalhe.data) },
                { r: "Status", v: detalhe.status },
                { r: "Série", v: detalhe.serie ?? "—" },
                { r: "Operador", v: detalhe.operador ?? "—" },
              ].map((x) => (
                <div key={x.r}>
                  <p className="micro text-ink-400">{x.r}</p>
                  <p className="mt-0.5 font-semibold text-ink-800">{x.v}</p>
                </div>
              ))}
            </div>
            {detalhe.chave && (
              <p className="rounded-lg bg-way-50 px-3 py-2 font-mono text-[11px] leading-snug text-way-800">
                chave de acesso
                <span className="mt-0.5 block break-all text-[12px] font-bold tracking-tight">{formatChave(detalhe.chave)}</span>
              </p>
            )}
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink-100 text-left">
                  <th className="micro py-1.5 text-ink-400">Item</th>
                  <th className="micro py-1.5 text-right text-ink-400">Qtd</th>
                  <th className="micro py-1.5 text-right text-ink-400">Unit.</th>
                  <th className="micro py-1.5 text-right text-ink-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {detalhe.itens.map((i, idx) => (
                  <tr key={idx} className="border-b border-ink-50">
                    <td className="py-1.5 pr-2 text-ink-800">{i.nome}</td>
                    <td className="tabular py-1.5 text-right text-ink-600">
                      {i.qtd} {i.unidade}
                    </td>
                    <td className="tabular py-1.5 text-right text-ink-600">{moeda(i.precoUnit)}</td>
                    <td className="tabular py-1.5 text-right font-semibold text-ink-900">{moeda(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-ink-100 pt-3">
              <div className="text-[12px] text-ink-500">
                <p>Subtotal {moeda(detalhe.subtotal)} · desconto {moeda(detalhe.desconto)}</p>
                {detalhe.pagamentos.length > 0 && <p>Pago com {detalhe.pagamentos.map((p) => `${rotuloForma(p.forma)} ${moeda(p.valor)}`).join(" + ")}</p>}
                {detalhe.observacao && <p className="mt-0.5 max-w-sm text-ink-400">{detalhe.observacao}</p>}
              </div>
              <p className="tabular text-[20px] font-bold text-ink-900">{moeda(detalhe.total)}</p>
            </div>
            <p className="text-[11px] text-ink-400">
              Tributos estimados (Lei 12.741, com IBS/CBS da fase de teste): {moeda(tributosEstimados(detalhe.total, { icms: 0, pis: 0, cofins: 0, ibs: 0.1, cbs: 0.9 }).total)}
              {" · "}protocolo {detalhe.protocolo ?? "não autorizado"}
            </p>
            <div className="rounded-lg border border-ink-100 p-3 text-[11px] text-ink-500">
              <p className="font-semibold text-ink-700">{empresa.fantasia}</p>
              <p>
                {empresa.endereco ? `${empresa.endereco} · ` : ""}
                {empresa.municipio}/{empresa.uf} · CNPJ {empresa.cnpj}
              </p>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        aberto={!!faturando}
        aoFechar={() => setFaturando(null)}
        titulo="Faturar DAV em nota fiscal"
        descricao="O estoque baixa nesta operação e o DAV é encerrado automaticamente"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setFaturando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!faturando) return;
                setOcupado(true);
                const r = await faturarDav({
                  davId: faturando.id,
                  modelo: novoModelo,
                  pagamentos: [{ forma: novoPagamento, valor: faturando.total }],
                  desconto: faturando.desconto,
                });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(`Nota ${r.numeroNota} autorizada em homologação · ${moeda(r.total)}`);
                setFaturando(null);
              }}
            >
              {ocupado ? "Emitindo…" : "Emitir nota"}
            </Button>
          </>
        }
      >
        {faturando && (
          <div className="space-y-3">
            <p className="rounded-lg bg-ink-50 px-3 py-2 text-[12.5px] text-ink-600">
              DAV {faturando.numero} · {faturando.clienteNome} · {faturando.itens.length} item(ns) ·{" "}
              <b className="tabular text-ink-900">{moeda(faturando.total)}</b>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Modelo do documento">
                <Select
                  valor={novoModelo}
                  aoMudar={(v) => setNovoModelo(v as "NFC-e" | "NF-e" | "SAT")}
                  opcoes={[
                    { valor: "NFC-e", rotulo: "NFC-e" },
                    { valor: "NF-e", rotulo: "NF-e" },
                    { valor: "SAT", rotulo: "SAT" },
                  ]}
                />
              </Campo>
              <Campo rotulo="Forma de pagamento">
                <Select valor={novoPagamento} aoMudar={setNovoPagamento} opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} />
              </Campo>
            </div>
            <p className="text-[11.5px] text-ink-400">
              Boleto ou prazo gera automaticamente um título a receber no financeiro com o vencimento da condição do cliente.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        aberto={!!cancelando}
        aoFechar={() => setCancelando(null)}
        titulo="Cancelar documento"
        descricao="O estoque volta e o título financeiro em aberto é removido"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variante="perigo"
              disabled={ocupado}
              onClick={async () => {
                if (!cancelando) return;
                setOcupado(true);
                const r = await cancelarVenda({ vendaId: cancelando.id, motivo });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast("Documento cancelado e estoque restabelecido.");
                setCancelando(null);
              }}
            >
              {ocupado ? "Registrando evento…" : "Confirmar cancelamento"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Campo rotulo="Motivo do evento">
            <Select valor={motivo} aoMudar={setMotivo} opcoes={MOTIVOS.map((m) => ({ valor: m, rotulo: m }))} />
          </Campo>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
            Em produção o cancelamento depende de autorização da SEFAZ e do prazo legal (30 min em NFC-e / 24 h em NF-e). Aqui o evento
            é registrado na contadoria interna do NKWAY.
          </p>
        </div>
      </Modal>
      <Modal
        aberto={Boolean(resumoXmlModal)}
        aoFechar={() => setResumoXmlModal(null)}
        titulo={resumoXmlModal?.titulo ?? "Exportação de XML"}
        descricao="O NKWAY exporta exclusivamente o XML fiscal real armazenado ou disponível na integração — nunca gera XML fictício."
        largura="max-w-lg"
        rodape={
          <Button variante="secundario" onClick={() => setResumoXmlModal(null)}>
            Entendi
          </Button>
        }
      >
        {resumoXmlModal && (
          <div className="space-y-3 text-[12.5px]">
            {resumoXmlModal.exportados > 0 && (
              <div className="rounded-lg bg-way-50 px-3 py-2 text-way-800">
                <b>{resumoXmlModal.exportados} arquivo(s) XML</b> exportado(s) com sucesso
                {resumoXmlModal.modo === "zip" ? " em pacote compactado (.zip)." : "."}
              </div>
            )}
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-amber-900">
              <p className="font-semibold">
                {resumoXmlModal.semXml.length} documento(s) sem XML fiscal disponível:
              </p>
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[11.5px]">
                {resumoXmlModal.semXml.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-2 border-b border-amber-100 pb-1">
                    <b className="shrink-0">{item.rotulo}</b>
                    <span className="text-right text-amber-800">{item.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-400">
              Nota: vendas emitidas em modo de homologação local (sem emissor SEFAZ/Fiscalo conectado via{" "}
              <code className="font-mono">EMISSOR_FISCAL_XML_URL</code>) e DAVs não possuem XML assinado armazenado, a menos que o XML
              autorizado seja retornado pela integração ou vinculado no detalhe do documento.
            </p>
          </div>
        )}
      </Modal>

      <Impressao alvo={imprimindo} aoFechar={() => setImprimindo(null)} />

      {aba === "numeracao" && (
        <NumeracaoView
          inutilizacoes={inutilizacoes}
          documentos={documentosParaNumeracao}
          proximoNumero={proximoNumero}
          serieAtual={serieAtual}
        />
      )}

      {aba !== "numeracao" && corrigindo && (
        <NumeracaoView
          inutilizacoes={inutilizacoes}
          documentos={documentosParaNumeracao}
          proximoNumero={proximoNumero}
          serieAtual={serieAtual}
          abrirCorrecaoDe={corrigindo.id}
          aoFecharCorrecao={() => setCorrigindo(null)}
        />
      )}
    </>
  );
}
