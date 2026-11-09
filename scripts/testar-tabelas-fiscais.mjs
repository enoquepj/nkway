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
console.log(`NKWAY tabelas fiscais de referência: ${passou} cenários aprovados (sem banco, sem rede).`);
