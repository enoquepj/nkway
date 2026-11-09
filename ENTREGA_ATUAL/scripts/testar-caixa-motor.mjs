#!/usr/bin/env node
/**
 * NKWAY — Suíte dedicada do motor de apuração e fechamento de caixa (correção 2026-11).
 * Roda pelo prompt de comando, direto no PostgreSQL local (.env) e sem servidor no ar:
 *   node scripts/testar-caixa-motor.mjs
 *
 * Parte A (motor puro, src/lib/caixa.ts transpilado em memória):
 *   1 venda fiscal entra · 2 sem nota entra · 3 DAV orçamento fora · 4 DAV concreto uma vez ·
 *   5 DAV orçamento + filha = só filha · 6 DAV concreto + nota = só original · 7 outra sessão fora ·
 *   8 sem sessão fora · 9 dividido por forma · 10 troco só dinheiro · 11 excesso sem dinheiro = inconsistência ·
 *   12 fallback formaPagamento · 13 estorno explícito não duplica · 15 isolamento entre empresas · snapshot.
 * Parte B (banco real, SQL puro, dados de prova removidos no fim):
 *   14 fechamento simultâneo: duas transações com SELECT … FOR UPDATE + UPDATE … WHERE status='aberto' →
 *   exatamente uma vence; a leitura da sessão confirma status/snapshot únicos.
 * Parte C (opcional, se a prévia estiver no ar): /api/diagnostico deve aprovar todos os cx-*.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import pg from "pg";
import ts from "typescript";

const RAIZ = process.cwd();
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const SECRET = process.env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao";
const dbUrl = (fs.readFileSync(path.join(RAIZ, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1];
assert(dbUrl, "DATABASE_URL ausente no .env");

/* ------------------------------------------------ carregador TS em memória */
const cacheModulos = new Map();
function carregarModuloTs(caminhoRelativo) {
  const arq = path.join(RAIZ, caminhoRelativo);
  if (cacheModulos.has(arq)) return cacheModulos.get(arq);
  const fonte = fs.readFileSync(arq, "utf8");
  const { outputText } = ts.transpileModule(fonte, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const mod = { exports: {} };
  cacheModulos.set(arq, mod.exports);
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id.startsWith("@/")) return carregarModuloTs(`src/${id.slice(2)}.ts`);
      throw new Error(`Import externo não esperado: ${id}`);
    },
    Date, Math, Number, String, Boolean, Array, Object, Set, Map, Promise, Intl, JSON, console, isFinite: Number.isFinite,
  };
  vm.runInNewContext(outputText, sandbox, { filename: arq });
  return mod.exports;
}

const caixa = carregarModuloTs("src/lib/caixa.ts");
const { apurarSessaoCaixa, ratearPagamentosDetalhado, ratearPagamentosLiquidos, aplicarSnapshotFechamento, compoeCaixa } = caixa;

