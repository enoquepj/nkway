"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Tabela, type Coluna } from "@/components/Tabela";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Card,
  CardTitulo,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltroTexto,
  Icon,
  Kpi,
  Modal,
  PageHeader,
  useToast,
} from "@/components/ui";
import { dataHoraBR, formatChave, moeda } from "@/lib/dominio";
import {
  ROTULO_PROVEDOR_FISCAL,
  ROTULO_STATUS_SEFAZ,
  type RegraFiscalAchado,
  type StatusSefazVenda,
} from "@/lib/emissorFiscal";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import {
  inspecionarDocumentoFiscal,
  retransmitirFilaContingencia,
  retransmitirVendaSefaz,
} from "@/server/acoes/emissorFiscal";
import type { PainelEmissorFiscalDto, VendaDto } from "@/server/dados";

export function EmissorFiscalView({
  dados,
  usuarioPapel = "administrador",
}: {
  dados: PainelEmissorFiscalDto;
  usuarioPapel?: PerfilUsuario;
}) {
  const toast = useToast();
  const podeEventos = temPermissao(usuarioPapel, "fiscal.eventos");

  const [aba, setAba] = useState<"monitor" | "prontidao">("monitor");
  const [ocupado, setOcupado] = useState(false);

  /* -------------------------------------------- filtros do monitor SEFAZ */
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [statusSel, setStatusSel] = useState<string[]>([]);
  const [modelosSel, setModelosSel] = useState<string[]>([]);

  const linhas = useMemo(
    () =>
      dados.documentos.filter((v) => {
        if (!casaTexto(`${v.clienteNome} ${v.numeroNota ?? v.numero} ${v.chave ?? ""} ${v.cstatSefaz} ${v.motivoSefaz}`, busca))
          return false;
        if ((periodo.inicio || periodo.fim) && !emPeriodo(v.data, periodo)) return false;
        if (statusSel.length && !statusSel.includes(v.statusSefaz)) return false;
        if (modelosSel.length && !modelosSel.includes(v.modelo ?? "NFC-e")) return false;
        return true;
      }),
    [dados.documentos, busca, periodo, statusSel, modelosSel],
  );

  /* ------------------------------- modal de pré-validação e payload 4.00 */
  const [inspecionando, setInspecionando] = useState<{
    venda: VendaDto;
    aprovada: boolean;
    bloqueios: RegraFiscalAchado[];
    alertas: RegraFiscalAchado[];
    payloadJson: string;
  } | null>(null);

  async function abrirInspecao(v: VendaDto) {
    setOcupado(true);
    const r = await inspecionarDocumentoFiscal({ vendaId: v.id });
    setOcupado(false);
    if (!r.ok) {
      toast(r.erro, "erro");
      return;
    }
    setInspecionando({
      venda: v,
      aprovada: r.aprovada,
      bloqueios: r.bloqueios,
      alertas: r.alertas,
      payloadJson: r.payloadJson,
    });
  }

  async function acionarRetransmissao(v: VendaDto) {
    setOcupado(true);
    const r = await retransmitirVendaSefaz({ vendaId: v.id });
    setOcupado(false);
    toast(r.ok ? r.aviso : r.erro, r.ok ? "ok" : "erro");
  }

  async function acionarLoteContingencia() {
    setOcupado(true);
    const r = await retransmitirFilaContingencia({});
    setOcupado(false);
    toast(r.ok ? r.aviso : r.erro, r.ok ? "ok" : "erro");
  }

  const pendenciasFila = dados.resumo.emContingenciaOuPendente + dados.resumo.rejeitadas;

  const colunas: Coluna<VendaDto>[] = [
    {
      id: "doc",
      rotulo: "Nota / Série",
      largura: "155px",
      valor: (v) => v.numeroNota ?? v.numero,
      render: (v) => (
        <div>
          <p className="tabular flex items-center gap-1.5 text-[12.5px] font-bold text-ink-900">
            <span>
              {v.modelo ?? "NFC-e"} {v.numeroNota ?? v.numero}
            </span>
            <span className="font-normal text-ink-400">série {v.serie ?? "1"}</span>
          </p>
          <p className="text-[10.5px] text-ink-400">{dataHoraBR(v.data)}</p>
        </div>
      ),
    },
    {
      id: "cliente",
      rotulo: "Destinatário / Chave",
      valor: (v) => v.clienteNome,
      render: (v) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{v.clienteNome}</p>
          <p className="truncate font-mono text-[10px] text-ink-400" title={formatChave(v.chave)}>
            {v.chave || "sem chave"}
          </p>
        </div>
      ),
    },
    {
      id: "sefaz",
      rotulo: "Retorno SEFAZ / Emissor",
      valor: (v) => `${v.statusSefaz} ${v.cstatSefaz}`,
      render: (v) => {
        const info = ROTULO_STATUS_SEFAZ[v.statusSefaz] ?? ROTULO_STATUS_SEFAZ.simulado;
        return (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tom={info.tom}>{info.rotulo}</Badge>
              <Badge tom="neutro" mono>
                cStat {v.cstatSefaz}
              </Badge>
              {v.temXml && <Badge tom="ok">XML</Badge>}
            </div>
            {v.motivoSefaz && (
              <p className="mt-0.5 truncate text-[10.5px] text-ink-500" title={v.motivoSefaz}>
                {v.motivoSefaz}
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "total",
      rotulo: "Valor",
      alinhar: "direita",
      largura: "110px",
      valor: (v) => v.total,
      render: (v) => <span className="tabular text-[12.5px] font-bold text-ink-900">{moeda(v.total)}</span>,
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      largura: "200px",
      ocultoNoCsv: true,
      render: (v) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button tamanho="sm" variante="secundario" disabled={ocupado} onClick={() => void abrirInspecao(v)}>
            Pré-validar
          </Button>
          {podeEventos && v.status !== "cancelado" && v.statusSefaz !== "autorizada" && (
            <Button
              tamanho="sm"
              variante={v.statusSefaz === "rejeitada" || v.statusSefaz === "contingencia" ? "primario" : "suave"}
              disabled={ocupado}
              onClick={() => void acionarRetransmissao(v)}
            >
              {dados.emissor.modoLive ? "Transmitir" : "Revalidar"}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Emissor SEFAZ de Saída e Contingência"
        subtitulo="Pré-validação NF-e / NFC-e 4.00 (com Reforma Tributária IBS/CBS), monitor de rejeições, fila offline e webhook fiscal"
        etiquetas={
          <>
            <Badge tom={dados.emissor.modoLive ? "ok" : "info"}>
              {ROTULO_PROVEDOR_FISCAL[dados.emissor.provedor]}
            </Badge>
            <Badge tom={dados.ambiente === 1 ? "erro" : "alerta"}>
              {dados.ambiente === 1 ? "Ambiente 1 · Produção" : "Ambiente 2 · Homologação"}
            </Badge>
            <Badge tom={dados.prontidaoProducao.prontoParaProducao ? "ok" : "neutro"}>
              {dados.prontidaoProducao.prontoParaProducao
                ? "Pronto p/ Produção SEFAZ"
                : `${dados.prontidaoProducao.itens.filter((i) => i.ok).length}/${dados.prontidaoProducao.itens.length} itens de prontidão`}
            </Badge>
          </>
        }
        acao={
          <>
            <Link href="/documentos">
              <Button tamanho="sm" variante="secundario" icone="documento">
                Documentos e XML
              </Button>
            </Link>
            {podeEventos && (
              <Button
                icone="atualizar"
                disabled={ocupado || pendenciasFila === 0}
                onClick={() => void acionarLoteContingencia()}
              >
                {ocupado ? "Transmitindo…" : `Retransmitir fila (${pendenciasFila})`}
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Autorizadas na SEFAZ"
          valor={String(dados.resumo.autorizadasSefaz)}
          detalhe={`${dados.resumo.homologacaoLocal} em homologação local`}
          tom="ok"
          icone="check"
        />
        <Kpi
          rotulo="Contingência / Pendentes"
          valor={String(dados.resumo.emContingenciaOuPendente)}
          detalhe="aguardando conexão ou retorno do provedor"
          tom={dados.resumo.emContingenciaOuPendente > 0 ? "roxo" : "neutro"}
          icone="atualizar"
        />
        <Kpi
          rotulo="Rejeitadas SEFAZ"
          valor={String(dados.resumo.rejeitadas)}
          detalhe={dados.resumo.rejeitadas > 0 ? "corrija o cadastro e retransmita" : "zero rejeições pendentes"}
          tom={dados.resumo.rejeitadas > 0 ? "erro" : "ok"}
          icone="alerta"
        />
        <Kpi
          rotulo="XMLs reais armazenados"
          valor={String(dados.resumo.comXmlReal)}
          detalhe="prontos para exportar em /documentos"
          tom="info"
          icone="baixar"
        />
      </div>

      <Abas
        atual={aba}
        aoTrocar={(v) => setAba(v as "monitor" | "prontidao")}
        abas={[
          { id: "monitor", rotulo: "Monitor de Transmissão e Rejeições", contagem: dados.documentos.length },
          {
            id: "prontidao",
            rotulo: "Prontidão para Produção & Configuração do Emissor",
            contagem: dados.prontidaoProducao.itens.filter((i) => !i.ok).length,
          },
        ]}
      />

      {aba === "monitor" && (
        <div className="space-y-3">
          <BarraFiltros>
            <FiltroTexto
              rotulo="Buscar nº, destinatário, chave ou cStat"
              valor={busca}
              aoMudar={setBusca}
              placeholder="Ex.: 778, Rejeição, consumidor..."
              largura="w-64"
            />
            <FiltroPeriodo rotulo="Data de emissão" valor={periodo} aoMudar={setPeriodo} />
            <FiltroMulti
              rotulo="Status SEFAZ"
              selecionados={statusSel}
              aoAlternar={(v) => setStatusSel(alternarItem(statusSel, v))}
              opcoes={(Object.keys(ROTULO_STATUS_SEFAZ) as StatusSefazVenda[]).map((st) => ({
                valor: st,
                rotulo: ROTULO_STATUS_SEFAZ[st].rotulo,
                contagem: dados.documentos.filter((d) => d.statusSefaz === st).length,
              }))}
            />
            <FiltroMulti
              rotulo="Modelo"
              selecionados={modelosSel}
              aoAlternar={(v) => setModelosSel(alternarItem(modelosSel, v))}
              opcoes={[
                { valor: "NFC-e", rotulo: "NFC-e (65)", contagem: dados.documentos.filter((d) => (d.modelo ?? "NFC-e") === "NFC-e").length },
                { valor: "NF-e", rotulo: "NF-e (55)", contagem: dados.documentos.filter((d) => d.modelo === "NF-e").length },
                { valor: "SAT", rotulo: "SAT (59)", contagem: dados.documentos.filter((d) => d.modelo === "SAT").length },
              ]}
            />
            {(busca || periodo.inicio || periodo.fim || statusSel.length > 0 || modelosSel.length > 0) && (
              <Button
                tamanho="sm"
                variante="fantasma"
                onClick={() => {
                  setBusca("");
                  setPeriodo({ inicio: "", fim: "" });
                  setStatusSel([]);
                  setModelosSel([]);
                }}
              >
                Limpar filtros
              </Button>
            )}
          </BarraFiltros>

          {(statusSel.length > 0 || modelosSel.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {statusSel.map((s) => (
                <Chip key={s} onClick={() => setStatusSel(statusSel.filter((x) => x !== s))}>
                  SEFAZ: {ROTULO_STATUS_SEFAZ[s as StatusSefazVenda]?.rotulo ?? s}
                </Chip>
              ))}
              {modelosSel.map((m) => (
                <Chip key={m} onClick={() => setModelosSel(modelosSel.filter((x) => x !== m))}>
                  modelo: {m}
                </Chip>
              ))}
            </div>
          )}

          <Tabela
            colunas={colunas}
            linhas={linhas}
            chave={(v) => v.id}
            nomeExportar="nkway-monitor-sefaz"
            tamanhoPagina={15}
            vazio="Nenhum documento fiscal encontrado para os filtros aplicados."
          />
        </div>
      )}

      {aba === "prontidao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitulo
              titulo="Checklist de Prontidão para Emissão em Produção (Ambiente 1)"
              descricao="Conferência automática dos requisitos obrigatórios da SEFAZ antes de virar a chave"
              icone="check"
              acao={
                <Badge tom={dados.prontidaoProducao.prontoParaProducao ? "ok" : "alerta"}>
                  {dados.prontidaoProducao.prontoParaProducao ? "100% pronto" : "Ajustes pendentes"}
                </Badge>
              }
            />
            <ul className="divide-y divide-ink-50">
              {dados.prontidaoProducao.itens.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-[12.5px]">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={
                        item.ok
                          ? "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-way-50 text-way-700"
                          : "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700"
                      }
                    >
                      <Icon name={item.ok ? "check" : "alerta"} className="size-3.5" strokeWidth={2.5} />
                    </span>
                    <div>
                      <p className="font-semibold text-ink-900">{item.rotulo}</p>
                      <p className="text-[11.5px] text-ink-400">{item.detalhe}</p>
                    </div>
                  </div>
                  <Badge tom={item.ok ? "ok" : "alerta"}>{item.ok ? "OK" : "Pendente"}</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
              <Link href="/config">
                <Button tamanho="sm" variante="secundario">
                  Ajustar Empresa / CSC →
                </Button>
              </Link>
              <Link href="/dfe">
                <Button tamanho="sm" variante="secundario">
                  Certificado A1 (.pfx) →
                </Button>
              </Link>
              <Link href="/produtos">
                <Button tamanho="sm" variante="secundario">
                  Revisar NCMs dos Produtos →
                </Button>
              </Link>
            </div>
          </Card>

          <Card>
            <CardTitulo
              titulo="Adaptador de Provedor Fiscal REST & Webhook"
              descricao="Nenhum segredo é exibido na interface — conexão 100% server-side no Vercel"
              icone="cadeado"
            />
            <div className="space-y-2 text-[12.5px]">
              <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                <div>
                  <p className="font-semibold text-ink-800">Provedor detectado (`EMISSOR_FISCAL_PROVIDER`)</p>
                  <p className="text-[11px] text-ink-400">Suporta `focusnfe`, `nuvemfiscal` ou `webhook_custom`</p>
                </div>
                <Badge tom={dados.emissor.modoLive ? "ok" : "info"}>
                  {ROTULO_PROVEDOR_FISCAL[dados.emissor.provedor]}
                </Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                <div>
                  <p className="font-semibold text-ink-800">Endpoint de emissão (`EMISSOR_FISCAL_URL`)</p>
                  <p className="text-[11px] text-ink-400">Envia payload NF-e/NFC-e 4.00 com timeout e contingência automática</p>
                </div>
                <Badge tom={dados.emissor.urlConfigurada ? "ok" : "neutro"}>
                  {dados.emissor.urlConfigurada ? "configurada" : "modo local"}
                </Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                <div>
                  <p className="font-semibold text-ink-800">Credencial secreta (`EMISSOR_FISCAL_TOKEN`)</p>
                  <p className="text-[11px] text-ink-400">Basic Auth (Focus NFe) ou Bearer Token</p>
                </div>
                <Badge tom={dados.emissor.tokenConfigurado ? "ok" : "neutro"}>
                  {dados.emissor.tokenConfigurado ? "configurado" : "não definido"}
                </Badge>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2">
                <div>
                  <p className="font-semibold text-ink-800">Webhook de retorno (`POST /api/fiscal/webhook`)</p>
                  <p className="text-[11px] text-ink-400">Grava chave, protocolo, `cStat` e o XML autorizado real em `nk_venda`</p>
                </div>
                <Badge tom={dados.emissor.webhookProtegido ? "ok" : "alerta"}>
                  {dados.emissor.webhookProtegido ? "HMAC / token ativo" : "sem segredo"}
                </Badge>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Modal: Inspeção de Pré-Validação SEFAZ e Payload 4.00 */}
      <Modal
        aberto={Boolean(inspecionando)}
        aoFechar={() => setInspecionando(null)}
        titulo={
          inspecionando
            ? `Inspeção Fiscal 4.00 · ${inspecionando.venda.modelo ?? "NFC-e"} ${inspecionando.venda.numeroNota ?? inspecionando.venda.numero}`
            : "Inspeção Fiscal"
        }
        descricao="Diagnóstico preventivo contra rejeições da SEFAZ e payload canônico de transmissão"
        largura="max-w-3xl"
        rodape={
          inspecionando && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {podeEventos && inspecionando.venda.status !== "cancelado" && (
                  <Button
                    variante="suave"
                    icone="atualizar"
                    disabled={ocupado}
                    onClick={async () => {
                      await acionarRetransmissao(inspecionando.venda);
                      setInspecionando(null);
                    }}
                  >
                    {dados.emissor.modoLive ? "Transmitir ao Emissor Agora" : "Revalidar e Atualizar Status"}
                  </Button>
                )}
              </div>
              <Button variante="secundario" onClick={() => setInspecionando(null)}>
                Fechar
              </Button>
            </div>
          )
        }
      >
        {inspecionando && (
          <div className="space-y-3.5 text-[12.5px]">
            <div className="flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5">
              <span className="font-semibold text-ink-800">Resultado da Pré-Validação SEFAZ 4.00</span>
              <Badge tom={inspecionando.aprovada ? "ok" : "erro"}>
                {inspecionando.aprovada
                  ? `Aprovada (${inspecionando.alertas.length} alerta(s))`
                  : `${inspecionando.bloqueios.length} rejeição(ões) impeditiva(s)`}
              </Badge>
            </div>

            {inspecionando.bloqueios.length > 0 && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-rose-900">
                <p className="font-bold">Rejeições impeditivas detectadas:</p>
                <ul className="mt-1.5 space-y-1 text-[11.5px]">
                  {inspecionando.bloqueios.map((b, idx) => (
                    <li key={idx}>
                      <b className="font-mono">cStat {b.codigoSefaz} [{b.campo}]:</b> {b.mensagem}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {inspecionando.alertas.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-amber-900">
                <p className="font-bold">Alertas preventivos para Ambiente 1 (Produção):</p>
                <ul className="mt-1.5 space-y-1 text-[11.5px]">
                  {inspecionando.alertas.map((a, idx) => (
                    <li key={idx}>
                      <b className="font-mono">cStat {a.codigoSefaz} [{a.campo}]:</b> {a.mensagem}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <span className="micro mb-1 block text-ink-400">
                Payload Canônico NF-e / NFC-e 4.00 (inclui IBS/CBS LC 214/2025 e tPag SEFAZ)
              </span>
              <pre className="max-h-80 overflow-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[11px] leading-relaxed text-ink-100">
                {inspecionando.payloadJson}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
