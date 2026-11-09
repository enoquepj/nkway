"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caixaMovimentos, caixaSessoes, clientes, contas, movimentos, produtos, vendaItens, vendas } from "@/db/schema";
import { ratearPagamentosLiquidos } from "@/lib/caixa";
import {
  hojeISO,
  round2,
  somaDias,
  valorAPrazo,
} from "@/lib/dominio";
import { normalizarPagamentosLiquidosPdv, validarCreditoVendaPdv } from "@/lib/pagamentoPdv";
import type { SituacaoFiscalVenda } from "@/lib/situacaoFiscal";
import { registrarAuditoria } from "@/server/auditoria";
import { diagnosticoEmissorServidor, transmitirVendaParaEmissor } from "@/server/emissorFiscalCore";
import { cadeia, comoErro, corpo, exigirPermissao, numero, tenant, texto } from "@/server/tenant";

export type ItemPdv = { produtoId: string; qtd: number; preco: number };
export type Pagamento = { forma: string; valor: number };

const REVALIDAR = ["/", "/pdv", "/caixa", "/documentos", "/emissor", "/estoque", "/financeiro", "/produtos", "/clientes"];
const revalidarTudo = () => REVALIDAR.forEach((p) => revalidatePath(p));

async function proximoNumero(empresaId: string, campo: "numero" | "numeroNota") {
  const alvo = campo === "numero" ? vendas.numero : vendas.numeroNota;
  const [r] = await db
    .select({ n: sql<string | null>`max(${alvo})` })
    .from(vendas)
    .where(eq(vendas.empresaId, empresaId));
  return Number(r?.n ?? 0) + 1;
}

async function proximoNumeroFiscal(empresaId: string, modelo: string, serie: string) {
  const { proximoNumeroNota } = await import("@/server/acoes/numeracao");
  return proximoNumeroNota(empresaId, modelo, serie);
}

const diasCondicao = (c: string) => (c === "7d" ? 7 : c === "14d" ? 14 : c === "60d" ? 60 : c === "30d" ? 30 : 0);

export type ResultadoVenda =
  | {
      ok: true;
      id: string;
      total: number;
      numero: number;
      numeroNota: number | null;
      chave: string | null;
      protocolo: string | null;
      situacaoFiscal: SituacaoFiscalVenda;
      troco: number;
      aviso?: string;
      /** Venda já existia (reenvio da fila offline): nada foi gravado de novo. */
      duplicada?: boolean;
    }
  | { ok: false; erro: string };

type ModoGravacaoInterna = "dav" | "sem_nota" | "emitir_nfce";

async function buscarSessaoCaixaAberta(empresaId: string, operadorId: string) {
  const [aberta] = await db
    .select({ id: caixaSessoes.id, numero: caixaSessoes.numero, terminal: caixaSessoes.terminal })
    .from(caixaSessoes)
    .where(
      and(
        eq(caixaSessoes.empresaId, empresaId),
        eq(caixaSessoes.operadorId, operadorId),
        eq(caixaSessoes.status, "aberto"),
      ),
    )
    .limit(1);
  return aberta ?? null;
}

/**
 * Núcleo interno de gravação de DAV, Venda sem nota ou Venda com emissão de NFC-e.
 * Regra estrita (Etapas 7 e 8): nunca inventa protocolo, chave ou autorização SEFAZ.
 */
