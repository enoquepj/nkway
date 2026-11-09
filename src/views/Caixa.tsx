"use client";

import { useMemo, useState } from "react";
import { LinkPdv } from "@/components/LinkPdv";
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
  FiltroTexto,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  Vazio,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { FORMAS_PAGAMENTO, dataHoraBR, moeda, round2, rotuloForma } from "@/lib/dominio";
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import {
  abrirCaixa,
  ajustarCaixaFechado,
  fecharCaixa,
  reabrirCaixa,
  registrarMovimentoCaixa,
} from "@/server/acoes/caixa";
import type { CaixaSessaoAbertaVisivel, CaixaSessaoFechadaVisivel, CaixaSessaoVisivel } from "@/lib/caixaVisivel";

function parseValorInput(s: string | number | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? round2(s) : 0;
  const limpo = String(s ?? "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? round2(Math.max(0, n)) : 0;
}

function sessaoTemDivergencia(s: CaixaSessaoVisivel): boolean {
  return s.status === "fechado" && (Math.abs(s.diferencaTotal) >= 0.01 || Object.values(s.diferencas ?? {}).some((v) => Math.abs(Number(v) || 0) >= 0.01));
}

export function CaixaView({
  sessaoAtual,
  historico,
  usuarioAtual,
  operadores = [],
}: {
  sessaoAtual: CaixaSessaoAbertaVisivel | null;
  historico: CaixaSessaoVisivel[];
  usuarioAtual: { id: string; nome: string; papel: PerfilUsuario };
  operadores?: { id: string; nome: string }[];
}) {
  const toast = useToast();
  const podeAbrir = temPermissao(usuarioAtual.papel, "caixa.abrir");
  const podeMovimentar = temPermissao(usuarioAtual.papel, "caixa.movimentar");
  const podeFechar = temPermissao(usuarioAtual.papel, "caixa.fechar");
  const podeReabrir = temPermissao(usuarioAtual.papel, "caixa.reabrir");
  const podeAjustar = temPermissao(usuarioAtual.papel, "caixa.ajustar");

  const [aba, setAba] = useState<"atual" | "historico">(podeAbrir ? "atual" : "historico");
  const [ocupado, setOcupado] = useState(false);

  /* --------------------------------------------------- abertura de caixa */
  const [terminalAbertura, setTerminalAbertura] = useState("CAIXA 1");
  const [saldoAbertura, setSaldoAbertura] = useState("100,00");
  const [obsAbertura, setObsAbertura] = useState("");
  const [operadorAbertura, setOperadorAbertura] = useState(usuarioAtual.nome);

  async function confirmarAbertura() {
    setOcupado(true);
    const r = await abrirCaixa({
      terminal: terminalAbertura,
      saldoInicial: saldoAbertura,
      observacao: obsAbertura,
      operadorNome: operadorAbertura,
    });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Caixa aberto.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) setObsAbertura("");
  }

  /* ----------------------------------------------- suprimento e sangria */
  const [modalMov, setModalMov] = useState<"suprimento" | "sangria" | null>(null);
  const [movForma, setMovForma] = useState("dinheiro");
  const [movValor, setMovValor] = useState("");
  const [movMotivo, setMovMotivo] = useState("");

  async function confirmarMovimento() {
    if (!modalMov || !sessaoAtual) return;
    setOcupado(true);
    const r = await registrarMovimentoCaixa({
      sessaoId: sessaoAtual.id,
      tipo: modalMov,
      forma: movForma,
      valor: movValor,
      motivo: movMotivo,
    });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Movimentação registrada.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) {
      setModalMov(null);
      setMovValor("");
      setMovMotivo("");
    }
  }

  /* ------------------------------------------------- fechamento de caixa */
  const [modalFechar, setModalFechar] = useState(false);
  const [informadosStr, setInformadosStr] = useState<Record<string, string>>({});
  const [confirmadoFechar, setConfirmadoFechar] = useState(false);
  const [justificativaFechar, setJustificativaFechar] = useState("");
  const [requerHomologacaoFechar, setRequerHomologacaoFechar] = useState(false);
  const [gerenteEmailFechar, setGerenteEmailFechar] = useState("");
  const [gerenteSenhaFechar, setGerenteSenhaFechar] = useState("");

  function fecharModalFechamento() {
    if (ocupado) return;
    setModalFechar(false);
    setGerenteEmailFechar("");
    setGerenteSenhaFechar("");
    setRequerHomologacaoFechar(false);
  }

  function abrirModalFechamento(_s: CaixaSessaoAbertaVisivel) {
    // Blind balance: inputs começam VAZIOS. Nenhum valor esperado é enviado ou
    // exibido ao operador antes da submissão; o servidor recalcula o esperado.
    const inicial: Record<string, string> = {};
    for (const fp of FORMAS_PAGAMENTO) inicial[fp.id] = "";
    setInformadosStr(inicial);
    setConfirmadoFechar(false);
    setJustificativaFechar("");
    setRequerHomologacaoFechar(false);
    setGerenteEmailFechar("");
    setGerenteSenhaFechar("");
    setModalFechar(true);
  }

  // Apenas a leitura do que o operador contou — sem conferência ao vivo contra
  // os esperados (isso vazaria o valor esperado antes do fechamento).
  const informadosNum = useMemo(() => {
    const nums: Record<string, number> = {};
    for (const fp of FORMAS_PAGAMENTO) nums[fp.id] = parseValorInput(informadosStr[fp.id]);
    return nums;
  }, [informadosStr]);

  async function confirmarFechamento() {
    if (!sessaoAtual || ocupado) return;
    setOcupado(true);
    try {
      const r = await fecharCaixa({
        sessaoId: sessaoAtual.id,
        valoresInformados: informadosNum,
        confirmado: confirmadoFechar,
        justificativa: justificativaFechar,
        gerenteEmail: gerenteEmailFechar,
        gerenteSenha: gerenteSenhaFechar,
      });
      if (!r.ok && r.requerHomologacao) setRequerHomologacaoFechar(true);
      toast(r.ok ? (r.aviso ?? "Caixa fechado.") : r.erro, r.ok ? "ok" : "erro");
      if (r.ok) {
        setGerenteEmailFechar("");
        setGerenteSenhaFechar("");
        setRequerHomologacaoFechar(false);
        setModalFechar(false);
        setAba("historico");
      }
    } catch {
      toast("Não foi possível concluir o fechamento. Confira o estado do turno antes de tentar novamente.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  /* --------------------------------------- filtros histórico e relatório */
  const [buscaHist, setBuscaHist] = useState("");
  const [periodoHist, setPeriodoHist] = useState<Periodo>({ inicio: "", fim: "" });
  const [operadoresSel, setOperadoresSel] = useState<string[]>([]);
  const [statusSel, setStatusSel] = useState<string[]>([]);

  const linhasHistorico = useMemo(
    () =>
      historico.filter((s) => {
        if (
          !casaTexto(
            `${s.numero} ${s.terminal} ${s.operadorNome} ${s.status === "fechado" ? s.justificativaFechamento : ""} ${s.justificativaReabertura}`,
            buscaHist,
          )
        )
          return false;
        if ((periodoHist.inicio || periodoHist.fim) && !emPeriodo(s.abertoEm, periodoHist)) return false;
        if (operadoresSel.length && !operadoresSel.includes(s.operadorNome)) return false;
        if (statusSel.length) {
          const comDiv = sessaoTemDivergencia(s);
          const ok = statusSel.some((st) => {
            if (st === "aberto") return s.status === "aberto";
            if (st === "fechado") return s.status === "fechado";
            if (st === "divergente") return comDiv;
            if (st === "batido") return s.status === "fechado" && !comDiv;
            return false;
          });
          if (!ok) return false;
        }
        return true;
      }),
    [historico, buscaHist, periodoHist, operadoresSel, statusSel],
  );

  /* ------------------------------- modal detalhe / reabrir / ajustar */
  const [detalheSessao, setDetalheSessao] = useState<CaixaSessaoFechadaVisivel | null>(null);
  const [modoAdmin, setModoAdmin] = useState<"nenhum" | "reabrir" | "ajustar">("nenhum");
  const [justAdmin, setJustAdmin] = useState("");
  const [ajusteStr, setAjusteStr] = useState<Record<string, string>>({});

  function abrirDetalhe(s: CaixaSessaoVisivel) {
    if (s.status !== "fechado") return;
    setDetalheSessao(s);
    setModoAdmin("nenhum");
    setJustAdmin("");
    const m: Record<string, string> = {};
    for (const fp of FORMAS_PAGAMENTO) {
      const val = s.valoresInformados[fp.id] ?? 0;
      m[fp.id] = round2(Number(val)).toFixed(2).replace(".", ",");
    }
    setAjusteStr(m);
  }

  async function executarReabertura() {
    if (!detalheSessao) return;
    setOcupado(true);
    const r = await reabrirCaixa({ sessaoId: detalheSessao.id, justificativa: justAdmin });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Caixa reaberto.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) setDetalheSessao(null);
  }

  async function executarAjuste() {
    if (!detalheSessao) return;
    const nums: Record<string, number> = {};
    for (const fp of FORMAS_PAGAMENTO) nums[fp.id] = parseValorInput(ajusteStr[fp.id]);
    setOcupado(true);
    const r = await ajustarCaixaFechado({
      sessaoId: detalheSessao.id,
      valoresInformados: nums,
      justificativa: justAdmin,
    });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Conferência ajustada.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) setDetalheSessao(null);
  }

  const operadoresUnicos = [...new Set(historico.map((s) => s.operadorNome))].sort();
  const somaVendasPeriodo = round2(
    linhasHistorico.reduce((acc, s) => acc + (s.status === "fechado" ? round2(s.apuracao.totalVendasBrutas - s.apuracao.totalEstornos) : 0), 0),
  );
  const somaInformadoPeriodo = round2(
    linhasHistorico.filter((s) => s.status === "fechado").reduce((acc, s) => acc + s.totalInformado, 0),
  );
  const somaDiferencaPeriodo = round2(
    linhasHistorico.filter((s) => s.status === "fechado").reduce((acc, s) => acc + s.diferencaTotal, 0),
  );

  const colunasHistorico: Coluna<CaixaSessaoVisivel>[] = [
    {
      id: "sessao",
      rotulo: "Sessão / Terminal",
      largura: "150px",
      valor: (s) => s.numero,
      render: (s) => (
        <div>
          <p className="tabular text-[12.5px] font-bold text-ink-900">
            Caixa #{String(s.numero).padStart(3, "0")} <span className="font-normal text-ink-400">· {s.terminal}</span>
          </p>
          <p className="text-[10.5px] text-ink-400">{dataHoraBR(s.abertoEm)}</p>
        </div>
      ),
    },
    {
      id: "operador",
      rotulo: "Operador responsável",
      valor: (s) => s.operadorNome,
      render: (s) => (
        <div>
          <p className="text-[12.5px] font-semibold text-ink-800">{s.operadorNome}</p>
          {s.status === "fechado" && s.fechadoEm && (
            <p className="text-[10.5px] text-ink-400">fechado {dataHoraBR(s.fechadoEm)}</p>
          )}
        </div>
      ),
    },
    {
      id: "inicial",
      rotulo: "Fundo inicial",
      alinhar: "direita",
      valor: (s) => s.saldoInicial,
      render: (s) => <span className="tabular text-[12px] text-ink-600">{moeda(s.saldoInicial)}</span>,
    },
    {
      id: "esperado",
      rotulo: "Esperado",
      alinhar: "direita",
      valor: (s) => s.status === "fechado" ? s.totalEsperado : null,
      render: (s) => <span className="tabular text-[12.5px] font-semibold text-ink-800">{s.status === "fechado" ? moeda(s.totalEsperado) : "—"}</span>,
    },
    {
      id: "informado",
      rotulo: "Informado",
      alinhar: "direita",
      valor: (s) => (s.status === "fechado" ? s.totalInformado : 0),
      render: (s) => (
        <span className="tabular text-[12.5px] font-bold text-ink-900">
          {s.status === "fechado" ? moeda(s.totalInformado) : "—"}
        </span>
      ),
    },
    {
      id: "diferenca",
      rotulo: "Diferença",
      alinhar: "direita",
      valor: (s) => (s.status === "fechado" ? s.diferencaTotal : 0),
      render: (s) => {
        if (s.status !== "fechado") return <span className="text-ink-300">—</span>;
        const dif = round2(s.diferencaTotal);
        if (Math.abs(dif) < 0.01 && sessaoTemDivergencia(s)) return <Badge tom="alerta">Divergência por forma</Badge>;
        if (Math.abs(dif) < 0.01) return <Badge tom="ok">Batido (R$ 0,00)</Badge>;
        return (
          <Badge tom={dif < 0 ? "erro" : "alerta"}>
            {dif > 0 ? `+${moeda(dif)}` : moeda(dif)}
          </Badge>
        );
      },
    },
    {
      id: "status",
      rotulo: "Status",
      alinhar: "centro",
      valor: (s) => s.status,
      render: (s) => (
        <div className="inline-flex flex-col items-center gap-0.5">
          <Badge tom={s.status === "aberto" ? "info" : "neutro"}>
            {s.status === "aberto" ? "Aberto" : "Fechado"}
          </Badge>
          {s.reabertoEm && <span className="text-[9.5px] font-semibold text-amber-600">reaberto</span>}
        </div>
      ),
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (s) => s.status === "fechado" ? (
        <Button tamanho="sm" variante="secundario" onClick={() => abrirDetalhe(s)}>
          Conferência
        </Button>
      ) : <span className="text-[11px] text-ink-400">Em andamento</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Caixa e fechamento por operador"
        subtitulo="Abertura com fundo de troco, vendas por forma de pagamento, suprimentos, sangrias, estornos e conferência cega/assistida"
        etiquetas={
          sessaoAtual ? (
            <>
              <Badge tom="ok">
                Caixa #{sessaoAtual.numero} ({sessaoAtual.terminal}) aberto
              </Badge>
              <Badge tom="neutro">Operador: {sessaoAtual.operadorNome}</Badge>
            </>
          ) : (
            <Badge tom="alerta">Nenhum caixa aberto para {usuarioAtual.nome}</Badge>
          )
        }
        acao={
          <>
            <LinkPdv>
              <Button variante="secundario" tamanho="sm" icone="caixa">
                Ir para o PDV
              </Button>
            </LinkPdv>
            {sessaoAtual && podeMovimentar && (
              <>
                <Button
                  tamanho="sm"
                  variante="suave"
                  icone="mais"
                  onClick={() => {
                    setMovForma("dinheiro");
                    setMovValor("");
                    setMovMotivo("");
                    setModalMov("suprimento");
                  }}
                >
                  Suprimento
                </Button>
                <Button
                  tamanho="sm"
                  variante="secundario"
                  icone="menos"
                  onClick={() => {
                    setMovForma("dinheiro");
                    setMovValor("");
                    setMovMotivo("");
                    setModalMov("sangria");
                  }}
                >
                  Sangria
                </Button>
              </>
            )}
            {sessaoAtual && podeFechar && (
              <Button icone="cadeado" onClick={() => abrirModalFechamento(sessaoAtual)}>
                Conferir e fechar caixa
              </Button>
            )}
          </>
        }
      />

      <Abas
        atual={aba}
        aoTrocar={(v) => setAba(v as "atual" | "historico")}
        abas={[
          { id: "atual", rotulo: sessaoAtual ? `Meu caixa aberto (#${sessaoAtual.numero})` : "Abrir meu caixa" },
          { id: "historico", rotulo: "Histórico e relatório de fechamentos", contagem: historico.length },
        ]}
      />

      {aba === "atual" && (
        !podeAbrir ? (
          <Vazio>
            O seu perfil atual não opera abertura/fechamento de caixa. Utilize o PDV no modo pré-venda (DAV/orçamento) ou consulte o administrador.
          </Vazio>
        ) : !sessaoAtual ? (
          <Card className="mx-auto max-w-xl">
            <CardTitulo
              titulo="Abrir nova sessão de caixa"
              descricao="Identifique o operador responsável · todas as vendas desta sessão serão vinculadas a ele"
              icone="caixa"
            />
            <div className="space-y-3">
              <Campo rotulo="Operador responsável" obrigatorio>
                <Select
                  valor={operadorAbertura}
                  aoMudar={setOperadorAbertura}
                  opcoes={[
                    { valor: usuarioAtual.nome, rotulo: `${usuarioAtual.nome} (logado)` },
                    ...operadores
                      .filter((o) => o.nome !== usuarioAtual.nome)
                      .map((o) => ({ valor: o.nome, rotulo: o.nome })),
                  ]}
                />
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Terminal / Identificação" obrigatorio>
                  <Select
                    valor={terminalAbertura}
                    aoMudar={setTerminalAbertura}
                    opcoes={[
                      { valor: "CAIXA 1", rotulo: "CAIXA 1 — Frente principal" },
                      { valor: "CAIXA 2", rotulo: "CAIXA 2 — Balcão rápido" },
                      { valor: "CAIXA 3", rotulo: "CAIXA 3 — Expedição" },
                    ]}
                  />
                </Campo>
                <Campo rotulo="Saldo inicial em dinheiro (R$)" obrigatorio>
                  <Input
                    dinheiro
                    valor={saldoAbertura}
                    aoMudar={setSaldoAbertura}
                    placeholder="0,00"
                  />
                </Campo>
              </div>
              <Campo rotulo="Observação de abertura (opcional)">
                <Input
                  valor={obsAbertura}
                  aoMudar={setObsAbertura}
                  placeholder="Ex.: Fundo de troco conferido no início do turno"
                />
              </Campo>
              <div className="flex justify-end pt-1">
                <Button icone="check" disabled={ocupado} onClick={confirmarAbertura}>
                  {ocupado ? "Abrindo caixa…" : "Abrir sessão de caixa"}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                rotulo="Estado da gaveta"
                valor={sessaoAtual.estadoGaveta === "bloqueado" ? "Bloqueada" : sessaoAtual.estadoGaveta === "alerta" ? "Atenção" : "Normal"}
                detalhe={sessaoAtual.bloquearVendaDinheiro ? "Sangria necessária para venda em dinheiro" : "Estado de segurança, sem saldo exposto"}
                tom={sessaoAtual.estadoGaveta === "bloqueado" ? "erro" : sessaoAtual.estadoGaveta === "alerta" ? "alerta" : "ok"}
                icone="carteira"
              />
              <Kpi
                rotulo="Vendas da sessão"
                valor={String(sessaoAtual.qtdVendasAtivas)}
                detalhe={`${sessaoAtual.qtdVendasCanceladas} cancelada(s)`}
                tom="info"
                icone="caixa"
              />
              <Kpi
                rotulo="Movimentações"
                valor={String(sessaoAtual.movimentos.filter((m) => m.tipo === "suprimento" || m.tipo === "sangria").length)}
                detalhe="Suprimentos e sangrias registrados"
                tom="neutro"
                icone="atualizar"
              />
              <Kpi rotulo="Turno aberto" valor={`#${sessaoAtual.numero}`} detalhe={`aberto em ${dataHoraBR(sessaoAtual.abertoEm)}`} tom="roxo" icone="documento" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitulo titulo="Conferência protegida" descricao="Fechamento às cegas" icone="cadeado" />
                <p className="text-[12.5px] leading-relaxed text-ink-600">Os saldos esperados por forma permanecem no servidor enquanto o turno estiver aberto. Conte os valores e use <strong>Conferir e fechar caixa</strong>; divergências exigem justificativa e homologação gerencial.</p>
                <p className="mt-3 text-[11.5px] text-ink-400">Os snapshots e a comparação por modalidade ficam disponíveis no histórico após o encerramento.</p>
              </Card>

              <Card padding={false}>
                <div className="p-4 pb-2">
                  <CardTitulo
                    titulo="Movimentações da sessão"
                    descricao="Suprimentos, sangrias e estornos registrados"
                    icone="atualizar"
                  />
                </div>
                {sessaoAtual.movimentos.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12.5px] text-ink-400">
                    Nenhum suprimento, sangria ou estorno registrado nesta sessão até o momento.
                  </p>
                ) : (
                  <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto">
                    {sessaoAtual.movimentos.map((m) => (
                      <li key={m.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-[12px]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tom={
                                m.tipo === "suprimento"
                                  ? "ok"
                                  : m.tipo === "sangria"
                                    ? "alerta"
                                    : m.tipo === "estorno"
                                      ? "erro"
                                      : "info"
                              }
                            >
                              {m.tipo}
                            </Badge>
                            <span className="text-[11px] font-medium text-ink-500">{rotuloForma(m.forma)}</span>
                          </div>
                          <p className="mt-1 truncate text-ink-700">{m.motivo}</p>
                          <p className="text-[10.5px] text-ink-400">
                            {dataHoraBR(m.criadoEm)} · {m.usuarioNome}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "tabular shrink-0 font-bold",
                            m.tipo === "suprimento" ? "text-way-700" : "text-rose-700",
                          )}
                        >
                          {m.tipo === "suprimento" ? `+${moeda(m.valor)}` : `-${moeda(m.valor)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )
      )}

      {aba === "historico" && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              rotulo="Sessões no filtro"
              valor={String(linhasHistorico.length)}
              detalhe={`${linhasHistorico.filter((s) => s.status === "aberto").length} aberta(s) · ${linhasHistorico.filter((s) => s.status === "fechado").length} fechada(s)`}
              tom="info"
              icone="caixa"
            />
            <Kpi
              rotulo="Vendas líquidas apuradas"
              valor={moeda(somaVendasPeriodo)}
              detalhe="soma das vendas menos estornos"
              tom="ok"
              icone="carteira"
            />
            <Kpi
              rotulo="Total conferido (fechados)"
              valor={moeda(somaInformadoPeriodo)}
              detalhe="valores declarados pelos operadores"
              tom="neutro"
              icone="documento"
            />
            <Kpi
              rotulo="Saldo de divergências"
              valor={somaDiferencaPeriodo > 0 ? `+${moeda(somaDiferencaPeriodo)}` : moeda(somaDiferencaPeriodo)}
              detalhe={!linhasHistorico.some(sessaoTemDivergencia) ? "sem divergências por forma" : "saldo líquido; confira as diferenças por forma"}
              tom={!linhasHistorico.some(sessaoTemDivergencia) ? "ok" : somaDiferencaPeriodo < 0 ? "erro" : "alerta"}
              icone="alerta"
            />
          </div>

          <BarraFiltros>
            <FiltroTexto
              rotulo="Buscar nº, terminal ou operador"
              valor={buscaHist}
              aoMudar={setBuscaHist}
              placeholder="Ex.: CAIXA 1, Ana..."
              largura="w-56"
            />
            <FiltroPeriodo rotulo="Período de abertura" valor={periodoHist} aoMudar={setPeriodoHist} />
            <FiltroMulti
              rotulo="Operador"
              selecionados={operadoresSel}
              aoAlternar={(v) => setOperadoresSel(alternarItem(operadoresSel, v))}
              opcoes={operadoresUnicos.map((op) => ({
                valor: op,
                rotulo: op,
                contagem: historico.filter((s) => s.operadorNome === op).length,
              }))}
            />
            <FiltroMulti
              rotulo="Status"
              selecionados={statusSel}
              aoAlternar={(v) => setStatusSel(alternarItem(statusSel, v))}
              opcoes={[
                { valor: "aberto", rotulo: "Abertos", contagem: historico.filter((s) => s.status === "aberto").length },
                { valor: "fechado", rotulo: "Fechados", contagem: historico.filter((s) => s.status === "fechado").length },
                {
                  valor: "batido",
                  rotulo: "Fechados sem divergência",
                  contagem: historico.filter((s) => s.status === "fechado" && !sessaoTemDivergencia(s)).length,
                },
                {
                  valor: "divergente",
                  rotulo: "Fechados com divergência",
                  contagem: historico.filter(sessaoTemDivergencia).length,
                },
              ]}
            />
            {(buscaHist || periodoHist.inicio || periodoHist.fim || operadoresSel.length > 0 || statusSel.length > 0) && (
              <Button
                tamanho="sm"
                variante="fantasma"
                onClick={() => {
                  setBuscaHist("");
                  setPeriodoHist({ inicio: "", fim: "" });
                  setOperadoresSel([]);
                  setStatusSel([]);
                }}
              >
                Limpar filtros
              </Button>
            )}
          </BarraFiltros>

          {(operadoresSel.length > 0 || statusSel.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {operadoresSel.map((op) => (
                <Chip key={op} onClick={() => setOperadoresSel(operadoresSel.filter((x) => x !== op))}>
                  operador: {op}
                </Chip>
              ))}
              {statusSel.map((st) => (
                <Chip key={st} onClick={() => setStatusSel(statusSel.filter((x) => x !== st))}>
                  status: {st}
                </Chip>
              ))}
            </div>
          )}

          <Tabela
            colunas={colunasHistorico}
            linhas={linhasHistorico}
            chave={(s) => s.id}
            nomeExportar="nkway-fechamentos-caixa"
            vazio="Nenhuma sessão de caixa encontrada para os filtros informados."
          />
        </div>
      )}

      {/* Modal: Suprimento / Sangria */}
      <Modal
        aberto={Boolean(modalMov)}
        aoFechar={() => setModalMov(null)}
        titulo={modalMov === "suprimento" ? "Registrar suprimento de caixa" : "Registrar sangria de caixa"}
        descricao={
          modalMov === "suprimento"
            ? "Entrada de reforço de troco na sessão de caixa aberta"
            : "Retirada de numerário da gaveta para cofre ou despesa autorizada"
        }
        largura="max-w-md"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setModalMov(null)}>
              Cancelar
            </Button>
            <Button icone="check" disabled={ocupado} onClick={confirmarMovimento}>
              {ocupado ? "Salvando…" : "Confirmar lançamento"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Forma" obrigatorio>
              <Select
                valor={movForma}
                aoMudar={setMovForma}
                opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))}
              />
            </Campo>
            <Campo rotulo="Valor (R$)" obrigatorio>
              <Input dinheiro valor={movValor} aoMudar={setMovValor} placeholder="0,00" />
            </Campo>
          </div>
          <Campo rotulo="Motivo / observação" obrigatorio>
            <Input
              valor={movMotivo}
              aoMudar={setMovMotivo}
              placeholder={modalMov === "suprimento" ? "Ex.: Reforço de moedas para troco" : "Ex.: Recolhimento para o cofre central"}
            />
          </Campo>
        </div>
      </Modal>

      {/* Modal: Conferência e Fechamento de Caixa */}
      <Modal
        aberto={modalFechar && Boolean(sessaoAtual)}
        aoFechar={fecharModalFechamento}
        titulo={sessaoAtual ? `Fechamento do Caixa #${sessaoAtual.numero} (${sessaoAtual.terminal})` : "Fechar caixa"}
        descricao={`Operador: ${sessaoAtual?.operadorNome ?? ""} · Confira os valores por forma de pagamento antes de encerrar`}
        largura="max-w-2xl"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={fecharModalFechamento} disabled={ocupado}>
              Voltar
            </Button>
            <Button
              icone="cadeado"
              disabled={ocupado || !confirmadoFechar}
              onClick={confirmarFechamento}
            >
              {ocupado ? "Encerrando caixa…" : "Confirmar e fechar caixa"}
            </Button>
          </div>
        }
      >
        {sessaoAtual && (
          <div className="space-y-4">
            <p className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-[12px] leading-snug text-sky-900">
              Fechamento às cegas: digite apenas o valor físico contado em cada forma. Os campos
              começam vazios e o esperado é calculado no servidor, sem exibir valores ao operador.
            </p>
            {requerHomologacaoFechar && (
              <p role="alert" className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900">
                Divergência detectada: para concluir, preencha abaixo a justificativa e as credenciais
                (e-mail + PIN/senha) de um gerente com permissão de homologação.
              </p>
            )}
            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-ink-50 text-[11px] uppercase text-ink-400">
                  <tr>
                    <th className="px-3.5 py-2.5">Forma de pagamento</th>
                    <th className="w-40 px-3.5 py-2.5 text-right">Informado (R$)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {FORMAS_PAGAMENTO.map((fp) => (
                    <tr key={fp.id}>
                      <td className="px-3.5 py-2 font-semibold text-ink-800">{fp.label}</td>
                      <td className="px-3.5 py-1.5">
                        <Input
                          dinheiro
                          valor={informadosStr[fp.id] ?? ""}
                          aoMudar={(v) => setInformadosStr({ ...informadosStr, [fp.id]: v })}
                          placeholder="0,00"
                          className="text-right font-mono"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Area
              rotulo="Justificativa (obrigatória se houver divergência · mín. 10 caracteres)"
              valor={justificativaFechar}
              aoMudar={setJustificativaFechar}
              linhas={2}
              placeholder="Se houver sobra ou falta, descreva o motivo para registro na auditoria..."
            />

            {requerHomologacaoFechar && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                <p className="text-[12px] font-semibold text-amber-900">Há divergência ou inconsistência. Solicite a homologação de um gerente para concluir o fechamento.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Campo rotulo="E-mail do gerente" obrigatorio>
                    <Input type="email" valor={gerenteEmailFechar} aoMudar={setGerenteEmailFechar} placeholder="gerente@empresa.com.br" />
                  </Campo>
                  <Campo rotulo="PIN / senha do gerente" obrigatorio dica="Verificado no servidor e não registrado em log.">
                    <Input type="password" autoComplete="off" valor={gerenteSenhaFechar} aoMudar={setGerenteSenhaFechar} placeholder="••••••" />
                  </Campo>
                </div>
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-ink-100 bg-ink-50/50 px-3.5 py-2.5 text-[12.5px] font-medium text-ink-800">
              <input
                type="checkbox"
                checked={confirmadoFechar}
                onChange={(e) => setConfirmadoFechar(e.target.checked)}
                className="size-4 accent-way-600"
              />
              Confirmo a conferência dos valores acima para encerrar esta sessão de caixa.
            </label>
          </div>
        )}
      </Modal>

      {/* Modal: Detalhe Histórico + Reabertura / Ajuste (Administrador) */}
      <Modal
        aberto={Boolean(detalheSessao)}
        aoFechar={() => setDetalheSessao(null)}
        titulo={
          detalheSessao
            ? `Relatório do Caixa #${detalheSessao.numero} (${detalheSessao.terminal}) · ${detalheSessao.operadorNome}`
            : "Detalhes da sessão"
        }
        descricao={
          detalheSessao
            ? `Aberto em ${dataHoraBR(detalheSessao.abertoEm)}${detalheSessao.fechadoEm ? ` · Fechado em ${dataHoraBR(detalheSessao.fechadoEm)}` : " · Sessão em andamento"}`
            : ""
        }
        largura="max-w-2xl"
        rodape={
          detalheSessao && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {detalheSessao.status === "fechado" && podeReabrir && (
                  <Button
                    tamanho="sm"
                    variante={modoAdmin === "reabrir" ? "primario" : "secundario"}
                    onClick={() => setModoAdmin(modoAdmin === "reabrir" ? "nenhum" : "reabrir")}
                  >
                    Reabrir caixa
                  </Button>
                )}
                {detalheSessao.status === "fechado" && podeAjustar && (
                  <Button
                    tamanho="sm"
                    variante={modoAdmin === "ajustar" ? "primario" : "secundario"}
                    onClick={() => setModoAdmin(modoAdmin === "ajustar" ? "nenhum" : "ajustar")}
                  >
                    Ajustar conferência
                  </Button>
                )}
              </div>
              <Button variante="secundario" onClick={() => setDetalheSessao(null)}>
                Fechar janela
              </Button>
            </div>
          )
        }
      >
        {detalheSessao && (
          <div className="space-y-4 text-[12.5px]">
            <div className="overflow-x-auto rounded-xl border border-ink-100">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-ink-50 text-[11px] uppercase text-ink-400">
                  <tr>
                    <th className="px-3.5 py-2">Forma</th>
                    <th className="px-3.5 py-2 text-right">Esperado</th>
                    <th className="px-3.5 py-2 text-right">Informado</th>
                    <th className="px-3.5 py-2 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {FORMAS_PAGAMENTO.map((fp) => {
                    const esp = round2(detalheSessao.valoresEsperados[fp.id] ?? detalheSessao.apuracao.esperadosMap[fp.id] ?? 0);
                    const inf = round2(detalheSessao.valoresInformados[fp.id] ?? 0);
                    const dif = round2(detalheSessao.diferencas[fp.id] ?? inf - esp);
                    return (
                      <tr key={fp.id}>
                        <td className="px-3.5 py-2 font-medium text-ink-800">{fp.label}</td>
                        <td className="tabular px-3.5 py-2 text-right text-ink-600">{moeda(esp)}</td>
                        <td className="tabular px-3.5 py-2 text-right font-semibold text-ink-900">
                          {detalheSessao.status === "fechado" ? moeda(inf) : "—"}
                        </td>
                        <td className="tabular px-3.5 py-2 text-right font-bold">
                          {detalheSessao.status !== "fechado" ? (
                            "—"
                          ) : Math.abs(dif) < 0.01 ? (
                            <span className="text-way-700">R$ 0,00</span>
                          ) : (
                            <span className={dif < 0 ? "text-rose-700" : "text-amber-700"}>
                              {dif > 0 ? `+${moeda(dif)}` : moeda(dif)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {detalheSessao.justificativaFechamento && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                <b>Justificativa / histórico de conferência:</b> {detalheSessao.justificativaFechamento}
              </div>
            )}

            {detalheSessao.justificativaReabertura && (
              <div className="rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-900">
                <b>Última reabertura ({detalheSessao.reabertoPorNome}):</b> {detalheSessao.justificativaReabertura}
              </div>
            )}

            {modoAdmin === "reabrir" && (
              <div className="space-y-3 rounded-xl border border-way-200 bg-way-50/40 p-3.5">
                <p className="font-semibold text-ink-900">
                  Reabertura administrativa do Caixa #{detalheSessao.numero} (registrada na auditoria)
                </p>
                <Area
                  rotulo="Justificativa obrigatória para reabrir (mín. 10 caracteres)"
                  valor={justAdmin}
                  aoMudar={setJustAdmin}
                  linhas={2}
                  placeholder="Informe o motivo da reabertura desta sessão..."
                />
                <div className="flex justify-end">
                  <Button disabled={ocupado} onClick={executarReabertura}>
                    {ocupado ? "Reabrindo…" : "Confirmar reabertura"}
                  </Button>
                </div>
              </div>
            )}

            {modoAdmin === "ajustar" && (
              <div className="space-y-3 rounded-xl border border-ink-200 bg-ink-50/50 p-3.5">
                <p className="font-semibold text-ink-900">
                  Ajustar valores informados do Caixa #{detalheSessao.numero} (registrado na auditoria)
                </p>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {FORMAS_PAGAMENTO.map((fp) => (
                    <Campo key={fp.id} rotulo={fp.label}>
                      <Input
                        dinheiro
                        valor={ajusteStr[fp.id] ?? "0,00"}
                        aoMudar={(v) => setAjusteStr({ ...ajusteStr, [fp.id]: v })}
                      />
                    </Campo>
                  ))}
                </div>
                <Area
                  rotulo="Justificativa obrigatória do ajuste (mín. 10 caracteres)"
                  valor={justAdmin}
                  aoMudar={setJustAdmin}
                  linhas={2}
                  placeholder="Descreva a conferência administrativa ou comprovante localizado..."
                />
                <div className="flex justify-end">
                  <Button disabled={ocupado} onClick={executarAjuste}>
                    {ocupado ? "Aplicando ajuste…" : "Salvar ajuste auditado"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
