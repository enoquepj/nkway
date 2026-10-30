"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { empresas, usuarios } from "@/db/schema";
import { hashSenha } from "@/lib/session";
import { hojeISO, mascaraDocumento, planoById } from "@/lib/dominio";
import { comoErro, corpo, numero, tenant, texto } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string } | { ok: false, erro: string };

export async function salvarEmpresa(input: {
  nome: string;
  nomeFantasia: string;
  cnpj: string;
  uf: string;
  municipio: string;
  codMunicipio: string;
  ie: string;
  regime: string;
  porte: string;
  telefone: string;
  email: string;
  endereco: string;
  numero: string;
  bairro: string;
  cep: string;
}): Promise<Resultado> {
  try {
    const { empresa } = await tenant();
    input = corpo(input);
    if (texto(input.nome).trim().length < 2) return { ok: false, erro: "Informe a razão social." };
    if (texto(input.cnpj).replace(/\D/g, "").length !== 14) return { ok: false, erro: "CNPJ deve ter 14 dígitos." };
    await db
      .update(empresas)
      .set({
        nome: texto(input.nome).trim(),
        nomeFantasia: texto(input.nomeFantasia).trim() || texto(input.nome).trim(),
        cnpj: mascaraDocumento(texto(input.cnpj).replace(/\D/g, "")),
        uf: input.uf,
        municipio: texto(input.municipio).trim(),
        codMunicipio: texto(input.codMunicipio).replace(/\D/g, "").slice(0, 7),
        ie: texto(input.ie).trim(),
        regime: input.regime,
        porte: input.porte,
        telefone: texto(input.telefone).trim(),
        email: texto(input.email).trim(),
        endereco: texto(input.endereco).trim(),
        numero: texto(input.numero).trim(),
        bairro: texto(input.bairro).trim(),
        cep: texto(input.cep).replace(/\D/g, ""),
      })
      .where(eq(empresas.id, empresa.id));
    revalidatePath("/config");
    revalidatePath("/", "layout");
    return { ok: true, aviso: "Dados da empresa atualizados." };
  } catch (e) {
    return comoErro(e);
  }
}

/** configuração fiscal (séries, ambiente, CSC e dados do certificado A1 — a senha nunca vai ao banco) */
export async function salvarFiscal(input: {
  serieNfce: string;
  serieNfe: string;
  serieMdfe: string;
  ambiente: 1 | 2;
  cscId: string;
  cscToken: string;
  crt: number;
  certificadoNome: string;
  certificadoValidade: string;
  certificadoSerial: string;
}): Promise<Resultado> {
  try {
    const { empresa } = await tenant();
    input = corpo(input);
    const anterior = (empresa.fiscal ?? {}) as Record<string, unknown>;
    await db
      .update(empresas)
      .set({
        fiscal: {
          ...anterior,
          serieNfce: input.serieNfce || "1",
          serieNfe: input.serieNfe || "1",
          serieMdfe: input.serieMdfe || "1",
          ambiente: input.ambiente,
          cscId: input.cscId,
          cscToken: input.cscToken ? `${texto(input.cscToken).slice(0, 4)}···${texto(input.cscToken).slice(-4)}` : "",
          crt: input.crt,
          certificadoNome: input.certificadoNome,
          certificadoValidade: input.certificadoValidade,
          certificadoSerial: input.certificadoSerial,
          ufPadrao: empresa.uf,
        },
      })
      .where(eq(empresas.id, empresa.id));
    revalidatePath("/config");
    return { ok: true, aviso: "Configuração fiscal salva. O CSC é gravado mascarado no banco." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function alterarPlano(planoId: string): Promise<Resultado> {
  try {
    const { empresa } = await tenant();
    await db
      .update(empresas)
      .set({ plano: planoId, assinaturaPagoEm: planoId === "start" ? null : hojeISO(), trialUntil: planoId === "start" ? empresa.trialUntil : null })
      .where(eq(empresas.id, empresa.id));
    revalidatePath("/", "layout");
    return { ok: true, aviso: "Plano alterado. Cobrança recorrente simulada — integre o gateway em produção." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function criarOperador(input: { nome: string; email: string; senha: string }): Promise<Resultado> {
  try {
    const { empresaId, empresa } = await tenant();
    input = corpo(input);
    const email = texto(input.email).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, erro: "E-mail inválido." };
    if (texto(input.senha).length < 6) return { ok: false, erro: "Senha com no mínimo 6 caracteres." };
    const [existe] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (existe) return { ok: false, erro: "Este e-mail já tem acesso ao NKWAY." };
    const [qtd] = await db
      .select({ n: sql<string>`count(*)` })
      .from(usuarios)
      .where(eq(usuarios.empresaId, empresaId));
    const limite = planoById(empresa.plano).limiteUsuarios;
    if (Number(qtd?.n ?? 0) >= limite)
      return { ok: false, erro: `O plano ${planoById(empresa.plano).nome} permite ${limite} acesso(s). Faça upgrade para liberar mais terminais.` };
    await db.insert(usuarios).values({ empresaId, nome: texto(input.nome) || "Operador", email, senhaHash: hashSenha(texto(input.senha)), papel: "operador" });
    revalidatePath("/config");
    return { ok: true, aviso: `${texto(input.nome) || "Operador"} pode operar o PDV com este login.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function removerOperador(id: string): Promise<Resultado> {
  try {
    const { empresaId, usuario } = await tenant();
    if (usuario.id === id) return { ok: false, erro: "Você não pode remover o próprio acesso." };
    await db.delete(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.empresaId, empresaId)));
    revalidatePath("/config");
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}
