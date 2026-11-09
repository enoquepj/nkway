#!/usr/bin/env node
/** Estoque: indicadores puros (giro/cobertura/ABC/reposição/extrato) + inventário e ajuste transacionais em banco LOCAL com empresa temporária. */
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { randomUUID } from "node:crypto";
import ts from "typescript"; import dotenv from "dotenv"; import pg from "pg"; import { drizzle } from "drizzle-orm/node-postgres"; import { and, eq, inArray } from "drizzle-orm";
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
const I = carregar("src/lib/estoqueIndicadores.ts");

/* ------------------------------------------------------------ puros */
const hoje = new Date("2026-11-09T12:00:00Z");
await caso("cobertura, média diária, sugestão de compra e situação de reposição", () => {
  const prods = [{ id: "a", estoque: 30, estoqueMin: 10, custo: 5, preco: 9, ativo: true }, { id: "b", estoque: 0, estoqueMin: 5, custo: 2, preco: 4, ativo: true }, { id: "c", estoque: 500, estoqueMin: 10, custo: 1, preco: 2, ativo: true }, { id: "d", estoque: 8, estoqueMin: 10, custo: 3, preco: 5, ativo: true }];
  const vendas = [{ produtoId: "a", qtd30: 60, qtd90: 150, valor90: 1350, ultimaVenda: "2026-11-08T10:00:00Z" }, { produtoId: "b", qtd30: 10, qtd90: 20, valor90: 80, ultimaVenda: "2026-11-01T10:00:00Z" }, { produtoId: "c", qtd30: 3, qtd90: 9, valor90: 18, ultimaVenda: "2026-10-30T10:00:00Z" }];
  const r = I.calcularIndicadores(prods, vendas, { diasCobertura: 15, leadTimeDias: 7, hoje });
  const a = r.get("a"); assert.equal(a.mediaDiaria30, 2); assert.equal(a.coberturaDias, 15); assert.equal(a.sugestaoCompra, 14, "2/dia × 22 dias = 44 − 30"); assert.equal(a.situacaoReposicao, "atencao"); assert.equal(a.diasSemVenda, 1); assert.equal(a.giro90, 5);
  const b = r.get("b"); assert.equal(b.situacaoReposicao, "ruptura"); assert.ok(b.sugestaoCompra >= 5);
  const c = r.get("c"); assert.equal(c.situacaoReposicao, "excesso"); assert.equal(c.sugestaoCompra, 0);
  const d = r.get("d"); assert.equal(d.coberturaDias, null); assert.equal(d.situacaoReposicao, "repor", "abaixo do mínimo mesmo sem venda"); assert.equal(d.sugestaoCompra, 2); assert.equal(d.parado, true); assert.equal(d.classeAbc, "—");
});
await caso("curva ABC por valor de 90 dias (A ≤ 80%, B ≤ 95%, C restante)", () => {
  const prods = ["p1", "p2", "p3", "p4", "p5"].map((id) => ({ id, estoque: 1, estoqueMin: 0, custo: 1, preco: 1, ativo: true }));
  const vendas = [["p1", 700], ["p2", 200], ["p3", 60], ["p4", 30], ["p5", 10]].map(([produtoId, valor90]) => ({ produtoId, qtd30: 1, qtd90: 1, valor90, ultimaVenda: null }));
  const r = I.calcularIndicadores(prods, vendas, { diasCobertura: 15, leadTimeDias: 7, hoje });
  assert.deepEqual(["p1", "p2", "p3", "p4", "p5"].map((p) => r.get(p).classeAbc), ["A", "B", "C", "C", "C"]);
});
await caso("extrato: saldo anterior/entradas/saídas/final a partir dos lançamentos", () => {
  const e = I.resumirExtrato([{ qtd: -2, saldoApos: 8, data: "2026-11-03" }, { qtd: 5, saldoApos: 10, data: "2026-11-01" }, { qtd: -3, saldoApos: 5, data: "2026-11-05" }]);
  assert.deepEqual(e, { saldoAnterior: 5, entradas: 5, saidas: 5, saldoFinal: 5, lancamentos: 3 }); assert.equal(I.resumirExtrato([]), null);
});
await caso("leitura de quantidade de contagem: vírgula/ponto, 3 casas, recusa sinal e texto", () => {
  assert.equal(I.lerQuantidade("12"), 12); assert.equal(I.lerQuantidade("12,5"), 12.5); assert.equal(I.lerQuantidade("12.250"), 12.25); assert.equal(I.lerQuantidade(" 3 "), 3);
  assert.equal(I.lerQuantidade("-1"), null); assert.equal(I.lerQuantidade("1,2345"), null); assert.equal(I.lerQuantidade("abc"), null); assert.equal(I.lerQuantidade(""), null); assert.equal(I.lerQuantidade(7), 7);
});