async function gravarOperacaoPdv(params: {
  empresaId: string;
  empresa: { uf: string; cnpj: string; fiscal: unknown };
  usuario: { id: string; nome: string; papel: string };
  modo: ModoGravacaoInterna;
  itens: ItemPdv[];
  clienteId: string | null;
  clienteNome: string;
  desconto: number;
  frete: number;
  pagamentos: Pagamento[];
  modelo: "NFC-e" | "NF-e" | "SAT";
  validade?: string;
  observacao?: string;
  davOrigemId?: string;
  operador?: string;
  caixa?: string;
  /** Id gerado no navegador para a fila offline; impede gravar a mesma venda duas vezes num reenvio. */
  idFila?: string;
}): Promise<ResultadoVenda> {
  const idFila = params.idFila && /^[A-Za-z0-9_.-]{6,80}$/.test(params.idFila) ? params.idFila : undefined;
  if (idFila) {
    const marca = `[fila:${idFila}]`;
    const [existente] = await db.select({ id: vendas.id, total: vendas.total, numero: vendas.numero, numeroNota: vendas.numeroNota, chave: vendas.chave, protocolo: vendas.protocolo, situacaoFiscal: vendas.situacaoFiscal, pagamentos: vendas.pagamentos })
      .from(vendas).where(and(eq(vendas.empresaId, params.empresaId), sql`${vendas.observacao} like ${"%" + marca + "%"}`)).limit(1);
    if (existente) {
      const pagos = round2((Array.isArray(existente.pagamentos) ? (existente.pagamentos as { valor?: unknown }[]) : []).reduce((t, pg) => t + (Number(pg?.valor) || 0), 0));
      return { ok: true, id: existente.id, total: Number(existente.total), numero: existente.numero, numeroNota: existente.numeroNota ?? null, chave: existente.chave ?? null, protocolo: existente.protocolo ?? null,
        situacaoFiscal: (existente.situacaoFiscal ?? "nao_emitida") as SituacaoFiscalVenda, troco: round2(Math.max(0, pagos - Number(existente.total))), duplicada: true,
        aviso: `Venda #${existente.numero} já estava gravada (reenvio da fila offline); nada foi duplicado.` };
    }
  }
  const itens = (Array.isArray(params.itens) ? params.itens : [])
    .map((i) => ({
      produtoId: texto((i as { produtoId?: unknown })?.produtoId),
      qtd: numero((i as { qtd?: unknown })?.qtd),
      preco: numero((i as { preco?: unknown })?.preco),
    }))
    .filter((i) => i.produtoId && i.qtd > 0);

  if (itens.length === 0) {
    return { ok: false, erro: "A venda está sem itens válidos." };
  }

  const ehDav = params.modo === "dav";
  const baixaEstoque = !ehDav;

  let sessaoAberta: { id: string; numero: number; terminal: string } | null = null;
  if (!ehDav) {
    sessaoAberta = await buscarSessaoCaixaAberta(params.empresaId, params.usuario.id);
    if (!sessaoAberta) {
      return {
        ok: false,
        erro: "Caixa fechado: abra o seu caixa antes de finalizar vendas.",
      };
    }
  }

  const produtosRows = await db
    .select()
    .from(produtos)
    .where(
      and(
        eq(produtos.empresaId, params.empresaId),
        sql`${produtos.id} in (${sql.join(itens.map((i) => sql`${i.produtoId}`), sql`,`)})`,
      ),
    );
  const porId = new Map(produtosRows.map((p) => [p.id, p]));
  for (const i of itens) {
    if (!porId.has(i.produtoId)) {
      return { ok: false, erro: "Um dos itens não pertence a esta empresa." };
    }
  }

  const subtotal = round2(itens.reduce((s, i) => s + i.qtd * i.preco, 0));
  const desconto = Math.min(Math.max(0, round2(params.desconto)), subtotal);
  const frete = Math.max(0, round2(params.frete || 0));
  const total = round2(subtotal - desconto + frete);
  if (total < 0) return { ok: false, erro: "O desconto não pode superar o subtotal." };

  const pagamentos = (Array.isArray(params.pagamentos) ? params.pagamentos : [])
    .map((p) => ({
      forma: texto((p as { forma?: unknown })?.forma) || "dinheiro",
      valor: round2(Math.max(0, numero((p as { valor?: unknown })?.valor))),
    }))
    .filter((p) => p.valor > 0);

  let pagamentosEfetivos = pagamentos;
  let troco = 0;

  if (!ehDav) {
    const normPag = normalizarPagamentosLiquidosPdv(pagamentos, total);
    if (!normPag.ok) {
      return { ok: false, erro: normPag.erro };
    }
    pagamentosEfetivos = normPag.pagamentosLiquidos;
    troco = normPag.troco;
  }

  const formaPrincipal = pagamentosEfetivos.length
    ? pagamentosEfetivos.slice().sort((a, b) => b.valor - a.valor)[0].forma
    : "dinheiro";
  const aPrazo = !ehDav ? valorAPrazo(pagamentosEfetivos, total, formaPrincipal) : 0;

  if (!ehDav && aPrazo > 0) {
    if (!params.clienteId) {
      return {
        ok: false,
        erro: "Identifique um cliente cadastrado (F8) para registrar venda a prazo ou boleto.",
      };
    }
    const [cliCredito] = await db
      .select()
      .from(clientes)
      .where(and(eq(clientes.id, params.clienteId), eq(clientes.empresaId, params.empresaId)))
      .limit(1);
    if (!cliCredito) {
      return { ok: false, erro: "Cliente informado não pertence a esta empresa." };
    }
    const [resAberto] = await db
      .select({
        saldo: sql<string>`coalesce(sum(${contas.valor} - ${contas.valorPago}), 0)`,
      })
      .from(contas)
      .where(
        and(
          eq(contas.empresaId, params.empresaId),
          eq(contas.tipo, "receber"),
          eq(contas.status, "aberta"),
          sql`(${contas.contraparteId} = ${cliCredito.id} or (${contas.contraparteId} is null and ${contas.contraparteNome} = ${cliCredito.nome}))`,
        ),
      );
    const checkCredito = validarCreditoVendaPdv({
      modo: params.modo,
      pagamentos: pagamentosEfetivos,
      totalVenda: total,
      cliente: {
        id: cliCredito.id,
        nome: cliCredito.nome,
        limiteCredito: Number(cliCredito.limiteCredito) || 0,
        saldoEmAberto: Number(resAberto?.saldo ?? 0) || 0,
      },
    });
    if (!checkCredito.ok) {
      return { ok: false, erro: checkCredito.erro };
    }
  }

  if (baixaEstoque) {
    for (const i of itens) {
      const p = porId.get(i.produtoId)!;
      if (Number(p.estoque) + 0.001 < i.qtd) {
        return { ok: false, erro: `Estoque insuficiente de ${p.nome} (atual ${p.estoque} ${p.unidade}).` };
      }
    }
  }

  // A trava do DAV e a inclusão financeira da venda são feitas juntas abaixo,
  // depois de travar novamente a sessão, para não faturar um DAV em caixa encerrado.
  const numeroVenda = await proximoNumero(params.empresaId, "numero");
  const fiscalCfg = (params.empresa.fiscal ?? {}) as Record<string, unknown>;
  const ambiente = String(fiscalCfg.ambiente ?? "2");
  const tipoRegistro = ehDav ? "dav" : params.modo === "sem_nota" ? "sem_nota" : "fiscal";
  const serieEscolhida =
    tipoRegistro === "fiscal"
      ? String(fiscalCfg[params.modelo === "NF-e" ? "serieNfe" : "serieNfce"] ?? "1")
      : null;
  const numeroNotaReservado =
    tipoRegistro === "fiscal"
      ? await proximoNumeroFiscal(params.empresaId, params.modelo, serieEscolhida!)
      : null;

  const situacaoFiscalInicial: SituacaoFiscalVenda =
    tipoRegistro === "fiscal" ? "pendente_transmissao" : "nao_emitida";

  const gravacao = await db.transaction(async (tx) => {
    if (sessaoAberta) {
      const [sessao] = await tx.select({ status: caixaSessoes.status, operadorId: caixaSessoes.operadorId })
        .from(caixaSessoes)
        .where(and(eq(caixaSessoes.id, sessaoAberta.id), eq(caixaSessoes.empresaId, params.empresaId)))
        .for("update");
      if (!sessao || sessao.status !== "aberto" || sessao.operadorId !== params.usuario.id) {
        return { ok: false as const, erro: "A sessão de caixa foi encerrada simultaneamente. Abra o caixa antes de finalizar a venda." };
      }
    }
    if (params.davOrigemId) {
      const travado = await tx.update(vendas).set({ status: "faturado", situacaoFiscal: "nao_emitida" })
        .where(and(eq(vendas.id, params.davOrigemId), eq(vendas.empresaId, params.empresaId), eq(vendas.tipo, "dav"), eq(vendas.status, "aberto")))
        .returning({ id: vendas.id });
      if (travado.length === 0) return { ok: false as const, erro: "Este DAV já foi faturado ou cancelado." };
    }
    const [venda] = await tx
    .insert(vendas)
    .values({
      empresaId: params.empresaId,
      numero: numeroVenda,
      clienteId: params.clienteId || null,
      clienteNome: params.clienteNome || "CONSUMIDOR",
      subtotal,
      desconto,
      vFrete: frete,
      total,
      formaPagamento: formaPrincipal,
      pagamentos: pagamentosEfetivos,
      tipo: tipoRegistro,
      status: ehDav ? "aberto" : "faturado",
      modelo: tipoRegistro === "fiscal" ? params.modelo : null,
      serie: serieEscolhida,
      numeroNota: numeroNotaReservado,
      chave: null,
      protocolo: null,
      protocoloOrigem: null,
      situacaoFiscal: situacaoFiscalInicial,
      statusSefaz: tipoRegistro === "fiscal" ? "pendente_envio" : "simulado",
      cstatSefaz: tipoRegistro === "fiscal" ? "" : "100",
      motivoSefaz:
        tipoRegistro === "fiscal"
          ? "Pendente de transmissão à SEFAZ"
          : "",
      autorizadaEm: null,
      validade: ehDav ? params.validade || somaDias(hojeISO(), 3) : null,
      observacao: [params.observacao || "", idFila ? `[fila:${idFila}]` : ""].filter(Boolean).join(" ") || null,
      operador: params.operador || params.usuario.nome || "Operador (provisório)",
      operadorId: params.usuario.id,
      caixaSessaoId: sessaoAberta?.id ?? null,
      caixa: sessaoAberta?.terminal || params.caixa || "CAIXA 1",
      ambiente,
      origem: params.davOrigemId ? "dav" : idFila ? "pdv_offline" : "pdv",
      davOrigemId: params.davOrigemId ?? null,
      data: new Date(),
    })
    .returning({ id: vendas.id });
    await tx.insert(vendaItens).values(
      itens.map((i) => {
        const p = porId.get(i.produtoId)!;
        return {
          vendaId: venda.id,
          produtoId: i.produtoId,
          nome: p.nome,
          qtd: round2(i.qtd * 1000) / 1000,
          precoUnit: i.preco,
          total: round2(i.qtd * i.preco),
          unidade: p.unidade,
          gtin: p.gtin,
        };
      }),
    );
    return { ok: true as const, venda };
  });
  if (!gravacao.ok) return gravacao;
  const venda = gravacao.venda;

  let aviso: string | undefined;
  if (baixaEstoque) {
    for (const i of itens) {
      const p = porId.get(i.produtoId)!;
      const saldo = round2(Number(p.estoque) - i.qtd);
      await db.update(produtos).set({ estoque: saldo, atualizadoEm: new Date() }).where(eq(produtos.id, p.id));
      await db.insert(movimentos).values({
        empresaId: params.empresaId,
        produtoId: p.id,
        produtoNome: p.nome,
        tipo: "venda",
        qtd: -i.qtd,
        saldoApos: saldo,
        custoUnit: Number(p.custo),
        custoMedioApos: Number(p.custo),
        documento:
          tipoRegistro === "fiscal"
            ? `Nº ${numeroNotaReservado ?? numeroVenda} ${params.modelo}`
            : `Venda #${numeroVenda}`,
        observacao: params.davOrigemId ? "Faturamento de DAV" : "Venda registrada no PDV",
        usuarioId: params.usuario.id,
        usuarioNome: params.usuario.nome,
      });
      if (saldo <= Number(p.estoqueMin)) aviso = `${p.nome} ficou em nível crítico de estoque.`;
    }
  }

  if (aPrazo > 0) {
    const [cli] = params.clienteId
      ? await db.select().from(clientes).where(eq(clientes.id, params.clienteId)).limit(1)
      : [];
    const dias = cli ? diasCondicao(cli.condicaoPadrao) : 30;
    const rotuloDoc =
      tipoRegistro === "fiscal"
        ? `${params.modelo} nº ${numeroNotaReservado}`
        : `Venda nº ${numeroVenda}`;
    await db.insert(contas).values({
      empresaId: params.empresaId,
      tipo: "receber",
      descricao: `${rotuloDoc} — ${params.clienteNome || "CONSUMIDOR"}`,
      categoria: "Vendas",
      contraparteId: params.clienteId,
      contraparteTipo: params.clienteId ? "cliente" : null,
      contraparteNome: params.clienteNome || "CONSUMIDOR",
      origem: params.davOrigemId ? "dav" : "pdv",
      origemId: venda.id,
      valor: aPrazo,
      vencimento: somaDias(hojeISO(), dias || 30),
      forma: formaPrincipal,
      vendaId: venda.id,
      status: "aberta",
    });
  }

  let chaveFinal: string | null = null;
  let protocoloFinal: string | null = null;
  let situacaoFinal: SituacaoFiscalVenda = situacaoFiscalInicial;

  if (params.modo === "emitir_nfce") {
    const rEmissao = await executarEmissaoNfceInterna({
      empresaId: params.empresaId,
      usuario: params.usuario,
      vendaId: venda.id,
      modelo: params.modelo,
    });
    if (rEmissao.ok) {
      chaveFinal = rEmissao.chave;
      protocoloFinal = rEmissao.protocolo;
      situacaoFinal = rEmissao.situacaoFiscal;
      if (rEmissao.aviso && !aviso) aviso = rEmissao.aviso;
    } else if (!aviso) {
      aviso = rEmissao.erro;
    }
  }

  revalidarTudo();
  return {
    ok: true,
    id: venda.id,
    total,
    numero: numeroVenda,
    numeroNota: numeroNotaReservado,
    chave: chaveFinal,
    protocolo: protocoloFinal,
    situacaoFiscal: situacaoFinal,
    troco,
    aviso,
  };
}

