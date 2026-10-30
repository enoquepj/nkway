"use client";

import { useMemo, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Card,
  Campo,
  FiltroPeriodo,
  Icon,
  Input,
  Kpi,
  PageHeader,
  Select,
  cn,
} from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { ROTULO_SITUACAO, dataBR, moeda, round2, rotuloForma, tributosEstimados } from "@/lib/dominio";
import type { listarContas, listarVendas } from "@/server/dados";

type Conta = Awaited<ReturnType<typeof listarContas>>[number];

type LinhaEstoque = { nome: string; categoria: string; estoque: number; custoMedio: number; valorTotal: number; valorVenda: number; situacao: "zerado" | "critico" | "baixo" | "saudavel" };

const ULT_30 = (): Periodo => {
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - 29);
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
};

export function RelatoriosView({
  vendas,
  contas,
  estoque,
  empresa,
}: {
  vendas: { id: string; data: string; total: number; subtotal: number; desconto: number; status: string; tipo: string; modelo: string | null; forma: string; clienteNome: string; pagamentos: { forma: string; valor: number }[]; itens: { nome: string; qtd: number; total: number; precoUnit: number; unidade: string | null }[] }[];
  contas: Conta[];
  estoque: LinhaEstoque[];
  empresa: string;
}) {
  const [aba, setAba] = useState("vendas");
  const [periodo, setPeriodo] = useState<Periodo>(ULT_30());
  const [tipo, setTipo] = useState("faturado");
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("");

  const noPeriodo = useMemo(
    () =>
      vendas.filter((v) => {
        if (!emPeriodo(v.data, periodo)) return false;
        if (tipo === "faturado" && v.status !== "faturado") return false;
        if (tipo === "cancelado" && v.status !== "cancelado") return false;
        if (tipo === "dav" && v.tipo !== "dav") return false;
        if (tipo === "todos") return true;
        return true;
      }),
    [vendas, periodo, tipo],
  );

  const totalPeriodo = round2(noPeriodo.reduce((s, v) => s + v.total, 0));

  /* --------------------------------------------------------- por dia */
  const porDia = useMemo(() => {
    const m = new Map<string, { dia: string; notas: number; total: number; ticket: number; desconto: number }>();
    for (const v of noPeriodo) {
      const d = v.data.slice(0, 10);
      const atual = m.get(d) ?? { dia: d, notas: 0, total: 0, ticket: 0, desconto: 0 };
      atual.notas += 1;
      atual.total = round2(atual.total + v.total);
      atual.desconto = round2(atual.desconto + v.desconto);
      m.set(d, atual);
    }
    return [...m.values()].map((x) => ({ ...x, ticket: round2(x.total / x.notas) })).sort((a, b) => (a.dia < b.dia ? 1 : -1));
  }, [noPeriodo]);

  /* ------------------------------------------------------------- ABC */
  const abc = useMemo(() => {
    const m = new Map<string, { nome: string; qtd: number; total: number }>();
    for (const v of noPeriodo)
      for (const i of v.itens) {
        const atual = m.get(i.nome) ?? { nome: i.nome, qtd: 0, total: 0 };
        atual.qtd = round2(atual.qtd * 1000 + i.qtd * 1000) / 1000;
        atual.total = round2(atual.total + i.total);
        m.set(i.nome, atual);
      }
    const lista = [...m.values()].sort((a, b) => b.total - a.total);
    const totalGeral = round2(lista.reduce((s, l) => s + l.total, 0)) || 1;
    let acum = 0;
    return lista.map((l) => {
      acum += l.total;
      const part = round2((acum / totalGeral) * 100);
      return {
        ...l,
        participacao: round2((l.total / totalGeral) * 100),
        acumulado: part,
        classe: (part <= 80 ? "A" : part <= 95 ? "B" : "C") as "A" | "B" | "C",
      };
    });
  }, [noPeriodo]);

  /* -------------------------------------------------------- clientes */
  const porCliente = useMemo(() => {
    const m = new Map<string, { nome: string; docs: number; total: number; ticket: number }>();
    for (const v of noPeriodo) {
      const atual = m.get(v.clienteNome) ?? { nome: v.clienteNome, docs: 0, total: 0, ticket: 0 };
      atual.docs += 1;
      atual.total = round2(atual.total + v.total);
      m.set(v.clienteNome, atual);
    }
    return [...m.values()].map((x) => ({ ...x, ticket: round2(x.total / x.docs) })).sort((a, b) => b.total - a.total);
  }, [noPeriodo]);

  /* ---------------------------------------------------------- fiscal */
  const fiscal = useMemo(() => {
    const m = new Map<string, { chave: string; docs: number; total: number; icms: number; ibs: number; cbs: number }>();
    for (const v of noPeriodo) {
      const mes = v.data.slice(0, 7);
      const k = `${mes} · ${v.tipo === "dav" ? "DAV" : (v.modelo ?? "NFC-e")}`;
      const atual = m.get(k) ?? { chave: k, docs: 0, total: 0, icms: 0, ibs: 0, cbs: 0 };
      atual.docs += 1;
      atual.total = round2(atual.total + v.total);
      const t = tributosEstimados(v.total, { icms: 0, pis: 0, cofins: 0, ibs: 0.1, cbs: 0.9 });
      atual.ibs = round2(atual.ibs + (t.itens[3]?.valor ?? 0));
      atual.cbs = round2(atual.cbs + (t.itens[4]?.valor ?? 0));
      m.set(k, atual);
    }
    return [...m.values()].sort((a, b) => (a.chave < b.chave ? 1 : -1));
  }, [noPeriodo]);

  /* ------------------------------------------------------- pagamentos */
  const porForma = useMemo(() => {
    const m = new Map<string, { forma: string; valor: number; qtd: number }>();
    for (const v of noPeriodo) {
      const lista = v.pagamentos.length ? v.pagamentos : [{ forma: v.forma, valor: v.total }];
      for (const p of lista) {
        const atual = m.get(p.forma) ?? { forma: p.forma, valor: 0, qtd: 0 };
        atual.valor = round2(atual.valor + p.valor);
        atual.qtd += 1;
        m.set(p.forma, atual);
      }
    }
    const total = round2([...m.values()].reduce((s, x) => s + x.valor, 0)) || 1;
    return [...m.values()]
      .map((x) => ({ ...x, share: round2((x.valor / total) * 100) }))
      .sort((a, b) => b.valor - a.valor);
  }, [noPeriodo]);

  /* ------------------------------------------------------- financeiro */
  const financeiro = useMemo(() => {
    const m = new Map<string, { categoria: string; receber: number; pagar: number; abertas: number; vencidas: number }>();
    for (const c of contas) {
      if (!emPeriodo(c.vencimento, periodo)) continue;
      const atual = m.get(c.categoria) ?? { categoria: c.categoria, receber: 0, pagar: 0, abertas: 0, vencidas: 0 };
      if (c.tipo === "receber") atual.receber = round2(atual.receber + c.saldo);
      else atual.pagar = round2(atual.pagar + c.saldo);
      if (c.status === "aberta") atual.abertas += 1;
      if (c.atrasada) atual.vencidas += 1;
      m.set(c.categoria, atual);
    }
    return [...m.values()].sort((a, b) => b.receber + b.pagar - (a.receber + a.pagar));
  }, [contas, periodo]);

  /* ---------------------------------------------------------- estoque */
  const porCategoria = useMemo(() => {
    const m = new Map<string, { categoria: string; itens: number; imobilizado: number; venda: number; ruptura: number }>();
    for (const e of estoque) {
      if (categoria && e.categoria !== categoria) continue;
      if (busca && !casaTexto(e.nome, busca)) continue;
      const atual = m.get(e.categoria) ?? { categoria: e.categoria, itens: 0, imobilizado: 0, venda: 0, ruptura: 0 };
      atual.itens += 1;
      atual.imobilizado = round2(atual.imobilizado + e.valorTotal);
      atual.venda = round2(atual.venda + e.valorVenda);
      if (e.situacao === "zerado" || e.situacao === "critico") atual.ruptura += 1;
      m.set(e.categoria, atual);
    }
    return [...m.values()].sort((a, b) => b.imobilizado - a.imobilizado);
  }, [estoque, categoria, busca]);

  const cab = (r: string) => ({ key: r });

  return (
    <>
      <PageHeader
        titulo="Relatórios"
        subtitulo={`${empresa} · recorte por período com pré-visualização, CSV e impressão`}
        acao={
          <>
            <Badge tom="info">período {dataBR(periodo.inicio)} → {dataBR(periodo.fim)}</Badge>
            <Button variante="secundario" icone="imprimir" onClick={() => window.print()}>
              Imprimir
            </Button>
          </>
        }
      />

      <BarraFiltros>
        <FiltroPeriodo valor={periodo} aoMudar={setPeriodo} />
        <Campo rotulo="Documentos">
          <Select
            valor={tipo}
            aoMudar={setTipo}
            opcoes={[
              { valor: "faturado", rotulo: "Notas autorizadas" },
              { valor: "dav", rotulo: "DAVs" },
              { valor: "cancelado", rotulo: "Cancelados" },
              { valor: "todos", rotulo: "Tudo" },
            ]}
          />
        </Campo>
        {aba === "estoque" && (
          <>
            <Campo rotulo="Categoria">
              <Select valor={categoria} aoMudar={setCategoria} opcoes={[{ valor: "", rotulo: "Todas" }, ...[...new Set(estoque.map((e) => e.categoria))].sort().map((c) => ({ valor: c, rotulo: c }))]} />
            </Campo>
            <Campo rotulo="Produto">
              <Input valor={busca} aoMudar={setBusca} placeholder="filtro rápido" />
            </Campo>
          </>
        )}
      </BarraFiltros>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Faturamento no período" valor={moeda(totalPeriodo)} icone="grafico" tom="ok" detalhe={`${noPeriodo.length} documento(s)`} />
        <Kpi rotulo="Ticket médio" valor={moeda(noPeriodo.length ? round2(totalPeriodo / noPeriodo.length) : 0)} icone="caixa" detalhe="descontos já aplicados" />
        <Kpi rotulo="Desconto concedido" valor={moeda(round2(noPeriodo.reduce((s, v) => s + v.desconto, 0)))} tom="alerta" icone="menos" detalhe="perda de margem no período" />
        <Kpi rotulo="Tributos IBS/CBS (teste)" valor={moeda(round2(fiscal.reduce((s, f) => s + f.ibs + f.cbs, 0)))} icone="documento" tom="roxo" detalhe="alíquotas de transição 0,1% + 0,9%" />
      </div>

      <Abas
        abas={[
          { id: "vendas", rotulo: "Vendas por dia", contagem: porDia.length },
          { id: "abc", rotulo: "Curva ABC", contagem: abc.length },
          { id: "clientes", rotulo: "Clientes", contagem: porCliente.length },
          { id: "pagamentos", rotulo: "Formas de pagamento", contagem: porForma.length },
          { id: "fiscal", rotulo: "Fiscal", contagem: fiscal.length },
          { id: "financeiro", rotulo: "Financeiro", contagem: financeiro.length },
          { id: "estoque", rotulo: "Estoque", contagem: porCategoria.length },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      <Card padding={false}>
        {aba === "vendas" && (
          <Tabela
            nomeExportar="nkway-rel-vendas"
            chave={(l) => l.dia}
            linhas={porDia}
            colunas={[
              { id: "dia", rotulo: "Dia", valor: (l) => l.dia, render: (l) => <span className="font-semibold text-ink-800" {...cab(l.dia)}>{dataBR(l.dia)}</span> },
              { id: "notas", rotulo: "Documentos", alinhar: "direita", valor: (l) => l.notas },
              { id: "total", rotulo: "Faturamento", alinhar: "direita", valor: (l) => l.total, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.total)}</span> },
              { id: "ticket", rotulo: "Ticket médio", alinhar: "direita", valor: (l) => l.ticket, render: (l) => <span className="tabular text-ink-600">{moeda(l.ticket)}</span> },
              { id: "desc", rotulo: "Descontos", alinhar: "direita", valor: (l) => l.desconto, render: (l) => <span className="tabular text-rose-600">{moeda(l.desconto)}</span> },
            ]}
            vazio="Sem documentos no período."
          />
        )}
        {aba === "abc" && (
          <Tabela
            nomeExportar="nkway-rel-abc"
            chave={(l) => l.nome}
            linhas={abc}
            tamanhoPagina={25}
            colunas={[
              { id: "classe", rotulo: "Classe", alinhar: "centro", valor: (l) => l.classe, render: (l) => <Badge tom={l.classe === "A" ? "ok" : l.classe === "B" ? "info" : "neutro"}>{l.classe}</Badge> },
              { id: "nome", rotulo: "Produto", valor: (l) => l.nome, render: (l) => <span className="font-medium text-ink-800">{l.nome}</span> },
              { id: "qtd", rotulo: "Qtd vendida", alinhar: "direita", valor: (l) => l.qtd },
              { id: "total", rotulo: "Faturamento", alinhar: "direita", valor: (l) => l.total, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.total)}</span> },
              {
                id: "part",
                rotulo: "Participação",
                alinhar: "direita",
                valor: (l) => l.participacao,
                render: (l) => (
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-way-500" style={{ width: `${l.participacao}%` }} />
                    </div>
                    <span className="tabular w-12 text-right text-[11.5px] text-ink-500">{l.participacao.toFixed(1)}%</span>
                  </div>
                ),
              },
              { id: "acum", rotulo: "Acumulado", alinhar: "direita", valor: (l) => l.acumulado, render: (l) => <span className="tabular text-[11.5px] text-ink-400">{l.acumulado.toFixed(1)}%</span> },
            ]}
            vazio="Sem vendas no período para classificar."
          />
        )}
        {aba === "clientes" && (
          <Tabela
            nomeExportar="nkway-rel-clientes"
            chave={(l) => l.nome}
            linhas={porCliente}
            colunas={[
              { id: "nome", rotulo: "Cliente", valor: (l) => l.nome, render: (l) => <span className="font-semibold text-ink-800">{l.nome}</span> },
              { id: "docs", rotulo: "Documentos", alinhar: "direita", valor: (l) => l.docs },
              { id: "total", rotulo: "Volume", alinhar: "direita", valor: (l) => l.total, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.total)}</span> },
              { id: "ticket", rotulo: "Ticket", alinhar: "direita", valor: (l) => l.ticket, render: (l) => <span className="tabular text-ink-600">{moeda(l.ticket)}</span> },
            ]}
            vazio="Nenhum cliente com documento no período."
          />
        )}
        {aba === "pagamentos" && (
          <Tabela
            nomeExportar="nkway-rel-pagamentos"
            chave={(l) => l.forma}
            linhas={porForma}
            colunas={[
              { id: "forma", rotulo: "Forma", valor: (l) => rotuloForma(l.forma), render: (l) => <span className="font-semibold text-ink-800">{rotuloForma(l.forma)}</span> },
              { id: "qtd", rotulo: "Parcelas", alinhar: "direita", valor: (l) => l.qtd },
              { id: "valor", rotulo: "Valor", alinhar: "direita", valor: (l) => l.valor, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.valor)}</span> },
              {
                id: "share",
                rotulo: "Participação",
                alinhar: "direita",
                valor: (l) => l.share,
                render: (l) => (
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100">
                      <div className={cn("h-full rounded-full", l.forma === "prazo" || l.forma === "boleto" ? "bg-amber-500" : "bg-way-500")} style={{ width: `${l.share}%` }} />
                    </div>
                    <span className="tabular w-12 text-right text-[11.5px] text-ink-500">{l.share.toFixed(0)}%</span>
                  </div>
                ),
              },
            ]}
            vazio="Sem pagamentos no período."
          />
        )}
        {aba === "fiscal" && (
          <Tabela
            nomeExportar="nkway-rel-fiscal"
            chave={(l) => l.chave}
            linhas={fiscal}
            colunas={[
              { id: "chave", rotulo: "Mês / modelo", valor: (l) => l.chave, render: (l) => <span className="font-semibold text-ink-800">{l.chave}</span> },
              { id: "docs", rotulo: "Documentos", alinhar: "direita", valor: (l) => l.docs },
              { id: "total", rotulo: "Base de cálculo", alinhar: "direita", valor: (l) => l.total, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.total)}</span> },
              { id: "ibs", rotulo: "IBS estimado", alinhar: "direita", valor: (l) => l.ibs, render: (l) => <span className="tabular text-violet-700">{moeda(l.ibs)}</span> },
              { id: "cbs", rotulo: "CBS estimado", alinhar: "direita", valor: (l) => l.cbs, render: (l) => <span className="tabular text-violet-700">{moeda(l.cbs)}</span> },
            ]}
            vazio="Nada a apurar no período."
          />
        )}
        {aba === "financeiro" && (
          <Tabela
            nomeExportar="nkway-rel-financeiro"
            chave={(l) => l.categoria}
            linhas={financeiro}
            colunas={[
              { id: "categoria", rotulo: "Categoria", valor: (l) => l.categoria, render: (l) => <span className="font-semibold text-ink-800">{l.categoria}</span> },
              { id: "receber", rotulo: "A receber", alinhar: "direita", valor: (l) => l.receber, render: (l) => <span className="tabular text-way-700">{moeda(l.receber)}</span> },
              { id: "pagar", rotulo: "A pagar", alinhar: "direita", valor: (l) => l.pagar, render: (l) => <span className="tabular text-rose-600">{moeda(l.pagar)}</span> },
              { id: "abertas", rotulo: "Títulos", alinhar: "direita", valor: (l) => l.abertas },
              {
                id: "vencidas",
                rotulo: "Vencidos",
                alinhar: "direita",
                valor: (l) => l.vencidas,
                render: (l) => (l.vencidas ? <Badge tom="erro">{l.vencidas}</Badge> : <span className="text-ink-300">—</span>),
              },
            ]}
            vazio="Sem títulos no período."
          />
        )}
        {aba === "estoque" && (
          <Tabela
            nomeExportar="nkway-rel-estoque"
            chave={(l) => l.categoria}
            linhas={porCategoria}
            colunas={[
              { id: "categoria", rotulo: "Categoria", valor: (l) => l.categoria, render: (l) => (
                <span className="flex items-center gap-1.5 font-semibold text-ink-800">
                  <Icon name="caixaEstoque" className="size-3.5 text-ink-400" />
                  {l.categoria}
                </span>
              ) },
              { id: "itens", rotulo: "Itens", alinhar: "direita", valor: (l) => l.itens },
              { id: "imob", rotulo: "Custo (imobilizado)", alinhar: "direita", valor: (l) => l.imobilizado, render: (l) => <span className="tabular text-ink-700">{moeda(l.imobilizado)}</span> },
              { id: "venda", rotulo: "A preço de venda", alinhar: "direita", valor: (l) => l.venda, render: (l) => <span className="tabular font-bold text-ink-900">{moeda(l.venda)}</span> },
              { id: "lucro", rotulo: "Lucro em estoque", alinhar: "direita", valor: (l) => round2(l.venda - l.imobilizado), render: (l) => <span className="tabular text-way-700">{moeda(round2(l.venda - l.imobilizado))}</span> },
              { id: "ruptura", rotulo: "Em ruptura", alinhar: "direita", valor: (l) => l.ruptura, render: (l) => (l.ruptura ? <Badge tom="alerta">{l.ruptura}</Badge> : <span className="text-ink-300">—</span>) },
            ]}
            vazio="Sem estoque para a categoria filtrada."
          />
        )}
      </Card>

      <p className="mt-3 text-[11.5px] text-ink-400">
        {ROTULO_SITUACAO.saudavel === "Saudável" ? "" : ""}
        Números recalculados no navegador a partir dos documentos do período — importe para Excel/Sheets pelo CSV de cada aba.
      </p>
    </>
  );
}