/* ------------------------------------------------------------ banco local */
const env = dotenv.parse(fs.readFileSync(".env", "utf8")); const url = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Testes de banco bloqueados fora do ambiente local.");
const pool = new pg.Pool({ connectionString: url }); db = drizzle(pool);
const s = carregar("src/db/schema.ts"); const acoes = carregar("src/server/acoes/estoque.ts"); const dados = carregar("src/server/dados.ts");
const emp = randomUUID(), adm = randomUUID(), vend = randomUUID();
try {
  await db.insert(s.empresas).values({ id: emp, nome: "Fixture estoque", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
  await db.insert(s.usuarios).values([{ id: adm, empresaId: emp, nome: "Admin estoque", email: `${adm}@t.invalid`, senhaHash: "x", papel: "administrador", ativo: true }, { id: vend, empresaId: emp, nome: "Vendedor", email: `${vend}@t.invalid`, senhaHash: "x", papel: "vendedor", ativo: true }]);
  const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, emp));
  sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Admin estoque", papel: "administrador" } };
  const [pa] = await db.insert(s.produtos).values({ empresaId: emp, nome: "PRODUTO A", sku: "A1", ncm: "00000000", estoque: 10, estoqueMin: 2, custo: 4, preco: 8 }).returning();
  const [pb] = await db.insert(s.produtos).values({ empresaId: emp, nome: "PRODUTO B", sku: "B1", ncm: "00000000", estoque: 5, estoqueMin: 1, custo: 2, preco: 3 }).returning();
  const estoque = async (id) => Number((await db.select({ e: s.produtos.estoque }).from(s.produtos).where(eq(s.produtos.id, id)))[0].e);
  const movs = async (id) => db.select().from(s.movimentos).where(eq(s.movimentos.produtoId, id));

  await caso("inventário em lote: grava só diferenças, com rótulo, usuário e observação, em uma transação", async () => {
    const r = await acoes.lancarInventario({ rotulo: "Contagem teste", linhas: [{ produtoId: pa.id, quantidade: "12,5" }, { produtoId: pb.id, quantidade: 5 }] });
    assert.equal(r.ok, true, r.erro); assert.equal(r.ajustados, 1); assert.equal(r.semDiferenca, 1);
    assert.equal(await estoque(pa.id), 12.5); assert.equal(await estoque(pb.id), 5);
    const [m] = await movs(pa.id); assert.equal(m.tipo, "inventario"); assert.equal(Number(m.qtd), 2.5); assert.equal(m.documento, "Contagem teste"); assert.equal(m.usuarioId, adm); assert.match(m.observacao, /10 → contado 12.5/);
    assert.equal((await movs(pb.id)).length, 0);
  });
  await caso("inventário recusa quantidade inválida, produto repetido, produto de outra empresa e lote vazio — sem gravar nada", async () => {
    const antes = await estoque(pa.id);
    assert.match((await acoes.lancarInventario({ linhas: [{ produtoId: pa.id, quantidade: "abc" }] })).erro, /inválida/);
    assert.match((await acoes.lancarInventario({ linhas: [{ produtoId: pa.id, quantidade: 1 }, { produtoId: pa.id, quantidade: 2 }] })).erro, /repetido/);
    assert.match((await acoes.lancarInventario({ linhas: [{ produtoId: randomUUID(), quantidade: 1 }] })).erro, /não pertence/);
    assert.match((await acoes.lancarInventario({ linhas: [] })).erro, /Nenhuma/);
    assert.match((await acoes.lancarInventario({ linhas: [{ produtoId: pa.id, quantidade: 1 }, { produtoId: randomUUID(), quantidade: 1 }] })).erro, /não pertence/, "lote com um inválido não aplica o válido");
    assert.equal(await estoque(pa.id), antes); assert.equal((await movs(pa.id)).length, 1);
  });
  await caso("formato antigo (array) continua aceito", async () => {
    const r = await acoes.lancarInventario([{ produtoId: pb.id, quantidade: 7, observacao: "legado" }]); assert.equal(r.ok, true); assert.equal(await estoque(pb.id), 7);
    const [m] = await movs(pb.id); assert.equal(m.documento, "Inventário"); assert.equal(m.observacao, "legado");
  });
  await caso("ajuste pontual: delta negativo, saldo não fica negativo, zero é recusado, tipo inválido é recusado", async () => {
    assert.equal((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "perda", qtd: -2.5, motivo: "avaria na gôndola", modo: "delta" })).ok, true); assert.equal(await estoque(pa.id), 10);
    assert.match((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "ajuste", qtd: -50, motivo: "x".repeat(5), modo: "delta" })).erro, /negativo/);
    assert.match((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "ajuste", qtd: 0, motivo: "nada", modo: "delta" })).erro, /diferente de zero/);
    assert.equal((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "qualquer", qtd: 1, motivo: "x", modo: "delta" })).ok, false);
    assert.equal((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "ajuste", qtd: 1, motivo: "", modo: "delta" })).ok, false);
    const ultimo = (await movs(pa.id)).at(-1); assert.equal(ultimo.tipo, "perda"); assert.equal(ultimo.usuarioNome, "Admin estoque");
  });
  await caso("vendedor sem estoque.ajustar não lança inventário nem ajuste", async () => {
    sessao = { ...sessao, usuario: { id: vend, nome: "Vendedor", papel: "vendedor" } };
    assert.equal((await acoes.lancarInventario({ linhas: [{ produtoId: pa.id, quantidade: 1 }] })).ok, false);
    assert.equal((await acoes.ajustarEstoque({ produtoId: pa.id, tipo: "ajuste", qtd: 1, motivo: "teste", modo: "delta" })).ok, false);
    sessao = { ...sessao, usuario: { id: adm, nome: "Admin estoque", papel: "administrador" } }; assert.equal(await estoque(pa.id), 10);
  });
  await caso("giro por produto: conta vendas faturadas de 30/90 dias, ignora canceladas e DAV", async () => {
    const venda = async (dias, status, tipo, qtd) => { const [v] = await db.insert(s.vendas).values({ empresaId: emp, numero: Math.floor(Math.random() * 1e6), subtotal: qtd * 8, total: qtd * 8, formaPagamento: "pix", pagamentos: [{ forma: "pix", valor: qtd * 8 }], tipo, status, data: new Date(Date.now() - dias * 86400000) }).returning(); await db.insert(s.vendaItens).values({ vendaId: v.id, produtoId: pa.id, nome: "PRODUTO A", qtd, precoUnit: 8, total: qtd * 8, unidade: "UN", gtin: "SEM GTIN" }); };
    await venda(5, "faturado", "sem_nota", 3); await venda(60, "faturado", "fiscal", 4); await venda(2, "cancelado", "fiscal", 9); await venda(1, "aberto", "dav", 9); await venda(120, "faturado", "fiscal", 9);
    const r = (await dados.vendasPorProdutoRecentes(emp)).find((x) => x.produtoId === pa.id);
    assert.equal(r.qtd30, 3); assert.equal(r.qtd90, 7); assert.equal(r.valor90, 56); assert.ok(r.ultimaVenda);
  });
  await caso("kardex expõe usuário e o extrato do produto bate com o saldo do cadastro", async () => {
    const k = await dados.listarKardex(emp, pa.id); assert.ok(k.every((m) => "usuarioNome" in m)); const e = I.resumirExtrato(k); assert.equal(e.saldoFinal, await estoque(pa.id)); assert.equal(e.saldoAnterior, 10);
  });
} finally {
  try { await db.delete(s.empresas).where(eq(s.empresas.id, emp)); } finally { await pool.end(); }
}
console.log(`NKWAY estoque: ${passou} cenários aprovados (banco local, empresa temporária removida).`);
