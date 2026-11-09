#!/usr/bin/env node
/** Tabelas fiscais de referência embutidas: estrutura, fontes, ordenação e coerência com os validadores e com nk_tabela_dominio. Sem rede. */
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import ts from "typescript";
const require = createRequire(import.meta.url); const memo = new Map();
function carregar(arquivo) {
  const abs = path.resolve(arquivo); if (memo.has(abs)) return memo.get(abs);
  const mod = { exports: {} }; const codigo = ts.transpileModule(fs.readFileSync(abs, "utf8"), { fileName: abs, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const importar = (n) => { if (n.startsWith("@/")) { const b = path.resolve("src", n.slice(2)); return carregar([b + ".ts", b + ".tsx"].find((p) => fs.existsSync(p))); } return require(n); };
  new Function("module", "exports", "require", codigo)(mod, mod.exports, importar); memo.set(abs, mod.exports); return mod.exports;
}
const T = carregar("src/lib/tabelasFiscais.ts"); const trib = carregar("src/lib/tributacao.ts"); const C = carregar("src/lib/tabelaClassTrib.ts");
let passou = 0; const caso = (nome, fn) => { try { fn(); passou++; console.log(`  ok ${nome}`); } catch (e) { console.error(`FALHA ${nome}: ${e.message}`); process.exit(1); } };

caso("seis tabelas com fonte, ato, URL oficial e data de conferência", () => {
  assert.equal(T.TABELAS_FISCAIS.length, 6);
  for (const t of T.TABELAS_FISCAIS) { assert.ok(t.fonte && t.ato && /^https?:\/\/(www\.)?(nfe\.fazenda|sped\.rfb|confaz\.fazenda)\.gov\.br/.test(t.url), t.id); assert.match(t.conferidaEm, /^\d{4}-\d{2}-\d{2}$/); }
});
caso("contagens oficiais: PIS/COFINS 33 · IPI 14 · IBS/CBS 18 · CST ICMS 15 · CSOSN 10", () => {
  assert.deepEqual(T.TABELAS_FISCAIS.map((t) => [t.id, T.conferirTabelaFiscal(t.id).total]), [["cst_pis", 33], ["cst_cofins", 33], ["cst_ipi", 14], ["cst_ibs_cbs", 18], ["cst_icms", 15], ["csosn", 10]]);
});
caso("estrutura: códigos únicos, numéricos, tamanho certo e com descrição", () => { for (const t of T.TABELAS_FISCAIS) { const c = T.conferirTabelaFiscal(t.id); assert.ok(c.ok, c.problemas.join("; ")); } });
caso("PIS e COFINS compartilham a mesma lista (IN RFB 1.009/2010)", () => assert.equal(T.tabelaFiscal("cst_pis").itens, T.tabelaFiscal("cst_cofins").itens));
caso("CST ICMS e CSOSN batem com as listas já validadas em tributacao.ts", () => {
  assert.deepEqual(T.CST_ICMS_DESCRICOES.map((i) => i.codigo), [...trib.CST_ICMS_FISCAIS]); assert.deepEqual(T.CSOSN_DESCRICOES.map((i) => i.codigo), [...trib.CSOSN_FISCAIS]);
  for (const c of trib.CST_ICMS_MONOFASICO) assert.match(T.descricaoFiscal("cst_icms", c), /monofásica/i);
});
caso("ids das tabelas coincidem com os tipos de nk_tabela_dominio (cascata banco → instantâneo)", () => {
  const dom = fs.readFileSync("src/server/tabelasDominio.ts", "utf8"); for (const t of T.TABELAS_FISCAIS) assert.ok(dom.includes(`"${t.id}"`), t.id); assert.ok(dom.includes('"cclass_trib"'));
});
caso("todo código das tabelas passa no validador de formato existente", () => { for (const t of T.TABELAS_FISCAIS) for (const i of t.itens) assert.equal(trib.validarCodigoFiscal(t.id, i.codigo).ok, true, `${t.id} ${i.codigo}`); });
caso("descrição: conhecido devolve texto; desconhecido devolve null (nunca inventa)", () => {
  assert.match(T.descricaoFiscal("cst_pis", "01"), /alíquota básica/); assert.match(T.descricaoFiscal("cst_ipi", "53"), /não tributada/i); assert.match(T.descricaoFiscal("cst_ibs_cbs", "000"), /integral/);
  assert.equal(T.descricaoFiscal("cst_pis", "12"), null); assert.equal(T.descricaoFiscal("csosn", "999"), null);
});
caso("opções para venda: saídas primeiro, entradas depois, todas selecionáveis e rotuladas 'código — descrição'", () => {
  const o = T.opcoesTabelaFiscal("cst_pis", "saida"); assert.equal(o.length, 33); assert.equal(o[0].valor, "01"); assert.equal(o[9].valor, "49");
  assert.ok(o.slice(0, 10).every((x) => x.grupo === "Saída")); assert.ok(o.some((x) => x.valor === "50")); assert.equal(o.at(-1).valor, "98");
  assert.equal(T.opcoesTabelaFiscal("cst_ipi", "saida")[0].valor, "50"); assert.ok(o.every((x) => /^\d+ — .+/.test(x.rotulo)));
});
const DIST = { "000": 6, "010": 2, "011": 5, "200": 56, "220": 3, "221": 4, "222": 1, "400": 4, "410": 38, "510": 1, "515": 1, "550": 29, "620": 7, "800": 2, "810": 1, "811": 3, "820": 9, "830": 1 };
caso("cClassTrib: 173 códigos únicos, versão/fonte declaradas e distribuição idêntica ao IT 2025.002 v1.70", () => {
  assert.equal(C.totalClassTrib(), 173); assert.equal(new Set(C.CLASS_TRIB.map(([c]) => c)).size, 173); assert.equal(C.CLASS_TRIB_VERSAO.versao, "1.70");
  const csts = new Set(T.CST_IBS_CBS.map((i) => i.codigo)); const cont = {};
  for (const [c, n] of C.CLASS_TRIB) { assert.match(c, /^\d{6}$/); assert.ok(n.length >= 4, c); assert.ok(csts.has(c.slice(0, 3)), c); cont[c.slice(0, 3)] = (cont[c.slice(0, 3)] ?? 0) + 1; }
  assert.deepEqual(cont, DIST); for (const cst of csts) assert.equal(C.classTribPorCst(cst).length, DIST[cst]);
});
caso("cClassTrib: busca por código, filtro por CST e código desconhecido = null", () => {
  assert.equal(C.classTribPorCodigo("000001").nome, "Situações tributadas integralmente pelo IBS e CBS."); assert.equal(C.classTribPorCodigo("200003").cst, "200");
  assert.equal(C.classTribPorCodigo("999999"), null); assert.deepEqual(C.classTribPorCst("999"), []); assert.equal(C.listarClassTrib().length, 173);
});
caso("cClassTrib: cada par CST/cClassTrib passa no validador de prefixo já existente", () => {
  for (const [c] of C.CLASS_TRIB) assert.equal(trib.validarParametrosTributarios({ cstIbsCbs: c.slice(0, 3), classTrib: c }).ok, true, c);
  assert.equal(trib.validarParametrosTributarios({ cstIbsCbs: "000", classTrib: "200003" }).ok, false);
});
caso("formulário: CST PIS/COFINS/IPI/IBS-CBS e cClassTrib são seletores, não mais datalist", () => {
  const f = fs.readFileSync("src/components/CamposTributarios.tsx", "utf8");
  assert.match(f, /cstPis: "cst_pis", cstCofins: "cst_cofins", cstIpi: "cst_ipi", cstIbsCbs: "cst_ibs_cbs"/); assert.match(f, /SeletorClassTrib/); assert.match(f, /tabelas\?\.cclass_trib/); assert.match(f, /Outro código…/);
});
caso("arquivos declaram limites e não alegam certificação oficial", () => {
  for (const a of ["src/lib/tabelasFiscais.ts", "src/lib/tabelaClassTrib.ts"]) { const f = fs.readFileSync(a, "utf8"); assert.doesNotMatch(f, /validad[oa] oficialmente|homologad[oa] pelo sistema/i); assert.match(f, /sem atualização automática|não há atualização automática/); }
});
caso("CFOP de saída: subconjunto do varejo com 104 códigos únicos nos grupos 5/6/7, descrições e validador", () => {
  assert.equal(T.CFOP_SAIDA_VAREJO.length, 104); assert.equal(new Set(T.CFOP_SAIDA_VAREJO.map((i) => i.codigo)).size, 104);
  for (const i of T.CFOP_SAIDA_VAREJO) { assert.match(i.codigo, /^[567]\d{3}$/); assert.ok(i.descricao.length > 8, i.codigo); assert.equal(trib.validarCodigoFiscal("cfop", i.codigo).ok, true, i.codigo); }
  assert.match(T.descricaoCfop("5.102"), /adquirida ou recebida de terceiros/); assert.match(T.descricaoCfop("6404"), /retido anteriormente/); assert.equal(T.descricaoCfop("1102"), null);
  assert.ok(T.opcoesCfop("6").every((o) => o.valor.startsWith("6"))); assert.ok(T.opcoesCfop("56").every((o) => /^[56]/.test(o.valor))); assert.equal(T.opcoesCfop("7").length, 6);
  assert.match(T.CFOP_FONTE.url, /confaz\.fazenda\.gov\.br/);
});
caso("formulário: CFOP vira seletor e o perfil oculta NCM/CEST preservando valores", () => {
  const f = fs.readFileSync("src/components/CamposTributarios.tsx", "utf8"); assert.match(f, /SeletorCfop/); assert.match(f, /semMercadoria/); assert.match(f, /não é aplicada aos produtos/);
  const v = fs.readFileSync("src/views/TributacaoProdutos.tsx", "utf8"); assert.match(v, /prefixo="perfil-fiscal" semMercadoria/); assert.match(v, /prefixo="produto-fiscal"(?! semMercadoria)/);
});
/* ---------------- carga administrativa em banco local (idempotente, nada apagado, permissão) */
{
  const dotenv = require("dotenv"); const pg = require("pg"); const { drizzle } = require("drizzle-orm/node-postgres"); const { eq, sql } = require("drizzle-orm"); const { randomUUID } = require("node:crypto");
  const env = dotenv.parse(fs.readFileSync(".env", "utf8")); const url = process.env.DATABASE_URL || env.DATABASE_URL;
  assert.ok(url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Testes de banco bloqueados fora do ambiente local.");
  const pool = new pg.Pool({ connectionString: url }); const db = drizzle(pool);
  let sessao = null;
  const memo2 = new Map();
  function carregarDb(arquivo) {
    const abs = path.resolve(arquivo); if (memo2.has(abs)) return memo2.get(abs);
    const mod = { exports: {} }; const codigo = ts.transpileModule(fs.readFileSync(abs, "utf8"), { fileName: abs, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const importar = (n) => { if (n === "@/db") return { db }; if (n === "@/lib/session") return { contexto: async () => sessao }; if (n === "next/cache") return { revalidatePath: () => {} };
      if (n.startsWith("@/") || n.startsWith(".")) { const b = n.startsWith("@/") ? path.resolve("src", n.slice(2)) : path.resolve(path.dirname(abs), n); return carregarDb([b, b + ".ts", b + ".tsx"].find((p) => fs.existsSync(p) && fs.statSync(p).isFile())); } return require(n); };
    new Function("module", "exports", "require", codigo)(mod, mod.exports, importar); memo2.set(abs, mod.exports); return mod.exports;
  }
  const s = carregarDb("src/db/schema.ts"); const acoes = carregarDb("src/server/acoes/tributacao.ts");
  const emp = randomUUID(), adm = randomUUID(), op = randomUUID();
  const contar = async (tipo) => Number((await db.execute(sql`select count(*)::int as n from nk_tabela_dominio where tipo = ${tipo} and ativo`)).rows[0].n);
  const marcador = `ZZ-fixture-${randomUUID().slice(0, 8)}`;
  try {
    await db.insert(s.empresas).values({ id: emp, nome: "Fixture carga", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
    await db.insert(s.usuarios).values([{ id: adm, empresaId: emp, nome: "Admin carga", email: `${adm}@t.invalid`, senhaHash: "x", papel: "administrador", ativo: true }, { id: op, empresaId: emp, nome: "Op", email: `${op}@t.invalid`, senhaHash: "x", papel: "operador", ativo: true }]);
    const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, emp));
    // linha "estranha" preexistente: não pode ser apagada pela carga
    await db.insert(s.tabelaDominio).values({ tipo: "cst_pis", codigo: marcador, descricao: "linha preexistente", uf: "", fonte: "fixture", versao: "x", ativo: true });
    sessao = { empresaId: emp, empresa, usuario: { id: op, nome: "Op", papel: "operador" } };
    await (async () => { const r = await acoes.carregarTabelasFiscaisReferencia(); assert.equal(r.ok, false); })();
    console.log("  ok carga: operador sem config.gerenciar é recusado");
    passou++;
    sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Admin carga", papel: "administrador" } };
    const r1 = await acoes.carregarTabelasFiscaisReferencia(); assert.equal(r1.ok, true, r1.erro);
    const porTipo = Object.fromEntries(r1.resultados.map((x) => [x.tipo, x]));
    assert.equal(porTipo.cclass_trib.total, 173); assert.equal(porTipo.cfop.total >= 104, true); assert.equal(porTipo.cst_ibs_cbs.total, 18); assert.equal(porTipo.origem.total, 9);
    assert.ok(await contar("cst_pis") >= 34, "33 oficiais + a linha preexistente preservada");
    const metas = await db.select().from(s.tabelaDominioMeta).where(eq(s.tabelaDominioMeta.tipo, "cclass_trib")); assert.match(metas[0].referencia, /1\.70/); assert.equal(metas[0].total, 173);
    console.log("  ok carga: 10 tabelas gravadas com metadados (cClassTrib 173, CST IBS/CBS 18, origem 9) e linha preexistente preservada");
    passou++;
    const r2 = await acoes.carregarTabelasFiscaisReferencia(); assert.equal(r2.ok, true);
    assert.equal(r2.resultados.reduce((t, x) => t + x.inseridas + x.atualizadas, 0), 0, "segunda carga não insere nem altera nada");
    const aud = await db.select().from(s.auditorias).where(eq(s.auditorias.acao, "fiscal.tabelas_dominio_carregar")); assert.ok(aud.length >= 2); assert.match(aud.at(-1).resumo, /cclass_trib 173/);
    console.log("  ok carga: idempotente (segunda execução = 0 mudanças) e auditada");
    passou++;
  } finally {
    // remove a fixture e recarrega para a meta voltar a refletir o total real (diagnóstico fis-15 confere meta × linhas)
    await db.execute(sql`delete from nk_tabela_dominio where codigo = ${marcador}`);
    try { sessao = { empresaId: emp, empresa: (await db.select().from(s.empresas).where(eq(s.empresas.id, emp)))[0], usuario: { id: adm, nome: "Admin carga", papel: "administrador" } }; await acoes.carregarTabelasFiscaisReferencia(); } catch { /* best effort */ }
    try { await db.delete(s.empresas).where(eq(s.empresas.id, emp)); } finally { await pool.end(); }
  }
}
console.log(`NKWAY tabelas fiscais de referência: ${passou} cenários aprovados (puros + carga em banco local).`);
