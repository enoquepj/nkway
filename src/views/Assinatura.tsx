"use client";

import { useMemo, useState } from "react";
import { QrCode } from "@/components/QrCode";
import { Tabela, type Coluna } from "@/components/Tabela";
import {
  Area,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  CardTitulo,
  FiltroMulti,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import {
  DESCONTO_ANUAL_PCT,
  FORMAS_ASSINATURA,
  ROTULO_STATUS_ASSINATURA,
  ROTULO_STATUS_FATURA,
  calcularPrecoAssinatura,
  type CicloAssinatura,
  type FormaAssinatura,
  type StatusFaturaAssinatura,
} from "@/lib/assinatura";
import { PLANOS_CFG, dataBR, dataHoraBR, mascaraDocumento, moeda } from "@/lib/dominio";
import { alternarItem } from "@/lib/filtros";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import {
  atualizarPreferenciaRecorrencia,
  cancelarAssinaturaCnpj,
  confirmarPagamentoSandbox,
  contratarAssinaturaCnpj,
  emitirProximaFaturaAssinatura,
} from "@/server/acoes/assinatura";
import type { AssinaturaFaturaDto, AssinaturaPainelDto } from "@/server/dados";

const ROTULO_FORMA: Record<FormaAssinatura, string> = {
  pix: "PIX",
  boleto: "Boleto CNPJ",
  cartao: "Cartão",
};

export function PainelAssinatura({
  dados,
  usuarioPapel = "administrador",
  mostrarCabecalho = true,
}: {
  dados: AssinaturaPainelDto;
  usuarioPapel?: PerfilUsuario;
  mostrarCabecalho?: boolean;
}) {
  const toast = useToast();
  const podeGerenciar = temPermissao(usuarioPapel, "config.gerenciar");

  const [cicloVitrine, setCicloVitrine] = useState<CicloAssinatura>(
    dados.contratoAtivo?.ciclo ?? "mensal",
  );
  const [ocupado, setOcupado] = useState(false);

  /* -------------------------------------------- modal checkout por CNPJ */
  const [planoCheckout, setPlanoCheckout] = useState<string | null>(null);
  const [cicloCheckout, setCicloCheckout] = useState<CicloAssinatura>("mensal");
  const [formaCheckout, setFormaCheckout] = useState<FormaAssinatura>("pix");
  const [cnpjCheckout, setCnpjCheckout] = useState(dados.empresaCnpj);
  const [razaoCheckout, setRazaoCheckout] = useState(dados.empresaNome);
  const [emailCheckout, setEmailCheckout] = useState(dados.empresaEmail);
  const [cartaoNumero, setCartaoNumero] = useState("");
  const [cartaoTitular, setCartaoTitular] = useState("");
  const [cartaoValidade, setCartaoValidade] = useState("");
  const [cartaoCvv, setCartaoCvv] = useState("");

  /* ------------------------------------------ modal fatura PIX / Boleto */
  const [faturaAbertaId, setFaturaAbertaId] = useState<string | null>(null);
  const faturaAberta = useMemo(
    () => dados.faturas.find((f) => f.id === faturaAbertaId) ?? null,
    [dados.faturas, faturaAbertaId],
  );

  /* ---------------------------------------- modal preferências / cancel */
  const [modalPreferencias, setModalPreferencias] = useState(false);
  const [prefCiclo, setPrefCiclo] = useState<CicloAssinatura>(dados.contratoAtivo?.ciclo ?? "mensal");
  const [prefForma, setPrefForma] = useState<FormaAssinatura>(dados.contratoAtivo?.formaPagamento ?? "pix");
  const [prefEmail, setPrefEmail] = useState(dados.contratoAtivo?.emailCobranca ?? dados.empresaEmail);

  const [modalCancelar, setModalCancelar] = useState(false);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cancelarImediato, setCancelarImediato] = useState(false);

  /* ------------------------------------------------- filtros de faturas */
  const [statusFaturaSel, setStatusFaturaSel] = useState<string[]>([]);
  const [formasFaturaSel, setFormasFaturaSel] = useState<string[]>([]);

  const faturasFiltradas = useMemo(
    () =>
      dados.faturas.filter((f) => {
        if (statusFaturaSel.length && !statusFaturaSel.includes(f.status)) return false;
        if (formasFaturaSel.length && !formasFaturaSel.includes(f.formaPagamento)) return false;
        return true;
      }),
    [dados.faturas, statusFaturaSel, formasFaturaSel],
  );

  function abrirCheckout(planoId: string) {
    setPlanoCheckout(planoId);
    setCicloCheckout(cicloVitrine);
    setFormaCheckout(dados.contratoAtivo?.formaPagamento ?? "pix");
    setCnpjCheckout(dados.contratoAtivo ? mascaraDocumento(dados.contratoAtivo.cnpj) : dados.empresaCnpj);
    setRazaoCheckout(dados.contratoAtivo?.razaoSocial || dados.empresaNome);
    setEmailCheckout(dados.contratoAtivo?.emailCobranca || dados.empresaEmail);
    setCartaoNumero("");
    setCartaoTitular("");
    setCartaoValidade("");
    setCartaoCvv("");
  }

  async function confirmarCheckout() {
    if (!planoCheckout) return;
    setOcupado(true);
    const r = await contratarAssinaturaCnpj({
      planoId: planoCheckout,
      ciclo: cicloCheckout,
      formaPagamento: formaCheckout,
      cnpj: cnpjCheckout,
      razaoSocial: razaoCheckout,
      emailCobranca: emailCheckout,
      cartaoNumero,
      cartaoTitular,
      cartaoValidade,
      cartaoCvv,
    });
    setOcupado(false);
    toast(r.ok ? (r.aviso ?? "Assinatura processada.") : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) {
      setCartaoNumero("");
      setCartaoCvv("");
      setPlanoCheckout(null);
      if (r.checkoutUrl) {
        window.open(r.checkoutUrl, "_blank", "noopener,noreferrer");
      } else if (r.faturaId && r.statusFatura === "pendente") {
        setFaturaAbertaId(r.faturaId);
      }
    }
  }

  async function copiarTexto(valor: string, rotulo: string) {
    try {
      await navigator.clipboard.writeText(valor);
      toast(`${rotulo} copiado para a área de transferência.`, "ok");
    } catch {
      toast(`Não foi possível copiar automaticamente. Selecione o código na tela.`, "info");
    }
  }

  const pctProdutos =
    dados.planoAtual.limiteProdutos > 0
      ? Math.min(100, (dados.uso.produtosAtivos / dados.planoAtual.limiteProdutos) * 100)
      : 0;
  const pctUsuarios =
    dados.planoAtual.limiteUsuarios > 0
      ? Math.min(100, (dados.uso.usuariosAtivos / dados.planoAtual.limiteUsuarios) * 100)
      : 0;

  const precoCheckout = planoCheckout ? calcularPrecoAssinatura(planoCheckout, cicloCheckout) : null;
  const faturaPendenteAtiva = dados.faturas.find((f) => f.status === "pendente") ?? null;

  const colunasFaturas: Coluna<AssinaturaFaturaDto>[] = [
    {
      id: "numero",
      rotulo: "Fatura / Competência",
      largura: "160px",
      valor: (f) => f.numero,
      render: (f) => (
        <div>
          <p className="tabular text-[12.5px] font-bold text-ink-900">
            Fatura #{String(f.numero).padStart(4, "0")}
          </p>
          <p className="font-mono text-[10.5px] text-ink-400">
            comp. {f.competencia} · {f.ciclo}
          </p>
        </div>
      ),
    },
    {
      id: "cnpj",
      rotulo: "Plano / CNPJ faturado",
      valor: (f) => `${f.planoNome} ${f.cnpj}`,
      render: (f) => (
        <div>
          <p className="text-[12.5px] font-semibold text-ink-800">{f.planoNome}</p>
          <p className="font-mono text-[10.5px] text-ink-400">CNPJ {mascaraDocumento(f.cnpj)}</p>
        </div>
      ),
    },
    {
      id: "forma",
      rotulo: "Meio",
      largura: "120px",
      valor: (f) => ROTULO_FORMA[f.formaPagamento],
      render: (f) => <Badge tom="neutro">{ROTULO_FORMA[f.formaPagamento]}</Badge>,
    },
    {
      id: "vencimento",
      rotulo: "Vencimento",
      largura: "130px",
      valor: (f) => f.vencimento,
      render: (f) => (
        <div>
          <span className="tabular block text-[12px] text-ink-700">{dataBR(f.vencimento)}</span>
          {f.pagoEm && (
            <span className="block text-[10px] text-way-700">pago {dataBR(f.pagoEm)}</span>
          )}
        </div>
      ),
    },
    {
      id: "valor",
      rotulo: "Valor",
      alinhar: "direita",
      largura: "118px",
      valor: (f) => f.valor,
      render: (f) => <span className="tabular text-[12.5px] font-bold text-ink-900">{moeda(f.valor)}</span>,
    },
    {
      id: "status",
      rotulo: "Situação",
      alinhar: "centro",
      largura: "155px",
      valor: (f) => f.status,
      render: (f) => {
        const info = ROTULO_STATUS_FATURA[f.status] ?? ROTULO_STATUS_FATURA.pendente;
        return <Badge tom={info.tom}>{info.rotulo}</Badge>;
      },
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (f) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button tamanho="sm" variante="secundario" onClick={() => setFaturaAbertaId(f.id)}>
            {f.status === "pendente" ? "Pagar / 2ª via" : "Comprovante"}
          </Button>
          {podeGerenciar && f.status === "pendente" && f.gateway === "sandbox" && (
            <Button
              tamanho="sm"
              variante="suave"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await confirmarPagamentoSandbox({ faturaId: f.id });
                setOcupado(false);
                toast(r.ok ? (r.aviso ?? "Fatura liquidada.") : r.erro, r.ok ? "ok" : "erro");
              }}
            >
              Simular pago
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {mostrarCabecalho && (
        <PageHeader
          titulo="Assinatura e faturamento por CNPJ"
          subtitulo="Cobrança recorrente corporativa (PIX, Boleto Registrado e Cartão) integrada com gateway e webhook auditado"
          etiquetas={
            <>
              <Badge tom={dados.gateway.modoLive ? "ok" : "info"}>
                {dados.gateway.provedor === "asaas"
                  ? `Gateway Asaas (${dados.gateway.asaasAmbiente})`
                  : dados.gateway.provedor === "stripe"
                    ? "Gateway Stripe Live"
                    : "Gateway Sandbox Homologação"}
              </Badge>
              <Badge tom="neutro" mono>
                CNPJ {dados.empresaCnpj}
              </Badge>
              {dados.trialDias !== null && (
                <Badge tom={dados.trialDias <= 3 ? "erro" : "alerta"}>
                  {dados.trialDias > 0 ? `Trial: ${dados.trialDias} dia(s)` : "Trial encerrado"}
                </Badge>
              )}
            </>
          }
          acao={
            podeGerenciar && dados.contratoAtivo ? (
              <>
                <Button
                  tamanho="sm"
                  variante="secundario"
                  onClick={() => {
                    setPrefCiclo(dados.contratoAtivo!.ciclo);
                    setPrefForma(dados.contratoAtivo!.formaPagamento);
                    setPrefEmail(dados.contratoAtivo!.emailCobranca);
                    setModalPreferencias(true);
                  }}
                >
                  Preferências de cobrança
                </Button>
                <Button
                  tamanho="sm"
                  variante="fantasma"
                  onClick={() => {
                    setMotivoCancelamento("");
                    setCancelarImediato(false);
                    setModalCancelar(true);
                  }}
                >
                  Cancelar assinatura
                </Button>
              </>
            ) : undefined
          }
        />
      )}

      {faturaPendenteAtiva && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-[12.5px] text-amber-900">
          <div className="flex items-center gap-2.5">
            <Icon name="alerta" className="size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold">
                Fatura #{String(faturaPendenteAtiva.numero).padStart(4, "0")} aguardando pagamento ({moeda(faturaPendenteAtiva.valor)} · {ROTULO_FORMA[faturaPendenteAtiva.formaPagamento]})
              </p>
              <p className="text-[11.5px] text-amber-800">
                Plano {faturaPendenteAtiva.planoNome} · Vencimento {dataBR(faturaPendenteAtiva.vencimento)} · CNPJ {mascaraDocumento(faturaPendenteAtiva.cnpj)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button tamanho="sm" variante="secundario" onClick={() => setFaturaAbertaId(faturaPendenteAtiva.id)}>
              Abrir QR Code / Boleto
            </Button>
            {podeGerenciar && faturaPendenteAtiva.gateway === "sandbox" && (
              <Button
                tamanho="sm"
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  const r = await confirmarPagamentoSandbox({ faturaId: faturaPendenteAtiva.id });
                  setOcupado(false);
                  toast(r.ok ? (r.aviso ?? "Pagamento confirmado.") : r.erro, r.ok ? "ok" : "erro");
                }}
              >
                Simular webhook pago
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Plano em vigor"
          valor={dados.planoAtual.nome}
          detalhe={
            dados.planoAtual.preco > 0
              ? dados.assinaturaPagoEm
                ? `última quitação em ${dataBR(dados.assinaturaPagoEm)}`
                : dados.trialDias !== null
                  ? `em avaliação gratuita (${dados.trialDias}d)`
                  : `${moeda(dados.planoAtual.preco)}/mês`
              : "plano gratuito permanente"
          }
          tom={dados.planoAtual.preco > 0 ? "ok" : "neutro"}
          icone="raio"
        />
        <Kpi
          rotulo="Contrato recorrente CNPJ"
          valor={
            dados.contratoAtivo
              ? ROTULO_STATUS_ASSINATURA[dados.contratoAtivo.status].rotulo
              : "Sem recorrência"
          }
          detalhe={
            dados.contratoAtivo
              ? `${mascaraDocumento(dados.contratoAtivo.cnpj)} · prorroga ${dataBR(dados.contratoAtivo.proximoVencimento)}`
              : "escolha um plano pago abaixo"
          }
          tom={dados.contratoAtivo ? ROTULO_STATUS_ASSINATURA[dados.contratoAtivo.status].tom : "neutro"}
          icone="documento"
        />
        <Kpi
          rotulo="Uso de produtos ativos"
          valor={`${dados.uso.produtosAtivos.toLocaleString("pt-BR")} / ${dados.planoAtual.limiteProdutos.toLocaleString("pt-BR")}`}
          detalhe={`${pctProdutos.toFixed(0)}% da franquia do plano`}
          tom={pctProdutos > 85 ? "erro" : pctProdutos > 65 ? "alerta" : "info"}
          icone="etiqueta"
          barra={pctProdutos}
        />
        <Kpi
          rotulo="Terminais / usuários ativos"
          valor={`${dados.uso.usuariosAtivos} / ${dados.planoAtual.limiteUsuarios}`}
          detalhe={`${pctUsuarios.toFixed(0)}% dos acessos liberados`}
          tom={pctUsuarios >= 100 ? "alerta" : "ok"}
          icone="pessoas"
          barra={pctUsuarios}
        />
      </div>

      {/* Contrato ativo detalhado */}
      {dados.contratoAtivo && (
        <Card>
          <CardTitulo
            titulo={`Contrato ativo · ${dados.contratoAtivo.razaoSocial} (CNPJ ${mascaraDocumento(dados.contratoAtivo.cnpj)})`}
            descricao={`ID no gateway (${dados.contratoAtivo.gateway.toUpperCase()}): ${dados.contratoAtivo.gatewaySubscriptionId || "local"} · E-mail fiscal: ${dados.contratoAtivo.emailCobranca}`}
            icone="cadeado"
            acao={
              <div className="flex flex-wrap items-center gap-2">
                <Badge tom={ROTULO_STATUS_ASSINATURA[dados.contratoAtivo.status].tom}>
                  {ROTULO_STATUS_ASSINATURA[dados.contratoAtivo.status].rotulo}
                </Badge>
                {dados.contratoAtivo.cancelarAoFimDoCiclo && (
                  <Badge tom="alerta">Encerra em {dataBR(dados.contratoAtivo.proximoVencimento)}</Badge>
                )}
              </div>
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-ink-50/70 px-3.5 py-2.5 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-4">
              <span>
                Plano contratado: <b className="text-ink-900">{dados.contratoAtivo.planoNome}</b>
              </span>
              <span>
                Ciclo: <b className="capitalize text-ink-900">{dados.contratoAtivo.ciclo}</b> ({moeda(dados.contratoAtivo.valorCiclo)})
              </span>
              <span>
                Meio:{" "}
                <b className="text-ink-900">
                  {ROTULO_FORMA[dados.contratoAtivo.formaPagamento]}
                  {dados.contratoAtivo.cartaoUltimos4
                    ? ` (${dados.contratoAtivo.cartaoBandeira} •••• ${dados.contratoAtivo.cartaoUltimos4})`
                    : ""}
                </b>
              </span>
              <span>
                Próximo vencimento: <b className="tabular text-ink-900">{dataBR(dados.contratoAtivo.proximoVencimento)}</b>
              </span>
            </div>
            {podeGerenciar && !faturaPendenteAtiva && (
              <div className="flex items-center gap-2">
                <Button
                  tamanho="sm"
                  variante="secundario"
                  disabled={ocupado}
                  onClick={async () => {
                    setOcupado(true);
                    const r = await emitirProximaFaturaAssinatura({ assinaturaId: dados.contratoAtivo!.id });
                    setOcupado(false);
                    toast(r.ok ? (r.aviso ?? "Fatura emitida.") : r.erro, r.ok ? "ok" : "erro");
                    if (r.ok && r.faturaId && r.statusFatura === "pendente") {
                      setFaturaAbertaId(r.faturaId);
                    }
                  }}
                >
                  Antecipar próxima fatura
                </Button>
                {!mostrarCabecalho && (
                  <>
                    <Button
                      tamanho="sm"
                      variante="secundario"
                      onClick={() => {
                        setPrefCiclo(dados.contratoAtivo!.ciclo);
                        setPrefForma(dados.contratoAtivo!.formaPagamento);
                        setPrefEmail(dados.contratoAtivo!.emailCobranca);
                        setModalPreferencias(true);
                      }}
                    >
                      Alterar cobrança
                    </Button>
                    <Button
                      tamanho="sm"
                      variante="fantasma"
                      onClick={() => {
                        setMotivoCancelamento("");
                        setCancelarImediato(false);
                        setModalCancelar(true);
                      }}
                    >
                      Cancelar
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Vitrine de Planos + Seletor Mensal / Anual */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-bold text-ink-900">Planos NKWAY por porte (MEI, ME e Simples Nacional)</h2>
            <p className="text-[12px] text-ink-400">
              Contratação vinculada ao CNPJ da empresa · sem fidelidade no ciclo mensal e {DESCONTO_ANUAL_PCT}% de desconto no ciclo anual
            </p>
          </div>
          <div className="inline-flex rounded-lg bg-ink-100 p-0.5 text-[12px] font-semibold">
            <button
              type="button"
              onClick={() => setCicloVitrine("mensal")}
              className={cn(
                "rounded-md px-3 py-1.5 transition",
                cicloVitrine === "mensal" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500",
              )}
            >
              Ciclo Mensal
            </button>
            <button
              type="button"
              onClick={() => setCicloVitrine("anual")}
              className={cn(
                "rounded-md px-3 py-1.5 transition",
                cicloVitrine === "anual" ? "bg-white text-ink-900 shadow-sm" : "text-ink-500",
              )}
            >
              Anual <span className="text-way-700">−{DESCONTO_ANUAL_PCT}%</span>
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {PLANOS_CFG.map((p) => {
            const calc = calcularPrecoAssinatura(p.id, cicloVitrine);
            const ehPlanoAtual = p.id === dados.planoAtual.id;
            const contratoMesmoPlano =
              dados.contratoAtivo &&
              dados.contratoAtivo.planoId === p.id &&
              dados.contratoAtivo.ciclo === cicloVitrine &&
              dados.contratoAtivo.status === "ativa";

            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-xl border p-4 transition",
                  ehPlanoAtual ? "border-way-300 bg-way-50/50 ring-1 ring-way-100" : "border-ink-100 bg-white",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[14px] font-bold text-ink-900">{p.nome}</p>
                  {ehPlanoAtual && <Badge tom="ok">Em vigor</Badge>}
                </div>
                <p className="tabular mt-1.5 text-[24px] font-black leading-none text-ink-900">
                  {p.preco === 0 ? "R$ 0" : moeda(calc.mensalEquivalente)}
                  <span className="text-[11.5px] font-semibold text-ink-400">/mês</span>
                </p>
                <p className="mt-1 min-h-[18px] text-[11px] text-way-700">
                  {p.preco > 0 && cicloVitrine === "anual"
                    ? `${moeda(calc.valorCiclo)}/ano (economia de ${moeda(calc.economiaAnual)})`
                    : p.preco > 0
                      ? "renovação mensal automática por CNPJ"
                      : "gratuito para sempre nos limites básicos"}
                </p>

                <ul className="mt-3 flex-1 space-y-1.5 text-[12px] text-ink-600">
                  {p.recursos.map((r) => (
                    <li key={r} className="flex items-start gap-1.5">
                      <Icon name="check" className="mt-0.5 size-3.5 shrink-0 text-way-600" strokeWidth={2.6} />
                      {r}
                    </li>
                  ))}
                </ul>

                <p className="mt-3 border-t border-ink-100 pt-2 text-[11px] text-ink-400">
                  até <b>{p.limiteProdutos.toLocaleString("pt-BR")}</b> produtos · <b>{p.limiteUsuarios}</b> usuário(s)
                </p>

                {podeGerenciar ? (
                  p.preco === 0 ? (
                    <Button
                      className="mt-3 w-full"
                      variante="secundario"
                      disabled={ehPlanoAtual || ocupado}
                      onClick={() => {
                        setMotivoCancelamento("Migração voluntária para o plano gratuito MEI Start");
                        setCancelarImediato(true);
                        setModalCancelar(true);
                      }}
                    >
                      {ehPlanoAtual ? "Plano gratuito ativo" : "Voltar ao gratuito"}
                    </Button>
                  ) : (
                    <Button
                      className="mt-3 w-full"
                      variante={contratoMesmoPlano ? "secundario" : "primario"}
                      disabled={Boolean(contratoMesmoPlano) || ocupado}
                      onClick={() => abrirCheckout(p.id)}
                    >
                      {contratoMesmoPlano
                        ? "Assinatura ativa neste ciclo"
                        : ehPlanoAtual && dados.trialDias !== null
                          ? "Ativar assinatura definitiva"
                          : `Assinar ${p.nome}`}
                    </Button>
                  )
                ) : (
                  <p className="mt-3 text-center text-[11px] text-ink-400">
                    Gerenciado pelo Administrador da empresa
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Histórico de Faturas e Recibos */}
      <Card padding={false}>
        <div className="p-4 pb-2">
          <CardTitulo
            titulo="Histórico de faturas e cobranças do CNPJ"
            descricao="2ª via de QR Code PIX, boletos registrados, comprovantes de quitação e conciliação de webhooks"
            icone="carteira"
          />
          <BarraFiltros className="mb-0 mt-2 border-0 p-0">
            <FiltroMulti
              rotulo="Situação da fatura"
              selecionados={statusFaturaSel}
              aoAlternar={(v) => setStatusFaturaSel(alternarItem(statusFaturaSel, v))}
              opcoes={(Object.keys(ROTULO_STATUS_FATURA) as StatusFaturaAssinatura[]).map((st) => ({
                valor: st,
                rotulo: ROTULO_STATUS_FATURA[st].rotulo,
                contagem: dados.faturas.filter((f) => f.status === st).length,
              }))}
            />
            <FiltroMulti
              rotulo="Forma de pagamento"
              selecionados={formasFaturaSel}
              aoAlternar={(v) => setFormasFaturaSel(alternarItem(formasFaturaSel, v))}
              opcoes={FORMAS_ASSINATURA.map((fa) => ({
                valor: fa.id,
                rotulo: fa.rotulo,
                contagem: dados.faturas.filter((f) => f.formaPagamento === fa.id).length,
              }))}
            />
            {(statusFaturaSel.length > 0 || formasFaturaSel.length > 0) && (
              <Button
                tamanho="sm"
                variante="fantasma"
                onClick={() => {
                  setStatusFaturaSel([]);
                  setFormasFaturaSel([]);
                }}
              >
                Limpar filtros
              </Button>
            )}
          </BarraFiltros>
        </div>

        <div className="px-4 pb-4">
          <Tabela
            colunas={colunasFaturas}
            linhas={faturasFiltradas}
            chave={(f) => f.id}
            nomeExportar="nkway-faturas-assinatura"
            tamanhoPagina={10}
            vazio="Nenhuma fatura gerada até o momento. Selecione um plano acima para iniciar a assinatura recorrente por CNPJ."
          />
        </div>
      </Card>

      {/* Modal: Checkout Corporativo por CNPJ */}
      <Modal
        aberto={Boolean(planoCheckout && precoCheckout)}
        aoFechar={() => setPlanoCheckout(null)}
        titulo={precoCheckout ? `Contratar NKWAY ${precoCheckout.planoNome}` : "Contratar assinatura"}
        descricao="Faturamento corporativo vinculado ao CNPJ com renovação automática e trilha de auditoria"
        largura="max-w-xl"
        rodape={
          <div className="flex items-center justify-between gap-2">
            <span className="tabular text-[13px] font-bold text-ink-900">
              Total do ciclo: {precoCheckout ? moeda(precoCheckout.valorCiclo) : "—"}
            </span>
            <div className="flex gap-2">
              <Button variante="secundario" onClick={() => setPlanoCheckout(null)}>
                Cancelar
              </Button>
              <Button icone="cadeado" disabled={ocupado} onClick={confirmarCheckout}>
                {ocupado
                  ? "Comunicando gateway…"
                  : formaCheckout === "cartao"
                    ? "Autorizar e ativar plano"
                    : formaCheckout === "pix"
                      ? "Gerar QR Code PIX"
                      : "Emitir Boleto CNPJ"}
              </Button>
            </div>
          </div>
        }
      >
        {precoCheckout && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-ink-50 p-1.5">
              {(["mensal", "anual"] as const).map((c) => {
                const info = calcularPrecoAssinatura(precoCheckout.planoId, c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCicloCheckout(c)}
                    className={cn(
                      "rounded-lg px-3 py-2 text-left transition",
                      cicloCheckout === c ? "bg-white shadow-sm ring-1 ring-way-300" : "text-ink-500 hover:bg-white/60",
                    )}
                  >
                    <p className="text-[12px] font-bold capitalize text-ink-900">
                      {c} {c === "anual" && <span className="text-way-700">(−{DESCONTO_ANUAL_PCT}%)</span>}
                    </p>
                    <p className="tabular text-[12px] text-ink-600">
                      {c === "anual" ? `${moeda(info.valorCiclo)}/ano (${moeda(info.mensalEquivalente)}/mês)` : `${moeda(info.valorCiclo)}/mês`}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="CNPJ titular do contrato (14 dígitos)" obrigatorio>
                <Input
                  valor={cnpjCheckout}
                  aoMudar={(v) => setCnpjCheckout(mascaraDocumento(v))}
                  className="font-mono"
                  placeholder="00.000.000/0000-00"
                />
              </Campo>
              <Campo rotulo="E-mail financeiro (faturas / NFS-e)" obrigatorio>
                <Input
                  valor={emailCheckout}
                  aoMudar={setEmailCheckout}
                  placeholder="financeiro@empresa.com.br"
                />
              </Campo>
              <Campo rotulo="Razão social" obrigatorio className="sm:col-span-2">
                <Input valor={razaoCheckout} aoMudar={setRazaoCheckout} />
              </Campo>
            </div>

            <div>
              <span className="micro mb-1.5 block text-ink-400">Forma de pagamento recorrente</span>
              <div className="grid gap-2 sm:grid-cols-3">
                {FORMAS_ASSINATURA.map((fa) => (
                  <button
                    key={fa.id}
                    type="button"
                    onClick={() => setFormaCheckout(fa.id)}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition",
                      formaCheckout === fa.id
                        ? "border-way-400 bg-way-50/70 ring-1 ring-way-200"
                        : "border-ink-100 bg-white hover:bg-ink-50",
                    )}
                  >
                    <p className="text-[12.5px] font-bold text-ink-900">{fa.rotulo}</p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-ink-400">{fa.descricao}</p>
                  </button>
                ))}
              </div>
            </div>

            {formaCheckout === "cartao" && (
              <div className="space-y-2.5 rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                <p className="text-[11.5px] font-semibold text-ink-700">
                  Dados do cartão corporativo (validados em memória — apenas bandeira e 4 últimos dígitos são guardados)
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Campo rotulo="Número do cartão" obrigatorio className="sm:col-span-2">
                    <Input
                      valor={cartaoNumero}
                      aoMudar={setCartaoNumero}
                      className="font-mono"
                      placeholder="0000 0000 0000 0000"
                    />
                  </Campo>
                  <Campo rotulo="Nome impresso no cartão" obrigatorio className="sm:col-span-2">
                    <Input
                      valor={cartaoTitular}
                      aoMudar={setCartaoTitular}
                      placeholder="NOME DO PORTADOR"
                    />
                  </Campo>
                  <Campo rotulo="Validade (MM/AA)" obrigatorio>
                    <Input valor={cartaoValidade} aoMudar={setCartaoValidade} className="font-mono" placeholder="12/29" />
                  </Campo>
                  <Campo rotulo="CVV" obrigatorio>
                    <Input type="password" valor={cartaoCvv} aoMudar={setCartaoCvv} className="font-mono" placeholder="123" />
                  </Campo>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: 2ª Via PIX QR Code / Boleto / Recibo */}
      <Modal
        aberto={Boolean(faturaAberta)}
        aoFechar={() => setFaturaAbertaId(null)}
        titulo={faturaAberta ? `Fatura #${String(faturaAberta.numero).padStart(4, "0")} · ${faturaAberta.planoNome}` : "Fatura"}
        descricao={
          faturaAberta
            ? `CNPJ ${mascaraDocumento(faturaAberta.cnpj)} · Vencimento ${dataBR(faturaAberta.vencimento)} · Gateway ${faturaAberta.gateway.toUpperCase()}`
            : ""
        }
        largura="max-w-lg"
        rodape={
          faturaAberta && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {podeGerenciar && faturaAberta.status === "pendente" && faturaAberta.gateway === "sandbox" && (
                  <Button
                    variante="suave"
                    icone="check"
                    disabled={ocupado}
                    onClick={async () => {
                      setOcupado(true);
                      const r = await confirmarPagamentoSandbox({ faturaId: faturaAberta.id });
                      setOcupado(false);
                      toast(r.ok ? (r.aviso ?? "Pagamento confirmado.") : r.erro, r.ok ? "ok" : "erro");
                    }}
                  >
                    Simular confirmação do Gateway (Webhook Pago)
                  </Button>
                )}
              </div>
              <Button variante="secundario" onClick={() => setFaturaAbertaId(null)}>
                Fechar
              </Button>
            </div>
          )
        }
      >
        {faturaAberta && (
          <div className="space-y-3.5 text-[12.5px]">
            <div className="flex items-center justify-between rounded-xl bg-ink-50 px-3.5 py-2.5">
              <div>
                <span className="micro block text-ink-400">Valor da fatura ({faturaAberta.ciclo})</span>
                <b className="tabular text-[20px] font-black text-ink-900">{moeda(faturaAberta.valor)}</b>
              </div>
              <Badge tom={ROTULO_STATUS_FATURA[faturaAberta.status].tom}>
                {ROTULO_STATUS_FATURA[faturaAberta.status].rotulo}
              </Badge>
            </div>

            {faturaAberta.checkoutUrl && (
              <a
                href={faturaAberta.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl bg-way-600 px-4 py-2.5 text-center font-semibold text-white hover:bg-way-700"
              >
                Abrir link oficial de pagamento no Gateway →
              </a>
            )}

            {faturaAberta.pixPayload && (
              <div className="space-y-3 rounded-xl border border-ink-100 p-3.5 text-center">
                <p className="font-semibold text-ink-800">Escaneie o QR Code PIX (padrão Banco Central EMV)</p>
                <div className="mx-auto w-fit rounded-xl border border-ink-100 bg-white p-2 shadow-sm">
                  <QrCode valor={faturaAberta.pixPayload} tamanho={168} />
                </div>
                <div className="text-left">
                  <span className="micro mb-1 block text-ink-400">PIX Copia e Cola</span>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={faturaAberta.pixPayload}
                      className="w-full rounded-lg bg-ink-50 px-2.5 py-1.5 font-mono text-[11px] text-ink-700 ring-1 ring-inset ring-ink-200"
                    />
                    <Button
                      tamanho="sm"
                      variante="secundario"
                      onClick={() => void copiarTexto(faturaAberta.pixPayload, "Código PIX")}
                    >
                      Copiar
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {faturaAberta.linhaDigitavel && (
              <div className="space-y-2 rounded-xl border border-ink-100 p-3.5">
                <span className="micro block text-ink-400">Linha digitável do Boleto Registrado (47 dígitos)</span>
                <p className="rounded-lg bg-ink-50 p-2.5 font-mono text-[12px] font-bold tracking-tight text-ink-900">
                  {faturaAberta.linhaDigitavel}
                </p>
                <div className="flex justify-end">
                  <Button
                    tamanho="sm"
                    variante="secundario"
                    onClick={() => void copiarTexto(faturaAberta.linhaDigitavel, "Linha digitável")}
                  >
                    Copiar linha digitável
                  </Button>
                </div>
              </div>
            )}

            {faturaAberta.status === "paga" && (
              <div className="rounded-xl border border-way-200 bg-way-50/60 p-3 text-way-900">
                <p className="font-bold">Pagamento conciliado com sucesso</p>
                <p className="mt-0.5 text-[11.5px]">
                  Quitada em <b>{dataHoraBR(faturaAberta.pagoEm)}</b>
                  {faturaAberta.nsuAutorizacao ? ` · Autorização/NSU: ${faturaAberta.nsuAutorizacao}` : ""}
                  {faturaAberta.gatewayPaymentId ? ` · ID Gateway: ${faturaAberta.gatewayPaymentId}` : ""}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: Preferências da Próxima Renovação */}
      <Modal
        aberto={modalPreferencias}
        aoFechar={() => setModalPreferencias(false)}
        titulo="Preferências de cobrança recorrente"
        descricao="As alterações valem para as próximas renovações automáticas do contrato CNPJ"
        largura="max-w-md"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setModalPreferencias(false)}>
              Cancelar
            </Button>
            <Button
              icone="check"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await atualizarPreferenciaRecorrencia({
                  assinaturaId: dados.contratoAtivo?.id,
                  ciclo: prefCiclo,
                  formaPagamento: prefForma,
                  emailCobranca: prefEmail,
                });
                setOcupado(false);
                toast(r.ok ? (r.aviso ?? "Atualizado.") : r.erro, r.ok ? "ok" : "erro");
                if (r.ok) setModalPreferencias(false);
              }}
            >
              Salvar preferências
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo rotulo="Ciclo de renovação">
            <Select
              valor={prefCiclo}
              aoMudar={(v) => setPrefCiclo(v as CicloAssinatura)}
              opcoes={[
                { valor: "mensal", rotulo: "Mensal (sem fidelidade)" },
                { valor: "anual", rotulo: `Anual (${DESCONTO_ANUAL_PCT}% de desconto)` },
              ]}
            />
          </Campo>
          <Campo rotulo="Meio de pagamento da próxima fatura">
            <Select
              valor={prefForma}
              aoMudar={(v) => setPrefForma(v as FormaAssinatura)}
              opcoes={FORMAS_ASSINATURA.map((f) => ({ valor: f.id, rotulo: f.rotulo }))}
            />
          </Campo>
          <Campo rotulo="E-mail financeiro para envio de faturas">
            <Input valor={prefEmail} aoMudar={setPrefEmail} />
          </Campo>
        </div>
      </Modal>

      {/* Modal: Cancelamento Auditado */}
      <Modal
        aberto={modalCancelar}
        aoFechar={() => setModalCancelar(false)}
        titulo="Cancelar assinatura recorrente"
        descricao="Seus produtos, vendas e histórico fiscal permanecem salvos no NKWAY"
        largura="max-w-md"
        rodape={
          <div className="flex justify-end gap-2">
            <Button variante="secundario" onClick={() => setModalCancelar(false)}>
              Manter assinatura
            </Button>
            <Button
              variante="perigo"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await cancelarAssinaturaCnpj({
                  motivo: motivoCancelamento,
                  imediato: cancelarImediato,
                });
                setOcupado(false);
                toast(r.ok ? (r.aviso ?? "Assinatura cancelada.") : r.erro, r.ok ? "ok" : "erro");
                if (r.ok) setModalCancelar(false);
              }}
            >
              {ocupado ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Area
            rotulo="Motivo do cancelamento (registrado na auditoria)"
            valor={motivoCancelamento}
            aoMudar={setMotivoCancelamento}
            linhas={2}
            placeholder="Conte brevemente o motivo (ex.: pausa sazonal, ajuste de custos)..."
          />
          {dados.contratoAtivo?.status === "ativa" && (
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-[12px] text-ink-700">
              <input
                type="checkbox"
                checked={cancelarImediato}
                onChange={(e) => setCancelarImediato(e.target.checked)}
                className="mt-0.5 size-4 accent-rose-600"
              />
              <span>
                <b>Voltar imediatamente ao plano gratuito MEI Start</b> (desmarcado = mantém os recursos pagos até{" "}
                {dataBR(dados.contratoAtivo.proximoVencimento)} sem renovar).
              </span>
            </label>
          )}
        </div>
      </Modal>
    </div>
  );
}