/**
 * Emissão de NFC-e / NF-e sobre venda existente (Etapa 8).
 * Sem SEFAZ live configurada: mantém `situacaoFiscal = "pendente_transmissao"`,
 * NUNCA inventa protocolo/chave e NUNCA grava `"autorizada"`.
 */
async function executarEmissaoNfceInterna(params: {
  empresaId: string;
  usuario: { id: string; nome: string; papel: string };
  vendaId: string;
  modelo?: "NFC-e" | "NF-e" | "SAT";
}): Promise<
  | {
      ok: true;
      id: string;
      numeroNota: number;
      situacaoFiscal: SituacaoFiscalVenda;
      chave: string | null;
      protocolo: string | null;
      aviso: string;
    }
  | { ok: false; erro: string }
> {
  const [venda] = await db
    .select()
    .from(vendas)
    .where(and(eq(vendas.id, params.vendaId), eq(vendas.empresaId, params.empresaId)))
    .limit(1);

  if (!venda) return { ok: false, erro: "Venda não encontrada nesta empresa." };
  if (venda.status === "cancelado") return { ok: false, erro: "Venda cancelada não pode emitir nota fiscal." };
  if (venda.tipo === "dav" && venda.status === "aberto") {
    return { ok: false, erro: "DAV em aberto deve ser faturado antes da emissão fiscal." };
  }
  if (venda.situacaoFiscal === "autorizada" && venda.protocoloOrigem === "autorizado_sefaz") {
    return { ok: false, erro: "Esta venda já possui nota fiscal autorizada pela SEFAZ." };
  }

  const [emp] = await db.select().from(clientes).where(sql`false`).limit(0);
  void emp;
  const { empresas } = await import("@/db/schema");
  const [empresaRow] = await db.select().from(empresas).where(eq(empresas.id, params.empresaId)).limit(1);
  const fiscalCfg = ((empresaRow?.fiscal ?? {}) as Record<string, unknown>);

  const modelo = (params.modelo || (venda.modelo as "NFC-e" | "NF-e" | "SAT") || "NFC-e");
  const serie = venda.serie || String(fiscalCfg[modelo === "NF-e" ? "serieNfe" : "serieNfce"] ?? "1");
  const numeroNota = venda.numeroNota ?? (await proximoNumeroFiscal(params.empresaId, modelo, serie));

  const diag = diagnosticoEmissorServidor();

  if (!diag.modoLive) {
    await db
      .update(vendas)
      .set({
        tipo: "fiscal",
        modelo,
        serie,
        numeroNota,
        chave: null,
        protocolo: null,
        protocoloOrigem: null,
        autorizadaEm: null,
        situacaoFiscal: "pendente_transmissao",
        statusSefaz: "pendente_envio",
        cstatSefaz: "",
        motivoSefaz: "Pendente de transmissão: SEFAZ live não configurada neste ambiente.",
      })
      .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

    return {
      ok: true,
      id: venda.id,
      numeroNota,
      situacaoFiscal: "pendente_transmissao",
      chave: null,
      protocolo: null,
      aviso: `${modelo} nº ${numeroNota} salva como pendente de transmissão (SEFAZ não configurada).`,
    };
  }

  await db
    .update(vendas)
    .set({
      tipo: "fiscal",
      modelo,
      serie,
      numeroNota,
      situacaoFiscal: "pendente_transmissao",
      statusSefaz: "pendente_envio",
    })
    .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

  const rFis = await transmitirVendaParaEmissor({
    empresaId: params.empresaId,
    vendaId: venda.id,
    usuario: params.usuario,
    registrarNaAuditoria: true,
  });

  const autorizadaReal = rFis.statusSefaz === "autorizada" && Boolean(rFis.protocolo);
  const situacaoFiscal: SituacaoFiscalVenda = autorizadaReal
    ? "autorizada"
    : rFis.statusSefaz === "rejeitada"
      ? "rejeitada"
      : "pendente_transmissao";

  await db
    .update(vendas)
    .set({
      situacaoFiscal,
      protocoloOrigem: autorizadaReal ? "autorizado_sefaz" : null,
    })
    .where(and(eq(vendas.id, venda.id), eq(vendas.empresaId, params.empresaId)));

  return {
    ok: true,
    id: venda.id,
    numeroNota,
    situacaoFiscal,
    chave: autorizadaReal ? rFis.chave : null,
    protocolo: autorizadaReal ? rFis.protocolo : null,
    aviso: autorizadaReal
      ? `${modelo} nº ${numeroNota} autorizada pela SEFAZ.`
      : `${modelo} nº ${numeroNota} registrada (${situacaoFiscal}: ${rFis.motivo}).`,
  };
}

