import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth";

export type PlanId = "free" | "pro" | "ultra";

export type Plano = {
  id: PlanId;
  nome: string;
  preco: number;
  descricao: string;
  limites: { produtos: number; clientes: number; vendasMes: number; usuarios: number };
  recursos: string[];
  naoInclui: string[];
  destaque?: boolean;
};

export const PLANOS: Plano[] = [
  {
    id: "free",
    nome: "Grátis",
    preco: 0,
    descricao: "Para quem está começando e quer organizar a operação.",
    limites: { produtos: 50, clientes: 50, vendasMes: 100, usuarios: 1 },
    recursos: [
      "Até 50 produtos e 50 clientes",
      "100 vendas por mês no PDV",
      "DAV ilimitado (orçamentos e pedidos)",
      "Entrada de mercadoria por XML da NF-e",
      "Kardex, inventário e ajustes de estoque",
      "PDV offline-first com sincronização",
      "Controle de estoque com alerta mínimo",
      "Contas a pagar e a receber",
      "Dashboard com indicadores básicos",
      "1 usuário",
    ],
    naoInclui: [
      "Emissão fiscal (NFC-e / NF-e / SAT)",
      "MDF-e (manifesto de transporte)",
      "Relatórios avançados e DRE",
      "Multiusuário",
      "Suporte prioritário",
    ],
  },
  {
    id: "pro",
    nome: "Pro",
    preco: 89,
    descricao: "Para lojas que já vendem todo dia e precisam emitir nota.",
    limites: { produtos: 5000, clientes: 5000, vendasMes: 5000, usuarios: 5 },
    recursos: [
      "Tudo do Grátis, sem limite prático",
      "Emissão ilimitada de NFC-e, NF-e e SAT",
      "Contingência fiscal offline automática",
      "Emissão de MDF-e para transporte de carga",
      "Faturamento de DAV em nota fiscal",
      "Até 5 usuários com permissões",
      "Relatórios avançados e exportação CSV",
      "Integração Pix e boleto registrado",
      "Suporte por chat em horário comercial",
    ],
    naoInclui: ["API aberta e webhooks", "Multi-lojas / multi-CNPJ", "Gerente de conta"],
    destaque: true,
  },
  {
    id: "ultra",
    nome: "Ultra",
    preco: 249,
    descricao: "Para redes, franquias e operações com múltiplos CNPJs.",
    limites: { produtos: 1e9, clientes: 1e9, vendasMes: 1e9, usuarios: 1e9 },
    recursos: [
      "Tudo do Pro, sem limites",
      "Multi-lojas e multi-CNPJ",
      "Usuários ilimitados",
      "API e webhooks para integrações",
      "DRE gerencial e curva ABC",
      "Gerente de conta dedicado",
    ],
    naoInclui: [],
  },
];

type Ctx = {
  plano: Plano;
  emTrial: boolean;
  setPlano: (id: PlanId) => void;
  podeUsar: (recurso: "fiscal" | "relatorios" | "multiusuario" | "api") => boolean;
  dentroDoLimite: (tipo: keyof Plano["limites"], atual: number) => boolean;
};

const PlanCtx = createContext<Ctx | null>(null);
const KEY = "nkway.plano";

export function PlanProvider({ children }: { children: ReactNode }) {
  const { conta, atualizar, emTrial } = useAuth();
  const [id, setId] = useState<PlanId>(() => (localStorage.getItem(KEY) as PlanId) || "free");

  useEffect(() => {
    if (conta) setId(conta.plano);
  }, [conta?.id, conta?.plano]);

  useEffect(() => localStorage.setItem(KEY, id), [id]);

  // Durante o trial o usuário tem acesso aos recursos do Pro
  const efetivo: PlanId = id === "free" && emTrial ? "pro" : id;
  const plano = PLANOS.find((p) => p.id === efetivo)!;

  const value: Ctx = {
    plano,
    emTrial,
    setPlano: (novo) => {
      setId(novo);
      atualizar({ plano: novo });
    },
    podeUsar: (r) => (r === "api" ? efetivo === "ultra" : efetivo !== "free"),
    dentroDoLimite: (tipo, atual) => atual < plano.limites[tipo],
  };

  return <PlanCtx.Provider value={value}>{children}</PlanCtx.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanCtx);
  if (!ctx) throw new Error("usePlan fora do provider");
  return ctx;
}
