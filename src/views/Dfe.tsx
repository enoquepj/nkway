"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Abas,
  Area,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  CardTitulo,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltrosSalvos,
  FiltroTexto,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import {
  MANIFESTOS_DFE,
  ROTULO_MANIFESTO,
  rotuloSchemaDfe,
  type DfeDocumento,
  type DfePainelDados,
  type StatusManifesto,
} from "@/lib/dfe";
import { dataBR, dataHoraBR, formatChave, mascaraDocumento, moeda, round2, soDigitos } from "@/lib/dominio";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import {
  capturarDfeAgora,
  configurarAutomacaoDfe,
  importarDfeParaEntrada,
  manifestarDocumentoDfe,
  removerCertificadoA1,
  salvarCertificadoA1,
} from "@/server/acoes/dfe";

function arquivoParaBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result ?? "");
      const idx = res.indexOf(",");
      resolve(idx >= 0 ? res.slice(idx + 1) : res);
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo .pfx no navegador."));
    reader.readAsDataURL(file);
  });
}

function baixarXmlArquivo(nome: string, conteudo: string) {
  const blob = new Blob([conteudo], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

export function DfeView({ dados }: { dados: DfePainelDados }) {
  const toast = useToast();
  const [aba, setAba] = useState("notas");
  const [ocupado, setOcupado] = useState(false);

  /* --------------------------------------------------- filtros de notas */
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [tiposSchema, setTiposSchema] = useState<string[]>([]);
  const [manifestos, setManifestos] = useState<string[]>([]);
  const [situacaoErp, setSituacaoErp] = useState<string[]>([]);

  const filtroAtual = {
    busca,
    inicio: periodo.inicio,
    fim: periodo.fim,
    tiposSchema,
    manifestos,
    situacaoErp,
  };
  type FiltroDfe = typeof filtroAtual;

  const aplicarFiltro = (f: FiltroDfe) => {
    setBusca(f.busca ?? "");
    setPeriodo({ inicio: f.inicio ?? "", fim: f.fim ?? "" });
    setTiposSchema(f.tiposSchema ?? []);
    setManifestos(f.manifestos ?? []);
    setSituacaoErp(f.situacaoErp ?? []);
  };

  const limparFiltros = () =>
    aplicarFiltro({
      busca: "",
      inicio: "",
      fim: "",
      tiposSchema: [],
      manifestos: [],
      situacaoErp: [],
    });

  const linhas = useMemo(() => {
    const qDigitos = soDigitos(busca);
    return dados.documentos.filter((d) => {
      if (busca.trim()) {
        const textoAlvo = `${d.emitenteNome} ${d.emitenteCnpj} ${mascaraDocumento(d.emitenteCnpj)} ${d.chave} ${d.numero} ${d.nsu}`;
        const bateTexto = casaTexto(textoAlvo, busca);
        const bateDigitos = qDigitos.length >= 4 && `${d.emitenteCnpj} ${d.chave} ${d.nsu}`.includes(qDigitos);
        if (!bateTexto && !bateDigitos) return false;
      }
      if ((periodo.inicio || periodo.fim) && !emPeriodo(d.dataEmissao, periodo)) return false;
      if (tiposSchema.length) {
        const tipo = d.temXmlCompleto ? "completo" : "resumo";
        if (!tiposSchema.includes(tipo)) return false;
      }
      if (manifestos.length && !manifestos.includes(d.statusManifesto)) return false;
      if (situacaoErp.length) {
        const st = d.importadoErp ? "importada" : "pendente";
        if (!situacaoErp.includes(st)) return false;
      }
      return true;
    });
  }, [dados.documentos, busca, periodo, tiposSchema, manifestos, situacaoErp]);

  /* --------------------------------------------------- modais de ação */
  const [modalChave, setModalChave] = useState(false);
  const [chaveConsulta, setChaveConsulta] = useState("");

  const [docManifestar, setDocManifestar] = useState<DfeDocumento | null>(null);
  const [tipoManifesto, setTipoManifesto] = useState<Exclude<StatusManifesto, "pendente" | "resumo">>("ciencia");
  const [justificativa, setJustificativa] = useState("");

  const [docXml, setDocXml] = useState<DfeDocumento | null>(null);

  /* ------------------------------------------- formulário Certificado A1 */
  const [arquivoPfx, setArquivoPfx] = useState<File | null>(null);
  const [senhaPfx, setSenhaPfx] = useState("");
  const [titularPfx, setTitularPfx] = useState(dados.certificadoNome);
  const [validadePfx, setValidadePfx] = useState(dados.certificadoValidade);
  const [serialPfx, setSerialPfx] = useState(dados.certificadoSerial);
  const [ambienteSel, setAmbienteSel] = useState<1 | 2>(dados.ambiente);

  /* --------------------------------------------------------------- KPIs */
  const somaCapturadas = round2(dados.documentos.reduce((s, d) => s + d.valorTotal, 0));
  const prontasImportar = dados.documentos.filter((d) => d.temXmlCompleto && !d.importadoErp).length;
  const aguardandoCiencia = dados.documentos.filter((d) => !d.temXmlCompleto).length;
  const certVencido = Boolean(dados.certificadoValidade && new Date(`${dados.certificadoValidade}T23:59:59`) < new Date());

  const dispararCaptura = async (chave?: string) => {
    setOcupado(true);
    const r = await capturarDfeAgora(chave ? { chave } : {});
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Consulta concluída.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok && chave) {
      setModalChave(false);
      setChaveConsulta("");
    }
  };

  const importarNota = async (doc: DfeDocumento) => {
    setOcupado(true);
    const r = await importarDfeParaEntrada({ id: doc.id, gerarFinanceiro: true });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "NF-e enviada para Entrada de mercadoria.") : r.erro, r.ok ? "ok" : "erro");
  };

  const cienciaRapida = async (doc: DfeDocumento) => {
    setOcupado(true);
    const r = await manifestarDocumentoDfe({ id: doc.id, manifesto: "ciencia" });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Ciência da operação registrada.") : r.erro, r.ok ? "ok" : "erro");
  };

  const confirmarManifestoModal = async () => {
    if (!docManifestar) return;
    setOcupado(true);
    const r = await manifestarDocumentoDfe({
      id: docManifestar.id,
      manifesto: tipoManifesto,
      justificativa,
    });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Manifestação registrada.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) {
      setDocManifestar(null);
      setJustificativa("");
    }
  };

  const enviarCertificado = async () => {
    if (!arquivoPfx) {
      toast("Selecione o arquivo .pfx ou .p12 do Certificado A1.", "erro");
      return;
    }
    if (!senhaPfx) {
      toast("Informe a senha do Certificado A1.", "erro");
      return;
    }
    setOcupado(true);
    try {
      const pfxBase64 = await arquivoParaBase64(arquivoPfx);
      const r = await salvarCertificadoA1({
        pfxBase64,
        nomeArquivo: arquivoPfx.name,
        senha: senhaPfx,
        titular: titularPfx,
        validade: validadePfx,
        serial: serialPfx,
        ambiente: ambienteSel,
      });
      toast(r.ok ? (r.aviso ?? "Certificado A1 salvo.") : r.erro, r.ok ? "ok" : "erro");
      if (r.ok) {
        setSenhaPfx("");
        setArquivoPfx(null);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro ao processar o arquivo .pfx.", "erro");
    } finally {
      setOcupado(false);
    }
  };

  const colunas: Coluna<DfeDocumento>[] = [
    {
      id: "nsu",
      rotulo: "Emissão / NSU",
      valor: (d) => `${d.dataEmissao}-${d.nsu}`,
      largura: "136px",
      render: (d) => (
        <div>
          <span className="block text-[12px] font-semibold text-ink-800">{dataBR(d.dataEmissao)}</span>
          <span className="block font-mono text-[10px] text-ink-400">NSU {d.nsu}</span>
        </div>
      ),
    },
    {
      id: "emitente",
      rotulo: "Fornecedor emitente",
      valor: (d) => d.emitenteNome,
      render: (d) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{d.emitenteNome}</p>
          <p className="font-mono text-[10.5px] text-ink-400">{mascaraDocumento(d.emitenteCnpj) || "—"}</p>
        </div>
      ),
    },
    {
      id: "chave",
      rotulo: "NF-e / Chave de acesso",
      valor: (d) => d.chave,
      render: (d) => (
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink-700">
            NF-e {d.numero} <span className="font-normal text-ink-400">· série {d.serie}</span>
          </p>
          <p className="truncate font-mono text-[10px] text-ink-400" title={formatChave(d.chave)}>
            {d.chave || "—"}
          </p>
        </div>
      ),
    },
    {
      id: "schema",
      rotulo: "Documento",
      valor: (d) => d.schema,
      largura: "126px",
      render: (d) => {
        const info = rotuloSchemaDfe(d.schema);
        return <Badge tom={d.temXmlCompleto ? "ok" : "roxo"}>{info.rotulo}</Badge>;
      },
    },
    {
      id: "manifesto",
      rotulo: "Manifestação",
      valor: (d) => d.statusManifesto,
      largura: "148px",
      render: (d) => {
        const m = ROTULO_MANIFESTO[d.statusManifesto] ?? ROTULO_MANIFESTO.pendente;
        return <Badge tom={m.tom}>{m.rotulo}</Badge>;
      },
    },
    {
      id: "valor",
      rotulo: "Valor NF-e",
      alinhar: "direita",
      largura: "118px",
      valor: (d) => d.valorTotal,
      render: (d) => <span className="tabular text-[12.5px] font-bold text-ink-900">{moeda(d.valorTotal)}</span>,
    },
    {
      id: "erp",
      rotulo: "Entrada ERP",
      largura: "126px",
      valor: (d) => (d.importadoErp ? "Importada" : "Não importada"),
      render: (d) =>
        d.importadoErp ? (
          <Link href="/entradas" className="inline-flex items-center gap-1 hover:opacity-85">
            <Badge tom="ok">Em Entradas →</Badge>
          </Link>
        ) : (
          <Badge tom="neutro">Não importada</Badge>
        ),
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (d) => (
        <div className="flex items-center justify-end gap-1">
          {d.temXmlCompleto && !d.importadoErp && (
            <Button tamanho="sm" variante="suave" icone="entrada" disabled={ocupado} onClick={() => importarNota(d)}>
              Importar
            </Button>
          )}
          {!d.temXmlCompleto && (
            <Button tamanho="sm" variante="suave" icone="check" disabled={ocupado} onClick={() => cienciaRapida(d)}>
              Dar ciência
            </Button>
          )}
          <Button
            tamanho="sm"
            variante="secundario"
            disabled={ocupado}
            onClick={() => {
              setDocManifestar(d);
              setTipoManifesto(d.statusManifesto === "confirmada" ? "confirmada" : "ciencia");
              setJustificativa(d.justificativaManifesto ?? "");
            }}
          >
            Manifestar
          </Button>
          <Button
            tamanho="sm"
            variante="fantasma"
            icone="baixar"
            title="Ver ou baixar XML bruto"
            disabled={!d.xml}
            onClick={() => setDocXml(d)}
          >
            XML
          </Button>
        </div>
      ),
    },
  ];

  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...(periodo.inicio || periodo.fim
      ? [
          {
            r: `emissão ${periodo.inicio ? dataBR(periodo.inicio) : "…"} → ${periodo.fim ? dataBR(periodo.fim) : "…"}`,
            limpar: () => setPeriodo({ inicio: "", fim: "" }),
          },
        ]
      : []),
    ...tiposSchema.map((t) => ({
      r: `tipo: ${t === "completo" ? "NF-e completa" : "Resumo"}`,
      limpar: () => setTiposSchema(tiposSchema.filter((x) => x !== t)),
    })),
    ...manifestos.map((m) => ({
      r: `manifesto: ${ROTULO_MANIFESTO[m as StatusManifesto]?.rotulo ?? m}`,
      limpar: () => setManifestos(manifestos.filter((x) => x !== m)),
    })),
    ...situacaoErp.map((s) => ({
      r: `ERP: ${s === "importada" ? "Em Entradas" : "Não importada"}`,
      limpar: () => setSituacaoErp(situacaoErp.filter((x) => x !== s)),
    })),
  ];

  const manifestoEscolhido = MANIFESTOS_DFE.find((m) => m.id === tipoManifesto);

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="DF-e · NF-e recebidas e Certificado A1"
        subtitulo="Distribuição Nacional SEFAZ (NfeDistDFeInteresse) · manifestação do destinatário e importação para Entrada"
        etiquetas={
          <>
            <Badge tom={dados.modoEfetivo === "live" ? "ok" : "info"}>
              {dados.modoEfetivo === "live" ? "LIVE · Worker mTLS" : "DEMO · Simulador SEFAZ"}
            </Badge>
            <Badge tom={dados.ambiente === 1 ? "ok" : "alerta"}>
              {dados.ambiente === 1 ? "1 · Produção" : "2 · Homologação"}
            </Badge>
            <Badge tom={dados.temCertificado ? (certVencido ? "erro" : "ok") : "neutro"}>
              {dados.temCertificado
                ? certVencido
                  ? "A1 vencido"
                  : `A1 ativo (${dados.armazenamentoCert === "bucket" ? "bucket certificados-a1" : "cofre AES-256"})`
                : "Sem .pfx enviado"}
            </Badge>
            <Badge tom="neutro" mono>
              CNPJ {dados.empresaCnpj}
            </Badge>
          </>
        }
        acao={
          <>
            <Link href="/entradas">
              <Button variante="secundario" tamanho="sm" icone="entrada">
                Ir p/ Entradas
              </Button>
            </Link>
            <Button variante="secundario" tamanho="sm" icone="busca" disabled={ocupado} onClick={() => setModalChave(true)}>
              Consultar chave
            </Button>
            <Button icone="atualizar" disabled={ocupado} onClick={() => dispararCaptura()}>
              {ocupado ? "Consultando SEFAZ…" : "Capturar na SEFAZ agora"}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Documentos capturados"
          valor={String(dados.documentos.length)}
          detalhe={`soma ${moeda(somaCapturadas)}`}
          tom="info"
          icone="documento"
        />
        <Kpi
          rotulo="Prontas para Entrada"
          valor={String(prontasImportar)}
          detalhe="XML completo (procNFe) não importado"
          tom={prontasImportar > 0 ? "ok" : "neutro"}
          icone="entrada"
        />
        <Kpi
          rotulo="Aguardando ciência"
          valor={String(aguardandoCiencia)}
          detalhe="resumos (resNFe) emitidos contra o CNPJ"
          tom={aguardandoCiencia > 0 ? "roxo" : "neutro"}
          icone="alerta"
        />
        <Kpi
          rotulo="Último NSU processado"
          valor={dados.ultimoNsu}
          detalhe={`máx ${dados.maxNsu}${dados.ultimoCstat ? ` · cStat ${dados.ultimoCstat}` : ""}`}
          tom="neutro"
          icone="atualizar"
        />
      </div>

      <Abas
        atual={aba}
        aoTrocar={setAba}
        abas={[
          { id: "notas", rotulo: "NF-e recebidas (DF-e)", contagem: dados.documentos.length },
          { id: "certificado", rotulo: "Certificado A1 e Worker mTLS" },
        ]}
      />

      {aba === "notas" && (
        <div className="space-y-3">
          <BarraFiltros>
            <FiltroTexto
              rotulo="Buscar emitente, CNPJ, chave ou NSU"
              valor={busca}
              aoMudar={setBusca}
              placeholder="Fornecedor, CNPJ ou 44 dígitos…"
              largura="w-64"
            />
            <FiltroPeriodo rotulo="Emissão" valor={periodo} aoMudar={setPeriodo} />
            <FiltroMulti
              rotulo="Documento"
              selecionados={tiposSchema}
              aoAlternar={(v) => setTiposSchema(alternarItem(tiposSchema, v))}
              opcoes={[
                { valor: "completo", rotulo: "NF-e completa (procNFe)", contagem: dados.documentos.filter((d) => d.temXmlCompleto).length },
                { valor: "resumo", rotulo: "Resumo (resNFe)", contagem: dados.documentos.filter((d) => !d.temXmlCompleto).length },
              ]}
            />
            <FiltroMulti
              rotulo="Manifestação"
              selecionados={manifestos}
              aoAlternar={(v) => setManifestos(alternarItem(manifestos, v))}
              opcoes={(Object.keys(ROTULO_MANIFESTO) as StatusManifesto[]).map((k) => ({
                valor: k,
                rotulo: ROTULO_MANIFESTO[k].rotulo,
                contagem: dados.documentos.filter((d) => d.statusManifesto === k).length,
              }))}
            />
            <FiltroMulti
              rotulo="Vínculo ERP"
              selecionados={situacaoErp}
              aoAlternar={(v) => setSituacaoErp(alternarItem(situacaoErp, v))}
              opcoes={[
                { valor: "pendente", rotulo: "Não importada", contagem: dados.documentos.filter((d) => !d.importadoErp).length },
                { valor: "importada", rotulo: "Já em Entradas", contagem: dados.documentos.filter((d) => d.importadoErp).length },
              ]}
            />
            {chips.length > 0 && (
              <Button tamanho="sm" variante="fantasma" onClick={limparFiltros}>
                Limpar
              </Button>
            )}
          </BarraFiltros>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <FiltrosSalvos chave="dfe" atual={filtroAtual} aoAplicar={aplicarFiltro} />
            {dados.ultimaConsultaEm && (
              <p className="text-[11.5px] text-ink-400">
                Última sincronização: <b className="text-ink-600">{dataHoraBR(dados.ultimaConsultaEm)}</b>
                {dados.ultimoXmotivo ? ` · ${dados.ultimoXmotivo}` : ""}
              </p>
            )}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c.r} onClick={c.limpar}>
                  {c.r}
                </Chip>
              ))}
            </div>
          )}

          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(d) => d.id}
            nomeExportar="dfe-notas-recebidas"
            vazio="Nenhuma NF-e capturada com os filtros atuais. Clique em 'Capturar na SEFAZ agora' no topo para consultar novos documentos."
          />
        </div>
      )}

      {aba === "certificado" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitulo
              titulo="Certificado Digital A1 (.pfx / .p12)"
              descricao="Validação criptográfica server-side · a senha nunca é exposta nem salva em texto puro"
              icone="cadeado"
              acao={
                <Badge tom={dados.temCertificado ? (certVencido ? "erro" : "ok") : "neutro"}>
                  {dados.temCertificado ? (certVencido ? "Vencido" : "Configurado") : "Pendente"}
                </Badge>
              }
            />

            {dados.temCertificado && (
              <div className="mb-4 rounded-xl border border-way-200 bg-way-50/50 p-3 text-[12px] text-ink-700">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink-900">{dados.certificadoNome || "Certificado A1 ativo"}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-500">
                      CNPJ: {mascaraDocumento(dados.certificadoCnpj || dados.empresaCnpj)}
                      {dados.certificadoSerial ? ` · Série: ${dados.certificadoSerial}` : ""}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      Armazenamento:{" "}
                      <b>
                        {dados.armazenamentoCert === "bucket"
                          ? "Bucket privado certificados-a1"
                          : "Cofre criptografado AES-256-GCM"}
                      </b>
                      {dados.certificadoValidade ? ` · Validade: ${dataBR(dados.certificadoValidade)}` : ""}
                    </p>
                  </div>
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    icone="lixo"
                    disabled={ocupado}
                    onClick={async () => {
                      setOcupado(true);
                      const r = await removerCertificadoA1({});
                      setOcupado(false);
                      toast(r.ok ? (r.aviso ?? "Certificado removido.") : r.erro, r.ok ? "ok" : "erro");
                    }}
                  >
                    Remover .pfx
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <Campo rotulo="Arquivo do certificado (.pfx ou .p12)" obrigatorio>
                <input
                  type="file"
                  accept=".pfx,.p12,application/x-pkcs12"
                  onChange={(e) => setArquivoPfx(e.target.files?.[0] ?? null)}
                  className="block w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-600 file:mr-3 file:rounded-md file:border-0 file:bg-way-50 file:px-2.5 file:py-1 file:text-[12px] file:font-semibold file:text-way-700 hover:file:bg-way-100"
                />
                {arquivoPfx && (
                  <span className="mt-1 block text-[11px] text-ink-400">
                    {arquivoPfx.name} · {(arquivoPfx.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </Campo>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Senha do certificado A1" obrigatorio>
                  <Input
                    type="password"
                    valor={senhaPfx}
                    aoMudar={setSenhaPfx}
                    placeholder="Senha definida na emissão"
                  />
                </Campo>
                <Campo rotulo="Ambiente SEFAZ">
                  <div className="flex rounded-lg bg-ink-50 p-0.5">
                    {[
                      { v: 2 as const, r: "2 · Homologação" },
                      { v: 1 as const, r: "1 · Produção" },
                    ].map((x) => (
                      <button
                        key={x.v}
                        type="button"
                        onClick={() => setAmbienteSel(x.v)}
                        className={cn(
                          "flex-1 rounded px-2 py-1.5 text-[12px] font-semibold transition",
                          ambienteSel === x.v ? "bg-white text-ink-900 shadow-sm" : "text-ink-400",
                        )}
                      >
                        {x.r}
                      </button>
                    ))}
                  </div>
                </Campo>
              </div>

              <Campo rotulo="Titular / identificação (opcional — extraído automaticamente quando presente)">
                <Input
                  valor={titularPfx}
                  aoMudar={setTitularPfx}
                  placeholder={`${dados.empresaNome} (A1)`}
                />
              </Campo>

              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Validade do A1">
                  <Input type="date" valor={validadePfx} aoMudar={setValidadePfx} />
                </Campo>
                <Campo rotulo="Número de série (opcional)">
                  <Input valor={serialPfx} aoMudar={setSerialPfx} className="font-mono" placeholder="Ex.: 4F8A9C12" />
                </Campo>
              </div>

              <div className="flex items-center justify-end pt-1">
                <Button icone="cadeado" disabled={ocupado} onClick={enviarCertificado}>
                  {ocupado ? "Validando .pfx…" : dados.temCertificado ? "Substituir Certificado A1" : "Validar e salvar Certificado A1"}
                </Button>
              </div>
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardTitulo
                titulo="Arquitetura SEFAZ · Worker mTLS e Bucket"
                descricao="Diagnóstico das variáveis do servidor (nenhum segredo é exibido)"
                icone="engrenagem"
              />
              <div className="space-y-2 text-[12.5px]">
                <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                  <div>
                    <p className="font-semibold text-ink-800">Modo de operação (`DFE_SEFAZ_MODE`)</p>
                    <p className="text-[11px] text-ink-400">Em `demo` simula lotes `docZip` sem consumir a SEFAZ</p>
                  </div>
                  <Badge tom={dados.modoEfetivo === "live" ? "ok" : "info"}>
                    {dados.modoEfetivo === "live" ? "live (SEFAZ real)" : "demo (seguro)"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                  <div>
                    <p className="font-semibold text-ink-800">Worker mTLS (`DFE_MTLS_WORKER_URL`)</p>
                    <p className="text-[11px] text-ink-400">`supabase/functions/dfe-dist/sefaz-mtls-worker.mjs`</p>
                  </div>
                  <Badge tom={dados.workerConfigurado ? "ok" : "neutro"}>
                    {dados.workerConfigurado ? "conectado" : "não definido"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                  <div>
                    <p className="font-semibold text-ink-800">Bucket privado `certificados-a1`</p>
                    <p className="text-[11px] text-ink-400">Fallback automático para cofre AES-256-GCM</p>
                  </div>
                  <Badge tom={dados.bucketConfigurado ? "ok" : "info"}>
                    {dados.bucketConfigurado ? "bucket externo ativo" : "cofre AES-256 ativo"}
                  </Badge>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                  <div>
                    <p className="font-semibold text-ink-800">Agendamento 10 min (`/api/dfe/dist`)</p>
                    <p className="text-[11px] text-ink-400">Protegido por `DFE_CRON_SECRET` / `CRON_SECRET`</p>
                  </div>
                  <Badge tom={dados.cronSecretConfigurado ? "ok" : "alerta"}>
                    {dados.cronSecretConfigurado ? "segredo ativo" : "bloqueado s/ segredo"}
                  </Badge>
                </div>
              </div>
            </Card>

            <Card>
              <CardTitulo
                titulo="Controle de NSU e Automação"
                descricao="Evita bloqueio cStat 656 (Consumo Indevido) mantendo o ponteiro sequencial"
                icone="atualizar"
                acao={
                  <Badge tom={dados.ativo ? "ok" : "neutro"}>
                    {dados.ativo ? "Captura automática ativa" : "Pausada"}
                  </Badge>
                }
              />
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-ink-50/70 p-3 font-mono text-[12px]">
                <div>
                  <span className="micro block font-sans text-ink-400">Último NSU</span>
                  <b className="text-ink-900">{dados.ultimoNsu}</b>
                </div>
                <div>
                  <span className="micro block font-sans text-ink-400">Máximo NSU</span>
                  <b className="text-ink-900">{dados.maxNsu}</b>
                </div>
                <div className="col-span-2 font-sans text-[11.5px] text-ink-500">
                  Último retorno:{" "}
                  <b className="text-ink-800">
                    {dados.ultimoCstat ? `cStat ${dados.ultimoCstat} — ${dados.ultimoXmotivo}` : "Nenhuma consulta realizada ainda"}
                  </b>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button
                  tamanho="sm"
                  variante="secundario"
                  disabled={ocupado}
                  onClick={async () => {
                    setOcupado(true);
                    const r = await configurarAutomacaoDfe({ ativo: !dados.ativo });
                    setOcupado(false);
                    toast(r.ok ? (r.aviso ?? "Atualizado.") : r.erro, r.ok ? "ok" : "erro");
                  }}
                >
                  {dados.ativo ? "Pausar captura automática" : "Ativar captura automática"}
                </Button>

                <Button
                  tamanho="sm"
                  variante="fantasma"
                  disabled={ocupado || dados.ultimoNsu === "000000000000000"}
                  onClick={async () => {
                    setOcupado(true);
                    const r = await configurarAutomacaoDfe({ reiniciarNsu: true });
                    setOcupado(false);
                    toast(r.ok ? (r.aviso ?? "NSU reiniciado.") : r.erro, r.ok ? "ok" : "erro");
                  }}
                >
                  Reiniciar NSU (000…000)
                </Button>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Modal: Consulta pontual por chave de 44 dígitos */}
      <Modal
        aberto={modalChave}
        aoFechar={() => setModalChave(false)}
        titulo="Consultar NF-e por chave no Ambiente Nacional"
        descricao="Envia consChNFe (44 dígitos com validação de dígito verificador) via NfeDistDFeInteresse"
        largura="max-w-lg"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setModalChave(false)}>
              Cancelar
            </Button>
            <Button
              icone="busca"
              disabled={ocupado || soDigitos(chaveConsulta).length !== 44}
              onClick={() => dispararCaptura(chaveConsulta)}
            >
              {ocupado ? "Consultando…" : "Consultar chave"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo rotulo="Chave de acesso da NF-e (44 dígitos)" obrigatorio>
            <Input
              valor={chaveConsulta}
              aoMudar={setChaveConsulta}
              className="font-mono"
              placeholder="0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000"
            />
          </Campo>
          <p className="text-[11.5px] text-ink-400">
            Dígitos informados: <b className="font-mono text-ink-700">{soDigitos(chaveConsulta).length}/44</b>. A nota deve ter sido
            emitida contra o CNPJ {dados.empresaCnpj}.
          </p>
        </div>
      </Modal>

      {/* Modal: Manifestação do Destinatário */}
      <Modal
        aberto={Boolean(docManifestar)}
        aoFechar={() => setDocManifestar(null)}
        titulo="Manifestação do Destinatário (NT 2020.001)"
        descricao={docManifestar ? `${docManifestar.emitenteNome} · NF-e ${docManifestar.numero}` : ""}
        largura="max-w-lg"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setDocManifestar(null)}>
              Cancelar
            </Button>
            <Button icone="check" disabled={ocupado} onClick={confirmarManifestoModal}>
              {ocupado ? "Registrando…" : "Registrar evento"}
            </Button>
          </div>
        }
      >
        {docManifestar && (
          <div className="space-y-3">
            <div className="rounded-lg bg-ink-50 p-2.5 font-mono text-[11px] text-ink-600">
              Chave: {formatChave(docManifestar.chave)}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {MANIFESTOS_DFE.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTipoManifesto(m.id)}
                  className={cn(
                    "rounded-xl border p-2.5 text-left transition",
                    tipoManifesto === m.id
                      ? "border-way-400 bg-way-50/70 ring-1 ring-way-200"
                      : "border-ink-100 bg-white hover:bg-ink-50",
                  )}
                >
                  <p className="text-[12.5px] font-bold text-ink-900">{m.rotulo}</p>
                  <p className="font-mono text-[10.5px] text-ink-400">Evento {m.tpEvento}</p>
                </button>
              ))}
            </div>
            {manifestoEscolhido?.exigeJustificativa && (
              <Area
                rotulo="Justificativa obrigatória (15 a 255 caracteres)"
                valor={justificativa}
                aoMudar={setJustificativa}
                placeholder="Descreva o motivo do desconhecimento ou por que a operação não foi realizada…"
              />
            )}
            {!docManifestar.temXmlCompleto && (tipoManifesto === "ciencia" || tipoManifesto === "confirmada") && (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-[11.5px] text-sky-800">
                Ao registrar Ciência da Operação (210210), a SEFAZ libera o download do XML completo (`procNFe`) para importação em
                Entrada de mercadoria.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: Visualizar / Baixar XML Bruto */}
      <Modal
        aberto={Boolean(docXml)}
        aoFechar={() => setDocXml(null)}
        titulo={docXml ? `XML bruto · NF-e ${docXml.numero} (NSU ${docXml.nsu})` : "XML"}
        descricao={docXml ? formatChave(docXml.chave) : ""}
        largura="max-w-3xl"
        rodape={
          docXml && (
            <div className="flex justify-between gap-2">
              <div>
                {docXml.temXmlCompleto && !docXml.importadoErp && (
                  <Button
                    variante="suave"
                    icone="entrada"
                    disabled={ocupado}
                    onClick={async () => {
                      await importarNota(docXml);
                      setDocXml(null);
                    }}
                  >
                    Importar em Entrada de mercadoria
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variante="secundario" onClick={() => setDocXml(null)}>
                  Fechar
                </Button>
                <Button
                  icone="baixar"
                  onClick={() => baixarXmlArquivo(docXml.chave || `nfe-${docXml.nsu}`, docXml.xml ?? "")}
                >
                  Baixar .xml
                </Button>
              </div>
            </div>
          )
        }
      >
        {docXml && (
          <pre className="max-h-96 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[11px] leading-relaxed text-ink-100">
            {docXml.xml || "XML indisponível."}
          </pre>
        )}
      </Modal>
    </div>
  );
}
