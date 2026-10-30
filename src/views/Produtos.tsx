"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  BarraFiltros,
  Button,
  Campo,
  Chip,
  FiltroMulti,
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
import { alternarItem, casaTexto } from "@/lib/filtros";
import { ROTULO_SITUACAO, UNIDADES_LISTA, moeda, num, round2, soDigitos, validarGtin } from "@/lib/dominio";
import {
  alternarProduto,
  aplicarManutencaoPrecos,
  excluirProduto,
  salvarProduto,
  type ProdutoInput,
} from "@/server/acoes/cadastros";
import type { ProdutoDto } from "@/server/dados";

const VAZIO: ProdutoInput = {
  nome: "",
  sku: "",
  gtin: "",
  categoria: "Mercearia",
  marca: "",
  unidade: "UN",
  custo: 0,
  preco: 0,
  estoque: 0,
  estoqueMin: 0,
  pesavel: false,
  ativo: true,
  ncm: "00000000",
  cfop: "5102",
  csosn: "102",
  icmsAliq: 0,
};

const ROTULO_EXCECAO: Record<string, string> = {
  sem_gtin: "sem código de barras",
  gtin_invalido: "GTIN com DV inválido",
  sem_ncm: "sem NCM",
  margem_negativa: "margem negativa",
  custo_zerado: "custo zerado",
  abaixo_custo: "preço abaixo do custo",
  sem_localizacao: "sem localização",
  validade_curta: "validade em 30 dias",
};

