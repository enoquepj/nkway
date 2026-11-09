import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalogosNcm } from "@/db/schema";
import { temPermissao } from "@/lib/permissoes";
import { conferirIntegridadeNcm, ErroNcm, estadoCatalogoNcm, FONTE_NCM, hojeNcm, mensagemErroNcm, NCM_POR_PAGINA, termosConsultaNcm, URL_NCM, type CatalogoNcm, type ConsultaNcmDto, type ItemNcm, type MetadadosNcm } from "@/lib/ncm";
import { registrarAuditoria } from "@/server/auditoria";
import { baixarNcmOficial } from "@/server/ncmFonte";

type AtorNcm = { empresaId: string; usuario: { id: string; nome: string; papel: string } };
const camposMeta = {
  referencia: catalogosNcm.referencia, referenciaFonte: catalogosNcm.referenciaFonte, ato: catalogosNcm.ato,
  hash: catalogosNcm.hash, totalRegistros: catalogosNcm.totalRegistros, totalCodigos: catalogosNcm.totalCodigos,
  coletadoEm: catalogosNcm.coletadoEm, tentativaEm: catalogosNcm.tentativaEm,
  falhaEm: catalogosNcm.falhaEm, erro: catalogosNcm.erro, leaseAte: catalogosNcm.leaseAte, repetirApos: catalogosNcm.repetirApos,
};
type LinhaMeta = Omit<typeof catalogosNcm.$inferSelect, "empresaId" | "registros" | "leaseId">;
function metadados(linha?: LinhaMeta): MetadadosNcm {
  const agora = new Date();
  return {
    fonte: FONTE_NCM, url: URL_NCM, referencia: linha?.referencia ?? null,
    referenciaFonte: linha?.referenciaFonte ?? null, ato: linha?.ato ?? null,
    coletadoEm: linha?.coletadoEm?.toISOString() ?? null, tentativaEm: linha?.tentativaEm?.toISOString() ?? null,
    falhaEm: linha?.falhaEm?.toISOString() ?? null, erro: mensagemErroNcm(linha?.erro), hash: linha?.hash ?? null,
    totalRegistros: linha?.totalRegistros ?? 0, totalCodigos: linha?.totalCodigos ?? 0,
    estado: estadoCatalogoNcm(linha?.coletadoEm ?? null, linha?.referencia ?? null, agora),
    atualizando: !!linha?.leaseAte && linha.leaseAte > agora, repetirApos: linha?.repetirApos?.toISOString() ?? null,
  };
}

