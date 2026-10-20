import { Fragment, useMemo, useState } from "react";
import { useStore } from "../store";
import { useAuth } from "../auth";
import { usePlan } from "../plan";
import { brl, type ModeloFiscal, type Venda } from "../types";
import { Badge, Button, Card, PageHeader } from "../ui";
import Documento from "../Documento";
import { filaAtual } from "../offline";
import { useOffline } from "../useOffline";
import {
  ROTULO_PERIODO,
  casaTexto,
  dataLocal,
  dentroDoIntervalo,
  intervaloPeriodo,
  lerNumero,
  useFiltrosSalvos,
  type PresetPeriodo,
} from "../filtros";
import { BuscaGlobal, ChipAtivo, IntervaloFiltro, LinhaFiltros, MultiSelectFiltro, PainelFiltros, SelectFiltro, inputFiltro } from "../FiltroUI";
import { cn } from "../../utils/cn";

const MODELOS: ModeloFiscal[] = ["NFC-e", "NF-e", "SAT"];
type Forma = Venda["pagamento"];
const FORMAS: Forma[] = ["dinheiro", "pix", "debito", "credito", "boleto", "prazo"];
const rotuloForma = (p: Forma) => (p === "prazo" ? "a prazo" : p === "debito" ? "débito" : p === "credito" ? "crédito" : p);

type StatusDav = "aberto" | "vencido" | "faturado" | "cancelado";
type StatusFiscal = "autorizada" | "cancelada";
type Agrupar = "nenhum" | "dia" | "forma" | "cliente" | "modelo" | "status";
type Extra = "desconto" | "troco" | "dividido" | "frete" | "pendente";

const STATUS_DAV: { valor: StatusDav; rotulo: string; tom: "amber" | "red" | "green" | "slate" }[] = [
  { valor: "aberto", rotulo: "Em aberto", tom: "amber" },
  { valor: "vencido", rotulo: "Vencido", tom: "red" },
  { valor: "faturado", rotulo: "Faturado", tom: "green" },
  { valor: "cancelado", rotulo: "Cancelado", tom: "slate" },
];
const STATUS_FISCAL: { valor: StatusFiscal; rotulo: string; tom: "green" | "slate" }[] = [
  { valor: "autorizada", rotulo: "Autorizada", tom: "green" },
  { valor: "cancelada", rotulo: "Cancelada", tom: "slate" },
];
const EXTRAS: { valor: Extra; rotulo: string }[] = [
  { valor: "desconto", rotulo: "Com desconto" },
  { valor: "troco", rotulo: "Com troco" },
  { valor: "dividido", rotulo: "Pagamento dividido" },
  { valor: "frete", rotulo: "Com frete" },
  { valor: "pendente", rotulo: "Não sincronizada" },
];
const PRESETS: PresetPeriodo[] = ["todos", "hoje", "ontem", "ult7", "ult30", "mes", "mesAnterior", "personalizado"];
const ROTULO_AGRUPAR: Record<Agrupar, string> = {
  nenhum: "Sem agrupamento",
  dia: "Dia",
  forma: "Forma de pagamento",
  cliente: "Cliente",
  modelo: "Modelo fiscal",
  status: "Situação",
};

const FILTROS_PADRAO = {
  busca: "",
  periodo: "todos" as PresetPeriodo,
  de: "",
  ate: "",
  statusDav: [] as StatusDav[],
  statusFiscal: [] as StatusFiscal[],
  formas: [] as Forma[],
  formaModo: "principal" as "principal" | "qualquer",
  cliente: "",
  modelos: [] as ModeloFiscal[],
  produtoId: "",
  categorias: [] as string[],
  extras: [] as Extra[],
  totalDe: "",
  totalAte: "",
  notaDe: "",
  notaAte: "",
  horaDe: "",
  horaAte: "",
  agrupar: "nenhum" as Agrupar,
  avancado: false,
};

