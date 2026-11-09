#!/usr/bin/env node
/** Tabelas de domínio oficiais do módulo fiscal: script por etapas (idempotente), leitura e isolamento.
 *  Banco exclusivamente local. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import ts from "typescript";
import dotenv from "dotenv";
import pg from "pg";

const require = createRequire(import.meta.url);
let passou = 0;
function caso(nome, fn) { try { fn(); passou++; console.log(`  ok ${nome}`); } catch (e) { console.error(`FALHA ${nome}: ${e.message}`); throw new Error(nome); } }
async function casoAsync(nome, fn) { try { await fn(); passou++; console.log(`  ok ${nome}`); } catch (e) { console.error(`FALHA ${nome}: ${e.message}`); throw new Error(nome); } }

// Harness mínimo para compilar o módulo server de leitura.
const memo = new Map();
let db;
function compilar(arquivo, extras = {}) {
  const absoluto = path.resolve(arquivo);
  const modulo = { exports: {} };
  const codigo = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(extras, nome)) return extras[nome];
    if (nome === "@/db") return { get db() { return db; } };
    if (nome.startsWith("@/")) { const destino = path.resolve("src", nome.slice(2)) + ".ts"; return carregar(destino); }
    return require(nome);
  };
  new Function("module", "exports", "require", codigo)(modulo, modulo.exports, importar);
  return modulo.exports;
}
function carregar(arquivo) { const p = path.resolve(arquivo); if (!memo.has(p)) memo.set(p, compilar(p)); return memo.get(p); }

const env = dotenv.parse(fs.readFileSync(".env", "utf8"));
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(dbUrl && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(dbUrl).hostname), "Testes bloqueados fora do banco local.");
const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
const q = (sql, params = []) => client.query(sql, params);

caso("script recusa banco não local", () => {
  const r = spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--etapa", "1"], { env: { ...process.env, DATABASE_URL: "postgresql://u:p@banco-remoto.invalid:5432/x" }, encoding: "utf8" });
  assert.equal(r.status, 1); assert.match(r.stderr + r.stdout, /banco LOCAL/);
});

await casoAsync("script etapa por etapa é idempotente e cumulativo", async () => {
  for (const etapa of ["1", "2", "3", "4"]) {
    const r = spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--etapa", etapa], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  }
  const r1 = await q("select tipo, count(*)::int as n from nk_tabela_dominio group by tipo order by tipo");
  const r2 = spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--todas"], { encoding: "utf8" });
  assert.equal(r2.status, 0, r2.stderr);
  const r3 = await q("select tipo, count(*)::int as n from nk_tabela_dominio group by tipo order by tipo");
  assert.deepEqual(r3.rows, r1.rows, "segunda execução não pode duplicar");
  const esperado = { cst_pis: 33, cst_cofins: 33, cst_icms: 15, csosn: 10, cst_ipi: 14, origem: 9, cst_ibs_cbs: 18, aliquota_padrao_ibs_cbs: 3 };
  const mapa = Object.fromEntries(r1.rows.map((r) => [r.tipo, r.n]));
  for (const [tipo, n] of Object.entries(esperado)) assert.equal(mapa[tipo], n, `${tipo} deveria ter ${n}`);
});

await casoAsync("metadados registram fonte oficial e não há incoerência", async () => {
  const metas = await q("select tipo, fonte, referencia, total from nk_tabela_dominio_meta order by tipo");
  const tipos = metas.rows.map((m) => m.tipo);
  for (const t of ["cst_pis", "cst_ibs_cbs", "cfop", "cclass_trib", "cbenef"]) assert.ok(tipos.includes(t), `meta ausente: ${t}`);
  const cbs = metas.rows.find((m) => m.tipo === "cst_ibs_cbs");
  assert.match(cbs.referencia, /IT 2025\.002/); assert.match(cbs.fonte, /NF-e|SVRS/);
  const cfop = metas.rows.find((m) => m.tipo === "cfop");
  assert.match(cfop.referencia, /IT 2023\.002/);
});

await casoAsync("leitura do núcleo: tipos válidos, inválido vazio, mapas agrupados e conferidor ok", async () => {
  const { drizzle } = require("drizzle-orm/node-postgres");
  db = drizzle(client);
  const core = carregar("src/server/tabelasDominio.ts");
  const pis = await core.listarTabelaDominio("cst_pis");
  assert.equal(pis.length, 33); assert.equal(pis[0].codigo, "01");
  assert.equal((await core.listarTabelaDominio("tipo_inexistente")).length, 0);
  const todas = await core.listarTabelasDominio();
  assert.equal(todas.cst_ibs_cbs.length, 18); assert.equal(todas.origem.length, 9);
  assert.ok(!("ncm" in todas) && !("cest" in todas), "NCM/CEST ficam nas consultas próprias");
  const conf = await core.conferirTabelasDominio();
  assert.equal(conf.ok, true, conf.detalhe);
});

await casoAsync("importação de planilha oficial via --arquivo (CSV) faz upsert sem duplicar", async () => {
  const csv = path.resolve("scripts/fixtures/tabela-teste.csv");
  fs.writeFileSync(csv, "codigo;descricao;vigIni;vigFim\n9999;Código de teste local;01/01/2026;\n");
  try {
    const r = spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--etapa", "3", "--arquivo", csv], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const n1 = (await q("select count(*)::int as n from nk_tabela_dominio where tipo='cfop' and codigo='9999'")).rows[0].n;
    assert.equal(n1, 1);
    spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--etapa", "3", "--arquivo", csv], { encoding: "utf8" });
    const n2 = (await q("select count(*)::int as n from nk_tabela_dominio where tipo='cfop' and codigo='9999'")).rows[0].n;
    assert.equal(n2, 1, "upsert não duplica");
    await q("delete from nk_tabela_dominio where tipo='cfop' and codigo='9999'");
  } finally { fs.rmSync(csv, { force: true }); }
});

await casoAsync("dados de produtos/notas não são tocados pelas tabelas de domínio", async () => {
  const antes = (await q("select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as h from nk_produto t")).rows[0].h;
  spawnSync("node", ["scripts/inserir-tabelas-fiscais.mjs", "--todas"], { encoding: "utf8" });
  const depois = (await q("select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as h from nk_produto t")).rows[0].h;
  assert.equal(depois, antes);
});

await client.end();
console.log(`NKWAY tabelas de domínio: ${passou} cenários aprovados. Fonte oficial registrada em nk_tabela_dominio_meta; nenhuma emisión real.`);