export function ProdutosView({
  produtos,
  categorias,
  plano,
}: {
  produtos: ProdutoDto[];
  categorias: string[];
  plano: { nome: string; limite: number; atuais: number };
}) {
  const toast = useToast();
  const [busca, setBusca] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [situacoes, setSituacoes] = useState<string[]>([]);
  const [status, setStatus] = useState("ativos");
  const [margemMin, setMargemMin] = useState("");
  const [precoMin, setPrecoMin] = useState("");
  const [precoMax, setPrecoMax] = useState("");
  const [unidades, setUnidades] = useState<string[]>([]);
  const [tipo, setTipo] = useState("todos");
  const [excecoes, setExcecoes] = useState<string[]>([]);
  const [fiscais, setFiscais] = useState<string[]>([]);
  const [margemMax, setMargemMax] = useState("");
  const [estoqueMin, setEstoqueMin] = useState("");
  const [estoqueMax, setEstoqueMax] = useState("");

  const filtroAtual = { busca, cats, marcas, situacoes, status, margemMin, precoMin, precoMax, unidades, tipo, excecoes, fiscais, margemMax, estoqueMin, estoqueMax };
  type FiltroCfg = typeof filtroAtual;
  const aplicar = (f: FiltroCfg) => {
    setBusca(f.busca);
    setCats(f.cats);
    setMarcas(f.marcas);
    setSituacoes(f.situacoes);
    setStatus(f.status);
    setMargemMin(f.margemMin);
    setPrecoMin(f.precoMin);
    setPrecoMax(f.precoMax);
    setUnidades(f.unidades);
    setTipo(f.tipo);
    setExcecoes(f.excecoes);
    setFiscais(f.fiscais);
    setMargemMax(f.margemMax);
    setEstoqueMin(f.estoqueMin);
    setEstoqueMax(f.estoqueMax);
  };

  const linhas = useMemo(
    () =>
      produtos.filter((p) => {
        // FILTROS.md: nome · SKU · código de barras (com ou sem máscara) · marca · categoria · NCM · CEST · preço
        const digitosBusca = soDigitos(busca);
        const casaDigitos = digitosBusca.length >= 6 && soDigitos(p.gtin).includes(digitosBusca);
        const precoTexto = p.preco.toFixed(2).replace(".", ",");
        if (!casaTexto(`${p.nome} ${p.sku} ${p.gtin} ${p.marca} ${p.categoria} ${p.ncm} ${p.cest} ${p.unidade} ${p.localizacao} ${p.lote} ${precoTexto}`, busca) && !casaDigitos) return false;
        if (cats.length && !cats.includes(p.categoria)) return false;
        if (marcas.length && !marcas.includes(p.marca)) return false;
        if (situacoes.length && !situacoes.includes(p.situacao)) return false;
        if (status === "ativos" && !p.ativo) return false;
        if (status === "inativos" && p.ativo) return false;
        const mm = Number(margemMin.replace(",", ".")) || 0;
        if (margemMin && p.margem < mm) return false;
        const pn = Number(precoMin.replace(",", ".")) || 0;
        const px = Number(precoMax.replace(",", ".")) || 0;
        if (precoMin && p.preco < pn) return false;
        if (precoMax && p.preco > px) return false;
        if (unidades.length && !unidades.includes(p.unidade)) return false;
        if (tipo === "unitario" && p.pesavel) return false;
        if (tipo === "pesavel" && !p.pesavel) return false;
        if (fiscais.length && !fiscais.includes(p.csosn)) return false;
        const mx = Number(margemMax.replace(",", ".")) || 0;
        if (margemMax && p.margem > mx) return false;
        const en = Number(estoqueMin.replace(",", ".")) || 0;
        const ex = Number(estoqueMax.replace(",", ".")) || 0;
        if (estoqueMin && p.estoque < en) return false;
        if (estoqueMax && p.estoque > ex) return false;
        // FILTROS.md · Exceções de cadastro
        if (excecoes.includes("sem_gtin") && p.gtin && p.gtin !== "SEM GTIN") return false;
        if (excecoes.includes("gtin_invalido") && validarGtin(p.gtin)) return false;
        if (excecoes.includes("sem_ncm") && /^\d{8}$/.test(p.ncm) && p.ncm !== "00000000") return false;
        if (excecoes.includes("margem_negativa") && p.margem >= 0) return false;
        if (excecoes.includes("custo_zerado") && p.custo > 0) return false;
        if (excecoes.includes("abaixo_custo") && p.preco >= p.custo) return false;
        if (excecoes.includes("sem_localizacao") && p.localizacao) return false;
        if (excecoes.includes("validade_curta")) {
          if (!p.validade) return false;
          const dias = (new Date(`${p.validade}T12:00:00`).getTime() - Date.now()) / 86_400_000;
          if (dias > 30) return false;
        }
        return true;
      }),
    [produtos, busca, cats, marcas, situacoes, status, margemMin, precoMin, precoMax, unidades, tipo, excecoes, fiscais, margemMax, estoqueMin, estoqueMax],
  );

  const chips: { r: string; limpar: () => void }[] = [
    ...(busca ? [{ r: `busca: ${busca}`, limpar: () => setBusca("") }] : []),
    ...cats.map((c) => ({ r: `categoria: ${c}`, limpar: () => setCats(cats.filter((x) => x !== c)) })),
    ...marcas.map((m) => ({ r: `marca: ${m}`, limpar: () => setMarcas(marcas.filter((x) => x !== m)) })),
    ...situacoes.map((s) => ({ r: `estoque: ${s}`, limpar: () => setSituacoes(situacoes.filter((x) => x !== s)) })),
    ...(margemMin ? [{ r: `margem ≥ ${margemMin}%`, limpar: () => setMargemMin("") }] : []),
    ...(precoMin || precoMax ? [{ r: `preço ${precoMin || "0"}–${precoMax || "∞"}`, limpar: () => { setPrecoMin(""); setPrecoMax(""); } }] : []),
    ...unidades.map((u) => ({ r: `unidade: ${u}`, limpar: () => setUnidades(unidades.filter((x) => x !== u)) })),
    ...(tipo !== "todos" ? [{ r: tipo === "pesavel" ? "pesável" : "unitário", limpar: () => setTipo("todos") }] : []),
    ...fiscais.map((f) => ({ r: `CSOSN ${f}`, limpar: () => setFiscais(fiscais.filter((x) => x !== f)) })),
    ...(margemMax ? [{ r: `margem ≤ ${margemMax}%`, limpar: () => setMargemMax("") }] : []),
    ...(estoqueMin || estoqueMax ? [{ r: `estoque ${estoqueMin || "0"}–${estoqueMax || "∞"}`, limpar: () => { setEstoqueMin(""); setEstoqueMax(""); } }] : []),
    ...excecoes.map((e) => ({ r: ROTULO_EXCECAO[e] ?? e, limpar: () => setExcecoes(excecoes.filter((x) => x !== e)) })),
  ];

  const [editando, setEditando] = useState<(ProdutoInput & { id?: string }) | null>(null);
  const [formErro, setFormErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [manutencao, setManutencao] = useState(false);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [modoManutencao, setModoManutencao] = useState("percentual");
  const [valorManutencao, setValorManutencao] = useState("40");
  const [arredondarManutencao, setArredondarManutencao] = useState("x90");
  const [markupSugerido, setMarkupSugerido] = useState("40");

  const marcaLista = [...new Set(produtos.map((p) => p.marca).filter(Boolean))].sort();
  const margemMedia = round2(linhas.length ? linhas.reduce((s, p) => s + p.margem, 0) / linhas.length : 0);
  const imobilizado = round2(linhas.reduce((s, p) => s + p.custo * p.estoque, 0));

  const colunas: Coluna<ProdutoDto>[] = [
    {
      id: "nome",
      rotulo: "Produto",
      valor: (p) => p.nome,
      render: (p) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[12.5px] font-semibold text-ink-900">
            {p.nome}
            {p.pesavel && <Badge tom="roxo">pesável</Badge>}
            {!p.ativo && <Badge tom="neutro">inativo</Badge>}
          </p>
          <p className="font-mono text-[10px] text-ink-400">
            {p.sku} · {p.gtin} · {p.categoria}
          </p>
        </div>
      ),
    },
    { id: "marca", rotulo: "Marca", valor: (p) => p.marca, render: (p) => <span className="text-[12px] text-ink-500">{p.marca || "—"}</span> },
    { id: "custo", rotulo: "Custo", alinhar: "direita", valor: (p) => p.custo, render: (p) => <span className="tabular text-[12px] text-ink-600">{moeda(p.custo)}</span> },
    { id: "preco", rotulo: "Preço", alinhar: "direita", valor: (p) => p.preco, render: (p) => <span className="tabular text-[13px] font-bold text-ink-900">{moeda(p.preco)}</span> },
    {
      id: "margem",
      rotulo: "Margem",
      alinhar: "direita",
      valor: (p) => p.margem,
      render: (p) => (
        <div className="leading-tight">
          <p className={cn("tabular text-[12.5px] font-bold", p.margem < 10 ? "text-rose-600" : p.margem < 25 ? "text-amber-600" : "text-way-700")}>{p.margem.toFixed(1)}%</p>
          <p className="tabular text-[10px] text-ink-400">markup {p.markup.toFixed(0)}%</p>
        </div>
      ),
    },
    {
      id: "estoque",
      rotulo: "Estoque",
      alinhar: "direita",
      valor: (p) => p.estoque,
      render: (p) => (
        <div className="leading-tight">
          <p className="tabular text-[12.5px] font-semibold text-ink-800">
            {num(p.estoque)} {p.unidade}
          </p>
          <p className="tabular text-[10px] text-ink-400">mín. {num(p.estoqueMin)}</p>
        </div>
      ),
    },
    {
      id: "situacao",
      rotulo: "Situação",
      alinhar: "centro",
      valor: (p) => p.situacao,
      render: (p) => <Badge tom={p.situacao === "zerado" ? "erro" : p.situacao === "critico" ? "alerta" : p.situacao === "baixo" ? "alerta" : "ok"}>{ROTULO_SITUACAO[p.situacao]}</Badge>,
    },
    {
      id: "fiscal",
      rotulo: "Fiscal",
      render: (p) => (
        <span className="font-mono text-[10px] leading-tight text-ink-400">
          NCM {p.ncm}
          <br />
          CSOSN {p.csosn} · {p.cfop}
        </span>
      ),
      valor: (p) => `${p.ncm}/${p.csosn}`,
    },
    {
      id: "acoes",
      rotulo: "",
      alinhar: "direita",
      ocultoNoCsv: true,
      render: (p) => (
        <div className="flex justify-end gap-1">
          <button type="button" title="Editar" onClick={() => setEditando({ ...p })} className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800">
            <Icon name="etiqueta" className="size-4" />
          </button>
          <button
            type="button"
            title={p.ativo ? "Desativar" : "Reativar"}
            onClick={async () => {
              const r = await alternarProduto(p.id);
              toast(r.ok ? (p.ativo ? "Produto desativado." : "Produto reativado.") : !r.ok ? r.erro : "", r.ok ? "ok" : "erro");
            }}
            className="rounded-md p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-800"
          >
            <Icon name={p.ativo ? "cadeado" : "check"} className="size-4" />
          </button>
          <button
            type="button"
            title="Excluir"
            onClick={async () => {
              const r = await excluirProduto(p.id);
              toast(r.ok ? (r.aviso ?? "Produto removido.") : r.erro, r.ok ? "ok" : "erro");
            }}
            className="rounded-md p-1 text-ink-300 hover:bg-rose-50 hover:text-rose-600"
          >
            <Icon name="lixo" className="size-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        titulo="Produtos e preços"
        subtitulo={`Cadastro com margem, custo médio e tributação · plano ${plano.nome} (${plano.atuais}/${plano.limite} ativos)`}
        acao={
          <>
            <Button variante="secundario" icone="etiqueta" onClick={() => setManutencao(true)}>
              Manutenção de preços
            </Button>
            <Button
              icone="mais"
              onClick={() => {
                setEditando({ ...VAZIO });
                setFormErro("");
              }}
            >
              Novo produto
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi rotulo="Produtos no filtro" valor={String(linhas.length)} icone="etiqueta" detalhe={`${produtos.length} no total`} />
        <Kpi rotulo="Margem média" valor={`${margemMedia}%`} tom={margemMedia < 20 ? "alerta" : "ok"} icone="grafico" detalhe="sobre o preço de venda" />
        <Kpi rotulo="Custo do estoque exposto" valor={moeda(imobilizado)} icone="caixaEstoque" detalhe="custo × saldo atual" />
        <Kpi
          rotulo="Precisam de preço"
          valor={String(produtos.filter((p) => p.margem < 10).length)}
          tom={produtos.filter((p) => p.margem < 10).length > 0 ? "erro" : "ok"}
          icone="alerta"
          detalhe="margem abaixo de 10%"
        />
      </div>

      <BarraFiltros>
        <FiltroTexto rotulo="Busca" valor={busca} aoMudar={setBusca} placeholder="nome, SKU, GTIN, NCM, CEST, localização, preço" largura="w-72" />
        <FiltroMulti rotulo="Categoria" opcoes={categorias.map((c) => ({ valor: c, rotulo: c, contagem: produtos.filter((p) => p.categoria === c).length }))} selecionados={cats} aoAlternar={(v) => setCats(alternarItem(cats, v))} />
        <FiltroMulti rotulo="Marca" opcoes={marcaLista.map((m) => ({ valor: m, rotulo: m, contagem: produtos.filter((p) => p.marca === m).length }))} selecionados={marcas} aoAlternar={(v) => setMarcas(alternarItem(marcas, v))} />
        <FiltroMulti rotulo="Estoque" opcoes={["saudavel", "baixo", "critico", "zerado"].map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s as keyof typeof ROTULO_SITUACAO], contagem: produtos.filter((p) => p.situacao === s).length }))} selecionados={situacoes} aoAlternar={(v) => setSituacoes(alternarItem(situacoes, v))} />
        <Campo rotulo="Situação do cadastro" className="w-32">
          <Select valor={status} aoMudar={setStatus} opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "ativos", rotulo: "Ativos" }, { valor: "inativos", rotulo: "Inativos" }]} />
        </Campo>
        <Campo rotulo="Margem mín. %" className="w-24">
          <Input dinheiro valor={margemMin} aoMudar={setMargemMin} placeholder="0" />
        </Campo>
        <Campo rotulo="Preço de" className="w-24">
          <Input dinheiro valor={precoMin} aoMudar={setPrecoMin} placeholder="0,00" />
        </Campo>
        <Campo rotulo="até" className="w-24">
          <Input dinheiro valor={precoMax} aoMudar={setPrecoMax} placeholder="0,00" />
        </Campo>
        <Campo rotulo="Margem máx. %" className="w-24">
          <Input dinheiro valor={margemMax} aoMudar={setMargemMax} placeholder="∞" />
        </Campo>
        <Campo rotulo="Estoque de" className="w-24">
          <Input dinheiro valor={estoqueMin} aoMudar={setEstoqueMin} placeholder="0" />
        </Campo>
        <Campo rotulo="até" className="w-24">
          <Input dinheiro valor={estoqueMax} aoMudar={setEstoqueMax} placeholder="∞" />
        </Campo>
        <FiltroMulti
          rotulo="Unidade"
          opcoes={UNIDADES_LISTA.map((u) => ({ valor: u, rotulo: u, contagem: produtos.filter((p) => p.unidade === u).length }))}
          selecionados={unidades}
          aoAlternar={(v) => setUnidades(alternarItem(unidades, v))}
        />
        <Campo rotulo="Tipo" className="w-32">
          <Select valor={tipo} aoMudar={setTipo} opcoes={[{ valor: "todos", rotulo: "Todos" }, { valor: "unitario", rotulo: "Unitário" }, { valor: "pesavel", rotulo: "Pesável" }]} />
        </Campo>
        <FiltroMulti
          rotulo="Situação fiscal"
          opcoes={[...new Set(produtos.map((p) => p.csosn))].map((c) => ({ valor: c, rotulo: `CSOSN ${c}`, contagem: produtos.filter((p) => p.csosn === c).length }))}
          selecionados={fiscais}
          aoAlternar={(v) => setFiscais(alternarItem(fiscais, v))}
        />
        <FiltroMulti
          rotulo="Exceções"
          opcoes={[
            { valor: "sem_gtin", rotulo: "sem código de barras", contagem: produtos.filter((p) => !p.gtin || p.gtin === "SEM GTIN").length },
            { valor: "gtin_invalido", rotulo: "GTIN inválido", contagem: produtos.filter((p) => !validarGtin(p.gtin)).length },
            { valor: "sem_ncm", rotulo: "sem NCM", contagem: produtos.filter((p) => !p.ncm || p.ncm === "00000000").length },
            { valor: "margem_negativa", rotulo: "margem negativa", contagem: produtos.filter((p) => p.margem < 0).length },
            { valor: "custo_zerado", rotulo: "custo zerado", contagem: produtos.filter((p) => p.custo <= 0).length },
            { valor: "abaixo_custo", rotulo: "preço abaixo do custo", contagem: produtos.filter((p) => p.preco < p.custo).length },
            { valor: "sem_localizacao", rotulo: "sem localização", contagem: produtos.filter((p) => !p.localizacao).length },
            { valor: "validade_curta", rotulo: "validade em 30 dias", contagem: produtos.filter((p) => p.validade && new Date(`${p.validade}T12:00:00`).getTime() - Date.now() < 30 * 86_400_000).length },
          ]}
          selecionados={excecoes}
          aoAlternar={(v) => setExcecoes(alternarItem(excecoes, v))}
        />
      </BarraFiltros>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <Chip key={c.r} onClick={c.limpar}>
            {c.r}
          </Chip>
        ))}
        <Button tamanho="sm" variante="fantasma" onClick={() => aplicar({ busca: "", cats: [], marcas: [], situacoes: [], status: "todos", margemMin: "", precoMin: "", precoMax: "", unidades: [], tipo: "todos", excecoes: [], fiscais: [], margemMax: "", estoqueMin: "", estoqueMax: "" })}>
          Limpar filtros
        </Button>
        <div className="ml-auto">
          <FiltrosSalvos chave="produtos" atual={filtroAtual} aoAplicar={aplicar} />
        </div>
      </div>

      <Tabela colunas={colunas} linhas={linhas} chave={(p) => p.id} nomeExportar="nkway-produtos" tamanhoPagina={20} vazio="Nada encontrado — ajuste os filtros ou cadastre um produto." />

      {/* modal cadastro/edição */}
      <Modal
        aberto={!!editando}
        aoFechar={() => setEditando(null)}
        titulo={editando?.id ? "Editar produto" : "Novo produto"}
        descricao="Os campos fiscais entram na NFC-e/NF-e emitida pelo PDV"
        rodape={
          <>
            {editando?.gtin !== undefined && (
              <span className="mr-auto text-[11.5px] text-ink-400">
                {validarGtin(editando?.gtin ?? "") ? "GTIN com dígito verificador válido" : "GTIN inválido — confira o código de barras"}
              </span>
            )}
            <Button variante="secundario" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={ocupado}
              onClick={async () => {
                if (!editando) return;
                setOcupado(true);
                const r = await salvarProduto({ ...editando, id: editando.id });
                setOcupado(false);
                if (!r.ok) return setFormErro(r.erro);
                toast(r.aviso ?? (editando.id ? "Produto atualizado." : "Produto cadastrado."));
                setEditando(null);
              }}
            >
              Salvar produto
            </Button>
          </>
        }
      >
        {editando && (
          <div className="space-y-3">
            {formErro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">{formErro}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Nome" obrigatorio className="sm:col-span-2">
                <Input valor={editando.nome} aoMudar={(v) => setEditando({ ...editando, nome: v })} placeholder="ARROZ TIPO 1 5KG" />
              </Campo>
              <Campo rotulo="SKU / código interno">
                <Input valor={editando.sku} aoMudar={(v) => setEditando({ ...editando, sku: v })} placeholder="NK0001" />
              </Campo>
              <Campo rotulo="GTIN (código de barras)">
                <Input valor={editando.gtin} aoMudar={(v) => setEditando({ ...editando, gtin: v })} placeholder="7891234567895 ou SEM GTIN" className="font-mono" />
              </Campo>
              <Campo rotulo="Categoria">
                <Input valor={editando.categoria} aoMudar={(v) => setEditando({ ...editando, categoria: v })} placeholder="Mercearia" />
              </Campo>
              <Campo rotulo="Marca">
                <Input valor={editando.marca} aoMudar={(v) => setEditando({ ...editando, marca: v })} placeholder="Linha Way" />
              </Campo>
              <Campo rotulo="Unidade comercial (uCom)">
                <Select valor={editando.unidade} aoMudar={(v) => setEditando({ ...editando, unidade: v })} opcoes={UNIDADES_LISTA.map((u) => ({ valor: u, rotulo: u }))} />
              </Campo>
              <Campo rotulo="Vendido por peso (balança)">
                <Select
                  valor={editando.pesavel ? "sim" : "nao"}
                  aoMudar={(v) => setEditando({ ...editando, pesavel: v === "sim", ...(v === "sim" ? { unidade: "KG" } : {}) })}
                  opcoes={[{ valor: "nao", rotulo: "Não — contagem" }, { valor: "sim", rotulo: "Sim — KG" }]}
                />
              </Campo>
              <Campo rotulo="Custo (R$)">
                <Input dinheiro valor={String(editando.custo)} aoMudar={(v) => setEditando({ ...editando, custo: Number(v.replace(",", ".")) || 0, preco: editando.custo > 0 ? editando.preco : round2((Number(v.replace(",", ".")) || 0) * 1.4) })} />
              </Campo>
              <Campo rotulo="Preço de venda (R$)">
                <Input dinheiro valor={String(editando.preco)} aoMudar={(v) => setEditando({ ...editando, preco: Number(v.replace(",", ".")) || 0 })} />
              </Campo>
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-ink-50 p-3">
              <Campo rotulo="Markup sugerido (%)" className="w-32">
                <Input dinheiro valor={markupSugerido} aoMudar={setMarkupSugerido} placeholder="40" />
              </Campo>
              <Button
                tamanho="sm"
                variante="secundario"
                className="mb-1"
                onClick={() => {
                  const m = Number(markupSugerido.replace(",", ".")) || 40;
                  setEditando({ ...editando, preco: round2(editando.custo * (1 + m / 100)) });
                }}
              >
                Aplicar ao preço
              </Button>
              <span className="mb-2 text-[12px] text-ink-500">
                margem atual <b className={cn("tabular font-bold", editando.preco > 0 && (editando.preco - editando.custo) / editando.preco < 0.1 ? "text-rose-600" : "text-way-700")}>{(editando.preco > 0 ? ((editando.preco - editando.custo) / editando.preco) * 100 : 0).toFixed(1)}%</b> · lucro unitário{" "}
                <b className="tabular font-bold text-ink-800">{moeda(round2(editando.preco - editando.custo))}</b>
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo rotulo="Estoque atual">
                <Input dinheiro valor={String(editando.estoque)} aoMudar={(v) => setEditando({ ...editando, estoque: Number(v.replace(",", ".")) || 0 })} disabled={!!editando.id} />
              </Campo>
              <Campo rotulo="Estoque mínimo">
                <Input dinheiro valor={String(editando.estoqueMin)} aoMudar={(v) => setEditando({ ...editando, estoqueMin: Number(v.replace(",", ".")) || 0 })} />
              </Campo>
              <Campo rotulo="NCM">
                <Input valor={editando.ncm} aoMudar={(v) => setEditando({ ...editando, ncm: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="CSOSN / CST">
                <Input valor={editando.csosn} aoMudar={(v) => setEditando({ ...editando, csosn: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="CFOP venda">
                <Input valor={editando.cfop} aoMudar={(v) => setEditando({ ...editando, cfop: v })} className="font-mono" />
              </Campo>
              <Campo rotulo="Alíquota ICMS (%)">
                <Input dinheiro valor={String(editando.icmsAliq)} aoMudar={(v) => setEditando({ ...editando, icmsAliq: Number(v.replace(",", ".")) || 0 })} />
              </Campo>
              <Campo rotulo="Situação">
                <Select valor={editando.ativo ? "ativo" : "inativo"} aoMudar={(v) => setEditando({ ...editando, ativo: v === "ativo" })} opcoes={[{ valor: "ativo", rotulo: "Ativo para venda" }, { valor: "inativo", rotulo: "Inativo" }]} />
              </Campo>
            </div>
          </div>
        )}
      </Modal>

      {/* manutenção de preços em massa */}
      <Modal
        aberto={manutencao}
        aoFechar={() => setManutencao(false)}
        titulo="Manutenção de preços"
        descricao="Reajuste em cima do custo, do markup ou preço fixo — com arredondamento de gôndola"
        largura="max-w-4xl"
        rodape={
          <>
            <span className="mr-auto text-[12px] text-ink-500">
              {selecionados.length} produto(s) selecionados
            </span>
            <Button variante="secundario" onClick={() => setManutencao(false)}>
              Fechar
            </Button>
            <Button
              disabled={ocupado || selecionados.length === 0}
              onClick={async () => {
                setOcupado(true);
                const r = await aplicarManutencaoPrecos({ ids: selecionados, modo: modoManutencao as "percentual" | "real" | "markup" | "preco", valor: Number(valorManutencao.replace(",", ".")) || 0, arredondar: arredondarManutencao as "nenhum" | "para_cima" | "x90" | "inteiro" });
                setOcupado(false);
                if (!r.ok) return toast(r.erro, "erro");
                toast(`${r.atualizados} preço(s) atualizados.`);
                setSelecionados([]);
                setManutencao(false);
              }}
            >
              {ocupado ? "Aplicando…" : "Aplicar nos selecionados"}
            </Button>
          </>
        }
      >
        <ManutencaoBody
          produtos={produtos}
          selecionados={selecionados}
          setSelecionados={setSelecionados}
          modo={modoManutencao}
          setModo={setModoManutencao}
          valor={valorManutencao}
          setValor={setValorManutencao}
          arredondar={arredondarManutencao}
          setArredondar={setArredondarManutencao}
        />
      </Modal>
    </>
  );

  function ManutencaoBody(props: {
    produtos: ProdutoDto[];
    selecionados: string[];
    setSelecionados: (v: string[]) => void;
    modo: string;
    setModo: (v: string) => void;
    valor: string;
    setValor: (v: string) => void;
    arredondar: string;
    setArredondar: (v: string) => void;
  }) {
    const { produtos, selecionados, setSelecionados, modo, setModo, valor, setValor, arredondar, setArredondar } = props;
    const calcular = (p: ProdutoDto) => {
      const v = Number(valor.replace(",", ".")) || 0;
      let novo = modo === "percentual" ? p.custo * (1 + v / 100) : modo === "real" ? p.custo + v : modo === "markup" ? p.custo * (v / 100) : v;
      if (arredondar === "x90") novo = Math.floor(novo) + 0.9;
      else if (arredondar === "inteiro") novo = Math.round(novo);
      else if (arredondar === "para_cima") novo = Math.ceil(novo * 100) / 100;
      return round2(novo);
    };
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo rotulo="Critério">
            <Select
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                { valor: "percentual", rotulo: "% sobre o custo" },
                { valor: "markup", rotulo: "markup (custo × %)" },
                { valor: "real", rotulo: "+ R$ sobre o custo" },
                { valor: "preco", rotulo: "preço fixo" },
              ]}
            />
          </Campo>
          <Campo rotulo="Valor">
            <Input dinheiro valor={valor} aoMudar={setValor} placeholder="40" />
          </Campo>
          <Campo rotulo="Arredondamento">
            <Select
              valor={arredondar}
              aoMudar={setArredondar}
              opcoes={[
                { valor: "nenhum", rotulo: "Nenhum" },
                { valor: "para_cima", rotulo: "Para cima (centavo)" },
                { valor: "x90", rotulo: "Terminar em ,90" },
                { valor: "inteiro", rotulo: "Inteiro" },
              ]}
            />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button tamanho="sm" variante="secundario" onClick={() => setSelecionados(produtos.map((p) => p.id))}>
            Selecionar todos ({produtos.length})
          </Button>
          <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionados([])}>
            Limpar seleção
          </Button>
          <Button tamanho="sm" variante="fantasma" onClick={() => setSelecionados(produtos.filter((p) => p.margem < 20).map((p) => p.id))}>
            Só margem abaixo de 20%
          </Button>
        </div>
        <div className="max-h-80 overflow-auto rounded-xl border border-ink-100">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-ink-50">
              <tr className="text-left">
                {["", "Produto", "Custo", "Preço atual", "Margem", "Novo preço", "Nova margem"].map((h) => (
                  <th key={h} className="micro px-2 py-1.5 text-ink-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {produtos.slice(0, 300).map((p) => {
                const on = selecionados.includes(p.id);
                const novo = calcular(p);
                return (
                  <tr key={p.id} className={cn("border-t border-ink-50", on && "bg-way-50/40")}>
                    <td className="px-2 py-1">
                      <input type="checkbox" checked={on} onChange={() => setSelecionados(alternarItem(selecionados, p.id))} className="size-3.5 accent-way-600" />
                    </td>
                    <td className="max-w-[220px] truncate px-2 py-1 font-semibold text-ink-800">{p.nome}</td>
                    <td className="tabular px-2 py-1 text-ink-500">{moeda(p.custo)}</td>
                    <td className="tabular px-2 py-1 text-ink-600">{moeda(p.preco)}</td>
                    <td className="tabular px-2 py-1 text-ink-500">{p.margem.toFixed(0)}%</td>
                    <td className="tabular px-2 py-1 font-bold text-ink-900">{moeda(novo)}</td>
                    <td className={cn("tabular px-2 py-1 font-semibold", novo > 0 && (novo - p.custo) / novo < 0.1 ? "text-rose-600" : "text-way-700")}>
                      {novo > 0 ? (((novo - p.custo) / novo) * 100).toFixed(1) + "%" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
}
