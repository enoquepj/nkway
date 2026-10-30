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
import { ROTULO_SITUACAO, moeda, num, round2 } from "@/lib/dominio";
import { ajustarEstoque, lancarInventario } from "@/server/acoes/estoque";
import type { listarKardex, posicaoEstoque } from "@/server/dados";

type Linha = Awaited<ReturnType<typeof posicaoEstoque>>[number];
type Mov = Awaited<ReturnType<typeof listarKardex>>[number];

const TIPO_MOV: Record<string, { rotulo: string; tom: "ok" | "erro" | "info" | "alerta" | "neutro" | "roxo" }> = {
  entrada: { rotulo: "Entrada", tom: "ok" },
  venda: { rotulo: "Venda", tom: "info" },
  ajuste: { rotulo: "Ajuste", tom: "alerta" },
  perda: { rotulo: "Perda", tom: "erro" },
  devolucao: { rotulo: "Devolução", tom: "roxo" },
  inventario: { rotulo: "Inventário", tom: "neutro" },
  transferencia: { rotulo: "Transferência", tom: "neutro" },
};

export function EstoqueView({
  posicao,
  movimentos,
  produtos,
}: {
  posicao: Linha[];
  movimentos: Mov[];
  produtos: { id: string; nome: string; estoque: number; estoqueMin: number; unidade: string; custo: number }[];
}) {
  const toast = useToast();
  const [aba, setAba] = useState("posicao");

  /* filtros da posição */
  const [busca, setBusca] = useState("");
  const [situacoes, setSituacoes] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [soComSaldo, setSoComSaldo] = useState(false);
  const filtroPosicao = { busca, situacoes, categorias, marcas, soComSaldo };
  const aplicarFiltro = (f: typeof filtroPosicao) => {
    setBusca(f.busca);
    setSituacoes(f.situacoes);
    setCategorias(f.categorias);
    setMarcas(f.marcas);
    setSoComSaldo(f.soComSaldo);
  };

  const linhas = useMemo(
    () =>
      posicao.filter((p) => {
        if (!casaTexto(`${p.nome} ${p.sku} ${p.gtin} ${p.marca}`, busca)) return false;
        if (situacoes.length && !situacoes.includes(p.situacao)) return false;
        if (categorias.length && !categorias.includes(p.categoria)) return false;
        if (marcas.length && !marcas.includes(p.marca)) return false;
        if (soComSaldo && p.estoque <= 0) return false;
        return true;
      }),
    [posicao, busca, situacoes, categorias, marcas, soComSaldo],
  );

  const valorImobilizado = round2(linhas.reduce((s, p) => s + p.valorTotal, 0));
  const potencialVenda = round2(linhas.reduce((s, p) => s + p.valorVenda, 0));
  const rupture = linhas.filter((p) => p.situacao === "zerado" || p.situacao === "critico").length;

  /* filtros do kardex */
  const [kBusca, setKBusca] = useState("");
  const [kTipos, setKTipos] = useState<string[]>([]);
  const [kPeriodo, setKPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [kDocumento, setKDocumento] = useState("");
  const movimentosFiltrados = useMemo(
    () =>
      movimentos.filter((m) => {
        if (!casaTexto(`${m.produtoNome} ${m.observacao} ${m.documento}`, kBusca)) return false;
        if (kTipos.length && !kTipos.includes(m.tipo)) return false;
        if (!casaTexto(m.documento, kDocumento)) return false;
        if ((kPeriodo.inicio || kPeriodo.fim) && !emPeriodo(m.data, kPeriodo)) return false;
        return true;
      }),
    [movimentos, kBusca, kTipos, kPeriodo, kDocumento],
  );

  /* ajuste e inventário */
  const [ajustando, setAjustando] = useState<Linha | null>(null);
  const [ajuste, setAjuste] = useState({ tipo: "ajuste", modo: "delta" as "delta" | "inventario", qtd: "", motivo: "" });
  const [ocupado, setOcupado] = useState(false);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [soDiferencas, setSoDiferencas] = useState(true);

  const colunasPosicao: Coluna<Linha>[] = [
    {
      id: "nome",
      rotulo: "Produto",
      valor: (p) => p.nome,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{p.nome}</p>
          <p className="font-mono text-[10px] text-ink-400">
            {p.sku} · {p.gtin} · {p.categoria}
          </p>
        </div>
      ),
    },
    { id: "marca", rotulo: "Marca", valor: (p) => p.marca, render: (p) => <span className="text-[12px] text-ink-500">{p.marca || "—"}</span> },
    {
      id: "saldo",
      rotulo: "Saldo",
      alinhar: "direita",
      valor: (p) => p.estoque,
      render: (p) => (
        <div className="leading-tight">
          <p className={cn("tabular text-[13px] font-bold", p.estoque <= 0 ? "text-rose-600" : p.estoque <= p.estoqueMin ? "text-amber-600" : "text-ink-900")}>
            {num(p.estoque)} {p.unidade}
          </p>
          <p className="tabular text-[10px] text-ink-400">mín. {num(p.estoqueMin)}</p>
        </div>
      ),
    },
    { id: "custo", rotulo: "Custo médio", alinhar: "direita", valor: (p) => p.custoMedio, render: (p) => <span className="tabular text-[12px] text-ink-600">{moeda(p.custoMedio)}</span> },
    { id: "valor", rotulo: "Imobilizado", alinhar: "direita", valor: (p) => p.valorTotal, render: (p) => <span className="tabular text-[12.5px] font-semibold text-ink-800">{moeda(p.valorTotal)}</span> },
    { id: "venda", rotulo: "A valor de venda", alinhar: "direita", valor: (p) => p.valorVenda, render: (p) => <span className="tabular text-[12px] text-way-700">{moeda(p.valorVenda)}</span> },
    {
      id: "margem",
      rotulo: "Margem",
      alinhar: "direita",
      valor: (p) => p.margem,
      render: (p) => <span className={cn("tabular text-[12px] font-semibold", p.margem < 15 ? "text-amber-600" : "text-ink-600")}>{p.margem.toFixed(1)}%</span>,
    },
    {
      id: "situacao",
      rotulo: "Situação",
      alinhar: "centro",
      valor: (p) => p.situacao,
      render: (p) => <Badge tom={p.situacao === "zerado" ? "erro" : p.situacao === "critico" ? "alerta" : p.situacao === "baixo" ? "alerta" : "ok"}>{ROTULO_SITUACAO[p.situacao]}</Badge>,
    },
    {
      id: "acao",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (p) => (
        <Button tamanho="sm" variante="fantasma" icone="atualizar" onClick={() => { setAjustando(p); setAjuste({ tipo: "ajuste", modo: "delta", qtd: "", motivo: "" }); }}>
          Ajustar
        </Button>
      ),
    },
  ];

  const colunasKardex: Coluna<Mov>[] = [
    { id: "data", rotulo: "Data", valor: (m) => m.data, render: (m) => <span className="tabular text-[11.5px] text-ink-500">{new Date(m.data).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span> },
    {
      id: "produto",
      rotulo: "Produto",
      valor: (m) => m.produtoNome,
      render: (m) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium text-ink-800">{m.produtoNome}</p>
          {m.observacao && <p className="truncate text-[10.5px] text-ink-400">{m.observacao}</p>}
        </div>
      ),
    },
    { id: "tipo", rotulo: "Movimento", alinhar: "centro", valor: (m) => m.tipo, render: (m) => <Badge tom={TIPO_MOV[m.tipo]?.tom ?? "neutro"}>{TIPO_MOV[m.tipo]?.rotulo ?? m.tipo}</Badge> },
    {
      id: "qtd",
      rotulo: "Qtd",
      alinhar: "direita",
      valor: (m) => m.qtd,
      render: (m) => <span className={cn("tabular text-[12.5px] font-bold", m.qtd > 0 ? "text-way-700" : "text-rose-600")}>{m.qtd > 0 ? "+" : ""}{num(m.qtd)}</span>,
    },
    { id: "saldo", rotulo: "Saldo após", alinhar: "direita", valor: (m) => m.saldoApos, render: (m) => <span className="tabular text-[12.5px] font-semibold text-ink-800">{num(m.saldoApos)}</span> },
    { id: "custo", rotulo: "Custo unit.", alinhar: "direita", valor: (m) => m.custoUnit, render: (m) => <span className="tabular text-[12px] text-ink-500">{moeda(m.custoUnit)}</span> },
    { id: "medio", rotulo: "Custo médio", alinhar: "direita", valor: (m) => m.custoMedioApos, render: (m) => <span className="tabular text-[12px] text-ink-500">{moeda(m.custoMedioApos)}</span> },
    { id: "doc", rotulo: "Documento", valor: (m) => m.documento, render: (m) => <span className="text-[11.5px] text-ink-500">{m.documento || "—"}</span> },
  ];

  return (
    <>
      <PageHeader
        titulo="Gestão de estoque"
        subtitulo="Posição com custo médio ponderado, kardex auditável e inventário em lote"
        acao={
          <>
            <Badge tom="info">{linhas.length} produto(s) no filtro</Badge>
            {rupture > 0 && <Badge tom="alerta">{rupture} em risco de ruptura</Badge>}
          </>
        }
      />

      <Abas
        abas={[
          { id: "posicao", rotulo: "Posição atual", contagem: posicao.length },
          { id: "kardex", rotulo: "Kardex", contagem: movimentos.length },
          { id: "inventario", rotulo: "Inventário" },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      {aba === "posicao" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi rotulo="Valor imobilizado" valor={moeda(valorImobilizado)} icone="caixaEstoque" tom="ok" detalhe={`${linhas.length} itens no filtro`} />
            <Kpi rotulo="Potencial de venda" valor={moeda(potencialVenda)} icone="grafico" detalhe={`lucro potencial ${moeda(round2(potencialVenda - valorImobilizado))}`} />
            <Kpi rotulo="Ruptura / crítico" valor={String(rupture)} tom={rupture > 0 ? "erro" : "ok"} icone="alerta" detalhe="saldo zerado ou abaixo de 50% do mínimo" />
            <Kpi
              rotulo="Cobertura média"
              valor={`${round2(linhas.reduce((s, p) => s + (p.estoqueMin > 0 ? p.estoque / p.estoqueMin : 1), 0) / Math.max(1, linhas.length))} x`}
              icone="raio"
              detalhe="saldo atual sobre o mínimo"
            />
          </div>

          <BarraFiltros>
            <FiltroTexto rotulo="Buscar produto" valor={busca} aoMudar={setBusca} placeholder="nome, SKU ou GTIN" largura="w-64" />
            <FiltroMulti
              rotulo="Situação"
              opcoes={["zerado", "critico", "baixo", "saudavel"].map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s as keyof typeof ROTULO_SITUACAO], contagem: posicao.filter((p) => p.situacao === s).length }))}
              selecionados={situacoes}
              aoAlternar={(v) => setSituacoes(alternarItem(situacoes, v))}
            />
            <FiltroMulti rotulo="Categoria" opcoes={[...new Set(posicao.map((p) => p.categoria))].sort().map((c) => ({ valor: c, rotulo: c, contagem: posicao.filter((p) => p.categoria === c).length }))} selecionados={categorias} aoAlternar={(v) => setCategorias(alternarItem(categorias, v))} />
            <FiltroMulti rotulo="Marca" opcoes={[...new Set(posicao.map((p) => p.marca).filter(Boolean))].sort().map((m) => ({ valor: m, rotulo: m, contagem: posicao.filter((p) => p.marca === m).length }))} selecionados={marcas} aoAlternar={(v) => setMarcas(alternarItem(marcas, v))} />
            <label className="flex items-center gap-1.5 pb-1.5 text-[12px] font-medium text-ink-500">
              <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} className="size-3.5 accent-way-600" />
              Só com saldo
            </label>
            <div className="ml-auto flex items-center gap-2">
              <FiltrosSalvos chave="estoque-posicao" atual={filtroPosicao} aoAplicar={aplicarFiltro} />
            </div>
          </BarraFiltros>

          <Tabela colunas={colunasPosicao} linhas={linhas} chave={(p) => p.id} nomeExportar="nkway-estoque" tamanhoPagina={20} vazio="Nenhum produto com esses filtros." />
        </>
      )}

      {aba === "kardex" && (
        <>
          <BarraFiltros>
            <FiltroTexto rotulo="Produto ou observação" valor={kBusca} aoMudar={setKBusca} placeholder="ex.: arroz" largura="w-56" />
            <FiltroTexto rotulo="Documento" valor={kDocumento} aoMudar={setKDocumento} placeholder="NF 1204, Nº 88, Inventário" largura="w-48" />
            <FiltroPeriodo valor={kPeriodo} aoMudar={setKPeriodo} />
            <FiltroMulti rotulo="Tipo" opcoes={Object.entries(TIPO_MOV).slice(0, 6).map(([k, v]) => ({ valor: k, rotulo: v.rotulo, contagem: movimentos.filter((m) => m.tipo === k).length }))} selecionados={kTipos} aoAlternar={(v) => setKTipos(alternarItem(kTipos, v))} />
            <div className="ml-auto flex items-center gap-1.5">
              {kTipos.map((t) => (
                <Chip key={t} onClick={() => setKTipos(kTipos.filter((x) => x !== t))}>
                  {TIPO_MOV[t]?.rotulo ?? t}
                </Chip>
              ))}
              <Button tamanho="sm" variante="fantasma" onClick={() => { setKBusca(""); setKTipos([]); setKPeriodo({ inicio: "", fim: "" }); setKDocumento(""); }}>
                Limpar
              </Button>
            </div>
          </BarraFiltros>
          <Tabela colunas={colunasKardex} linhas={movimentosFiltrados} chave={(m) => m.id} nomeExportar="nkway-kardex" tamanhoPagina={25} alturaFixa vazio="Nenhum movimento neste filtro." />
        </>
      )}

      {aba === "inventario" && (
        <Inventario
          produtos={produtos}
          soDiferencas={soDiferencas}
          setSoDiferencas={setSoDiferencas}
          contagem={contagem}
          setContagem={setContagem}
          ocupado={ocupado}
          setOcupado={setOcupado}
          toast={toast}
        />
      )}

      <Modal
        aberto={!!ajustando}
        aoFechar={() => setAjustando(null)}
        titulo={ajustando ? `Ajustar saldo · ${ajustando.nome}` : ""}
        descricao="Todo ajuste gera lançamento no kardex com o motivo informado"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setAjustando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!ajustando) return;
                setOcupado(true);
                const r = await ajustarEstoque({
                  produtoId: ajustando.id,
                  tipo: ajuste.tipo as "ajuste" | "perda" | "devolucao" | "inventario",
                  qtd: Number(ajuste.qtd.replace(",", ".")) || 0,
                  motivo: ajuste.motivo,
                  modo: ajuste.modo,
                });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(r.aviso ?? "Saldo ajustado.");
                setAjustando(null);
              }}
            >
              Aplicar ajuste
            </Button>
          </>
        }
      >
        {ajustando && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3 py-2 text-[12.5px]">
              <span className="text-ink-500">Saldo atual</span>
              <span className="tabular font-bold text-ink-900">
                {num(ajustando.estoque)} {ajustando.unidade}
              </span>
            </div>
            <Campo rotulo="Tipo de movimento">
              <Select
                valor={ajuste.tipo}
                aoMudar={(v) => setAjuste({ ...ajuste, tipo: v })}
                opcoes={[
                  { valor: "ajuste", rotulo: "Ajuste (quebra, sobra)" },
                  { valor: "perda", rotulo: "Perda / avaria" },
                  { valor: "devolucao", rotulo: "Devolução a fornecedor" },
                  { valor: "inventario", rotulo: "Contagem de inventário" },
                ]}
              />
            </Campo>
            <Campo rotulo="Como informar">
              <div className="flex rounded-lg bg-ink-50 p-0.5">
                {[
                  { id: "delta", r: "Diferença (+/-)" },
                  { id: "inventario", r: "Novo saldo" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAjuste({ ...ajuste, modo: m.id as "delta" | "inventario" })}
                    className={cn("flex-1 rounded px-2 py-1.5 text-[12px] font-semibold transition", ajuste.modo === m.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-400")}
                  >
                    {m.r}
                  </button>
                ))}
              </div>
            </Campo>
            <Campo rotulo={ajuste.modo === "delta" ? "Quantidade (use - para saída)" : "Contagem física"}>
              <Input dinheiro valor={ajuste.qtd} aoMudar={(v) => setAjuste({ ...ajuste, qtd: v })} placeholder="-2" />
            </Campo>
            <Campo rotulo="Motivo" obrigatorio>
              <Input valor={ajuste.motivo} aoMudar={(v) => setAjuste({ ...ajuste, motivo: v })} placeholder="ex.: produto vencido na gôndola" />
            </Campo>
          </div>
        )}
      </Modal>
    </>
  );
}

