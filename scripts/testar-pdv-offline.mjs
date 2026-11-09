#!/usr/bin/env node
/** Modo offline do PDV: idempotência da fila (servidor, banco LOCAL com empresa temporária), id de fila, idade, recibo provisório e service worker. */
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { randomUUID } from "node:crypto";
import ts from "typescript"; import dotenv from "dotenv"; import pg from "pg"; import { drizzle } from "drizzle-orm/node-postgres"; import { eq, and } from "drizzle-orm";
const require = createRequire(import.meta.url); const memo = new Map(); let db, sessao = null;
function compilar(arquivo) {
  const abs = path.resolve(arquivo); const mod = { exports: {} };
  const codigo = ts.transpileModule(fs.readFileSync(abs, "utf8"), { fileName: abs, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const importar = (n) => {
    if (n === "@/db") return { get db() { return db; } };
    if (n === "@/lib/session") return { contexto: async () => sessao };
    if (n === "next/cache") return { revalidatePath: () => {} };
    if (n.startsWith("@/") || n.startsWith(".")) { const b = n.startsWith("@/") ? path.resolve("src", n.slice(2)) : path.resolve(path.dirname(abs), n); return carregar([b, b + ".ts", b + ".tsx"].find((p) => fs.existsSync(p) && fs.statSync(p).isFile())); }
    return require(n);
  };
  new Function("module", "exports", "require", codigo)(mod, mod.exports, importar); return mod.exports;
}
function carregar(a) { const p = path.resolve(a); if (!memo.has(p)) memo.set(p, compilar(p)); return memo.get(p); }
let passou = 0; const caso = async (nome, fn) => { try { await fn(); passou++; console.log(`  ok ${nome}`); } catch (e) { console.error(`FALHA ${nome}: ${String(e?.message ?? e).slice(0, 500)}`); process.exitCode = 1; throw e; } };
const op = carregar("src/lib/operacoesPdv.ts");

/* ------------------------------------------------------------ puros */
await caso("gerarIdFilaPdv: único, prefixado e só com caracteres aceitos pela marca do servidor", () => {
  const ids = new Set(Array.from({ length: 200 }, () => op.gerarIdFilaPdv())); assert.equal(ids.size, 200);
  for (const id of ids) { assert.match(id, /^pdv-[a-z0-9]+-[a-z0-9]{10,14}$/); assert.match(id, /^[A-Za-z0-9_.-]{6,80}$/); }
});
await caso("idadeFilaOfflineHoras: vazia = null; usa o item mais antigo", () => {
  const agora = Date.now(); assert.equal(op.idadeFilaOfflineHoras([]), null);
  assert.equal(op.idadeFilaOfflineHoras([{ criadoEm: agora - 2 * 3600000 }, { criadoEm: agora - 30 * 60000 }], agora), 2);
});
await caso("sanitizarFilaOfflinePdv preserva idFila, operador e terminal; mantém compatibilidade com registros antigos", () => {
  const [a, b] = op.sanitizarFilaOfflinePdv([{ idFila: "pdv-x-y", tipo: "sem_nota", itens: [{ produtoId: "p", qtd: 1, preco: 2 }], pagamentos: [{ forma: "pix", valor: 2 }], criadoEm: 1, operadorNome: "Ana", terminal: "CAIXA 2" }, { tipo: "fiscal", itens: [{ produtoId: "p", qtd: 1, preco: 2 }], criadoEm: 2 }]);
  assert.equal(a.idFila, "pdv-x-y"); assert.equal(a.operadorNome, "Ana"); assert.equal(a.terminal, "CAIXA 2"); assert.match(b.idFila, /^fila-2-/); assert.equal(b.operadorNome, undefined);
});
await caso("recibo provisório offline: rótulo e aviso deixam claro que não tem número nem validade fiscal", () => {
  const r = op.montarReciboDeFechamentoPdv({ id: "pdv-abc-12345678", modo: "sem_nota", numeroVenda: 0, numeroNota: null, modelo: null, situacaoFiscal: "nao_emitida", chave: null, protocolo: null, clienteNome: "CONSUMIDOR", operador: "Ana", terminal: "CAIXA 1", ambiente: "2", itens: [{ nome: "X", qtd: 1, precoUnit: 10 }], subtotal: 10, desconto: 0, total: 10, pagamentosBrutos: [{ forma: "dinheiro", valor: 10 }], troco: 0, offline: true });
  assert.match(r.documentoRotulo, /PROVISÓRIO · OFFLINE/); assert.match(r.avisoFiscal, /NÃO enviada ao servidor/); assert.match(r.avisoFiscal, /sem validade fiscal/);
  const n = op.montarReciboDeFechamentoPdv({ id: "v1", modo: "sem_nota", numeroVenda: 7, numeroNota: null, modelo: null, situacaoFiscal: "nao_emitida", chave: null, protocolo: null, clienteNome: "C", operador: "A", terminal: "T", ambiente: "2", itens: [{ nome: "X", qtd: 1, precoUnit: 10 }], subtotal: 10, desconto: 0, total: 10, pagamentosBrutos: [], troco: 0 });
  assert.doesNotMatch(n.documentoRotulo, /OFFLINE/);
});
await caso("service worker: não cacheia POST nem /api, cacheia shell /pdv e assets do Next; layout do PDV registra o SW", () => {
  const sw = fs.readFileSync("public/sw.js", "utf8"); new Function(sw);
  assert.match(sw, /req\.method !== "GET"\) return/); assert.match(sw, /startsWith\("\/api\/"\)\) return/); assert.match(sw, /addAll\(\["\/pdv"\]/); assert.match(sw, /_next\/static/); assert.doesNotMatch(sw, /index\.html/);
  assert.match(fs.readFileSync("src/app/(pdv)/layout.tsx", "utf8"), /RegistroOfflinePdv/); assert.match(fs.readFileSync("src/components/RegistroOfflinePdv.tsx", "utf8"), /serviceWorker\.register\("\/sw\.js"/);
});
await caso("PDV: id da operação é gerado antes do envio, vai nas três ações e no item da fila; auto-sync ao voltar online", () => {
  const v = fs.readFileSync("src/views/Pdv.tsx", "utf8");
  assert.match(v, /const idFilaOperacao = gerarIdFilaPdv\(\);/); assert.equal((v.match(/idFila: idFilaOperacao/g) || []).length, 4, "3 ações + item da fila");
  assert.match(v, /idFila: item\.idFila/); assert.match(v, /window\.addEventListener\("online", onOnline\)[\s\S]*setInterval\(tentar, 60_000\)/); assert.match(v, /data-testid="faixa-offline"/);
});

/* ------------------------------------------------------------ banco local: idempotência */
const env = dotenv.parse(fs.readFileSync(".env", "utf8")); const url = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Testes de banco bloqueados fora do ambiente local.");
const pool = new pg.Pool({ connectionString: url }); db = drizzle(pool);
const s = carregar("src/db/schema.ts"); const pdv = carregar("src/server/acoes/pdv.ts");
const emp = randomUUID(), adm = randomUUID();
try {
  await db.insert(s.empresas).values({ id: emp, nome: "Fixture offline", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
  await db.insert(s.usuarios).values({ id: adm, empresaId: emp, nome: "Operador offline", email: `${adm}@t.invalid`, senhaHash: "x", papel: "administrador", ativo: true });
  const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, emp));
  sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Operador offline", papel: "administrador" } };
  await db.insert(s.caixaSessoes).values({ empresaId: emp, numero: 1, terminal: "CAIXA 1", operadorId: adm, operadorNome: "Operador offline", status: "aberto", saldoInicial: 100 });
  const [prod] = await db.insert(s.produtos).values({ empresaId: emp, nome: "ITEM OFFLINE", sku: "OFF1", ncm: "00000000", estoque: 50, estoqueMin: 1, custo: 1, preco: 5 }).returning();
  const vendasDaEmpresa = async () => db.select().from(s.vendas).where(eq(s.vendas.empresaId, emp));
  const estoque = async () => Number((await db.select({ e: s.produtos.estoque }).from(s.produtos).where(eq(s.produtos.id, prod.id)))[0].e);
  const idFila = op.gerarIdFilaPdv();
  const pedido = { tipo: "sem_nota", itens: [{ produtoId: prod.id, qtd: 2, preco: 5 }], clienteId: null, clienteNome: "CONSUMIDOR", desconto: 0, pagamentos: [{ forma: "dinheiro", valor: 10 }], modelo: "NFC-e", idFila };

  await caso("1ª gravação com idFila: cria a venda com origem pdv_offline e marca [fila:id] na observação; baixa estoque", async () => {
    const r = await pdv.registrarVenda(pedido); assert.equal(r.ok, true, r.erro); assert.equal(r.duplicada, undefined);
    const [v] = await vendasDaEmpresa(); assert.equal(v.origem, "pdv_offline"); assert.match(v.observacao, new RegExp(`\\[fila:${idFila}\\]`)); assert.equal(await estoque(), 48);
  });
  await caso("reenvio da fila com o mesmo idFila NÃO duplica: devolve a venda existente, estoque intacto", async () => {
    const r = await pdv.registrarVenda(pedido); assert.equal(r.ok, true); assert.equal(r.duplicada, true); assert.match(r.aviso, /já estava gravada/);
    assert.equal((await vendasDaEmpresa()).length, 1); assert.equal(await estoque(), 48); assert.equal(r.total, 10); assert.equal(r.numero, (await vendasDaEmpresa())[0].numero);
  });
  await caso("sem idFila (fluxo online normal) continua gravando normalmente com origem pdv", async () => {
    const { idFila: _i, ...semId } = pedido; const r = await pdv.registrarVenda(semId); assert.equal(r.ok, true); assert.equal(r.duplicada, undefined);
    const lista = await vendasDaEmpresa(); assert.equal(lista.length, 2); assert.ok(lista.some((v) => v.origem === "pdv"));
  });
  await caso("idFila com caracteres inválidos é ignorado (não quebra, não vira marca)", async () => {
    const r = await pdv.registrarVenda({ ...pedido, idFila: "x'); drop table nk_venda; --" }); assert.equal(r.ok, true); const lista = await vendasDaEmpresa(); assert.equal(lista.length, 3); assert.ok(lista.every((v) => !String(v.observacao ?? "").includes("drop")));
  });
  await caso("idempotência respeita o tenant: mesma marca em outra empresa não é reaproveitada", async () => {
    const emp2 = randomUUID(), adm2 = randomUUID();
    await db.insert(s.empresas).values({ id: emp2, nome: "Fixture offline 2", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
    await db.insert(s.usuarios).values({ id: adm2, empresaId: emp2, nome: "Op2", email: `${adm2}@t.invalid`, senhaHash: "x", papel: "administrador", ativo: true });
    await db.insert(s.caixaSessoes).values({ empresaId: emp2, numero: 1, terminal: "CAIXA 1", operadorId: adm2, operadorNome: "Op2", status: "aberto", saldoInicial: 0 });
    const [p2] = await db.insert(s.produtos).values({ empresaId: emp2, nome: "ITEM 2", sku: "O2", ncm: "00000000", estoque: 5, estoqueMin: 0, custo: 1, preco: 5 }).returning();
    const [e2] = await db.select().from(s.empresas).where(eq(s.empresas.id, emp2)); sessao = { empresaId: emp2, empresa: e2, usuario: { id: adm2, nome: "Op2", papel: "administrador" } };
    const r = await pdv.registrarVenda({ ...pedido, itens: [{ produtoId: p2.id, qtd: 1, preco: 5 }], pagamentos: [{ forma: "pix", valor: 5 }] }); assert.equal(r.ok, true); assert.equal(r.duplicada, undefined);
    sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Operador offline", papel: "administrador" } };
    await db.delete(s.empresas).where(eq(s.empresas.id, emp2));
  });
} finally {
  try { await db.delete(s.empresas).where(eq(s.empresas.id, emp)); } finally { await pool.end(); }
}
console.log(`NKWAY PDV offline: ${passou} cenários aprovados (banco local, empresas temporárias removidas).`);
