import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { brl, uid, type Entrada, type ItemEntrada, type Produto } from "../types";
import { importarPorChaveSefaz, lerXmlNfe, limparChaveNfe, nfeBridgeAtivo, validarChaveNfe, XML_EXEMPLO } from "../xmlNfe";
import { Badge, Button, Card, Field, PageHeader } from "../ui";
import { cn } from "../../utils/cn";
import { dataLocal, normalizar } from "../filtros";

/**
 * Entrada de mercadoria — fluxo inspirado no HOTLINE / ERPs de varejo:
 * 1) Importar XML ou chave SEFAZ (ou digitar manual)
 * 2) Tela de TRATAMENTO: vincular produto fornecedor ↔ cadastro interno,
 *    margem/markup, preço de venda, quantidade de entrada
 * 3) Salvar pendente → lançar no estoque
 */

type AbaEnt = "lista" | "xml" | "sefaz" | "manual";

const r2 = (n: number) => Math.round(n * 100) / 100;
const markupDe = (custo: number, preco: number) =>
  custo > 0 ? r2(((preco - custo) / custo) * 100) : 0;
const margemDe = (custo: number, preco: number) =>
  preco > 0 ? r2(((preco - custo) / preco) * 100) : 0;

const itemVazio = (): ItemEntrada => ({
  produtoId: null,
  nome: "",
  nomeFornecedor: "",
  sku: "",
  ncm: "",
  cfop: "1102",
  unidade: "UN",
  qtd: 1,
  qtdNota: 1,
  custo: 0,
  preco: 0,
  gtin: "",
});

function casarProduto(dbProdutos: Produto[], item: ItemEntrada): Produto | undefined {
  if (item.produtoId) return dbProdutos.find((p) => p.id === item.produtoId);
  const gtin = (item.gtin || "").replace(/\D/g, "");
  if (gtin.length >= 8) {
    const g = dbProdutos.find((p) => (p.gtin || "").replace(/\D/g, "") === gtin);
    if (g) return g;
  }
  if (item.sku) {
    const s = dbProdutos.find((p) => p.sku && p.sku.toLowerCase() === item.sku.toLowerCase());
    if (s) return s;
  }
  const nome = normalizar(item.nomeFornecedor || item.nome);
  if (nome.length >= 3) {
    const exato = dbProdutos.find((p) => normalizar(p.nome) === nome);
    if (exato) return exato;
    return dbProdutos.find((p) => normalizar(p.nome).includes(nome) || nome.includes(normalizar(p.nome)));
  }
  return undefined;
}

function prepararTratamento(entrada: Entrada, produtos: Produto[], markupPadrao = 80): Entrada {
  const itens = entrada.itens.map((it) => {
    const p = casarProduto(produtos, it);
    const custo = it.custo;
    const precoBase = p?.preco && p.preco > 0 ? p.preco : r2(custo * (1 + markupPadrao / 100));
    return {
      ...it,
      nomeFornecedor: it.nomeFornecedor || it.nome,
      qtdNota: it.qtdNota ?? it.qtd,
      produtoId: p?.id ?? null,
      nome: p?.nome ?? it.nome,
      sku: p?.sku || it.sku,
      preco: precoBase,
      gtin: it.gtin || (p && p.gtin !== "SEM GTIN" ? p.gtin : undefined),
      unidade: it.unidade || p?.unidade || "UN",
      ncm: it.ncm || p?.impostos?.ncm || "",
      cfop: it.cfop || p?.impostos?.cfop || "1102",
    };
  });
  return { ...entrada, itens };
}

