"use client";

import Link from "next/link";
import { Badge, Button, Card, CardTitulo, Icon, Kpi, PageHeader, cn } from "@/components/ui";
import { Tabela, type Coluna } from "@/components/Tabela";
import { ROTULO_SITUACAO, diasAteTrial, moeda, planoById, round2 } from "@/lib/dominio";
import type { Painel } from "@/server/dados";

const DIAS_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function SerieBarras({ serie }: { serie: Painel["serie"] }) {
  const max = Math.max(1, ...serie.map((s) => s.total));
  return (
    <div>
      <div className="flex h-36 items-end gap-1">
        {serie.map((s, i) => {
          const h = (s.total / max) * 100;
          const ultimo = i === serie.length - 1;
          return (
            <div key={s.dia} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className={cn(
                  "w-full rounded-t-[3px] transition-all",
                  s.total === 0 ? "bg-ink-100" : ultimo ? "bg-way-500" : "bg-ink-700 group-hover:bg-way-600",
                )}
                style={{ height: `${Math.max(2, h)}%` }}
              />
              <span className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-1.5 py-1 text-[10.5px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                {moeda(s.total)} · {s.vendas} venda(s)
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {serie.map((s) => (
          <span key={s.dia} className="flex-1 text-center text-[9.5px] font-medium text-ink-300">
            {DIAS_SEMANA[new Date(`${s.dia}T12:00:00`).getDay()]}
          </span>
        ))}
      </div>
    </div>
  );
}

type Alerta = Painel["alertasEstoque"][number];
type UltDoc = Painel["ultimosDocumentos"][number];

export function DashboardView({
  dados,
  empresa,
}: {
  dados: Painel;
  empresa: { nome: string; fantasia: string; plano: string; trialUntil: string | null; uf: string; ambiente: string; entradasPendentes: number };
}) {
  const k = dados.kpis;
  const plano = planoById(empresa.plano);
  const dias = diasAteTrial(empresa.trialUntil);
  const hoje = new Date();
  const media7 = round2(dados.serie.slice(-7).reduce((s, d) => s + d.total, 0) / 7);
  const maxTop = Math.max(1, ...dados.topProdutos.map((t) => t.total));

  const colunasAlerta: Coluna<Alerta>[] = [
    {
      id: "nome",
      rotulo: "Produto",
      valor: (l) => l.nome,
      render: (l) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{l.nome}</p>
          <p className="font-mono text-[10.5px] text-ink-400">{l.sku}</p>
        </div>
      ),
    },
    { id: "est", rotulo: "Saldo", alinhar: "direita", valor: (l) => l.estoque, render: (l) => <span className="tabular font-semibold text-ink-900">{l.estoque}</span> },
    { id: "min", rotulo: "Mínimo", alinhar: "direita", valor: (l) => l.minimo, render: (l) => <span className="tabular text-ink-400">{l.minimo}</span> },
    {
      id: "sit",
      rotulo: "Situação",
      alinhar: "centro",
      valor: (l) => l.situacao,
      render: (l) => <Badge tom={l.situacao === "zerado" ? "erro" : l.situacao === "critico" ? "alerta" : "neutro"}>{ROTULO_SITUACAO[l.situacao]}</Badge>,
    },
    {
      id: "acao",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: () => (
        <Link href="/entradas" className="text-[11.5px] font-semibold text-way-700 hover:underline">
          Comprar
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo={`Bom dia, ${empresa.fantasia.split(" ")[0]}`}
        subtitulo={`${hoje.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · ${empresa.nome} (${empresa.uf})`}
        acao={
          <>
            <Link href="/entradas">
              <Button variante="secundario" icone="entrada">
                Lançar entrada
              </Button>
            </Link>
            <Link href="/pdv">
              <Button icone="caixa">Abrir PDV</Button>
            </Link>
          </>
        }
        etiquetas={
          <>
            <Badge tom={empresa.plano === "start" ? "neutro" : "ok"}>Plano {plano.nome}</Badge>
            {dias <= 14 && dias > 0 && <Badge tom="alerta">Trial termina em {dias} dia(s)</Badge>}
            {dias <= 0 && empresa.trialUntil && <Badge tom="erro">Trial encerrado — escolha um plano</Badge>}
            <Badge tom={empresa.ambiente === "1" ? "erro" : "info"}>
              {empresa.ambiente === "1" ? "Ambiente de produção" : "Ambiente de homologação"}
            </Badge>
            {empresa.entradasPendentes > 0 && (
              <Link href="/entradas" className="inline-flex">
                <Badge tom="alerta">{empresa.entradasPendentes} entrada(s) aguardando tratamento</Badge>
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          rotulo="Faturamento hoje"
          valor={moeda(k.hojeTotal)}
          tom="ok"
          icone="raio"
          detalhe={
            <span className="flex items-center gap-1.5">
              {k.hojeVendas} venda(s) · média 7d {moeda(media7)}/dia
            </span>
          }
        />
        <Kpi rotulo="Faturamento 14 dias" valor={moeda(k.totalPeriodo)} icone="grafico" detalhe={`${k.numeroVendas} notas · ticket ${moeda(k.ticket)}`} />
        <Kpi
          rotulo="A receber em aberto"
          valor={moeda(k.aReceber)}
          tom="info"
          icone="carteira"
          detalhe={`${k.vencidas} título(s) vencido(s) · ${k.aPagar > 0 ? `a pagar ${moeda(k.aPagar)}` : "sem contas a pagar"}`}
          barra={k.aPagar > 0 ? round2((k.aReceber / (k.aReceber + k.aPagar)) * 100) : 100}
        />
        <Kpi
          rotulo="Risco de ruptura"
          valor={String(dados.alertasEstoque.length)}
          tom={dados.alertasEstoque.length > 4 ? "erro" : "alerta"}
          icone="alerta"
          detalhe={`${k.produtosAtivos} produtos ativos · ${k.davsAbertos} DAV(s) em aberto`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardTitulo
            titulo="Faturamento diário"
            descricao="Últimos 14 dias — notas fiscais faturadas, cancelamentos excluídos"
            icone="grafico"
            acao={
              <Link href="/relatorios">
                <Button tamanho="sm" variante="fantasma" icone="seta">
                  Relatórios
                </Button>
              </Link>
            }
          />
          <SerieBarras serie={dados.serie} />
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-ink-100 pt-3">
            {[
              { r: "Dias com venda", v: String(dados.serie.filter((s) => s.vendas > 0).length) + " / 14" },
              { r: "Melhor dia", v: moeda(Math.max(...dados.serie.map((s) => s.total), 0)) },
              { r: "Saldo projetado", v: moeda(k.saldoCaixa), tom: k.saldoCaixa >= 0 ? "text-way-700" : "text-rose-600" },
            ].map((x) => (
              <div key={x.r}>
                <p className="micro text-ink-400">{x.r}</p>
                <p className={cn("tabular mt-0.5 text-[15px] font-bold text-ink-900", (x as { tom?: string }).tom)}>{x.v}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitulo titulo="Mais vendidos (14 dias)" descricao="Participação no faturamento por item" icone="etiqueta" />
          {dados.topProdutos.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-ink-400">Ainda sem vendas no período.</p>
          ) : (
            <ul className="space-y-2.5">
              {dados.topProdutos.map((t, i) => (
                <li key={t.nome}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="tabular w-4 shrink-0 text-[11px] font-bold text-ink-300">{i + 1}</span>
                      <span className="truncate text-[12.5px] font-semibold text-ink-800">{t.nome}</span>
                    </span>
                    <span className="tabular shrink-0 text-[12px] font-bold text-ink-900">{moeda(t.total)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full rounded-full bg-way-500" style={{ width: `${round2((t.total / maxTop) * 100)}%` }} />
                    </div>
                    <span className="tabular w-16 text-right text-[10.5px] text-ink-400">{t.qtd} un</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card padding={false}>
          <div className="p-4 pb-0">
            <CardTitulo
              titulo="Alertas de estoque"
              descricao="Saldo no ou abaixo do mínimo definido"
              icone="alerta"
              acao={
                <Link href="/estoque">
                  <Button tamanho="sm" variante="fantasma">
                    Ver posição
                  </Button>
                </Link>
              }
            />
          </div>
          <Tabela colunas={colunasAlerta} linhas={dados.alertasEstoque} chave={(l) => l.id} vazio="Nenhum produto abaixo do mínimo. Bom sinal." />
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardTitulo titulo="Últimos documentos" descricao="Vendas do PDV, DAVs e notas emitidas" icone="documento" />
            {dados.ultimosDocumentos.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-ink-400">Nenhum documento ainda — abra o PDV para vender.</p>
            ) : (
              <ul className="divide-y divide-ink-50">
                {dados.ultimosDocumentos.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset",
                        d.tipo === "dav" ? "bg-amber-50 text-amber-600 ring-amber-100" : d.status === "cancelado" ? "bg-rose-50 text-rose-600 ring-rose-100" : "bg-way-50 text-way-600 ring-way-100",
                      )}
                    >
                      <Icon name={d.tipo === "dav" ? "documento" : "caixa"} className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-ink-800">
                        {d.tipo === "dav" ? `DAV ${d.numero}` : `${d.modelo ?? "NFC-e"} ${d.numeroNota ?? "—"}`} · {d.cliente}
                      </p>
                      <p className="text-[11px] text-ink-400">
                        {new Date(d.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} ·{" "}
                        {d.status}
                      </p>
                    </div>
                    <span className="tabular shrink-0 text-[13px] font-bold text-ink-900">{moeda(d.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitulo titulo="DAVs a vencer" icone="documento" />
              {dados.davsAbertos.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-ink-400">Sem orçamentos em aberto.</p>
              ) : (
                <ul className="space-y-2">
                  {dados.davsAbertos.slice(0, 4).map((d) => {
                    const venc = d.validade && d.validade <= new Date().toISOString().slice(0, 10);
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50/70 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[12px] font-semibold text-ink-800">DAV {d.numero}</p>
                          <p className="truncate text-[10.5px] text-ink-400">{d.cliente}</p>
                        </div>
                        <div className="text-right">
                          <p className="tabular text-[12px] font-bold text-ink-900">{moeda(d.total)}</p>
                          <p className={cn("text-[10px] font-semibold", venc ? "text-rose-600" : "text-ink-400")}>
                            {venc ? "venceu" : `até ${d.validade?.split("-").reverse().join("/")}`}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href="/documentos" className="mt-2 block text-center text-[11.5px] font-semibold text-way-700 hover:underline">
                Faturar em nota
              </Link>
            </Card>

            <Card>
              <CardTitulo titulo="Financeiro apertado" icone="carteira" />
              {dados.contasVencidas.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-ink-400">Nenhum título vencido hoje.</p>
              ) : (
                <ul className="space-y-2">
                  {dados.contasVencidas.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-ink-800">{c.descricao}</p>
                        <p className="truncate text-[10.5px] text-ink-400">
                          {c.tipo === "pagar" ? "Pagar" : "Receber"} · {c.contraparte || "—"} · venc.{" "}
                          {c.vencimento.split("-").reverse().join("/")}
                        </p>
                      </div>
                      <span className={cn("tabular shrink-0 text-[12px] font-bold", c.tipo === "pagar" ? "text-rose-600" : "text-way-700")}>
                        {moeda(c.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/financeiro" className="mt-2 block text-center text-[11.5px] font-semibold text-way-700 hover:underline">
                Abrar financeiro
              </Link>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
