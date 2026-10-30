"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { eventosFiscais, inutilizacoes, vendas } from "@/db/schema";
import { validarChaveAcesso } from "@/lib/dominio";
import { comoErro, tenant } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string; protocolo?: string } | { ok: false; erro: string };

const revalidar = () => ["/documentos", "/pdv", "/config", "/"].forEach((p) => revalidatePath(p));

/** justificativa exigida pela SEFAZ: 15 a 255 caracteres */
const justificativaOk = (t: string) => t.trim().length >= 15 && t.trim().length <= 255;

const protocoloDe = () => `111${Date.now()}`.slice(0, 15);

/** maior número já emitido para o modelo/série (ignora cancelados) */
async function ultimoEmitido(empresaId: string, modelo: string, serie: string) {
  const [r] = await db
    .select({ n: sql<string | null>`max(${vendas.numeroNota})` })
    .from(vendas)
    .where(and(eq(vendas.empresaId, empresaId), eq(vendas.tipo, "fiscal"), eq(vendas.modelo, modelo), eq(vendas.serie, serie)));
  return Number(r?.n ?? 0);
}

/**
 * Próximo número disponível para o modelo/série, pulando intervalos inutilizados.
 * A implementação única vive em `src/server/dados.ts` (é usada pelo painel e pelo PDV).
 */
export async function proximoNumeroNota(empresaId: string, modelo: string, serie: string): Promise<number> {
  const { proximoNumeroFiscal } = await import("@/server/dados");
  return proximoNumeroFiscal(empresaId, modelo, serie);
}

