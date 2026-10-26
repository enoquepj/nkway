import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth";

export type PlanId = "free" | "pro" | "ultra";

export type Plano = {
  id: PlanId;
  nome: string;
  preco: number;
  descricao: string;
  publicoAlvo: string;
  limites: { produtos: number; clientes: number; vendasMes: number; usuarios: number };
  recursos: string[];
  naoInclui: string[];
  destaque?: boolean;
};

/** Planos pensados para MEI / ME / Simples (preço e limites alinhados ao porte). */
export const PLANOS: Plano[] = [
  {
    id: "free",
    nome: "MEI Start",
    preco: 0,
    descricao: "Organize a bancada e o caixa sem custo. Ideal para testar o NKWAY.",
    publicoAlvo: "MEI e quem está formalizando",
    limites: { produtos: 80, clientes: 80, vendasMes: 150, usuarios: 1 },
    recursos: [
      "Até 80 produtos e 80 clientes",
      "150 vendas/mês no PDV",
      "DAV (orçamento e pedido) ilimitado",
      "Entrada de mercadoria (XML / manual)",
      "Estoque, kardex e alerta de mínimo",
      "Contas a pagar e a receber",
      "PDV com modo offline (fila local)",
      "1 usuário (dono)",
      "Dados na nuvem quando o Supabase estiver ativo",
    ],
    naoInclui: [
      "Emissão fiscal real (NFC-e/NF-e) — em breve via provedor",
      "Múltiplos usuários",
      "DF-e automático em produção",
      "Suporte prioritário",
    ],
  },
  {
    id: "pro",
    nome: "ME / Simples",
    preco: 49.9,
    descricao: "Para ME no Simples que vende todo dia e precisa de nota e mais usuários.",
    publicoAlvo: "ME e EPP no Simples Nacional",
    limites: { produtos: 3000, clientes: 3000, vendasMes: 3000, usuarios: 3 },
    recursos: [
      "Tudo do MEI Start, com folga de limite",
      "Até 3 usuários (dono, caixa, escritório)",
      "Emissão NFC-e/NF-e (quando o provedor fiscal estiver ligado)",
      "DF-e / entrada por XML e chave (com A1)",
      "Manutenção de preços e markup em massa",
      "Relatórios com filtro, impressão e CSV",
      "Trial Pro de 14 dias ao criar a conta",
      "Suporte por WhatsApp/e-mail em horário comercial",
    ],
    naoInclui: ["Multi-CNPJ / rede de lojas", "API e webhooks", "Gerente de conta"],
    destaque: true,
  },
  {
    id: "ultra",
    nome: "Loja+",
    preco: 99.9,
    descricao: "Para quem cresceu no Simples ou tem mais de uma operação.",
    publicoAlvo: "ME/EPP em expansão",
    limites: { produtos: 1e9, clientes: 1e9, vendasMes: 1e9, usuarios: 1e9 },
    recursos: [
      "Tudo do ME / Simples",
      "Usuários e cadastros amplos",
      "Multi-loja / multi-CNPJ (roadmap ativo)",
      "Prioridade em novas integrações (Pix, TEF)",
      "Exportações para o contador",
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
