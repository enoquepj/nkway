import { supabase } from "../lib/supabase";
import type { Cliente, DB, Lancamento, Produto, Venda } from "./types";

/** Perfil do usuário logado + dados da empresa (tenant) */
export type Perfil = {
  usuarioId: string;
  empresaId: string;
  nome: string;
  email: string;
  empresa: string;
  cnpj: string;
  plano: "free" | "pro" | "ultra";
  trialFim: number;
};

const sb = () => {
  if (!supabase) throw new Error("Supabase não configurado (modo demo).");
  return supabase;
};

// ------------------------------------------------------------------
// AUTENTICAÇÃO
// ------------------------------------------------------------------
export async function cloudSignUp(d: {
  empresa: string;
  cnpj: string;
  nome: string;
  email: string;
  senha: string;
}) {
  const { error } = await sb().auth.signUp({ email: d.email, password: d.senha });
  if (error) return error.message;
  // cria empresa + vínculo do usuário em uma transação (RPC no banco)
  const { error: e2 } = await sb().rpc("criar_empresa", {
    p_nome: d.empresa,
    p_cnpj: d.cnpj,
    p_usuario: d.nome,
  });
  return e2?.message ?? null;
}

export async function cloudSignIn(email: string, senha: string) {
  const { error } = await sb().auth.signInWithPassword({ email, password: senha });
  return error?.message ?? null;
}

export async function cloudSignOut() {
  await sb().auth.signOut();
}

export async function carregarPerfil(): Promise<Perfil | null> {
  const { data: sessao } = await sb().auth.getUser();
  const user = sessao.user;
  if (!user) return null;

  const { data } = await sb()
    .from("usuarios")
    .select("id, nome, email, empresa_id, empresas(nome, cnpj, plano, trial_fim)")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  const emp = (data as any).empresas;
  return {
    usuarioId: data.id,
    empresaId: (data as any).empresa_id,
    nome: data.nome,
    email: data.email,
    empresa: emp?.nome ?? "",
    cnpj: emp?.cnpj ?? "",
    plano: emp?.plano ?? "free",
    trialFim: emp?.trial_fim ? new Date(emp.trial_fim).getTime() : Date.now(),
  };
}

// ------------------------------------------------------------------
// DADOS (todas as queries são filtradas pela RLS automaticamente)
// ------------------------------------------------------------------
export async function carregarDb(): Promise<DB> {
  const [p, c, v, l] = await Promise.all([
    sb().from("produtos").select("*").order("nome"),
    sb().from("clientes").select("*").order("nome"),
    sb().from("vendas").select("*").order("data", { ascending: false }),
    sb().from("lancamentos").select("*").order("vencimento"),
  ]);

  return {
    configFiscal: {
      regime: "simples",
      crt: 1,
      ufPadrao: "SP",
      serieNfce: "1",
      serieNfe: "1",
      ambiente: 2,
      certificadoNome: "",
      certificadoValidade: "",
      certificadoSerial: "",
      cscId: "000001",
      cscToken: "",
    },
    fornecedores: [],
    devolucoes: [],
    cancelamentos: [],
    inutilizacoes: [],
    entradas: [],
    movimentos: [],
    mdfes: [],
    produtos: (p.data ?? []).map(
      (x: any): Produto => ({
        id: x.id,
        nome: x.nome,
        sku: x.sku ?? "",
        categoria: x.categoria ?? "",
        custo: Number(x.custo),
        preco: Number(x.preco),
        estoque: x.estoque,
        estoqueMin: x.estoque_min,
        gtin: x.gtin ?? "",
        unidade: x.unidade ?? "UN",
        marca: x.marca ?? "",
        impostos: x.impostos ?? {
          ncm: "", cest: "", cfop: "5102", cstIcms: "00", csosn: "101",
          icmsAliq: 18, icmsReducao: 0, cstIpi: "55", ipiAliq: 0,
          cstPis: "01", pisAliq: 1.65, cstCofins: "01", cofinsAliq: 7.6, origemMercadoria: 0
        },
      }),
    ),
    clientes: (c.data ?? []) as Cliente[],
    vendas: (v.data ?? []).map(
      (x: any): Venda => ({
        id: x.id,
        numero: x.numero,
        clienteId: x.cliente_id,
        clienteNome: x.cliente_nome,
        itens: x.itens,
        total: Number(x.total),
        desconto: Number(x.desconto),
        pagamento: x.pagamento,
        tipo: x.tipo,
        status: x.status,
        validade: x.validade ?? undefined,
        observacao: x.observacao ?? undefined,
        fiscal: x.fiscal ?? undefined,
        data: new Date(x.data).getTime(),
        vFrete: Number(x.v_frete ?? 0),
        transporte: x.transporte ?? null,
        tPag: x.t_pag,
        vPago: x.v_pago != null ? Number(x.v_pago) : undefined,
        vTroco: x.v_troco != null ? Number(x.v_troco) : undefined,
      }),
    ),
    lancamentos: (l.data ?? []).map(
      (x: any): Lancamento => ({
        id: x.id,
        descricao: x.descricao,
        valor: Number(x.valor),
        tipo: x.tipo,
        vencimento: x.vencimento,
        pago: x.pago,
        categoria: x.categoria ?? "",
      }),
    ),
  };
}

export const salvarProduto = (empresaId: string, p: Produto) =>
  sb().from("produtos").upsert({
    id: p.id || undefined,
    empresa_id: empresaId,
    nome: p.nome,
    sku: p.sku,
    categoria: p.categoria,
    custo: p.custo,
    preco: p.preco,
    estoque: p.estoque,
    estoque_min: p.estoqueMin,
    gtin: p.gtin, unidade: p.unidade, marca: p.marca,
  });

export const removerProduto = (id: string) => sb().from("produtos").delete().eq("id", id);

export const salvarCliente = (empresaId: string, c: Omit<Cliente, "id"> & { id?: string }) =>
  sb().from("clientes").upsert({ ...c, id: c.id || undefined, empresa_id: empresaId });

export const removerCliente = (id: string) => sb().from("clientes").delete().eq("id", id);

export const salvarVenda = (empresaId: string, v: Venda) =>
  sb().from("vendas").upsert({
    id: v.id || undefined,
    empresa_id: empresaId,
    numero: v.numero,
    cliente_id: v.clienteId,
    cliente_nome: v.clienteNome,
    itens: v.itens,
    total: v.total,
    v_frete: v.vFrete,
    transporte: v.transporte ?? null,
    t_pag: v.tPag ?? null,
    v_pago: v.vPago ?? null,
    v_troco: v.vTroco ?? null,
    desconto: v.desconto,
    pagamento: v.pagamento,
    tipo: v.tipo,
    status: v.status,
    validade: v.validade ?? null,
    observacao: v.observacao ?? null,
    fiscal: v.fiscal ?? null,
  });

export const salvarLancamento = (empresaId: string, l: Lancamento) =>
  sb().from("lancamentos").upsert({
    id: l.id || undefined,
    empresa_id: empresaId,
    descricao: l.descricao,
    valor: l.valor,
    tipo: l.tipo,
    vencimento: l.vencimento,
    pago: l.pago,
    categoria: l.categoria,
  });

export const removerLancamento = (id: string) =>
  sb().from("lancamentos").delete().eq("id", id);
