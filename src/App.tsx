import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./erp/store";
import Dashboard from "./erp/pages/Dashboard";
import PDV from "./erp/pages/PDV";
import Produtos from "./erp/pages/Produtos";
import Clientes from "./erp/pages/Clientes";
import Financeiro from "./erp/pages/Financeiro";
import Vendas from "./erp/pages/Vendas";
import Planos from "./erp/pages/Planos";
import Entradas from "./erp/pages/Entradas";
import Estoque from "./erp/pages/Estoque";
import Mdfe from "./erp/pages/Mdfe";
import DevConsole from "./erp/pages/DevConsole";
import DevLock from "./erp/dev/DevLock";
import { devAtivo, sairDev } from "./erp/dev/devAuth";
import { PlanProvider, usePlan } from "./erp/plan";
import { AuthProvider, useAuth } from "./erp/auth";
import Login from "./erp/pages/Login";
import TrialBanner from "./erp/TrialBanner";
import StatusConexao from "./erp/StatusConexao";
import { cn } from "./utils/cn";

const MENU = [
  { id: "dashboard", label: "Visão geral", icon: "📊", grupo: "Gestão" },
  { id: "pdv", label: "PDV / Caixa", icon: "🧾", grupo: "Vendas" },
  { id: "vendas", label: "DAVs e notas fiscais", icon: "📄", grupo: "Vendas" },
  { id: "mdfe", label: "MDF-e (transporte)", icon: "🚚", grupo: "Vendas" },
  { id: "entradas", label: "Entrada de mercadoria", icon: "📥", grupo: "Compras" },
  { id: "estoque", label: "Gestão de estoque", icon: "🏷️", grupo: "Compras" },
  { id: "produtos", label: "Produtos", icon: "📦", grupo: "Cadastros" },
  { id: "clientes", label: "Clientes", icon: "👥", grupo: "Cadastros" },
  { id: "financeiro", label: "Financeiro", icon: "💳", grupo: "Gestão" },
  { id: "planos", label: "Planos e assinatura", icon: "⭐", grupo: "Conta" },
  { id: "dev", label: "Console do dev", icon: "🛠️", grupo: "Desenvolvedor" },
] as const;

type PageId = (typeof MENU)[number]["id"];