/** Etapa 8 — Cria DAV sem chave, sem protocolo e sem baixa de estoque */
export async function registrarDav(bruto: unknown): Promise<ResultadoVenda> {
  try {
    const input = corpo<{
      itens?: ItemPdv[];
      clienteId?: string | null;
      clienteNome?: string;
      desconto?: number;
      frete?: number;
      validade?: string;
      observacao?: string;
    }>(bruto);
    const { empresaId, empresa, usuario } = await exigirPermissao("dav.criar");
    return await gravarOperacaoPdv({
      empresaId,
      empresa,
      usuario,
      modo: "dav",
      itens: input.itens ?? [],
      clienteId: texto(input.clienteId) || null,
      clienteNome: texto(input.clienteNome) || "CONSUMIDOR",
      desconto: numero(input.desconto),
      frete: numero(input.frete),
      pagamentos: [],
      modelo: "NFC-e",
      validade: texto(input.validade) || undefined,
      observacao: texto(input.observacao) || undefined,
          idFila: typeof (bruto as { idFila?: unknown })?.idFila === "string" ? (bruto as { idFila: string }).idFila : undefined,
    });
  } catch (e) {
    return comoErro(e);
  }
}

/** Etapa 9 — Finaliza a venda baixando estoque e registrando no caixa, sem emitir nota fiscal */
export async function registrarVendaSemNota(bruto: unknown): Promise<ResultadoVenda> {
  try {
    const input = corpo<{
      itens?: ItemPdv[];
      clienteId?: string | null;
      clienteNome?: string;
      desconto?: number;
      frete?: number;
      pagamentos?: Pagamento[];
      observacao?: string;
    }>(bruto);
    const { empresaId, empresa, usuario } = await exigirPermissao("pdv.vender");
    return await gravarOperacaoPdv({
      empresaId,
      empresa,
      usuario,
      modo: "sem_nota",
      itens: input.itens ?? [],
      clienteId: texto(input.clienteId) || null,
      clienteNome: texto(input.clienteNome) || "CONSUMIDOR",
      desconto: numero(input.desconto),
      frete: numero(input.frete),
      pagamentos: input.pagamentos ?? [],
      modelo: "NFC-e",
      observacao: texto(input.observacao) || undefined,
          idFila: typeof (bruto as { idFila?: unknown })?.idFila === "string" ? (bruto as { idFila: string }).idFila : undefined,
    });
  } catch (e) {
    return comoErro(e);
  }
}

