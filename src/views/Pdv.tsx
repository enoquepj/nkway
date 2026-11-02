"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Impressao, type AlvoImpresso } from "@/components/Impressao";
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
import { ATALHOS_PDV, FORMAS_ATALHO_ALT } from "@/lib/atalhosPdv";
import type { Emitente } from "@/lib/danfe";
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
import {
  ROTULO_SITUACAO_FISCAL,
  type SituacaoFiscalVenda,
} from "@/lib/situacaoFiscal";
import { abrirCaixa } from "@/server/acoes/caixa";
import {
  buscarDocumentosPdv,
  emitirNfceDaVenda,
  faturarDav,
  registrarDav,
  registrarVenda,
  registrarVendaSemNota,
  type ItemPdv,
  type Pagamento,
} from "@/server/acoes/pdv";
import type { ProdutoDto, VendaDto } from "@/server/dados";

type Linha = {
  produtoId: string;
  nome: string;
  qtd: number;
  preco: number;
  unidade: string;
  estoque: number;
  pesavel: boolean;
};

type ClienteOpcao = {
  id: string;
  nome: string;
  documento: string;
  condicaoPadrao: string;
  limiteCredito: number;
  saldoEmAberto: number;
};

type Cupom = {
  id: string;
  total: number;
  troco: number;
  numero: number;
  numeroNota: number | null;
  chave: string | null;
  protocolo: string | null;
  situacaoFiscal: SituacaoFiscalVenda;
  documento: string;
  forma: string;
  modelo: string | null;
  itens: { nome: string; qtd: number; precoUnit: number; total: number; unidade: string | null }[];
};

