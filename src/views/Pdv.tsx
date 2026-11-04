"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Impressao, type AlvoImpresso } from "@/components/Impressao";
import { ModalFechamentoCego } from "@/components/ModalFechamentoCego";
import { Tabela, type Coluna } from "@/components/Tabela";
import {
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  FiltroPeriodo,
  Icon,
  Input,
  Modal,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import {
  CHAVE_TELA_CHEIA,
  consumirFalhaRecenteTelaCheia,
  obterPromessaTelaCheiaAtiva,
  solicitarTelaCheiaElemento,
} from "@/lib/abrirPdv";
import { ATALHOS_PDV, FORMAS_ATALHO_ALT } from "@/lib/atalhosPdv";
import type { Emitente } from "@/lib/danfe";
import {
  CHAVE_ESPERA_PDV,
  CHAVE_ETIQUETA_BALANCA_PDV,
  calcularTributosProdutoPdv,
  consultarProdutosPrecoPdv,
  decodificarEtiquetaBalancaPdv,
  removerVendaDeEsperaPdv,
  retomarVendaDeEsperaPdv,
  sanitizarListaEsperaPdv,
  suspenderVendaParaEsperaPdv,
  type ModoEtiquetaBalancaPdv,
  type VendaEmEsperaPdv,
} from "@/lib/balcaoPdv";
import {
  ESTADO_MULTIPLICADOR_INICIAL,
  aplicarAdicaoItemPdv,
  formatarQtdPdv,
  normalizarQtdPdv,
  podeIniciarMultiplicadorPdv,
  resolverProdutoPorCodigoOuBusca,
  transicionarMultiplicadorPdv,
  type EstadoMultiplicadorPdv,
  type LinhaItemPdv,
} from "@/lib/multiplicadorPdv";
import {
  MODELOS_FISCAIS_PDV,
  avancarAposLancamentoParcelaPdv,
  ciclarFormaPagamentoPdv,
  ciclarModeloFiscalPdv,
  criarEstadoInicialFinalizarPdv,
  processarTeclaFinalizarPdv,
  resolverOpcaoFechamentoValidaPdv,
  type BotaoConfirmacaoFiscalPdv,
  type EstadoNavegacaoFinalizarPdv,
  type ModeloFiscalPdv,
  type OpcaoFechamentoPdv,
} from "@/lib/navegacaoFinalizarPdv";
import {
  SUGESTOES_MOTIVO_GAVETA_PDV,
  carregarDavParaTelaPdv,
  converterReciboParaDocFiscalPdv,
  montarReciboDeFechamentoPdv,
  montarReciboDeVendaDtoPdv,
  resumirFilaOfflinePdv,
  sanitizarFilaOfflinePdv,
  validarCancelamentoDocumentoPdv,
  validarMovimentoGavetaPdv,
  type ItemFilaOfflinePdv,
  type ReciboTermicoPdv,
} from "@/lib/operacoesPdv";
import {
  calcularResumoPagamentoPdv,
  editarParcelaPagamentoPdv,
  lerValorMonetarioPdv,
  registrarParcelaPagamentoPdv,
  sugerirCedulasDinheiroPdv,
  validarCreditoVendaPdv,
} from "@/lib/pagamentoPdv";
import {
  FORMAS_PAGAMENTO,
  dataHoraBR,
  formatChave,
  hojeISO,
  moeda,
  rotuloForma,
  round2,
  somaDias,
  tributosEstimados,
} from "@/lib/dominio";
import type { Periodo } from "@/lib/filtros";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import { ROTULO_SITUACAO_FISCAL } from "@/lib/situacaoFiscal";
import { abrirCaixa, registrarMovimentoCaixa } from "@/server/acoes/caixa";
import {
  buscarDocumentosPdv,
  cancelarVenda,
  emitirNfceDaVenda,
  faturarDav,
  registrarDav,
  registrarVenda,
  registrarVendaSemNota,
  type ItemPdv,
  type Pagamento,
} from "@/server/acoes/pdv";
import type { ProdutoDto, VendaDto } from "@/server/dados";

type Linha = LinhaItemPdv;

type ClienteOpcao = {
  id: string;
  nome: string;
  documento: string;
  condicaoPadrao: string;
  limiteCredito: number;
  saldoEmAberto: number;
};

const CHAVE_FILA = "nkway.fila";

const EMITENTE_PADRAO: Emitente = {
  nome: "EMPRESA",
  fantasia: "EMPRESA",
  cnpj: "",
  ie: "",
  regime: "mei",
  endereco: "",
  municipio: "",
  uf: "RO",
  codMunicipio: "",
};

/** Rótulos do estado lógico da gaveta — nenhum valor monetário aparece ao operador. */
const ROTULO_ESTADO_GAVETA: Record<"normal" | "alerta" | "bloqueado", string> = {
  normal: "Gaveta normal",
  alerta: "Limite de segurança atingido · realize uma sangria",
  bloqueado: "Sangria obrigatória · venda em dinheiro bloqueada",
};

export function PdvView({
  produtos,
  clientes,
  empresa,
  emitente,
  cscId = "00000000",
  usuario = { nome: "Operador", papel: "administrador" },
  sessaoCaixa = null,
}: {
  produtos: ProdutoDto[];
  clientes: ClienteOpcao[];
  empresa: {
    nome: string;
    fantasia: string;
    cnpj: string;
    documento: string;
    endereco: string;
    municipio: string;
    ambiente: string;
  };
  emitente?: Emitente;
  cscId?: string;
  usuario?: { nome: string; papel: PerfilUsuario };
  /** Blind balance: só o estado lógico chega ao cliente, nunca valores esperados. */
  sessaoCaixa?: {
    id: string;
    numero: number;
    terminal: string;
    operadorNome: string;
    estadoGaveta: "normal" | "alerta" | "bloqueado";
    bloquearVendaDinheiro: boolean;
  } | null;
}) {
  const toast = useToast();
  const router = useRouter();

  // Alerta de segurança da gaveta: o servidor envia só o estado, nunca o valor.
  const estadoGaveta = sessaoCaixa?.estadoGaveta ?? "normal";
  useEffect(() => {
    if (estadoGaveta === "alerta") toast("Limite de segurança atingido. Realize uma sangria.", "info");
    if (estadoGaveta === "bloqueado") {
      toast("Gaveta acima de 120% do limite. Venda em dinheiro bloqueada até a sangria.", "erro");
    }
  }, [estadoGaveta, toast]);

  const emitenteFinal: Emitente = emitente ?? {
    ...EMITENTE_PADRAO,
    nome: empresa.nome,
    fantasia: empresa.fantasia || empresa.nome,
    cnpj: empresa.cnpj,
    endereco: empresa.endereco,
    municipio: empresa.municipio,
  };

  const podeVenderFiscal = temPermissao(usuario.papel, "pdv.vender");
  const podeCriarDav = temPermissao(usuario.papel, "dav.criar");
  const podeFaturarDav = temPermissao(usuario.papel, "dav.faturar");
  const podeAbrirCaixa = temPermissao(usuario.papel, "caixa.abrir");
  const podeMovimentarCaixa = temPermissao(usuario.papel, "caixa.movimentar");
  const podeFecharCaixa = temPermissao(usuario.papel, "caixa.fechar");
  const podeCancelarVenda = temPermissao(usuario.papel, "venda.cancelar");

  const [modalAbrirCaixa, setModalAbrirCaixa] = useState(false);
  const [acaoAposAbrirCaixa, setAcaoAposAbrirCaixa] = useState<"sem_nota" | "emitir_nfce" | null>(null);
  const [terminalRapido, setTerminalRapido] = useState("CAIXA 1");
  const [saldoRapido, setSaldoRapido] = useState("100,00");

  const ativos = useMemo(() => produtos.filter((p) => p.ativo), [produtos]);

  const [termo, setTermo] = useState("");
  const [cursor, setCursor] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [pilhaDesfazer, setPilhaDesfazer] = useState<Linha[]>([]);
  const [multiplicador, setMultiplicador] = useState<EstadoMultiplicadorPdv>(ESTADO_MULTIPLICADOR_INICIAL);
  const [descontoModo, setDescontoModo] = useState<"real" | "percentual">("real");
  const [descontoValor, setDescontoValor] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [recebido, setRecebido] = useState("");
  const [modelo, setModelo] = useState<"NFC-e" | "NF-e" | "SAT">("NFC-e");
  const [validadeDav, setValidadeDav] = useState(somaDias(hojeISO(), 3));
  const [cupom, setCupom] = useState<ReciboTermicoPdv | null>(null);
  /** Etapa 3 — fechamento às cegas direto na tela de vendas */
  const [modalFechamentoCego, setModalFechamentoCego] = useState(false);

  // Complemento PDV 3 de 3 — DAV carregado no caixa, Gaveta rápida (Alt+G), Cancelamento em F3 e Inspetor de Fila Offline
  const [davCarregado, setDavCarregado] = useState<{ id: string; numero: number } | null>(null);
  const [modalGaveta, setModalGaveta] = useState(false);
  const [tipoGaveta, setTipoGaveta] = useState<"sangria" | "suprimento">("sangria");
  const [formaGaveta, setFormaGaveta] = useState<string>("dinheiro");
  const [valorGaveta, setValorGaveta] = useState<string>("");
  const [motivoGaveta, setMotivoGaveta] = useState<string>("");
  const [docCancelando, setDocCancelando] = useState<VendaDto | null>(null);
  const [motivoCancelamentoDoc, setMotivoCancelamentoDoc] = useState<string>("");
  const [modalFilaOffline, setModalFilaOffline] = useState(false);
  const [itensFilaOffline, setItensFilaOffline] = useState<ItemFilaOfflinePdv[]>([]);

  // Modais das Etapas 2, 4, 9 e 10
  const [modalSaida, setModalSaida] = useState(false);
  const [destinoSaida, setDestinoSaida] = useState("/");
  const [modalAjuda, setModalAjuda] = useState(false);
  const [modalCancelarVenda, setModalCancelarVenda] = useState(false);
  const [abertoCliente, setAbertoCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [cursorCliente, setCursorCliente] = useState(0);
  const [retornarAoFinalizarAposCliente, setRetornarAoFinalizarAposCliente] = useState(false);
  const [modalFinalizar, setModalFinalizar] = useState(false);
  const [confirmandoEmissaoNfce, setConfirmandoEmissaoNfce] = useState(false);

  // Complemento PDV 2 de 3 + Navegação 100% Teclado no F10
  const [formaAtivaModal, setFormaAtivaModal] = useState<string>("dinheiro");
  const [valorParcelaModal, setValorParcelaModal] = useState<string>("");
  const [msgPagamentoModal, setMsgPagamentoModal] = useState<{ tom: "ok" | "info" | "erro"; texto: string } | null>(
    null,
  );
  const [navFinalizar, setNavFinalizar] = useState<EstadoNavegacaoFinalizarPdv>({
    secao: "formas",
    formaAtiva: "dinheiro",
    modeloFiscal: "NFC-e",
    opcaoFechamento: "emitir_nfce",
    botaoConfirmacao: "confirmar",
  });
  const [modalConsultaPreco, setModalConsultaPreco] = useState(false);
  const [buscaConsultaPreco, setBuscaConsultaPreco] = useState("");
  const [indiceConsultaPreco, setIndiceConsultaPreco] = useState(0);
  const [modalEspera, setModalEspera] = useState(false);
  const [vendasEspera, setVendasEspera] = useState<VendaEmEsperaPdv[]>([]);
  const [rotuloNovaEspera, setRotuloNovaEspera] = useState("");
  const [modoEtiquetaBalanca, setModoEtiquetaBalanca] = useState<ModoEtiquetaBalancaPdv>("peso");

  // Etapa 3 — Tela cheia do navegador e preferência localStorage
  const [emTelaCheia, setEmTelaCheia] = useState(false);
  const [aguardandoGestoTelaCheia, setAguardandoGestoTelaCheia] = useState(false);

  // Etapa 5 — Estado de conectividade e fila offline
  const [online, setOnline] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [fila, setFila] = useState<number>(0);
  const [editando, setEditando] = useState<string | null>(null);

  // Etapa 10 — Busca paginada de documentos no servidor + Impressao
  const [modalDocumentos, setModalDocumentos] = useState(false);
  const [docBusca, setDocBusca] = useState("");
  const [docTipo, setDocTipo] = useState<"todos" | "fiscal" | "sem_nota" | "dav">("todos");
  const [docSituacao, setDocSituacao] = useState("todas");
  const [docPeriodo, setDocPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [docPagina, setDocPagina] = useState(1);
  const [docTotal, setDocTotal] = useState(0);
  const [docTotalPaginas, setDocTotalPaginas] = useState(1);
  const [docItens, setDocItens] = useState<VendaDto[]>([]);
  const [docCarregando, setDocCarregando] = useState(false);
  const [imprimindo, setImprimindo] = useState<AlvoImpresso | null>(null);

  const buscaRef = useRef<HTMLInputElement>(null);
  const descontoRef = useRef<HTMLInputElement>(null);
  const valorParcelaModalRef = useRef<HTMLInputElement>(null);
  const formasModalRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const modelosModalRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const opcoesModalRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const confirmacaoModalRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const formasLateralRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const modelosLateralRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const iniciouDigitacaoDiretaRef = useRef<boolean>(false);
  const linhasRef = useRef<Linha[]>([]);
  const multiplicadorRef = useRef<EstadoMultiplicadorPdv>(ESTADO_MULTIPLICADOR_INICIAL);
  const ultimoAutoScanRef = useRef<{ codigo: string; ts: number }>({ codigo: "", ts: 0 });
  const navegouListaRef = useRef<boolean>(false);

  const atualizarLinhas = useCallback((acao: Linha[] | ((atual: Linha[]) => Linha[])) => {
    setLinhas((atual) => {
      const novas = typeof acao === "function" ? acao(atual) : acao;
      linhasRef.current = novas;
      return novas;
    });
  }, []);

  const persistirVendasEspera = useCallback((novaLista: VendaEmEsperaPdv[]) => {
    setVendasEspera(novaLista);
    try {
      localStorage.setItem(CHAVE_ESPERA_PDV, JSON.stringify(novaLista));
    } catch {
      /* storage indisponível */
    }
  }, []);

  const alternarModoEtiquetaBalanca = useCallback((novoModo: ModoEtiquetaBalancaPdv) => {
    setModoEtiquetaBalanca(novoModo);
    try {
      localStorage.setItem(CHAVE_ETIQUETA_BALANCA_PDV, novoModo);
    } catch {
      /* storage indisponível */
    }
  }, []);

  const atualizarMultiplicador = useCallback((novo: EstadoMultiplicadorPdv) => {
    multiplicadorRef.current = novo;
    if (novo.status === "armado" && novo.ultimaTransicao === "armada") {
      navegouListaRef.current = false;
    }
    setMultiplicador(novo);
  }, []);

  const persistirFilaOffline = useCallback((lista: ItemFilaOfflinePdv[]) => {
    setItensFilaOffline(lista);
    setFila(lista.length);
    try {
      localStorage.setItem(CHAVE_FILA, JSON.stringify(lista));
    } catch {
      /* storage indisponível */
    }
  }, []);

  const atualizarContagemFila = useCallback(() => {
    try {
      const bruta = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
      const limpa = sanitizarFilaOfflinePdv(bruta);
      setItensFilaOffline(limpa);
      setFila(limpa.length);
    } catch {
      setItensFilaOffline([]);
      setFila(0);
    }
  }, []);

  // Inicialização: foco na bipagem, leitura da fila offline, vendas em espera, etiqueta de balança e tela cheia
  useEffect(() => {
    buscaRef.current?.focus();
    atualizarContagemFila();
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    try {
      const salvasEspera = JSON.parse(localStorage.getItem(CHAVE_ESPERA_PDV) ?? "[]");
      setVendasEspera(sanitizarListaEsperaPdv(salvasEspera));
      const modoBal = localStorage.getItem(CHAVE_ETIQUETA_BALANCA_PDV);
      if (modoBal === "valor" || modoBal === "peso") setModoEtiquetaBalanca(modoBal);
    } catch {
      /* ignora */
    }

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    const onFullscreenChange = () => {
      const ativo = Boolean(document.fullscreenElement);
      setEmTelaCheia(ativo);
      if (ativo) setAguardandoGestoTelaCheia(false);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    let cancelado = false;
    const promessaEmAndamento = obterPromessaTelaCheiaAtiva();

    if (document.fullscreenElement) {
      setEmTelaCheia(true);
      setAguardandoGestoTelaCheia(false);
    } else if (promessaEmAndamento) {
      // Pedido já iniciado no clique/atalho que abriu /pdv: aguarda sem disparar segundo requestFullscreen simultâneo
      void promessaEmAndamento.then((entrou) => {
        if (cancelado) return;
        const ativo = entrou || Boolean(document.fullscreenElement);
        setEmTelaCheia(ativo);
        if (!ativo) setAguardandoGestoTelaCheia(true);
      });
    } else if (consumirFalhaRecenteTelaCheia()) {
      // O pedido feito no gesto de abertura já foi recusado antes da montagem: ativa direto o aviso de fallback atual
      setAguardandoGestoTelaCheia(true);
    } else {
      try {
        const pref = localStorage.getItem(CHAVE_TELA_CHEIA);
        if (pref === "true" && !document.fullscreenElement) {
          void solicitarTelaCheiaElemento().then((entrou) => {
            if (cancelado) return;
            const ativo = entrou || Boolean(document.fullscreenElement);
            setEmTelaCheia(ativo);
            if (!ativo) setAguardandoGestoTelaCheia(true);
          });
        }
      } catch {
        /* storage indisponível */
      }
    }

    return () => {
      cancelado = true;
      multiplicadorRef.current = ESTADO_MULTIPLICADOR_INICIAL;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, [atualizarContagemFila]);

  // Etapa 3 — Entrar em tela cheia automaticamente no primeiro gesto (clique ou tecla) quando pendente
  useEffect(() => {
    if (!aguardandoGestoTelaCheia) return;

    const entrarNoPrimeiroGesto = (ev: Event) => {
      if (ev instanceof KeyboardEvent && ev.key === "Escape") return;
      setAguardandoGestoTelaCheia(false);
      if (!document.fullscreenElement) {
        void solicitarTelaCheiaElemento().then((entrou) => {
          if (entrou || document.fullscreenElement) setEmTelaCheia(true);
        });
      }
    };

    window.addEventListener("pointerdown", entrarNoPrimeiroGesto, { once: true });
    window.addEventListener("keydown", entrarNoPrimeiroGesto, { once: true });
    return () => {
      window.removeEventListener("pointerdown", entrarNoPrimeiroGesto);
      window.removeEventListener("keydown", entrarNoPrimeiroGesto);
    };
  }, [aguardandoGestoTelaCheia]);

  const alternarTelaCheia = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        const entrou = await solicitarTelaCheiaElemento({ gravarPreferencia: true });
        if (entrou || document.fullscreenElement) {
          setEmTelaCheia(true);
          setAguardandoGestoTelaCheia(false);
        } else {
          toast("Para tela cheia total, você também pode usar F11 no navegador.", "info");
        }
      } else {
        try {
          localStorage.setItem(CHAVE_TELA_CHEIA, "false");
        } catch {
          /* ignora */
        }
        setAguardandoGestoTelaCheia(false);
        await document.exitFullscreen();
        setEmTelaCheia(false);
      }
    } catch {
      toast("Para tela cheia total, você também pode usar F11 no navegador.", "info");
    }
    buscaRef.current?.focus();
  }, [toast]);

  const sairDaTelaCheiaSilencioso = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      /* ignora */
    }
  }, []);

  // Etapa 2 — Fluxo de saída e botão ← Voltar
  const solicitarSaidaPdv = useCallback(
    (destino = "/") => {
      if (linhas.length > 0) {
        setDestinoSaida(destino);
        setModalSaida(true);
        return;
      }
      atualizarMultiplicador(ESTADO_MULTIPLICADOR_INICIAL);
      void (async () => {
        await sairDaTelaCheiaSilencioso();
        router.push(destino);
      })();
    },
    [atualizarMultiplicador, linhas.length, router, sairDaTelaCheiaSilencioso],
  );

  const descartarVendaLocal = useCallback(() => {
    atualizarLinhas([]);
    setPilhaDesfazer([]);
    setPagamentos([]);
    setDescontoValor("");
    setRecebido("");
    setEditando(null);
    setTermo("");
    setCursor(0);
    setDavCarregado(null);
    atualizarMultiplicador(ESTADO_MULTIPLICADOR_INICIAL);
  }, [atualizarLinhas, atualizarMultiplicador]);

  const resultados = useMemo(() => {
    const t = termo.trim().toLowerCase();
    if (!t) return ativos.slice(0, 8);
    const digitado = t.replace(/\s+/g, " ");
    return ativos
      .map((p) => {
        const nome = p.nome.toLowerCase();
        let pontos = -1;
        if (p.gtin && digitado.length >= 8 && p.gtin.includes(digitado)) pontos = 1000;
        else if (p.sku.toLowerCase().startsWith(digitado)) pontos = 800;
        else if (nome.startsWith(digitado)) pontos = 500 + digitado.length * 2;
        else if (nome.includes(digitado)) pontos = 200;
        else if (nome.split(" ").some((w) => w.startsWith(digitado.split(" ")[0]))) pontos = 60;
        if (pontos < 0) return null;
        return { p, pontos: pontos + Math.min(50, p.estoque) };
      })
      .filter((x): x is { p: ProdutoDto; pontos: number } => !!x)
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 10)
      .map((x) => x.p);
  }, [termo, ativos]);

  const subtotal = round2(linhas.reduce((s, l) => s + l.qtd * l.preco, 0));
  const desconto = round2(
    Math.min(
      subtotal,
      descontoModo === "percentual"
        ? (subtotal * (Number(descontoValor.replace(",", ".")) || 0)) / 100
        : Number(descontoValor.replace(",", ".")) || 0,
    ),
  );
  const total = round2(subtotal - desconto);
  const resumoPagamento = useMemo(() => calcularResumoPagamentoPdv(pagamentos, total), [pagamentos, total]);
  const pago = resumoPagamento.pago;
  const falta = resumoPagamento.falta;
  const troco = resumoPagamento.troco;
  const unidadesBipadas = normalizarQtdPdv(linhas.reduce((s, l) => s + l.qtd, 0));
  const cliente = clientes.find((c) => c.id === clienteId) ?? null;
  const pagamentosEfetivosPrevia = useMemo(
    () =>
      pagamentos.length > 0
        ? pagamentos
        : modalFinalizar && total > 0
          ? [{ forma: formaAtivaModal, valor: total }]
          : [],
    [formaAtivaModal, modalFinalizar, pagamentos, total],
  );
  const validacaoCredito = useMemo(
    () =>
      validarCreditoVendaPdv({
        modo: "sem_nota",
        pagamentos: pagamentosEfetivosPrevia,
        totalVenda: total,
        cliente,
      }),
    [pagamentosEfetivosPrevia, total, cliente],
  );
  const podeOpcaoDavModal = !ocupado && podeCriarDav;
  const podeOpcaoSemNotaModal =
    !ocupado && podeVenderFiscal && !(pagamentos.length > 0 && falta > 0.01) && validacaoCredito.ok;
  const podeOpcaoFiscalModal = podeOpcaoSemNotaModal;
  const clientesFiltradosModal = useMemo(
    () =>
      clientes.filter(
        (c) =>
          !buscaCliente.trim() ||
          c.nome.toLowerCase().includes(buscaCliente.toLowerCase()) ||
          c.documento.includes(buscaCliente),
      ),
    [buscaCliente, clientes],
  );
  const cedulasSugeridas = useMemo(() => sugerirCedulasDinheiroPdv(falta), [falta]);
  const consultaPrecoDados = useMemo(
    () => consultarProdutosPrecoPdv(buscaConsultaPreco, ativos, modoEtiquetaBalanca, 8),
    [buscaConsultaPreco, ativos, modoEtiquetaBalanca],
  );
  const produtoDestaquePreco =
    consultaPrecoDados.lista[Math.min(indiceConsultaPreco, Math.max(0, consultaPrecoDados.lista.length - 1))] ??
    consultaPrecoDados.destaque;

  /**
   * Adiciona produto novo ou já existente respeitando `qtd` (tanto em produto novo quanto existente),
   * arredondamento exato em 3 casas decimais, regra de produto pesável/unitário e limite de estoque.
   */
  const adicionar = useCallback(
    (p: ProdutoDto, qtd?: number): boolean => {
      const res = aplicarAdicaoItemPdv(linhasRef.current, p, qtd);
      if (!res.ok) {
        toast(res.erro, "erro");
        return false;
      }
      atualizarLinhas(res.linhas);
      if (res.abrirEdicaoId) {
        setEditando(res.abrirEdicaoId);
      }
      setTermo("");
      setCursor(0);
      if (!res.abrirEdicaoId) {
        buscaRef.current?.focus();
      }
      return true;
    },
    [atualizarLinhas, toast],
  );

  /**
   * Entrada unificada da bipagem/busca (scan EAN-13, código + Enter ou clique na lista):
   * aplica o multiplicador armado uma única vez em caso de sucesso e o preserva em caso de falha.
   */
  const adicionarPelaBipagem = useCallback(
    (p: ProdutoDto, origemLeitura: "autoscan13" | "enter" | "clique_lista"): boolean => {
      const multAtual = multiplicadorRef.current;
      const qtdArmada = multAtual.status === "armado" ? multAtual.quantidade : undefined;
      const ok = adicionar(p, qtdArmada);

      if (!ok) {
        if (multAtual.status === "armado") {
          const r = aplicarAdicaoItemPdv(linhasRef.current, p, qtdArmada);
          if (!r.ok) {
            atualizarMultiplicador(
              transicionarMultiplicadorPdv(multAtual, {
                tipo: "REGISTRAR_ERRO_LEITURA",
                erro: `${r.erro} (Esc cancela ${multAtual.rotulo})`,
              }).estado,
            );
          }
        }
        buscaRef.current?.focus();
        buscaRef.current?.select();
        return false;
      }

      if (multAtual.status === "armado") {
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "CONSUMIR" }).estado);
      }
      navegouListaRef.current = false;
      if (origemLeitura === "autoscan13") {
        ultimoAutoScanRef.current = { codigo: p.gtin, ts: Date.now() };
      }
      return true;
    },
    [adicionar, atualizarMultiplicador],
  );

  /**
   * Decodifica e adiciona etiqueta EAN-13 de balança (`2CCCCCMMMMMD`) quando bipada ou confirmada com Enter.
   * Se houver multiplicador inteiro armado (ex.: 2 bandejas idênticas), multiplica o peso da etiqueta uma única vez.
   */
  const tentarProcessarEtiquetaBalanca = useCallback(
    (codigoBruto: string, origemLeitura: "autoscan13" | "enter"): "nao_balanca" | "adicionado" | "erro" => {
      const bal = decodificarEtiquetaBalancaPdv(codigoBruto, ativos, modoEtiquetaBalanca);
      if (!bal.ehEtiquetaBalanca) return "nao_balanca";

      const multAtual = multiplicadorRef.current;
      if (!bal.ok) {
        if (multAtual.status === "armado") {
          atualizarMultiplicador(
            transicionarMultiplicadorPdv(multAtual, {
              tipo: "REGISTRAR_ERRO_LEITURA",
              erro: `${bal.erro} (${multAtual.rotulo} mantido)`,
            }).estado,
          );
        }
        toast(bal.erro, "erro");
        return "erro";
      }

      const fator = multAtual.status === "armado" ? multAtual.quantidade : 1;
      const pesoTotal = normalizarQtdPdv(bal.pesoKg * fator);
      const ok = adicionar(bal.produto, pesoTotal);
      if (!ok) {
        if (multAtual.status === "armado") {
          atualizarMultiplicador(
            transicionarMultiplicadorPdv(multAtual, {
              tipo: "REGISTRAR_ERRO_LEITURA",
              erro: `Saldo insuficiente para etiqueta de "${bal.produto.nome}" (${multAtual.rotulo} mantido).`,
            }).estado,
          );
        }
        return "erro";
      }

      if (multAtual.status === "armado") {
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "CONSUMIR" }).estado);
      }
      navegouListaRef.current = false;
      if (origemLeitura === "autoscan13") {
        ultimoAutoScanRef.current = { codigo: codigoBruto.trim(), ts: Date.now() };
      }
      toast(
        `Balança: ${bal.produto.nome} · ${formatarQtdPdv(pesoTotal)} ${bal.produto.unidade} (${moeda(round2(pesoTotal * bal.produto.preco))})`,
        "ok",
      );
      return "adicionado";
    },
    [adicionar, ativos, atualizarMultiplicador, modoEtiquetaBalanca, toast],
  );

  // Decisão D1 — Del remove o último item sem travar e Ctrl+Z desfaz
  const removerUltimoItem = useCallback(() => {
    atualizarLinhas((atual) => {
      if (atual.length === 0) return atual;
      const removido = atual[atual.length - 1];
      setPilhaDesfazer((pilha) => [...pilha, removido]);
      toast(`Item removido: ${removido.nome} (Ctrl+Z para desfazer).`, "info");
      return atual.slice(0, -1);
    });
  }, [atualizarLinhas, toast]);

  const desfazerUltimoItem = useCallback(() => {
    setPilhaDesfazer((pilha) => {
      if (pilha.length === 0) return pilha;
      const restaurado = pilha[pilha.length - 1];
      atualizarLinhas((atual) => {
        const idx = atual.findIndex((x) => x.produtoId === restaurado.produtoId);
        if (idx >= 0) {
          const copia = [...atual];
          copia[idx] = { ...copia[idx], qtd: normalizarQtdPdv(copia[idx].qtd + restaurado.qtd) };
          return copia;
        }
        return [...atual, restaurado];
      });
      toast(`Item restaurado: ${restaurado.nome}.`, "ok");
      return pilha.slice(0, -1);
    });
  }, [atualizarLinhas, toast]);

  const definirPagamentoAutomatico = useCallback(
    (forma: string, silencioso = false): boolean => {
      if (total <= 0) return false;
      // Se ainda não há pagamentos ou só havia 1 pagamento quitando tudo, permite trocar a forma única em 1 clique/atalho
      if (pagamentos.length === 1 && falta <= 0.009) {
        if (pagamentos[0].forma === forma) return true;
        setPagamentos([{ forma, valor: total }]);
        return true;
      }
      const r = registrarParcelaPagamentoPdv({
        pagamentosAtuais: pagamentos,
        totalVenda: total,
        forma,
        valorInformado: falta > 0 ? falta : total,
      });
      if (!r.ok) {
        if (!silencioso) toast(r.erro, "info");
        return false;
      }
      setPagamentos(r.pagamentos);
      return true;
    },
    [falta, pagamentos, toast, total],
  );

  const selecionarFormaNoModalFinalizar = useCallback(
    (novaForma: string, manterSecaoValor = false) => {
      setFormaAtivaModal(novaForma);
      setMsgPagamentoModal(null);
      const lido = lerValorMonetarioPdv(valorParcelaModal);
      if (falta > 0 && (!Number.isFinite(lido) || lido <= 0 || (novaForma !== "dinheiro" && lido > falta))) {
        setValorParcelaModal(falta.toFixed(2).replace(".", ","));
      }
      setNavFinalizar((atual) => ({
        ...atual,
        formaAtiva: novaForma,
        secao: manterSecaoValor && falta > 0 ? "valor" : "formas",
      }));
    },
    [falta, valorParcelaModal],
  );

  const lancarParcelaNoModalFinalizar = useCallback(
    (valorExplicito?: number | string) => {
      const r = registrarParcelaPagamentoPdv({
        pagamentosAtuais: pagamentos,
        totalVenda: total,
        forma: formaAtivaModal,
        valorInformado: valorExplicito ?? valorParcelaModal,
      });
      if (!r.ok) {
        setMsgPagamentoModal({ tom: "erro", texto: r.erro });
        return;
      }
      setPagamentos(r.pagamentos);
      const aindaFalta = r.resumo.falta > 0.009;
      setValorParcelaModal(aindaFalta ? r.resumo.falta.toFixed(2).replace(".", ",") : "");
      setMsgPagamentoModal({
        tom: aindaFalta ? "info" : "ok",
        texto: r.mensagem,
      });
      const checkCredPos = validarCreditoVendaPdv({
        modo: "sem_nota",
        pagamentos: r.pagamentos,
        totalVenda: total,
        cliente,
      });
      const podeFinalizarPos = podeVenderFiscal && !aindaFalta && checkCredPos.ok;
      setNavFinalizar((atual) =>
        avancarAposLancamentoParcelaPdv(atual, aindaFalta, {
          podeDav: podeCriarDav,
          podeSemNota: podeFinalizarPos,
          podeEmitirFiscal: podeFinalizarPos,
        }),
      );
    },
    [cliente, formaAtivaModal, pagamentos, podeCriarDav, podeVenderFiscal, total, valorParcelaModal],
  );

  const abrirModalConsultaPreco = useCallback(() => {
    setBuscaConsultaPreco("");
    setIndiceConsultaPreco(0);
    setModalConsultaPreco(true);
  }, []);

  const abrirModalEspera = useCallback(() => {
    setRotuloNovaEspera(cliente ? cliente.nome : "");
    setModalEspera(true);
  }, [cliente]);

  const suspenderAtendimentoAtual = useCallback(() => {
    const r = suspenderVendaParaEsperaPdv({
      listaAtual: vendasEspera,
      vendaAtiva: {
        linhas,
        clienteId,
        clienteNome: cliente?.nome ?? "CONSUMIDOR",
        descontoModo,
        descontoValor,
        pagamentos,
      },
      identificacao: rotuloNovaEspera,
    });
    if (!r.ok) {
      toast(r.erro, "erro");
      return;
    }
    persistirVendasEspera(r.lista);
    descartarVendaLocal();
    setClienteId(null);
    setRotuloNovaEspera("");
    setModalEspera(false);
    toast(`Venda colocada em espera (${r.suspensa.identificacao}). Caixa livre para o próximo cliente.`, "ok");
    buscaRef.current?.focus();
  }, [
    cliente?.nome,
    clienteId,
    descartarVendaLocal,
    descontoModo,
    descontoValor,
    linhas,
    pagamentos,
    persistirVendasEspera,
    rotuloNovaEspera,
    toast,
    vendasEspera,
  ]);

  const retomarAtendimentoEspera = useCallback(
    (idAlvo: string) => {
      const r = retomarVendaDeEsperaPdv({
        listaAtual: vendasEspera,
        idAlvo,
        vendaAtivaNaTela:
          linhas.length > 0
            ? {
                linhas,
                clienteId,
                clienteNome: cliente?.nome ?? "CONSUMIDOR",
                descontoModo,
                descontoValor,
                pagamentos,
              }
            : null,
        produtosAtivos: ativos,
      });
      if (!r.ok) {
        toast(r.erro, "erro");
        return;
      }
      persistirVendasEspera(r.listaRestante);
      atualizarLinhas(r.retomada.linhas);
      setPilhaDesfazer([]);
      setClienteId(r.retomada.clienteId);
      setDescontoModo(r.retomada.descontoModo);
      setDescontoValor(r.retomada.descontoValor);
      setPagamentos(r.retomada.pagamentos);
      setRecebido("");
      setEditando(null);
      setTermo("");
      setCursor(0);
      atualizarMultiplicador(ESTADO_MULTIPLICADOR_INICIAL);
      setModalEspera(false);
      toast(
        r.trocouComAtual
          ? `Venda "${r.retomada.identificacao}" retomada (a venda anterior foi guardada em espera).`
          : `Venda "${r.retomada.identificacao}" retomada no caixa.`,
        "ok",
      );
      buscaRef.current?.focus();
    },
    [
      ativos,
      atualizarLinhas,
      atualizarMultiplicador,
      cliente?.nome,
      clienteId,
      descontoModo,
      descontoValor,
      linhas,
      pagamentos,
      persistirVendasEspera,
      toast,
      vendasEspera,
    ],
  );

  // Etapa 10 — Carregamento paginado de documentos no servidor
  const carregarDocumentosServidor = useCallback(
    async (paginaAlvo = 1, sobrescrever?: { busca?: string; tipo?: typeof docTipo; situacao?: string; periodo?: Periodo }) => {
      setDocCarregando(true);
      try {
        const r = await buscarDocumentosPdv({
          busca: sobrescrever?.busca ?? docBusca,
          tipo: sobrescrever?.tipo ?? docTipo,
          situacao: sobrescrever?.situacao ?? docSituacao,
          inicio: (sobrescrever?.periodo ?? docPeriodo).inicio,
          fim: (sobrescrever?.periodo ?? docPeriodo).fim,
          pagina: paginaAlvo,
          tamanhoPagina: 10,
        });
        if (!r.ok) {
          toast(r.erro, "erro");
          return;
        }
        setDocItens(r.itens);
        setDocTotal(r.total);
        setDocPagina(r.pagina);
        setDocTotalPaginas(r.totalPaginas);
      } finally {
        setDocCarregando(false);
      }
    },
    [docBusca, docTipo, docSituacao, docPeriodo, toast],
  );

  const abrirModalDocumentos = useCallback(() => {
    setModalDocumentos(true);
    void carregarDocumentosServidor(1);
  }, [carregarDocumentosServidor]);

  const abrirModalFinalizacao = useCallback(() => {
    if (linhas.length === 0) {
      toast("Coloque ao menos um item na venda.", "erro");
      return;
    }
    if (linhas.some((l) => l.qtd <= 0)) {
      toast("Informe a quantidade/peso de todos os itens antes de finalizar.", "erro");
      return;
    }
    const formaInicial = pagamentos[0]?.forma ?? "dinheiro";
    const faltaSaldo = falta > 0.01;
    const temParcelas = pagamentos.length > 0;
    const checkCredIni = validarCreditoVendaPdv({
      modo: "sem_nota",
      pagamentos: temParcelas ? pagamentos : [{ forma: formaInicial, valor: total }],
      totalVenda: total,
      cliente,
    });
    const podeFinalizarIni = podeVenderFiscal && !(temParcelas && faltaSaldo) && checkCredIni.ok;

    setConfirmandoEmissaoNfce(false);
    setFormaAtivaModal(formaInicial);
    setValorParcelaModal(faltaSaldo ? falta.toFixed(2).replace(".", ",") : "");
    setMsgPagamentoModal(null);
    setNavFinalizar(
      criarEstadoInicialFinalizarPdv({
        formaInicial,
        modeloAtual: modelo,
        ctx: {
          temSaldoFaltando: faltaSaldo,
          temParcelasLancadas: temParcelas,
          podeDav: podeCriarDav,
          podeSemNota: podeFinalizarIni,
          podeEmitirFiscal: podeFinalizarIni,
        },
      }),
    );
    setModalFinalizar(true);
  }, [cliente, falta, linhas, modelo, pagamentos, podeCriarDav, podeVenderFiscal, toast, total]);

  // Sincroniza o foco real do DOM no modal F10 conforme a seção e item navegados pelas setas do teclado
  useEffect(() => {
    if (!modalFinalizar) return;
    const idTimer = window.setTimeout(() => {
      if (confirmandoEmissaoNfce || navFinalizar.secao === "confirmacao") {
        confirmacaoModalRefs.current[navFinalizar.botaoConfirmacao]?.focus();
        return;
      }
      if (navFinalizar.secao === "formas") {
        formasModalRefs.current[formaAtivaModal]?.focus();
        return;
      }
      if (navFinalizar.secao === "valor") {
        const inp = valorParcelaModalRef.current;
        if (inp) {
          inp.focus();
          if (iniciouDigitacaoDiretaRef.current) {
            const len = inp.value.length;
            inp.setSelectionRange(len, len);
            iniciouDigitacaoDiretaRef.current = false;
          } else if (document.activeElement === inp) {
            inp.select();
          }
        }
        return;
      }
      if (navFinalizar.secao === "modelo") {
        modelosModalRefs.current[modelo]?.focus();
        return;
      }
      if (navFinalizar.secao === "opcoes") {
        const alvoValido = resolverOpcaoFechamentoValidaPdv(navFinalizar.opcaoFechamento, {
          podeDav: podeOpcaoDavModal,
          podeSemNota: podeOpcaoSemNotaModal,
          podeEmitirFiscal: podeOpcaoFiscalModal,
        });
        opcoesModalRefs.current[alvoValido]?.focus();
      }
    }, 15);
    return () => window.clearTimeout(idTimer);
  }, [
    confirmandoEmissaoNfce,
    formaAtivaModal,
    modalFinalizar,
    modelo,
    navFinalizar.botaoConfirmacao,
    navFinalizar.opcaoFechamento,
    navFinalizar.secao,
    podeOpcaoDavModal,
    podeOpcaoFiscalModal,
    podeOpcaoSemNotaModal,
  ]);

  // Etapa 8, Etapa 9 e Complemento 2 — Execução das 3 opções de fechamento com validação de crédito/pagamentos
  const executarFechamento = useCallback(
    async (modo: "dav" | "sem_nota" | "emitir_nfce", caixaRecemAberto = false) => {
      if (linhas.length === 0) return toast("Coloque ao menos um item na venda.", "erro");
      const itens: ItemPdv[] = linhas.map((l) => ({ produtoId: l.produtoId, qtd: l.qtd, preco: l.preco }));
      if (itens.some((i) => i.qtd <= 0)) return toast("Informe a quantidade/peso de todos os itens.", "erro");

      if (modo === "dav" && !podeCriarDav) {
        return toast("Seu perfil não possui permissão para salvar DAV.", "erro");
      }
      if (modo !== "dav" && !podeVenderFiscal) {
        return toast("Seu perfil emite apenas DAV / orçamento. Salve como DAV para o caixa faturar.", "erro");
      }
      if (modo !== "dav" && !sessaoCaixa && !caixaRecemAberto) {
        setModalFinalizar(false);
        setConfirmandoEmissaoNfce(false);
        setAcaoAposAbrirCaixa(modo);
        setModalAbrirCaixa(true);
        return toast("Caixa fechado: confirme a abertura do seu caixa para concluir a venda.", "info");
      }

      const formaUnicaSelecionada = modalFinalizar ? formaAtivaModal : "dinheiro";
      const payloadPagamentos =
        modo === "dav"
          ? []
          : pagamentos.length > 0
            ? pagamentos
            : [{ forma: formaUnicaSelecionada, valor: total }];

      // Bloqueio nativo: 120% do limite da gaveta impede concluir venda em dinheiro
      // até que uma sangria seja registrada com sucesso no banco.
      if (
        modo !== "dav" &&
        sessaoCaixa?.bloquearVendaDinheiro &&
        payloadPagamentos.some((p) => String(p.forma).toLowerCase() === "dinheiro")
      ) {
        return toast("Limite de segurança da gaveta atingido. Realize uma sangria antes de finalizar em dinheiro.", "erro");
      }

      const somaPagamentos = round2(payloadPagamentos.reduce((s, p) => s + p.valor, 0));
      if (modo !== "dav" && somaPagamentos + 0.01 < total) {
        return toast(`Faltam ${moeda(round2(total - somaPagamentos))} em pagamentos para fechar a venda.`, "erro");
      }

      const checkCredito = validarCreditoVendaPdv({
        modo,
        pagamentos: payloadPagamentos,
        totalVenda: total,
        cliente,
      });
      if (!checkCredito.ok) {
        return toast(checkCredito.erro, "erro");
      }

      const itensSnapshot = linhas.map((l) => ({
        nome: l.nome,
        qtd: l.qtd,
        precoUnit: l.preco,
        total: round2(l.qtd * l.preco),
        unidade: l.unidade,
      }));

      setOcupado(true);
      try {
        const r =
          modo === "dav"
            ? await registrarDav({
                itens,
                clienteId,
                clienteNome: cliente?.nome ?? "CONSUMIDOR",
                desconto,
                validade: validadeDav,
              })
            : davCarregado && podeFaturarDav
              ? await faturarDav({
                  davId: davCarregado.id,
                  modelo,
                  emitirNota: modo === "emitir_nfce",
                  itens,
                  clienteId,
                  clienteNome: cliente?.nome ?? "CONSUMIDOR",
                  desconto,
                  pagamentos: payloadPagamentos,
                })
              : modo === "sem_nota"
                ? await registrarVendaSemNota({
                    itens,
                    clienteId,
                    clienteNome: cliente?.nome ?? "CONSUMIDOR",
                    desconto,
                    pagamentos: payloadPagamentos,
                  })
                : await registrarVenda({
                    itens,
                    clienteId,
                    clienteNome: cliente?.nome ?? "CONSUMIDOR",
                    desconto,
                    pagamentos: payloadPagamentos,
                    tipo: "fiscal",
                    modelo,
                  });

        if (!r.ok) return toast(r.erro, "erro");

        const reciboTermico = montarReciboDeFechamentoPdv({
          id: r.id,
          modo,
          numeroVenda: r.numero,
          numeroNota: r.numeroNota,
          modelo: modo === "emitir_nfce" ? modelo : null,
          situacaoFiscal: r.situacaoFiscal,
          chave: r.chave,
          protocolo: r.protocolo,
          clienteNome: cliente?.nome ?? "CONSUMIDOR",
          clienteDocumento: cliente?.documento ?? "",
          operador: usuario.nome,
          terminal: sessaoCaixa?.terminal ?? "CAIXA 1",
          ambiente: empresa.ambiente,
          itens: itensSnapshot,
          subtotal,
          desconto,
          total,
          pagamentosBrutos: payloadPagamentos,
          troco: r.troco,
          validadeDav: modo === "dav" ? validadeDav : null,
        });

        setModalFinalizar(false);
        setConfirmandoEmissaoNfce(false);
        setCupom(reciboTermico);
        descartarVendaLocal();
        toast(
          r.aviso ??
            (modo === "dav"
              ? `DAV #${r.numero} salvo sem baixa de estoque.`
              : `Venda #${r.numero} concluída · ${moeda(total)}`),
        );
        router.refresh();
      } catch {
        const tipoFila = modo === "dav" ? "dav" : modo === "sem_nota" ? "sem_nota" : "fiscal";
        const filaAtual = Array.isArray(itensFilaOffline) ? [...itensFilaOffline] : [];
        const novaLista = sanitizarFilaOfflinePdv([
          ...filaAtual,
          {
            tipo: tipoFila,
            itens,
            clienteId,
            clienteNome: cliente?.nome ?? "CONSUMIDOR",
            desconto,
            pagamentos: payloadPagamentos,
            modelo,
            validade: modo === "dav" ? validadeDav : undefined,
            criadoEm: Date.now(),
          },
        ]);
        persistirFilaOffline(novaLista);
        setModalFinalizar(false);
        setConfirmandoEmissaoNfce(false);
        descartarVendaLocal();
        toast(`Sem conexão com o servidor. Venda nº ${novaLista.length} guardada na fila offline.`, "erro");
      } finally {
        setOcupado(false);
      }
    },
    [
      linhas,
      podeCriarDav,
      podeVenderFiscal,
      podeFaturarDav,
      davCarregado,
      sessaoCaixa,
      modalFinalizar,
      formaAtivaModal,
      pagamentos,
      subtotal,
      total,
      cliente,
      clienteId,
      desconto,
      validadeDav,
      modelo,
      usuario.nome,
      empresa.ambiente,
      itensFilaOffline,
      persistirFilaOffline,
      toast,
      descartarVendaLocal,
      router,
    ],
  );

  const abrirModalGaveta = useCallback(
    (tipoInicial: "sangria" | "suprimento" = "sangria") => {
      if (!sessaoCaixa) {
        if (podeAbrirCaixa) {
          setAcaoAposAbrirCaixa(null);
          setModalAbrirCaixa(true);
          toast("Caixa fechado: abra sua sessão antes de movimentar a gaveta.", "info");
        } else {
          toast("Nenhuma sessão de caixa aberta para movimentar.", "erro");
        }
        return;
      }
      if (!podeMovimentarCaixa) {
        toast("Seu perfil não possui permissão para suprimento ou sangria.", "erro");
        return;
      }
      setTipoGaveta(tipoInicial);
      setFormaGaveta("dinheiro");
      setValorGaveta("");
      setMotivoGaveta("");
      setModalGaveta(true);
    },
    [podeAbrirCaixa, podeMovimentarCaixa, sessaoCaixa, toast],
  );

  const carregarDavNoCaixa = useCallback(
    (dav: VendaDto) => {
      const r = carregarDavParaTelaPdv({
        dav,
        produtosAtivos: ativos,
        listaEsperaAtual: vendasEspera,
        vendaAtivaNaTela:
          linhas.length > 0
            ? {
                linhas,
                clienteId,
                clienteNome: cliente?.nome ?? "CONSUMIDOR",
                descontoModo,
                descontoValor,
                pagamentos,
              }
            : null,
      });
      if (!r.ok) {
        toast(r.erro, "erro");
        return;
      }
      if (r.guardouVendaAnteriorEmEspera) {
        persistirVendasEspera(r.listaEsperaAtualizada);
      }
      atualizarLinhas(r.linhas);
      setPilhaDesfazer([]);
      setClienteId(r.clienteId);
      setDescontoModo(r.descontoModo);
      setDescontoValor(r.descontoValor);
      setPagamentos([]);
      setRecebido("");
      setEditando(null);
      setTermo("");
      setCursor(0);
      setDavCarregado({ id: r.davId, numero: r.davNumero });
      atualizarMultiplicador(ESTADO_MULTIPLICADOR_INICIAL);
      setModalDocumentos(false);
      const avisoFaltantes =
        r.itensNaoEncontrados.length > 0
          ? ` (${r.itensNaoEncontrados.length} item(ns) inativo(s) ignorado(s))`
          : "";
      toast(
        r.guardouVendaAnteriorEmEspera
          ? `DAV #${r.davNumero} carregado no caixa (o atendimento anterior foi salvo em Espera F9)${avisoFaltantes}.`
          : `DAV #${r.davNumero} carregado no caixa para conferência e pagamento${avisoFaltantes}.`,
        "ok",
      );
      buscaRef.current?.focus();
    },
    [
      ativos,
      atualizarLinhas,
      atualizarMultiplicador,
      cliente?.nome,
      clienteId,
      descontoModo,
      descontoValor,
      linhas,
      pagamentos,
      persistirVendasEspera,
      toast,
      vendasEspera,
    ],
  );

  const abrirRecibo80mmDeVenda = useCallback(
    (v: VendaDto) => {
      const cliDoc = v.clienteId ? (clientes.find((c) => c.id === v.clienteId)?.documento ?? "") : "";
      setCupom(montarReciboDeVendaDtoPdv(v, cliDoc));
    },
    [clientes],
  );

  const algumModalAberto =
    modalSaida ||
    modalAjuda ||
    modalCancelarVenda ||
    abertoCliente ||
    modalFinalizar ||
    modalDocumentos ||
    modalAbrirCaixa ||
    modalConsultaPreco ||
    modalEspera ||
    modalGaveta ||
    modalFilaOffline ||
    Boolean(docCancelando) ||
    Boolean(cupom) ||
    Boolean(imprimindo);

  // Etapa 6 + Complemento 1 — Teclado na bipagem/busca + máquina de estados X + quantidade + Enter
  function teclaBusca(e: React.KeyboardEvent<HTMLInputElement>) {
    const multAtual = multiplicadorRef.current;
    const compondoIme = Boolean(e.nativeEvent?.isComposing) || e.keyCode === 229;

    if (multAtual.status === "digitando") {
      if (e.ctrlKey || e.metaKey || e.altKey || /^F([1-9]|1[0-2])$/.test(e.key)) {
        return;
      }
      if (compondoIme) return;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "CANCELAR" }).estado);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "BACKSPACE" }).estado);
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        e.stopPropagation();
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "LIMPAR_RASCUNHO" }).estado);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "ARMAR" }).estado);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        const t = transicionarMultiplicadorPdv(multAtual, { tipo: "DIGITAR_TECLA", tecla: e.key });
        atualizarMultiplicador(t.estado);
        if (t.converterParaTermoBusca !== undefined) {
          setTermo(t.converterParaTermoBusca);
          setCursor(0);
        }
        return;
      }
      return;
    }

    if (
      podeIniciarMultiplicadorPdv({
        estadoAtual: multAtual,
        algumModalAberto,
        editandoItem: Boolean(editando),
        focoNaBipagem: e.currentTarget === buscaRef.current,
        termoBusca: termo,
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        isComposing: compondoIme,
        keyCode: e.keyCode,
      })
    ) {
      e.preventDefault();
      atualizarMultiplicador(
        transicionarMultiplicadorPdv(multAtual, { tipo: "INICIAR", teclaInicial: e.key }).estado,
      );
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      navegouListaRef.current = true;
      setCursor((c) => Math.min(Math.max(0, resultados.length - 1), c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navegouListaRef.current = true;
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Absorve o Enter enviado pelo leitor de código logo após auto-leitura de GTIN-13 no onChange
      if (
        Date.now() - ultimoAutoScanRef.current.ts < 350 &&
        (!termo.trim() || termo.replace(/\D/g, "") === ultimoAutoScanRef.current.codigo)
      ) {
        return;
      }
      if (multAtual.status === "armado" && !termo.trim() && !navegouListaRef.current) {
        atualizarMultiplicador(
          transicionarMultiplicadorPdv(multAtual, {
            tipo: "REGISTRAR_ERRO_LEITURA",
            erro: "Bipe o código, digite o nome/SKU ou escolha um produto na lista.",
          }).estado,
        );
        return;
      }
      const resBalanca = tentarProcessarEtiquetaBalanca(termo, "enter");
      if (resBalanca === "adicionado" || resBalanca === "erro") {
        if (resBalanca === "erro") buscaRef.current?.select();
        return;
      }
      const alvo = resolverProdutoPorCodigoOuBusca(ativos, termo, resultados, cursor);
      if (alvo) {
        adicionarPelaBipagem(alvo, "enter");
      } else if (termo.trim()) {
        const msg = `Produto não encontrado para "${termo.trim()}".`;
        if (multAtual.status === "armado") {
          atualizarMultiplicador(
            transicionarMultiplicadorPdv(multAtual, {
              tipo: "REGISTRAR_ERRO_LEITURA",
              erro: `${msg} ${multAtual.rotulo} mantido (Esc cancela).`,
            }).estado,
          );
          toast(`${msg} ${multAtual.rotulo} mantido.`, "erro");
        } else {
          toast(msg, "erro");
        }
        buscaRef.current?.select();
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (multAtual.status !== "inativo") {
        atualizarMultiplicador(transicionarMultiplicadorPdv(multAtual, { tipo: "CANCELAR" }).estado);
      } else if (termo) {
        setTermo("");
        setCursor(0);
      }
    }
  }

  // Etapa 4 — Listener global único de teclado sincronizado com ATALHOS_PDV (sem segundo listener global)
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      // Alt+← (Etapa 2 — melhor esforço)
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        solicitarSaidaPdv("/");
        return;
      }

      // Alt+Enter (Etapa 3 — melhor esforço para Tela Cheia)
      if (e.altKey && e.key === "Enter") {
        e.preventDefault();
        void alternarTelaCheia();
        return;
      }

      // F1 abre ajuda de atalhos mesmo se estiver em foco na tela
      if (e.key === "F1") {
        e.preventDefault();
        setModalAjuda((v) => !v);
        return;
      }

      // Ctrl+Z desfaz remoção do último item (Decisão D1)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !algumModalAberto) {
        const alvo = e.target as HTMLElement | null;
        const ehInputComTexto =
          (alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA") &&
          Boolean((alvo as HTMLInputElement).value);
        if (!ehInputComTexto && multiplicadorRef.current.status !== "digitando" && pilhaDesfazer.length > 0) {
          e.preventDefault();
          desfazerUltimoItem();
          return;
        }
      }

      // Navegação 100% por teclado dentro do modal Finalizar operação (F10)
      if (modalFinalizar) {
        const alvoDom = e.target as HTMLElement | null;
        const ehBotaoSecundarioSemZona =
          alvoDom?.tagName === "BUTTON" && !alvoDom.dataset?.f10Zona && (e.key === "Enter" || e.key === " ");
        if (!ehBotaoSecundarioSemZona) {
          const inpVal = valorParcelaModalRef.current;
          const inputValorSelecionadoOuVazio = Boolean(
            !inpVal ||
              inpVal.value.length === 0 ||
              (inpVal.selectionStart === 0 && inpVal.selectionEnd === inpVal.value.length),
          );
          const navSincronizada: EstadoNavegacaoFinalizarPdv = {
            ...navFinalizar,
            formaAtiva: formaAtivaModal,
            modeloFiscal: modelo,
          };
          const resNav = processarTeclaFinalizarPdv(
            navSincronizada,
            {
              key: e.key,
              altKey: e.altKey,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              shiftKey: e.shiftKey,
            },
            {
              temSaldoFaltando: falta > 0.01,
              temParcelasLancadas: pagamentos.length > 0,
              podeDav: podeOpcaoDavModal,
              podeSemNota: podeOpcaoSemNotaModal,
              podeEmitirFiscal: podeOpcaoFiscalModal,
              confirmandoEmissao: confirmandoEmissaoNfce,
              ocupado,
              inputValorSelecionadoOuVazio,
            },
          );
          if (resNav.interceptado) {
            e.preventDefault();
            if (e.key === "Escape") e.stopPropagation();
            setNavFinalizar(resNav.estado);

            switch (resNav.acao.tipo) {
              case "MUDAR_FORMA":
                selecionarFormaNoModalFinalizar(resNav.acao.forma, resNav.estado.secao === "valor");
                break;
              case "INICIAR_DIGITACAO_VALOR":
                iniciouDigitacaoDiretaRef.current = true;
                setValorParcelaModal(resNav.acao.caractere);
                setMsgPagamentoModal(null);
                break;
              case "LANCAR_PARCELA":
                lancarParcelaNoModalFinalizar();
                break;
              case "TROCAR_FORMA_UNICA":
                if (pagamentos.length <= 1) {
                  setPagamentos([{ forma: resNav.acao.forma, valor: total }]);
                }
                break;
              case "MUDAR_MODELO":
                setModelo(resNav.acao.modelo);
                break;
              case "ABRIR_CLIENTE_F8":
                setModalFinalizar(false);
                setRetornarAoFinalizarAposCliente(true);
                setBuscaCliente("");
                setCursorCliente(0);
                setAbertoCliente(true);
                break;
              case "ABRIR_CONFIRMACAO_FISCAL":
                setConfirmandoEmissaoNfce(true);
                break;
              case "VOLTAR_OPCOES":
                setConfirmandoEmissaoNfce(false);
                break;
              case "EXECUTAR_FECHAMENTO":
                void executarFechamento(resNav.acao.modo);
                break;
              case "NENHUMA":
                break;
            }
            return;
          }
        }
      }

      // Pós-venda: Enter no recibo térmico inicia imediatamente a próxima venda
      if (cupom && !imprimindo && e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setCupom(null);
        setTimeout(() => buscaRef.current?.focus(), 20);
        return;
      }

      if (algumModalAberto) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        abrirModalGaveta("sangria");
      } else if (e.key === "F2") {
        e.preventDefault();
        setEditando(null);
        buscaRef.current?.focus();
        buscaRef.current?.select();
      } else if (e.key === "F3") {
        e.preventDefault();
        abrirModalDocumentos();
      } else if (e.key === "F4") {
        e.preventDefault();
        descontoRef.current?.focus();
        descontoRef.current?.select();
      } else if (e.key === "F6") {
        e.preventDefault();
        if (linhas.length > 0) setModalCancelarVenda(true);
      } else if (e.key === "F7") {
        e.preventDefault();
        abrirModalConsultaPreco();
      } else if (e.key === "F8") {
        e.preventDefault();
        setRetornarAoFinalizarAposCliente(false);
        setBuscaCliente("");
        setCursorCliente(0);
        setAbertoCliente(true);
      } else if (e.key === "F9") {
        e.preventDefault();
        abrirModalEspera();
      } else if (e.key === "F10") {
        e.preventDefault();
        abrirModalFinalizacao();
      } else if (e.key === "Delete") {
        if (multiplicadorRef.current.status === "digitando") {
          e.preventDefault();
          atualizarMultiplicador(
            transicionarMultiplicadorPdv(multiplicadorRef.current, { tipo: "LIMPAR_RASCUNHO" }).estado,
          );
          return;
        }
        const alvo = e.target as HTMLElement | null;
        const tag = alvo?.tagName ?? "";
        const digitandoTexto =
          (tag === "INPUT" || tag === "TEXTAREA") &&
          Boolean((alvo as HTMLInputElement).value);
        if (!digitandoTexto && !editando && linhas.length > 0) {
          e.preventDefault();
          removerUltimoItem();
        }
      } else if (e.altKey && /^[1-6]$/.test(e.key)) {
        // Alt+1..6 (e Ctrl+Alt+1..6 como alternativa D6)
        e.preventDefault();
        const itemForma = FORMAS_ATALHO_ALT.find((f) => f.digito === e.key);
        if (itemForma && total > 0) {
          const aplicou = definirPagamentoAutomatico(itemForma.forma);
          if (aplicou) toast(`Pagamento: ${itemForma.rotulo} selecionado.`, "info");
        }
      } else if (e.key === "Escape") {
        // Esc nunca apaga a venda: cancela edição inline, cancela multiplicador ou limpa texto da busca
        if (editando) {
          setEditando(null);
          buscaRef.current?.focus();
        } else if (multiplicadorRef.current.status !== "inativo") {
          atualizarMultiplicador(
            transicionarMultiplicadorPdv(multiplicadorRef.current, { tipo: "CANCELAR" }).estado,
          );
          buscaRef.current?.focus();
        } else if (termo) {
          setTermo("");
          setCursor(0);
        }
      }
    };

    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [
    algumModalAberto,
    cupom,
    imprimindo,
    modalFinalizar,
    confirmandoEmissaoNfce,
    navFinalizar,
    formaAtivaModal,
    modelo,
    falta,
    pagamentos.length,
    podeOpcaoDavModal,
    podeOpcaoSemNotaModal,
    podeOpcaoFiscalModal,
    ocupado,
    selecionarFormaNoModalFinalizar,
    lancarParcelaNoModalFinalizar,
    executarFechamento,
    abrirModalGaveta,
    solicitarSaidaPdv,
    alternarTelaCheia,
    pilhaDesfazer.length,
    desfazerUltimoItem,
    abrirModalDocumentos,
    abrirModalConsultaPreco,
    abrirModalEspera,
    linhas.length,
    abrirModalFinalizacao,
    editando,
    atualizarMultiplicador,
    removerUltimoItem,
    total,
    definirPagamentoAutomatico,
    toast,
    termo,
  ]);

  async function sincronizar(idAlvoFila?: string) {
    let listaAtual: ItemFilaOfflinePdv[] = [];
    try {
      listaAtual = sanitizarFilaOfflinePdv(JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]"));
    } catch {
      listaAtual = [];
    }
    if (listaAtual.length === 0) return;

    setOcupado(true);
    let ok = 0;
    let ultimoErroMsg = "";
    const restante: ItemFilaOfflinePdv[] = [];

    for (const item of listaAtual) {
      if (idAlvoFila && item.idFila !== idAlvoFila) {
        restante.push(item);
        continue;
      }
      try {
        const r = await registrarVenda({
          tipo: item.tipo,
          itens: item.itens,
          clienteId: item.clienteId,
          clienteNome: item.clienteNome,
          desconto: item.desconto,
          pagamentos: item.pagamentos,
          modelo: item.modelo,
          validade: item.validade,
        });
        if (r.ok) {
          ok++;
        } else {
          ultimoErroMsg = r.erro;
          restante.push({
            ...item,
            tentativas: item.tentativas + 1,
            ultimoErro: r.erro,
          });
        }
      } catch {
        ultimoErroMsg = "Falha de conexão com o servidor.";
        restante.push({
          ...item,
          tentativas: item.tentativas + 1,
          ultimoErro: ultimoErroMsg,
        });
      }
    }

    persistirFilaOffline(restante);
    setOcupado(false);
    if (restante.length === 0) {
      setModalFilaOffline(false);
    }
    toast(
      ok
        ? `${ok} venda(s) da fila sincronizada(s) com sucesso.`
        : ultimoErroMsg || "Nada sincronizado — verifique caixa aberto ou conexão.",
      ok ? "ok" : "erro",
    );
    if (ok > 0) router.refresh();
  }

  function abrirImpressaoDeVenda(v: VendaDto) {
    setImprimindo({
      tipo: "nfe",
      emit: emitenteFinal,
      cscId,
      doc: {
        modelo: v.modelo ?? "NFC-e",
        serie: v.serie,
        numero: v.numeroNota ?? v.numero,
        numeroInterno: v.numero,
        chave: v.chave,
        protocolo: v.protocolo,
        autorizadaEm: null,
        status: v.status,
        ambiente: v.ambiente === "1" ? 1 : 2,
        data: v.data,
        operador: v.operador,
        cliente: v.clienteNome,
        itens: v.itens.map((i) => ({
          nome: i.nome,
          qtd: i.qtd,
          unidade: i.unidade,
          precoUnit: i.precoUnit,
          total: i.total,
        })),
        subtotal: v.subtotal,
        desconto: v.desconto,
        frete: v.vFrete,
        total: v.total,
        pagamentos: v.pagamentos,
        forma: v.formaPagamento,
        troco: 0,
        observacao: v.observacao,
      },
    });
  }

  const colunasDocumentosPdv: Coluna<VendaDto>[] = [
    {
      id: "numero",
      rotulo: "Documento",
      valor: (v) => v.numeroNota ?? v.numero,
      render: (v) => (
        <div>
          <p className="tabular font-bold text-ink-900">
            {v.tipo === "dav"
              ? `DAV #${v.numero}`
              : v.tipo === "sem_nota"
                ? `Venda #${v.numero}`
                : `${v.modelo ?? "NFC-e"} ${v.numeroNota ?? v.numero}`}
          </p>
          <p className="text-[11px] text-ink-400">
            Venda #{v.numero} · {dataHoraBR(v.data)}
          </p>
        </div>
      ),
    },
    {
      id: "cliente",
      rotulo: "Cliente",
      valor: (v) => v.clienteNome,
      render: (v) => <span className="font-medium text-ink-800">{v.clienteNome}</span>,
    },
    {
      id: "chave",
      rotulo: "Chave / Protocolo",
      valor: (v) => v.chave ?? v.protocolo ?? "",
      render: (v) => (
        <div className="font-mono text-[10.5px] text-ink-500">
          {v.chave ? <p title={v.chave}>{formatChave(v.chave).slice(0, 24)}…</p> : <p>Sem chave</p>}
          {v.protocolo && (
            <p className="text-[10px] text-ink-400">
              Prot. {v.protocolo} ({v.protocoloOrigem === "autorizado_sefaz" ? "SEFAZ" : "simulado"})
            </p>
          )}
        </div>
      ),
    },
    {
      id: "situacao",
      rotulo: "Situação Fiscal",
      valor: (v) => v.situacaoFiscal,
      render: (v) => {
        const cfg = ROTULO_SITUACAO_FISCAL[v.situacaoFiscal];
        return <Badge tom={cfg.tom}>{cfg.rotulo}</Badge>;
      },
    },
    {
      id: "total",
      rotulo: "Total",
      alinhar: "direita",
      valor: (v) => v.total,
      render: (v) => (
        <div className="text-right">
          <p className="tabular font-bold text-ink-900">{moeda(v.total)}</p>
          <p className="text-[10.5px] text-ink-400">{rotuloForma(v.formaPagamento)}</p>
        </div>
      ),
    },
    {
      id: "acoes",
      rotulo: "Ações",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (v) => (
        <div className="flex flex-wrap justify-end gap-1">
          {v.tipo === "fiscal" ? (
            <>
              <Button tamanho="sm" variante="secundario" icone="imprimir" onClick={() => abrirImpressaoDeVenda(v)}>
                DANFE
              </Button>
              <Button tamanho="sm" variante="fantasma" onClick={() => abrirRecibo80mmDeVenda(v)}>
                80 mm
              </Button>
            </>
          ) : (
            <Button tamanho="sm" variante="secundario" icone="imprimir" onClick={() => abrirRecibo80mmDeVenda(v)}>
              Recibo 80 mm
            </Button>
          )}
          {v.tipo === "sem_nota" && v.status === "faturado" && podeVenderFiscal && (
            <Button
              tamanho="sm"
              variante="suave"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await emitirNfceDaVenda({ vendaId: v.id, modelo: "NFC-e" });
                setOcupado(false);
                toast(r.ok ? r.aviso : r.erro, r.ok ? "ok" : "erro");
                if (r.ok) void carregarDocumentosServidor(docPagina);
              }}
            >
              Emitir NFC-e
            </Button>
          )}
          {v.tipo === "dav" && v.status === "aberto" && (
            <Button tamanho="sm" variante="suave" onClick={() => carregarDavNoCaixa(v)}>
              Editar no PDV
            </Button>
          )}
          {v.tipo === "dav" && v.status === "aberto" && podeFaturarDav && (
            <Button
              tamanho="sm"
              variante="primario"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await faturarDav({
                  davId: v.id,
                  modelo: "NFC-e",
                  emitirNota: false,
                  pagamentos: [{ forma: v.formaPagamento || "dinheiro", valor: v.total }],
                });
                setOcupado(false);
                toast(
                  r.ok ? `DAV #${v.numero} faturado na venda #${r.numero}.` : r.erro,
                  r.ok ? "ok" : "erro",
                );
                if (r.ok) {
                  void carregarDocumentosServidor(docPagina);
                  router.refresh();
                }
              }}
            >
              Faturar DAV
            </Button>
          )}
          {v.status !== "cancelado" && podeCancelarVenda && (
            <Button
              tamanho="sm"
              variante="perigo"
              disabled={ocupado}
              onClick={() => {
                setDocCancelando(v);
                setMotivoCancelamentoDoc("Cancelamento solicitado na frente de caixa pelo operador");
              }}
            >
              Cancelar
            </Button>
          )}
        </div>
      ),
    },
  ];

  const trib = tributosEstimados(total, { icms: 0, pis: 0, cofins: 0, ibs: 0.1, cbs: 0.9 });
  const atalhosBarraInferior = useMemo(() => ATALHOS_PDV.filter((a) => a.exibirNaBarra), []);
  const resumoFilaOffline = useMemo(() => resumirFilaOfflinePdv(itensFilaOffline), [itensFilaOffline]);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#eef0f4]">
      {/* ETAPA 2 & ETAPA 5 — BARRA ESCURA SUPERIOR FIXA */}
      <header className="sem-impressao flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-ink-900 px-3 py-2 text-white">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => solicitarSaidaPdv("/")}
            title="Voltar ao painel do ERP (Alt+←)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-1.5 text-[12.5px] font-bold text-white ring-1 ring-inset ring-ink-700 transition hover:bg-way-600 hover:ring-way-500"
          >
            <Icon name="voltar" className="size-4" />
            <span>← Voltar</span>
          </button>

          <div className="border-l border-ink-800 pl-2.5 leading-tight">
            <p className="text-[13px] font-extrabold tracking-tight text-white">
              {empresa.fantasia || empresa.nome}
            </p>
            <p className="text-[10.5px] text-ink-400">
              Frente de caixa · Operador: <span className="font-semibold text-ink-200">{usuario.nome}</span>
            </p>
          </div>
        </div>

        {/* Itens preservados do topo antigo (Etapa 0 item 4 / Etapa 5) + Gaveta Rápida (Alt+G) e Inspetor de Fila Offline */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {fila > 0 && (
            <div className="inline-flex items-center rounded-lg bg-amber-500/20 ring-1 ring-inset ring-amber-400/40">
              <button
                type="button"
                onClick={() => void sincronizar()}
                disabled={ocupado}
                title="Sincronizar vendas da fila offline com o servidor"
                className="inline-flex items-center gap-1.5 rounded-l-lg px-2.5 py-1 text-[11.5px] font-semibold text-amber-200 transition hover:bg-amber-500/30"
              >
                <Icon name="atualizar" className="size-3.5" />
                <span>{fila} na fila · sincronizar</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  atualizarContagemFila();
                  setModalFilaOffline(true);
                }}
                title="Inspecionar itens e erros da fila offline"
                className="rounded-r-lg border-l border-amber-400/30 px-2 py-1 text-[11px] font-bold text-amber-100 transition hover:bg-amber-500/30"
              >
                Ver
              </button>
            </div>
          )}

          {sessaoCaixa ? (
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => solicitarSaidaPdv("/caixa")}
                title="Abrir tela completa de conferência e fechamento de caixa"
                className="inline-flex items-center gap-1.5 rounded-lg bg-way-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-way-200 ring-1 ring-inset ring-way-500/35 transition hover:bg-way-500/25"
              >
                <Icon name="carteira" className="size-3.5 text-way-300" />
                <span>
                  Caixa #{sessaoCaixa.numero} ({sessaoCaixa.terminal}) · {sessaoCaixa.operadorNome}
                </span>
                <span className="font-semibold text-way-200">· {ROTULO_ESTADO_GAVETA[sessaoCaixa.estadoGaveta]}</span>
              </button>
              {podeFecharCaixa && (
                <button
                  type="button"
                  onClick={() => setModalFechamentoCego(true)}
                  title="Encerrar o turno com fechamento às cegas, sem sair do PDV"
                  className="inline-flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1 text-[11.5px] font-semibold text-ink-100 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
                >
                  <Icon name="cadeado" className="size-3.5" />
                  <span>Encerrar Turno</span>
                </button>
              )}
              {podeMovimentarCaixa && (
                <button
                  type="button"
                  onClick={() => abrirModalGaveta("sangria")}
                  title="Registrar Suprimento ou Sangria rápida sem sair do PDV (Alt+G)"
                  className="inline-flex items-center gap-1 rounded-lg bg-ink-800 px-2 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
                >
                  <span>Gaveta</span>
                  <kbd className="rounded bg-ink-900 px-1 py-px font-mono text-[9.5px] text-ink-400">Alt+G</kbd>
                </button>
              )}
            </div>
          ) : podeAbrirCaixa ? (
            <button
              type="button"
              onClick={() => {
                setAcaoAposAbrirCaixa(null);
                setModalAbrirCaixa(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11.5px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/40 transition hover:bg-amber-500/30"
            >
              <Icon name="caixa" className="size-3.5" />
              <span>Caixa fechado · Abrir</span>
            </button>
          ) : null}

          <Badge tom={empresa.ambiente === "1" ? "erro" : "info"}>
            {empresa.ambiente === "1" ? "Produção" : "Homologação"}
          </Badge>

          <button
            type="button"
            onClick={abrirModalConsultaPreco}
            title="Consultar preço, estoque e tributos sem adicionar à venda (F7)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
          >
            <Icon name="etiqueta" className="size-3.5" />
            <span className="hidden sm:inline">Preço</span>
            <kbd className="rounded bg-ink-900 px-1 py-px font-mono text-[9.5px] text-ink-400">F7</kbd>
          </button>

          <button
            type="button"
            onClick={abrirModalEspera}
            title="Suspender ou retomar vendas em espera no caixa (F9)"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset transition",
              vendasEspera.length > 0
                ? "bg-amber-500/20 text-amber-200 ring-amber-400/40 hover:bg-amber-500/30"
                : "bg-ink-800 text-ink-200 ring-ink-700 hover:bg-ink-700 hover:text-white",
            )}
          >
            <Icon name="atualizar" className="size-3.5" />
            <span className="hidden sm:inline">Espera</span>
            {vendasEspera.length > 0 && (
              <span className="tabular rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-extrabold text-ink-900">
                {vendasEspera.length}
              </span>
            )}
            <kbd className="rounded bg-ink-900 px-1 py-px font-mono text-[9.5px] text-ink-400">F9</kbd>
          </button>

          <button
            type="button"
            onClick={abrirModalDocumentos}
            title="Buscar vendas, notas fiscais e DAVs (F3)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
          >
            <Icon name="documento" className="size-3.5" />
            <span className="hidden sm:inline">Documentos</span>
            <kbd className="rounded bg-ink-900 px-1 py-px font-mono text-[9.5px] text-ink-400">F3</kbd>
          </button>

          <button
            type="button"
            onClick={() => setModalAjuda(true)}
            title="Lista de atalhos do teclado (F1)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
          >
            <Icon name="ajuda" className="size-3.5" />
            <span className="hidden md:inline">Ajuda</span>
            <kbd className="rounded bg-ink-900 px-1 py-px font-mono text-[9.5px] text-ink-400">F1</kbd>
          </button>

          <button
            type="button"
            onClick={() => void alternarTelaCheia()}
            title="Alternar tela cheia do navegador (Alt+Enter ou F11)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-800 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-inset ring-ink-700 transition hover:bg-ink-700 hover:text-white"
          >
            <Icon name={emTelaCheia ? "minimizar" : "expandir"} className="size-3.5" />
            <span>{emTelaCheia ? "Sair tela cheia" : "Tela cheia"}</span>
          </button>
        </div>
      </header>

      {/* ETAPA 3 — AVISO DE 1 LINHA QUANDO PREFERÊNCIA É TRUE E NAVEGADOR AGUARDA GESTO */}
      {aguardandoGestoTelaCheia && !emTelaCheia && (
        <div className="sem-impressao flex shrink-0 items-center justify-between gap-2 border-b border-way-200 bg-way-50 px-4 py-1 text-[12px] font-medium text-way-800">
          <span>Clique em qualquer lugar para entrar em tela cheia (ou pressione F11 / Alt+Enter).</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              try {
                localStorage.setItem(CHAVE_TELA_CHEIA, "false");
              } catch {
                /* ignora */
              }
              setAguardandoGestoTelaCheia(false);
            }}
            className="text-[11px] font-semibold text-way-700 underline hover:text-way-900"
          >
            Manter em janela
          </button>
        </div>
      )}

      {/* ETAPA 1 — DUAS COLUNAS COM ROLAGEM PRÓPRIA E SEM ROLAGEM DA PÁGINA */}
      <div className="sem-impressao grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,1fr)_410px] lg:grid-rows-1">
        {/* COLUNA 1: BUSCA / BIPAGEM + ITENS DA VENDA */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
          <Card className="shrink-0 p-2.5">
            {multiplicador.status === "armado" && (
              <div
                role="status"
                aria-live="polite"
                className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-way-50 px-3 py-1.5 text-[12.5px] ring-1 ring-inset ring-way-300"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-way-600 px-2 py-0.5 font-mono text-[12px] font-extrabold text-white">
                    {multiplicador.rotulo}
                  </span>
                  <span className="text-[11.5px] font-medium text-way-900">
                    Bipe o código ou escolha o produto para aplicar uma única vez.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    atualizarMultiplicador(
                      transicionarMultiplicadorPdv(multiplicadorRef.current, { tipo: "CANCELAR" }).estado,
                    );
                    buscaRef.current?.focus();
                  }}
                  className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-way-800 ring-1 ring-inset ring-way-200 transition hover:bg-way-100"
                >
                  Cancelar (Esc)
                </button>
              </div>
            )}

            <div className="relative">
              {multiplicador.status === "digitando" ? (
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 rounded-md bg-amber-500 px-2 py-0.5 font-mono text-[11.5px] font-extrabold text-ink-900">
                  × QTD
                </span>
              ) : (
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-way-600">
                  <Icon name="busca" className="size-5" />
                </span>
              )}
              <input
                ref={buscaRef}
                aria-label={
                  multiplicador.status === "digitando"
                    ? "Quantidade do multiplicador do próximo item"
                    : multiplicador.status === "armado"
                      ? `Bipagem ou busca de produto (${multiplicador.rotulo})`
                      : "Bipagem ou busca de produto"
                }
                value={multiplicador.status === "digitando" ? multiplicador.rascunho : termo}
                onChange={(e) => {
                  const valor = e.target.value;
                  if (multiplicadorRef.current.status === "digitando") {
                    const t = transicionarMultiplicadorPdv(multiplicadorRef.current, {
                      tipo: "DEFINIR_RASCUNHO",
                      rascunho: valor,
                    });
                    atualizarMultiplicador(t.estado);
                    if (t.converterParaTermoBusca !== undefined) {
                      setTermo(t.converterParaTermoBusca);
                      setCursor(0);
                    }
                    return;
                  }
                  navegouListaRef.current = false;
                  setTermo(valor);
                  setCursor(0);
                  const digitado = valor.replace(/\D/g, "");
                  if (digitado.length === 13 && /^\d{13}$/.test(valor.trim())) {
                    const p = ativos.find((x) => x.gtin === digitado);
                    if (p) {
                      ultimoAutoScanRef.current = { codigo: digitado, ts: Date.now() };
                      adicionarPelaBipagem(p, "autoscan13");
                    } else if (digitado.startsWith("2")) {
                      ultimoAutoScanRef.current = { codigo: digitado, ts: Date.now() };
                      tentarProcessarEtiquetaBalanca(digitado, "autoscan13");
                    }
                  }
                }}
                onKeyDown={teclaBusca}
                placeholder={
                  multiplicador.status === "digitando"
                    ? "Digite a quantidade (ex.: 5 ou 1,5) e tecle Enter · Esc cancela"
                    : multiplicador.status === "armado"
                      ? `${multiplicador.rotulo} — bipe o código ou digite nome / SKU`
                      : "Bipe o código de barras ou digite início do nome / SKU (F2 · X multiplica)"
                }
                className={cn(
                  "w-full rounded-lg border-0 py-2.5 text-[15px] font-medium text-ink-900 outline-none ring-1 ring-inset transition placeholder:text-ink-400 focus:bg-white focus:ring-2",
                  multiplicador.status === "digitando"
                    ? "bg-amber-50/80 pl-20 pr-24 font-mono font-bold ring-amber-300 focus:ring-amber-500"
                    : multiplicador.status === "armado"
                      ? "bg-way-50/40 px-10 ring-way-300 focus:ring-way-500"
                      : "bg-ink-50/70 px-10 ring-ink-100 placeholder:text-ink-300 focus:ring-way-500",
                )}
              />
              {multiplicador.status === "digitando" ? (
                <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      const t = transicionarMultiplicadorPdv(multiplicadorRef.current, {
                        tipo: "CONVERTER_PARA_BUSCA_X",
                      });
                      atualizarMultiplicador(t.estado);
                      if (t.converterParaTermoBusca !== undefined) {
                        setTermo(t.converterParaTermoBusca);
                        setCursor(0);
                      }
                      buscaRef.current?.focus();
                    }}
                    title="Pesquisar produto cujo nome ou SKU começa com X"
                    className="rounded bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                  >
                    Buscar &quot;X…&quot;
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      atualizarMultiplicador(
                        transicionarMultiplicadorPdv(multiplicadorRef.current, { tipo: "CANCELAR" }).estado,
                      );
                      buscaRef.current?.focus();
                    }}
                    className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                  >
                    Esc
                  </button>
                </div>
              ) : (
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-400 ring-1 ring-inset ring-ink-100">
                  F2
                </kbd>
              )}
            </div>

            {multiplicador.status === "digitando" && !multiplicador.erro && (
              <p role="status" aria-live="polite" className="mt-1.5 text-[11.5px] font-medium text-amber-800">
                Modo quantidade: digite o multiplicador{multiplicador.rascunho ? ` (× ${multiplicador.rascunho})` : ""} e
                pressione <strong>Enter</strong> para armar ou <strong>Esc</strong> para voltar à busca.
              </p>
            )}

            {(multiplicador.status === "digitando" || multiplicador.status === "armado") && multiplicador.erro && (
              <p
                role="alert"
                className="mt-1.5 rounded-md bg-rose-50 px-2.5 py-1 text-[11.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
              >
                {multiplicador.erro}
              </p>
            )}

            {multiplicador.status !== "digitando" && resultados.length > 0 && (
              <ul className="mt-2 max-h-48 divide-y divide-ink-50 overflow-y-auto">
                {resultados.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => adicionarPelaBipagem(p, "clique_lista")}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition",
                        cursor === i ? "bg-way-50 ring-1 ring-inset ring-way-200" : "hover:bg-ink-50",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink-800">{p.nome}</span>
                        <span className="block font-mono text-[10.5px] text-ink-400">
                          {p.sku} · {p.gtin} · {p.categoria}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "tabular shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-bold",
                          p.estoque <= 0
                            ? "bg-rose-50 text-rose-600"
                            : p.estoque <= p.estoqueMin
                              ? "bg-amber-50 text-amber-700"
                              : "bg-ink-50 text-ink-500",
                        )}
                      >
                        {p.estoque} {p.unidade}
                      </span>
                      <span className="tabular w-20 shrink-0 text-right text-[13.5px] font-bold text-ink-900">
                        {moeda(p.preco)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-0" padding={false}>
            {davCarregado && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-way-200 bg-way-50 px-3 py-1.5 text-[12px] font-semibold text-way-900">
                <span>
                  Faturando pré-venda <strong>DAV #{davCarregado.numero}</strong> — ajuste itens/pagamentos e finalize
                  em <kbd className="rounded bg-white px-1 font-mono text-[10.5px]">F10</kbd>.
                </span>
                <button
                  type="button"
                  onClick={() => setDavCarregado(null)}
                  className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-way-800 ring-1 ring-inset ring-way-200 hover:bg-way-100"
                >
                  Desvincular DAV
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <p className="micro text-ink-400">
                Itens da venda · {linhas.length} item(ns) · {formatarQtdPdv(unidadesBipadas)} un.
              </p>
              <div className="flex items-center gap-1.5">
                {pilhaDesfazer.length > 0 && (
                  <Button tamanho="sm" variante="suave" icone="atualizar" onClick={desfazerUltimoItem}>
                    Desfazer (Ctrl+Z)
                  </Button>
                )}
                {linhas.length > 0 && (
                  <Button
                    tamanho="sm"
                    variante="fantasma"
                    icone="lixo"
                    onClick={() => setModalCancelarVenda(true)}
                  >
                    Cancelar venda (F6)
                  </Button>
                )}
              </div>
            </div>

            {linhas.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-[13px] font-semibold text-ink-500">Nenhum item na venda</p>
                <p className="mt-1 text-[12px] text-ink-400">
                  Bipe o código de barras ou selecione um produto acima. Pressione <kbd className="rounded bg-ink-100 px-1 font-mono text-[11px]">F1</kbd> para ver os atalhos.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-50">
                {linhas.map((l, idx) => (
                  <li key={l.produtoId} className="flex items-center gap-2 px-3 py-2">
                    <span className="tabular w-5 shrink-0 text-[11px] font-bold text-ink-300">{idx + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink-800">{l.nome}</p>
                      <p className="tabular text-[10.5px] text-ink-400">
                        {moeda(l.preco)} / {l.unidade} · saldo {l.estoque}
                      </p>
                    </div>
                    {editando === l.produtoId ? (
                      <input
                        autoFocus
                        defaultValue={l.qtd || ""}
                        placeholder={l.pesavel ? "peso KG" : "qtd"}
                        onChange={(e) => {
                          const bruto = Number(e.target.value.replace(",", ".")) || 0;
                          const normalizada = Math.max(
                            0,
                            l.pesavel ? normalizarQtdPdv(bruto) : Math.floor(normalizarQtdPdv(bruto)),
                          );
                          const limitada = l.estoque > 0 ? Math.min(l.estoque, normalizada) : 0;
                          atualizarLinhas((atual) =>
                            atual.map((x) => (x.produtoId === l.produtoId ? { ...x, qtd: limitada } : x)),
                          );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === "Escape") {
                            e.stopPropagation();
                            setEditando(null);
                            buscaRef.current?.focus();
                          }
                        }}
                        onBlur={() => setEditando(null)}
                        className="tabular w-24 rounded-lg px-2 py-1 text-right text-[13px] font-semibold ring-1 ring-inset ring-way-400 outline-none"
                      />
                    ) : (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            atualizarLinhas((atual) =>
                              atual.map((x) =>
                                x.produtoId === l.produtoId
                                  ? { ...x, qtd: Math.max(0, normalizarQtdPdv(x.qtd - 1)) }
                                  : x,
                              ),
                            )
                          }
                          className="grid size-6 place-items-center rounded-md text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                        >
                          <Icon name="menos" className="size-3" strokeWidth={2.4} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(l.produtoId)}
                          className="tabular w-12 rounded-md py-1 text-center text-[13px] font-bold text-ink-900 hover:bg-ink-50"
                          title="Clique para digitar a quantidade"
                        >
                          {formatarQtdPdv(l.qtd)}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nova = normalizarQtdPdv(l.qtd + 1);
                            if (nova > l.estoque) {
                              toast(
                                `Estoque insuficiente de "${l.nome}": disponível ${formatarQtdPdv(l.estoque)} ${l.unidade}.`,
                                "erro",
                              );
                              return;
                            }
                            atualizarLinhas((atual) =>
                              atual.map((x) => (x.produtoId === l.produtoId ? { ...x, qtd: nova } : x)),
                            );
                          }}
                          className="grid size-6 place-items-center rounded-md text-ink-500 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
                        >
                          <Icon name="mais" className="size-3" strokeWidth={2.4} />
                        </button>
                      </div>
                    )}
                    <span className="tabular w-20 shrink-0 text-right text-[13px] font-bold text-ink-900">
                      {moeda(l.qtd * l.preco)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setPilhaDesfazer((p) => [...p, l]);
                        atualizarLinhas((atual) => atual.filter((x) => x.produtoId !== l.produtoId));
                      }}
                      className="shrink-0 rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Icon name="lixo" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* COLUNA 2: RESUMO + PAGAMENTOS (ALT+1..6) + CLIENTE (F8) + DESCONTO (F4) + FINALIZAR (F10) */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <Card className="shrink-0 p-0">
            <div className="border-b border-ink-100 bg-ink-900 px-4 py-3 text-white">
              <p className="micro text-ink-300">Resumo da operação</p>
              <p className="tabular mt-1 text-[30px] font-black leading-none tracking-[-0.03em]">{moeda(total)}</p>
              <p className="mt-1 text-[11.5px] text-ink-300">
                {linhas.length} item(ns) · {unidadesBipadas} un. · subtotal {moeda(subtotal)}
              </p>
            </div>
            <dl className="space-y-1.5 px-4 py-2.5 text-[12.5px]">
              <div className="flex justify-between">
                <dt className="text-ink-500">Desconto aplicado</dt>
                <dd className="tabular font-semibold text-rose-600">− {moeda(desconto)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Pago</dt>
                <dd className="tabular font-semibold text-ink-800">{moeda(pago)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">{falta > 0 ? "Falta receber" : "Troco"}</dt>
                <dd className={cn("tabular font-bold", falta > 0 ? "text-amber-600" : "text-way-700")}>
                  {moeda(falta > 0 ? falta : troco)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-ink-100 pt-1.5">
                <dt className="text-ink-500">Tributos approx. (IBS/CBS)</dt>
                <dd className="tabular font-semibold text-ink-600">{moeda(trib.total)}</dd>
              </div>
            </dl>
            <div className="space-y-2 border-t border-ink-100 px-4 py-3">
              <Button
                className="w-full pulse-way"
                disabled={ocupado || total <= 0}
                onClick={abrirModalFinalizacao}
              >
                {ocupado ? "Processando…" : `Finalizar (F10) · ${moeda(total)}`}
              </Button>
              <p className="text-center text-[10.5px] leading-snug text-ink-400">
                Escolha ao finalizar: Salvar como DAV · Finalizar sem nota · Finalizar e emitir NFC-e.
              </p>
            </div>
          </Card>

          <Card className="shrink-0">
            <p className="micro mb-2 text-ink-400">Forma de pagamento · Alt+1 a Alt+6 ou setas ← →</p>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Formas de pagamento">
              {FORMAS_PAGAMENTO.map((f) => {
                const usado = pagamentos.filter((p) => p.forma === f.id).reduce((s, p) => s + p.valor, 0);
                const atalhoIdx = FORMAS_ATALHO_ALT.find((a) => a.forma === f.id)?.digito;
                return (
                  <button
                    key={f.id}
                    ref={(el) => {
                      formasLateralRefs.current[f.id] = el;
                    }}
                    type="button"
                    onClick={() =>
                      usado > 0
                        ? setPagamentos(pagamentos.filter((p) => p.forma !== f.id))
                        : definirPagamentoAutomatico(f.id)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                        e.preventDefault();
                        const prox = ciclarFormaPagamentoPdv(f.id, 1);
                        formasLateralRefs.current[prox]?.focus();
                      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const ant = ciclarFormaPagamentoPdv(f.id, -1);
                        formasLateralRefs.current[ant]?.focus();
                      }
                    }}
                    className={cn(
                      "rounded-lg px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-way-500",
                      usado > 0
                        ? "bg-way-600 text-white ring-way-600"
                        : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50",
                    )}
                  >
                    <span className="flex items-center justify-center gap-1">
                      {atalhoIdx && (
                        <kbd
                          className={cn(
                            "rounded px-1 font-mono text-[9.5px]",
                            usado > 0 ? "bg-way-700 text-way-100" : "bg-ink-100 text-ink-500",
                          )}
                        >
                          {atalhoIdx}
                        </kbd>
                      )}
                      <span>{f.label}</span>
                    </span>
                    {usado > 0 && (
                      <span className="tabular mt-0.5 block text-[10px] font-medium opacity-90">{moeda(usado)}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {pagamentos.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pagamentos.map((p, i) => (
                  <li key={`${p.forma}-${i}`} className="flex items-center gap-2 rounded-md bg-ink-50 px-2 py-1">
                    <span className="flex-1 text-[12px] font-semibold text-ink-700">
                      {FORMAS_PAGAMENTO.find((f) => f.id === p.forma)?.label ?? p.forma}
                    </span>
                    <input
                      value={p.valor}
                      onChange={(e) => {
                        const ed = editarParcelaPagamentoPdv({
                          pagamentosAtuais: pagamentos,
                          totalVenda: total,
                          indice: i,
                          novoValor: e.target.value,
                        });
                        setPagamentos(ed.pagamentos);
                        if (ed.limitadoAoSaldo) {
                          toast("Valor limitado ao saldo restante (troco permitido apenas em dinheiro).", "info");
                        }
                      }}
                      className="tabular w-24 rounded bg-white px-1.5 py-0.5 text-right text-[12px] font-semibold ring-1 ring-inset ring-ink-200 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPagamentos(pagamentos.filter((_, xi) => xi !== i))}
                      className="text-ink-300 hover:text-rose-600"
                    >
                      <Icon name="x" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Campo rotulo="Valor recebido (dinheiro)" className="flex-1">
                <Input
                  dinheiro
                  valor={recebido}
                  aoMudar={setRecebido}
                  placeholder="0,00"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const v = lerValorMonetarioPdv(recebido);
                      if (Number.isFinite(v) && v > 0) {
                        const semDinheiro = pagamentos.filter((p) => p.forma !== "dinheiro");
                        const r = registrarParcelaPagamentoPdv({
                          pagamentosAtuais: semDinheiro,
                          totalVenda: total,
                          forma: "dinheiro",
                          valorInformado: v,
                        });
                        if (r.ok) {
                          setPagamentos(r.pagamentos);
                          setRecebido("");
                        } else {
                          toast(r.erro, "erro");
                        }
                      }
                    }
                  }}
                />
              </Campo>
              <Button
                variante="secundario"
                className="mt-5"
                onClick={() => setPagamentos([])}
                disabled={pagamentos.length === 0}
              >
                Zerar
              </Button>
            </div>
            {cedulasSugeridas.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-semibold uppercase text-ink-400">Dinheiro rápido:</span>
                {cedulasSugeridas.map((val, idx) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      const r = registrarParcelaPagamentoPdv({
                        pagamentosAtuais: pagamentos,
                        totalVenda: total,
                        forma: "dinheiro",
                        valorInformado: val,
                      });
                      if (r.ok) setPagamentos(r.pagamentos);
                    }}
                    className="tabular rounded bg-ink-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 transition hover:bg-way-50 hover:text-way-800 hover:ring-way-300"
                  >
                    {idx === 0 ? `Exato ${moeda(val)}` : moeda(val)}
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card className="shrink-0">
            <p className="micro mb-2 text-ink-400">Cliente (F8) e desconto (F4)</p>
            <button
              type="button"
              onClick={() => {
                setRetornarAoFinalizarAposCliente(false);
                setCursorCliente(0);
                setAbertoCliente(true);
                setBuscaCliente("");
              }}
              className="flex w-full items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-2 text-left transition hover:bg-ink-100"
            >
              <Icon name="pessoas" className="size-4 text-ink-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink-800">
                  {cliente?.nome ?? "CONSUMIDOR"}
                </span>
                <span className="block truncate text-[10.5px] text-ink-400">
                  {cliente
                    ? `${cliente.documento || "sem documento"} · ${cliente.condicaoPadrao}${cliente.limiteCredito > 0 ? ` · disp. ${moeda(Math.max(0, round2(cliente.limiteCredito - cliente.saldoEmAberto)))}` : ""}`
                    : "F8 para identificar"}
                </span>
              </span>
              {cliente && cliente.saldoEmAberto > 0 && <Badge tom="alerta">{moeda(cliente.saldoEmAberto)}</Badge>}
              <kbd className="rounded bg-white px-1 py-px font-mono text-[9.5px] text-ink-400 ring-1 ring-inset ring-ink-200">
                F8
              </kbd>
            </button>
            {!validacaoCredito.ok && (
              <div
                role="alert"
                className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
              >
                <span className="min-w-0 flex-1">{validacaoCredito.erro}</span>
                <button
                  type="button"
                  onClick={() => {
                    setRetornarAoFinalizarAposCliente(false);
                    setCursorCliente(0);
                    setAbertoCliente(true);
                    setBuscaCliente("");
                  }}
                  className="shrink-0 rounded bg-white px-2 py-0.5 text-[10.5px] font-bold text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-100"
                >
                  F8 Cliente
                </button>
              </div>
            )}

            <div className="mt-2 flex items-end gap-2">
              <Campo rotulo="Desconto (F4)" className="flex-1">
                <input
                  ref={descontoRef}
                  value={descontoValor}
                  onChange={(e) => setDescontoValor(e.target.value)}
                  placeholder="0,00"
                  className="tabular w-full rounded-lg border-0 bg-white px-2.5 py-1.5 text-right text-[13px] text-ink-800 ring-1 ring-inset ring-ink-200 outline-none transition placeholder:text-ink-300 focus:ring-2 focus:ring-way-500"
                />
              </Campo>
              <div className="flex rounded-lg bg-ink-50 p-0.5">
                {(["real", "percentual"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDescontoModo(m)}
                    className={cn(
                      "rounded px-2 py-1.5 text-[12px] font-bold transition",
                      descontoModo === m ? "bg-white text-ink-900 shadow-sm" : "text-ink-400",
                    )}
                  >
                    {m === "real" ? "R$" : "%"}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Campo rotulo="Documento fiscal (← →)">
                <div
                  role="radiogroup"
                  aria-label="Modelo de documento fiscal"
                  className="grid grid-cols-3 gap-1 rounded-lg bg-ink-50 p-0.5 ring-1 ring-inset ring-ink-200"
                >
                  {MODELOS_FISCAIS_PDV.map((mod) => {
                    const ativoMod = modelo === mod;
                    return (
                      <button
                        key={mod}
                        ref={(el) => {
                          modelosLateralRefs.current[mod] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={ativoMod}
                        onClick={() => setModelo(mod)}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                            e.preventDefault();
                            const prox = ciclarModeloFiscalPdv(mod, 1);
                            setModelo(prox);
                            modelosLateralRefs.current[prox]?.focus();
                          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const ant = ciclarModeloFiscalPdv(mod, -1);
                            setModelo(ant);
                            modelosLateralRefs.current[ant]?.focus();
                          }
                        }}
                        className={cn(
                          "rounded-md py-1.5 text-center text-[11px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-way-500",
                          ativoMod ? "bg-ink-900 text-white shadow-sm" : "text-ink-500 hover:text-ink-900",
                        )}
                      >
                        {mod}
                      </button>
                    );
                  })}
                </div>
              </Campo>
              <Campo rotulo="Validade do DAV">
                <Input type="date" valor={validadeDav} aoMudar={setValidadeDav} />
              </Campo>
            </div>
          </Card>
        </aside>
      </div>

      {/* ETAPA 5 — BARRA DE STATUS INFERIOR + LEGENDA GERADA DE ATALHOS_PDV */}
      <footer className="sem-impressao flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-ink-200 bg-white px-3 py-1.5 text-[11px] text-ink-600 sm:px-4">
        <div className="flex flex-wrap items-center gap-3 font-medium">
          {multiplicador.status === "armado" && (
            <>
              <span
                role="status"
                aria-label={multiplicador.rotulo}
                className="inline-flex items-center gap-1 rounded bg-way-600 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-white"
              >
                <span>{multiplicador.rotulo}</span>
                <button
                  type="button"
                  aria-label="Cancelar multiplicador armado"
                  onClick={() => {
                    atualizarMultiplicador(
                      transicionarMultiplicadorPdv(multiplicadorRef.current, { tipo: "CANCELAR" }).estado,
                    );
                    buscaRef.current?.focus();
                  }}
                  className="ml-0.5 rounded px-0.5 text-way-100 hover:bg-way-700 hover:text-white"
                >
                  ×
                </button>
              </span>
              <span className="text-ink-300">·</span>
            </>
          )}
          {multiplicador.status === "digitando" && (
            <>
              <span
                role="status"
                className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10.5px] font-bold text-amber-900 ring-1 ring-inset ring-amber-300"
              >
                Multiplicador × {multiplicador.rascunho || "…"}
              </span>
              <span className="text-ink-300">·</span>
            </>
          )}
          <span className="tabular">
            <strong className="text-ink-900">{linhas.length}</strong> itens
          </span>
          <span className="text-ink-300">·</span>
          <span className="tabular">
            <strong className="text-ink-900">{formatarQtdPdv(unidadesBipadas)}</strong> un. bipadas
          </span>
          <span className="text-ink-300">·</span>
          <span className="tabular">
            Pago <strong className="text-ink-900">{moeda(pago)}</strong>
          </span>
          <span className="text-ink-300">·</span>
          <span className="tabular">
            {falta > 0 ? (
              <>
                Falta <strong className="text-amber-700">{moeda(falta)}</strong>
              </>
            ) : (
              <>
                Troco <strong className="text-way-700">{moeda(troco)}</strong>
              </>
            )}
          </span>
          <span className="text-ink-300">·</span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className={cn(
                "size-2 rounded-full",
                fila > 0 ? "bg-amber-500" : online ? "bg-way-500" : "bg-rose-500",
              )}
            />
            <strong className={fila > 0 ? "text-amber-700" : "text-ink-800"}>
              {fila > 0 ? `${fila} venda(s) na fila` : online ? "Online" : "Offline"}
            </strong>
          </span>
        </div>

        {/* Legenda lida diretamente da lista única ATALHOS_PDV (Etapa 4) */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-ink-500">
          {atalhosBarraInferior.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1">
              <kbd className="rounded bg-ink-100 px-1 py-px font-mono text-[9.5px] font-bold text-ink-700">
                {a.tecla}
              </kbd>
              <span>{a.rotuloCurto}</span>
            </span>
          ))}
        </div>
      </footer>

      {/* ETAPA 2 — MODAL DE CONFIRMAÇÃO DE SAÍDA COM 3 OPÇÕES */}
      <Modal
        aberto={modalSaida}
        aoFechar={() => setModalSaida(false)}
        titulo="Sair do PDV com venda em andamento?"
        descricao={`Existem ${linhas.length} item(ns) somando ${moeda(total)} na tela atual.`}
        largura="max-w-lg"
        rodape={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variante="secundario"
              onClick={() => {
                setModalSaida(false);
                buscaRef.current?.focus();
              }}
            >
              Continuar no PDV
            </Button>
            <Button
              variante="perigo"
              onClick={async () => {
                descartarVendaLocal();
                setModalSaida(false);
                await sairDaTelaCheiaSilencioso();
                router.push(destinoSaida);
              }}
            >
              Descartar e sair
            </Button>
            <Button
              variante="primario"
              onClick={async () => {
                // Não apaga nkway.fila no localStorage; limpa apenas o rascunho em memória e sai
                descartarVendaLocal();
                setModalSaida(false);
                await sairDaTelaCheiaSilencioso();
                router.push(destinoSaida);
              }}
            >
              Sair mantendo a fila offline{fila > 0 ? ` (${fila})` : ""}
            </Button>
          </div>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-600">
          A fila offline possui atualmente <strong>{fila} venda(s)</strong> gravada(s) neste navegador (
          <code className="rounded bg-ink-100 px-1 py-0.5 text-[11.5px]">nkway.fila</code>). Caso queira guardar os
          itens atuais como orçamento antes de sair, clique em <strong>Continuar no PDV</strong> e use{" "}
          <strong>Finalizar (F10) → Salvar como DAV</strong>.
        </p>
      </Modal>

      {/* ETAPA 4 — MODAL DE AJUDA DE ATALHOS (F1) LENDO DE ATALHOS_PDV */}
      <Modal
        aberto={modalAjuda}
        aoFechar={() => {
          setModalAjuda(false);
          buscaRef.current?.focus();
        }}
        titulo="Atalhos da Frente de Caixa (F1)"
        descricao="Lista oficial de comandos do teclado e alternativas seguras para navegadores"
        largura="max-w-2xl"
        rodape={
          <Button
            onClick={() => {
              setModalAjuda(false);
              buscaRef.current?.focus();
            }}
          >
            Fechar (Esc)
          </Button>
        }
      >
        <div className="divide-y divide-ink-100">
          {ATALHOS_PDV.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-900">{a.rotuloCurto}</p>
                <p className="text-ink-600">{a.descricao}</p>
                {a.alternativaNavegador && (
                  <p className="mt-0.5 text-[11px] text-ink-400">Alternativa: {a.alternativaNavegador}</p>
                )}
              </div>
              <kbd className="shrink-0 rounded-md bg-ink-900 px-2 py-1 font-mono text-[11px] font-bold text-white">
                {a.tecla}
              </kbd>
            </div>
          ))}
        </div>
      </Modal>

      {/* ETAPA 4 & ETAPA 6 — CONFIRMAÇÃO PARA CANCELAR/ESVAZIAR VENDA (F6) */}
      <Modal
        aberto={modalCancelarVenda}
        aoFechar={() => {
          setModalCancelarVenda(false);
          buscaRef.current?.focus();
        }}
        titulo="Cancelar venda em andamento (F6)?"
        descricao={`Todos os ${linhas.length} item(ns) (${moeda(total)}) serão removidos da tela.`}
        largura="max-w-md"
        rodape={
          <>
            <Button
              variante="secundario"
              onClick={() => {
                setModalCancelarVenda(false);
                buscaRef.current?.focus();
              }}
            >
              Voltar à venda
            </Button>
            <Button
              variante="perigo"
              icone="lixo"
              onClick={() => {
                descartarVendaLocal();
                setModalCancelarVenda(false);
                toast("Venda atual cancelada e tela limpa.", "info");
                buscaRef.current?.focus();
              }}
            >
              Sim, esvaziar venda
            </Button>
          </>
        }
      >
        <p className="text-[12.5px] text-ink-600">
          Esta ação limpa apenas os itens ainda não finalizados na tela atual. Nenhuma nota já salva nem a fila offline
          serão afetadas.
        </p>
      </Modal>

      {/* ETAPA 9 + COMPLEMENTOS 2 E 3 — MODAL DE FINALIZAÇÃO 100% NAVEGÁVEL POR TECLADO (SETAS ← → ↑ ↓ + ENTER) */}
      <Modal
        aberto={modalFinalizar}
        aoFechar={() => {
          if (confirmandoEmissaoNfce) {
            setConfirmandoEmissaoNfce(false);
            setNavFinalizar((at) => ({ ...at, secao: "opcoes", opcaoFechamento: "emitir_nfce" }));
            return;
          }
          setModalFinalizar(false);
          setConfirmandoEmissaoNfce(false);
          buscaRef.current?.focus();
        }}
        titulo="Finalizar operação (F10)"
        descricao="Use as setas ← → ↑ ↓ e Enter para escolher pagamento, modelo fiscal e tipo de fechamento sem mouse"
        largura="max-w-2xl"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-ink-900 p-3.5 text-white">
            <div>
              <p className="micro text-ink-300">Total</p>
              <p className="tabular mt-0.5 text-[20px] font-black">{moeda(total)}</p>
            </div>
            <div>
              <p className="micro text-ink-300">Pago</p>
              <p className="tabular mt-0.5 text-[18px] font-bold">
                {moeda(pagamentos.length > 0 ? pago : total)}
              </p>
            </div>
            <div>
              <p className="micro text-ink-300">{falta > 0 && pagamentos.length > 0 ? "Falta" : "Troco"}</p>
              <p
                className={cn(
                  "tabular mt-0.5 text-[18px] font-bold",
                  falta > 0 && pagamentos.length > 0 ? "text-amber-300" : "text-way-300",
                )}
              >
                {moeda(falta > 0 && pagamentos.length > 0 ? falta : troco)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-way-50/80 px-3 py-1.5 text-[11px] font-medium text-way-900 ring-1 ring-inset ring-way-200">
            <span>
              <strong>Teclado:</strong> <kbd className="rounded bg-white px-1 font-mono text-[10px]">←</kbd>{" "}
              <kbd className="rounded bg-white px-1 font-mono text-[10px]">→</kbd> troca forma ou modelo fiscal ·{" "}
              <kbd className="rounded bg-white px-1 font-mono text-[10px]">↑</kbd>{" "}
              <kbd className="rounded bg-white px-1 font-mono text-[10px]">↓</kbd> navega até DAV / Sem nota / Emitir ·{" "}
              <kbd className="rounded bg-white px-1 font-mono text-[10px]">Enter</kbd> confirma
            </span>
          </div>

          {!confirmandoEmissaoNfce && (
            <div
              className={cn(
                "rounded-xl border p-3 transition",
                navFinalizar.secao === "formas" || navFinalizar.secao === "valor"
                  ? "border-way-400 bg-way-50/35 ring-1 ring-inset ring-way-200"
                  : "border-ink-200 bg-ink-50/70",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="micro text-ink-600">
                  1. Forma de pagamento (← → escolhe · Enter lança · ↓ vai ao documento)
                </p>
                {pagamentos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setPagamentos([]);
                      setValorParcelaModal(total.toFixed(2).replace(".", ","));
                      setMsgPagamentoModal(null);
                      setNavFinalizar((at) => ({ ...at, secao: "formas" }));
                    }}
                    className="text-[11px] font-semibold text-rose-600 hover:underline"
                  >
                    Zerar parcelas
                  </button>
                )}
              </div>

              <div
                role="radiogroup"
                aria-label="Forma de pagamento no fechamento"
                className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6"
              >
                {FORMAS_PAGAMENTO.map((f) => {
                  const selecionada = formaAtivaModal === f.id;
                  const emFocoFormas = navFinalizar.secao === "formas" && selecionada;
                  const lancado = pagamentos
                    .filter((p) => p.forma === f.id)
                    .reduce((s, p) => round2(s + p.valor), 0);
                  const digito = FORMAS_ATALHO_ALT.find((a) => a.forma === f.id)?.digito;
                  return (
                    <button
                      key={f.id}
                      ref={(el) => {
                        formasModalRefs.current[f.id] = el;
                      }}
                      data-f10-zona="formas"
                      type="button"
                      role="radio"
                      aria-checked={selecionada}
                      onFocus={() => {
                        setFormaAtivaModal(f.id);
                        setNavFinalizar((at) => ({ ...at, secao: "formas", formaAtiva: f.id }));
                      }}
                      onClick={() => selecionarFormaNoModalFinalizar(f.id)}
                      className={cn(
                        "rounded-lg px-2 py-2 text-center text-[11.5px] font-bold ring-1 ring-inset transition outline-none",
                        selecionada
                          ? "bg-way-600 text-white ring-way-700"
                          : lancado > 0
                            ? "bg-way-50 text-way-900 ring-way-300"
                            : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-100",
                        emFocoFormas && "ring-2 ring-ink-900 ring-offset-2",
                      )}
                    >
                      <span className="block truncate">
                        {selecionada ? "▶ " : digito ? `${digito}. ` : ""}
                        {f.label}
                      </span>
                      {lancado > 0 && (
                        <span className="tabular block text-[10px] font-semibold opacity-90">{moeda(lancado)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {falta > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[160px] flex-1">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] font-bold text-ink-400">
                      R$
                    </span>
                    <input
                      ref={valorParcelaModalRef}
                      data-f10-zona="valor"
                      value={valorParcelaModal}
                      onFocus={() => setNavFinalizar((at) => ({ ...at, secao: "valor" }))}
                      onChange={(e) => {
                        setValorParcelaModal(e.target.value.replace(/[^\d.,]/g, ""));
                        setMsgPagamentoModal(null);
                      }}
                      placeholder={falta.toFixed(2).replace(".", ",")}
                      aria-label={`Valor a lançar em ${rotuloForma(formaAtivaModal)}`}
                      className={cn(
                        "tabular w-full rounded-lg bg-white py-1.5 pl-8 pr-2.5 text-right text-[14px] font-extrabold text-ink-900 ring-1 ring-inset outline-none transition",
                        navFinalizar.secao === "valor"
                          ? "ring-2 ring-way-600"
                          : "ring-ink-200 focus:ring-2 focus:ring-way-500",
                      )}
                    />
                  </div>
                  <Button
                    tamanho="sm"
                    data-f10-zona="valor"
                    onClick={() => lancarParcelaNoModalFinalizar()}
                  >
                    Lançar {rotuloForma(formaAtivaModal)} ↵
                  </Button>
                </div>
              )}

              {formaAtivaModal === "dinheiro" && falta > 0 && cedulasSugeridas.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="text-[10.5px] font-semibold text-ink-400">Cédulas:</span>
                  {cedulasSugeridas.map((val, idx) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => lancarParcelaNoModalFinalizar(val)}
                      className="tabular rounded bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-way-50 hover:text-way-800"
                    >
                      {idx === 0 ? `Exato ${moeda(val)}` : moeda(val)}
                    </button>
                  ))}
                  {(() => {
                    const prev = lerValorMonetarioPdv(valorParcelaModal);
                    if (Number.isFinite(prev) && prev > falta) {
                      return (
                        <span className="tabular ml-auto text-[11.5px] font-bold text-way-700">
                          Troco previsto: {moeda(round2(prev - falta))}
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}

              {pagamentos.length > 0 && (
                <ul className="mt-2 divide-y divide-ink-100 rounded-lg bg-white ring-1 ring-inset ring-ink-200">
                  {pagamentos.map((p, i) => (
                    <li key={`${p.forma}-${i}`} className="flex items-center justify-between px-2.5 py-1.5 text-[12px]">
                      <span className="font-semibold text-ink-700">{rotuloForma(p.forma)}</span>
                      <span className="flex items-center gap-2">
                        <strong className="tabular text-ink-900">{moeda(p.valor)}</strong>
                        <button
                          type="button"
                          onClick={() => {
                            const restantes = pagamentos.filter((_, xi) => xi !== i);
                            setPagamentos(restantes);
                            const novoRes = calcularResumoPagamentoPdv(restantes, total);
                            setValorParcelaModal(
                              novoRes.falta > 0 ? novoRes.falta.toFixed(2).replace(".", ",") : "",
                            );
                            if (novoRes.falta > 0) {
                              setNavFinalizar((at) => ({ ...at, secao: "formas" }));
                            }
                          }}
                          title="Remover parcela"
                          className="rounded p-0.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Icon name="x" className="size-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {msgPagamentoModal && (
                <p
                  role="status"
                  className={cn(
                    "mt-2 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold",
                    msgPagamentoModal.tom === "erro"
                      ? "bg-rose-50 text-rose-700"
                      : msgPagamentoModal.tom === "ok"
                        ? "bg-way-50 text-way-800"
                        : "bg-amber-50 text-amber-800",
                  )}
                >
                  {msgPagamentoModal.texto}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-50 p-3 text-[12px] text-ink-600">
            <div>
              <p>
                <strong>Cliente:</strong> {cliente?.nome ?? "CONSUMIDOR"} · <strong>Itens:</strong> {linhas.length} (
                {formatarQtdPdv(unidadesBipadas)} un.)
              </p>
              <p className="mt-0.5">
                <strong>Pagamento efetivo:</strong>{" "}
                {pagamentos.length > 0
                  ? pagamentos.map((p) => `${rotuloForma(p.forma)} (${moeda(p.valor)})`).join(" + ")
                  : `${rotuloForma(formaAtivaModal)} (${moeda(total)})`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setModalFinalizar(false);
                setRetornarAoFinalizarAposCliente(true);
                setCursorCliente(0);
                setAbertoCliente(true);
                setBuscaCliente("");
              }}
              className="rounded-lg bg-white px-2.5 py-1 text-[11.5px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-100"
            >
              Trocar cliente (F8)
            </button>
          </div>

          {!validacaoCredito.ok && (
            <div
              role="alert"
              className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
            >
              {validacaoCredito.erro}
            </div>
          )}

          {!confirmandoEmissaoNfce ? (
            <div className="space-y-2.5 pt-0.5">
              {/* SELETOR POR TECLADO DO MODELO FISCAL (NFC-e / NF-e / SAT) */}
              <div
                className={cn(
                  "rounded-xl border px-3 py-2 transition",
                  navFinalizar.secao === "modelo"
                    ? "border-way-500 bg-way-50/40 ring-1 ring-inset ring-way-300"
                    : "border-ink-200 bg-white",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="micro text-ink-500">2. Modelo do documento fiscal (← → alterna)</span>
                  <div
                    role="radiogroup"
                    aria-label="Modelo fiscal da nota"
                    className="grid grid-cols-3 gap-1.5"
                  >
                    {(
                      [
                        { id: "NFC-e", rotulo: "NFC-e (65)" },
                        { id: "NF-e", rotulo: "NF-e (55)" },
                        { id: "SAT", rotulo: "SAT (59)" },
                      ] as const
                    ).map((m) => {
                      const ativoM = modelo === m.id;
                      const focadoM = navFinalizar.secao === "modelo" && ativoM;
                      return (
                        <button
                          key={m.id}
                          ref={(el) => {
                            modelosModalRefs.current[m.id] = el;
                          }}
                          data-f10-zona="modelo"
                          type="button"
                          role="radio"
                          aria-checked={ativoM}
                          onFocus={() => {
                            setModelo(m.id);
                            setNavFinalizar((at) => ({ ...at, secao: "modelo", modeloFiscal: m.id }));
                          }}
                          onClick={() => {
                            setModelo(m.id);
                            setNavFinalizar((at) => ({ ...at, secao: "modelo", modeloFiscal: m.id }));
                          }}
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-[11.5px] font-bold ring-1 ring-inset transition outline-none",
                            ativoM
                              ? "bg-ink-900 text-white ring-ink-900"
                              : "bg-ink-50 text-ink-600 ring-ink-200 hover:bg-ink-100",
                            focadoM && "ring-2 ring-way-500 ring-offset-1",
                          )}
                        >
                          {ativoM ? `▶ ${m.rotulo}` : m.rotulo}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* AS 3 OPÇÕES DE DOCUMENTO / REGISTRO NAVEGÁVEIS COM ↑ ↓ + ENTER (OU TECLAS 1, 2, 3) */}
              {(() => {
                const opcaoSelecionada = resolverOpcaoFechamentoValidaPdv(navFinalizar.opcaoFechamento, {
                  podeDav: podeOpcaoDavModal,
                  podeSemNota: podeOpcaoSemNotaModal,
                  podeEmitirFiscal: podeOpcaoFiscalModal,
                });
                const focadoEmOpcoes = navFinalizar.secao === "opcoes";

                return (
                  <div role="radiogroup" aria-label="Tipo de documento e fechamento" className="grid gap-2">
                    <button
                      ref={(el) => {
                        opcoesModalRefs.current.dav = el;
                      }}
                      data-f10-zona="opcoes"
                      type="button"
                      role="radio"
                      aria-checked={opcaoSelecionada === "dav"}
                      disabled={!podeOpcaoDavModal}
                      onFocus={() => setNavFinalizar((at) => ({ ...at, secao: "opcoes", opcaoFechamento: "dav" }))}
                      onClick={() => void executarFechamento("dav")}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition outline-none disabled:opacity-45",
                        focadoEmOpcoes && opcaoSelecionada === "dav"
                          ? "border-ink-900 bg-way-50/70 ring-2 ring-ink-900 ring-offset-1"
                          : opcaoSelecionada === "dav"
                            ? "border-way-400 bg-way-50/30"
                            : "border-ink-200 bg-white hover:border-way-400 hover:bg-way-50/40",
                      )}
                    >
                      <div>
                        <p className="text-[13.5px] font-bold text-ink-900">
                          {opcaoSelecionada === "dav" ? "▶ " : ""}1. Salvar como DAV
                        </p>
                        <p className="text-[11.5px] text-ink-500">
                          Pré-venda / orçamento sem chave fiscal e sem baixar estoque (validade {validadeDav}).
                        </p>
                      </div>
                      <Badge tom="neutro">Sem baixa</Badge>
                    </button>

                    <button
                      ref={(el) => {
                        opcoesModalRefs.current.sem_nota = el;
                      }}
                      data-f10-zona="opcoes"
                      type="button"
                      role="radio"
                      aria-checked={opcaoSelecionada === "sem_nota"}
                      disabled={!podeOpcaoSemNotaModal}
                      onFocus={() =>
                        setNavFinalizar((at) => ({ ...at, secao: "opcoes", opcaoFechamento: "sem_nota" }))
                      }
                      onClick={() => void executarFechamento("sem_nota")}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition outline-none disabled:opacity-45",
                        focadoEmOpcoes && opcaoSelecionada === "sem_nota"
                          ? "border-ink-900 bg-way-50/70 ring-2 ring-ink-900 ring-offset-1"
                          : opcaoSelecionada === "sem_nota"
                            ? "border-way-400 bg-way-50/30"
                            : "border-ink-200 bg-white hover:border-way-400 hover:bg-way-50/40",
                      )}
                    >
                      <div>
                        <p className="text-[13.5px] font-bold text-ink-900">
                          {opcaoSelecionada === "sem_nota" ? "▶ " : ""}2. Finalizar sem nota
                        </p>
                        <p className="text-[11.5px] text-ink-500">
                          Conclui a venda no caixa e baixa o estoque agora. A nota pode ser emitida depois em Documentos
                          (F3).
                        </p>
                      </div>
                      <Badge tom="info">Baixa estoque</Badge>
                    </button>

                    <button
                      ref={(el) => {
                        opcoesModalRefs.current.emitir_nfce = el;
                      }}
                      data-f10-zona="opcoes"
                      type="button"
                      role="radio"
                      aria-checked={opcaoSelecionada === "emitir_nfce"}
                      disabled={!podeOpcaoFiscalModal}
                      onFocus={() =>
                        setNavFinalizar((at) => ({ ...at, secao: "opcoes", opcaoFechamento: "emitir_nfce" }))
                      }
                      onClick={() => {
                        setNavFinalizar((at) => ({
                          ...at,
                          secao: "confirmacao",
                          opcaoFechamento: "emitir_nfce",
                          botaoConfirmacao: "confirmar",
                        }));
                        setConfirmandoEmissaoNfce(true);
                      }}
                      className={cn(
                        "flex items-center justify-between rounded-xl border border-way-600 bg-way-600 px-4 py-3 text-left text-white transition outline-none hover:bg-way-700 disabled:opacity-45",
                        focadoEmOpcoes &&
                          opcaoSelecionada === "emitir_nfce" &&
                          "ring-2 ring-ink-900 ring-offset-2",
                      )}
                    >
                      <div>
                        <p className="text-[14px] font-bold">
                          {opcaoSelecionada === "emitir_nfce" ? "▶ " : ""}3. Finalizar e emitir {modelo}
                        </p>
                        <p className="text-[11.5px] text-way-100">
                          Baixa o estoque, registra no caixa e solicita emissão fiscal (
                          {empresa.ambiente === "1" ? "Produção" : "Homologação"} · ← → troca NFC-e/NF-e/SAT).
                        </p>
                      </div>
                      <Icon name="seta" className="size-4 shrink-0" />
                    </button>
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-[13.5px] font-bold text-ink-900">
                Confirmar emissão de {modelo} no valor de {moeda(total)}?
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                Destinatário: <strong>{cliente?.nome ?? "CONSUMIDOR"}</strong> · Pagamento:{" "}
                <strong>
                  {pagamentos.length > 0
                    ? pagamentos.map((p) => `${rotuloForma(p.forma)} (${moeda(p.valor)})`).join(" + ")
                    : `${rotuloForma(formaAtivaModal)} (${moeda(total)})`}
                </strong>{" "}
                · Ambiente: <strong>{empresa.ambiente === "1" ? "1 (Produção)" : "2 (Homologação)"}</strong>. Caso a
                integração SEFAZ live não esteja ativa neste ambiente, o documento ficará com situação{" "}
                <strong>Pendente de transmissão</strong> (sem inventar protocolo ou autorização).
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-amber-800">
                  ← → alterna · Enter confirma · Esc volta
                </span>
                <div className="flex gap-2">
                  <button
                    ref={(el) => {
                      confirmacaoModalRefs.current.voltar = el;
                    }}
                    data-f10-zona="confirmacao"
                    type="button"
                    onFocus={() => setNavFinalizar((at) => ({ ...at, secao: "confirmacao", botaoConfirmacao: "voltar" }))}
                    onClick={() => {
                      setConfirmandoEmissaoNfce(false);
                      setNavFinalizar((at) => ({ ...at, secao: "opcoes", opcaoFechamento: "emitir_nfce" }));
                    }}
                    className={cn(
                      "rounded-lg bg-white px-3.5 py-2 text-[12.5px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 transition outline-none hover:bg-ink-50",
                      navFinalizar.botaoConfirmacao === "voltar" && "ring-2 ring-ink-900 ring-offset-1",
                    )}
                  >
                    {navFinalizar.botaoConfirmacao === "voltar" ? "▶ " : ""}Voltar às opções
                  </button>
                  <button
                    ref={(el) => {
                      confirmacaoModalRefs.current.confirmar = el;
                    }}
                    data-f10-zona="confirmacao"
                    type="button"
                    disabled={ocupado}
                    onFocus={() =>
                      setNavFinalizar((at) => ({ ...at, secao: "confirmacao", botaoConfirmacao: "confirmar" }))
                    }
                    onClick={() => void executarFechamento("emitir_nfce")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg bg-way-600 px-4 py-2 text-[12.5px] font-bold text-white transition outline-none hover:bg-way-700 disabled:opacity-45",
                      navFinalizar.botaoConfirmacao === "confirmar" && "ring-2 ring-ink-900 ring-offset-1",
                    )}
                  >
                    <Icon name="check" className="size-4" />
                    <span>
                      {ocupado
                        ? "Emitindo…"
                        : `${navFinalizar.botaoConfirmacao === "confirmar" ? "▶ " : ""}Confirmar e emitir ${modelo}`}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ETAPA 10 — BUSCA PAGINADA DE DOCUMENTOS NO SERVIDOR (F3) REAPROVEITANDO TABELA E IMPRESSAO */}
      <Modal
        aberto={modalDocumentos}
        aoFechar={() => {
          setModalDocumentos(false);
          buscaRef.current?.focus();
        }}
        titulo="Buscar documentos no PDV (F3)"
        descricao="Consulta direta no servidor por nº da venda, nº da nota, chave (com ou sem espaços), CPF/CNPJ, cliente ou protocolo"
        largura="max-w-5xl"
        rodape={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-ink-500">
              Total: <strong>{docTotal}</strong> documento(s) · Página <strong>{docPagina}</strong> de{" "}
              <strong>{docTotalPaginas}</strong>
            </span>
            <div className="flex items-center gap-2">
              <Button
                tamanho="sm"
                variante="secundario"
                disabled={docCarregando || docPagina <= 1}
                onClick={() => void carregarDocumentosServidor(docPagina - 1)}
              >
                ← Anterior
              </Button>
              <Button
                tamanho="sm"
                variante="secundario"
                disabled={docCarregando || docPagina >= docTotalPaginas}
                onClick={() => void carregarDocumentosServidor(docPagina + 1)}
              >
                Próxima →
              </Button>
              <Link href="/documentos">
                <Button tamanho="sm" variante="fantasma">
                  Abrir tela completa
                </Button>
              </Link>
            </div>
          </div>
        }
      >
        <BarraFiltros>
          <Campo rotulo="Busca única (chave c/ ou s/ espaços, nº, CPF/CNPJ, cliente, protocolo)" className="min-w-[260px] flex-1">
            <Input
              autoFocus
              valor={docBusca}
              aoMudar={setDocBusca}
              placeholder="Ex.: 105, chave 44 dígitos, CPF/CNPJ, nome ou protocolo"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void carregarDocumentosServidor(1);
                }
              }}
            />
          </Campo>
          <FiltroPeriodo
            valor={docPeriodo}
            aoMudar={(novo) => {
              setDocPeriodo(novo);
              void carregarDocumentosServidor(1, { periodo: novo });
            }}
          />
          <Campo rotulo="Tipo" className="w-36">
            <Select
              valor={docTipo}
              aoMudar={(v) => {
                const t = v as typeof docTipo;
                setDocTipo(t);
                void carregarDocumentosServidor(1, { tipo: t });
              }}
              opcoes={[
                { valor: "todos", rotulo: "Todos" },
                { valor: "fiscal", rotulo: "Fiscal (NF)" },
                { valor: "sem_nota", rotulo: "Sem nota" },
                { valor: "dav", rotulo: "DAV" },
              ]}
            />
          </Campo>
          <Campo rotulo="Situação" className="w-44">
            <Select
              valor={docSituacao}
              aoMudar={(v) => {
                setDocSituacao(v);
                void carregarDocumentosServidor(1, { situacao: v });
              }}
              opcoes={[
                { valor: "todas", rotulo: "Todas" },
                { valor: "faturado", rotulo: "Faturado" },
                { valor: "aberto", rotulo: "DAV em aberto" },
                { valor: "cancelado", rotulo: "Cancelado" },
                { valor: "autorizada", rotulo: "Autorizada SEFAZ" },
                { valor: "pendente_transmissao", rotulo: "Pendente transmissão" },
                { valor: "simulado", rotulo: "Simulado" },
                { valor: "nao_emitida", rotulo: "Não emitida" },
              ]}
            />
          </Campo>
          <Button
            icone="busca"
            disabled={docCarregando}
            onClick={() => void carregarDocumentosServidor(1)}
          >
            {docCarregando ? "Buscando…" : "Buscar"}
          </Button>
        </BarraFiltros>

        <Tabela
          chave={(v) => v.id}
          linhas={docItens}
          colunas={colunasDocumentosPdv}
          tamanhoPagina={10}
          compacta
          vazio={docCarregando ? "Consultando servidor…" : "Nenhum documento encontrado para os filtros informados."}
        />
      </Modal>

      {/* SELEÇÃO DE CLIENTE (F8) COM NAVEGAÇÃO POR SETAS ↑ ↓ + ENTER */}
      <Modal
        aberto={abertoCliente}
        aoFechar={() => {
          setAbertoCliente(false);
          if (retornarAoFinalizarAposCliente) {
            setRetornarAoFinalizarAposCliente(false);
            setModalFinalizar(true);
          } else {
            buscaRef.current?.focus();
          }
        }}
        titulo="Identificar cliente (F8)"
        descricao="Digite nome ou CPF/CNPJ · Setas ↑ ↓ escolhem · Enter confirma"
      >
        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300">
            <Icon name="busca" className="size-4" />
          </span>
          <input
            autoFocus
            value={buscaCliente}
            onChange={(e) => {
              setBuscaCliente(e.target.value);
              setCursorCliente(e.target.value.trim() ? 1 : 0);
            }}
            onKeyDown={(e) => {
              const totalOpcoes = 1 + clientesFiltradosModal.length;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursorCliente((at) => (at + 1) % totalOpcoes);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursorCliente((at) => (at - 1 + totalOpcoes) % totalOpcoes);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const idxNormalizado = Math.min(cursorCliente, totalOpcoes - 1);
                if (idxNormalizado <= 0) {
                  setClienteId(null);
                } else {
                  const escolhido = clientesFiltradosModal[idxNormalizado - 1];
                  if (escolhido) {
                    setClienteId(escolhido.id);
                    if (
                      pagamentos.length === 0 &&
                      (escolhido.condicaoPadrao === "30d" ||
                        escolhido.condicaoPadrao === "14d" ||
                        escolhido.condicaoPadrao === "7d" ||
                        escolhido.condicaoPadrao === "60d")
                    ) {
                      setPagamentos([{ forma: "prazo", valor: total }]);
                      setFormaAtivaModal("prazo");
                    }
                  }
                }
                setAbertoCliente(false);
                if (retornarAoFinalizarAposCliente) {
                  setRetornarAoFinalizarAposCliente(false);
                  setModalFinalizar(true);
                } else {
                  buscaRef.current?.focus();
                }
              }
            }}
            placeholder="nome, CPF ou CNPJ"
            className="w-full rounded-lg py-2 pl-9 pr-3 text-[13px] ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
          />
        </div>
        <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto">
          <li>
            <button
              type="button"
              onMouseEnter={() => setCursorCliente(0)}
              onClick={() => {
                setClienteId(null);
                setAbertoCliente(false);
                if (retornarAoFinalizarAposCliente) {
                  setRetornarAoFinalizarAposCliente(false);
                  setModalFinalizar(true);
                } else {
                  buscaRef.current?.focus();
                }
              }}
              className={cn(
                "w-full rounded-lg px-2.5 py-2.5 text-left text-[13px] font-semibold transition",
                cursorCliente === 0
                  ? "bg-way-50 text-way-900 ring-1 ring-inset ring-way-300"
                  : "text-ink-600 hover:bg-way-50",
              )}
            >
              {cursorCliente === 0 ? "▶ " : ""}CONSUMIDOR (sem identificação)
            </button>
          </li>
          {clientesFiltradosModal.map((c, idx) => {
            const pos = idx + 1;
            const destacado = cursorCliente === pos;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setCursorCliente(pos)}
                  onClick={() => {
                    setClienteId(c.id);
                    setAbertoCliente(false);
                    if (
                      pagamentos.length === 0 &&
                      (c.condicaoPadrao === "30d" ||
                        c.condicaoPadrao === "14d" ||
                        c.condicaoPadrao === "7d" ||
                        c.condicaoPadrao === "60d")
                    ) {
                      setPagamentos([{ forma: "prazo", valor: total }]);
                      setFormaAtivaModal("prazo");
                    }
                    if (retornarAoFinalizarAposCliente) {
                      setRetornarAoFinalizarAposCliente(false);
                      setModalFinalizar(true);
                    } else {
                      buscaRef.current?.focus();
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition",
                    destacado ? "bg-way-50 ring-1 ring-inset ring-way-300" : "hover:bg-way-50",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-800">
                      {destacado ? "▶ " : ""}
                      {c.nome}
                    </p>
                    <p className="text-[11px] text-ink-400">
                      {c.documento || "sem documento"} · {c.condicaoPadrao}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-[11px] font-semibold text-ink-500">lim. {moeda(c.limiteCredito)}</p>
                    <p
                      className={cn(
                        "tabular text-[11px] font-semibold",
                        c.saldoEmAberto > 0 ? "text-amber-600" : "text-way-600",
                      )}
                    >
                      em aberto {moeda(c.saldoEmAberto)}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </Modal>

      {/* COMPLEMENTO 3 — COMPROVANTE / BOBINA TÉRMICA 80 MM COMPLETA (.print-area) */}
      <Modal
        aberto={!!cupom}
        aoFechar={() => {
          setCupom(null);
          buscaRef.current?.focus();
        }}
        titulo={cupom ? `Comprovante · ${cupom.documentoRotulo}` : "Operação registrada"}
        descricao="Bobina térmica 80 mm pronta para impressão — pressione Enter para iniciar nova venda"
        largura="max-w-lg"
        rodape={
          <div className="no-print flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
                Imprimir 80 mm
              </Button>
              {cupom?.tipo === "fiscal" && (
                <Button
                  variante="suave"
                  icone="documento"
                  onClick={() => {
                    if (!cupom) return;
                    const docFiscal = converterReciboParaDocFiscalPdv(cupom);
                    if (docFiscal) {
                      setImprimindo({
                        tipo: "nfe",
                        emit: emitenteFinal,
                        cscId,
                        doc: docFiscal,
                      });
                    }
                  }}
                >
                  DANFE Oficial
                </Button>
              )}
            </div>
            <Button
              onClick={() => {
                setCupom(null);
                buscaRef.current?.focus();
              }}
            >
              Nova venda (Enter)
            </Button>
          </div>
        }
      >
        {cupom && (
          <div className={cn("max-h-[70vh] overflow-auto rounded-xl bg-ink-100 p-3", !imprimindo && "print-area")}>
            <div className="mx-auto w-[302px] rounded bg-white px-3 py-3 font-mono text-[10.5px] leading-[1.35] text-ink-900 shadow-sm">
              <div className="text-center">
                <p className="text-[12px] font-bold uppercase">{(empresa.fantasia || empresa.nome).toUpperCase()}</p>
                <p className="text-[10px]">{empresa.nome}</p>
                <p className="text-[9.5px] text-ink-600">
                  {[empresa.endereco, empresa.municipio].filter(Boolean).join(" · ")}
                </p>
                <p className="text-[10px]">CNPJ {empresa.documento}</p>
              </div>

              <div className="my-2 border-y border-dashed border-ink-300 py-1 text-center">
                <p className="font-bold uppercase">{cupom.tituloBobina}</p>
                <p className="text-[9px] text-ink-600">{cupom.subtituloBobina}</p>
              </div>

              <div className="space-y-0.5 text-[10px]">
                <div className="flex justify-between">
                  <span>{cupom.documentoRotulo}</span>
                  <span>{dataHoraBR(cupom.dataIso)}</span>
                </div>
                <div className="flex justify-between text-[9.5px] text-ink-600">
                  <span>{cupom.terminal}</span>
                  <span>Op.: {cupom.operador}</span>
                </div>
                <p className="truncate">
                  Cliente: <strong>{cupom.clienteNome}</strong>
                  {cupom.clienteDocumento ? ` (${cupom.clienteDocumento})` : ""}
                </p>
              </div>

              <table className="mt-2 w-full border-y border-dashed border-ink-300 text-[9.5px]">
                <thead>
                  <tr className="text-[8.5px] uppercase text-ink-500">
                    <th className="py-0.5 text-left">#</th>
                    <th className="py-0.5 text-left">Item</th>
                    <th className="py-0.5 text-right">Qtd×Un</th>
                    <th className="py-0.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cupom.itens.map((it) => (
                    <tr key={`${it.numero}-${it.nome}`} className="border-t border-ink-100">
                      <td className="py-0.5 pr-1 align-top">{it.numero}</td>
                      <td className="py-0.5 pr-1 align-top">
                        <span className="block font-semibold">{it.nome}</span>
                        <span className="text-[8.5px] text-ink-500">
                          {it.unidade} · {moeda(it.precoUnit)}
                        </span>
                      </td>
                      <td className="tabular py-0.5 pr-1 text-right align-top">{formatarQtdPdv(it.qtd)}</td>
                      <td className="tabular py-0.5 text-right align-top font-bold">{moeda(it.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="mt-1.5 space-y-0.5 text-[10px]">
                <div className="flex justify-between text-ink-600">
                  <span>
                    Itens: {cupom.qtdLinhas} ({formatarQtdPdv(cupom.unidadesTotais)} un.)
                  </span>
                  <span className="tabular">Subt. {moeda(cupom.subtotal)}</span>
                </div>
                {cupom.desconto > 0 && (
                  <div className="flex justify-between text-rose-700">
                    <span>Desconto</span>
                    <span className="tabular">− {moeda(cupom.desconto)}</span>
                  </div>
                )}
                {cupom.frete > 0 && (
                  <div className="flex justify-between">
                    <span>Frete</span>
                    <span className="tabular">{moeda(cupom.frete)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-ink-200 pt-0.5 text-[12px] font-bold text-ink-900">
                  <span>TOTAL</span>
                  <span className="tabular">{moeda(cupom.total)}</span>
                </div>
              </div>

              {cupom.parcelas.length > 0 && (
                <div className="mt-1.5 border-t border-dashed border-ink-300 pt-1 text-[10px]">
                  {cupom.parcelas.map((p, idx) => (
                    <div key={`${p.forma}-${idx}`} className="flex justify-between">
                      <span>{p.rotulo}</span>
                      <span className="tabular">{moeda(p.valor)}</span>
                    </div>
                  ))}
                  {cupom.troco > 0 && (
                    <div className="flex justify-between font-bold text-way-800">
                      <span>TROCO EM DINHEIRO</span>
                      <span className="tabular">{moeda(cupom.troco)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-1.5 border-t border-dashed border-ink-300 pt-1 text-center text-[9px] text-ink-600">
                <p>
                  Trib. aprox. {moeda(cupom.tributosTotal)} (Lei 12.741) · IBS {moeda(cupom.ibsEstimado)} · CBS{" "}
                  {moeda(cupom.cbsEstimado)}
                </p>
              </div>

              <div className="mt-1.5 border-t border-dashed border-ink-300 pt-1.5 text-center">
                <div className="no-print mb-1 flex justify-center">
                  <Badge tom={ROTULO_SITUACAO_FISCAL[cupom.situacaoFiscal].tom}>
                    {ROTULO_SITUACAO_FISCAL[cupom.situacaoFiscal].rotulo}
                  </Badge>
                </div>
                {cupom.chaveFormatada ? (
                  <>
                    <p className="text-[8.5px] uppercase text-ink-500">Chave de acesso</p>
                    <p className="break-all text-[9.5px] font-bold tracking-tight text-ink-900">
                      {cupom.chaveFormatada}
                    </p>
                    {cupom.protocolo && <p className="mt-0.5 text-[9px] text-ink-700">Protocolo {cupom.protocolo}</p>}
                  </>
                ) : (
                  <p className="text-[9.5px] text-ink-700">{cupom.avisoFiscal}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* COMPONENTE REAPROVEITADO DE IMPRESSÃO DANFE 80MM / A4 (ETAPA 10) */}
      <Impressao alvo={imprimindo} aoFechar={() => setImprimindo(null)} />

      {/* ABERTURA RÁPIDA DE CAIXA NO PDV */}
      <Modal
        aberto={modalAbrirCaixa}
        aoFechar={() => {
          setModalAbrirCaixa(false);
          setAcaoAposAbrirCaixa(null);
        }}
        titulo="Abrir sessão de caixa"
        descricao={`Operador: ${usuario.nome} · Libera vendas e controle de gaveta`}
        largura="max-w-md"
        rodape={
          <div className="flex justify-end gap-2">
            <Button
              variante="secundario"
              onClick={() => {
                setModalAbrirCaixa(false);
                setAcaoAposAbrirCaixa(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              icone="check"
              disabled={ocupado}
              onClick={async () => {
                setOcupado(true);
                const r = await abrirCaixa({ terminal: terminalRapido, saldoInicial: saldoRapido });
                setOcupado(false);
                if (!r.ok) {
                  toast(r.erro, "erro");
                  return;
                }
                const proximaAcao = acaoAposAbrirCaixa;
                setModalAbrirCaixa(false);
                setAcaoAposAbrirCaixa(null);
                router.refresh();
                if (proximaAcao && linhas.length > 0) {
                  await executarFechamento(proximaAcao, true);
                } else {
                  toast(r.aviso ?? "Caixa aberto.", "ok");
                }
              }}
            >
              {ocupado ? "Abrindo…" : acaoAposAbrirCaixa ? "Abrir caixa e concluir venda" : "Abrir caixa"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Campo rotulo="Terminal" obrigatorio>
            <Select
              valor={terminalRapido}
              aoMudar={setTerminalRapido}
              opcoes={[
                { valor: "CAIXA 1", rotulo: "CAIXA 1 — Frente principal" },
                { valor: "CAIXA 2", rotulo: "CAIXA 2 — Balcão rápido" },
                { valor: "CAIXA 3", rotulo: "CAIXA 3 — Expedição" },
              ]}
            />
          </Campo>
          <Campo rotulo="Saldo inicial em dinheiro (R$)" obrigatorio>
            <Input dinheiro valor={saldoRapido} aoMudar={setSaldoRapido} placeholder="0,00" />
          </Campo>
        </div>
      </Modal>

      {/* COMPLEMENTO 2 — MODAL DE CONSULTA DE PREÇO, ESTOQUE E TRIBUTOS (F7) SEM ADICIONAR À VENDA */}
      <Modal
        aberto={modalConsultaPreco}
        aoFechar={() => {
          setModalConsultaPreco(false);
          buscaRef.current?.focus();
        }}
        titulo="Consulta rápida de preço (F7)"
        descricao="Consulte preço, estoque, NCM e tributos (IBS/CBS/ICMS) sem alterar os itens da venda atual"
        largura="max-w-xl"
        rodape={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-ink-500">
              <span>Etiqueta balança (EAN 2…):</span>
              <button
                type="button"
                onClick={() => alternarModoEtiquetaBalanca(modoEtiquetaBalanca === "peso" ? "valor" : "peso")}
                className="rounded-md bg-ink-100 px-2 py-0.5 font-semibold text-ink-800 hover:bg-ink-200"
              >
                {modoEtiquetaBalanca === "peso" ? "Peso (gramas)" : "Valor (R$ centavos)"}
              </button>
            </div>
            <div className="flex items-center gap-2">
              {produtoDestaquePreco && (
                <Button
                  variante="suave"
                  icone="mais"
                  onClick={() => {
                    const qtdLevar = consultaPrecoDados.leituraBalanca?.pesoKg;
                    const ok = adicionar(produtoDestaquePreco, qtdLevar);
                    if (ok) {
                      setModalConsultaPreco(false);
                      buscaRef.current?.focus();
                    }
                  }}
                >
                  Levar para a venda
                </Button>
              )}
              <Button
                onClick={() => {
                  setModalConsultaPreco(false);
                  buscaRef.current?.focus();
                }}
              >
                Fechar (Esc)
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-way-600">
              <Icon name="busca" className="size-4" />
            </span>
            <input
              autoFocus
              value={buscaConsultaPreco}
              onChange={(e) => {
                setBuscaConsultaPreco(e.target.value);
                setIndiceConsultaPreco(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndiceConsultaPreco((i) =>
                    Math.min(Math.max(0, consultaPrecoDados.lista.length - 1), i + 1),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndiceConsultaPreco((i) => Math.max(0, i - 1));
                }
              }}
              placeholder="Bipe o código de barras / etiqueta de balança ou digite nome / SKU"
              className="w-full rounded-lg bg-ink-50 py-2.5 pl-9 pr-3 text-[14px] font-medium text-ink-900 ring-1 ring-inset ring-ink-200 outline-none focus:bg-white focus:ring-2 focus:ring-way-500"
            />
          </div>

          {produtoDestaquePreco ? (
            <div className="rounded-xl border border-way-200 bg-way-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-extrabold text-ink-900">{produtoDestaquePreco.nome}</p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-ink-500">
                    SKU {produtoDestaquePreco.sku} · GTIN {produtoDestaquePreco.gtin} · {produtoDestaquePreco.categoria}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tom="neutro">Unid. {produtoDestaquePreco.unidade}</Badge>
                    {produtoDestaquePreco.pesavel && <Badge tom="roxo">Pesável (balança)</Badge>}
                    <Badge
                      tom={
                        produtoDestaquePreco.estoque <= 0
                          ? "erro"
                          : produtoDestaquePreco.estoque <= produtoDestaquePreco.estoqueMin
                            ? "alerta"
                            : "ok"
                      }
                    >
                      Saldo: {formatarQtdPdv(produtoDestaquePreco.estoque)} {produtoDestaquePreco.unidade}
                    </Badge>
                    {produtoDestaquePreco.localizacao && (
                      <Badge tom="info">Loc. {produtoDestaquePreco.localizacao}</Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="micro text-way-700">Preço de venda</p>
                  <p className="tabular text-[28px] font-black leading-none text-way-800">
                    {moeda(produtoDestaquePreco.preco)}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-500">por {produtoDestaquePreco.unidade}</p>
                </div>
              </div>

              {consultaPrecoDados.leituraBalanca && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-[12px] ring-1 ring-inset ring-way-200">
                  <span className="font-semibold text-ink-700">
                    Leitura da etiqueta: {formatarQtdPdv(consultaPrecoDados.leituraBalanca.pesoKg)}{" "}
                    {produtoDestaquePreco.unidade}
                  </span>
                  <strong className="tabular text-[14px] text-way-800">
                    Total etiqueta: {moeda(consultaPrecoDados.leituraBalanca.valorEtiqueta)}
                  </strong>
                </div>
              )}

              {(() => {
                const tribItem = calcularTributosProdutoPdv(
                  produtoDestaquePreco,
                  consultaPrecoDados.leituraBalanca?.pesoKg ?? 1,
                );
                return (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-white/80 p-2.5 text-[11.5px] text-ink-600 sm:grid-cols-3">
                    <div>
                      <span className="micro block text-ink-400">Fiscal</span>
                      <span className="font-mono font-semibold text-ink-800">
                        NCM {produtoDestaquePreco.ncm} · CSOSN {produtoDestaquePreco.csosn}
                      </span>
                    </div>
                    <div>
                      <span className="micro block text-ink-400">Tributos est. (Lei 12.741)</span>
                      <span className="tabular font-semibold text-ink-800">{moeda(tribItem.total)}</span>
                    </div>
                    <div>
                      <span className="micro block text-ink-400">IBS / CBS (LC 214)</span>
                      <span className="tabular font-semibold text-ink-800">
                        {moeda(tribItem.itens[3]?.valor ?? 0)} / {moeda(tribItem.itens[4]?.valor ?? 0)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          ) : buscaConsultaPreco.trim() ? (
            <p className="rounded-lg bg-ink-50 px-4 py-6 text-center text-[12.5px] text-ink-500">
              Nenhum produto localizado para &quot;{buscaConsultaPreco.trim()}&quot;.
            </p>
          ) : (
            <p className="rounded-lg bg-ink-50 px-4 py-6 text-center text-[12.5px] text-ink-500">
              Bipe um produto ou digite parte do nome para consultar sem alterar a venda em andamento.
            </p>
          )}

          {consultaPrecoDados.lista.length > 1 && (
            <ul className="max-h-44 divide-y divide-ink-100 overflow-y-auto rounded-lg ring-1 ring-inset ring-ink-200">
              {consultaPrecoDados.lista.map((p, idx) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setIndiceConsultaPreco(idx)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] transition",
                      idx === indiceConsultaPreco ? "bg-way-50 font-bold text-way-900" : "bg-white hover:bg-ink-50",
                    )}
                  >
                    <span className="truncate">
                      {p.nome} <span className="font-mono text-[11px] text-ink-400">({p.sku})</span>
                    </span>
                    <span className="tabular ml-2 shrink-0 font-bold text-ink-900">{moeda(p.preco)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {/* COMPLEMENTO 2 — MODAL DE VENDAS EM ESPERA / SUSPENDER E RETOMAR ATENDIMENTO (F9) */}
      <Modal
        aberto={modalEspera}
        aoFechar={() => {
          setModalEspera(false);
          buscaRef.current?.focus();
        }}
        titulo="Vendas em espera no caixa (F9)"
        descricao="Suspenda o atendimento atual para liberar o caixa ou retome uma venda aguardando"
        largura="max-w-xl"
        rodape={
          <Button
            variante="secundario"
            onClick={() => {
              setModalEspera(false);
              buscaRef.current?.focus();
            }}
          >
            Fechar (Esc)
          </Button>
        }
      >
        <div className="space-y-3">
          {linhas.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <p className="text-[12.5px] font-bold text-ink-900">
                Colocar venda atual em espera ({linhas.length} item(ns) · {moeda(total)})
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={rotuloNovaEspera}
                  onChange={(e) => setRotuloNovaEspera(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      suspenderAtendimentoAtual();
                    }
                  }}
                  placeholder="Identificação opcional (ex.: Cliente João / Cesta 2)"
                  className="min-w-[200px] flex-1 rounded-lg bg-white px-3 py-1.5 text-[13px] text-ink-900 ring-1 ring-inset ring-amber-300 outline-none focus:ring-2 focus:ring-amber-500"
                />
                <Button tamanho="sm" onClick={suspenderAtendimentoAtual}>
                  Suspender agora ↵
                </Button>
              </div>
            </div>
          )}

          {vendasEspera.length === 0 ? (
            <p className="rounded-lg bg-ink-50 px-4 py-8 text-center text-[12.5px] text-ink-500">
              Nenhuma venda em espera neste caixa no momento.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-ink-200">
              {vendasEspera.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 bg-white px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink-900">{v.identificacao}</p>
                    <p className="text-[11px] text-ink-500">
                      {v.linhas.length} item(ns) ({formatarQtdPdv(v.unidades)} un.) · Cliente: {v.clienteNome} ·{" "}
                      {new Date(v.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-[13.5px] font-extrabold text-ink-900">{moeda(v.total)}</span>
                    <Button tamanho="sm" onClick={() => retomarAtendimentoEspera(v.id)}>
                      {linhas.length > 0 ? "Trocar / Retomar" : "Retomar"}
                    </Button>
                    <button
                      type="button"
                      onClick={() => persistirVendasEspera(removerVendaDeEsperaPdv(vendasEspera, v.id))}
                      title="Descartar venda em espera"
                      className="rounded-md p-1.5 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Icon name="lixo" className="size-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {/* COMPLEMENTO 3 — MODAL DE GAVETA RÁPIDA (SUPRIMENTO E SANGRIA SEM SAIR DO PDV · ALT+G) */}
      <Modal
        aberto={modalGaveta}
        aoFechar={() => {
          setModalGaveta(false);
          buscaRef.current?.focus();
        }}
        titulo={
          sessaoCaixa
            ? `Gaveta rápida · Caixa #${sessaoCaixa.numero} (${sessaoCaixa.terminal})`
            : "Movimentar gaveta (Alt+G)"
        }
        descricao={
          sessaoCaixa
            ? `Estado da gaveta: ${ROTULO_ESTADO_GAVETA[sessaoCaixa.estadoGaveta]}`
            : "Abra o caixa antes de registrar suprimento ou sangria"
        }
        largura="max-w-md"
        rodape={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              tamanho="sm"
              variante="fantasma"
              onClick={() => {
                setModalGaveta(false);
                solicitarSaidaPdv("/caixa");
              }}
            >
              Fechamento completo →
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variante="secundario"
                onClick={() => {
                  setModalGaveta(false);
                  buscaRef.current?.focus();
                }}
              >
                Cancelar
              </Button>
              <Button
                variante={tipoGaveta === "sangria" ? "perigo" : "primario"}
                icone="check"
                disabled={ocupado}
                onClick={async () => {
                  const val = validarMovimentoGavetaPdv({
                    sessaoAberta: sessaoCaixa,
                    tipo: tipoGaveta,
                    forma: formaGaveta,
                    valorInformado: valorGaveta,
                    motivo: motivoGaveta,
                  });
                  if (!val.ok) {
                    toast(val.erro, "erro");
                    return;
                  }
                  setOcupado(true);
                  const r = await registrarMovimentoCaixa({
                    sessaoId: sessaoCaixa?.id,
                    tipo: val.tipo,
                    forma: val.forma,
                    valor: val.valor,
                    motivo: val.motivoLimpo,
                  });
                  setOcupado(false);
                  if (!r.ok) {
                    toast(r.erro, "erro");
                    return;
                  }
                  setModalGaveta(false);
                  toast(
                    r.aviso ??
                      `${val.tipo === "sangria" ? "Sangria" : "Suprimento"} de ${moeda(val.valor)} registrado com sucesso.`,
                    "ok",
                  );
                  router.refresh();
                  buscaRef.current?.focus();
                }}
              >
                {ocupado
                  ? "Gravando…"
                  : tipoGaveta === "sangria"
                    ? "Confirmar sangria"
                    : "Confirmar suprimento"}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-ink-100 p-1">
            {(
              [
                { id: "sangria", rotulo: "Sangria (retirada)" },
                { id: "suprimento", rotulo: "Suprimento (reforço)" },
              ] as const
            ).map((op) => (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  setTipoGaveta(op.id);
                  setMotivoGaveta("");
                }}
                className={cn(
                  "rounded-lg py-2 text-[12.5px] font-bold transition",
                  tipoGaveta === op.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800",
                )}
              >
                {op.rotulo}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Campo rotulo="Valor (R$)" obrigatorio>
              <Input
                autoFocus
                dinheiro
                valor={valorGaveta}
                aoMudar={setValorGaveta}
                placeholder="0,00"
              />
            </Campo>
            <Campo rotulo="Forma">
              <Select
                valor={formaGaveta}
                aoMudar={setFormaGaveta}
                opcoes={[
                  { valor: "dinheiro", rotulo: "Dinheiro (espécie)" },
                  { valor: "pix", rotulo: "PIX" },
                  { valor: "debito", rotulo: "Cartão Débito" },
                  { valor: "credito", rotulo: "Cartão Crédito" },
                ]}
              />
            </Campo>
          </div>

          <Campo rotulo="Motivo da movimentação" obrigatorio>
            <Input
              valor={motivoGaveta}
              aoMudar={setMotivoGaveta}
              placeholder={
                tipoGaveta === "sangria" ? "Ex.: Sangria de segurança para o cofre" : "Ex.: Reforço de fundo de troco"
              }
            />
          </Campo>

          <div className="flex flex-wrap gap-1">
            {SUGESTOES_MOTIVO_GAVETA_PDV[tipoGaveta].map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setMotivoGaveta(sug)}
                className="rounded-md bg-ink-50 px-2 py-0.5 text-[11px] font-medium text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-way-50 hover:text-way-800"
              >
                {sug}
              </button>
            ))}
          </div>
        </div>
      </Modal>

      {/* COMPLEMENTO 3 — MODAL DE CANCELAMENTO / ESTORNO SEGURO EM DOCUMENTOS (F3) */}
      <Modal
        aberto={Boolean(docCancelando)}
        aoFechar={() => setDocCancelando(null)}
        titulo={
          docCancelando
            ? `Cancelar ${
                docCancelando.tipo === "dav"
                  ? `DAV #${docCancelando.numero}`
                  : `${docCancelando.modelo ?? "Venda"} ${docCancelando.numeroNota ?? docCancelando.numero}`
              }?`
            : "Cancelar documento"
        }
        descricao="Registra auditoria e, quando faturado, devolve o estoque no kardex e estorna o caixa/financeiro"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setDocCancelando(null)}>
              Voltar
            </Button>
            <Button
              variante="perigo"
              icone="lixo"
              disabled={ocupado}
              onClick={async () => {
                if (!docCancelando) return;
                const check = validarCancelamentoDocumentoPdv({
                  venda: docCancelando,
                  motivo: motivoCancelamentoDoc,
                });
                if (!check.ok) {
                  toast(check.erro, "erro");
                  return;
                }
                setOcupado(true);
                const r = await cancelarVenda({
                  vendaId: docCancelando.id,
                  motivo: check.motivoLimpo,
                });
                setOcupado(false);
                if (!r.ok) {
                  toast(r.erro, "erro");
                  return;
                }
                const numExibicao = docCancelando.numeroNota ?? docCancelando.numero;
                if (davCarregado?.id === docCancelando.id) {
                  setDavCarregado(null);
                }
                setDocCancelando(null);
                toast(`Documento #${numExibicao} cancelado e estornado com sucesso.`, "ok");
                void carregarDocumentosServidor(docPagina);
                router.refresh();
              }}
            >
              {ocupado ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
          </>
        }
      >
        {docCancelando && (
          <div className="space-y-3">
            <div className="rounded-xl bg-ink-50 p-3 text-[12px] text-ink-700">
              <div className="flex justify-between">
                <span>
                  Cliente: <strong>{docCancelando.clienteNome}</strong>
                </span>
                <span className="tabular font-bold text-rose-700">{moeda(docCancelando.total)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-500">
                Emissão: {dataHoraBR(docCancelando.data)} · {docCancelando.itens.length} item(ns) · Situação:{" "}
                {ROTULO_SITUACAO_FISCAL[docCancelando.situacaoFiscal].rotulo}
              </p>
            </div>

            <Campo rotulo="Justificativa do cancelamento (mín. 15 caracteres)" obrigatorio>
              <textarea
                autoFocus
                rows={3}
                value={motivoCancelamentoDoc}
                onChange={(e) => setMotivoCancelamentoDoc(e.target.value)}
                placeholder="Descreva o motivo do cancelamento / estorno (padrão SEFAZ mín. 15 caracteres)"
                className="w-full rounded-lg bg-white px-3 py-2 text-[13px] text-ink-900 ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
              />
            </Campo>

            {(() => {
              const previa = validarCancelamentoDocumentoPdv({
                venda: docCancelando,
                motivo: motivoCancelamentoDoc,
              });
              if (!previa.ok) {
                return (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-[11.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                    {previa.erro}
                  </p>
                );
              }
              return (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
                  {previa.exigeEventoSefaz
                    ? `Dentro do prazo legal SEFAZ (${previa.prazoInfo.decorridoMinutos} min decorridos · limite ${previa.prazoInfo.rotuloLimite}).`
                    : "Ação irreversível: o documento ficará marcado como cancelado e auditado."}
                </p>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* COMPLEMENTO 3 — INSPETOR E SINCRONIZADOR DA FILA OFFLINE (nkway.fila) */}
      <Modal
        aberto={modalFilaOffline}
        aoFechar={() => {
          setModalFilaOffline(false);
          buscaRef.current?.focus();
        }}
        titulo={`Fila offline local (${resumoFilaOffline.quantidade} pendente${resumoFilaOffline.quantidade === 1 ? "" : "s"})`}
        descricao={`Total acumulado: ${moeda(resumoFilaOffline.valorTotal)} · As vendas permanecem salvas neste navegador até confirmar no servidor`}
        largura="max-w-2xl"
        rodape={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span className="text-[11.5px] text-ink-500">
              {resumoFilaOffline.comErro > 0
                ? `${resumoFilaOffline.comErro} registro(s) aguardam correção (ex.: abrir sessão de caixa).`
                : "Conectado: pronto para sincronizar."}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variante="secundario"
                onClick={() => {
                  setModalFilaOffline(false);
                  buscaRef.current?.focus();
                }}
              >
                Fechar
              </Button>
              {itensFilaOffline.length > 0 && (
                <Button icone="atualizar" disabled={ocupado} onClick={() => void sincronizar()}>
                  {ocupado ? "Sincronizando…" : "Sincronizar todas"}
                </Button>
              )}
            </div>
          </div>
        }
      >
        {itensFilaOffline.length === 0 ? (
          <p className="rounded-xl bg-ink-50 px-4 py-8 text-center text-[12.5px] text-ink-500">
            Nenhuma venda pendente na fila offline deste navegador.
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto rounded-xl ring-1 ring-inset ring-ink-200">
            {itensFilaOffline.map((item, idx) => (
              <li key={item.idFila} className="space-y-1.5 bg-white px-3.5 py-2.5 text-[12px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-ink-900">
                      #{idx + 1} ·{" "}
                      {item.tipo === "dav"
                        ? "DAV"
                        : item.tipo === "sem_nota"
                          ? "Venda sem nota"
                          : `Fiscal (${item.modelo})`}{" "}
                      · {item.clienteNome}
                    </p>
                    <p className="text-[11px] text-ink-500">
                      {item.itens.length} item(ns) ({formatarQtdPdv(item.qtdUnidades)} un.) · Gravada em{" "}
                      {dataHoraBR(new Date(item.criadoEm).toISOString())}
                      {item.tentativas > 0 ? ` · ${item.tentativas} tentativa(s)` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <strong className="tabular text-[13.5px] text-ink-900">{moeda(item.totalEstimado)}</strong>
                    <Button
                      tamanho="sm"
                      variante="suave"
                      disabled={ocupado}
                      onClick={() => void sincronizar(item.idFila)}
                    >
                      Reenviar
                    </Button>
                  </div>
                </div>
                {item.ultimoErro && (
                  <p className="rounded-md bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                    Último retorno: {item.ultimoErro}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ModalFechamentoCego
        aberto={modalFechamentoCego}
        aoFechar={() => setModalFechamentoCego(false)}
        aoConcluir={() => router.refresh()}
        sessao={
          sessaoCaixa
            ? { id: sessaoCaixa.id, numero: sessaoCaixa.numero, terminal: sessaoCaixa.terminal }
            : null
        }
      />
    </div>
  );
}
