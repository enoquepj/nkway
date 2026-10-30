"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clientes, empresas, fornecedores, produtos, usuarios } from "@/db/schema";
import { criarSessao, confereSenha, encerrarSessao, hashSenha, lerSessao } from "@/lib/session";
import { cadeia, texto } from "@/server/tenant";
import { gerarGtin } from "@/lib/dominio";

export type Resultado = { ok: true } | { ok: false; erro: string };

/** catálogo curto criado junto com a empresa (ajuda o lojista a começar operando) */
async function semear(empresaId: string, uf: string) {
  const itens = [
    ["ARROZ TIPO 1 5KG", "Mercearia", 22.4, 32.9, "PC", 24],
    ["FEIJAO CARIOCA TIPO 1 1KG", "Mercearia", 7.15, 11.9, "UN", 40],
    ["OLEO DE SOJA 900ML", "Mercearia", 6.35, 9.9, "UN", 36],
    ["ACUCAR REFINADO 5KG", "Mercearia", 14.9, 21.9, "PC", 18],
    ["CAFE TOSTADO 500G", "Mercearia", 12.4, 18.9, "UN", 30],
    ["LEITE UHT 1L", "Mercearia", 4.35, 6.79, "UN", 60],
    ["REFRIGERANTE COLA 2L", "Bebidas", 6.9, 11.5, "UN", 48],
    ["AGUA MINERAL 500ML", "Bebidas", 1.1, 2.5, "UN", 120],
    ["CERVEJA LATTAO 350ML", "Bebidas", 2.85, 4.99, "UN", 180],
    ["SABAO EM PO 500G", "Limpeza", 5.6, 9.9, "UN", 25],
    ["DETERGENTE 500ML", "Limpeza", 2.3, 4.49, "UN", 44],
    ["PAPEL HIGIENICO 12UN", "Higiene", 15.2, 24.9, "PC", 16],
    ["SABONETE 90G", "Higiene", 1.45, 2.99, "UN", 80],
    ["AMACIANTE 2L", "Limpeza", 7.8, 13.9, "UN", 18],
    ["MORTADELA FATIADO 1KG", "Frios", 15.5, 25.9, "KG", 9],
    ["QUEIJO MUSSARELA 1KG", "Frios", 28.4, 45.9, "KG", 7],
    ["PACO FRANCA 1KG", "Padaria", 8.2, 14.9, "KG", 12],
  ] as const;
  let seq = 1;
  for (const [nome, categoria, custo, preco, unidade, estoque] of itens) {
    await db.insert(produtos).values({
      empresaId,
      nome,
      sku: `NK${String(seq).padStart(4, "0")}`,
      gtin: gerarGtin(1000 + seq),
      categoria,
      marca: categoria === "Bebidas" ? "Nacional" : "Linha Way",
      unidade,
      custo,
      preco,
      estoque,
      estoqueMin: Math.max(4, Math.round(estoque * 0.2)),
      pesavel: unidade === "KG",
      ncm: "00000000",
      cfop: "5102",
      csosn: "102",
      icmsAliq: 0,
      pisAliq: 0,
      cofinsAliq: 0,
    });
    seq++;
  }
  await db.insert(clientes).values([
    { empresaId, nome: "CONSUMIDOR FINAL", documento: "", cidade: "Ji-Paraná", uf, condicaoPadrao: "a vista" },
    {
      empresaId,
      nome: "MERCADINHO BOA VISTA LTDA",
      documento: "12.345.678/0001-90",
      cidade: "Ji-Paraná",
      uf,
      limiteCredito: 1500,
      condicaoPadrao: "30d",
      email: "compras@boavista.exemplo",
      telefone: "(69) 3421-0000",
    },
    {
      empresaId,
      nome: "RESTAURANTE SABOR Caseiro",
      documento: "98.765.432/0001-10",
      cidade: "Porto Velho",
      uf,
      limiteCredito: 2500,
      condicaoPadrao: "14d",
      telefone: "(69) 99911-2233",
    },
  ]);
  await db.insert(fornecedores).values([
    {
      empresaId,
      nome: "DISTRIBUIDORA NORTE SUL LTDA",
      cnpj: "11.222.333/0001-44",
      cidade: "Porto Velho",
      uf,
      telefone: "(69) 3222-1000",
      prazoPagDias: 28,
    },
    {
      empresaId,
      nome: "ATACADAO AMAZONIA SA",
      cnpj: "22.333.444/0001-55",
      cidade: "Cacoal",
      uf,
      telefone: "(69) 3441-2020",
      prazoPagDias: 21,
    },
  ]);
}

