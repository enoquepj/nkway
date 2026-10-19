import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isCloud } from "../lib/supabase";
import { carregarPerfil, cloudSignIn, cloudSignOut, cloudSignUp } from "./cloud";

export type Conta = {
  id: string;
  empresa: string;
  cnpj: string;
  nome: string;
  email: string;
  senha: string;
  criadoEm: number;
  trialFim: number; // timestamp
  plano: "free" | "pro" | "ultra";
  trialUsado: boolean;
};

const DIA = 86400000;
export const TRIAL_DIAS = 14;

type Ctx = {
  conta: Conta | null;
  contas: Conta[];
  modo: "cloud" | "demo";
  carregando: boolean;
  entrar: (email: string, senha: string) => Promise<string | null>;
  cadastrar: (
    d: Omit<Conta, "id" | "criadoEm" | "trialFim" | "plano" | "trialUsado">,
  ) => Promise<string | null>;
  sair: () => void;
  atualizar: (patch: Partial<Conta>) => void;
  diasRestantes: number;
  emTrial: boolean;
  trialExpirado: boolean;
};

const AuthCtx = createContext<Ctx | null>(null);
const K_CONTAS = "nkway.contas";
const K_SESSAO = "nkway.sessao";

const load = <T,>(k: string, fb: T): T => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : fb;
  } catch {
    return fb;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [contas, setContas] = useState<Conta[]>(() => load<Conta[]>(K_CONTAS, []));
  const [sessao, setSessao] = useState<string | null>(() => load<string | null>(K_SESSAO, null));
  const [carregando, setCarregando] = useState(isCloud);

  /** No modo cloud, traz o perfil da nuvem e espelha no formato local */
  async function sincronizarPerfil() {
    const p = await carregarPerfil();
    if (!p) {
      setSessao(null);
      return;
    }
    const c: Conta = {
      id: p.usuarioId,
      empresa: p.empresa,
      cnpj: p.cnpj,
      nome: p.nome,
      email: p.email,
      senha: "",
      criadoEm: Date.now(),
      trialFim: p.trialFim,
      plano: p.plano,
      trialUsado: true,
    };
    setContas((prev) => [...prev.filter((x) => x.id !== c.id), c]);
    setSessao(c.id);
  }

  // Restaura sessão do Supabase ao abrir o app
  useEffect(() => {
    if (!isCloud) return;
    sincronizarPerfil().finally(() => setCarregando(false));
  }, []);

  useEffect(() => localStorage.setItem(K_CONTAS, JSON.stringify(contas)), [contas]);
  useEffect(() => localStorage.setItem(K_SESSAO, JSON.stringify(sessao)), [sessao]);

  const conta = contas.find((c) => c.id === sessao) ?? null;
  const restMs = conta ? conta.trialFim - Date.now() : 0;
  const diasRestantes = Math.max(0, Math.ceil(restMs / DIA));
  const emTrial = !!conta && conta.plano === "free" && restMs > 0;
  const trialExpirado = !!conta && conta.plano === "free" && restMs <= 0;

  const value: Ctx = {
    conta,
    contas,
    modo: isCloud ? "cloud" : "demo",
    carregando,
    diasRestantes,
    emTrial,
    trialExpirado,
    entrar: async (email, senha) => {
      if (isCloud) {
        const erro = await cloudSignIn(email.trim(), senha);
        if (erro) return erro;
        await sincronizarPerfil();
        return null;
      }
      const c = contas.find((x) => x.email.toLowerCase() === email.toLowerCase().trim());
      if (!c) return "E-mail não encontrado. Crie sua conta grátis.";
      if (c.senha !== senha) return "Senha incorreta.";
      setSessao(c.id);
      return null;
    },
    cadastrar: async (d) => {
      if (isCloud) {
        const erro = await cloudSignUp({ ...d, email: d.email.trim() });
        if (erro) return erro;
        await sincronizarPerfil();
        return null;
      }
      return cadastrarLocal(d);
    },
    sair: () => {
      if (isCloud) void cloudSignOut();
      setSessao(null);
    },
    atualizar: (patch) =>
      setContas((p) => p.map((c) => (c.id === sessao ? { ...c, ...patch } : c))),
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;

  function cadastrarLocal(d: Omit<Conta, "id" | "criadoEm" | "trialFim" | "plano" | "trialUsado">) {
      if (contas.some((x) => x.email.toLowerCase() === d.email.toLowerCase().trim()))
        return "Já existe uma conta com este e-mail.";
      if (d.senha.length < 4) return "A senha deve ter ao menos 4 caracteres.";
      const nova: Conta = {
        ...d,
        email: d.email.trim(),
        id: Math.random().toString(36).slice(2, 10),
        criadoEm: Date.now(),
        trialFim: Date.now() + TRIAL_DIAS * DIA,
        plano: "free",
        trialUsado: true,
      };
    setContas((p) => [...p, nova]);
    setSessao(nova.id);
    return null;
  }
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth fora do provider");
  return ctx;
}
