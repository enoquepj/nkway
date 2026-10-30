"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  CardTitulo,
  FiltroTexto,
  Input,
  Kpi,
  Modal,
  Select,
  Area,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { dataBR, dataHoraBR, round2 } from "@/lib/dominio";
import type { InutilizacaoDto } from "@/server/dados";
import { cancelarInutilizacao, emitirCartaCorrecao, inutilizarNumeracao } from "@/server/acoes/numeracao";

export type DocumentoResumo = {
  id: string;
  numero: number;
  modelo: string | null;
  serie: string | null;
  numeroNota: number | null;
  chave: string | null;
  protocolo: string | null;
  status: string;
  clienteNome: string;
  data: string;
  eventos: { id: string; tipo: string; sequencia: number; descricao: string; protocolo: string; em: string }[];
};

const MODELOS = [
  { valor: "NFC-e", rotulo: "NFC-e (65) — cupom" },
  { valor: "NF-e", rotulo: "NF-e (55) — nota" },
];

/** Aba Numeração: inutilização de faixas e eventos (carta de correção) */
export function NumeracaoView({
  inutilizacoes,
  documentos,
  proximoNumero,
  serieAtual,
  abrirCorrecaoDe,
  aoFecharCorrecao,
}: {
  inutilizacoes: InutilizacaoDto[];
  documentos: DocumentoResumo[];
  proximoNumero: number;
  serieAtual: string;
  /** id do documento que abriu a carta de correção a partir de outra tela */
  abrirCorrecaoDe?: string;
  aoFecharCorrecao?: () => void;
}) {
  const toast = useToast();
  const [aba, setAba] = useState<"inutilizar" | "eventos">("inutilizar");
  const [f, setF] = useState({ modelo: "NFC-e", serie: serieAtual, inicio: "", fim: "", justificativa: "" });
  const [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState("");
  const [vendo, setVendo] = useState<DocumentoResumo | null>(null);
  const [corrigindo, setCorrigindo] = useState<DocumentoResumo | null>(null);
  const [correcao, setCorrecao] = useState("");

  const ativas = inutilizacoes.filter((i) => i.status === "homologado");
  const numerosInutilizados = round2(ativas.reduce((s, i) => s + (i.numeroFinal - i.numeroInicial + 1), 0));
  const comEvento = documentos.filter((d) => d.eventos.length > 0);
  const cartas = documentos.flatMap((d) => d.eventos.filter((e) => e.tipo === "carta_correcao").map((e) => ({ ...e, doc: d })));

  const lista = useMemo(
    () =>
      inutilizacoes.filter((i) => {
        const t = busca.trim().toLowerCase();
        if (!t) return true;
        return [i.modelo, i.serie, i.justificativa, i.protocolo, `${i.numeroInicial}-${i.numeroFinal}`].some((v) => v.toLowerCase().includes(t));
      }),
    [inutilizacoes, busca],
  );

  const gap = (() => {
    const fiscal = documentos
      .filter((d) => d.modelo === f.modelo && d.serie === f.serie && d.numeroNota)
      .map((d) => d.numeroNota!)
      .sort((a, b) => a - b);
    const faltando: string[] = [];
    for (let n = 1; n <= Math.max(...fiscal, 0); n++) if (!fiscal.includes(n)) faltando.push(String(n));
    return faltando.slice(0, 12);
  })();

  const colunas: Coluna<InutilizacaoDto>[] = [
    { id: "faixa", rotulo: "Faixa", valor: (i) => i.numeroInicial, render: (i) => (
      <span className="font-mono text-[12px] font-bold text-ink-800">
        {String(i.numeroInicial).padStart(9, "0")} – {String(i.numeroFinal).padStart(9, "0")}
      </span>
    ) },
    { id: "modelo", rotulo: "Modelo", valor: (i) => `${i.modelo}/${i.serie}`, render: (i) => <Badge tom="info" mono>{i.modelo} · sér. {i.serie}</Badge> },
    { id: "qt", rotulo: "Números", valor: (i) => i.numeroFinal - i.numeroInicial + 1, render: (i) => <span className="tabular text-[12px]">{i.numeroFinal - i.numeroInicial + 1}</span>, alinhar: "direita" },
    { id: "justificativa", rotulo: "Justificativa", valor: (i) => i.justificativa, render: (i) => <span className="line-clamp-1 text-[12px] text-ink-600">{i.justificativa}</span> },
    { id: "protocolo", rotulo: "Protocolo", valor: (i) => i.protocolo, render: (i) => <span className="font-mono text-[11px] text-ink-400">{i.protocolo || "—"}</span> },
    { id: "em", rotulo: "Pedido", valor: (i) => i.em, render: (i) => <span className="text-[12px] text-ink-500">{dataBR(i.em)}</span> },
    { id: "status", rotulo: "Situação", valor: (i) => i.status, render: (i) => <Badge tom={i.status === "homologado" ? "ok" : "neutro"}>{i.status}</Badge> },
    {
      id: "acoes",
      rotulo: "",
      ocultoNoCsv: true,
      render: (i) =>
        i.status === "homologado" ? (
          <Button tamanho="sm" variante="fantasma" title="Cancelar inutilização" onClick={async () => {
            setOcupado(true);
            const r = await cancelarInutilizacao(i.id);
            setOcupado(false);
            toast(r.ok ? r.aviso ?? "Cancelada." : r.erro, r.ok ? "ok" : "erro");
          }}>
            desfazer
          </Button>
        ) : (
          <span className="text-[11px] text-ink-300">—</span>
        ),
    },
  ];

  useEffect(() => {
    if (!abrirCorrecaoDe) return;
    const alvo = documentos.find((d) => d.id === abrirCorrecaoDe);
    if (alvo) {
      setCorrigindo(alvo);
      setCorrecao("");
    }
  }, [abrirCorrecaoDe, documentos]);

  const enviar = async () => {
    setOcupado(true);
    const r = await inutilizarNumeracao({
      modelo: f.modelo,
      serie: f.serie,
      numeroInicial: Number(f.inicio),
      numeroFinal: Number(f.fim || f.inicio),
      justificativa: f.justificativa,
    });
    setOcupado(false);
    toast(r.ok ? r.aviso ?? "Inutilizado." : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) setF({ ...f, inicio: "", fim: "", justificativa: "" });
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Próximo número" valor={String(proximoNumero).padStart(9, "0")} detalhe={`${f.modelo} · série ${f.serie} (pula inutilizados)`} icone="documento" tom="ok" barra={100} />
        <Kpi rotulo="Faixas inutilizadas" valor={String(ativas.length)} detalhe={`${inutilizacoes.length - ativas.length} cancelada(s)`} icone="cadeado" tom={ativas.length ? "alerta" : "neutro"} />
        <Kpi rotulo="Números inutilizados" valor={String(numerosInutilizados)} detalhe="não serão emitidos" icone="entrada" tom="neutro" />
        <Kpi rotulo="Cartas de correção" valor={String(cartas.length)} detalhe={`${comEvento.length} documento(s) com evento`} icone="atualizar" tom={cartas.length ? "info" : "neutro"} />
      </div>

      {aba === "inutilizar" ? (
        <>
          <Card>
            <CardTitulo
              titulo="Inutilizar numeração"
              descricao="Só para número que nunca foi emitido (perda de sequência, quebra de banco, erro de impressora). Justificativa de 15 a 255 caracteres."
              icone="cadeado"
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Modelo">
                <Select valor={f.modelo} aoMudar={(v) => setF({ ...f, modelo: v })} opcoes={MODELOS} />
              </Campo>
              <Campo rotulo="Série">
                <Input valor={f.serie} aoMudar={(v) => setF({ ...f, serie: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="Número inicial" obrigatorio>
                <Input valor={f.inicio} aoMudar={(v) => setF({ ...f, inicio: v.replace(/\D/g, "") })} className="font-mono" />
              </Campo>
              <Campo rotulo="Número final" dica="igual ao inicial para 1 número">
                <Input valor={f.fim} aoMudar={(v) => setF({ ...f, fim: v.replace(/\D/g, "") })} className="font-mono" />
              </Campo>
            </div>
            <div className="mt-3">
              <Campo rotulo="Justificativa" obrigatorio dica={`${f.justificativa.trim().length}/255 caracteres — mínimo 15`}>
                <Area rotulo="Justificativa" valor={f.justificativa} aoMudar={(v) => setF({ ...f, justificativa: v })} linhas={3} placeholder="Ex.: perda de sequência após queda de energia no caixa 2" />
              </Campo>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button disabled={ocupado || !f.inicio || f.justificativa.trim().length < 15} onClick={enviar} icone="cadeado">
                {ocupado ? "Enviando…" : "Inutilizar intervalo"}
              </Button>
              <span className="text-[11.5px] text-ink-400">
                A SEFAZ recusa se o número já foi usado. Intervalo máximo de 500 números por pedido.
              </span>
            </div>
            {gap.length > 0 && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-ink-700 ring-1 ring-inset ring-amber-200">
                Há <b>{gap.length > 11 ? "11+" : gap.length}</b> número(s) sem documento nesta série:{" "}
                <span className="font-mono">{gap.join(", ")}</span>. Se nunca foram emitidos, podem ser inutilizados.
              </p>
            )}
          </Card>

          <Card>
            <CardTitulo titulo="Pedidos de inutilização" descricao="Histórico com justificativa e protocolo" icone="documento" />
            <BarraFiltros>
              <div className="w-64">
                <FiltroTexto rotulo="Buscar" valor={busca} aoMudar={setBusca} placeholder="faixa, justificativa, protocolo" />
              </div>
            </BarraFiltros>
            <Tabela colunas={colunas} linhas={lista} chave={(i) => i.id} nomeExportar="nkway-inutilizacoes" tamanhoPagina={12} compacta alturaFixa />
          </Card>
        </>
      ) : (
        <Card>
          <CardTitulo
            titulo="Eventos fiscais"
            descricao="Carta de correção (evento 110110) e cancelamentos vinculados aos documentos emitidos"
            icone="atualizar"
          />
          {comEvento.length === 0 ? (
            <p className="rounded-lg bg-ink-50 px-3 py-4 text-center text-[12.5px] text-ink-400">
              Nenhum evento registrado. Abra uma nota na aba “Notas fiscais” e use <b>Carta de correção</b>.
            </p>
          ) : (
            <ul className="space-y-2">
              {comEvento.map((d) => (
                <li key={d.id} className="rounded-xl border border-ink-100 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-ink-900">
                        {d.modelo} {String(d.numeroNota ?? d.numero).padStart(9, "0")} · sér. {d.serie}
                      </p>
                      <p className="text-[11.5px] text-ink-400">
                        {d.clienteNome} · {dataBR(d.data)} · <span className="font-mono">{d.chave?.slice(0, 12)}…</span>
                      </p>
                    </div>
                    <Button tamanho="sm" variante="secundario" onClick={() => setVendo(d)}>
                      Ver eventos
                    </Button>
                  </div>
                  <div className="mt-2 space-y-1">
                    {d.eventos.map((e) => (
                      <div key={e.id} className="flex items-start gap-2 rounded-lg bg-ink-50/70 px-2.5 py-1.5">
                        <Badge tom={e.tipo === "carta_correcao" ? "info" : "erro"} mono>
                          {e.tipo === "carta_correcao" ? `CC nº ${e.sequencia}` : e.tipo}
                        </Badge>
                        <span className="min-w-0 flex-1 text-[12px] text-ink-600">{e.descricao}</span>
                        <span className="shrink-0 font-mono text-[10.5px] text-ink-400">{dataHoraBR(e.em)}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <div className={cn("flex items-center gap-1")}>
        <Button variante={aba === "inutilizar" ? "suave" : "fantasma"} tamanho="sm" onClick={() => setAba("inutilizar")}>
          Inutilização
        </Button>
        <Button variante={aba === "eventos" ? "suave" : "fantasma"} tamanho="sm" onClick={() => setAba("eventos")}>
          Eventos ({cartas.length})
        </Button>
      </div>

      {/* -------------------------------------------------------- detalhe de eventos */}
      <Modal aberto={!!vendo} aoFechar={() => setVendo(null)} titulo={vendo ? `Eventos de ${vendo.modelo} ${String(vendo.numeroNota ?? vendo.numero).padStart(9, "0")}` : ""} descricao="Timeline dos eventos vinculados à chave" largura="max-w-xl">
        {vendo && (
          <ol className="space-y-2">
            {vendo.eventos.length === 0 && <p className="text-[12.5px] text-ink-400">Nenhum evento para este documento.</p>}
            {vendo.eventos.map((e) => (
              <li key={e.id} className="rounded-lg border border-ink-100 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Badge tom={e.tipo === "carta_correcao" ? "info" : "erro"} mono>
                    {e.tipo === "carta_correcao" ? `Carta de correção nº ${e.sequencia}` : e.tipo}
                  </Badge>
                  <span className="font-mono text-[10.5px] text-ink-400">{e.protocolo || "sem protocolo"}</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-700">{e.descricao}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">{dataHoraBR(e.em)}</p>
              </li>
            ))}
          </ol>
        )}
      </Modal>

      {/* -------------------------------------------------------- nova carta de correção */}
      <Modal
        aberto={!!corrigindo}
        aoFechar={() => {
          setCorrigindo(null);
          aoFecharCorrecao?.();
        }}
        titulo={corrigindo ? `Carta de correção — ${corrigindo.modelo} ${String(corrigindo.numeroNota ?? corrigindo.numero).padStart(9, "0")}` : ""}
        descricao="Evento 110110 · serve para corrigir informações adicionais, endereço, razão social e natureza da operação"
        largura="max-w-xl"
        rodape={
          <>
            <Button
              variante="secundario"
              onClick={() => {
                setCorrigindo(null);
                aoFecharCorrecao?.();
              }}
            >
              Voltar
            </Button>
            <Button
              disabled={ocupado || correcao.trim().length < 15}
              onClick={async () => {
                if (!corrigindo) return;
                setOcupado(true);
                const r = await emitirCartaCorrecao({ vendaId: corrigindo.id, correcao });
                setOcupado(false);
                toast(r.ok ? r.aviso ?? "Evento emitido." : r.erro, r.ok ? "ok" : "erro");
                if (r.ok) {
                  setCorrigindo(null);
                  setCorrecao("");
                  aoFecharCorrecao?.();
                }
              }}
              icone="atualizar"
            >
              {ocupado ? "Enviando…" : "Emitir carta de correção"}
            </Button>
          </>
        }
      >
        <Campo rotulo="O que está sendo corrigido" obrigatorio dica={`${correcao.trim().length}/1000 caracteres — mínimo 15`}>
          <Area
            rotulo="Correção"
            valor={correcao}
            aoMudar={setCorrecao}
            linhas={4}
            placeholder="Ex.: correção do endereço do destinatário — o correto é Av. Jorge Teixeira, nº 4100, bairro Nova Embrapa"
          />
        </Campo>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-snug text-ink-700 ring-1 ring-inset ring-amber-200">
          A carta de correção <b>não altera</b> valores, quantidade, CPF/CNPJ do destinatário, CFOP, NCM ou data. Para esses casos o
          caminho é cancelar a nota e emitir outra (ou nota complementar). Aceita até 20 eventos por documento.
        </div>
      </Modal>
    </>
  );
}