let passou = 0;
const ok = (nome, cond, detalhe = "") => {
  if (!cond) {
    console.log(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
    process.exitCode = 1;
    return;
  }
  passou++;
  console.log(`  ok    ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

/* ------------------------------------------------------------ Parte A */
console.log("→ Parte A · motor puro (src/lib/caixa.ts)");
const E = "11111111-1111-4111-8111-111111111111";
const S = "sessao-A";
const v = (id, tipo, status, total, pagamentos, extra = {}) => ({
  id, tipo, status, total, formaPagamento: pagamentos[0]?.forma ?? "dinheiro", pagamentos,
  empresaId: E, caixaSessaoId: S, davOrigemId: null, ...extra,
});
const cenario = [
  v("fiscal", "fiscal", "faturado", 100, [{ forma: "pix", valor: 100 }]),
  v("sem-nota", "sem_nota", "faturado", 80, [{ forma: "dinheiro", valor: 50 }, { forma: "credito", valor: 30 }]),
  v("dav-orc", "dav", "aberto", 999, [], { caixaSessaoId: null }),
  v("dav-pai", "dav", "faturado", 70, [], { caixaSessaoId: null }),
  v("filha", "fiscal", "faturado", 70, [{ forma: "debito", valor: 70 }], { davOrigemId: "dav-pai", origem: "dav" }),
  v("dav-concreto", "dav", "faturado", 40, [{ forma: "pix", valor: 40 }]),
  v("nota-fiscaliza", "fiscal", "faturado", 40, [{ forma: "pix", valor: 40 }], { davOrigemId: "dav-concreto" }),
  v("outra-sessao", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { caixaSessaoId: "sessao-B" }),
  v("sem-sessao", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { caixaSessaoId: null }),
  v("outra-empresa", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { empresaId: "22222222-2222-4222-8222-222222222222" }),
  v("cancelada", "sem_nota", "cancelado", 30, [{ forma: "dinheiro", valor: 30 }]),
];
const ap = apurarSessaoCaixa({
  sessaoId: S, empresaId: E, saldoInicial: 50, vendas: cenario,
  movimentos: [
    { id: "e1", tipo: "estorno", forma: "dinheiro", valor: 30, motivo: "Cancel", vendaId: "cancelada", usuarioNome: "Op", criadoEm: "" },
    { id: "s1", tipo: "sangria", forma: "dinheiro", valor: 20, motivo: "Cofre", usuarioNome: "Op", criadoEm: "" },
  ],
});
const cl = Object.fromEntries(ap.classificacoes.map((c) => [c.vendaId, c]));
ok("1  venda fiscal da sessão entra", cl.fiscal.compoeCaixa && cl.fiscal.codigo === "venda_concreta");
ok("2  venda sem nota concreta entra", cl["sem-nota"].compoeCaixa && ap.esperadosMap.credito === 30);
ok("3  DAV orçamento não entra", !cl["dav-orc"].compoeCaixa && cl["dav-orc"].codigo === "dav_orcamento");
ok("4  DAV concreto entra uma vez", cl["dav-concreto"].compoeCaixa && cl["dav-concreto"].codigo === "dav_concreto" && ap.esperadosMap.pix === 140);
ok("5  DAV orçamento + filha: só a filha", cl.filha.compoeCaixa && !cl["dav-pai"].compoeCaixa && cl.filha.operacaoEconomicaId === "filha" && ap.esperadosMap.debito === 70);
ok("6  DAV concreto + nota: só a operação original", !cl["nota-fiscaliza"].compoeCaixa && cl["nota-fiscaliza"].codigo === "duplicata_fiscal_de_dav" && cl["nota-fiscaliza"].operacaoEconomicaId === "dav-concreto");
ok("7  venda de outra sessão não entra", !cl["outra-sessao"].compoeCaixa && cl["outra-sessao"].codigo === "outra_sessao");
ok("8  venda sem sessão não entra", !cl["sem-sessao"].compoeCaixa && cl["sem-sessao"].codigo === "sem_sessao");
ok("15 isolamento entre empresas", !cl["outra-empresa"].compoeCaixa && cl["outra-empresa"].codigo === "outra_empresa" && !compoeCaixa(cenario[9], { empresaId: E, sessaoId: S }));
ok("   esperado por forma e dedup", ap.esperadosMap.dinheiro === 80 && ap.esperadosMap.pix === 140 && ap.esperadosMap.credito === 30 && ap.esperadosMap.debito === 70 && ap.totalEsperado === 320 && ap.consideradas === 5, `total R$ ${ap.totalEsperado.toFixed(2)} · ${ap.consideradas} consideradas · ${ap.excluidas.length} excluídas`);

const rate = (total, pags, forma = "dinheiro") => ratearPagamentosDetalhado({ total, formaPagamento: forma, pagamentos: pags });
const r1 = rate(100, [{ forma: "dinheiro", valor: 60 }, { forma: "pix", valor: 40 }]);
const r2 = rate(100, [{ forma: "dinheiro", valor: 120 }]);
const r3 = rate(100, [{ forma: "dinheiro", valor: 30 }, { forma: "credito", valor: 70 }]);
const r4 = rate(100, [{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 80 }]);
const r5 = rate(100, [{ forma: "pix", valor: 120 }]);
const r6 = rate(100, [], "debito");
const r7 = rate(100, [{ forma: "pix", valor: 0 }, { forma: "credito", valor: -5 }, { forma: "debito", valor: 100 }]);
ok("9  pagamento dividido por forma", r1.porForma.dinheiro === 60 && r1.porForma.pix === 40 && r1.troco === 0 && r3.porForma.dinheiro === 30 && r3.porForma.credito === 70 && r7.porForma.debito === 100 && r7.parcelasIgnoradas === 2, "60/40 · 30/70 · parcelas 0 e -5 ignoradas");
ok("10 troco somente em dinheiro", r2.porForma.dinheiro === 100 && r2.troco === 20 && r4.porForma.dinheiro === 20 && r4.porForma.pix === 80 && r4.troco === 20, "din 120 → 100 (troco 20) · din 40 + pix 80 → din 20 / pix 80 (troco 20)");
ok("11 excesso sem dinheiro é inconsistente", r5.porForma.pix === 120 && r5.troco === 0 && Boolean(r5.inconsistencia), "pix 120 para total 100");
ok("12 fallback legado formaPagamento", r6.usouFallbackForma && r6.porForma.debito === 100 && ratearPagamentosLiquidos({ total: 100, formaPagamento: "debito", pagamentos: [] }).debito === 100);
const apImpl = apurarSessaoCaixa({ sessaoId: S, empresaId: E, saldoInicial: 0, movimentos: [], vendas: [v("c1", "fiscal", "cancelado", 30, [{ forma: "dinheiro", valor: 30 }])] });
ok("13 cancelamento com estorno explícito não duplica", ap.esperadosMap.dinheiro === 80 && ap.totalEstornos === 30 && apImpl.esperadosMap.dinheiro === 0 && apImpl.totalEstornos === 30, "explícito: 1 estorno · implícito: 1 estorno");
const snap = aplicarSnapshotFechamento(ap, { dinheiro: 75, pix: 140, credito: 30, debito: 70, boleto: 0, prazo: 0 });
ok("   snapshot da sessão fechada prevalece", snap.snapshotAplicado && snap.totalEsperado === 315 && snap.divergenciaRecalculo === 5 && ap.totalEsperado === 320);

/* ------------------------------------------------------------ Parte B */
{
  const l = caixa.lerValorDinheiro;
  const casos = [["150,50", 150.5], ["150.50", 150.5], ["1.500,50", 1500.5], ["1,500.50", 1500.5], ["1500", 1500], ["1500.5", 1500.5], ["0.01", 0.01], ["R$ 1.500,50", 1500.5], ["1.500", 1500], ["1.500.000", 1500000], ["", 0], [undefined, 0], [150.5, 150.5], ["abc", null], ["1..5", null], ["12a", null]];
  ok("17 parser de dinheiro: ponto e vírgula como decimal, milhar e inválidos", casos.every(([e, r]) => l(e) === r), casos.map(([e, r]) => `${JSON.stringify(e)}→${l(e)}${l(e) === r ? "" : "≠" + r}`).join(" "));
}
console.log("→ Parte B · banco real: fechamento simultâneo (transação + FOR UPDATE)");
const c1 = new pg.Client({ connectionString: dbUrl });
const c2 = new pg.Client({ connectionString: dbUrl });
const c0 = new pg.Client({ connectionString: dbUrl });
await Promise.all([c0.connect(), c1.connect(), c2.connect()]);
const opId = randomUUID(), sessId = randomUUID(), vendaId = randomUUID();
try {
  const { rows: [emp] } = await c0.query("select id from nk_empresa order by created_at limit 1");
  assert(emp, "nenhuma empresa no banco — rode build_and_start para o seed");
  const empresaId = emp.id;
  await c0.query(
    "insert into nk_usuario (id, empresa_id, nome, email, senha_hash, papel, ativo) values ($1,$2,'Probe Caixa',$3,'probe','operador',false)",
    [opId, empresaId, `probe-caixa-${opId.slice(0, 8)}@nkway.local`],
  );
  await c0.query(
    "insert into nk_caixa_sessao (id, empresa_id, numero, terminal, operador_id, operador_nome, status, saldo_inicial) values ($1,$2,$3,'PROBE',$4,'Probe Caixa','aberto',10)",
    [sessId, empresaId, 990000 + Math.floor(Math.random() * 9999), opId],
  );
  await c0.query(
    `insert into nk_venda (id, empresa_id, numero, cliente_nome, subtotal, desconto, total, forma_pagamento, pagamentos, tipo, status, operador_id, caixa_sessao_id, origem, data)
     values ($1,$2,$3,'PROBE CAIXA',25,0,25,'dinheiro','[{"forma":"dinheiro","valor":30}]'::jsonb,'sem_nota','faturado',$4,$5,'pdv',now())`,
    [vendaId, empresaId, 990000 + Math.floor(Math.random() * 9999), opId, sessId],
  );

  // mesma sequência de fecharSessaoCaixaTransacional: FOR UPDATE → recálculo → UPDATE condicional
  const fechar = async (cli, rotulo) => {
    await cli.query("begin");
    try {
      const { rows: [s] } = await cli.query("select status from nk_caixa_sessao where id = $1 and empresa_id = $2 for update", [sessId, empresaId]);
      if (!s || s.status !== "aberto") {
        await cli.query("rollback");
        return { ok: false, erro: "já fechado", rotulo };
      }
      const { rows: vds } = await cli.query(
        "select id, tipo, status, total, forma_pagamento, pagamentos, caixa_sessao_id, dav_origem_id, empresa_id from nk_venda where empresa_id = $1 and caixa_sessao_id = $2",
        [empresaId, sessId],
      );
      const apur = apurarSessaoCaixa({
        sessaoId: sessId, empresaId, saldoInicial: 10, movimentos: [],
        vendas: vds.map((x) => ({ id: x.id, tipo: x.tipo, status: x.status, total: Number(x.total), formaPagamento: x.forma_pagamento, pagamentos: x.pagamentos ?? [], caixaSessaoId: x.caixa_sessao_id, davOrigemId: x.dav_origem_id, empresaId: x.empresa_id })),
      });
      await new Promise((r) => setTimeout(r, 150)); // alarga a janela de concorrência
      const { rowCount } = await cli.query(
        "update nk_caixa_sessao set status='fechado', valores_esperados=$3::jsonb, total_esperado=$4, fechado_em=now(), fechado_por_id=$5, fechado_por_nome='Probe Caixa' where id=$1 and empresa_id=$2 and status='aberto'",
        [sessId, empresaId, JSON.stringify(apur.esperadosMap), apur.totalEsperado, opId],
      );
      await cli.query("commit");
      return rowCount === 1 ? { ok: true, rotulo, totalEsperado: apur.totalEsperado, troco: apur.totalTroco } : { ok: false, erro: "perdeu a corrida", rotulo };
    } catch (e) {
      await cli.query("rollback").catch(() => {});
      return { ok: false, erro: String(e.message || e), rotulo };
    }
  };
  const [f1, f2] = await Promise.all([fechar(c1, "A"), fechar(c2, "B")]);
  const { rows: [sessFinal] } = await c0.query("select status, total_esperado, valores_esperados, fechado_por_id from nk_caixa_sessao where id = $1", [sessId]);
  const vencedores = [f1, f2].filter((f) => f.ok);
  ok("14 fechamento simultâneo bloqueado", vencedores.length === 1 && sessFinal.status === "fechado" && Number(sessFinal.total_esperado) === 35 && Number(sessFinal.valores_esperados.dinheiro) === 35 && vencedores[0].troco === 5,
    `venceu ${vencedores[0]?.rotulo ?? "ninguém"} · outro: "${[f1, f2].find((f) => !f.ok)?.erro}" · snapshot R$ ${Number(sessFinal.total_esperado).toFixed(2)} (10 inicial + 25 líquido, troco 5)`);
  const f3 = await fechar(c1, "retry");
  ok("   retry após fechado é negado com erro claro", !f3.ok && f3.erro === "já fechado");
} finally {
  await c0.query("delete from nk_caixa_movimento where sessao_id = $1", [sessId]);
  await c0.query("delete from nk_venda where id = $1", [vendaId]);
  await c0.query("delete from nk_caixa_sessao where id = $1", [sessId]);
  await c0.query("delete from nk_usuario where id = $1", [opId]);
  const { rows: [sobra] } = await c0.query("select count(*)::int as n from nk_venda where cliente_nome = 'PROBE CAIXA'");
  ok("   limpeza dos dados de prova", sobra.n === 0);
  await Promise.all([c0.end(), c1.end(), c2.end()]);
}

/* ------------------------------------------------------------ Parte C */
console.log("→ Parte C · bateria viva /api/diagnostico (se a prévia estiver no ar)");
try {
  const vivo = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
  if (!vivo) {
    console.log("  (prévia fora do ar — pulado; rode build_and_start e repita para a regressão 16)");
  } else {
    const cli = new pg.Client({ connectionString: dbUrl });
    await cli.connect();
    const { rows: [u] } = await cli.query("select u.id uid, e.id eid from nk_usuario u join nk_empresa e on e.id = u.empresa_id where u.ativo limit 1");
    await cli.end();
    const p = Buffer.from(JSON.stringify({ empresaId: u.eid, usuarioId: u.uid, iat: Date.now() })).toString("base64url");
    const cookie = `nkway.sessao=${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
    const diag = await fetch(`${BASE}/api/diagnostico`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const cx = (diag.testes ?? []).filter((t) => t.id.startsWith("cx-"));
    const pdvDav = (diag.testes ?? []).filter((t) => /^pdv-|^dav|^cx-/.test(t.id));
    ok("16 regressão: bateria viva sem falhas", diag.resumo?.falhou === 0, `${diag.resumo?.passou}/${diag.resumo?.total} ok`);
    ok("   módulo Caixa por Operador completo", cx.length >= 22 && cx.every((t) => t.passou), `${cx.filter((t) => t.passou).length}/${cx.length} cx-*`);
    ok("   PDV/DAV/caixa sem regressão", pdvDav.every((t) => t.passou), `${pdvDav.length} verificações`);
  }
} catch (e) {
  ok("16 regressão: bateria viva", false, String(e.message || e));
}

console.log(`\nNKWAY motor de caixa: ${passou} ok${process.exitCode ? " · com FALHAS" : ""}`);