function Inventario({
  produtos,
  soDiferencas,
  setSoDiferencas,
  contagem,
  setContagem,
  ocupado,
  setOcupado,
  toast,
}: {
  produtos: { id: string; nome: string; estoque: number; estoqueMin: number; unidade: string; custo: number }[];
  soDiferencas: boolean;
  setSoDiferencas: (v: boolean) => void;
  contagem: Record<string, string>;
  setContagem: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  ocupado: boolean;
  setOcupado: (v: boolean) => void;
  toast: (t: string, tom?: "ok" | "erro" | "info") => void;
}) {
  const linhas = produtos
    .map((p) => {
      const digitado = contagem[p.id];
      const nova = digitado === undefined ? null : Number(String(digitado).replace(",", ".")) || 0;
      return { ...p, nova, delta: nova === null ? 0 : round2(nova - p.estoque), impacto: round2((nova ?? p.estoque - p.estoque) * p.custo) };
    })
    .filter((l) => (soDiferencas ? l.delta !== 0 : true));

  const pendentes = produtos.filter((p) => contagem[p.id] !== undefined);
  const diferencaValor = round2(pendentes.reduce((s, p) => s + ((Number(String(contagem[p.id]).replace(",", ".")) || 0) - p.estoque) * p.custo, 0));

  return (
    <Card padding={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-3">
        <div className="flex items-center gap-3">
          <p className="text-[13px] font-semibold text-ink-800">
            Contagem física · {pendentes.length} digitado(s) de {produtos.length}
          </p>
          <label className="flex items-center gap-1.5 text-[12px] font-medium text-ink-500">
            <input type="checkbox" checked={soDiferencas} onChange={(e) => setSoDiferencas(e.target.checked)} className="size-3.5 accent-way-600" />
            Mostrar só diferenças
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("tabular text-[12px] font-semibold", diferencaValor < 0 ? "text-rose-600" : diferencaValor > 0 ? "text-way-700" : "text-ink-400")}>
            {diferencaValor > 0 ? "+" : ""}
            {moeda(diferencaValor)} de diferença no custo
          </span>
          <Button
            disabled={ocupado || pendentes.length === 0}
            icone="check"
            onClick={async () => {
              setOcupado(true);
              const r = await lancarInventario(
                pendentes.map((p) => ({
                  produtoId: p.id,
                  quantidade: Number(String(contagem[p.id]).replace(",", ".")) || 0,
                  observacao: "Inventário digitado no NKWAY",
                })),
              );
              setOcupado(false);
              if (!r.ok) return toast(r.erro, "erro");
              toast(`${r.ajustados} produto(s) ajustados pelo inventário.`);
              setContagem({});
            }}
          >
            Aplicar contagem
          </Button>
        </div>
      </div>
      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-ink-50">
            <tr className="text-left">
              {["Produto", "Saldo sistema", "Contagem", "Diferença", "Impacto no custo"].map((h) => (
                <th key={h} className="micro px-3 py-2 text-ink-400">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.id} className={cn("border-t border-ink-50", p.delta !== 0 && "bg-amber-50/40")}>
                <td className="max-w-[280px] px-3 py-1.5">
                  <p className="truncate font-semibold text-ink-800">{p.nome}</p>
                  <p className="text-[10px] text-ink-400">
                    mín. {num(p.estoqueMin)} · saldo atual pode estar {p.estoque <= p.estoqueMin ? "baixo" : "ok"}
                  </p>
                </td>
                <td className="tabular px-3 py-1.5 text-ink-600">
                  {num(p.estoque)} {p.unidade}
                </td>
                <td className="px-3 py-1.5">
                  <input
                    value={contagem[p.id] ?? ""}
                    onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                    placeholder="—"
                    inputMode="decimal"
                    className="tabular w-24 rounded-lg px-2 py-1 text-right ring-1 ring-inset ring-ink-200 outline-none focus:ring-2 focus:ring-way-500"
                  />
                </td>
                <td className={cn("tabular px-3 py-1.5 font-semibold", p.delta > 0 ? "text-way-700" : p.delta < 0 ? "text-rose-600" : "text-ink-300")}>
                  {p.delta === 0 ? "—" : `${p.delta > 0 ? "+" : ""}${num(p.delta)}`}
                </td>
                <td className="tabular px-3 py-1.5 text-ink-600">{p.delta === 0 ? "—" : moeda(round2(p.delta * p.custo))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 border-t border-ink-100 px-3 py-2 text-[11.5px] text-ink-400">
        <Icon name="alerta" className="size-3.5 text-signal-500" />
        Cada linha aplicada gera um movimento “Inventário” no kardex — o saldo anterior continua auditável.
      </p>
    </Card>
  );
}
