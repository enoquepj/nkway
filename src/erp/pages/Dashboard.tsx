import { useMemo } from "react";
import { useStore } from "../store";
import { brl } from "../types";
import { Badge, Card, Empty, PageHeader } from "../ui";

function Kpi({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: string;
  tone: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg ${tone}`}>
          {icon}
        </span>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { db } = useStore();

  const hojeIni = new Date().setHours(0, 0, 0, 0);
  // Somente vendas faturadas entram no faturamento (DAV em aberto não conta)
  const faturadas = db.vendas.filter((v) => v.status === "faturado");
  const davsAbertos = db.vendas.filter((v) => v.tipo === "dav" && v.status === "aberto");
  const vendasHoje = faturadas.filter((v) => v.data >= hojeIni);
  const faturamentoHoje = vendasHoje.reduce((s, v) => s + v.total, 0);
  const faturamentoTotal = faturadas.reduce((s, v) => s + v.total, 0);
  const ticket = faturadas.length ? faturamentoTotal / faturadas.length : 0;

  const aReceber = db.lancamentos.filter((l) => l.tipo === "receber" && !l.pago);
  const aPagar = db.lancamentos.filter((l) => l.tipo === "pagar" && !l.pago);
  const saldo =
    aReceber.reduce((s, l) => s + l.valor, 0) - aPagar.reduce((s, l) => s + l.valor, 0);

  const estoqueBaixo = db.produtos.filter((p) => p.estoque <= p.estoqueMin);
  const valorEstoque = db.produtos.reduce((s, p) => s + p.custo * p.estoque, 0);

  const serie = useMemo(() => {
    const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (6 - i));
      const fim = d.getTime() + 86400000;
      const total = faturadas
        .filter((v) => v.data >= d.getTime() && v.data < fim)
        .reduce((s, v) => s + v.total, 0);
      return { label: dias[d.getDay()], total };
    });
  }, [db.vendas]);

  const max = Math.max(1, ...serie.map((s) => s.total));

  const topProdutos = useMemo(() => {
    const map = new Map<string, { nome: string; qtd: number; total: number }>();
    faturadas.forEach((v) =>
      v.itens.forEach((i) => {
        const cur = map.get(i.produtoId) ?? { nome: i.nome, qtd: 0, total: 0 };
        cur.qtd += i.qtd;
        cur.total += i.qtd * i.preco;
        map.set(i.produtoId, cur);
      }),
    );
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [db.vendas]);

  return (
    <div>
      <PageHeader
        title="Visão geral"
        subtitle={new Date().toLocaleDateString("pt-BR", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
        })}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Vendas hoje" value={brl(faturamentoHoje)} hint={`${vendasHoje.length} pedidos`} icon="💰" tone="bg-emerald-50" />
        <Kpi label="Faturamento total" value={brl(faturamentoTotal)} hint={`Ticket médio ${brl(ticket)}`} icon="📈" tone="bg-sky-50" />
        <Kpi label="Valor em estoque" value={brl(valorEstoque)} hint={`${db.produtos.length} produtos · saldo ${brl(saldo)}`} icon="🏦" tone="bg-violet-50" />
        <Kpi
          label="DAVs em aberto"
          value={brl(davsAbertos.reduce((s, v) => s + v.total, 0))}
          hint={`${davsAbertos.length} aguardando faturamento`}
          icon="📄"
          tone="bg-amber-50"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-1 font-semibold text-slate-900">Faturamento dos últimos 7 dias</h2>
          <p className="mb-5 text-xs text-slate-500">Baseado nas vendas registradas no PDV</p>
          <div className="flex h-48 items-end gap-3">
            {serie.map((s, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-2">
                <span className="text-[10px] font-medium text-slate-400">
                  {s.total > 0 ? brl(s.total).replace("R$", "").trim() : ""}
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-sky-600 to-sky-400 transition-all"
                    style={{ height: `${(s.total / max) * 100}%`, minHeight: 4 }}
                  />
                </div>
                <span className="text-[11px] text-slate-500">{s.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Alertas de estoque</h2>
          {estoqueBaixo.length === 0 ? (
            <Empty>Nenhum produto abaixo do mínimo 👍</Empty>
          ) : (
            <ul className="space-y-3">
              {estoqueBaixo.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{p.nome}</p>
                    <p className="text-xs text-slate-400">{p.sku}</p>
                  </div>
                  <Badge tone={p.estoque === 0 ? "red" : "amber"}>
                    {p.estoque} / mín {p.estoqueMin}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Produtos mais vendidos</h2>
          {topProdutos.length === 0 ? (
            <Empty>Registre vendas no PDV para ver o ranking.</Empty>
          ) : (
            <ul className="space-y-3">
              {topProdutos.map((p, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm text-slate-700">{p.nome}</span>
                  <span className="text-xs text-slate-400">{p.qtd} un</span>
                  <span className="text-sm font-semibold text-slate-900">{brl(p.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Últimas vendas</h2>
          {faturadas.length === 0 ? (
            <Empty>Nenhuma venda registrada ainda.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {faturadas.slice(0, 5).map((v) => (
                <li key={v.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">#{v.numero} · {v.clienteNome}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(v.data).toLocaleString("pt-BR")} · {v.itens.length} itens
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-900">{brl(v.total)}</p>
                    <Badge tone="sky">{v.pagamento}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