/** Etapa 8 — Solicita emissão de NFC-e para uma venda já finalizada (nunca "autorizada" sem SEFAZ) */
export async function emitirNfceDaVenda(bruto: unknown): Promise<
  | {
      ok: true;
      id: string;
      numeroNota: number;
      situacaoFiscal: SituacaoFiscalVenda;
      chave: string | null;
      protocolo: string | null;
      aviso: string;
    }
  | { ok: false; erro: string }
> {
  try {
    const input = corpo<{ vendaId?: unknown; modelo?: unknown }>(bruto);
    const vendaId = texto(input.vendaId);
    if (!vendaId) return { ok: false, erro: "Informe a venda para emitir a NFC-e." };
    const { empresaId, usuario } = await exigirPermissao("pdv.vender");
    const modTxt = texto(input.modelo);
    const modelo: "NFC-e" | "NF-e" | "SAT" =
      modTxt === "NF-e" || modTxt === "SAT" ? modTxt : "NFC-e";
    const r = await executarEmissaoNfceInterna({ empresaId, usuario, vendaId, modelo });
    if (r.ok) revalidarTudo();
    return r;
  } catch (e) {
    return comoErro(e);
  }
}

/** Entrada unificada do PDV (compatível com fila offline e com as 3 opções da Etapa 9) */
export async function registrarVenda(bruto: unknown): Promise<ResultadoVenda> {
  try {
    const input = corpo<{
      itens?: ItemPdv[];
      clienteId?: string | null;
      clienteNome?: string;
      desconto?: number;
      frete?: number;
      pagamentos?: Pagamento[];
      tipo?: "fiscal" | "dav" | "sem_nota";
      modelo?: "NFC-e" | "NF-e" | "SAT";
      validade?: string;
      observacao?: string;
    }>(bruto);

    const tipo = texto(input.tipo) || "fiscal";
    if (tipo === "dav") {
      return await registrarDav(input);
    }
    if (tipo === "sem_nota") {
      return await registrarVendaSemNota(input);
    }

    const { empresaId, empresa, usuario } = await exigirPermissao("pdv.vender");
    const modTxt = texto(input.modelo);
    const modelo: "NFC-e" | "NF-e" | "SAT" =
      modTxt === "NF-e" || modTxt === "SAT" ? modTxt : "NFC-e";

    return await gravarOperacaoPdv({
      empresaId,
      empresa,
      usuario,
      modo: "emitir_nfce",
      itens: input.itens ?? [],
      clienteId: texto(input.clienteId) || null,
      clienteNome: texto(input.clienteNome) || "CONSUMIDOR",
      desconto: numero(input.desconto),
      frete: numero(input.frete),
      pagamentos: input.pagamentos ?? [],
      modelo,
      observacao: texto(input.observacao) || undefined,
          idFila: typeof (bruto as { idFila?: unknown })?.idFila === "string" ? (bruto as { idFila: string }).idFila : undefined,
    });
  } catch (e) {
    return comoErro(e);
  }
}

