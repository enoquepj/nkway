"use client";

import { useMemo, useState } from "react";
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
import { cancelarVenda, faturarDav, excluirDav, type Pagamento } from "@/server/acoes/pdv";
import type { VendaDto } from "@/server/dados";

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
}: {
  vendas: VendaDto[];
  empresa: { fantasia: string; nome: string; cnpj: string; endereco: string; municipio: string; uf: string };
}) {
  const toast = useToast();
  const [aba, setAba] = useState<"fiscal" | "dav">("fiscal");
  const [busca, setBusca] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [status, setStatus] = useState<string[]>([]);
  const [modelos, setModelos] = useState<string[]>([]);
  const [formas, setFormas] = useState<string[]>([]);
  const [minimo, setMinimo] = useState("");
  const [detalhe, setDetalhe] = useState<VendaDto | null>(null);
  const [faturando, setFaturando] = useState<VendaDto | null>(null);
  const [cancelando, setCancelando] = useState<VendaDto | null>(null);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [novoModelo, setNovoModelo] = useState<"NFC-e" | "NF-e" | "SAT">("NFC-e");
  const [novoPagamento, setNovoPagamento] = useState("dinheiro");
  const [ocupado, setOcupado] = useState(false);

  const filtroAtual = {
    busca,
    inicio: periodo.inicio,
    fim: periodo.fim,
    status,
    modelos,
    formas,
    minimo,
  };
  type FiltroCfg = typeof filtroAtual;
  const aplicar = (f: FiltroCfg) => {
    setBusca(f.busca);
    setPeriodo({ inicio: f.inicio, fim: f.fim });
    setStatus(f.status);
    setModelos(f.modelos);
    setFormas(f.formas);
    setMinimo(f.minimo);
  };
  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...(periodo.inicio || periodo.fim ? [{ r: `período ${periodo.inicio || "…"} → ${periodo.fim || "…"}`, limpar: () => setPeriodo({ inicio: "", fim: "" }) }] : []),
    ...status.map((s2) => ({ r: `status: ${s2}`, limpar: () => setStatus(status.filter((x) => x !== s2)) })),
    ...modelos.map((m) => ({ r: `modelo: ${m}`, limpar: () => setModelos(modelos.filter((x) => x !== m)) })),
    ...formas.map((f) => ({ r: `pagamento: ${rotuloForma(f)}`, limpar: () => setFormas(formas.filter((x) => x !== f)) })),
    ...(minimo ? [{ r: `total ≥ ${minimo}`, limpar: () => setMinimo("") }] : []),
  ];

  const linhas = useMemo(() => {
    return vendas.filter((v) => {
      if (aba === "fiscal" ? v.tipo !== "fiscal" : v.tipo !== "dav") return false;
      if (!casaTexto(`${v.clienteNome} ${v.numero} ${v.numeroNota ?? ""} ${v.chave ?? ""} ${v.observacao ?? ""}`, busca)) return false;
      if (status.length && !status.includes(v.status)) return false;
      if (modelos.length && !modelos.includes(v.modelo ?? "sem")) return false;
      if (formas.length && !formas.includes(v.formaPagamento)) return false;
      if (minimo && v.total < (Number(minimo.replace(",", ".")) || 0)) return false;
      if ((periodo.inicio || periodo.fim) && !emPeriodo(v.data, periodo)) return false;
      return true;
    });
  }, [vendas, aba, busca, status, modelos, formas, minimo, periodo]);

  const totalSelecionado = round2(linhas.reduce((s, v) => s + (v.status === "cancelado" ? 0 : v.total), 0));
  const contagem = (tipo: "fiscal" | "dav") => vendas.filter((v) => v.tipo === tipo).length;

  const colunas: Coluna<VendaDto>[] = [
    {
      id: "numero",
      rotulo: aba === "dav" ? "DAV" : "Documento",
      valor: (v) => v.numero,
      render: (v) => (
        <div>
          <p className="tabular text-[12.5px] font-bold text-ink-900">
            {aba === "dav" ? `DAV ${v.numero}` : `${v.modelo ?? "NFC-e"} ${v.numeroNota ?? "—"}`}
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
          {v.tipo === "dav" && v.status === "aberto" && (
            <Button tamanho="sm" variante="suave" onClick={() => { setFaturando(v); setNovoModelo("NFC-e"); }}>
              Faturar
            </Button>
          )}
          {v.status !== "cancelado" && (
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
        titulo="Documentos fiscais"
        subtitulo="DAVs e notas emitidas pelo PDV · faturamento de orçamento em nota · eventos de cancelamento"
        acao={
          <>
            <Badge tom="info">{linhas.length} documento(s) no filtro</Badge>
            <Badge tom="ok">{moeda(totalSelecionado)}</Badge>
          </>
        }
      />

      <Abas
        abas={[
          { id: "fiscal", rotulo: "Notas fiscais", contagem: contagem("fiscal") },
          { id: "dav", rotulo: "DAVs / orçamentos", contagem: contagem("dav") },
        ]}
        atual={aba}
        aoTrocar={(i) => setAba(i as "fiscal" | "dav")}
      />

      <BarraFiltros>
        <FiltroTexto rotulo="Busca livre" valor={busca} aoMudar={setBusca} placeholder="cliente, nº, chave, observação" largura="w-64" />
        <FiltroPeriodo valor={periodo} aoMudar={setPeriodo} />
        <FiltroMulti
          rotulo="Status"
          opcoes={[
            { valor: "faturado", rotulo: "Autorizadas" },
            { valor: "aberto", rotulo: "Abertos" },
            { valor: "cancelado", rotulo: "Canceladas" },
          ]}
          selecionados={status}
          aoAlternar={(v) => setStatus(alternarItem(status, v))}
        />
        <FiltroMulti rotulo="Modelo" opcoes={[{ valor: "NFC-e", rotulo: "NFC-e" }, { valor: "NF-e", rotulo: "NF-e" }, { valor: "SAT", rotulo: "SAT" }]} selecionados={modelos} aoAlternar={(v) => setModelos(alternarItem(modelos, v))} />
        <FiltroMulti rotulo="Pagamento" opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} selecionados={formas} aoAlternar={(v) => setFormas(alternarItem(formas, v))} />
        <Campo rotulo="Total a partir de" className="w-28">
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
              setPeriodo({ inicio: "", fim: "" });
              setStatus([]);
              setModelos([]);
              setFormas([]);
              setMinimo("");
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
        vazio={aba === "dav" ? "Nenhum DAV neste filtro. Gere um na frente de caixa." : "Nenhuma nota neste filtro."}
      />

      <Modal
        aberto={!!detalhe}
        aoFechar={() => setDetalhe(null)}
        titulo={detalhe ? (detalhe.tipo === "dav" ? `DAV ${detalhe.numero}` : `${detalhe.modelo} ${detalhe.numeroNota}`) : ""}
        descricao="Pré-visualização do documento — o XML completo fica guardado no cadastro da nota"
        largura="max-w-2xl"
        rodape={
          <>
            <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
              Imprimir
            </Button>
            {detalhe?.tipo === "dav" && detalhe.status === "aberto" && (
              <Button onClick={() => { setFaturando(detalhe); setDetalhe(null); }}>Faturar em nota</Button>
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
    </>
  );
}
