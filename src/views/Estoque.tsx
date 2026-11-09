"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { calcularIndicadores, lerQuantidade, PARAMETROS_PADRAO, resumirExtrato, ROTULO_REPOSICAO, type IndicadorProduto, type VendaAgregada } from "@/lib/estoqueIndicadores";
import { ajustarEstoque, lancarInventario } from "@/server/acoes/estoque";
import type { listarKardex, posicaoEstoque } from "@/server/dados";

type Linha = Awaited<ReturnType<typeof posicaoEstoque>>[number];
type Mov = Awaited<ReturnType<typeof listarKardex>>[number];
type LinhaPosicao = Linha & { ind: IndicadorProduto };

const TIPO_MOV: Record<string, { rotulo: string; tom: "ok" | "erro" | "info" | "alerta" | "neutro" | "roxo" }> = {
  entrada: { rotulo: "Entrada", tom: "ok" },
  venda: { rotulo: "Venda", tom: "info" },
  ajuste: { rotulo: "Ajuste", tom: "alerta" },
  perda: { rotulo: "Perda", tom: "erro" },
  devolucao: { rotulo: "Devolução", tom: "roxo" },
  inventario: { rotulo: "Inventário", tom: "neutro" },
  transferencia: { rotulo: "Transferência", tom: "neutro" },
};

const dataCurta = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