/** Etapa 8 — Fatura DAV baixando o estoque exatamente uma vez e respeitando situacaoFiscal */
export async function faturarDav(bruto: unknown): Promise<ResultadoVenda> {
  try {
    const input = corpo<{
      davId?: unknown;
      modelo?: unknown;
      emitirNota?: unknown;
      itens?: ItemPdv[];
      clienteId?: unknown;
      clienteNome?: unknown;
      pagamentos?: Pagamento[];
      desconto?: unknown;
    }>(bruto);
    const davId = texto(input.davId);
    if (!davId) return { ok: false, erro: "Informe o DAV que será faturado." };

    const { empresaId, empresa, usuario } = await exigirPermissao("dav.faturar");
    const [dav] = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.id, davId), eq(vendas.empresaId, empresaId)))
      .limit(1);
    if (!dav) return { ok: false, erro: "DAV não encontrado." };
    if (dav.tipo !== "dav" || dav.status !== "aberto") {
      return { ok: false, erro: "Este DAV já foi faturado ou cancelado." };
    }

    const itensBanco = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, dav.id));
    const itensEfetivos: ItemPdv[] =
      Array.isArray(input.itens) && input.itens.length > 0
        ? input.itens
        : itensBanco
            .filter((i) => Boolean(i.produtoId))
            .map((i) => ({ produtoId: i.produtoId!, qtd: Number(i.qtd), preco: Number(i.precoUnit) }));

    const modTxt = texto(input.modelo);
    const modelo: "NFC-e" | "NF-e" | "SAT" =
      modTxt === "NF-e" || modTxt === "SAT" ? modTxt : "NFC-e";
    const emitirNota = input.emitirNota === false ? false : true;
    const clienteIdEfetivo =
      input.clienteId !== undefined ? texto(input.clienteId) || null : dav.clienteId;
    const clienteNomeEfetivo =
      input.clienteNome !== undefined ? texto(input.clienteNome) || "CONSUMIDOR" : dav.clienteNome;

    return await gravarOperacaoPdv({
      empresaId,
      empresa,
      usuario,
      modo: emitirNota ? "emitir_nfce" : "sem_nota",
      itens: itensEfetivos,
      clienteId: clienteIdEfetivo,
      clienteNome: clienteNomeEfetivo,
      desconto: input.desconto !== undefined ? numero(input.desconto) : Number(dav.desconto),
      frete: Number(dav.vFrete),
      pagamentos: Array.isArray(input.pagamentos) ? input.pagamentos : [],
      modelo,
      davOrigemId: dav.id,
      observacao: dav.observacao ?? undefined,
    });
  } catch (e) {
    return comoErro(e);
  }
}