/** Busca de produto por nome (autocomplete) — entrada manual e tratamento */
function BuscaProduto({
  valorNome,
  produtoId,
  produtos,
  onEscolher,
  onNomeLivre,
}: {
  valorNome: string;
  produtoId: string | null;
  produtos: Produto[];
  onEscolher: (p: Produto | null) => void;
  onNomeLivre: (nome: string) => void;
}) {
  const [q, setQ] = useState(valorNome);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(valorNome), [valorNome]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const lista = useMemo(() => {
    const t = normalizar(q.trim());
    if (!t) return produtos.slice(0, 8);
    return produtos
      .filter(
        (p) =>
          normalizar(p.nome).includes(t) ||
          normalizar(p.sku).includes(t) ||
          (p.gtin || "").includes(t.replace(/\D/g, "")),
      )
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .slice(0, 12);
  }, [q, produtos]);

  return (
    <div ref={ref} className="relative min-w-[180px]">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          onNomeLivre(e.target.value);
          onEscolher(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Digite o nome do produto…"
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-sky-500"
      />
      {produtoId && (
        <span className="mt-0.5 block text-[10px] font-semibold text-emerald-600">✓ vinculado ao cadastro</span>
      )}
      {open && lista.length > 0 && (
        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {lista.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full flex-col px-3 py-1.5 text-left text-xs hover:bg-sky-50"
                onClick={() => {
                  setQ(p.nome);
                  onEscolher(p);
                  setOpen(false);
                }}
              >
                <span className="font-semibold text-slate-800">{p.nome}</span>
                <span className="text-[10px] text-slate-400">
                  {p.sku} · est. {p.estoque} · custo {brl(p.custo)} · venda {brl(p.preco)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tela de tratamento pós-importação (XML ou SEFAZ) — estilo HOTLINE */
function TelaTratamento({
  entrada,
  setEntrada,
  produtos,
  fornecedores,
  onCancelar,
  onSalvar,
}: {
  entrada: Entrada;
  setEntrada: (e: Entrada) => void;
  produtos: Produto[];
  fornecedores: { id: string; nome: string; cnpj: string }[];
  onCancelar: () => void;
  onSalvar: () => void;
}) {
  const [markupLote, setMarkupLote] = useState("80");
  const [fornId, setFornId] = useState("");

  const setItem = (i: number, patch: Partial<ItemEntrada>) => {
    setEntrada({
      ...entrada,
      itens: entrada.itens.map((it, k) => (k === i ? { ...it, ...patch } : it)),
    });
  };

  const aplicarMarkupLote = () => {
    const mk = Number(String(markupLote).replace(",", ".")) || 0;
    setEntrada({
      ...entrada,
      itens: entrada.itens.map((it) => ({
        ...it,
        preco: r2(it.custo * (1 + mk / 100)),
      })),
    });
  };

  const vincular = (i: number, p: Produto | null) => {
    if (!p) {
      setItem(i, { produtoId: null });
      return;
    }
    setItem(i, {
      produtoId: p.id,
      nome: p.nome,
      sku: p.sku,
      gtin: entrada.itens[i].gtin || (p.gtin !== "SEM GTIN" ? p.gtin : undefined),
      unidade: entrada.itens[i].unidade || p.unidade,
      ncm: entrada.itens[i].ncm || p.impostos?.ncm || "",
      // mantém custo da nota; preço: se já tem no cadastro, sugere o atual
      preco: p.preco > 0 ? p.preco : entrada.itens[i].preco,
    });
  };

  const vinculados = entrada.itens.filter((i) => i.produtoId).length;
  const novos = entrada.itens.length - vinculados;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-slate-900/60 p-3">
      <div className="my-auto flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Tratamento da importação</h3>
            <p className="text-xs text-slate-500">
              Relacione o item do fornecedor ao cadastro interno, ajuste margem, preço e quantidade — depois salve a
              entrada.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge tone="sky">{entrada.origem === "sefaz" ? "SEFAZ / chave" : entrada.origem === "xml" ? "XML" : "Manual"}</Badge>
            <Badge tone="green">{vinculados} vinculados</Badge>
            <Badge tone="amber">{novos} novos</Badge>
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 px-5 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="text-[11px] text-slate-400">Fornecedor</span>
            <p className="font-semibold text-slate-800">{entrada.fornecedor}</p>
            <p className="text-[11px] text-slate-500">{entrada.cnpjFornecedor}</p>
          </div>
          <div>
            <span className="text-[11px] text-slate-400">Nota</span>
            <p className="font-semibold text-slate-800">
              {entrada.numeroNota} / série {entrada.serie}
            </p>
            <p className="text-[11px] text-slate-500">
              Emissão {new Date(entrada.emissao + "T12:00").toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div className="min-w-0 sm:col-span-2">
            <span className="text-[11px] text-slate-400">Chave de acesso</span>
            <p className="break-all font-mono text-[11px] text-slate-600">{entrada.chave || "—"}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-5 py-3">
          <label className="text-xs font-medium text-slate-600">
            Vincular fornecedor do cadastro
            <select
              value={fornId}
              onChange={(e) => {
                const id = e.target.value;
                setFornId(id);
                const forn = fornecedores.find((x) => x.id === id);
                if (forn) setEntrada({ ...entrada, fornecedor: forn.nome, cnpjFornecedor: forn.cnpj });
              }}
              className="mt-1 block w-56 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">— manter da nota —</option>
              {fornecedores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Markup em lote %
            <input
              value={markupLote}
              onChange={(e) => setMarkupLote(e.target.value)}
              className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <Button variant="soft" onClick={aplicarMarkupLote}>
            Aplicar markup em todos
          </Button>
          <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={entrada.gerarFinanceiro}
              onChange={(e) => setEntrada({ ...entrada, gerarFinanceiro: e.target.checked })}
              className="accent-sky-600"
            />
            Gerar conta a pagar
          </label>
          <p className="text-lg font-black text-slate-900">{brl(entrada.total)}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-slate-100 text-left text-slate-500">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Item no XML / fornecedor</th>
                <th className="px-2 py-2">Produto interno (busca por nome)</th>
                <th className="px-2 py-2 text-right">Qtd nota</th>
                <th className="px-2 py-2 text-right">Qtd entrada</th>
                <th className="px-2 py-2 text-right">Custo</th>
                <th className="px-2 py-2 text-right">Markup %</th>
                <th className="px-2 py-2 text-right">Margem %</th>
                <th className="px-2 py-2 text-right">Preço venda</th>
                <th className="px-2 py-2">Vínculo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entrada.itens.map((it, i) => {
                const mk = markupDe(it.custo, it.preco);
                const mg = margemDe(it.custo, it.preco);
                const qtdNota = it.qtdNota ?? it.qtd;
                const diverg = it.qtd !== qtdNota;
                return (
                  <tr key={i} className="hover:bg-slate-50/80">
                    <td className="px-2 py-2 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2">
                      <p className="font-medium text-slate-700">{it.nomeFornecedor || it.nome}</p>
                      <p className="text-[10px] text-slate-400">
                        SKU forn. {it.sku || "—"}
                        {it.gtin ? ` · EAN ${it.gtin}` : ""} · NCM {it.ncm || "—"} · CFOP {it.cfop}
                      </p>
                    </td>
                    <td className="px-2 py-2">
                      <BuscaProduto
                        valorNome={it.nome}
                        produtoId={it.produtoId}
                        produtos={produtos}
                        onNomeLivre={(nome) => setItem(i, { nome, produtoId: null })}
                        onEscolher={(p) => vincular(i, p)}
                      />
                    </td>
                    <td className="px-2 py-2 text-right text-slate-500">{qtdNota}</td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={it.qtd}
                        onChange={(e) => setItem(i, { qtd: Number(e.target.value) })}
                        className={cn(
                          "w-16 rounded border px-1 py-1 text-right",
                          diverg ? "border-amber-400 bg-amber-50" : "border-slate-300",
                        )}
                      />
                    </td>
                    <td className="px-2 py-2 text-right text-slate-600">{brl(it.custo)}</td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={mk}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          setItem(i, { preco: r2(it.custo * (1 + m / 100)) });
                        }}
                        className="w-16 rounded border border-slate-300 px-1 py-1 text-right"
                      />
                    </td>
                    <td className={cn("px-2 py-2 text-right font-bold", mg < 0 ? "text-rose-600" : "text-emerald-700")}>
                      {mg}%
                    </td>
                    <td className="px-2 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.preco}
                        onChange={(e) => setItem(i, { preco: Number(e.target.value) })}
                        className="w-20 rounded border border-slate-300 px-1 py-1 text-right font-semibold"
                      />
                    </td>
                    <td className="px-2 py-2">
                      {it.produtoId ? (
                        <Badge tone="green">Atualiza cadastro</Badge>
                      ) : (
                        <Badge tone="amber">Cria novo</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <p className="text-xs text-slate-500">
            Qtd entrada amarela = divergente da nota. Itens sem vínculo serão <b>criados</b> no cadastro ao lançar o
            estoque.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancelar}>
              Cancelar
            </Button>
            <Button onClick={onSalvar}>Salvar entrada tratada</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Entradas() {
  const { db, addEntrada, lancarEntrada, delEntrada } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aba, setAba] = useState<AbaEnt>("lista");
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tratamento, setTratamento] = useState<Entrada | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [chave, setChave] = useState("");
  const [consultando, setConsultando] = useState(false);

  const [man, setMan] = useState({
    numeroNota: "",
    serie: "1",
    chave: "",
    fornecedor: "",
    cnpjFornecedor: "",
    emissao: dataLocal(),
    gerarFinanceiro: true,
    markupPadrao: "50",
  });
  const [itensMan, setItensMan] = useState<ItemEntrada[]>([itemVazio()]);
  const [fornManId, setFornManId] = useState("");

  function abrirTratamento(entrada: Entrada) {
    setErro(null);
    setInfo(null);
    setTratamento(prepararTratamento(entrada, db.produtos, 80));
  }

  useEffect(() => {
    const xml = sessionStorage.getItem("nkway.dfe.xml");
    if (!xml) return;
    sessionStorage.removeItem("nkway.dfe.xml");
    const r = lerXmlNfe(xml);
    if (!r.ok) {
      setErro(r.erro);
      return;
    }
    setInfo("XML recebido do módulo DF-e. Conclua o tratamento e salve a entrada.");
    abrirTratamento(r.entrada);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function processarXml(conteudo: string) {
    const r = lerXmlNfe(conteudo);
    if (!r.ok) return setErro(r.erro);
    abrirTratamento(r.entrada);
  }

  async function processarChave() {
    setErro(null);
    setInfo(null);
    setConsultando(true);
    const r = await importarPorChaveSefaz(chave);
    setConsultando(false);
    if (!r.ok) return setErro(r.erro);
    setInfo("XML obtido (demonstração SEFAZ). Trate os itens antes de salvar.");
    abrirTratamento(r.entrada);
  }

  function onFile(f: File) {
    const reader = new FileReader();
    reader.onload = () => processarXml(String(reader.result));
    reader.readAsText(f, "ISO-8859-1");
  }

  function setItemMan(i: number, patch: Partial<ItemEntrada>) {
    setItensMan((xs) => xs.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  }

  function salvarManual() {
    setErro(null);
    if (!man.fornecedor.trim() && !fornManId) {
      setErro("Informe o fornecedor.");
      return;
    }
    const itens = itensMan.filter((it) => it.nome.trim() && it.qtd > 0);
    if (!itens.length) {
      setErro("Inclua ao menos um item com nome e quantidade.");
      return;
    }
    const forn = db.fornecedores.find((x) => x.id === fornManId);
    const total = r2(itens.reduce((s, it) => s + it.qtd * it.custo, 0));
    const entrada: Entrada = {
      id: uid(),
      numeroNota: man.numeroNota.trim() || String(Date.now()).slice(-6),
      serie: man.serie.trim() || "1",
      chave: man.chave.trim(),
      fornecedor: forn?.nome || man.fornecedor.trim(),
      cnpjFornecedor: forn?.cnpj || man.cnpjFornecedor.trim(),
      itens: itens.map((it) => ({
        ...it,
        nomeFornecedor: it.nomeFornecedor || it.nome,
        qtdNota: it.qtdNota ?? it.qtd,
      })),
      total,
      emissao: man.emissao || dataLocal(),
      status: "pendente",
      origem: "manual",
      gerarFinanceiro: man.gerarFinanceiro,
    };
    // manual também passa pelo tratamento se quiser ajustar — aqui já tem busca por nome;
    // salva direto como pendente (já tratado na digitação)
    addEntrada(entrada);
    setItensMan([itemVazio()]);
    setMan((m) => ({ ...m, numeroNota: "", chave: "" }));
    setAba("lista");
    setAberta(entrada.id);
    setInfo("Entrada manual salva. Use “Lançar estoque” na lista.");
  }

  const pendentes = db.entradas.filter((e) => e.status !== "lancada");
  const totalPendente = pendentes.reduce((s, e) => s + e.total, 0);
  const chaveOk = validarChaveNfe(chave);

  return (
    <div>
      <PageHeader
        title="Entrada de mercadoria"
        subtitle="XML · chave SEFAZ · manual — com tratamento de preço, margem e vínculo de produtos"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => { setAba("xml"); setErro(null); }}>
              📥 XML
            </Button>
            <Button variant="ghost" onClick={() => { setAba("sefaz"); setErro(null); }}>
              🔑 Chave SEFAZ
            </Button>
            <Button onClick={() => { setAba("manual"); setErro(null); }}>✍ Manual</Button>
          </div>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept=".xml,text/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {(
          [
            ["lista", "📋 Notas"],
            ["xml", "📥 XML"],
            ["sefaz", "🔑 Chave SEFAZ"],
            ["manual", "✍ Manual"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setAba(id);
              setErro(null);
            }}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {erro && (
        <div className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">⚠️ {erro}</div>
      )}
      {info && (
        <div className="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-sm font-medium text-sky-800">{info}</div>
      )}

      {/* ---------- XML ---------- */}
      {aba === "xml" && (
        <div className="mb-5 space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) onFile(f);
            }}
            onClick={() => fileRef.current?.click()}
            className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center transition hover:border-sky-400 hover:bg-sky-50/40"
          >
            <p className="text-3xl">📥</p>
            <p className="mt-2 text-sm font-semibold text-slate-700">Arraste o XML da NF-e do fornecedor</p>
            <p className="text-xs text-slate-400">Após a leitura, abre a tela de tratamento (vínculo, margem, qtd)</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fileRef.current?.click()}>⬆ Escolher arquivo XML</Button>
            <Button variant="ghost" onClick={() => processarXml(XML_EXEMPLO)}>
              Usar XML de exemplo
            </Button>
          </div>
        </div>
      )}

      {/* ---------- SEFAZ chave ---------- */}
      {aba === "sefaz" && (
        <Card className="mb-5 p-5">
          <h3 className="text-base font-bold text-slate-900">Importar pela chave de acesso (SEFAZ)</h3>
          <p className="mt-1 text-xs text-slate-500">
            Informe a chave de 44 dígitos da NF-e.
            {nfeBridgeAtivo() ? (
              <> Bridge configurado (<code className="text-[10px]">VITE_NFE_BRIDGE_URL</code>) — consulta real no seu servidor.</>
            ) : (
              <> Modo DEMO (sem bridge). Para produção, configure <code className="text-[10px]">VITE_NFE_BRIDGE_URL</code> no arquivo <code className="text-[10px]">.env</code>.</>
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="min-w-[280px] flex-1 text-xs font-medium text-slate-600">
              Chave de acesso
              <input
                value={chave}
                onChange={(e) => setChave(e.target.value)}
                placeholder="3526 11 12.345.678/0001-90 55 001 000000123 …"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-sky-500"
              />
              <span className={cn("mt-1 block text-[11px]", chaveOk ? "text-emerald-600" : "text-slate-400")}>
                {limparChaveNfe(chave).length}/44 dígitos {chaveOk ? "· chave válida" : ""}
              </span>
            </label>
            <Button onClick={processarChave} className={consultando ? "opacity-70" : ""}>
              {consultando ? "Consultando SEFAZ…" : "🔑 Buscar na SEFAZ"}
            </Button>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Produção: servidor bridge com certificado A1 + senha (nunca no navegador). Endpoint: POST /nfe/por-chave → {"{ xml }"}.
          </p>
        </Card>
      )}

      {/* ---------- MANUAL ---------- */}
      {aba === "manual" && (
        <Card className="mb-5 p-5">
          <h3 className="mb-1 text-base font-bold text-slate-900">Entrada manual</h3>
          <p className="mb-4 text-xs text-slate-500">
            Pesquise o produto <b>pelo nome</b> (como no HOTLINE). Sem cadastro, digite o nome para criar na entrada.
          </p>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
              Fornecedor cadastrado
              <select
                value={fornManId}
                onChange={(e) => {
                  const id = e.target.value;
                  setFornManId(id);
                  const forn = db.fornecedores.find((x) => x.id === id);
                  if (forn) setMan((m) => ({ ...m, fornecedor: forn.nome, cnpjFornecedor: forn.cnpj }));
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              >
                <option value="">— digitar manualmente —</option>
                {db.fornecedores.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome} · {f.cnpj}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Fornecedor (nome)" value={man.fornecedor} onChange={(e) => setMan({ ...man, fornecedor: e.target.value })} />
            <Field label="CNPJ" value={man.cnpjFornecedor} onChange={(e) => setMan({ ...man, cnpjFornecedor: e.target.value })} />
            <Field label="Nº da nota" value={man.numeroNota} onChange={(e) => setMan({ ...man, numeroNota: e.target.value })} />
            <Field label="Série" value={man.serie} onChange={(e) => setMan({ ...man, serie: e.target.value })} />
            <Field label="Emissão" type="date" value={man.emissao} onChange={(e) => setMan({ ...man, emissao: e.target.value })} />
            <Field label="Markup padrão %" value={man.markupPadrao} onChange={(e) => setMan({ ...man, markupPadrao: e.target.value })} />
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800">Itens</h4>
            <Button variant="ghost" onClick={() => setItensMan((xs) => [...xs, itemVazio()])}>
              + Item
            </Button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-2 py-2">Produto (busca por nome)</th>
                  <th className="px-2 py-2">SKU</th>
                  <th className="px-2 py-2 text-right">Qtd</th>
                  <th className="px-2 py-2 text-right">Custo</th>
                  <th className="px-2 py-2 text-right">Markup %</th>
                  <th className="px-2 py-2 text-right">Preço venda</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itensMan.map((it, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">
                      <BuscaProduto
                        valorNome={it.nome}
                        produtoId={it.produtoId}
                        produtos={db.produtos}
                        onNomeLivre={(nome) => setItemMan(i, { nome, nomeFornecedor: nome, produtoId: null })}
                        onEscolher={(p) => {
                          if (!p) return setItemMan(i, { produtoId: null });
                          const mk = Number(String(man.markupPadrao).replace(",", ".")) || 0;
                          setItemMan(i, {
                            produtoId: p.id,
                            nome: p.nome,
                            nomeFornecedor: p.nome,
                            sku: p.sku,
                            ncm: p.impostos?.ncm ?? "",
                            cfop: p.impostos?.cfop || "1102",
                            unidade: p.unidade || "UN",
                            custo: p.custo,
                            preco: p.preco || r2(p.custo * (1 + mk / 100)),
                            gtin: p.gtin === "SEM GTIN" ? "" : p.gtin,
                          });
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={it.sku}
                        onChange={(e) => setItemMan(i, { sku: e.target.value })}
                        className="w-20 rounded border border-slate-300 px-1 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={it.qtd}
                        onChange={(e) => setItemMan(i, { qtd: Number(e.target.value), qtdNota: Number(e.target.value) })}
                        className="w-16 rounded border border-slate-300 px-1 py-1 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.custo}
                        onChange={(e) => {
                          const custo = Number(e.target.value);
                          const mk = Number(String(man.markupPadrao).replace(",", ".")) || 0;
                          setItemMan(i, { custo, preco: r2(custo * (1 + mk / 100)) });
                        }}
                        className="w-20 rounded border border-slate-300 px-1 py-1 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={markupDe(it.custo, it.preco)}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          setItemMan(i, { preco: r2(it.custo * (1 + m / 100)) });
                        }}
                        className="w-16 rounded border border-slate-300 px-1 py-1 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={it.preco}
                        onChange={(e) => setItemMan(i, { preco: Number(e.target.value) })}
                        className="w-20 rounded border border-slate-300 px-1 py-1 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {itensMan.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setItensMan((xs) => xs.filter((_, k) => k !== i))}
                          className="text-rose-500 hover:underline"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={man.gerarFinanceiro}
                onChange={(e) => setMan({ ...man, gerarFinanceiro: e.target.checked })}
                className="accent-sky-600"
              />
              Gerar conta a pagar (30 dias)
            </label>
            <p className="text-lg font-bold text-slate-900">
              Total {brl(itensMan.reduce((s, it) => s + it.qtd * it.custo, 0))}
            </p>
            <Button onClick={salvarManual}>Salvar entrada manual</Button>
          </div>
        </Card>
      )}

      {/* ---------- LISTA ---------- */}
      {aba === "lista" && (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-amber-500 p-4">
              <p className="text-xs uppercase text-slate-500">Notas a conferir</p>
              <p className="mt-1 text-xl font-bold text-amber-600">{pendentes.length}</p>
            </Card>
            <Card className="border-l-4 border-l-rose-500 p-4">
              <p className="text-xs uppercase text-slate-500">Valor pendente</p>
              <p className="mt-1 text-xl font-bold text-rose-600">{brl(totalPendente)}</p>
            </Card>
            <Card className="border-l-4 border-l-emerald-500 p-4">
              <p className="text-xs uppercase text-slate-500">Notas lançadas</p>
              <p className="mt-1 text-xl font-bold text-emerald-600">
                {db.entradas.filter((e) => e.status === "lancada").length}
              </p>
            </Card>
          </div>

          {db.entradas.length === 0 ? (
            <Card className="p-12 text-center text-slate-400">
              Nenhuma nota. Use <b>XML</b>, <b>Chave SEFAZ</b> ou <b>Manual</b>.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Nota</th>
                      <th className="px-4 py-3">Fornecedor</th>
                      <th className="px-4 py-3">Emissão</th>
                      <th className="px-4 py-3">Itens</th>
                      <th className="px-4 py-3">Situação</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {db.entradas.map((e) => (
                      <Fragment key={e.id}>
                        <tr
                          className="cursor-pointer hover:bg-slate-50/70"
                          onClick={() => setAberta(aberta === e.id ? null : e.id)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-sky-700">NF-e {e.numeroNota}</p>
                            <p className="text-[10px] text-slate-400">
                              Série {e.serie} ·{" "}
                              {e.origem === "sefaz" ? "SEFAZ" : e.origem === "xml" ? "XML" : "manual"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-slate-700">{e.fornecedor}</p>
                            <p className="text-[10px] text-slate-400">{e.cnpjFornecedor}</p>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(e.emissao + "T12:00").toLocaleDateString("pt-BR")}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{e.itens.length}</td>
                          <td className="px-4 py-3">
                            {e.status === "lancada" ? (
                              <Badge tone="green">Lançada no estoque</Badge>
                            ) : (
                              <Badge tone="amber">Aguardando conferência</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">{brl(e.total)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            {e.status !== "lancada" && (
                              <>
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    abrirTratamento(e);
                                  }}
                                  className="mr-3 text-xs font-semibold text-sky-600 hover:underline"
                                >
                                  Tratar
                                </button>
                                <button
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    lancarEntrada(e.id);
                                  }}
                                  className="mr-3 text-xs font-semibold text-emerald-600 hover:underline"
                                >
                                  Lançar estoque
                                </button>
                              </>
                            )}
                            <button
                              onClick={(ev) => {
                                ev.stopPropagation();
                                delEntrada(e.id);
                              }}
                              className="text-xs font-semibold text-rose-500 hover:underline"
                            >
                              Excluir
                            </button>
                          </td>
                        </tr>
                        {aberta === e.id && (
                          <tr className="bg-slate-50">
                            <td colSpan={7} className="px-8 py-3">
                              <table className="w-full text-xs">
                                <thead className="text-slate-400">
                                  <tr>
                                    <th className="py-1 text-left">Fornecedor / XML</th>
                                    <th className="py-1 text-left">Interno</th>
                                    <th className="py-1 text-right">Qtd</th>
                                    <th className="py-1 text-right">Custo</th>
                                    <th className="py-1 text-right">Venda</th>
                                    <th className="py-1 text-right">Margem</th>
                                  </tr>
                                </thead>
                                <tbody className="text-slate-600">
                                  {e.itens.map((i, k) => (
                                    <tr key={k}>
                                      <td className="py-1">{i.nomeFornecedor || i.nome}</td>
                                      <td className="py-1">
                                        {i.nome}
                                        {i.produtoId ? (
                                          <span className="ml-1 text-emerald-600">✓</span>
                                        ) : (
                                          <span className="ml-1 text-amber-600">novo</span>
                                        )}
                                      </td>
                                      <td className="py-1 text-right">
                                        {i.qtd}
                                        {i.qtdNota != null && i.qtdNota !== i.qtd ? (
                                          <span className="text-amber-600"> (nota {i.qtdNota})</span>
                                        ) : null}{" "}
                                        {i.unidade}
                                      </td>
                                      <td className="py-1 text-right">{brl(i.custo)}</td>
                                      <td className="py-1 text-right text-emerald-600">{brl(i.preco)}</td>
                                      <td className="py-1 text-right">{margemDe(i.custo, i.preco)}%</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {e.chave && (
                                <p className="mt-2 break-all font-mono text-[10px] text-slate-400">Chave: {e.chave}</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tratamento && (
        <TelaTratamento
          entrada={tratamento}
          setEntrada={setTratamento}
          produtos={db.produtos}
          fornecedores={db.fornecedores}
          onCancelar={() => setTratamento(null)}
          onSalvar={() => {
            const e = { ...tratamento, id: tratamento.id || uid(), status: "pendente" as const };
            // se já existia (re-tratar), remove a antiga e adiciona
            if (db.entradas.some((x) => x.id === e.id)) {
              delEntrada(e.id);
            }
            addEntrada(e);
            setTratamento(null);
            setAba("lista");
            setAberta(e.id);
            setInfo("Entrada salva com tratamento. Clique em “Lançar estoque” quando quiser baixar o estoque.");
          }}
        />
      )}
    </div>
  );
}