export function EstoqueView({
  posicao,
  movimentos,
  produtos,
  vendasRecentes = [],
  podeAjustar = true,
}: {
  posicao: Linha[];
  movimentos: Mov[];
  produtos: { id: string; nome: string; sku: string; gtin: string; categoria: string; localizacao: string; estoque: number; estoqueMin: number; unidade: string; custo: number }[];
  vendasRecentes?: VendaAgregada[];
  podeAjustar?: boolean;
}) {
  const toast = useToast();
  const [aba, setAba] = useState("posicao");

  /* ------------------------------------------------------------ indicadores (giro, cobertura, ABC, reposição) */
  const indicadores = useMemo(() => calcularIndicadores(posicao.map((p) => ({ id: p.id, estoque: p.estoque, estoqueMin: p.estoqueMin, custo: p.custoMedio, preco: p.preco, ativo: p.ativo })), vendasRecentes), [posicao, vendasRecentes]);
  const posicaoRica = useMemo<LinhaPosicao[]>(() => posicao.map((p) => ({ ...p, ind: indicadores.get(p.id)! })), [posicao, indicadores]);

  /* ------------------------------------------------------------ filtros da posição */
  const [busca, setBusca] = useState("");
  const [situacoes, setSituacoes] = useState<string[]>([]);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [abc, setAbc] = useState<string[]>([]);
  const [reposicao, setReposicao] = useState<string[]>([]);
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [soParados, setSoParados] = useState(false);
  const filtroPosicao = { busca, situacoes, categorias, marcas, abc, reposicao, soComSaldo, soParados };
  const aplicarFiltro = (f: typeof filtroPosicao) => {
    setBusca(f.busca); setSituacoes(f.situacoes); setCategorias(f.categorias); setMarcas(f.marcas);
    setAbc(f.abc ?? []); setReposicao(f.reposicao ?? []); setSoComSaldo(f.soComSaldo); setSoParados(f.soParados ?? false);
  };
  const linhas = useMemo(
    () => posicaoRica.filter((p) => {
      if (!casaTexto(`${p.nome} ${p.sku} ${p.gtin} ${p.marca} ${p.localizacao}`, busca)) return false;
      if (situacoes.length && !situacoes.includes(p.situacao)) return false;
      if (categorias.length && !categorias.includes(p.categoria)) return false;
      if (marcas.length && !marcas.includes(p.marca)) return false;
      if (abc.length && !abc.includes(p.ind.classeAbc)) return false;
      if (reposicao.length && !reposicao.includes(p.ind.situacaoReposicao)) return false;
      if (soComSaldo && p.estoque <= 0) return false;
      if (soParados && !p.ind.parado) return false;
      return true;
    }),
    [posicaoRica, busca, situacoes, categorias, marcas, abc, reposicao, soComSaldo, soParados],
  );

  const valorImobilizado = round2(linhas.reduce((s, p) => s + p.valorTotal, 0));
  const potencialVenda = round2(linhas.reduce((s, p) => s + p.valorVenda, 0));
  const rupture = linhas.filter((p) => p.situacao === "zerado" || p.situacao === "critico").length;
  const parados = linhas.filter((p) => p.ind.parado);
  const valorParado = round2(parados.reduce((s, p) => s + p.valorTotal, 0));
  const comCobertura = linhas.filter((p) => p.ind.coberturaDias !== null);
  const coberturaMediana = useMemo(() => {
    const v = comCobertura.map((p) => p.ind.coberturaDias as number).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [comCobertura]);

  /* ------------------------------------------------------------ kardex */
  const [kBusca, setKBusca] = useState("");
  const [kTipos, setKTipos] = useState<string[]>([]);
  const [kPeriodo, setKPeriodo] = useState<Periodo>({ inicio: "", fim: "" });
  const [kDocumento, setKDocumento] = useState("");
  const [kUsuario, setKUsuario] = useState<string[]>([]);
  const [kProdutoId, setKProdutoId] = useState("");
  const usuariosKardex = useMemo(() => [...new Set(movimentos.map((m) => m.usuarioNome).filter(Boolean))].sort(), [movimentos]);
  const movimentosFiltrados = useMemo(
    () => movimentos.filter((m) => {
      if (kProdutoId && m.produtoId !== kProdutoId) return false;
      if (!casaTexto(`${m.produtoNome} ${m.observacao}`, kBusca)) return false;
      if (kDocumento && !casaTexto(m.documento, kDocumento)) return false;
      if (kTipos.length && !kTipos.includes(m.tipo)) return false;
      if (kUsuario.length && !kUsuario.includes(m.usuarioNome)) return false;
      if (!emPeriodo(m.data, kPeriodo)) return false;
      return true;
    }),
    [movimentos, kProdutoId, kBusca, kDocumento, kTipos, kUsuario, kPeriodo],
  );
  const extrato = useMemo(() => (kProdutoId ? resumirExtrato(movimentosFiltrados) : null), [kProdutoId, movimentosFiltrados]);
  const produtoExtrato = kProdutoId ? posicao.find((p) => p.id === kProdutoId) : null;
  const abrirExtrato = (produtoId: string) => { setKProdutoId(produtoId); setKBusca(""); setKTipos([]); setKDocumento(""); setKUsuario([]); setAba("kardex"); };

  /* ------------------------------------------------------------ ajuste pontual */
  const [ajustando, setAjustando] = useState<Linha | null>(null);
  const [ajuste, setAjuste] = useState({ tipo: "ajuste", modo: "delta" as "delta" | "inventario", qtd: "", motivo: "" });
  const [ocupado, setOcupado] = useState(false);

  /* ------------------------------------------------------------ colunas */
  const colunasPosicao: Coluna<LinhaPosicao>[] = [
    {
      id: "nome", rotulo: "Produto", valor: (p) => p.nome,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{p.nome}</p>
          <p className="font-mono text-[10px] text-ink-400">{p.sku} · {p.gtin} · {p.categoria}{p.localizacao ? ` · ${p.localizacao}` : ""}</p>
        </div>
      ),
    },
    {
      id: "saldo", rotulo: "Saldo", alinhar: "direita", valor: (p) => p.estoque,
      render: (p) => (
        <div className="leading-tight">
          <p className={cn("tabular text-[13px] font-bold", p.estoque <= 0 ? "text-rose-600" : p.estoque <= p.estoqueMin ? "text-amber-600" : "text-ink-900")}>{num(p.estoque)} {p.unidade}</p>
          <p className="tabular text-[10px] text-ink-400">mín. {num(p.estoqueMin)}</p>
        </div>
      ),
    },
    {
      id: "giro", rotulo: "Saída 30d", alinhar: "direita", valor: (p) => p.ind.mediaDiaria30 * 30,
      render: (p) => (
        <div className="leading-tight">
          <p className="tabular text-[12px] text-ink-700">{num(round2(p.ind.mediaDiaria30 * 30))}</p>
          <p className="tabular text-[10px] text-ink-400">{p.ind.mediaDiaria30 > 0 ? `${num(p.ind.mediaDiaria30)}/dia` : p.ind.diasSemVenda !== null ? `${p.ind.diasSemVenda}d sem venda` : "sem venda"}</p>
        </div>
      ),
    },
    {
      id: "cobertura", rotulo: "Cobertura", alinhar: "direita", valor: (p) => p.ind.coberturaDias ?? 9999,
      render: (p) => p.ind.coberturaDias === null ? <span className="text-[11px] text-ink-300">—</span> : <span className={cn("tabular text-[12.5px] font-semibold", p.ind.coberturaDias < PARAMETROS_PADRAO.leadTimeDias ? "text-rose-600" : p.ind.coberturaDias < PARAMETROS_PADRAO.diasCobertura + PARAMETROS_PADRAO.leadTimeDias ? "text-amber-600" : "text-ink-700")}>{p.ind.coberturaDias} d</span>,
    },
    { id: "abc", rotulo: "ABC", alinhar: "centro", valor: (p) => p.ind.classeAbc, render: (p) => <Badge tom={p.ind.classeAbc === "A" ? "ok" : p.ind.classeAbc === "B" ? "info" : "neutro"} mono>{p.ind.classeAbc}</Badge> },
    { id: "custo", rotulo: "Custo médio", alinhar: "direita", valor: (p) => p.custoMedio, render: (p) => <span className="tabular text-[12px] text-ink-600">{moeda(p.custoMedio)}</span> },
    { id: "valor", rotulo: "Imobilizado", alinhar: "direita", valor: (p) => p.valorTotal, render: (p) => <span className="tabular text-[12.5px] font-semibold text-ink-800">{moeda(p.valorTotal)}</span> },
    { id: "margem", rotulo: "Margem", alinhar: "direita", valor: (p) => p.margem, render: (p) => <span className={cn("tabular text-[12px] font-semibold", p.margem < 15 ? "text-amber-600" : "text-ink-600")}>{p.margem.toFixed(1)}%</span> },
    {
      id: "reposicao", rotulo: "Reposição", alinhar: "centro", valor: (p) => p.ind.situacaoReposicao,
      render: (p) => <Badge tom={ROTULO_REPOSICAO[p.ind.situacaoReposicao].tom}>{ROTULO_REPOSICAO[p.ind.situacaoReposicao].rotulo}</Badge>,
    },
    {
      id: "acao", rotulo: "", alinhar: "direita", ocultoNoCsv: true,
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button tamanho="sm" variante="fantasma" icone="documento" onClick={() => abrirExtrato(p.id)} title="Extrato do kardex deste produto">Extrato</Button>
          {podeAjustar && <Button tamanho="sm" variante="fantasma" icone="atualizar" onClick={() => { setAjustando(p); setAjuste({ tipo: "ajuste", modo: "delta", qtd: "", motivo: "" }); }}>Ajustar</Button>}
        </div>
      ),
    },
  ];

  const colunasKardex: Coluna<Mov>[] = [
    { id: "data", rotulo: "Data", valor: (m) => m.data, render: (m) => <span className="tabular text-[11.5px] text-ink-500">{dataCurta(m.data)}</span> },
    {
      id: "produto", rotulo: "Produto", valor: (m) => m.produtoNome,
      render: (m) => (
        <div className="min-w-0">
          <button type="button" className="truncate text-left text-[12.5px] font-medium text-ink-800 hover:text-way-700 hover:underline" onClick={() => abrirExtrato(m.produtoId)} title="Ver extrato deste produto">{m.produtoNome}</button>
          {m.observacao && <p className="truncate text-[10.5px] text-ink-400">{m.observacao}</p>}
        </div>
      ),
    },
    { id: "tipo", rotulo: "Movimento", alinhar: "centro", valor: (m) => m.tipo, render: (m) => <Badge tom={TIPO_MOV[m.tipo]?.tom ?? "neutro"}>{TIPO_MOV[m.tipo]?.rotulo ?? m.tipo}</Badge> },
    { id: "qtd", rotulo: "Qtd", alinhar: "direita", valor: (m) => m.qtd, render: (m) => <span className={cn("tabular text-[12.5px] font-bold", m.qtd > 0 ? "text-way-700" : "text-rose-600")}>{m.qtd > 0 ? "+" : ""}{num(m.qtd)}</span> },
    { id: "saldo", rotulo: "Saldo após", alinhar: "direita", valor: (m) => m.saldoApos, render: (m) => <span className="tabular text-[12.5px] font-semibold text-ink-800">{num(m.saldoApos)}</span> },
    { id: "custo", rotulo: "Custo unit.", alinhar: "direita", valor: (m) => m.custoUnit, render: (m) => <span className="tabular text-[12px] text-ink-500">{moeda(m.custoUnit)}</span> },
    { id: "medio", rotulo: "Custo médio", alinhar: "direita", valor: (m) => m.custoMedioApos, render: (m) => <span className="tabular text-[12px] text-ink-500">{moeda(m.custoMedioApos)}</span> },
    { id: "doc", rotulo: "Documento", valor: (m) => m.documento, render: (m) => <span className="text-[11.5px] text-ink-500">{m.documento || "—"}</span> },
    { id: "usuario", rotulo: "Usuário", valor: (m) => m.usuarioNome, render: (m) => <span className="text-[11.5px] text-ink-500">{m.usuarioNome || "—"}</span> },
  ];

  const aReporTodos = posicaoRica.filter((p) => p.ativo && p.ind.sugestaoCompra > 0 && (p.ind.situacaoReposicao === "ruptura" || p.ind.situacaoReposicao === "repor" || p.ind.situacaoReposicao === "atencao"));

  return (
    <>
      <PageHeader
        titulo="Gestão de estoque"
        subtitulo="Posição com custo médio, giro e cobertura · kardex auditável por produto · reposição sugerida · inventário por contagem"
        acao={
          <>
            <Badge tom="info">{linhas.length} produto(s) no filtro</Badge>
            {rupture > 0 && <Badge tom="alerta">{rupture} em risco de ruptura</Badge>}
            {aReporTodos.length > 0 && <Badge tom="erro">{aReporTodos.length} a repor</Badge>}
          </>
        }
      />

      <Abas
        abas={[
          { id: "posicao", rotulo: "Posição atual", contagem: posicao.length },
          { id: "reposicao", rotulo: "Reposição", contagem: aReporTodos.length },
          { id: "kardex", rotulo: "Kardex", contagem: movimentos.length },
          { id: "inventario", rotulo: "Inventário" },
        ]}
        atual={aba}
        aoTrocar={setAba}
      />

      {aba === "posicao" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Kpi rotulo="Valor imobilizado" valor={moeda(valorImobilizado)} icone="caixaEstoque" tom="ok" detalhe={`${linhas.length} itens no filtro`} />
            <Kpi rotulo="Potencial de venda" valor={moeda(potencialVenda)} icone="grafico" detalhe={`lucro potencial ${moeda(round2(potencialVenda - valorImobilizado))}`} />
            <Kpi rotulo="Ruptura / crítico" valor={String(rupture)} tom={rupture > 0 ? "erro" : "ok"} icone="alerta" detalhe="saldo zerado ou abaixo de 50% do mínimo" />
            <Kpi rotulo="Cobertura mediana" valor={coberturaMediana === null ? "—" : `${coberturaMediana} dias`} icone="raio" detalhe={`${comCobertura.length} itens com venda em 30 dias`} />
            <Kpi rotulo="Estoque parado" valor={moeda(valorParado)} tom={valorParado > 0 ? "alerta" : "neutro"} icone="cadeado" detalhe={`${parados.length} item(ns) sem venda em 90 dias`} />
          </div>

          <BarraFiltros>
            <FiltroTexto rotulo="Buscar produto" valor={busca} aoMudar={setBusca} placeholder="nome, SKU, GTIN ou local" largura="w-64" />
            <FiltroMulti rotulo="Situação" opcoes={["zerado", "critico", "baixo", "saudavel"].map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s as keyof typeof ROTULO_SITUACAO], contagem: posicao.filter((p) => p.situacao === s).length }))} selecionados={situacoes} aoAlternar={(v) => setSituacoes(alternarItem(situacoes, v))} />
            <FiltroMulti rotulo="Reposição" opcoes={(Object.keys(ROTULO_REPOSICAO) as (keyof typeof ROTULO_REPOSICAO)[]).map((k) => ({ valor: k, rotulo: ROTULO_REPOSICAO[k].rotulo, contagem: posicaoRica.filter((p) => p.ind.situacaoReposicao === k).length }))} selecionados={reposicao} aoAlternar={(v) => setReposicao(alternarItem(reposicao, v))} />
            <FiltroMulti rotulo="Curva ABC" opcoes={["A", "B", "C", "—"].map((k) => ({ valor: k, rotulo: k === "—" ? "Sem venda" : `Classe ${k}`, contagem: posicaoRica.filter((p) => p.ind.classeAbc === k).length }))} selecionados={abc} aoAlternar={(v) => setAbc(alternarItem(abc, v))} />
            <FiltroMulti rotulo="Categoria" opcoes={[...new Set(posicao.map((p) => p.categoria))].sort().map((c) => ({ valor: c, rotulo: c, contagem: posicao.filter((p) => p.categoria === c).length }))} selecionados={categorias} aoAlternar={(v) => setCategorias(alternarItem(categorias, v))} />
            <FiltroMulti rotulo="Marca" opcoes={[...new Set(posicao.map((p) => p.marca).filter(Boolean))].sort().map((m) => ({ valor: m, rotulo: m, contagem: posicao.filter((p) => p.marca === m).length }))} selecionados={marcas} aoAlternar={(v) => setMarcas(alternarItem(marcas, v))} />
            <label className="flex items-center gap-1.5 pb-1.5 text-[12px] font-medium text-ink-500">
              <input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} className="size-3.5 accent-way-600" />
              Só com saldo
            </label>
            <label className="flex items-center gap-1.5 pb-1.5 text-[12px] font-medium text-ink-500">
              <input type="checkbox" checked={soParados} onChange={(e) => setSoParados(e.target.checked)} className="size-3.5 accent-way-600" />
              Só parados (90 d)
            </label>
            <div className="ml-auto flex items-center gap-2">
              <FiltrosSalvos chave="estoque-posicao" atual={filtroPosicao} aoAplicar={aplicarFiltro} />
            </div>
          </BarraFiltros>

          <Tabela colunas={colunasPosicao} linhas={linhas} chave={(p) => p.id} nomeExportar="nkway-estoque" tamanhoPagina={20} vazio="Nenhum produto com esses filtros." />
          <p className="mt-2 text-[11px] text-ink-400">Giro e cobertura usam as vendas que baixaram estoque nos últimos 30/90 dias (DAV em aberto e vendas canceladas ficam de fora). Curva ABC por valor vendido em 90 dias: A até 80%, B até 95%.</p>
        </>
      )}

      {aba === "reposicao" && <Reposicao linhas={aReporTodos} aoExtrato={abrirExtrato} />}

      {aba === "kardex" && (
        <>
          {produtoExtrato && extrato && (
            <Card className="mb-3">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px]">
                <div className="min-w-0">
                  <p className="micro text-ink-400">Extrato do produto</p>
                  <p className="truncate font-semibold text-ink-800">{produtoExtrato.nome} <span className="font-mono text-[10.5px] text-ink-400">{produtoExtrato.sku}</span></p>
                </div>
                <div><p className="micro text-ink-400">Saldo anterior</p><p className="tabular font-semibold text-ink-700">{num(extrato.saldoAnterior)} {produtoExtrato.unidade}</p></div>
                <div><p className="micro text-ink-400">Entradas</p><p className="tabular font-semibold text-way-700">+{num(extrato.entradas)}</p></div>
                <div><p className="micro text-ink-400">Saídas</p><p className="tabular font-semibold text-rose-600">−{num(extrato.saidas)}</p></div>
                <div><p className="micro text-ink-400">Saldo final</p><p className="tabular font-bold text-ink-900">{num(extrato.saldoFinal)} {produtoExtrato.unidade}</p></div>
                <div><p className="micro text-ink-400">Lançamentos</p><p className="tabular font-semibold text-ink-700">{extrato.lancamentos}</p></div>
                {Math.abs(extrato.saldoFinal - produtoExtrato.estoque) >= 0.0005 && !kPeriodo.inicio && !kPeriodo.fim && kTipos.length === 0 && (
                  <Badge tom="alerta">saldo do cadastro ({num(produtoExtrato.estoque)}) difere do último lançamento</Badge>
                )}
                <Button tamanho="sm" variante="fantasma" className="ml-auto" onClick={() => setKProdutoId("")}>Ver todos os produtos</Button>
              </div>
            </Card>
          )}
          <BarraFiltros>
            <FiltroTexto rotulo="Produto ou observação" valor={kBusca} aoMudar={setKBusca} placeholder="ex.: arroz" largura="w-56" />
            <FiltroTexto rotulo="Documento" valor={kDocumento} aoMudar={setKDocumento} placeholder="NF 1204, Nº 88, Inventário" largura="w-48" />
            <FiltroPeriodo valor={kPeriodo} aoMudar={setKPeriodo} />
            <FiltroMulti rotulo="Tipo" opcoes={Object.entries(TIPO_MOV).slice(0, 6).map(([k, v]) => ({ valor: k, rotulo: v.rotulo, contagem: movimentos.filter((m) => m.tipo === k).length }))} selecionados={kTipos} aoAlternar={(v) => setKTipos(alternarItem(kTipos, v))} />
            {usuariosKardex.length > 0 && <FiltroMulti rotulo="Usuário" opcoes={usuariosKardex.map((u) => ({ valor: u, rotulo: u, contagem: movimentos.filter((m) => m.usuarioNome === u).length }))} selecionados={kUsuario} aoAlternar={(v) => setKUsuario(alternarItem(kUsuario, v))} />}
            <div className="ml-auto flex items-center gap-1.5">
              {kTipos.map((t) => <Chip key={t} onClick={() => setKTipos(kTipos.filter((x) => x !== t))}>{TIPO_MOV[t]?.rotulo ?? t}</Chip>)}
              <Button tamanho="sm" variante="fantasma" onClick={() => { setKBusca(""); setKTipos([]); setKPeriodo({ inicio: "", fim: "" }); setKDocumento(""); setKUsuario([]); setKProdutoId(""); }}>Limpar</Button>
            </div>
          </BarraFiltros>
          <Tabela colunas={colunasKardex} linhas={movimentosFiltrados} chave={(m) => m.id} nomeExportar={produtoExtrato ? `nkway-kardex-${produtoExtrato.sku || "produto"}` : "nkway-kardex"} tamanhoPagina={25} alturaFixa vazio="Nenhum movimento neste filtro." />
        </>
      )}

      {aba === "inventario" && (
        <Inventario produtos={produtos} ocupado={ocupado} setOcupado={setOcupado} toast={toast} podeAjustar={podeAjustar} />
      )}

      <Modal
        aberto={!!ajustando}
        aoFechar={() => setAjustando(null)}
        titulo={ajustando ? `Ajustar saldo · ${ajustando.nome}` : ""}
        descricao="Todo ajuste gera lançamento no kardex com o motivo informado"
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setAjustando(null)}>Cancelar</Button>
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
              <span className="tabular font-bold text-ink-900">{num(ajustando.estoque)} {ajustando.unidade}</span>
            </div>
            <Campo rotulo="Tipo de movimento">
              <Select valor={ajuste.tipo} aoMudar={(v) => setAjuste({ ...ajuste, tipo: v })} opcoes={[
                { valor: "ajuste", rotulo: "Ajuste (quebra, sobra)" },
                { valor: "perda", rotulo: "Perda / avaria" },
                { valor: "devolucao", rotulo: "Devolução a fornecedor" },
                { valor: "inventario", rotulo: "Contagem de inventário" },
              ]} />
            </Campo>
            <Campo rotulo="Como informar">
              <div className="flex rounded-lg bg-ink-50 p-0.5">
                {[{ id: "delta", r: "Diferença (+/-)" }, { id: "inventario", r: "Novo saldo" }].map((m) => (
                  <button key={m.id} type="button" onClick={() => setAjuste({ ...ajuste, modo: m.id as "delta" | "inventario" })} className={cn("flex-1 rounded px-2 py-1.5 text-[12px] font-semibold transition", ajuste.modo === m.id ? "bg-white text-ink-900 shadow-sm" : "text-ink-400")}>{m.r}</button>
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

/* ==================================================================== Reposição sugerida */
function Reposicao({ linhas, aoExtrato }: { linhas: LinhaPosicao[]; aoExtrato: (id: string) => void }) {
  const ordenadas = useMemo(() => [...linhas].sort((a, b) => {
    const peso = { ruptura: 0, repor: 1, atencao: 2, ok: 3, excesso: 4 } as const;
    return peso[a.ind.situacaoReposicao] - peso[b.ind.situacaoReposicao] || (a.ind.coberturaDias ?? 9999) - (b.ind.coberturaDias ?? 9999);
  }), [linhas]);
  const custoTotal = round2(ordenadas.reduce((s, p) => s + p.ind.sugestaoCompra * p.custoMedio, 0));
  const colunas: Coluna<LinhaPosicao>[] = [
    { id: "nome", rotulo: "Produto", valor: (p) => p.nome, render: (p) => <div className="min-w-0"><p className="truncate text-[12.5px] font-semibold text-ink-800">{p.nome}</p><p className="font-mono text-[10px] text-ink-400">{p.sku} · {p.categoria}{p.marca ? ` · ${p.marca}` : ""}</p></div> },
    { id: "situacao", rotulo: "Situação", alinhar: "centro", valor: (p) => p.ind.situacaoReposicao, render: (p) => <Badge tom={ROTULO_REPOSICAO[p.ind.situacaoReposicao].tom}>{ROTULO_REPOSICAO[p.ind.situacaoReposicao].rotulo}</Badge> },
    { id: "saldo", rotulo: "Saldo", alinhar: "direita", valor: (p) => p.estoque, render: (p) => <span className="tabular text-[12.5px] font-semibold">{num(p.estoque)} {p.unidade}</span> },
    { id: "min", rotulo: "Mínimo", alinhar: "direita", valor: (p) => p.estoqueMin, render: (p) => <span className="tabular text-[12px] text-ink-500">{num(p.estoqueMin)}</span> },
    { id: "media", rotulo: "Média/dia (30d)", alinhar: "direita", valor: (p) => p.ind.mediaDiaria30, render: (p) => <span className="tabular text-[12px] text-ink-600">{num(p.ind.mediaDiaria30)}</span> },
    { id: "cob", rotulo: "Cobertura", alinhar: "direita", valor: (p) => p.ind.coberturaDias ?? 9999, render: (p) => <span className="tabular text-[12.5px] font-semibold">{p.ind.coberturaDias === null ? "—" : `${p.ind.coberturaDias} d`}</span> },
    { id: "sug", rotulo: "Sugestão de compra", alinhar: "direita", valor: (p) => p.ind.sugestaoCompra, render: (p) => <span className="tabular text-[13px] font-bold text-way-700">{num(p.ind.sugestaoCompra)} {p.unidade}</span> },
    { id: "custo", rotulo: "Custo estimado", alinhar: "direita", valor: (p) => round2(p.ind.sugestaoCompra * p.custoMedio), render: (p) => <span className="tabular text-[12px] text-ink-600">{moeda(round2(p.ind.sugestaoCompra * p.custoMedio))}</span> },
    { id: "acao", rotulo: "", alinhar: "direita", ocultoNoCsv: true, render: (p) => <Button tamanho="sm" variante="fantasma" icone="documento" onClick={() => aoExtrato(p.id)}>Extrato</Button> },
  ];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Itens a repor" valor={String(ordenadas.length)} tom={ordenadas.length ? "alerta" : "ok"} icone="alerta" detalhe="ruptura, abaixo do mínimo ou cobertura curta" />
        <Kpi rotulo="Em ruptura" valor={String(ordenadas.filter((p) => p.ind.situacaoReposicao === "ruptura").length)} tom="erro" icone="alerta" detalhe="saldo zerado com demanda" />
        <Kpi rotulo="Custo estimado da compra" valor={moeda(custoTotal)} icone="carteira" detalhe="pelo custo médio atual" />
        <Kpi rotulo="Parâmetros" valor={`${PARAMETROS_PADRAO.diasCobertura} + ${PARAMETROS_PADRAO.leadTimeDias} dias`} icone="raio" detalhe="cobertura desejada + prazo do fornecedor" />
      </div>
      <Tabela colunas={colunas} linhas={ordenadas} chave={(p) => p.id} nomeExportar="nkway-reposicao" tamanhoPagina={25} vazio="Nenhum produto precisa de reposição com os parâmetros atuais." />
      <p className="mt-2 text-[11px] text-ink-400">Sugestão = média diária (30 d) × (cobertura desejada + prazo do fornecedor) − saldo, respeitando o estoque mínimo. É apoio à compra; confirme com o fornecedor e a sazonalidade. Exporte o CSV para montar o pedido.</p>
    </>
  );
}

/* ==================================================================== Inventário por contagem */
function Inventario({ produtos, ocupado, setOcupado, toast, podeAjustar }: {
  produtos: { id: string; nome: string; sku: string; gtin: string; categoria: string; localizacao: string; estoque: number; estoqueMin: number; unidade: string; custo: number }[];
  ocupado: boolean; setOcupado: (v: boolean) => void; toast: (t: string, tom?: "ok" | "erro" | "info") => void; podeAjustar: boolean;
}) {
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [rotulo, setRotulo] = useState(`Inventário ${new Date().toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}`);
  const [busca, setBusca] = useState("");
  const [categorias, setCategorias] = useState<string[]>([]);
  const [locais, setLocais] = useState<string[]>([]);
  const [modo, setModo] = useState<"todos" | "digitados" | "diferencas" | "pendentes">("todos");
  const [codigo, setCodigo] = useState("");
  const [ultimoBipado, setUltimoBipado] = useState<string | null>(null);
  const leitorRef = useRef<HTMLInputElement>(null);
  const inputsRef = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => { if (!ultimoBipado) return; const t = setTimeout(() => setUltimoBipado(null), 1800); return () => clearTimeout(t); }, [ultimoBipado]);

  const linhas = useMemo(() => produtos
    .map((p) => {
      const digitado = contagem[p.id];
      const nova = digitado === undefined || digitado === "" ? null : lerQuantidade(digitado);
      const invalido = digitado !== undefined && digitado !== "" && nova === null;
      const delta = nova === null ? 0 : round2(nova - p.estoque);
      return { ...p, nova, invalido, delta, impacto: round2(delta * p.custo) };
    })
    .filter((l) => {
      if (!casaTexto(`${l.nome} ${l.sku} ${l.gtin} ${l.localizacao}`, busca)) return false;
      if (categorias.length && !categorias.includes(l.categoria)) return false;
      if (locais.length && !locais.includes(l.localizacao || "—")) return false;
      if (modo === "digitados") return l.nova !== null || l.invalido;
      if (modo === "diferencas") return l.nova !== null && l.delta !== 0;
      if (modo === "pendentes") return l.nova === null && !l.invalido;
      return true;
    }), [produtos, contagem, busca, categorias, locais, modo]);

  const digitados = produtos.filter((p) => contagem[p.id] !== undefined && contagem[p.id] !== "");
  const invalidos = digitados.filter((p) => lerQuantidade(contagem[p.id]) === null);
  const comDiferenca = digitados.filter((p) => { const q = lerQuantidade(contagem[p.id]); return q !== null && Math.abs(q - p.estoque) >= 0.0005; });
  const diferencaValor = round2(comDiferenca.reduce((s, p) => s + ((lerQuantidade(contagem[p.id]) ?? p.estoque) - p.estoque) * p.custo, 0));
  const progresso = produtos.length ? Math.round((digitados.length / produtos.length) * 100) : 0;

  /** Leitor de código de barras: Enter no campo soma 1 à contagem do produto (ou foca o campo quando a busca é por SKU). */
  function bipar() {
    const termo = codigo.trim();
    if (!termo) return;
    const digitos = termo.replace(/\D/g, "");
    const p = produtos.find((x) => x.gtin && x.gtin === termo) ?? produtos.find((x) => digitos && x.gtin.replace(/\D/g, "") === digitos) ?? produtos.find((x) => x.sku && x.sku.toLowerCase() === termo.toLowerCase());
    setCodigo("");
    if (!p) { toast(`Código ${termo} não encontrado no cadastro.`, "erro"); return; }
    setContagem((c) => { const atual = lerQuantidade(c[p.id] ?? "") ?? 0; return { ...c, [p.id]: String(round2(atual + 1)).replace(".", ",") }; });
    setUltimoBipado(p.id);
    inputsRef.current[p.id]?.scrollIntoView({ block: "center" });
  }

  function exportarCsv() {
    const cab = ["SKU", "GTIN", "Produto", "Categoria", "Local", "Unidade", "Saldo sistema", "Contagem", "Diferenca", "Impacto custo"];
    const linhasCsv = produtos.map((p) => { const q = lerQuantidade(contagem[p.id] ?? ""); const d = q === null ? "" : round2(q - p.estoque); return [p.sku, p.gtin, p.nome, p.categoria, p.localizacao, p.unidade, p.estoque, q ?? "", d, q === null ? "" : round2((d as number) * p.custo)]; });
    const csv = "\uFEFF" + [cab, ...linhasCsv].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = `${rotulo.replace(/[^\w-]+/g, "_") || "inventario"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  async function aplicar() {
    if (invalidos.length) return toast(`Há ${invalidos.length} contagem(ns) inválida(s); corrija antes de aplicar.`, "erro");
    if (!comDiferenca.length) return toast("Nenhuma diferença para aplicar.", "info");
    setOcupado(true);
    const r = await lancarInventario({ rotulo, linhas: comDiferenca.map((p) => ({ produtoId: p.id, quantidade: lerQuantidade(contagem[p.id]) as number, observacao: `Contagem física · sistema ${num(p.estoque)}` })) });
    setOcupado(false);
    if (!r.ok) return toast(r.erro, "erro");
    toast(r.aviso ?? `${r.ajustados} produto(s) ajustados.`);
    setContagem({});
  }

  return (
    <Card padding={false}>
      <div className="space-y-2 border-b border-ink-100 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Campo rotulo="Identificação da contagem" className="w-64">
            <Input valor={rotulo} aoMudar={setRotulo} maxLength={80} placeholder="Inventário geral 11/2026" />
          </Campo>
          <Campo rotulo="Leitor de código de barras / SKU" dica="Bipe ou digite e tecle Enter: soma 1 à contagem" className="w-64">
            <Input valor={codigo} aoMudar={setCodigo} placeholder="7891234567895" className="font-mono" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); bipar(); } }} />
          </Campo>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className={cn("tabular text-[12px] font-semibold", diferencaValor < 0 ? "text-rose-600" : diferencaValor > 0 ? "text-way-700" : "text-ink-400")}>
              {diferencaValor > 0 ? "+" : ""}{moeda(diferencaValor)} de diferença no custo
            </span>
            <Button tamanho="sm" variante="secundario" icone="baixar" onClick={exportarCsv} disabled={!produtos.length}>Exportar CSV</Button>
            <Button tamanho="sm" variante="fantasma" onClick={() => { if (digitados.length === 0 || window.confirm(`Descartar ${digitados.length} contagem(ns) digitada(s)?`)) setContagem({}); }} disabled={ocupado || digitados.length === 0}>Limpar</Button>
            {podeAjustar && (
              <Button disabled={ocupado || comDiferenca.length === 0 || invalidos.length > 0} icone="check" onClick={() => { if (window.confirm(`Aplicar "${rotulo}": ${comDiferenca.length} produto(s) com diferença, impacto ${moeda(diferencaValor)} no custo?`)) void aplicar(); }}>
                {ocupado ? "Aplicando…" : `Aplicar ${comDiferenca.length} diferença(s)`}
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FiltroTexto rotulo="Buscar" valor={busca} aoMudar={setBusca} placeholder="nome, SKU, GTIN ou local" largura="w-56" />
          <FiltroMulti rotulo="Categoria" opcoes={[...new Set(produtos.map((p) => p.categoria))].sort().map((c) => ({ valor: c, rotulo: c, contagem: produtos.filter((p) => p.categoria === c).length }))} selecionados={categorias} aoAlternar={(v) => setCategorias(alternarItem(categorias, v))} />
          {produtos.some((p) => p.localizacao) && <FiltroMulti rotulo="Local" opcoes={[...new Set(produtos.map((p) => p.localizacao || "—"))].sort().map((l) => ({ valor: l, rotulo: l, contagem: produtos.filter((p) => (p.localizacao || "—") === l).length }))} selecionados={locais} aoAlternar={(v) => setLocais(alternarItem(locais, v))} />}
          <div className="flex rounded-lg bg-ink-50 p-0.5">
            {([["todos", "Todos"], ["pendentes", "Não contados"], ["digitados", "Contados"], ["diferencas", "Com diferença"]] as const).map(([id, r]) => (
              <button key={id} type="button" onClick={() => setModo(id)} className={cn("rounded px-2.5 py-1 text-[12px] font-semibold transition", modo === id ? "bg-white text-ink-900 shadow-sm" : "text-ink-400")}>{r}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-500">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-100"><div className="h-full bg-way-500 transition-all" style={{ width: `${progresso}%` }} /></div>
            <span className="tabular">{digitados.length}/{produtos.length} contados · {comDiferenca.length} com diferença{invalidos.length ? ` · ${invalidos.length} inválida(s)` : ""}</span>
          </div>
        </div>
      </div>
      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-ink-50">
            <tr className="text-left">
              {["Produto", "Local", "Saldo sistema", "Contagem", "Diferença", "Impacto no custo"].map((h) => <th key={h} className="micro px-3 py-2 text-ink-400">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => (
              <tr key={p.id} className={cn("border-t border-ink-50 transition-colors", p.invalido ? "bg-rose-50/60" : p.delta !== 0 ? "bg-amber-50/40" : "", ultimoBipado === p.id && "bg-way-50")}>
                <td className="max-w-[300px] px-3 py-1.5">
                  <p className="truncate font-semibold text-ink-800">{p.nome}</p>
                  <p className="font-mono text-[10px] text-ink-400">{p.sku} · {p.gtin} · mín. {num(p.estoqueMin)}</p>
                </td>
                <td className="px-3 py-1.5 text-[11.5px] text-ink-500">{p.localizacao || "—"}</td>
                <td className="tabular px-3 py-1.5 text-ink-600">{num(p.estoque)} {p.unidade}</td>
                <td className="px-3 py-1.5">
                  <input
                    ref={(el) => { inputsRef.current[p.id] = el; }}
                    value={contagem[p.id] ?? ""}
                    onChange={(e) => setContagem({ ...contagem, [p.id]: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const idx = linhas.findIndex((l) => l.id === p.id); const prox = linhas[idx + 1]; if (prox) inputsRef.current[prox.id]?.focus(); else leitorRef.current?.focus(); } }}
                    placeholder="—"
                    inputMode="decimal"
                    aria-invalid={p.invalido}
                    className={cn("tabular w-24 rounded-lg px-2 py-1 text-right ring-1 ring-inset outline-none focus:ring-2 focus:ring-way-500", p.invalido ? "ring-rose-300 bg-rose-50" : "ring-ink-200")}
                  />
                </td>
                <td className={cn("tabular px-3 py-1.5 font-semibold", p.invalido ? "text-rose-600" : p.delta > 0 ? "text-way-700" : p.delta < 0 ? "text-rose-600" : "text-ink-300")}>
                  {p.invalido ? "inválido" : p.nova === null || p.delta === 0 ? "—" : `${p.delta > 0 ? "+" : ""}${num(p.delta)}`}
                </td>
                <td className="tabular px-3 py-1.5 text-ink-600">{p.nova === null || p.delta === 0 ? "—" : moeda(p.impacto)}</td>
              </tr>
            ))}
            {linhas.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[12px] text-ink-400">Nenhum produto neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="flex items-center gap-1.5 border-t border-ink-100 px-3 py-2 text-[11.5px] text-ink-400">
        <Icon name="alerta" className="size-3.5 text-signal-500" />
        Só as linhas com diferença são gravadas, em uma única transação, como movimento “Inventário” com a identificação da contagem e o usuário — o saldo anterior continua auditável no kardex. Enter na contagem pula para o próximo produto.
      </p>
    </Card>
  );
}