export async function cancelarVenda(bruto: unknown): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const { empresaId, usuario } = await exigirPermissao("venda.cancelar");
    const input = corpo<{ vendaId?: unknown; motivo?: unknown }>(bruto);
    const vendaId = texto(input.vendaId);
    const motivoLimpo = texto(input.motivo).trim();
    if (!vendaId) return { ok: false, erro: "Informe o documento para cancelar." };
    if (!motivoLimpo) return { ok: false, erro: "Descreva o motivo do cancelamento." };

    let [venda] = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId)))
      .limit(1);
    if (!venda) return { ok: false, erro: "Documento não encontrado." };
    if (venda.status === "cancelado") return { ok: false, erro: "Este documento já está cancelado." };

    const movimentouCaixaEEstoque = venda.tipo === "fiscal" || venda.tipo === "sem_nota";

    const cancelamento = await db.transaction(async (tx) => {
      let sessaoEstornoId: string | null = null;
      if (venda.caixaSessaoId) {
        // A mesma trava usada no fechamento garante que o estorno não caia em um snapshot já encerrado.
        const [origem] = await tx.select({ id: caixaSessoes.id, status: caixaSessoes.status })
          .from(caixaSessoes).where(and(eq(caixaSessoes.id, venda.caixaSessaoId), eq(caixaSessoes.empresaId, empresaId))).for("update");
        if (origem?.status === "aberto") sessaoEstornoId = origem.id;
        else if (movimentouCaixaEEstoque) {
          const [aberta] = await tx.select({ id: caixaSessoes.id }).from(caixaSessoes)
            .where(and(eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.operadorId, usuario.id), eq(caixaSessoes.status, "aberto")))
            .limit(1).for("update");
          if (!aberta) return { ok: false as const, erro: "Caixa fechado: esta venda pertence a uma sessão já encerrada. Abra uma sessão ou reabra a anterior para registrar o estorno." };
          sessaoEstornoId = aberta.id;
        }
      } else if (movimentouCaixaEEstoque) {
        const [aberta] = await tx.select({ id: caixaSessoes.id }).from(caixaSessoes)
          .where(and(eq(caixaSessoes.empresaId, empresaId), eq(caixaSessoes.operadorId, usuario.id), eq(caixaSessoes.status, "aberto")))
          .limit(1).for("update");
        sessaoEstornoId = aberta?.id ?? null;
      }

      const [atual] = await tx.select().from(vendas).where(and(eq(vendas.id, vendaId), eq(vendas.empresaId, empresaId))).for("update");
      if (!atual) return { ok: false as const, erro: "Documento não encontrado." };
      if (atual.status === "cancelado") return { ok: false as const, erro: "Este documento já está cancelado." };
      if (atual.caixaSessaoId !== venda.caixaSessaoId || atual.tipo !== venda.tipo) return { ok: false as const, erro: "O documento foi alterado simultaneamente. Consulte-o novamente." };
      await tx.update(vendas).set({
        status: "cancelado", situacaoFiscal: "cancelada",
        ...(atual.tipo === "fiscal" ? { statusSefaz: "cancelada_sefaz", cstatSefaz: "135" } : {}),
        observacao: `${atual.observacao ?? ""} · Cancelado: ${motivoLimpo}`.trim(),
      }).where(and(eq(vendas.id, atual.id), eq(vendas.empresaId, empresaId)));
      if (movimentouCaixaEEstoque && sessaoEstornoId) {
        const rateio = ratearPagamentosLiquidos({ total: Number(atual.total), formaPagamento: atual.formaPagamento, pagamentos: (atual.pagamentos ?? []) as { forma: string; valor: number }[] });
        for (const [forma, valor] of Object.entries(rateio)) {
          if (valor <= 0) continue;
          await tx.insert(caixaMovimentos).values({
            empresaId, sessaoId: sessaoEstornoId, tipo: "estorno", forma, valor,
            motivo: `Estorno ${atual.modelo ?? "Venda"} ${atual.numeroNota ?? atual.numero}: ${motivoLimpo}`,
            vendaId: atual.id, usuarioId: usuario.id, usuarioNome: usuario.nome,
          });
        }
      }
      return { ok: true as const, venda: atual };
    });
    if (!cancelamento.ok) return cancelamento;
    venda = cancelamento.venda;

    const itens = await db.select().from(vendaItens).where(eq(vendaItens.vendaId, venda.id));
    if (movimentouCaixaEEstoque) {
      for (const i of itens) {
        if (!i.produtoId) continue;
        const [p] = await db.select().from(produtos).where(eq(produtos.id, i.produtoId)).limit(1);
        if (!p) continue;
        const saldo = round2(Number(p.estoque) + Number(i.qtd));
        await db.update(produtos).set({ estoque: saldo }).where(eq(produtos.id, p.id));
        await db.insert(movimentos).values({
          empresaId,
          produtoId: p.id,
          produtoNome: p.nome,
          tipo: "devolucao",
          qtd: Number(i.qtd),
          saldoApos: saldo,
          custoUnit: Number(p.custo),
          custoMedioApos: Number(p.custo),
          documento: venda.numeroNota ? `Cancel. NF ${venda.numeroNota}` : `Cancel. Venda ${venda.numero}`,
          observacao: motivoLimpo,
          usuarioId: usuario.id,
          usuarioNome: usuario.nome,
        });
      }
    }

    await db.delete(contas).where(and(eq(contas.vendaId, venda.id), eq(contas.status, "aberta")));
    await registrarAuditoria({
      empresaId,
      usuario,
      acao: "venda.cancelar",
      entidade: "venda",
      registroId: venda.id,
      resumo: `${venda.tipo === "dav" ? `DAV ${venda.numero}` : `${venda.modelo ?? "Venda"} ${venda.numeroNota ?? venda.numero}`} cancelado: ${motivoLimpo}`,
      alteracoes: { numero: venda.numero, numeroNota: venda.numeroNota, total: Number(venda.total), motivo: motivoLimpo },
    });
    revalidarTudo();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

