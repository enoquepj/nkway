"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { mdfes, vendas } from "@/db/schema";
import { gerarChave, round2, UF_NUMERO } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string } | { ok: false; erro: string };

export async function emitirMdfe(input: {
  ufFim: string;
  municipioCarregamento: string;
  municipioDescarregamento: string;
  placa: string;
  ufVeiculo: string;
  rntrc: string;
  condutor: string;
  cpfCondutor: string;
  pesoBruto: number;
  chaves: string[];
}): Promise<Resultado> {
  try {
    const { empresaId, empresa } = await tenant();
    if (!/^[A-Z0-9-]{5,10}$/i.test(input.placa.trim())) return { ok: false, erro: "Placa inválida." };
    if (!input.condutor.trim()) return { ok: false, erro: "Informe o condutor do veículo." };
    if (input.chaves.length === 0) return { ok: false, erro: "Selecione ao menos uma NF-e/NFC-e para compor o manifesto." };

    const docs = await db
      .select({ chave: vendas.chave, total: vendas.total, modelo: vendas.modelo })
      .from(vendas)
      .where(and(eq(vendas.empresaId, empresaId), sql`${vendas.chave} in (${sql.join(input.chaves.map((c) => sql`${c}`), sql`,`)})`));
    if (docs.length === 0) return { ok: false, erro: "Nenhuma nota válida encontrada para o manifesto." };

    const [ultimo] = await db
      .select({ n: sql<string>`coalesce(max(${mdfes.numero}), 0)` })
      .from(mdfes)
      .where(eq(mdfes.empresaId, empresaId));
    const numero = Number(ultimo?.n ?? 0) + 1;
    const serie = String(((empresa.fiscal ?? {}) as Record<string, unknown>).serieMdfe ?? "1");
    const agora = new Date();
    const chave = gerarChave({
      uf: UF_NUMERO[empresa.uf] ?? "00",
      aamm: `${String(agora.getFullYear()).slice(2)}${String(agora.getMonth() + 1).padStart(2, "0")}`,
      cnpj: empresa.cnpj,
      modelo: "58",
      serie,
      numeroNota: numero,
    });
    const valorCarga = round2(docs.reduce((s, d) => s + Number(d.total), 0));

    await db.insert(mdfes).values({
      empresaId,
      numero,
      serie,
      chave,
      protocolo: `1${UF_NUMERO[empresa.uf] ?? "00"}${Date.now().toString().slice(-14)}`,
      ufInicio: empresa.uf,
      ufFim: input.ufFim,
      municipioCarregamento: input.municipioCarregamento,
      municipioDescarregamento: input.municipioDescarregamento,
      placa: input.placa.trim().toUpperCase(),
      rntrc: input.rntrc.trim(),
      condutor: input.condutor.trim(),
      cpfCondutor: input.cpfCondutor.replace(/\D/g, ""),
      documentos: docs.map((d) => ({ chave: d.chave!, tipo: d.modelo ?? "NF-e", valor: round2(Number(d.total)) })),
      pesoBruto: round2(input.pesoBruto),
      valorCarga,
      status: "autorizado",
      emitidoEm: agora,
    });
    revalidatePath("/transporte");
    revalidatePath("/");
    return { ok: true, aviso: `MDF-e ${numero} autorizado em modo homologação · ${docs.length} documento(s) no manifesto.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function encerrarMdfe(id: string, kmPercorrido?: number): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [m] = await db.select({ id: mdfes.id, status: mdfes.status }).from(mdfes).where(and(eq(mdfes.id, id), eq(mdfes.empresaId, empresaId))).limit(1);
    if (!m) return { ok: false, erro: "MDF-e não encontrada." };
    if (m.status !== "autorizado") return { ok: false, erro: "Só é possível encerrar um manifesto em viagem." };
    await db.update(mdfes).set({ status: "encerrado", encerradoEm: new Date() }).where(eq(mdfes.id, m.id));
    revalidatePath("/transporte");
    return { ok: true, aviso: `Manifesto encerrado${kmPercorrido ? ` · ${kmPercorrido} km percorridos` : ""}.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function cancelarMdfe(id: string, motivo: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    if (!motivo.trim()) return { ok: false, erro: "Descreva o motivo do cancelamento." };
    const [m] = await db.select({ id: mdfes.id, status: mdfes.status }).from(mdfes).where(and(eq(mdfes.id, id), eq(mdfes.empresaId, empresaId))).limit(1);
    if (!m) return { ok: false, erro: "MDF-e não encontrada." };
    if (m.status === "encerrado") return { ok: false, erro: "Manifesto encerrado não pode ser cancelado." };
    await db.update(mdfes).set({ status: "cancelado" }).where(eq(mdfes.id, m.id));
    revalidatePath("/transporte");
    return { ok: true, aviso: "MDF-e cancelada." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function ultimoMunicipioViagem() {
  const { empresaId } = await tenant();
  const [m] = await db.select().from(mdfes).where(eq(mdfes.empresaId, empresaId)).orderBy(desc(mdfes.emitidoEm)).limit(1);
  return m ? { ufFim: m.ufFim, descarregamento: m.municipioDescarregamento, placa: m.placa, rntrc: m.rntrc, condutor: m.condutor } : null;
}