/** Consulta SQL limitada. Snapshot de leitura consistente; nunca envia o catálogo inteiro ao navegador. */
export async function consultarNcm(empresaId: string, consulta: string, pagina = 1, podeAtualizar = false): Promise<ConsultaNcmDto> {
  if (consulta.length > 80 || !Number.isInteger(pagina) || pagina < 1 || pagina > 2000) throw new Error("Consulta NCM inválida.");
  return db.transaction(async (tx) => {
    const [linha] = await tx.select(camposMeta).from(catalogosNcm).where(eq(catalogosNcm.empresaId, empresaId)).limit(1);
    const catalogo = metadados(linha);
    const base: ConsultaNcmDto = { catalogo, consulta, pagina: 1, porPagina: NCM_POR_PAGINA, total: 0, itens: [], grupos: [], podeAtualizar, hoje: hojeNcm() };
    if (!linha?.hash || !linha.coletadoEm) return base;
    const busca = termosConsultaNcm(consulta);
    const filtro = busca.codigo
      ? sql`left(r.item->>'codigo', ${busca.codigo.length}) = ${busca.codigo}`
      : busca.termos.length ? sql.join(busca.termos.map((t) => sql`position(${t} in (r.item->>'busca')) > 0`), sql` and `) : sql`true`;
    const origem = sql`from ${catalogosNcm} cross join lateral jsonb_array_elements(${catalogosNcm.registros}) as r(item)
      where ${catalogosNcm.empresaId} = ${empresaId} and (${filtro})`;
    const total = await tx.execute<{ n: number }>(sql`select count(*)::integer as n ${origem} and length(r.item->>'codigo') = 8`);
    const n = Number(total.rows[0]?.n ?? 0);
    const paginaReal = Math.min(pagina, Math.max(1, Math.ceil(n / NCM_POR_PAGINA)));
    const itens = await tx.execute<{ item: ItemNcm }>(sql`select r.item - 'busca' as item ${origem}
      and length(r.item->>'codigo') = 8 order by r.item->>'codigo' limit ${NCM_POR_PAGINA} offset ${(paginaReal - 1) * NCM_POR_PAGINA}`);
    const grupos = await tx.execute<{ item: ItemNcm }>(sql`select r.item - 'busca' as item ${origem}
      and length(r.item->>'codigo') < 8 and length(r.item->>'codigo') > ${busca.codigo?.length ?? 0}
      order by length(r.item->>'codigo'), r.item->>'codigo' limit 8`);
    return { ...base, pagina: paginaReal, total: n, itens: itens.rows.map((r) => r.item), grupos: grupos.rows.map((r) => r.item) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export type AtualizacaoNcm = { estado: "atualizado" | "reutilizado" | "em_atualizacao" | "aguardar" | "falha"; mensagem: string };

/**
 * Lease e recuo persistem no Postgres, não na memória da função serverless.
 * O executor de download só é injetável por código servidor/testes, nunca pela API.
 * Não mantém transação/conexão reservada durante a consulta externa.
 */
export async function atualizarNcm(ator: AtorNcm, baixar: () => Promise<CatalogoNcm> = baixarNcmOficial): Promise<AtualizacaoNcm> {
  if (!temPermissao(ator.usuario.papel, "config.gerenciar")) throw new Error("Acesso negado à atualização do catálogo.");
  const empresaId = ator.empresaId;
  await db.insert(catalogosNcm).values({ empresaId }).onConflictDoNothing();
  const leaseId = randomUUID();
  const [anterior] = await db.update(catalogosNcm).set({
    leaseId, leaseAte: sql`now() + interval '45 seconds'`, tentativaEm: sql`now()`, repetirApos: sql`now() + interval '15 minutes'`,
  }).where(and(
    eq(catalogosNcm.empresaId, empresaId),
    or(isNull(catalogosNcm.leaseAte), lte(catalogosNcm.leaseAte, sql`now()`)),
    or(isNull(catalogosNcm.coletadoEm), lte(catalogosNcm.coletadoEm, sql`now() - interval '24 hours'`), sql`${catalogosNcm.referencia} < (now() at time zone 'America/Sao_Paulo')::date`),
    or(isNull(catalogosNcm.repetirApos), lte(catalogosNcm.repetirApos, sql`now()`), and(isNotNull(catalogosNcm.leaseId), lte(catalogosNcm.leaseAte, sql`now()`))),
  )).returning({ hash: catalogosNcm.hash, referencia: catalogosNcm.referencia, totalCodigos: catalogosNcm.totalCodigos });
  if (!anterior) {
    const [atual] = await db.select(camposMeta).from(catalogosNcm).where(eq(catalogosNcm.empresaId, empresaId)).limit(1);
    const agora = new Date();
    if (atual?.leaseAte && atual.leaseAte > agora) return { estado: "em_atualizacao", mensagem: "Outra atualização está em andamento. A versão anterior continua disponível; consulte novamente em instantes." };
    if (atual?.repetirApos && atual.repetirApos > agora) return { estado: "aguardar", mensagem: "Aguarde o intervalo de 15 minutos entre tentativas. A versão anterior e o preenchimento manual permanecem disponíveis." };
    return { estado: "reutilizado", mensagem: "A cópia foi coletada há menos de 24 horas. Consulte a referência declarada pela fonte; nenhum produto foi alterado." };
  }

  try {
    const novo = await baixar();
    conferirIntegridadeNcm(novo, anterior);
    const hash = createHash("sha256").update(JSON.stringify(novo)).digest("hex");
    const gravou = await db.transaction(async (tx) => {
      const linhas = await tx.update(catalogosNcm).set({
        registros: novo.registros, hash, referencia: novo.referencia, referenciaFonte: novo.referenciaFonte, ato: novo.ato,
        totalRegistros: novo.registros.length, totalCodigos: novo.totalCodigos, coletadoEm: sql`now()`,
        erro: null, falhaEm: null, leaseId: null, leaseAte: null,
        repetirApos: novo.referencia < hojeNcm() ? sql`now() + interval '15 minutes'` : null,
      }).where(and(eq(catalogosNcm.empresaId, empresaId), eq(catalogosNcm.leaseId, leaseId), sql`${catalogosNcm.leaseAte} > now()`)).returning({ empresaId: catalogosNcm.empresaId });
      if (!linhas.length) return false;
      await registrarAuditoria({ empresaId, usuario: ator.usuario, acao: "fiscal.ncm_coletar", entidade: "catalogo_ncm", registroId: empresaId,
        resumo: "Catálogo NCM coletado da Receita; nenhum produto ou documento alterado.",
        alteracoes: { fonte: FONTE_NCM, hashAntes: anterior.hash, hashDepois: hash, referenciaDeclarada: novo.referenciaFonte, totalCodigos: novo.totalCodigos, produtosAlterados: 0, documentosAlterados: 0 } }, tx);
      return true;
    });
    return gravou
      ? { estado: "atualizado", mensagem: "Catálogo coletado e auditado. Confira a referência informada pela fonte. Produtos, perfis e documentos não foram alterados." }
      : { estado: "em_atualizacao", mensagem: "Esta tentativa perdeu a concessão de atualização. Sua resposta foi descartada; consulte o estado atual." };
  } catch (e) {
    const erro = e instanceof ErroNcm ? e : new ErroNcm("persistencia");
    // Não mexer em registros/hash/referência/coleta. Um worker antigo não pode apagar o estado de um novo.
    try {
      await db.update(catalogosNcm).set({ erro: erro.codigo, falhaEm: sql`now()`, leaseId: null, leaseAte: null })
        .where(and(eq(catalogosNcm.empresaId, empresaId), eq(catalogosNcm.leaseId, leaseId)));
    } catch { /* A concessão expira no banco; nenhuma exceção interna é enviada ao cliente. */ }
    return { estado: "falha", mensagem: erro.message };
  }
}