const CHAVE_FILA = "nkway.fila";
const CHAVE_TELA_CHEIA = "nkway.pdv.telaCheia";

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
  sessaoCaixa?: {
    id: string;
    numero: number;
    terminal: string;
    saldoDinheiro: number;
    totalEsperado: number;
  } | null;
}) {
  const toast = useToast();
  const router = useRouter();

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

  const [modalAbrirCaixa, setModalAbrirCaixa] = useState(false);
  const [acaoAposAbrirCaixa, setAcaoAposAbrirCaixa] = useState<"sem_nota" | "emitir_nfce" | null>(null);
  const [terminalRapido, setTerminalRapido] = useState("CAIXA 1");
  const [saldoRapido, setSaldoRapido] = useState("100,00");

  const ativos = useMemo(() => produtos.filter((p) => p.ativo), [produtos]);

  const [termo, setTermo] = useState("");
  const [cursor, setCursor] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [pilhaDesfazer, setPilhaDesfazer] = useState<Linha[]>([]);
  const [descontoModo, setDescontoModo] = useState<"real" | "percentual">("real");
  const [descontoValor, setDescontoValor] = useState("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [recebido, setRecebido] = useState("");
  const [modelo, setModelo] = useState<"NFC-e" | "NF-e" | "SAT">("NFC-e");
  const [validadeDav, setValidadeDav] = useState(somaDias(hojeISO(), 3));
  const [cupom, setCupom] = useState<Cupom | null>(null);

  // Modais das Etapas 2, 4, 9 e 10
  const [modalSaida, setModalSaida] = useState(false);
  const [destinoSaida, setDestinoSaida] = useState("/");
  const [modalAjuda, setModalAjuda] = useState(false);
  const [modalCancelarVenda, setModalCancelarVenda] = useState(false);
  const [abertoCliente, setAbertoCliente] = useState(false);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [modalFinalizar, setModalFinalizar] = useState(false);
  const [confirmandoEmissaoNfce, setConfirmandoEmissaoNfce] = useState(false);

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

  const atualizarContagemFila = useCallback(() => {
    try {
      const lista = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
      setFila(Array.isArray(lista) ? lista.length : 0);
    } catch {
      setFila(0);
    }
  }, []);

  // Inicialização: foco na bipagem, leitura da fila offline e tentativa de tela cheia (Etapa 3)
  useEffect(() => {
    buscaRef.current?.focus();
    atualizarContagemFila();
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

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

    try {
      const pref = localStorage.getItem(CHAVE_TELA_CHEIA);
      if (pref === "true" && !document.fullscreenElement) {
        const promessa = document.documentElement.requestFullscreen?.();
        if (promessa && typeof promessa.then === "function") {
          promessa
            .then(() => {
              setEmTelaCheia(true);
              setAguardandoGestoTelaCheia(false);
            })
            .catch(() => {
              // O navegador bloqueou sem gesto prévio: mostra aviso de 1 linha (Etapa 3)
              setAguardandoGestoTelaCheia(true);
            });
        } else {
          setAguardandoGestoTelaCheia(true);
        }
      }
    } catch {
      /* storage indisponível */
    }

    return () => {
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
        document.documentElement
          .requestFullscreen?.()
          .then(() => setEmTelaCheia(true))
          .catch(() => {
            /* navegador não permitiu neste gesto */
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
        localStorage.setItem(CHAVE_TELA_CHEIA, "true");
        await document.documentElement.requestFullscreen();
        setEmTelaCheia(true);
        setAguardandoGestoTelaCheia(false);
      } else {
        localStorage.setItem(CHAVE_TELA_CHEIA, "false");
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
      void (async () => {
        await sairDaTelaCheiaSilencioso();
        router.push(destino);
      })();
    },
    [linhas.length, router, sairDaTelaCheiaSilencioso],
  );

  const descartarVendaLocal = useCallback(() => {
    setLinhas([]);
    setPilhaDesfazer([]);
    setPagamentos([]);
    setDescontoValor("");
    setRecebido("");
    setEditando(null);
  }, []);

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
  const pago = round2(pagamentos.reduce((s, p) => s + p.valor, 0));
  const falta = round2(Math.max(0, total - pago));
  const troco = round2(Math.max(0, pago - total));
  const unidadesBipadas = round2(linhas.reduce((s, l) => s + l.qtd, 0) * 1000) / 1000;
  const cliente = clientes.find((c) => c.id === clienteId) ?? null;

  const adicionar = useCallback((p: ProdutoDto, qtd = p.pesavel ? 0 : 1) => {
    setLinhas((atual) => {
      const i = atual.findIndex((l) => l.produtoId === p.id);
      if (i >= 0) {
        const copia = [...atual];
        copia[i] = { ...copia[i], qtd: round2(copia[i].qtd * 1000) / 1000 + 1 };
        return copia;
      }
      return [
        ...atual,
        {
          produtoId: p.id,
          nome: p.nome,
          qtd,
          preco: p.preco,
          unidade: p.unidade,
          estoque: p.estoque,
          pesavel: p.pesavel,
        },
      ];
    });
    if (qtd === 0) setEditando(p.id);
    setTermo("");
    setCursor(0);
    buscaRef.current?.focus();
  }, []);

  // Decisão D1 — Del remove o último item sem travar e Ctrl+Z desfaz
  const removerUltimoItem = useCallback(() => {
    setLinhas((atual) => {
      if (atual.length === 0) return atual;
      const removido = atual[atual.length - 1];
      setPilhaDesfazer((pilha) => [...pilha, removido]);
      toast(`Item removido: ${removido.nome} (Ctrl+Z para desfazer).`, "info");
      return atual.slice(0, -1);
    });
  }, [toast]);

  const desfazerUltimoItem = useCallback(() => {
    setPilhaDesfazer((pilha) => {
      if (pilha.length === 0) return pilha;
      const restaurado = pilha[pilha.length - 1];
      setLinhas((atual) => {
        const idx = atual.findIndex((x) => x.produtoId === restaurado.produtoId);
        if (idx >= 0) {
          const copia = [...atual];
          copia[idx] = { ...copia[idx], qtd: round2((copia[idx].qtd + restaurado.qtd) * 1000) / 1000 };
          return copia;
        }
        return [...atual, restaurado];
      });
      toast(`Item restaurado: ${restaurado.nome}.`, "ok");
      return pilha.slice(0, -1);
    });
  }, [toast]);

  const definirPagamentoAutomatico = useCallback(
    (forma: string) => {
      const valor = falta > 0 ? falta : total;
      if (valor <= 0) return;
      setPagamentos((atual) => {
        if (atual.length === 1 && atual[0].forma === forma) return atual;
        return [...atual, { forma, valor: round2(valor) }];
      });
    },
    [falta, total],
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
    setConfirmandoEmissaoNfce(false);
    setModalFinalizar(true);
  }, [linhas, toast]);

  // Etapa 8 e Etapa 9 — Execução das 3 opções de fechamento
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

      const payloadPagamentos =
        modo === "dav"
          ? []
          : pagamentos.length > 0
            ? pagamentos
            : [{ forma: "dinheiro", valor: total }];

      const somaPagamentos = round2(payloadPagamentos.reduce((s, p) => s + p.valor, 0));
      if (modo !== "dav" && somaPagamentos + 0.01 < total) {
        return toast(`Faltam ${moeda(round2(total - somaPagamentos))} em pagamentos para fechar a venda.`, "erro");
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

        const rotuloDoc =
          modo === "dav"
            ? `DAV ${r.numero}`
            : modo === "sem_nota"
              ? `Venda #${r.numero} (sem nota)`
              : `${modelo} ${r.numeroNota ?? r.numero}`;

        setModalFinalizar(false);
        setConfirmandoEmissaoNfce(false);
        setCupom({
          id: r.id,
          total,
          troco: r.troco,
          numero: r.numero,
          numeroNota: r.numeroNota,
          chave: r.chave,
          protocolo: r.protocolo,
          situacaoFiscal: r.situacaoFiscal,
          documento: rotuloDoc,
          forma: payloadPagamentos.slice().sort((a, b) => b.valor - a.valor)[0]?.forma ?? "dinheiro",
          modelo: modo === "emitir_nfce" ? modelo : null,
          itens: itensSnapshot,
        });
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
        const filaAtual = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
        filaAtual.push({
          tipo: tipoFila,
          itens,
          clienteId,
          clienteNome: cliente?.nome ?? "CONSUMIDOR",
          desconto,
          pagamentos: payloadPagamentos,
          modelo,
          validade: modo === "dav" ? validadeDav : undefined,
          criadoEm: Date.now(),
        });
        localStorage.setItem(CHAVE_FILA, JSON.stringify(filaAtual));
        setFila(filaAtual.length);
        setModalFinalizar(false);
        setConfirmandoEmissaoNfce(false);
        descartarVendaLocal();
        toast(`Sem conexão com o servidor. Venda nº ${filaAtual.length} guardada na fila offline.`, "erro");
      } finally {
        setOcupado(false);
      }
    },
    [
      linhas,
      podeCriarDav,
      podeVenderFiscal,
      sessaoCaixa,
      pagamentos,
      total,
      clienteId,
      cliente?.nome,
      desconto,
      validadeDav,
      modelo,
      toast,
      descartarVendaLocal,
      router,
    ],
  );

  // Etapa 6 — Esc no campo de busca só limpa o texto digitado. Nunca apaga a venda!
  function teclaBusca(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(resultados.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const alvo = resultados[cursor];
      if (alvo) adicionar(alvo);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      if (termo) {
        setTermo("");
        setCursor(0);
      }
    }
  }

  // Etapa 4 — Listener global de teclado sincronizado com ATALHOS_PDV
  useEffect(() => {
    const algumModalAberto =
      modalSaida ||
      modalAjuda ||
      modalCancelarVenda ||
      abertoCliente ||
      modalFinalizar ||
      modalDocumentos ||
      modalAbrirCaixa ||
      Boolean(cupom) ||
      Boolean(imprimindo);

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
        if (!ehInputComTexto && pilhaDesfazer.length > 0) {
          e.preventDefault();
          desfazerUltimoItem();
          return;
        }
      }

      if (algumModalAberto) return;

      if (e.key === "F2") {
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
      } else if (e.key === "F8") {
        e.preventDefault();
        setBuscaCliente("");
        setAbertoCliente(true);
      } else if (e.key === "F10") {
        e.preventDefault();
        abrirModalFinalizacao();
      } else if (e.key === "Delete") {
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
          definirPagamentoAutomatico(itemForma.forma);
          toast(`Pagamento: ${itemForma.rotulo} selecionado.`, "info");
        }
      } else if (e.key === "Escape") {
        // Esc nunca apaga a venda: só cancela edição inline ou limpa o texto da busca
        if (editando) {
          setEditando(null);
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
    modalSaida,
    modalAjuda,
    modalCancelarVenda,
    abertoCliente,
    modalFinalizar,
    modalDocumentos,
    modalAbrirCaixa,
    cupom,
    imprimindo,
    solicitarSaidaPdv,
    alternarTelaCheia,
    pilhaDesfazer.length,
    desfazerUltimoItem,
    abrirModalDocumentos,
    linhas.length,
    abrirModalFinalizacao,
    editando,
    removerUltimoItem,
    total,
    definirPagamentoAutomatico,
    toast,
    termo,
  ]);

  async function sincronizar() {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_FILA) ?? "[]");
    if (!Array.isArray(bruto) || bruto.length === 0) return;
    setOcupado(true);
    let ok = 0;
    const restante: unknown[] = [];
    for (const v of bruto) {
      const r = await registrarVenda(v);
      if (r.ok) ok++;
      else restante.push(v);
    }
    localStorage.setItem(CHAVE_FILA, JSON.stringify(restante));
    setFila(restante.length);
    setOcupado(false);
    toast(
      ok ? `${ok} venda(s) da fila sincronizadas.` : "Nada sincronizado — verifique caixa aberto ou conexão.",
      ok ? "ok" : "erro",
    );
    router.refresh();
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
          {v.tipo === "fiscal" && (
            <Button tamanho="sm" variante="secundario" icone="imprimir" onClick={() => abrirImpressaoDeVenda(v)}>
              DANFE
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
        </div>
      ),
    },
  ];

  const trib = tributosEstimados(total, { icms: 0, pis: 0, cofins: 0, ibs: 0.1, cbs: 0.9 });
  const atalhosBarraInferior = useMemo(() => ATALHOS_PDV.filter((a) => a.exibirNaBarra), []);

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

        {/* Itens preservados do topo antigo (Etapa 0 item 4 / Etapa 5): Sincronizar fila, Caixa, Ambiente + Documentos, Ajuda e Tela Cheia */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {fila > 0 && (
            <button
              type="button"
              onClick={sincronizar}
              disabled={ocupado}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1 text-[11.5px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/40 transition hover:bg-amber-500/30"
            >
              <Icon name="atualizar" className="size-3.5" />
              <span>{fila} venda(s) na fila local · sincronizar</span>
            </button>
          )}

          {sessaoCaixa ? (
            <button
              type="button"
              onClick={() => solicitarSaidaPdv("/caixa")}
              title="Gerenciar suprimento, sangria ou fechamento de caixa"
              className="inline-flex items-center gap-1.5 rounded-lg bg-way-500/15 px-2.5 py-1 text-[11.5px] font-semibold text-way-200 ring-1 ring-inset ring-way-500/35 transition hover:bg-way-500/25"
            >
              <Icon name="carteira" className="size-3.5 text-way-300" />
              <span>
                Caixa #{sessaoCaixa.numero} ({sessaoCaixa.terminal})
              </span>
              <span className="tabular font-bold text-white">· {moeda(sessaoCaixa.saldoDinheiro)}</span>
            </button>
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
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-way-600">
                <Icon name="busca" className="size-5" />
              </span>
              <input
                ref={buscaRef}
                value={termo}
                onChange={(e) => {
                  setTermo(e.target.value);
                  setCursor(0);
                  const digitado = e.target.value.replace(/\D/g, "");
                  if (digitado.length === 13) {
                    const p = ativos.find((x) => x.gtin === digitado);
                    if (p) adicionar(p);
                  }
                }}
                onKeyDown={teclaBusca}
                placeholder="Bipe o código de barras ou digite início do nome / SKU (F2)"
                className="w-full rounded-lg border-0 bg-ink-50/70 px-10 py-2.5 text-[15px] font-medium text-ink-900 outline-none ring-1 ring-inset ring-ink-100 placeholder:text-ink-300 focus:bg-white focus:ring-2 focus:ring-way-500"
              />
              <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-400 ring-1 ring-inset ring-ink-100">
                F2
              </kbd>
            </div>

            {resultados.length > 0 && (
              <ul className="mt-2 max-h-48 divide-y divide-ink-50 overflow-y-auto">
                {resultados.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => adicionar(p)}
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
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <p className="micro text-ink-400">
                Itens da venda · {linhas.length} item(ns) · {unidadesBipadas} un.
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
                        onChange={(e) =>
                          setLinhas((atual) =>
                            atual.map((x) =>
                              x.produtoId === l.produtoId
                                ? { ...x, qtd: Number(e.target.value.replace(",", ".")) || 0 }
                                : x,
                            ),
                          )
                        }
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
                            setLinhas((atual) =>
                              atual.map((x) =>
                                x.produtoId === l.produtoId
                                  ? { ...x, qtd: Math.max(0, round2(x.qtd * 1000 - 1000) / 1000) }
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
                          {l.qtd}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setLinhas((atual) =>
                              atual.map((x) =>
                                x.produtoId === l.produtoId
                                  ? { ...x, qtd: round2(x.qtd * 1000 + 1000) / 1000 }
                                  : x,
                              ),
                            )
                          }
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
                        setLinhas((atual) => atual.filter((x) => x.produtoId !== l.produtoId));
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
            <p className="micro mb-2 text-ink-400">Forma de pagamento · Alt+1 a Alt+6 (divisão aceita)</p>
            <div className="grid grid-cols-3 gap-1.5">
              {FORMAS_PAGAMENTO.map((f) => {
                const usado = pagamentos.filter((p) => p.forma === f.id).reduce((s, p) => s + p.valor, 0);
                const atalhoIdx = FORMAS_ATALHO_ALT.find((a) => a.forma === f.id)?.digito;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() =>
                      usado > 0
                        ? setPagamentos(pagamentos.filter((p) => p.forma !== f.id))
                        : definirPagamentoAutomatico(f.id)
                    }
                    className={cn(
                      "rounded-lg px-2 py-2 text-[12px] font-semibold ring-1 ring-inset transition",
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
                      onChange={(e) =>
                        setPagamentos((atual) =>
                          atual.map((x, xi) =>
                            xi === i ? { ...x, valor: Number(e.target.value.replace(",", ".")) || 0 } : x,
                          ),
                        )
                      }
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
                      const v = Number(recebido.replace(",", ".")) || 0;
                      if (v > 0) {
                        setPagamentos((a) => [
                          ...a.filter((p) => p.forma !== "dinheiro"),
                          { forma: "dinheiro", valor: round2(v) },
                        ]);
                        setRecebido("");
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
          </Card>

          <Card className="shrink-0">
            <p className="micro mb-2 text-ink-400">Cliente (F8) e desconto (F4)</p>
            <button
              type="button"
              onClick={() => {
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
                  {cliente ? `${cliente.documento || "sem documento"} · ${cliente.condicaoPadrao}` : "F8 para identificar"}
                </span>
              </span>
              {cliente && cliente.saldoEmAberto > 0 && <Badge tom="alerta">{moeda(cliente.saldoEmAberto)}</Badge>}
              <kbd className="rounded bg-white px-1 py-px font-mono text-[9.5px] text-ink-400 ring-1 ring-inset ring-ink-200">
                F8
              </kbd>
            </button>

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
              <Campo rotulo="Documento fiscal">
                <Select
                  valor={modelo}
                  aoMudar={(v) => setModelo(v as "NFC-e" | "NF-e" | "SAT")}
                  opcoes={[
                    { valor: "NFC-e", rotulo: "NFC-e (consumidor)" },
                    { valor: "NF-e", rotulo: "NF-e (pessoa jurídica)" },
                    { valor: "SAT", rotulo: "SAT / NFC-e Sat" },
                  ]}
                />
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
          <span className="tabular">
            <strong className="text-ink-900">{linhas.length}</strong> itens
          </span>
          <span className="text-ink-300">·</span>
          <span className="tabular">
            <strong className="text-ink-900">{unidadesBipadas}</strong> un. bipadas
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

      {/* ETAPA 9 — MODAL DE FINALIZAÇÃO COM TRÊS OPÇÕES + CONFIRMAÇÃO ANTES DE EMITIR */}
      <Modal
        aberto={modalFinalizar}
        aoFechar={() => {
          setModalFinalizar(false);
          setConfirmandoEmissaoNfce(false);
          buscaRef.current?.focus();
        }}
        titulo="Finalizar operação (F10)"
        descricao="Escolha como deseja registrar este atendimento"
        largura="max-w-xl"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-ink-900 p-3.5 text-white">
            <div>
              <p className="micro text-ink-300">Total</p>
              <p className="tabular mt-0.5 text-[20px] font-black">{moeda(total)}</p>
            </div>
            <div>
              <p className="micro text-ink-300">Pago</p>
              <p className="tabular mt-0.5 text-[18px] font-bold">{moeda(pago > 0 ? pago : total)}</p>
            </div>
            <div>
              <p className="micro text-ink-300">{falta > 0 && pagamentos.length > 0 ? "Falta" : "Troco"}</p>
              <p className="tabular mt-0.5 text-[18px] font-bold text-way-300">
                {moeda(falta > 0 && pagamentos.length > 0 ? falta : troco)}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-ink-50 p-3 text-[12px] text-ink-600">
            <p>
              <strong>Cliente:</strong> {cliente?.nome ?? "CONSUMIDOR"} · <strong>Itens:</strong> {linhas.length} (
              {unidadesBipadas} un.)
            </p>
            <p className="mt-0.5">
              <strong>Pagamento:</strong>{" "}
              {pagamentos.length > 0
                ? pagamentos.map((p) => `${rotuloForma(p.forma)} (${moeda(p.valor)})`).join(" + ")
                : `Dinheiro (${moeda(total)})`}
            </p>
          </div>

          {!confirmandoEmissaoNfce ? (
            <div className="grid gap-2.5 pt-1">
              <button
                type="button"
                disabled={ocupado || !podeCriarDav}
                onClick={() => void executarFechamento("dav")}
                className="flex items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-3 text-left transition hover:border-way-400 hover:bg-way-50/40 disabled:opacity-45"
              >
                <div>
                  <p className="text-[13.5px] font-bold text-ink-900">1. Salvar como DAV</p>
                  <p className="text-[11.5px] text-ink-500">
                    Pré-venda / orçamento sem chave fiscal e sem baixar estoque (validade {validadeDav}).
                  </p>
                </div>
                <Badge tom="neutro">Sem baixa</Badge>
              </button>

              <button
                type="button"
                disabled={ocupado || !podeVenderFiscal || (pagamentos.length > 0 && falta > 0.01)}
                onClick={() => void executarFechamento("sem_nota")}
                className="flex items-center justify-between rounded-xl border border-ink-200 bg-white px-4 py-3 text-left transition hover:border-way-400 hover:bg-way-50/40 disabled:opacity-45"
              >
                <div>
                  <p className="text-[13.5px] font-bold text-ink-900">2. Finalizar sem nota</p>
                  <p className="text-[11.5px] text-ink-500">
                    Conclui a venda no caixa e baixa o estoque agora. A nota pode ser emitida depois em Documentos (F3).
                  </p>
                </div>
                <Badge tom="info">Baixa estoque</Badge>
              </button>

              <button
                type="button"
                disabled={ocupado || !podeVenderFiscal || (pagamentos.length > 0 && falta > 0.01)}
                onClick={() => setConfirmandoEmissaoNfce(true)}
                className="flex items-center justify-between rounded-xl border border-way-600 bg-way-600 px-4 py-3 text-left text-white transition hover:bg-way-700 disabled:opacity-45"
              >
                <div>
                  <p className="text-[14px] font-bold">3. Finalizar e emitir {modelo}</p>
                  <p className="text-[11.5px] text-way-100">
                    Baixa o estoque, registra no caixa e solicita emissão fiscal ({empresa.ambiente === "1" ? "Produção" : "Homologação"}).
                  </p>
                </div>
                <Icon name="seta" className="size-4 shrink-0" />
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-[13.5px] font-bold text-ink-900">
                Confirmar emissão de {modelo} no valor de {moeda(total)}?
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                Destinatário: <strong>{cliente?.nome ?? "CONSUMIDOR"}</strong> · Ambiente:{" "}
                <strong>{empresa.ambiente === "1" ? "1 (Produção)" : "2 (Homologação)"}</strong>. Caso a integração
                SEFAZ live não esteja ativa neste ambiente, o documento ficará com situação{" "}
                <strong>Pendente de transmissão</strong> (sem inventar protocolo ou autorização).
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variante="secundario" onClick={() => setConfirmandoEmissaoNfce(false)}>
                  Voltar às opções
                </Button>
                <Button
                  variante="primario"
                  icone="check"
                  disabled={ocupado}
                  onClick={() => void executarFechamento("emitir_nfce")}
                >
                  {ocupado ? "Emitindo…" : `Confirmar e emitir ${modelo}`}
                </Button>
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

      {/* SELEÇÃO DE CLIENTE (F8) */}
      <Modal
        aberto={abertoCliente}
        aoFechar={() => {
          setAbertoCliente(false);
          buscaRef.current?.focus();
        }}
        titulo="Identificar cliente (F8)"
        descricao="Busque por nome ou documento (CPF/CNPJ)"
      >
        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300">
            <Icon name="busca" className="size-4" />
          </span>
          <input
            autoFocus
            value={buscaCliente}
            onChange={(e) => setBuscaCliente(e.target.value)}
            placeholder="nome, CPF ou CNPJ"
            className="w-full rounded-lg py-2 pl-9 pr-3 text-[13px] ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
          />
        </div>
        <ul className="max-h-80 divide-y divide-ink-50 overflow-y-auto">
          <li>
            <button
              type="button"
              onClick={() => {
                setClienteId(null);
                setAbertoCliente(false);
                buscaRef.current?.focus();
              }}
              className="w-full px-2 py-2.5 text-left text-[13px] font-semibold text-ink-600 hover:bg-way-50"
            >
              CONSUMIDOR (sem identificação)
            </button>
          </li>
          {clientes
            .filter(
              (c) =>
                !buscaCliente.trim() ||
                c.nome.toLowerCase().includes(buscaCliente.toLowerCase()) ||
                c.documento.includes(buscaCliente),
            )
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setClienteId(c.id);
                    setAbertoCliente(false);
                    if (
                      c.condicaoPadrao === "30d" ||
                      c.condicaoPadrao === "14d" ||
                      c.condicaoPadrao === "7d" ||
                      c.condicaoPadrao === "60d"
                    ) {
                      setPagamentos([{ forma: "prazo", valor: total }]);
                    }
                    buscaRef.current?.focus();
                  }}
                  className="flex w-full items-center gap-3 px-2 py-2.5 text-left transition hover:bg-way-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{c.nome}</p>
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
            ))}
        </ul>
      </Modal>

      {/* COMPROVANTE / RECIBO PÓS-FINALIZAÇÃO */}
      <Modal
        aberto={!!cupom}
        aoFechar={() => {
          setCupom(null);
          buscaRef.current?.focus();
        }}
        titulo="Operação registrada"
        descricao="Resumo do registro — consulte ou imprima a qualquer momento em Documentos (F3)"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
              Imprimir recibo
            </Button>
            <Button
              onClick={() => {
                setCupom(null);
                buscaRef.current?.focus();
              }}
            >
              Nova venda
            </Button>
          </>
        }
      >
        {cupom && (
          <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50/40 p-4 font-mono text-[11.5px] leading-relaxed text-ink-700">
            <p className="text-center text-[13px] font-bold text-ink-900">{empresa.fantasia.toUpperCase()}</p>
            <p className="text-center">
              {empresa.endereco}, {empresa.municipio} - {empresa.nome}
            </p>
            <p className="text-center">CNPJ {empresa.documento}</p>
            <div className="my-2 flex justify-center">
              <Badge tom={ROTULO_SITUACAO_FISCAL[cupom.situacaoFiscal].tom}>
                {ROTULO_SITUACAO_FISCAL[cupom.situacaoFiscal].rotulo}
              </Badge>
            </div>
            <p className="my-2 border-t border-dashed border-ink-300" />
            <div className="flex justify-between font-semibold">
              <span>{cupom.documento}</span>
              <span className="tabular">{moeda(cupom.total)}</span>
            </div>
            <p className="mt-2 flex justify-between font-bold text-ink-900">
              <span>TOTAL</span>
              <span className="tabular">{moeda(cupom.total)}</span>
            </p>
            <p className="flex justify-between">
              <span>{FORMAS_PAGAMENTO.find((f) => f.id === cupom.forma)?.label ?? cupom.forma}</span>
              <span className="tabular">{moeda(round2(cupom.total + cupom.troco))}</span>
            </p>
            {cupom.troco > 0 && (
              <p className="flex justify-between">
                <span>TROCO</span>
                <span className="tabular">{moeda(cupom.troco)}</span>
              </p>
            )}
            <p className="my-2 border-t border-dashed border-ink-300" />
            {cupom.situacaoFiscal === "autorizada" && cupom.chave ? (
              <>
                <p className="break-all leading-tight">chave de acesso autorizada</p>
                <p className="mb-1 break-all font-bold tracking-tight text-ink-900">{formatChave(cupom.chave)}</p>
                <p className="text-[10.5px] text-way-700">Protocolo SEFAZ {cupom.protocolo}</p>
              </>
            ) : cupom.situacaoFiscal === "pendente_transmissao" ? (
              <p className="text-[10.5px] text-amber-700">
                Pendente de transmissão à SEFAZ: nenhum protocolo ou autorização fictícia foi gerado.
              </p>
            ) : (
              <p className="text-[10.5px] text-ink-400">
                Registro sem emissão fiscal ({cupom.documento}).
              </p>
            )}
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
    </div>
  );
}