export async function excluirDav(bruto: unknown): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const { empresaId } = await exigirPermissao("dav.criar");
    const davId = typeof bruto === "string" ? cadeia(bruto).trim() : texto(corpo<{ davId?: unknown }>(bruto).davId);
    if (!davId) return { ok: false, erro: "DAV não informado." };
    const [dav] = await db
      .select()
      .from(vendas)
      .where(and(eq(vendas.id, davId), eq(vendas.empresaId, empresaId)))
      .limit(1);
    if (!dav) return { ok: false, erro: "DAV não encontrado." };
    if (dav.status === "faturado") return { ok: false, erro: "DAV faturado não pode ser apagado — cancele a nota." };
    await db.delete(vendas).where(eq(vendas.id, davId));
    revalidarTudo();
    return { ok: true };
  } catch (e) {
    return comoErro(e);
  }
}

/** Etapa 10 — Busca paginada de documentos no servidor reaproveitando listarVendasPaginado */
export async function buscarDocumentosPdv(bruto: unknown) {
  try {
    const { empresaId } = await exigirPermissao("documentos.ver");
    const input = corpo<{
      busca?: unknown;
      tipo?: unknown;
      situacao?: unknown;
      inicio?: unknown;
      fim?: unknown;
      pagina?: unknown;
      tamanhoPagina?: unknown;
    }>(bruto);

    const { listarVendasPaginado } = await import("@/server/dados");
    const tipoTxt = texto(input.tipo);
    const tipo =
      tipoTxt === "fiscal" || tipoTxt === "dav" || tipoTxt === "sem_nota"
        ? tipoTxt
        : "todos";

    const resultado = await listarVendasPaginado(empresaId, {
      busca: texto(input.busca),
      tipo,
      situacao: texto(input.situacao),
      inicio: texto(input.inicio),
      fim: texto(input.fim),
      pagina: Math.max(1, Math.floor(numero(input.pagina) || 1)),
      tamanhoPagina: Math.min(50, Math.max(5, Math.floor(numero(input.tamanhoPagina) || 10))),
    });

    return { ok: true as const, ...resultado };
  } catch (e) {
    return comoErro(e);
  }
}

/** atalho do PDV: busca ao vivo por início do nome, SKU ou GTIN */
export async function buscarProdutos(bruto: unknown) {
  try {
    const { empresaId } = await tenant();
    const t = cadeia(bruto).trim().toLowerCase();
    if (!t) return [];
    const linhas = await db
      .select({
        id: produtos.id,
        nome: produtos.nome,
        sku: produtos.sku,
        gtin: produtos.gtin,
        preco: produtos.preco,
        estoque: produtos.estoque,
        unidade: produtos.unidade,
        pesavel: produtos.pesavel,
      })
      .from(produtos)
      .where(and(eq(produtos.empresaId, empresaId), eq(produtos.ativo, true), desc(produtos.nome)))
      .limit(400);
    return linhas
      .filter((p) => p.nome.toLowerCase().includes(t) || p.sku.toLowerCase().startsWith(t) || p.gtin.includes(t))
      .slice(0, 12)
      .map((p) => ({ ...p, preco: Number(p.preco), estoque: Number(p.estoque) }));
  } catch {
    return [];
  }
}