const fmtData = (iso: string) => (iso ? new Date(iso + "T12:00").toLocaleDateString("pt-BR") : "");
const horaDe = (ts: number) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function Vendas({ abaInicial = "dav" }: { abaInicial?: "dav" | "fiscal" }) {
  const { db, faturarDav, cancelarVenda } = useStore();
  const { conta } = useAuth();
  const { podeUsar } = usePlan();
  const { fila } = useOffline(conta?.id);
  const [aba, setAba] = useState<"dav" | "fiscal">(abaInicial);
  const [aberta, setAberta] = useState<string | null>(null);
  const [verDoc, setVerDoc] = useState<Venda | null>(null);
  const [faturar, setFaturar] = useState<Venda | null>(null);
  const [modelo, setModelo] = useState<ModeloFiscal>("NFC-e");
  const [pag, setPag] = useState<Venda["pagamento"]>("pix");
  const [cancelando, setCancelando] = useState<Venda | null>(null);
  const [motivo, setMotivo] = useState("");
  const { f, set, toggle, limpar } = useFiltrosSalvos("vendas", FILTROS_PADRAO);

  const davs = db.vendas.filter((v) => v.tipo === "dav");
  const fiscais = db.vendas.filter((v) => v.tipo === "fiscal");
  const base = aba === "dav" ? davs : fiscais;

  const totalFiscal = fiscais.filter((v) => v.status !== "cancelado").reduce((s, v) => s + v.total, 0);
  const totalDavAberto = davs.filter((d) => d.status === "aberto").reduce((s, v) => s + v.total, 0);

  const hoje = dataLocal();
  const intervalo = intervaloPeriodo(f.periodo, f.de, f.ate);

  // ---- dados auxiliares
  const produtoPorId = useMemo(() => new Map(db.produtos.map((p) => [p.id, p])), [db.produtos]);
  const clientePorId = useMemo(() => new Map(db.clientes.map((c) => [c.id, c])), [db.clientes]);
  const motivoCanc = useMemo(() => new Map(db.cancelamentos.map((c) => [c.vendaId, c.motivo])), [db.cancelamentos]);
  const pendentes = useMemo(() => {
    const s = new Set<string>();
    filaAtual().forEach((x) => s.add(`${x.venda.numero}|${x.venda.total}`));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fila, db.vendas]);
  const clientes = useMemo(
    () => [...new Set(db.vendas.map((v) => v.clienteNome))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [db.vendas],
  );
  const categorias = useMemo(
    () => [...new Set(db.produtos.map((p) => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [db.produtos],
  );

  const statusDav = (v: Venda): StatusDav =>
    v.status === "cancelado" ? "cancelado"
      : v.status === "faturado" ? "faturado"
      : (v.validade ?? "") < hoje ? "vencido" : "aberto";
  const statusFiscal = (v: Venda): StatusFiscal => (v.status === "cancelado" ? "cancelada" : "autorizada");
  const formasDa = (v: Venda): Forma[] => (v.pagamentos?.length ? v.pagamentos.map((p) => p.forma) : [v.pagamento]);
  const naFila = (v: Venda) => pendentes.has(`${v.numero}|${v.total}`);

  const tMin = lerNumero(f.totalDe), tMax = lerNumero(f.totalAte);
  const nMin = lerNumero(f.notaDe), nMax = lerNumero(f.notaAte);

  const aplicar = (ignorarStatus = false) =>
    base.filter((v) => {
      if (!dentroDoIntervalo(dataLocal(new Date(v.data)), intervalo)) return false;
      if (!ignorarStatus) {
        if (aba === "dav" && f.statusDav.length && !f.statusDav.includes(statusDav(v))) return false;
        if (aba === "fiscal" && f.statusFiscal.length && !f.statusFiscal.includes(statusFiscal(v))) return false;
      }
      if (f.formas.length) {
        const ok = f.formaModo === "principal" ? f.formas.includes(v.pagamento) : formasDa(v).some((x) => f.formas.includes(x));
        if (!ok) return false;
      }
      if (f.cliente && v.clienteNome !== f.cliente) return false;
      if (aba === "fiscal" && f.modelos.length && !(v.fiscal && f.modelos.includes(v.fiscal.modelo))) return false;
      if (f.produtoId && !v.itens.some((i) => i.produtoId === f.produtoId)) return false;
      if (f.categorias.length && !v.itens.some((i) => f.categorias.includes(produtoPorId.get(i.produtoId)?.categoria ?? ""))) return false;
      for (const x of f.extras) {
        if (x === "desconto" && !(v.desconto > 0)) return false;
        if (x === "troco" && !((v.vTroco ?? 0) > 0)) return false;
        if (x === "dividido" && !((v.pagamentos?.length ?? 0) > 1)) return false;
        if (x === "frete" && !((v.vFrete ?? 0) > 0)) return false;
        if (x === "pendente" && !naFila(v)) return false;
      }
      if (Number.isFinite(tMin) && v.total < tMin) return false;
      if (Number.isFinite(tMax) && v.total > tMax) return false;
      if (aba === "fiscal" && (Number.isFinite(nMin) || Number.isFinite(nMax))) {
        const n = v.fiscal?.numeroNota ?? -1;
        if (Number.isFinite(nMin) && n < nMin) return false;
        if (Number.isFinite(nMax) && n > nMax) return false;
      }
      if (f.horaDe || f.horaAte) {
        const h = horaDe(v.data);
        if (f.horaDe && h < f.horaDe) return false;
        if (f.horaAte && h > f.horaAte) return false;
      }
      const cli = v.clienteId ? clientePorId.get(v.clienteId) : undefined;
      return casaTexto(f.busca, [
        v.numero, `#${v.numero}`, v.total, v.clienteNome, cli?.documento,
        v.fiscal?.numeroNota, v.fiscal?.chave, v.fiscal?.protocolo, v.fiscal?.modelo,
        ...v.itens.flatMap((i) => [i.nome, i.gtin, produtoPorId.get(i.produtoId)?.sku]),
        v.transporte?.transportadorNome, v.transporte?.placa, v.observacao, motivoCanc.get(v.id),
      ]);
    });

  const lista = aplicar();

  const contStatus = useMemo(() => {
    const c: Record<string, number> = {};
    aplicar(true).forEach((v) => { const s = aba === "dav" ? statusDav(v) : statusFiscal(v); c[s] = (c[s] ?? 0) + 1; });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, f, aba, hoje, pendentes]);

  // ---- resumo (cancelados não somam)
  const validos = lista.filter((v) => v.status !== "cancelado");
  const somaValidos = validos.reduce((s, v) => s + v.total, 0);
  const ticket = validos.length ? somaValidos / validos.length : 0;
  const porForma = useMemo(() => {
    const m = new Map<Forma, number>();
    validos.forEach((v) => {
      const partes = v.pagamentos?.length ? v.pagamentos : [{ forma: v.pagamento, valor: v.total }];
      // troco sai do dinheiro: o que fica no caixa é o recebido menos o troco
      let troco = v.vTroco ?? 0;
      partes.forEach((p) => {
        let valor = p.valor;
        if (p.forma === "dinheiro" && troco > 0) { const t = Math.min(troco, valor); valor -= t; troco -= t; }
        m.set(p.forma, Math.round(((m.get(p.forma) ?? 0) + valor) * 100) / 100);
      });
    });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [validos]);

  // ---- numeração fiscal pulada (precisa de inutilização na SEFAZ)
  const numerosPulados = useMemo(() => {
    if (aba !== "fiscal") return [];
    const usados = new Set(fiscais.map((v) => v.fiscal?.numeroNota).filter((n): n is number => n != null));
    if (!usados.size) return [];
    const inut = new Set<number>();
    db.inutilizacoes.forEach((i) => { for (let n = i.inicio; n <= i.fim; n++) inut.add(n); });
    const max = Math.max(...usados);
    const faltam: number[] = [];
    for (let n = 1; n <= max && faltam.length < 50; n++) if (!usados.has(n) && !inut.has(n)) faltam.push(n);
    return faltam;
  }, [aba, fiscais, db.inutilizacoes]);

  // ---- agrupamento
  const grupos = useMemo(() => {
    if (f.agrupar === "nenhum") return [{ chave: "", rotulo: "", itens: lista }];
    const mapa = new Map<string, { rotulo: string; itens: Venda[] }>();
    for (const v of lista) {
      let chave: string, rotulo: string;
      if (f.agrupar === "dia") { chave = dataLocal(new Date(v.data)); rotulo = fmtData(chave); }
      else if (f.agrupar === "forma") { chave = v.pagamento; rotulo = rotuloForma(v.pagamento); }
      else if (f.agrupar === "cliente") { chave = v.clienteNome; rotulo = v.clienteNome; }
      else if (f.agrupar === "modelo") { chave = v.fiscal?.modelo ?? "DAV"; rotulo = chave; }
      else { chave = aba === "dav" ? statusDav(v) : statusFiscal(v); rotulo = [...STATUS_DAV, ...STATUS_FISCAL].find((s) => s.valor === chave)?.rotulo ?? chave; }
      if (!mapa.has(chave)) mapa.set(chave, { rotulo, itens: [] });
      mapa.get(chave)!.itens.push(v);
    }
    const ent = [...mapa.entries()];
    ent.sort(([a], [b]) => (f.agrupar === "dia" ? b.localeCompare(a) : a.localeCompare(b, "pt-BR")));
    return ent.map(([chave, g]) => ({ chave, ...g }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, f.agrupar, aba]);

  // ---- chips de filtros ativos
  const ativos: { id: string; rotulo: string; remover: () => void }[] = [];
  if (f.busca.trim()) ativos.push({ id: "busca", rotulo: `Busca: “${f.busca.trim()}”`, remover: () => set("busca", "") });
  if (f.periodo !== "todos")
    ativos.push({
      id: "periodo",
      rotulo: f.periodo === "personalizado" ? `Data ${f.de ? fmtData(f.de) : "…"} a ${f.ate ? fmtData(f.ate) : "…"}` : ROTULO_PERIODO[f.periodo],
      remover: () => set("periodo", "todos"),
    });
  if (aba === "dav") f.statusDav.forEach((s) => ativos.push({ id: `sd-${s}`, rotulo: STATUS_DAV.find((x) => x.valor === s)!.rotulo, remover: () => set("statusDav", f.statusDav.filter((x) => x !== s)) }));
  else f.statusFiscal.forEach((s) => ativos.push({ id: `sf-${s}`, rotulo: STATUS_FISCAL.find((x) => x.valor === s)!.rotulo, remover: () => set("statusFiscal", f.statusFiscal.filter((x) => x !== s)) }));
  f.formas.forEach((p) => ativos.push({ id: `p-${p}`, rotulo: `${f.formaModo === "qualquer" ? "Inclui " : ""}${rotuloForma(p)}`, remover: () => set("formas", f.formas.filter((x) => x !== p)) }));
  if (f.cliente) ativos.push({ id: "cli", rotulo: `Cliente: ${f.cliente}`, remover: () => set("cliente", "") });
  if (aba === "fiscal") f.modelos.forEach((m) => ativos.push({ id: `m-${m}`, rotulo: m, remover: () => set("modelos", f.modelos.filter((x) => x !== m)) }));
  if (f.produtoId) ativos.push({ id: "prod", rotulo: `Contém: ${produtoPorId.get(f.produtoId)?.nome ?? "produto"}`, remover: () => set("produtoId", "") });
  f.categorias.forEach((c) => ativos.push({ id: `c-${c}`, rotulo: `Categoria: ${c}`, remover: () => set("categorias", f.categorias.filter((x) => x !== c)) }));
  f.extras.forEach((x) => ativos.push({ id: `x-${x}`, rotulo: EXTRAS.find((e) => e.valor === x)!.rotulo, remover: () => set("extras", f.extras.filter((y) => y !== x)) }));
  if (Number.isFinite(tMin)) ativos.push({ id: "tmin", rotulo: `Total ≥ ${brl(tMin)}`, remover: () => set("totalDe", "") });
  if (Number.isFinite(tMax)) ativos.push({ id: "tmax", rotulo: `Total ≤ ${brl(tMax)}`, remover: () => set("totalAte", "") });
  if (aba === "fiscal" && Number.isFinite(nMin)) ativos.push({ id: "nmin", rotulo: `Nota ≥ ${nMin}`, remover: () => set("notaDe", "") });
  if (aba === "fiscal" && Number.isFinite(nMax)) ativos.push({ id: "nmax", rotulo: `Nota ≤ ${nMax}`, remover: () => set("notaAte", "") });
  if (f.horaDe || f.horaAte) ativos.push({ id: "hora", rotulo: `Horário ${f.horaDe || "00:00"}–${f.horaAte || "23:59"}`, remover: () => { set("horaDe", ""); set("horaAte", ""); } });


  function renderLinha(v: Venda) {
    const vencido = v.tipo === "dav" && v.status === "aberto" && (v.validade ?? "") < hoje;
    return (
      <Fragment key={v.id}>
        <tr className="cursor-pointer hover:bg-slate-50/70" onClick={() => setAberta(aberta === v.id ? null : v.id)}>
          <td className="px-4 py-3 font-semibold text-sky-700">
            {v.tipo === "dav" ? "DAV" : v.fiscal?.modelo} #{v.numero}
            {v.fiscal && <span className="ml-1 text-[11px] font-normal text-slate-400">nº {v.fiscal.numeroNota}</span>}
            {naFila(v) && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-700" title="Ainda na fila offline">⟳</span>}
          </td>
          <td className="px-4 py-3 text-slate-700">{v.clienteNome}</td>
          <td className="px-4 py-3 text-slate-500">
            {new Date(v.data).toLocaleDateString("pt-BR")}
            <span className="ml-1 text-[11px] text-slate-400">{horaDe(v.data)}</span>
          </td>
          <td className="px-4 py-3 text-xs text-slate-500">
            {v.tipo === "dav"
              ? v.validade
                ? new Date(v.validade + "T12:00").toLocaleDateString("pt-BR")
                : "—"
              : `...${v.fiscal?.chave.slice(-12)}`}
          </td>
          <td className="px-4 py-3">
            {v.status === "cancelado" ? (
              <Badge tone="red">Cancelado</Badge>
            ) : v.status === "faturado" ? (
              <Badge tone="green">{v.tipo === "fiscal" ? "Autorizada" : "Faturado"}</Badge>
            ) : vencido ? (
              <Badge tone="red">Vencido</Badge>
            ) : (
              <Badge tone="amber">Em aberto</Badge>
            )}
          </td>
          <td className="px-4 py-3 text-right">
            <span className="font-semibold text-slate-900">{brl(v.total)}</span>
            <span className="block text-[11px] capitalize text-slate-400">
              {(v.pagamentos?.length ?? 0) > 1 ? v.pagamentos!.map((p) => rotuloForma(p.forma)).join(" + ") : rotuloForma(v.pagamento)}
            </span>
          </td>
          <td className="whitespace-nowrap px-4 py-3 text-right">
            <button
              onClick={(e) => { e.stopPropagation(); setVerDoc(v); }}
              className="mr-3 text-xs font-semibold text-sky-600 hover:underline"
            >
              Ver
            </button>
            {v.tipo === "dav" && v.status === "aberto" && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setPag(v.pagamento); setFaturar(v); }}
                  className="mr-3 text-xs font-semibold text-emerald-600 hover:underline"
                >
                  Faturar
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); cancelarVenda(v.id); }}
                  className="text-xs font-semibold text-rose-500 hover:underline"
                >
                  Cancelar
                </button>
              </>
            )}
            {v.tipo === "fiscal" && v.status === "faturado" && (() => {
              const limiteMin = db.configFiscal.ambiente === 2 ? 24 * 60 : 30;
              const minutos = Math.floor((Date.now() - (v.fiscal?.autorizadaEm ?? v.data)) / 60000);
              const dentro = minutos < limiteMin;
              return (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); setCancelando(v); setMotivo("Venda efetuada por erro"); }}
                    disabled={!dentro}
                    className={cn(
                      "mr-3 text-xs font-semibold",
                      dentro ? "text-rose-500 hover:underline" : "cursor-not-allowed text-slate-300",
                    )}
                  >
                    Cancelar{!dentro && ` (${Math.floor(minutos / 60)}h)`}
                  </button>
                  {!dentro && (
                    <span className="text-[10px] text-slate-300" title="Prazo SEFAZ para cancelamento expirado">expirado</span>
                  )}
                </>
              );
            })()}
          </td>
        </tr>
        {aberta === v.id && (
          <tr className="bg-slate-50">
            <td colSpan={7} className="px-8 py-3">
              <ul className="space-y-1 text-xs text-slate-600">
                {v.itens.map((i, idx) => (
                  <li key={`${i.produtoId}-${idx}`} className="flex justify-between">
                    <span>{i.qtd}x {i.nome}</span>
                    <span>{brl(i.qtd * i.preco)}</span>
                  </li>
                ))}
                {v.desconto > 0 && (
                  <li className="flex justify-between text-rose-600">
                    <span>Desconto</span><span>- {brl(v.desconto)}</span>
                  </li>
                )}
                {(v.pagamentos?.length ?? 0) > 1 && (
                  <li className="flex justify-between border-t border-slate-200 pt-1 capitalize text-slate-500">
                    <span>Pagamento</span>
                    <span>{v.pagamentos!.map((p) => `${rotuloForma(p.forma)} ${brl(p.valor)}`).join(" + ")}</span>
                  </li>
                )}
                {motivoCanc.get(v.id) && (
                  <li className="text-rose-600">Motivo do cancelamento: {motivoCanc.get(v.id)}</li>
                )}
              </ul>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  return (
    <div>
      <PageHeader
        title="Documentos de venda"
        subtitle={`${davs.length} DAVs · ${fiscais.length} notas emitidas · ${brl(totalFiscal)} faturado`}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-amber-500 p-4">
          <p className="text-xs uppercase text-slate-500">DAVs em aberto</p>
          <p className="mt-1 text-xl font-bold text-amber-600">{brl(totalDavAberto)}</p>
        </Card>
        <Card className="border-l-4 border-l-emerald-500 p-4">
          <p className="text-xs uppercase text-slate-500">Faturado com nota</p>
          <p className="mt-1 text-xl font-bold text-emerald-600">{brl(totalFiscal)}</p>
        </Card>
        <Card className="border-l-4 border-l-sky-500 p-4">
          <p className="text-xs uppercase text-slate-500">Notas autorizadas</p>
          <p className="mt-1 text-xl font-bold text-sky-700">{fiscais.filter((v) => v.status !== "cancelado").length}</p>
        </Card>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {([
          ["dav", `📄 DAVs (${davs.length})`],
          ["fiscal", `🧾 Notas fiscais (${fiscais.length})`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={cn(
              "flex-1 rounded-md px-5 py-2 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {numerosPulados.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          ⚠️ <b>Numeração fiscal pulada:</b> {numerosPulados.slice(0, 15).join(", ")}{numerosPulados.length > 15 ? "…" : ""}.
          {" "}Esses números precisam ser <b>inutilizados</b> na SEFAZ (PDV → F6 → Inutilizar).
        </div>
      )}

      {/* ============================ FILTROS ============================ */}
      <PainelFiltros>
        <BuscaGlobal
          value={f.busca}
          onChange={(v) => set("busca", v)}
          placeholder="Buscar nº da venda ou da nota, chave de acesso, cliente, CPF/CNPJ, produto, código de barras, placa…"
        />

        <LinhaFiltros>
          <SelectFiltro
            rotulo="Período"
            valor={f.periodo}
            padrao="todos"
            onChange={(v) => set("periodo", v)}
            opcoes={PRESETS.map((p) => ({ valor: p, rotulo: p === "personalizado" ? "Personalizado (de / até)…" : ROTULO_PERIODO[p] }))}
          />
          {f.periodo === "personalizado" && (
            <IntervaloFiltro rotulo="Datas">
              de <input type="date" value={f.de} onChange={(e) => set("de", e.target.value)} className={inputFiltro} aria-label="Data de" />
              até <input type="date" value={f.ate} onChange={(e) => set("ate", e.target.value)} className={inputFiltro} aria-label="Data até" />
            </IntervaloFiltro>
          )}
          {aba === "dav" ? (
            <MultiSelectFiltro rotulo="Situação" opcoes={STATUS_DAV} selecionados={f.statusDav} contagem={contStatus}
              onToggle={(v) => toggle("statusDav", v)} onLimpar={() => set("statusDav", [])} />
          ) : (
            <MultiSelectFiltro rotulo="Situação" opcoes={STATUS_FISCAL} selecionados={f.statusFiscal} contagem={contStatus}
              onToggle={(v) => toggle("statusFiscal", v)} onLimpar={() => set("statusFiscal", [])} />
          )}
          <MultiSelectFiltro
            rotulo="Pagamento"
            opcoes={FORMAS.map((p) => ({ valor: p, rotulo: rotuloForma(p) }))}
            selecionados={f.formas}
            onToggle={(v) => toggle("formas", v)}
            onLimpar={() => set("formas", [])}
            extra={
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Considerar:
                <select value={f.formaModo} onChange={(e) => set("formaModo", e.target.value as "principal" | "qualquer")}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold" aria-label="Modo da forma de pagamento">
                  <option value="principal">forma principal da venda</option>
                  <option value="qualquer">qualquer parte do pagamento</option>
                </select>
              </label>
            }
          />
          <SelectFiltro
            rotulo="Cliente"
            valor={f.cliente}
            padrao=""
            largura="min-w-[200px]"
            onChange={(v) => set("cliente", v)}
            opcoes={[{ valor: "", rotulo: "Todos os clientes" }, ...clientes.map((c) => ({ valor: c, rotulo: c }))]}
          />
        </LinhaFiltros>

        <button type="button" onClick={() => set("avancado", !f.avancado)} className="text-xs font-semibold text-sky-700 hover:underline">
          {f.avancado ? "▾ Ocultar filtros avançados" : "▸ Filtros avançados (modelo, nº da nota, produto, total, horário, agrupamento…)"}
        </button>

        {f.avancado && (
          <div className="rounded-lg bg-slate-50 p-3">
            <LinhaFiltros>
              {aba === "fiscal" && (
                <>
                  <MultiSelectFiltro rotulo="Modelo" opcoes={MODELOS.map((m) => ({ valor: m, rotulo: m }))} selecionados={f.modelos}
                    onToggle={(v) => toggle("modelos", v)} onLimpar={() => set("modelos", [])} largura="min-w-[130px]" />
                  <IntervaloFiltro rotulo="Nº da nota">
                    de <input inputMode="numeric" value={f.notaDe} onChange={(e) => set("notaDe", e.target.value.replace(/\D/g, ""))} className={cn(inputFiltro, "w-20 text-right")} aria-label="Nota de" />
                    até <input inputMode="numeric" value={f.notaAte} onChange={(e) => set("notaAte", e.target.value.replace(/\D/g, ""))} className={cn(inputFiltro, "w-20 text-right")} aria-label="Nota até" />
                  </IntervaloFiltro>
                </>
              )}
              <SelectFiltro
                rotulo="Produto"
                valor={f.produtoId}
                padrao=""
                largura="min-w-[220px]"
                onChange={(v) => set("produtoId", v)}
                opcoes={[{ valor: "", rotulo: "Qualquer produto" }, ...[...db.produtos].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((p) => ({ valor: p.id, rotulo: p.nome }))]}
              />
              {categorias.length > 0 && (
                <MultiSelectFiltro rotulo="Categoria" opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))} selecionados={f.categorias}
                  onToggle={(v) => toggle("categorias", v)} onLimpar={() => set("categorias", [])} />
              )}
              <MultiSelectFiltro rotulo="Exceções" opcoes={EXTRAS} selecionados={f.extras}
                onToggle={(v) => toggle("extras", v)} onLimpar={() => set("extras", [])} />
              <IntervaloFiltro rotulo="Total (R$)">
                de <input inputMode="decimal" value={f.totalDe} onChange={(e) => set("totalDe", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" className={cn(inputFiltro, "w-24 text-right")} aria-label="Total de" />
                até <input inputMode="decimal" value={f.totalAte} onChange={(e) => set("totalAte", e.target.value.replace(/[^\d.,]/g, ""))} placeholder="sem limite" className={cn(inputFiltro, "w-24 text-right")} aria-label="Total até" />
              </IntervaloFiltro>
              <IntervaloFiltro rotulo="Horário (turno)">
                de <input type="time" value={f.horaDe} onChange={(e) => set("horaDe", e.target.value)} className={inputFiltro} aria-label="Hora de" />
                até <input type="time" value={f.horaAte} onChange={(e) => set("horaAte", e.target.value)} className={inputFiltro} aria-label="Hora até" />
              </IntervaloFiltro>
              <SelectFiltro
                rotulo="Agrupar por"
                valor={f.agrupar}
                padrao="nenhum"
                onChange={(v) => set("agrupar", v)}
                opcoes={(Object.keys(ROTULO_AGRUPAR) as Agrupar[]).filter((a) => aba === "fiscal" || a !== "modelo").map((a) => ({ valor: a, rotulo: ROTULO_AGRUPAR[a] }))}
              />
            </LinhaFiltros>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
          {ativos.length === 0 ? (
            <span className="text-xs text-slate-400">Nenhum filtro ativo</span>
          ) : (
            <>
              {ativos.map((a) => <ChipAtivo key={a.id} onRemover={a.remover}>{a.rotulo}</ChipAtivo>)}
              <button onClick={limpar} className="ml-1 text-xs font-semibold text-rose-600 hover:underline">Limpar filtros</button>
            </>
          )}
        </div>
      </PainelFiltros>

      {base.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-600">
          <span><b className="text-slate-900">{lista.length}</b> de {base.length} documento(s)</span>
          <span>Total (sem cancelados): <b className="text-emerald-700">{brl(somaValidos)}</b></span>
          <span>Ticket médio: <b className="text-slate-900">{brl(ticket)}</b></span>
          {porForma.length > 0 && (
            <span className="capitalize">
              {porForma.map(([p, v]) => `${rotuloForma(p)} ${brl(v)}`).join(" · ")}
            </span>
          )}
        </div>
      )}

      {base.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          {aba === "dav"
            ? "Nenhum DAV gerado. Use o PDV no modo DAV para criar orçamentos e pedidos."
            : "Nenhuma nota emitida. Use o PDV no modo Venda Fiscal."}
        </Card>
      ) : lista.length === 0 ? (
        <Card className="p-12 text-center text-slate-400">
          Nenhum documento com esses filtros.{" "}
          <button onClick={limpar} className="font-semibold text-sky-600 hover:underline">Limpar filtros</button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Documento</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">{aba === "dav" ? "Validade" : "Chave / Protocolo"}</th>
                  <th className="px-4 py-3">Situação</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {grupos.map((g) => {
                  const ok = g.itens.filter((v) => v.status !== "cancelado");
                  const soma = ok.reduce((s, v) => s + v.total, 0);
                  return (
                    <Fragment key={g.chave || "todos"}>
                      {f.agrupar !== "nenhum" && (
                        <tr className="bg-slate-100/80">
                          <td colSpan={5} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700">
                            <span className="capitalize">{g.rotulo}</span>
                            <span className="ml-1 font-medium normal-case text-slate-500">· {g.itens.length} documento(s)</span>
                          </td>
                          <td colSpan={2} className="px-4 py-2 text-right text-xs font-semibold text-emerald-700">
                            {brl(soma)}
                            <span className="ml-2 font-medium text-slate-500">ticket {brl(ok.length ? soma / ok.length : 0)}</span>
                          </td>
                        </tr>
                      )}
                      {g.itens.map(renderLinha)}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {verDoc && (
        <Documento
          venda={verDoc}
          empresa={conta?.empresa ?? "Minha Empresa"}
          cnpj={conta?.cnpj ?? ""}
          onClose={() => setVerDoc(null)}
        />
      )}

      {faturar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setFaturar(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-900">Faturar DAV #{faturar.numero}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Isso emite o documento fiscal, baixa o estoque e lança no financeiro.
            </p>

            <div className="my-4 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{faturar.clienteNome}</span>
                <span>{faturar.itens.length} itens</span>
              </div>
              <div className="mt-1 flex justify-between text-lg font-bold text-slate-900">
                <span>Total</span><span>{brl(faturar.total)}</span>
              </div>
            </div>

            {!podeUsar("fiscal") ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                ⚠️ Emissão fiscal disponível no plano Pro. Assine para faturar com nota.
              </p>
            ) : (
              <>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Modelo fiscal</p>
                <div className="mb-3 flex gap-1.5">
                  {MODELOS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setModelo(m)}
                      className={cn(
                        "flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition",
                        modelo === m ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="mb-1.5 text-xs font-medium text-slate-500">Forma de pagamento</p>
                <div className="flex flex-wrap gap-1.5">
                  {FORMAS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setPag(p)}
                      className={cn(
                        "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition",
                        pag === p ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {p === "prazo" ? "a prazo" : p}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setFaturar(null)}>
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  if (!podeUsar("fiscal")) return setFaturar(null);
                  faturarDav(faturar.id, { modelo, pagamento: pag });
                  setFaturar(null);
                }}
              >
                {podeUsar("fiscal") ? `Emitir ${modelo}` : "Ver planos ⭐"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de cancelamento fiscal */}
      {cancelando && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setCancelando(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-xl">
                ⚠️
              </span>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cancelar {cancelando.fiscal?.modelo} #{cancelando.numero}
                </h3>
                <p className="text-xs text-slate-500">
                  Cancelamento registra um evento de cancelamento junto à SEFAZ e
                  devolve o estoque dos itens.
                </p>
              </div>
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>{cancelando.clienteNome}</span>
                <span>{cancelando.itens.length} itens</span>
              </div>
              <div className="mt-1 flex justify-between text-lg font-bold text-slate-900">
                <span>Total da nota</span>
                <span className="text-rose-600">{brl(cancelando.total)}</span>
              </div>
            </div>

            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Justificativa do cancelamento (obrigatória)
              </span>
              <textarea
                rows={3}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: Venda efetuada por erro no atendimento"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
              />
            </label>

            <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <strong>Atenção:</strong> A SEFAZ permite cancelar uma nota em até 30 minutos em produção
              (24h em homologação). O cancelamento baixa o estoque, estorna o financeiro e
              registra protocolo de cancelamento. Não é possível desfazer.
            </div>

            <div className="mt-5 flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => {
                  if (!motivo.trim()) return alert("Informe a justificativa.");
                  cancelarVenda(cancelando.id, motivo);
                  setCancelando(null);
                  setMotivo("");
                }}
              >
                Confirmar cancelamento fiscal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
