"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Card,
  CardTitulo,
  FiltroTexto,
  Icon,
  Input,
  Kpi,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { dataBR, formatChave, moeda, num, round2 } from "@/lib/dominio";
import type { DevolucaoDto } from "@/server/dados";
import type { listarEntradasDevolviveis } from "@/server/dados";
import { cancelarDevolucao, emitirDevolucao } from "@/server/acoes/devolucoes";

type Entrada = Awaited<ReturnType<typeof listarEntradasDevolviveis>>[number];
type ItemEntrada = Entrada["itens"][number];

const STATUS_TOM: Record<string, "ok" | "alerta" | "erro" | "neutro"> = {
  emitida: "ok",
  cancelada: "erro",
  aberta: "alerta",
};

export function DevolucoesView({
  devolucoes,
  entradas,
  ufEmpresa,
  kardexDevolucao,
}: {
  devolucoes: DevolucaoDto[];
  entradas: Entrada[];
  ufEmpresa: string;
  kardexDevolucao: { nome: string; qtd: number; documento: string; data: string }[];
}) {
  const toast = useToast();
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<Entrada | null>(null);
  const [qtds, setQtds] = useState<Record<string, number>>({});
  const [motivo, setMotivo] = useState("");
  const [gerarFinanceiro, setGerarFinanceiro] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [vendo, setVendo] = useState<DevolucaoDto | null>(null);
  const [cancelando, setCancelando] = useState<DevolucaoDto | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");

  const lista = useMemo(
    () =>
      devolucoes.filter((d) => {
        const t = busca.trim().toLowerCase();
        if (!t) return true;
        return [d.fornecedor, d.cfop, d.motivo, String(d.numero), d.chaveReferente].some((v) => v.toLowerCase().includes(t));
      }),
    [devolucoes, busca],
  );

  const devolvidas = devolucoes.filter((d) => d.status !== "cancelada");
  const valorDevolvido = round2(devolvidas.reduce((s, d) => s + d.total, 0));
  const creditosAbertos = round2(devolvidas.reduce((s, d) => s + d.total, 0));
  const itensDevolvidos = round2(devolvidas.reduce((s, d) => s + d.itens.reduce((a, i) => a + i.qtd, 0), 0));

  const abrir = (e: Entrada) => {
    setOrigem(e);
    setQtds(Object.fromEntries(e.itens.map((i) => [i.nome, 0])));
    setMotivo("");
    setGerarFinanceiro(true);
  };

  const selecionados = origem ? origem.itens.filter((i) => (qtds[i.nome] ?? 0) > 0) : [];
  const totalDevolucao = round2(selecionados.reduce((s, i) => s + (qtds[i.nome] ?? 0) * i.custo, 0));

  const emitir = async () => {
    if (!origem) return;
    setOcupado(true);
    const r = await emitirDevolucao({
      entradaId: origem.id,
      motivo,
      gerarFinanceiro,
      itens: selecionados.map((i) => ({
        produtoId: i.produtoId,
        nome: i.nome,
        unidade: i.unidade,
        ncm: i.ncm,
        qtd: round2(qtds[i.nome] ?? 0),
        custo: i.custo,
      })),
    });
    setOcupado(false);
    toast(r.ok ? r.aviso ?? "Devolução emitida." : r.erro, r.ok ? "ok" : "erro");
    if (r.ok) setOrigem(null);
  };

  const colunas: Coluna<DevolucaoDto>[] = [
    { id: "numero", rotulo: "Nº", valor: (d) => d.numero, render: (d) => <span className="font-mono text-[12px] font-bold text-ink-800">{String(d.numero).padStart(4, "0")}</span>, largura: "62px" },
    { id: "fornecedor", rotulo: "Fornecedor", valor: (d) => d.fornecedor, render: (d) => (
      <span className="min-w-0">
        <span className="block truncate text-[12.5px] font-semibold text-ink-800">{d.fornecedor}</span>
        <span className="block font-mono text-[10.5px] text-ink-400">{d.cnpjFornecedor}</span>
      </span>
    ) },
    { id: "cfop", rotulo: "CFOP", valor: (d) => d.cfop, render: (d) => <Badge tom={d.cfop === "5201" ? "info" : "roxo"} mono>{d.cfop}</Badge>, largura: "76px" },
    { id: "emissao", rotulo: "Emissão", valor: (d) => d.emissao, render: (d) => <span className="text-[12px] text-ink-600">{dataBR(d.emissao)}</span> },
    { id: "itens", rotulo: "Itens", valor: (d) => d.itens.length, render: (d) => <span className="tabular text-[12px]">{d.itens.length}</span>, alinhar: "centro" },
    { id: "total", rotulo: "Valor", valor: (d) => d.total, render: (d) => <span className="tabular text-[12.5px] font-bold text-ink-900">{moeda(d.total)}</span>, alinhar: "direita" },
    { id: "status", rotulo: "Situação", valor: (d) => d.status, render: (d) => <Badge tom={STATUS_TOM[d.status] ?? "neutro"}>{d.status}</Badge> },
    {
      id: "acoes",
      rotulo: "",
      ocultoNoCsv: true,
      render: (d) => (
        <span className="flex items-center justify-end gap-1">
          <Button tamanho="sm" variante="fantasma" icone="documento" onClick={() => setVendo(d)} title="Ver NFref e itens" />
          {d.status === "emitida" && <Button tamanho="sm" variante="fantasma" icone="lixo" onClick={() => setCancelando(d)} title="Cancelar devolução" />}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Devoluções de compra"
        subtitulo="Devolva mercadoria ao fornecedor com CFOP 5201/6201, NFref da nota de entrada e baixa automática no kardex"
        acao={<Badge tom="info">{devolvidas.length} devolução(ões)</Badge>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Devoluções válidas" valor={String(devolvidas.length)} detalhe="canceladas não contam" icone="documento" tom="neutro" />
        <Kpi rotulo="Valor devolvido" valor={moeda(valorDevolvido)} detalhe="crédito com os fornecedores" icone="carteira" tom="info" barra={100} />
        <Kpi rotulo="Itens devolvidos" valor={num(itensDevolvidos, 3)} detalhe="soma das quantidades" icone="caixaEstoque" tom="neutro" />
        <Kpi rotulo="Saldo a receber" valor={moeda(creditosAbertos)} detalhe="lançado no financeiro" icone="raio" tom={creditosAbertos > 0 ? "ok" : "neutro"} />
      </div>

      <Card>
        <CardTitulo
          titulo="Notas de entrada disponíveis para devolver"
          descricao="Só entradas já lançadas aparecem — a devolução referencia a chave da nota original (NFref)"
          icone="entrada"
        />
        <div className="grid gap-2 lg:grid-cols-2">
          {entradas.length === 0 && <p className="text-[12.5px] text-ink-400">Nenhuma entrada lançada ainda — lance uma nota em Entrada de mercadoria.</p>}
          {entradas.map((e) => (
            <div key={e.id} className={cn("rounded-xl border p-3", e.podeDevolver ? "border-ink-100 bg-white" : "border-ink-100 bg-ink-50/60 opacity-70")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-bold text-ink-900">{e.fornecedor}</p>
                  <p className="font-mono text-[10.5px] text-ink-400">
                    NF {e.numeroNota}/{e.serie} · {dataBR(e.emissao)} · {moeda(e.total)}
                  </p>
                </div>
                <Button tamanho="sm" variante={e.podeDevolver ? "primario" : "secundario"} disabled={!e.podeDevolver} onClick={() => abrir(e)}>
                  Devolver
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-400">
                {e.itens.length} item(ns) · {e.podeDevolver ? "há saldo disponível para devolver" : "tudo já devolvido"}
              </p>
              <p className="mt-1 break-all font-mono text-[9.5px] text-ink-300">NFref {formatChave(e.chave)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitulo titulo="Devoluções emitidas" descricao="Histórico com CFOP, NFref e situação" icone="documento" />
        <BarraFiltros>
          <div className="w-64">
            <FiltroTexto rotulo="Buscar" valor={busca} aoMudar={setBusca} placeholder="Fornecedor, CFOP, motivo, NFref…" />
          </div>
        </BarraFiltros>
        <Tabela colunas={colunas} linhas={lista} chave={(d) => d.id} nomeExportar="nkway-devolucoes" tamanhoPagina={12} alturaFixa compacta />
      </Card>

      {kardexDevolucao.length > 0 && (
        <Card>
          <CardTitulo titulo="Baixas recentes no kardex" descricao="Toda devolução gera linha de saída com saldo após" icone="caixaEstoque" />
          <ul className="space-y-1">
            {kardexDevolucao.slice(0, 8).map((m, k) => (
              <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-ink-50/70 px-2.5 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-800">{m.nome}</span>
                  <span className="block text-[10.5px] text-ink-400">{m.documento} · {dataBR(m.data)}</span>
                </span>
                <span className="tabular shrink-0 text-[12.5px] font-bold text-rose-600">{num(m.qtd, 3)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------------------ nova devolução */}
      <Modal
        aberto={!!origem}
        aoFechar={() => setOrigem(null)}
        titulo={origem ? `Devolver mercadoria — NF ${origem.numeroNota}/${origem.serie}` : ""}
        descricao={origem ? `${origem.fornecedor} · NFref ${formatChave(origem.chave)}` : ""}
        largura="max-w-3xl"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setOrigem(null)}>
              Voltar
            </Button>
            <Button disabled={ocupado || selecionados.length === 0 || !motivo.trim()} onClick={emitir} icone="baixar">
              {ocupado ? "Emitindo…" : `Emitir devolução · ${moeda(totalDevolucao)}`}
            </Button>
          </>
        }
      >
        {origem && (
          <div className="space-y-3">
            <div className="rounded-lg bg-sky-50/70 px-3 py-2 text-[11.5px] leading-snug text-ink-700 ring-1 ring-inset ring-sky-200">
              O CFOP é escolhido pela UF: <b>5201</b> quando o fornecedor é do mesmo estado ({ufEmpresa}) e <b>6201</b> quando é de
              outro. A devolução <b>retira a mercadoria do estoque</b> e registra cada linha no kardex.
            </div>

            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10.5px] uppercase text-ink-400">
                  <th className="py-1 text-left">Item</th>
                  <th className="py-1 text-right">Comprado</th>
                  <th className="py-1 text-right">Disponível</th>
                  <th className="py-1 text-right">Devolver</th>
                  <th className="py-1 text-right">Custo</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {origem.itens.map((i: ItemEntrada) => {
                  const q = qtds[i.nome] ?? 0;
                  return (
                    <tr key={i.nome} className="border-t border-ink-100">
                      <td className="py-1.5">
                        <span className="block font-semibold text-ink-800">{i.nome}</span>
                        <span className="block font-mono text-[10px] text-ink-400">NCM {i.ncm} · {i.unidade}</span>
                      </td>
                      <td className="tabular py-1.5 text-right text-ink-500">{num(i.qtdNota, 3)}</td>
                      <td className="tabular py-1.5 text-right text-ink-500">{num(i.disponivel, 3)}</td>
                      <td className="py-1.5 text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          max={i.disponivel}
                          value={q || ""}
                          disabled={i.disponivel <= 0}
                          onChange={(e) => setQtds({ ...qtds, [i.nome]: Math.min(i.disponivel, Number(e.target.value) || 0) })}
                          className="tabular w-20 rounded-lg bg-white px-2 py-1 text-right text-[12px] ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500 disabled:bg-ink-50"
                        />
                      </td>
                      <td className="tabular py-1.5 text-right text-ink-500">{moeda(i.custo)}</td>
                      <td className="tabular py-1.5 text-right font-bold text-ink-900">{q > 0 ? moeda(round2(q * i.custo)) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <Campo rotulo="Motivo da devolução" obrigatorio dica="Aparece nas informações adicionais da nota">
              <Select
                valor={motivo}
                aoMudar={setMotivo}
                opcoes={[
                  { valor: "", rotulo: "Selecione o motivo…" },
                  { valor: "Produto em desacordo com o pedido", rotulo: "Produto em desacordo com o pedido" },
                  { valor: "Mercadoria avariada no transporte", rotulo: "Mercadoria avariada no transporte" },
                  { valor: "Vencimento do prazo de validade", rotulo: "Vencimento do prazo de validade" },
                  { valor: "Excesso de estoque acordado com o fornecedor", rotulo: "Excesso de estoque acordado com o fornecedor" },
                  { valor: "Erro de faturamento do fornecedor", rotulo: "Erro de faturamento do fornecedor" },
                ]}
              />
            </Campo>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-ink-50 px-3 py-2">
              <input type="checkbox" checked={gerarFinanceiro} onChange={(e) => setGerarFinanceiro(e.target.checked)} className="size-4 accent-way-600" />
              <span className="text-[12.5px] text-ink-700">
                Lançar crédito de <b>{moeda(totalDevolucao)}</b> no financeiro (conta a receber do fornecedor)
              </span>
            </label>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------ detalhe */}
      <Modal aberto={!!vendo} aoFechar={() => setVendo(null)} titulo={vendo ? `Devolução Nº ${String(vendo.numero).padStart(4, "0")}` : ""} descricao={vendo ? `${vendo.fornecedor} · CFOP ${vendo.cfop}` : ""} largura="max-w-2xl">
        {vendo && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { r: "Emissão", v: dataBR(vendo.emissao) },
                { r: "Situação", v: vendo.status },
                { r: "Valor", v: moeda(vendo.total) },
              ].map((x) => (
                <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
                  <p className="micro text-ink-400">{x.r}</p>
                  <p className="text-[13px] font-bold text-ink-900">{x.v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-ink-900 px-3 py-2.5 font-mono text-[10.5px] leading-relaxed text-ink-100">
              <p>chave da devolução: <b className="text-way-300">{vendo.chave || "—"}</b></p>
              <p>NFref (entrada original): <b className="text-way-300">{vendo.chaveReferente || "—"}</b></p>
              <p>motivo: {vendo.motivo || "—"}</p>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[10.5px] uppercase text-ink-400">
                  <th className="py-1 text-left">Item</th>
                  <th className="py-1 text-center">CFOP</th>
                  <th className="py-1 text-right">Qtd</th>
                  <th className="py-1 text-right">Custo</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {vendo.itens.map((i, k) => (
                  <tr key={k} className="border-t border-ink-100">
                    <td className="py-1.5">
                      <span className="block font-semibold text-ink-800">{i.nome}</span>
                      <span className="block font-mono text-[10px] text-ink-400">NCM {i.ncm} · {i.unidade}</span>
                    </td>
                    <td className="py-1.5 text-center"><Badge tom="info" mono>{i.cfop}</Badge></td>
                    <td className="tabular py-1.5 text-right">{num(i.qtd, 3)}</td>
                    <td className="tabular py-1.5 text-right">{moeda(i.custo)}</td>
                    <td className="tabular py-1.5 text-right font-bold">{moeda(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------ cancelar */}
      <Modal
        aberto={!!cancelando}
        aoFechar={() => setCancelando(null)}
        titulo={cancelando ? `Cancelar devolução Nº ${String(cancelando.numero).padStart(4, "0")}` : ""}
        descricao="O estoque volta ao saldo anterior e o crédito é cancelado"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              variante="perigo"
              disabled={ocupado || !motivoCancelamento.trim()}
              onClick={async () => {
                if (!cancelando) return;
                setOcupado(true);
                const r = await cancelarDevolucao(cancelando.id, motivoCancelamento);
                setOcupado(false);
                toast(r.ok ? r.aviso ?? "Cancelada." : r.erro, r.ok ? "ok" : "erro");
                if (r.ok) {
                  setCancelando(null);
                  setMotivoCancelamento("");
                }
              }}
            >
              Cancelar devolução
            </Button>
          </>
        }
      >
        <Campo rotulo="Motivo do cancelamento" obrigatorio>
          <Input valor={motivoCancelamento} aoMudar={setMotivoCancelamento} placeholder="Ex.: fornecedor recusou a devolução" />
        </Campo>
        <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-ink-400">
          <Icon name="alerta" className="mt-0.5 size-3.5 shrink-0 text-signal-500" />
          Cada item volta ao estoque com um lançamento de devolução no kardex.
        </p>
      </Modal>
    </>
  );
}
