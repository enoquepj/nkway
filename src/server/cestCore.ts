import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogoCest } from "@/db/schema";
import { temPermissao } from "@/lib/permissoes";
import {
  CEST_POR_PAGINA, ErroCest, FONTE_CEST_LOCAL, NOTA_FONTE_CEST, estadoCatalogoCest,
  termosConsultaCest, validarCatalogoCest, validarRegistroCest,
  type ConsultaCestDto, type ItemCest, type MetadadosCest, type RegistroCest, type ResultadoCest,
} from "@/lib/cest";
import { registrarAuditoria } from "@/server/auditoria";

export type AtorCest = { empresaId: string; usuario: { id: string; nome: string; papel: string } };

const camposMeta = {
  registros: catalogoCest.registros, hash: catalogoCest.hash, fonte: catalogoCest.fonte,
  totalRegistros: catalogoCest.totalRegistros, atualizadoEm: catalogoCest.atualizadoEm,
};
type LinhaMeta = typeof catalogoCest.$inferSelect;

function metadados(linha?: Partial<LinhaMeta>): MetadadosCest {
  return {
    fonte: linha?.fonte || FONTE_CEST_LOCAL,
    nota: NOTA_FONTE_CEST,
    totalRegistros: linha?.totalRegistros ?? 0,
    hash: linha?.hash ?? null,
    atualizadoEm: linha?.atualizadoEm?.toISOString() ?? null,
    estado: estadoCatalogoCest(linha?.totalRegistros ?? 0),
  };
}

/**
 * Consulta somente leitura da referência local da empresa da sessão.
 * Snapshot consistente; nunca envia o catálogo inteiro ao navegador; nunca acessa outra empresa.
 * Aceita prefixo/exato de CEST (1–7 dígitos), NCM exato (8 dígitos) ou texto livre.
 */
export async function consultarCest(empresaId: string, consulta: string, pagina = 1, podeGerenciar = false): Promise<ConsultaCestDto> {
  if (consulta.length > 80 || !Number.isInteger(pagina) || pagina < 1 || pagina > 2000) throw new Error("Consulta CEST inválida.");
  return db.transaction(async (tx) => {
    const [linha] = await tx.select(camposMeta).from(catalogoCest).where(eq(catalogoCest.empresaId, empresaId)).limit(1);
    const catalogo = metadados(linha);
    const base: ConsultaCestDto = { catalogo, consulta, pagina: 1, porPagina: CEST_POR_PAGINA, total: 0, itens: [], podeGerenciar };
    if (!linha?.registros?.length) return base;
    const busca = termosConsultaCest(consulta);
    // Prefixo de dígitos casa CEST (1–7) e NCM/SH (2–8, pois os anexos usam prefixos como 2205 e 2402).
    const filtro = busca.digitos
      ? sql`(r.item->>'cest' like ${`${busca.digitos}%`} or exists (select 1 from jsonb_array_elements_text(r.item->'ncm') as n(val) where n.val like ${`${busca.digitos}%`}))`
      : busca.termos.length
        ? sql.join(busca.termos.map((t) => sql`position(${t} in (r.item->>'busca')) > 0`), sql` and `)
        : sql`true`;
    const origem = sql`from ${catalogoCest} cross join lateral jsonb_array_elements(${catalogoCest.registros}) as r(item)
      where ${catalogoCest.empresaId} = ${empresaId} and (${filtro})`;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::integer as n ${origem}`);
    const n = Number(total.rows[0]?.n ?? 0);
    const paginaReal = Math.min(pagina, Math.max(1, Math.ceil(n / CEST_POR_PAGINA)));
    const itens = await tx.execute<{ item: ItemCest }>(sql`select r.item - 'busca' as item ${origem}
      order by r.item->>'cest' limit ${CEST_POR_PAGINA} offset ${(paginaReal - 1) * CEST_POR_PAGINA}`);
    return { ...base, pagina: paginaReal, total: n, itens: itens.rows.map((r) => r.item) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * Cadastro/remoção explícita da referência local (somente config.gerenciar).
 * Não há download externo: nenhum URL, arquivo ou catálogo do cliente é aceito.
 * Tudo em transação com auditoria; produtos e documentos nunca são tocados.
 */
export async function gerenciarCest(ator: AtorCest, bruto: unknown): Promise<ResultadoCest> {
  if (!temPermissao(ator.usuario.papel, "config.gerenciar")) throw new ErroCest("acesso_negado");
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, unknown> : {};
  const operacao = String(entrada.operacao ?? "");
  if (!["upsert", "remover"].includes(operacao)) throw new ErroCest("registro_invalido");
  const empresaId = ator.empresaId;
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(catalogoCest).values({ empresaId }).onConflictDoNothing();
      const [linha] = await tx.select().from(catalogoCest).where(eq(catalogoCest.empresaId, empresaId)).for("update");
      const atuais: RegistroCest[] = Array.isArray(linha?.registros) ? linha.registros : [];
      let proximos: RegistroCest[];
      let registro: RegistroCest | null = null;
      if (operacao === "upsert") {
        registro = validarRegistroCest(entrada.registro ?? entrada);
        proximos = validarCatalogoCest([...atuais.filter((r) => r.cest !== registro!.cest), registro]);
      } else {
        const cest = String(entrada.cest ?? "").trim().replace(/[.\s-]/g, "");
        const alvo = atuais.find((r) => r.cest === cest);
        if (!alvo) throw new ErroCest("nao_encontrado");
        registro = alvo;
        proximos = atuais.filter((r) => r.cest !== cest);
      }
      const hash = createHash("sha256").update(JSON.stringify(proximos)).digest("hex");
      const [gravado] = await tx.update(catalogoCest).set({
        registros: proximos, hash,
        fonte: registro?.fonte ?? linha?.fonte ?? FONTE_CEST_LOCAL,
        totalRegistros: proximos.length,
        atualizadoEm: new Date(),
      }).where(eq(catalogoCest.empresaId, empresaId)).returning(camposMeta);
      await registrarAuditoria({
        empresaId, usuario: ator.usuario, acao: "fiscal.cest_referencia", entidade: "catalogo_cest", registroId: empresaId,
        resumo: operacao === "upsert"
          ? "Referência local de CEST cadastrada/atualizada; não é validação oficial e nenhum produto foi alterado."
          : "Referência local de CEST removida; nenhum produto foi alterado.",
        alteracoes: {
          operacao, cest: registro?.cest ?? null, descricao: registro?.descricao ?? null,
          ncmRelacionados: registro?.ncm ?? [], fonte: registro?.fonte ?? null, ato: registro?.ato ?? null,
          vigenciaDeclarada: registro?.vigencia ?? null, totalRegistros: proximos.length,
          produtosAlterados: 0, documentosAlterados: 0, validacaoOficial: false,
        },
      }, tx);
      return {
        ok: true as const,
        estado: (operacao === "upsert" ? "atualizado" : "removido") as "atualizado" | "removido",
        mensagem: operacao === "upsert"
          ? "Referência local gravada e auditada. A aplicação ao produto continua manual e explícita; não houve certificação oficial."
          : "Referência local removida e auditada. Produtos que já usam o CEST não foram alterados.",
        catalogo: metadados(gravado),
      };
    });
  } catch (e) {
    if (e instanceof ErroCest) return { ok: false, erro: e.message, codigo: e.codigo };
    console.error("[cest] falha ao gerenciar referência local:", e instanceof Error ? e.message : e);
    return { ok: false, erro: "Não foi possível gravar a referência local. Nada foi alterado; revise os dados e tente novamente.", codigo: "persistencia" as const };
  }
}