export async function entrar(bruto: unknown): Promise<Resultado> {
  // server action pode receber undefined quando o cliente envia o corpo fora do formato esperado
  const input = (bruto ?? {}) as { email?: string; senha?: string };
  const email = String(input.email ?? "").trim().toLowerCase();
  const senha = String(input.senha ?? "");
  if (!email || !senha) return { ok: false, erro: "Informe e-mail e senha." };
  const [usuario] = await db.select().from(usuarios).where(eq(usuarios.email, email)).limit(1);
  if (!usuario || !confereSenha(senha, usuario.senhaHash))
    return { ok: false, erro: "E-mail ou senha não conferem." };
  await criarSessao({ empresaId: usuario.empresaId, usuarioId: usuario.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

export type CadastroInput = {
  empresa: string;
  cnpj: string;
  uf: string;
  municipio: string;
  regime: string;
  porte: string;
  nome: string;
  email: string;
  senha: string;
  comCatalogo: boolean;
};

export async function cadastrar(bruto: unknown): Promise<Resultado> {
  const input = (bruto ?? {}) as CadastroInput;
  const e = { ...input, email: String(input.email ?? "").trim().toLowerCase() };
  if (!String(e.empresa ?? "").trim()) return { ok: false, erro: "Informe o nome da empresa." };
  if (texto(e.cnpj).replace(/\D/g, "").length !== 14) return { ok: false, erro: "CNPJ deve ter 14 dígitos." };
  if (!/^\S+@\S+\.\S+$/.test(e.email)) return { ok: false, erro: "E-mail inválido." };
  if (String(e.senha ?? "").length < 6) return { ok: false, erro: "A senha precisa de pelo menos 6 caracteres." };

  const [existente] = await db.select().from(usuarios).where(eq(usuarios.email, e.email)).limit(1);
  if (existente) return { ok: false, erro: "Este e-mail já possui acesso. Faça login." };

  const trialUntil = new Date();
  trialUntil.setDate(trialUntil.getDate() + 14);

  const [empresa] = await db
    .insert(empresas)
    .values({
      nome: String(e.empresa ?? "").trim(),
      nomeFantasia: String(e.empresa ?? "").trim(),
      cnpj: e.cnpj,
      uf: e.uf,
      municipio: e.municipio,
      regime: e.regime,
      porte: e.porte,
      email: e.email,
      plano: "me",
      trialUntil,
      fiscal: {
        ambiente: 2,
        serieNfce: "1",
        serieNfe: "1",
        serieMdfe: "1",
        crt: e.regime === "mei" ? 4 : 1,
        ufPadrao: e.uf,
      },
    })
    .returning({ id: empresas.id });

  await db.insert(usuarios).values({
    empresaId: empresa.id,
    nome: String(e.nome ?? "").trim() || "Proprietário",
    email: e.email,
    senhaHash: hashSenha(e.senha),
    papel: "owner",
  });
  await semear(empresa.id, e.uf);
  await criarSessao({ empresaId: empresa.id, usuarioId: (await db.select().from(usuarios).where(eq(usuarios.email, e.email)).limit(1))[0].id });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function sair() {
  await encerrarSessao();
  revalidatePath("/", "layout");
  redirect("/login");
}

export async function trocarSenha(nova: unknown): Promise<Resultado> {
  const senha = cadeia(nova);
  if (senha.length < 6) return { ok: false, erro: "A senha precisa de pelo menos 6 caracteres." };
  const s = await lerSessao();
  if (!s) return { ok: false, erro: "Sessão expirada." };
  await db.update(usuarios).set({ senhaHash: hashSenha(senha) }).where(eq(usuarios.id, s.usuarioId));
  return { ok: true };
}