/** inutiliza um intervalo de numeração (numeração que foi pulada ou perdida) */
export async function inutilizarNumeracao(input: {
  modelo: string;
  serie: string;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
}): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const inicio = Math.floor(input.numeroInicial);
    const fim = Math.floor(input.numeroFinal);
    if (!inicio || !fim) return { ok: false, erro: "Informe o número inicial e o final do intervalo." };
    if (inicio > fim) return { ok: false, erro: "O número inicial deve ser menor ou igual ao final." };
    if (inicio < 1) return { ok: false, erro: "A numeração começa em 1." };
    if (!justificativaOk(input.justificativa))
      return { ok: false, erro: `A justificativa precisa ter entre 15 e 255 caracteres (atual ${input.justificativa.trim().length}).` };

    const ultimo = await ultimoEmitido(empresaId, input.modelo, input.serie);
    if (inicio <= ultimo)
      return {
        ok: false,
        erro: `O número ${inicio} já foi usado nesta série (último emitido: ${ultimo}). Inutilização serve só para numeração não emitida.`,
      };
    if (fim > inicio + 500) return { ok: false, erro: "Intervalo muito longo — a SEFAZ aceita até 500 números por pedido." };

    // sobreposição com faixa já inutilizada
    const existentes = await db
      .select()
      .from(inutilizacoes)
      .where(and(eq(inutilizacoes.empresaId, empresaId), eq(inutilizacoes.modelo, input.modelo), eq(inutilizacoes.serie, input.serie), eq(inutilizacoes.status, "homologado")));
    const conflito = existentes.find((x) => inicio <= x.numeroFinal && fim >= x.numeroInicial);
    if (conflito) return { ok: false, erro: `Este intervalo já está inutilizado (pedido ${conflito.numeroInicial} a ${conflito.numeroFinal}).` };

    const protocolo = protocoloDe();
    await db.insert(inutilizacoes).values({
      empresaId,
      modelo: input.modelo,
      serie: input.serie,
      numeroInicial: inicio,
      numeroFinal: fim,
      justificativa: input.justificativa.trim(),
      status: "homologado",
      protocolo,
    });
    revalidar();
    const qt = fim - inicio + 1;
    return { ok: true, protocolo, aviso: `${qt} número(s) inutilizado(s) — protocolo ${protocolo}. O PDV vai pular este intervalo.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** cancela (desfaz) uma inutilização — volta o intervalo para a numeração disponível */
export async function cancelarInutilizacao(id: string): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const [reg] = await db
      .select()
      .from(inutilizacoes)
      .where(and(eq(inutilizacoes.id, id), eq(inutilizacoes.empresaId, empresaId)))
      .limit(1);
    if (!reg) return { ok: false, erro: "Pedido de inutilização não encontrado." };
    if (reg.status === "cancelado") return { ok: false, erro: "Este pedido já está cancelado." };
    await db.update(inutilizacoes).set({ status: "cancelado" }).where(eq(inutilizacoes.id, reg.id));
    revalidar();
    return { ok: true, aviso: `Inutilização de ${reg.numeroInicial} a ${reg.numeroFinal} cancelada — números voltam a ficar disponíveis.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** emite carta de correção para uma nota autorizada (evento 110110) */
export async function emitirCartaCorrecao(input: { vendaId: string; correcao: string }): Promise<Resultado> {
  try {
    const { empresaId } = await tenant();
    const texto = input.correcao.trim();
    if (texto.length < 15) return { ok: false, erro: `A correção precisa ter no mínimo 15 caracteres (atual ${texto.length}).` };
    if (texto.length > 1000) return { ok: false, erro: "A correção pode ter no máximo 1000 caracteres." };

    const [v] = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.id, input.vendaId), eq(vendas.empresaId, empresaId)))
      .limit(1);
    if (!v) return { ok: false, erro: "Documento não encontrado." };
    if (v.tipo !== "fiscal") return { ok: false, erro: "Carta de correção só vale para documento fiscal autorizado." };
    if (v.status === "cancelado") return { ok: false, erro: "Documento cancelado não aceita carta de correção — use a emissão de nova nota." };
    if (!v.chave || !validarChaveAcesso(v.chave)) return { ok: false, erro: "Documento sem chave de acesso válida." };
    if (!v.protocolo) return { ok: false, erro: "Documento sem protocolo de autorização — não é possível vincular o evento." };

    // carta de correção não pode alterar valores, destinatário, CFOP, NCM nem data
    const proibidos = [/valor/i, /pre[çc]o/i, /total/i, /cpf/i, /cnpj/i, /destinat[áa]rio/i, /cfop/i, /ncm/i, /data/i, /quantidade/i];
    const achou = proibidos.find((re) => re.test(texto));
    if (achou) {
      const campo = achou.source.replace(/\\\\/g, "").replace(/[/^$()]/g, "");
      return {
        ok: false,
        erro: `Carta de correção não altera ${campo || "campos fiscais"}. Para isso, cancele a nota e emita outra (nota complementar).`,
      };
    }

    const anteriores = await db
      .select({ s: eventosFiscais.sequencia })
      .from(eventosFiscais)
      .where(and(eq(eventosFiscais.empresaId, empresaId), eq(eventosFiscais.vendaId, v.id), eq(eventosFiscais.tipo, "carta_correcao")));
    const sequencia = anteriores.reduce((m, x) => Math.max(m, x.s), 0) + 1;
    if (sequencia > 20) return { ok: false, erro: "Limite de 20 cartas de correção por documento atingido." };

    const protocolo = `${v.protocolo}10`;
    await db.insert(eventosFiscais).values({
      empresaId,
      vendaId: v.id,
      chave: v.chave,
      tipo: "carta_correcao",
      sequencia,
      descricao: texto,
      protocolo,
    });
    revalidar();
    return { ok: true, protocolo, aviso: `Carta de correção nº ${sequencia} vinculada — protocolo ${protocolo}.` };
  } catch (e) {
    return comoErro(e);
  }
}

/** lista os eventos de um documento (usado no detalhe) */
export async function eventosDoDocumento(vendaId: string) {
  const { empresaId } = await tenant();
  const r = await db
    .select()
    .from(eventosFiscais)
    .where(and(eq(eventosFiscais.empresaId, empresaId), eq(eventosFiscais.vendaId, vendaId)));
  return r.map((e) => ({
    id: e.id,
    tipo: e.tipo,
    sequencia: e.sequencia,
    descricao: e.descricao,
    protocolo: e.protocolo ?? "",
    em: new Date(e.createdAt ?? 0).toISOString(),
  }));
}
