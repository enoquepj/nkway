"use client";

import { useMemo, useState } from "react";
import {
  Abas,
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Chip,
  FiltroMulti,
  FiltroPeriodo,
  FiltrosSalvos,
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
import { alternarItem, casaTexto, emPeriodo, type Periodo } from "@/lib/filtros";
import { FORMAS_PAGAMENTO, dataBR, hojeISO, moeda, round2 } from "@/lib/dominio";
import { baixarConta, excluirConta, lancarConta, moverVencimentos, reabrirConta } from "@/server/acoes/financeiro";
import type { listarContas } from "@/server/dados";

type Conta = Awaited<ReturnType<typeof listarContas>>[number];
const CATEGORIAS = ["Vendas", "Fornecedores", "Custos", "Impostos", "Obrigações", "Pessoal", "Outros"];

export function FinanceiroView({ contas }: { contas: Conta[] }) {
  const toast = useToast();
  const [aba, setAba] = useState<"todos" | "receber" | "pagar">("todos");
  const [busca, setBusca] = useState("");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [formas, setFormas] = useState<string[]>([]);
  const [situacoes, setSituacoes] = useState<string[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [minimo, setMinimo] = useState("");
  const [maximo, setMaximo] = useState("");
  const [novo, setNovo] = useState<null | { tipo: "receber" | "pagar"; descricao: string; categoria: string; contraparteNome: string; valor: string; vencimento: string; forma: string }>(null);
  const [baixando, setBaixando] = useState<Conta | null>(null);
  const [baixa, setBaixa] = useState({ valor: "", forma: "dinheiro", data: hojeISO() });
  const [ocupado, setOcupado] = useState(false);

  const filtro = { busca, categorias, formas, situacoes, inicio: periodo.inicio, fim: periodo.fim, minimo, maximo };
  const aplicar = (f: typeof filtro) => {
    setBusca(f.busca);
    setCategorias(f.categorias);
    setFormas(f.formas);
    setSituacoes(f.situacoes);
    setPeriodo({ inicio: f.inicio, fim: f.fim });
    setMinimo(f.minimo);
    setMaximo(f.maximo);
  };

  const linhas = useMemo(
    () =>
      contas.filter((c) => {
        if (aba !== "todos" && c.tipo !== aba) return false;
        if (!casaTexto(`${c.descricao} ${c.contraparteNome} ${c.categoria}`, busca)) return false;
        if (categorias.length && !categorias.includes(c.categoria)) return false;
        if (formas.length && !formas.includes(c.forma)) return false;
        const situacao = c.status === "paga" ? "paga" : c.atrasada ? "vencida" : "aberta";
        if (situacoes.length && !situacoes.includes(situacao)) return false;
        if ((periodo.inicio || periodo.fim) && !emPeriodo(c.vencimento, periodo)) return false;
        const vMin = Number(minimo.replace(",", ".")) || 0;
        const vMax = Number(maximo.replace(",", ".")) || 0;
        if (minimo && c.valor < vMin) return false;
        if (maximo && c.valor > vMax) return false;
        return true;
      }),
    [contas, aba, busca, categorias, formas, situacoes, periodo, minimo, maximo],
  );

  const soma = (tipo: string, apenasAberta = true) =>
    round2(contas.filter((c) => c.tipo === tipo && (!apenasAberta || c.status === "aberta")).reduce((s, c) => s + c.saldo, 0));
  const vencidas = contas.filter((c) => c.atrasada);
  const noFiltro = round2(linhas.reduce((s, c) => s + c.saldo, 0));

  const colunas: Coluna<Conta>[] = [
    {
      id: "descricao",
      rotulo: "Título",
      valor: (c) => c.descricao,
      render: (c) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-900">{c.descricao}</p>
          <p className="truncate text-[10.5px] text-ink-400">
            {c.contraparteNome || "sem contraparte"} · {c.categoria}
          </p>
        </div>
      ),
    },
    { id: "tipo", rotulo: "Fluxo", alinhar: "centro", valor: (c) => c.tipo, render: (c) => <Badge tom={c.tipo === "receber" ? "ok" : "alerta"}>{c.tipo === "receber" ? "a receber" : "a pagar"}</Badge> },
    {
      id: "vencimento",
      rotulo: "Vencimento",
      valor: (c) => c.vencimento,
      render: (c) => (
        <div className="leading-tight">
          <p className={cn("text-[12.5px] font-semibold", c.atrasada ? "text-rose-600" : "text-ink-800")}>{dataBR(c.vencimento)}</p>
          {c.pagoEm && <p className="text-[10px] text-way-700">liquidado {dataBR(c.pagoEm)}</p>}
        </div>
      ),
    },
    { id: "forma", rotulo: "Forma", alinhar: "centro", valor: (c) => c.forma, render: (c) => <span className="text-[11.5px] text-ink-500">{FORMAS_PAGAMENTO.find((f) => f.id === c.forma)?.label ?? c.forma ?? "—"}</span> },
    { id: "valor", rotulo: "Valor", alinhar: "direita", valor: (c) => c.valor, render: (c) => <span className="tabular text-[12.5px] text-ink-600">{moeda(c.valor)}</span> },
    { id: "pago", rotulo: "Baixado", alinhar: "direita", valor: (c) => c.valorPago, render: (c) => <span className="tabular text-[12px] text-ink-400">{moeda(c.valorPago)}</span> },
    {
      id: "saldo",
      rotulo: "Saldo",
      alinhar: "direita",
      valor: (c) => c.saldo,
      render: (c) => <span className={cn("tabular text-[13px] font-bold", c.tipo === "receber" ? "text-ink-900" : "text-rose-700")}>{moeda(c.saldo)}</span>,
    },
    {
      id: "status",
      rotulo: "Situação",
      alinhar: "centro",
      valor: (c) => c.status,
      render: (c) => <Badge tom={c.status === "paga" ? "ok" : c.atrasada ? "erro" : "neutro"}>{c.status === "paga" ? "quitada" : c.atrasada ? "vencida" : "em aberto"}</Badge>,
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (c) => (
        <div className="flex justify-end gap-1">
          {c.status !== "paga" ? (
            <Button tamanho="sm" variante="suave" onClick={() => { setBaixando(c); setBaixa({ valor: String(c.saldo), forma: c.forma || "dinheiro", data: hojeISO() }); }}>
              Baixar
            </Button>
          ) : (
            <button
              type="button"
              title="Reabrir"
              onClick={async () => {
                const r = await reabrirConta(c.id);
                toast(r.ok ? "Título reaberto." : r.erro, r.ok ? "ok" : "erro");
              }}
              className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
            >
              <Icon name="atualizar" className="size-4" />
            </button>
          )}
          <button
            type="button"
            title="Excluir"
            onClick={async () => {
              const r = await excluirConta(c.id);
              toast(r.ok ? "Título excluído." : r.erro, r.ok ? "ok" : "erro");
            }}
            className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
          >
            <Icon name="lixo" className="size-3.5" />
          </button>
        </div>
      ),
    },
  ];

  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...categorias.map((c) => ({ r: `categoria: ${c}`, limpar: () => setCategorias(categorias.filter((x) => x !== c)) })),
    ...formas.map((f) => ({ r: `forma: ${f}`, limpar: () => setFormas(formas.filter((x) => x !== f)) })),
    ...situacoes.map((s) => ({ r: `situação: ${s}`, limpar: () => setSituacoes(situacoes.filter((x) => x !== s)) })),
    ...(periodo.inicio || periodo.fim ? [{ r: `venc. ${periodo.inicio || "…"}→${periodo.fim || "…"}`, limpar: () => setPeriodo({ inicio: "", fim: "" }) }] : []),
  ];

  return (
    <>
      <PageHeader
        titulo="Financeiro"
        subtitulo="Contas a pagar e receber, baixa de títulos e provisão — gerado automaticamente por vendas a prazo e entradas de nota"
        acao={
          <Button
            icone="mais"
            onClick={() => setNovo({ tipo: aba === "pagar" ? "pagar" : "receber", descricao: "", categoria: "Outros", contraparteNome: "", valor: "", vencimento: hojeISO(), forma: "boleto" })}
          >
            Novo título
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="A receber" valor={moeda(soma("receber"))} tom="ok" icone="carteira" detalhe={`${contas.filter((c) => c.tipo === "receber" && c.status === "aberta").length} título(s) em aberto`} />
        <Kpi rotulo="A pagar" valor={moeda(soma("pagar"))} tom="alerta" icone="documento" detalhe={`${contas.filter((c) => c.tipo === "pagar" && c.status === "aberta").length} conta(s) no período`} />
        <Kpi rotulo="Vencidas" valor={String(vencidas.length)} tom={vencidas.length ? "erro" : "ok"} icone="alerta" detalhe={`${moeda(round2(vencidas.reduce((s, c) => s + c.saldo, 0)))} em atraso`} />
        <Kpi rotulo="Saldo projetado" valor={moeda(round2(soma("receber") - soma("pagar")))} tom={soma("receber") - soma("pagar") >= 0 ? "ok" : "erro"} icone="grafico" detalhe="recebimentos previstos menos despesas" />
      </div>

      <Abas
        abas={[
          { id: "todos", rotulo: "Todos", contagem: contas.length },
          { id: "receber", rotulo: "A receber", contagem: contas.filter((c) => c.tipo === "receber").length },
          { id: "pagar", rotulo: "A pagar", contagem: contas.filter((c) => c.tipo === "pagar").length },
        ]}
        atual={aba}
        aoTrocar={(i) => setAba(i as typeof aba)}
      />

      <BarraFiltros>
        <FiltroTexto rotulo="Busca" valor={busca} aoMudar={setBusca} placeholder="descrição, contraparte" largura="w-60" />
        <FiltroPeriodo rotulo="Vencimento" valor={periodo} aoMudar={setPeriodo} />
        <FiltroMulti rotulo="Categoria" opcoes={CATEGORIAS.map((c) => ({ valor: c, rotulo: c, contagem: contas.filter((x) => x.categoria === c).length }))} selecionados={categorias} aoAlternar={(v) => setCategorias(alternarItem(categorias, v))} />
        <FiltroMulti rotulo="Forma" opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} selecionados={formas} aoAlternar={(v) => setFormas(alternarItem(formas, v))} />
        <FiltroMulti
          rotulo="Situação"
          opcoes={[
            { valor: "aberta", rotulo: "Em aberto", contagem: contas.filter((c) => c.status === "aberta" && !c.atrasada).length },
            { valor: "vencida", rotulo: "Vencida", contagem: vencidas.length },
            { valor: "paga", rotulo: "Quitada", contagem: contas.filter((c) => c.status === "paga").length },
          ]}
          selecionados={situacoes}
          aoAlternar={(v) => setSituacoes(alternarItem(situacoes, v))}
        />
        <Campo rotulo="Saldo de" className="w-24">
          <Input dinheiro valor={minimo} aoMudar={setMinimo} placeholder="0,00" />
        </Campo>
        <Campo rotulo="até" className="w-24">
          <Input dinheiro valor={maximo} aoMudar={setMaximo} placeholder="0,00" />
        </Campo>
      </BarraFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Chip key={c.r} onClick={c.limpar}>
            {c.r}
          </Chip>
        ))}
        <Button tamanho="sm" variante="fantasma" onClick={() => aplicar({ busca: "", categorias: [], formas: [], situacoes: [], inicio: "", fim: "", minimo: "", maximo: "" })}>
          Limpar
        </Button>
        <Button
          tamanho="sm"
          variante="secundario"
          disabled={linhas.length === 0}
          onClick={async () => {
            const r = await moverVencimentos(linhas.filter((c) => c.status === "aberta").map((c) => c.id), 7);
            toast(r.ok ? (r.aviso ?? "Vencimentos adiados em 7 dias.") : r.erro, r.ok ? "ok" : "erro");
          }}
        >
          Adiar vencimentos em 7 dias
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="tabular text-[12px] text-ink-500">
            saldo no filtro <b className="font-bold text-ink-900">{moeda(noFiltro)}</b>
          </span>
          <FiltrosSalvos chave="financeiro" atual={filtro} aoAplicar={aplicar} />
        </div>
      </div>

      <Tabela colunas={colunas} linhas={linhas} chave={(c) => c.id} nomeExportar="nkway-financeiro" tamanhoPagina={20} vazio="Nenhum título neste filtro." />

      <Modal
        aberto={!!baixando}
        aoFechar={() => setBaixando(null)}
        titulo={baixando ? `Baixar título · ${baixando.descricao}` : ""}
        descricao="Aceita baixa parcial — o saldo restante continua em aberto"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setBaixando(null)}>
              Voltar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!baixando) return;
                setOcupado(true);
                const r = await baixarConta({ contaId: baixando.id, valor: Number(baixa.valor.replace(",", ".")) || baixando.saldo, forma: baixa.forma, data: baixa.data });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(r.aviso ?? "Baixa registrada.");
                setBaixando(null);
              }}
            >
              Confirmar baixa
            </Button>
          </>
        }
      >
        {baixando && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-[12px]">
              {[
                { r: "Valor", v: moeda(baixando.valor) },
                { r: "Já baixado", v: moeda(baixando.valorPago) },
                { r: "Saldo", v: moeda(baixando.saldo) },
              ].map((x) => (
                <div key={x.r} className="rounded-lg bg-ink-50 px-2.5 py-2">
                  <p className="micro text-ink-400">{x.r}</p>
                  <p className="tabular mt-0.5 font-bold text-ink-900">{x.v}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Valor da baixa">
                <Input dinheiro valor={baixa.valor} aoMudar={(v) => setBaixa({ ...baixa, valor: v })} />
              </Campo>
              <Campo rotulo="Forma">
                <Select valor={baixa.forma} aoMudar={(v) => setBaixa({ ...baixa, forma: v })} opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} />
              </Campo>
              <Campo rotulo="Data">
                <Input type="date" valor={baixa.data} aoMudar={(v) => setBaixa({ ...baixa, data: v })} />
              </Campo>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        aberto={!!novo}
        aoFechar={() => setNovo(null)}
        titulo="Lançar título manual"
        largura="max-w-lg"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setNovo(null)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!novo) return;
                setOcupado(true);
                const r = await lancarConta({
                  tipo: novo.tipo,
                  descricao: novo.descricao,
                  categoria: novo.categoria,
                  contraparteNome: novo.contraparteNome,
                  valor: Number(novo.valor.replace(",", ".")) || 0,
                  vencimento: novo.vencimento,
                  forma: novo.forma,
                });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(r.aviso ?? "Título lançado.");
                setNovo(null);
              }}
            >
              Salvar título
            </Button>
          </>
        }
      >
        {novo && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Tipo">
              <Select valor={novo.tipo} aoMudar={(v) => setNovo({ ...novo, tipo: v as "receber" | "pagar" })} opcoes={[{ valor: "receber", rotulo: "Conta a receber" }, { valor: "pagar", rotulo: "Conta a pagar" }]} />
            </Campo>
            <Campo rotulo="Categoria">
              <Select valor={novo.categoria} aoMudar={(v) => setNovo({ ...novo, categoria: v })} opcoes={CATEGORIAS.map((c) => ({ valor: c, rotulo: c }))} />
            </Campo>
            <Campo rotulo="Descrição" obrigatorio className="sm:col-span-2">
              <Input valor={novo.descricao} aoMudar={(v) => setNovo({ ...novo, descricao: v })} placeholder="ex.: taxa de maquininha" />
            </Campo>
            <Campo rotulo="Contraparte">
              <Input valor={novo.contraparteNome} aoMudar={(v) => setNovo({ ...novo, contraparteNome: v })} placeholder="quem paga / recebe" />
            </Campo>
            <Campo rotulo="Valor (R$)" obrigatorio>
              <Input dinheiro valor={novo.valor} aoMudar={(v) => setNovo({ ...novo, valor: v })} />
            </Campo>
            <Campo rotulo="Vencimento">
              <Input type="date" valor={novo.vencimento} aoMudar={(v) => setNovo({ ...novo, vencimento: v })} />
            </Campo>
            <Campo rotulo="Forma">
              <Select valor={novo.forma} aoMudar={(v) => setNovo({ ...novo, forma: v })} opcoes={FORMAS_PAGAMENTO.map((f) => ({ valor: f.id, rotulo: f.label }))} />
            </Campo>
          </div>
        )}
      </Modal>
    </>
  );
}