function Shell() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [menuAberto, setMenuAberto] = useState(false);
  const { db, reset } = useStore();
  const { plano } = usePlan();
  const { conta, sair, emTrial, diasRestantes, modo } = useAuth();

  const alertas = db.produtos.filter((p) => p.estoque <= p.estoqueMin).length;

  // Modo desenvolvedor — protegido por senha (ver src/erp/dev/devAuth.ts)
  const [devOn, setDevOn] = useState(devAtivo);
  const [pedindoSenha, setPedindoSenha] = useState(
    () => new URLSearchParams(location.search).get("dev") === "1" && !devAtivo(),
  );

  function desligarDev() {
    sairDev();
    setDevOn(false);
    setPage("dashboard");
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        devAtivo() ? desligarDev() : setPedindoSenha(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const grupos = ["Gestão", "Vendas", "Compras", "Cadastros", "Conta"];
  if (devOn) grupos.push("Desenvolvedor");

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-900">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-slate-900 p-4 text-slate-300 transition-transform lg:static lg:translate-x-0",
          menuAberto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 text-lg font-black text-white">
            N
          </div>
          <div>
            <p className="text-lg font-black leading-tight tracking-tight text-white">NKWAY</p>
            <p className="text-[11px] text-slate-400">Gestão · PDV · Fiscal</p>
          </div>
        </div>

        <nav className="space-y-5">
          {grupos.map((g) => (
            <div key={g}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {g}
              </p>
              <ul className="space-y-1">
                {MENU.filter((m) => m.grupo === g && (m.grupo !== "Desenvolvedor" || devOn)).map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => { setPage(m.id); setMenuAberto(false); }}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                        page === m.id
                          ? "bg-sky-600 text-white shadow"
                          : "hover:bg-slate-800 hover:text-white",
                      )}
                    >
                      <span>{m.icon}</span>
                      <span className="flex-1 text-left">{m.label}</span>
                      {m.id === "produtos" && alertas > 0 && (
                        <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">
                          {alertas}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="absolute bottom-4 left-4 right-4">
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] text-slate-500">
            <span className={cn("h-1.5 w-1.5 rounded-full", modo === "cloud" ? "bg-emerald-400" : "bg-amber-400")} />
            {modo === "cloud" ? "Conectado à nuvem (Supabase)" : "Modo demonstração (este navegador)"}
          </p>
          <button
            onClick={() => confirm("Restaurar dados de demonstração?") && reset()}
            className="w-full rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 transition hover:bg-slate-800"
          >
            ↺ Restaurar demonstração
          </button>
        </div>
      </aside>

      {menuAberto && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setMenuAberto(false)} />
      )}

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        {pedindoSenha && (
          <DevLock
            onOk={() => { setPedindoSenha(false); setDevOn(true); setPage("dev"); }}
            onCancel={() => setPedindoSenha(false)}
          />
        )}
        {devOn && (
          <div className="flex items-center justify-between gap-3 bg-violet-600 px-5 py-1.5 text-xs font-semibold text-white">
            <span>🛠️ MODO DESENVOLVEDOR ATIVO — dados e simuladores expostos</span>
            <button
              onClick={desligarDev}
              className="rounded bg-white/20 px-2 py-0.5 transition hover:bg-white/30"
            >
              bloquear (Ctrl+Shift+D)
            </button>
          </div>
        )}
        <TrialBanner onUpgrade={() => setPage("planos")} />
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <button onClick={() => setMenuAberto(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400">Empresa</p>
            <p className="truncate text-sm font-semibold">
              {conta?.empresa}
              {conta?.cnpj ? ` · CNPJ ${conta.cnpj}` : ""}
            </p>
          </div>
          <StatusConexao empresaId={conta?.id} compacto />
          <button
            onClick={() => setPage("planos")}
            className={cn(
              "hidden items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:flex",
              plano.id === "free"
                ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "bg-sky-50 text-sky-700 hover:bg-sky-100",
            )}
          >
            {emTrial
              ? `🎁 Trial Pro · ${diasRestantes}d`
              : plano.id === "free"
                ? "⭐ Plano Grátis — fazer upgrade"
                : `⭐ Plano ${plano.nome}`}
          </button>

          <div className="group relative">
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
              {(conta?.nome ?? "U").slice(0, 2).toUpperCase()}
            </button>
            <div className="invisible absolute right-0 top-11 w-56 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="truncate text-sm font-semibold text-slate-800">{conta?.nome}</p>
                <p className="truncate text-xs text-slate-400">{conta?.email}</p>
              </div>
              <button
                onClick={() => setPage("planos")}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              >
                ⭐ Planos e assinatura
              </button>
              <button
                onClick={sair}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50"
              >
                ⎋ Sair da conta
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 p-5 lg:p-8">
          {page === "dashboard" && <Dashboard />}
          {page === "pdv" && <PDV />}
          {page === "vendas" && <Vendas />}
          {page === "produtos" && <Produtos />}
          {page === "clientes" && <Clientes />}
          {page === "financeiro" && <Financeiro />}
          {page === "entradas" && <Entradas />}
          {page === "estoque" && <Estoque />}
          {page === "mdfe" && <Mdfe />}
          {page === "planos" && <Planos />}
          {page === "dev" && devOn && <DevConsole />}
        </main>
      </div>
    </div>
  );
}

function Gate() {
  const { conta, carregando } = useAuth();
  if (carregando)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-sky-600" />
          <p className="text-sm text-slate-500">Carregando NKWAY...</p>
        </div>
      </div>
    );
  if (!conta) return <Login />;
  return (
    <StoreProvider>
      <PlanProvider>
        <Shell />
      </PlanProvider>
    </StoreProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
