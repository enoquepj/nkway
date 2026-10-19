import { useMemo, useState } from "react";
import { useStore } from "../store";
import { brl } from "../types";
import { Badge, Card, PageHeader } from "../ui";
import { cn } from "../../utils/cn";

/* ------------------------------ decora a página ------------------------------ */
const ABAS = [
  ["vendas", "💰 Vendas"],
  ["produtos", "📦 Produtos"],
  ["clientes", "👥 Clientes"],
  ["financeiro", "🏦 Financeiro"],
  ["fiscal", "🧾 Fiscal"],
] as const;

type AbaId = (typeof ABAS)[number][0];

/* util */
const pct = (n: number, total: number) => (total > 0 ? Math.min(100, (n / total) * 100) : 0);

export default function Relatorios() {
  const { db } = useStore();
  const [aba, setAba] = useState<AbaId>("vendas");

  const hoje = new Date().setHours(0, 0, 0, 0);
  const seteDias = hoje - 7 * 864e5;
  const trintaDias = hoje - 30 * 864e5;

  /* ---------------------------------- VENDAS ---------------------------------- */
  const fiscais = db.vendas.filter((v) => v.status === "faturado");
  const fatHoje = fiscais.filter((v) => v.data >= hoje).reduce((s, v) => s + v.total, 0);
  const fat7 = fiscais.filter((v) => v.data >= seteDias).reduce((s, v) => s + v.total, 0);
  const fat30 = fiscais.filter((v) => v.data >= trintaDias).reduce((s, v) => s + v.total, 0);
  const fatTotal = fiscais.reduce((s, v) => s + v.total, 0);
  const ticket = fiscais.length ? fatTotal / fiscais.length : 0;
  const topVendas = [...fiscais].sort((a, b) => b.total - a.total).slice(0, 10);
  const porPagamento = (["dinheiro", "pix", "debito", "credito", "boleto", "prazo"] as const)
    .map((p) => ({
      nome: p,
      total: fiscais.filter((v) => v.pagamento === p).reduce((s, v) => s + v.total, 0),
    }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total);

  /* ---------------------------------- PRODUTOS -------------------------------- */
  const map = new Map<string, { nome: string; qtd: number; receita: number; estoque: number }>();
  fiscais.forEach((v) =>
    v.itens.forEach((i) => {
      const p = db.produtos.find((x) => x.id === i.produtoId) ?? { estoque: 0 };
      const cur = map.get(i.produtoId) ?? { nome: i.nome, qtd: 0, receita: 0, estoque: p.estoque };
      cur.qtd += i.qtd;
      cur.receita += i.qtd * i.preco;
      cur.estoque = p.estoque;
      map.set(i.produtoId, cur);
    }),
  );
  const topProdutos = [...map.values()].sort((a, b) => b.receita - a.receita);
  const totalReceita = topProdutos.reduce((s, p) => s + p.receita, 0);
  // Curva ABC simples: A=80%, B=15%, C=5%
  const curvaData = useMemo(() => {
    let soma = 0;
    return topProdutos.map((p) => {
      soma += p.receita;
      const acum = (soma / totalReceita) * 100;
      return { ...p, acum, classe: acum <= 80 ? "A" : acum <= 95 ? "B" : "C" };
    });
  }, [topProdutos, totalReceita]);

  /* ---------------------------------- CLIENTES -------------------------------- */
  const mapCli = new Map<string, { nome: string; compras: number; total: number; ticket: number }>();
  fiscais.forEach((v) => {
    const c = db.clientes.find((x) => x.id === v.clienteId);
    const k = c?.id ?? "consumidor";
    const cur = mapCli.get(k) ?? { nome: c?.nome ?? "Consumidor final", compras: 0, total: 0, ticket: 0 };
    cur.compras += 1;
    cur.total += v.total;
    mapCli.set(k, cur);
  });
  const topClientes = [...mapCli.values()]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ ...c, ticket: c.compras > 0 ? c.total / c.compras : 0 }));

  /* ---------------------------------- FINANCEIRO ------------------------------ */
  const receber = db.lancamentos.filter((l) => l.tipo === "receber" && !l.pago);
  const pagar = db.lancamentos.filter((l) => l.tipo === "pagar" && !l.pago);
  const porFaixa = (lista: typeof receber) => [
    { label: "Vencido", valor: lista.filter((l) => l.vencimento < new Date().toISOString().slice(0, 10)).reduce((s, l) => s + l.valor, 0), tone: "red" as const },
    { label: "0–7 dias", valor: lista.filter((l) => { const d = Math.ceil((new Date(l.vencimento).getTime() - Date.now()) / 864e5); return d >= 0 && d <= 7; }).reduce((s, l) => s + l.valor, 0), tone: "amber" as const },
    { label: "8–30 dias", valor: lista.filter((l) => { const d = Math.ceil((new Date(l.vencimento).getTime() - Date.now()) / 864e5); return d > 7 && d <= 30; }).reduce((s, l) => s + l.valor, 0), tone: "sky" as const },
    { label: "+30 dias", valor: lista.filter((l) => Math.ceil((new Date(l.vencimento).getTime() - Date.now()) / 864e5) > 30).reduce((s, l) => s + l.valor, 0), tone: "slate" as const },
  ];

  /* ---------------------------------- FISCAL ---------------------------------- */
  const comNota = db.vendas.filter((v) => v.fiscal);
  const canceladas = db.vendas.filter((v) => v.status === "cancelado").length;
  const porModelo = (["NFC-e", "NF-e", "SAT"] as const).map((m) => ({
    modelo: m,
    total: comNota.filter((v) => v.fiscal?.modelo === m).length,
  }));
  const ultimos16 = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (15 - i));
      const fim = d.getTime() + 864e5;
      return {
        label: d.getDate() + "/" + (d.getMonth() + 1),
        valor: comNota.filter((v) => v.data >= d.getTime() && v.data < fim).reduce((s, v) => s + v.total, 0),
      };
    });
  }, [comNota]);
  const max16 = Math.max(1, ...ultimos16.map((x) => x.valor));

  return (
    <div>
      <PageHeader title="Relatórios essenciais" subtitle="Baseado nos dados atuais do sistema" />

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg bg-slate-200 p-1 sm:w-fit">
        {ABAS.map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={cn("rounded-md px-4 py-1.5 text-sm font-semibold transition",
              aba === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
            {label}
          </button>
        ))}
      </div>

      {/* ============================== VENDAS ============================== */}
      {aba === "vendas" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="border-l-4 border-l-emerald-500 p-5"><p className="text-xs uppercase text-slate-500">Hoje</p><p className="mt-1 text-2xl font-bold text-emerald-600">{brl(fatHoje)}</p></Card>
            <Card className="border-l-4 border-l-sky-500 p-5"><p className="text-xs uppercase text-slate-500">7 dias</p><p className="mt-1 text-2xl font-bold text-sky-700">{brl(fat7)}</p></Card>
            <Card className="border-l-4 border-l-violet-500 p-5"><p className="text-xs uppercase text-slate-500">30 dias</p><p className="mt-1 text-2xl font-bold text-violet-600">{brl(fat30)}</p></Card>
            <Card className="border-l-4 border-l-amber-500 p-5"><p className="text-xs uppercase text-slate-500">Ticket médio</p><p className="mt-1 text-2xl font-bold text-slate-900">{brl(ticket)}</p></Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Por forma de pagamento</h3>
              <ul className="space-y-3">
                {porPagamento.map((p) => (
                  <li key={p.nome}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="capitalize text-slate-600">{p.nome === "prazo" ? "a prazo" : p.nome}</span>
                      <span className="font-bold text-slate-900">{brl(p.total)} · {Math.round(pct(p.total, fatTotal))}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct(p.total, fatTotal)}%` }} />
                    </div>
                  </li>
                ))}
                {porPagamento.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Sem vendas registradas ainda.</p>}
              </ul>
            </Card>

            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Top 10 maiores vendas</h3>
              {topVendas.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Sem vendas.</p> : (
                <ul className="divide-y divide-slate-100">
                  {topVendas.map((v, i) => (
                    <li key={v.id} className="flex items-center gap-3 py-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100 text-xs font-bold text-emerald-700">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">#{v.numero} · {v.clienteNome}</p>
                        <p className="text-xs text-slate-400">{new Date(v.data).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <span className="text-sm font-bold text-slate-900">{brl(v.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ============================== PRODUTOS ============================== */}
      {aba === "produtos" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-emerald-500 p-5">
              <p className="text-xs uppercase text-slate-500">Curva A (80% da receita)</p>
              <p className="mt-1 text-2xl font-bold text-emerald-600">{curvaData.filter((c) => c.classe === "A").length} produtos</p>
            </Card>
            <Card className="border-l-4 border-l-amber-500 p-5">
              <p className="text-xs uppercase text-slate-500">Curva B (15%)</p>
              <p className="mt-1 text-2xl font-bold text-amber-600">{curvaData.filter((c) => c.classe === "B").length}</p>
            </Card>
            <Card className="border-l-4 border-l-rose-500 p-5">
              <p className="text-xs uppercase text-slate-500">Curva C (5%)</p>
              <p className="mt-1 text-2xl font-bold text-rose-600">{curvaData.filter((c) => c.classe === "C").length}</p>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Produto</th>
                    <th className="px-4 py-3 text-center">Classe</th>
                    <th className="px-4 py-3 text-center">Qtd vendida</th>
                    <th className="px-4 py-3 text-right">Receita</th>
                    <th className="px-4 py-3 text-right">% acum.</th>
                    <th className="px-4 py-3 text-center">Estoque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {curvaData.slice(0, 30).map((p, k) => (
                    <tr key={k} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 text-xs text-slate-400">{k + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{p.nome}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge tone={p.classe === "A" ? "green" : p.classe === "B" ? "amber" : "red"}>{p.classe}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-center text-slate-600">{p.qtd}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{brl(p.receita)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500">{p.acum.toFixed(1)}%</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold",
                          p.estoque < 1 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")}>
                          {p.estoque}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {curvaData.length === 0 && (
                    <tr><td colSpan={7} className="py-12 text-center text-slate-400">Sem dados de vendas ainda.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ============================== CLIENTES ============================== */}
      {aba === "clientes" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-sky-500 p-5"><p className="text-xs uppercase text-slate-500">Clientes que compraram</p><p className="mt-1 text-2xl font-bold text-slate-900">{mapCli.size}</p></Card>
            <Card className="border-l-4 border-l-emerald-500 p-5"><p className="text-xs uppercase text-slate-500">Valor total</p><p className="mt-1 text-2xl font-bold text-emerald-600">{brl(topClientes.reduce((s, c) => s + c.total, 0))}</p></Card>
            <Card className="border-l-4 border-l-amber-500 p-5"><p className="text-xs uppercase text-slate-500">Ticket médio c/ repetição</p><p className="mt-1 text-2xl font-bold text-amber-600">{brl(fiscais.length && mapCli.size ? topClientes.reduce((s, c) => s + c.total, 0) / fiscais.length : 0)}</p></Card>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3 text-center">Compras</th>
                    <th className="px-4 py-3 text-right">Ticket médio</th>
                    <th className="px-4 py-3 text-right">Total comprado</th>
                    <th className="px-4 py-3 text-right">% do total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topClientes.slice(0, 20).map((c, k) => (
                    <tr key={k} className="hover:bg-slate-50/70">
                      <td className="px-4 py-2.5 text-xs text-slate-400">{k + 1}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{c.nome}</td>
                      <td className="px-4 py-2.5 text-center text-slate-600">{c.compras}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600">{brl(c.ticket)}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{brl(c.total)}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                        {Math.round(pct(c.total, topClientes.reduce((s, x) => s + x.total, 0)))}%
                      </td>
                    </tr>
                  ))}
                  {topClientes.length === 0 && (
                    <tr><td colSpan={6} className="py-12 text-center text-slate-400">Sem clientes com compras.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ============================== FINANCEIRO ============================== */}
      {aba === "financeiro" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-emerald-500 p-5"><p className="text-xs uppercase text-slate-500">A receber (aberto)</p><p className="mt-1 text-2xl font-bold text-emerald-600">{brl(receber.reduce((s, l) => s + l.valor, 0))}</p></Card>
            <Card className="border-l-4 border-l-rose-500 p-5"><p className="text-xs uppercase text-slate-500">A pagar (aberto)</p><p className="mt-1 text-2xl font-bold text-rose-600">{brl(pagar.reduce((s, l) => s + l.valor, 0))}</p></Card>
            <Card className="border-l-4 border-l-sky-500 p-5"><p className="text-xs uppercase text-slate-500">Saldo projetado</p><p className="mt-1 text-2xl font-bold text-sky-700">{brl(receber.reduce((s, l) => s + l.valor, 0) - pagar.reduce((s, l) => s + l.valor, 0))}</p></Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">A receber por faixa de vencimento</h3>
              <ul className="space-y-3">
                {porFaixa(receber).map((f) => (
                  <li key={f.label} className="flex items-center justify-between">
                    <span className={cn("text-[11px] font-bold uppercase",
                      f.tone === "red" ? "text-rose-600" : f.tone === "amber" ? "text-amber-600" : f.tone === "sky" ? "text-sky-700" : "text-slate-500")}>
                      {f.label}
                    </span>
                    <span className="text-sm font-bold text-slate-900">{brl(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">A pagar por faixa de vencimento</h3>
              <ul className="space-y-3">
                {porFaixa(pagar).map((f) => (
                  <li key={f.label} className="flex items-center justify-between">
                    <span className={cn("text-[11px] font-bold uppercase",
                      f.tone === "red" ? "text-rose-600" : f.tone === "amber" ? "text-amber-600" : f.tone === "sky" ? "text-sky-700" : "text-slate-500")}>
                      {f.label}
                    </span>
                    <span className="text-sm font-bold text-slate-900">{brl(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="mb-4 text-sm font-bold text-slate-900">Maiores títulos a receber</h3>
            {receber.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nenhum título em aberto.</p> : (
              <ul className="divide-y divide-slate-100">
                {[...receber].sort((a, b) => b.valor - a.valor).slice(0, 8).map((l) => (
                  <li key={l.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{l.descricao}</p>
                      <p className="text-xs text-slate-400">vto. {new Date(l.vencimento + "T12:00").toLocaleDateString("pt-BR")} · {l.categoria}</p>
                    </div>
                    <span className={cn("text-sm font-bold", l.vencimento < new Date().toISOString().slice(0, 10) ? "text-rose-600" : "text-slate-900")}>
                      {brl(l.valor)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ============================== FISCAL ============================== */}
      {aba === "fiscal" && (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-l-4 border-l-sky-500 p-5"><p className="text-xs uppercase text-slate-500">Notas emitidas</p><p className="mt-1 text-2xl font-bold text-sky-700">{comNota.length}</p></Card>
            <Card className="border-l-4 border-l-emerald-500 p-5"><p className="text-xs uppercase text-slate-500">Valor emitido</p><p className="mt-1 text-2xl font-bold text-emerald-600">{brl(comNota.reduce((s, v) => s + v.total, 0))}</p></Card>
            <Card className="border-l-4 border-l-rose-500 p-5"><p className="text-xs uppercase text-slate-500">Canceladas</p><p className="mt-1 text-2xl font-bold text-rose-600">{canceladas}</p></Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Por modelo fiscal</h3>
              <ul className="space-y-3">
                {porModelo.map((m) => (
                  <li key={m.modelo} className="flex items-center justify-between">
                    <span className="text-sm text-slate-700">{m.modelo}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-sky-500" style={{ width: `${pct(m.total, comNota.length || 1)}%` }} />
                      </div>
                      <span className="w-12 text-right text-sm font-bold">{m.total}</span>
                    </div>
                  </li>
                ))}
                {comNota.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Sem notas emitidas ainda.</p>}
              </ul>
            </Card>

            <Card className="p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">Emissões por dia (últimos 16 dias)</h3>
              <div className="flex h-36 items-end gap-1.5">
                {ultimos16.map((d, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${d.label}: ${brl(d.valor)}`}>
                    <div
                      className="w-full rounded-t bg-sky-500 transition-all"
                      style={{ height: `${(d.valor / max16) * 100}%`, minHeight: 4 }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-slate-400">
                <span>{ultimos16[0]?.label}</span>
                <span>{ultimos16[ultimos16.length - 1]?.label}</span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
