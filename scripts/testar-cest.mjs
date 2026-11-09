#!/usr/bin/env node
/** CEST etapa 2. Referência LOCAL por empresa (CEST ↔ NCM), sem fonte estruturada oficial adotada.
 *  Fixtures e banco/HTTP exclusivamente locais; limpa empresas temporárias. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import ts from "typescript";
import dotenv from "dotenv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

const require = createRequire(import.meta.url);
const memo = new Map();
let db, sessao = null, falharAuditoria = false;
function compilar(arquivo, extras = {}) {
  const absoluto = path.resolve(arquivo);
  const modulo = { exports: {} };
  const codigo = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    fileName: absoluto, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const importar = (nome) => {
    if (Object.hasOwn(extras, nome)) return extras[nome];
    if (nome === "@/db") return { get db() { assert.ok(db, "Banco não inicializado"); return db; } };
    if (nome === "@/lib/session") return { contexto: async () => sessao };
    if (nome === "next/cache") return { revalidatePath: () => {} };
    if (nome === "@/server/auditoria") return { registrarAuditoria: async (...args) => {
      if (falharAuditoria) throw new Error("Falha simulada de auditoria");
      return carregar("src/server/auditoria.ts").registrarAuditoria(...args);
    } };
    if (nome.startsWith("@/") || nome.startsWith(".")) {
      const base = nome.startsWith("@/") ? path.resolve("src", nome.slice(2)) : path.resolve(path.dirname(absoluto), nome);
      const destino = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      assert.ok(destino, `Importação não localizada: ${nome}`); return carregar(destino);
    }
    return require(nome);
  };
  new Function("module", "exports", "require", codigo)(modulo, modulo.exports, importar);
  return modulo.exports;
}
function carregar(arquivo) { const p = path.resolve(arquivo); if (!memo.has(p)) memo.set(p, compilar(p)); return memo.get(p); }
const lib = carregar("src/lib/cest.ts");
let passou = 0;
async function caso(nome, executar) {
  try { await executar(); passou++; console.log(`  ok ${nome}`); }
  catch (e) {
    const detalhe = String(e?.cause?.message || e?.message || "falha").replace(/postgres(?:ql)?:\/\/\S+/gi, "[conexão oculta]").slice(0, 600);
    console.error(`FALHA ${nome}: ${detalhe}`); throw new Error(`Cenário reprovado: ${nome}`);
  }
}
const rejeita = (fn, codigo) => assert.rejects(fn, (e) => e instanceof lib.ErroCest && (!codigo || e.codigo === codigo));

/* ---------------------------------- modelo puro ---------------------------------- */
await caso("CEST preserva zero inicial e exige exatamente 7 dígitos", () => {
  assert.equal(lib.codigoCestDigitado("03.002.00"), "0300200");
  assert.equal(lib.codigoCestDigitado("0300200"), "0300200");
  assert.equal(lib.codigoCestDigitado("123"), null);
  assert.equal(lib.codigoCestDigitado("03002000"), null);
  assert.equal(lib.codigoCestDigitado("0000000"), null);
  assert.equal(lib.codigoCestDigitado(3002000), null);
  assert.equal(lib.codigoCestDigitado(""), null);
});
await caso("formatação SS.III.DD e segmento", () => {
  assert.equal(lib.formatarCest("0300200"), "03.002.00");
  assert.equal(lib.segmentoCest("0300200"), "03");
  assert.equal(lib.formatarCest("abc"), "abc");
});
await caso("registro válido aceita NCM exato e prefixos 2/4/6/8 dígitos dos anexos", () => {
  const r = lib.validarRegistroCest({ cest: "02.001.00", descricao: "Aperitivos, amargos e similares", ncm: "2205 2208.90.00", fonte: "CONFAZ — Conv. ICMS 142/2018 (anexos PDF)", ato: "Convênio ICMS 142/2018", vigencia: "consolidado até Conv. 107/2026" });
  assert.equal(r.cest, "0200100"); assert.deepEqual(r.ncm, ["2205", "22089000"]); assert.equal(r.segmento, "02");
  assert.ok(r.busca.includes("aperitivos"));
});
await caso("registro inválido é recusado integralmente (nada descartado em silêncio)", () => {
  for (const reg of [
    { cest: "123", descricao: "Válido" }, { cest: "0000000", descricao: "Válido" }, { cest: "0200100", descricao: "ab" },
    { cest: "0200100", descricao: "Válido", ncm: ["2205", "abc"] }, { cest: "0200100", descricao: "Válido", ncm: ["220"] },
    { cest: 200100, descricao: "Válido" }, { cest: "0200100", descricao: "a".repeat(301) }, [], "texto",
  ]) assert.throws(() => lib.validarRegistroCest(reg), lib.ErroCest);
});
await caso("fonte ausente usa o rótulo local padrão; nunca diz oficial", () => {
  const r = lib.validarRegistroCest({ cest: "0500100", descricao: "Cimento" });
  assert.equal(r.fonte, lib.FONTE_CEST_LOCAL);
  assert.ok(lib.NOTA_FONTE_CEST.includes("PDF"));
  assert.ok(lib.NOTA_FONTE_CEST.includes("Não há fonte oficial estruturada"));
});
await caso("catálogo rejeita CEST duplicado e ordena", () => {
  const base = { cest: "0500100", descricao: "Cimento" };
  assert.throws(() => lib.validarCatalogoCest([base, { ...base }]), (e) => e.codigo === "duplicado");
  const ok = lib.validarCatalogoCest([{ cest: "1300100", descricao: "Medicamentos" }, base]);
  assert.deepEqual(ok.map((r) => r.cest), ["0500100", "1300100"]);
  assert.throws(() => lib.validarCatalogoCest(new Array(lib.CEST_MAX_REGISTROS + 1).fill(base)), (e) => e.codigo === "limite_excedido");
});
await caso("consulta por dígitos vira prefixo duplo (CEST e NCM/SH); texto vira termos sem acento", () => {
  assert.deepEqual(lib.termosConsultaCest("03.002"), { digitos: "03002", termos: [] });
  assert.deepEqual(lib.termosConsultaCest("22030000"), { digitos: "22030000", termos: [] });
  assert.deepEqual(lib.termosConsultaCest("CERVEJA malte"), { digitos: null, termos: ["cerveja", "malte"] });
  assert.deepEqual(lib.termosConsultaCest(""), { digitos: null, termos: [] });
});

/* ---------------------------------- banco local ---------------------------------- */
const env = dotenv.parse(fs.readFileSync(".env", "utf8"));
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(dbUrl && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(dbUrl).hostname), "Testes de banco bloqueados fora do ambiente local.");
const pool = new pg.Pool({ connectionString: dbUrl }); db = drizzle(pool);
const s = carregar("src/db/schema.ts"); const core = carregar("src/server/cestCore.ts"); const acoes = carregar("src/server/acoes/cadastros.ts");
const a = randomUUID(), b = randomUUID(), ua = randomUUID(), ub = randomUUID(), uop = randomUUID();
const ator = { empresaId: a, usuario: { id: ua, nome: "Admin fixture CEST", papel: "administrador" } };
const cache = async (id = a) => (await db.select().from(s.catalogoCest).where(eq(s.catalogoCest.empresaId, id)))[0];
const protegido = async () => {
  const hashes = {};
  for (const tabela of ["nk_produto", "nk_venda", "nk_venda_item", "nk_movimento", "nk_fiscal_parametro", "nk_produto_tributacao"]) {
    hashes[tabela] = (await db.execute(sql`select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as hash from ${sql.identifier(tabela)} t`)).rows[0].hash;
  }
  return hashes;
};
const antes = await protegido();
try {
  await db.insert(s.empresas).values([a, b].map((id, i) => ({ id, nome: `Fixture CEST ${i}`, cnpj: "00000000000000", plano: "loja_mais" })));
  await db.insert(s.usuarios).values([[ua, a, "administrador"], [ub, b, "administrador"], [uop, a, "operador"]].map(([id, empresaId, papel]) => ({ id, empresaId, nome: "Usuário fixture", email: `${id}@teste.invalid`, senhaHash: "fixture-nao-usavel", papel, ativo: true })));
  const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, a)); sessao = { ...ator, empresa };

  await caso("migração local é aditiva e idempotente", async () => {
    const ddl = fs.readFileSync("supabase/migrations/20261109_catalogo_cest.sql", "utf8");
    assert.doesNotMatch(ddl.replace(/--[^\n]*/g, ""), /\b(?:drop|truncate|alter table|update nk_produto|insert)\b/i);
    await db.execute(sql.raw(ddl)); await db.execute(sql.raw(ddl));
  });
  await caso("consulta sem referência não grava nada e não faz rede", async () => {
    const r = await core.consultarCest(a, "2203"); assert.equal(r.catalogo.estado, "ausente"); assert.equal(r.total, 0); assert.equal(r.itens.length, 0);
    assert.equal(await cache(), undefined);
  });
  await caso("gerenciar exige config.gerenciar mesmo no núcleo servidor", async () => {
    await rejeita(() => core.gerenciarCest({ empresaId: a, usuario: { id: uop, nome: "Operador", papel: "operador" } }, { operacao: "upsert", registro: { cest: "0300200", descricao: "Cervejas de malte" } }), "acesso_negado");
    await rejeita(() => core.gerenciarCest(ator, { operacao: "invalida" }), "registro_invalido");
    assert.equal(await cache(), undefined);
  });
  await caso("upsert grava referência local e auditoria juntos, sem tocar produtos", async () => {
    const r = await core.gerenciarCest(ator, { operacao: "upsert", registro: { cest: "03.002.00", descricao: "Cervejas de malte", ncm: ["2203", "22030000"], fonte: "CONFAZ — Conv. ICMS 142/2018 (anexos PDF)", ato: "Convênio ICMS 142/2018", vigencia: "consolidado até Conv. 107/2026" } });
    assert.equal(r.ok, true); assert.equal(r.estado, "atualizado"); assert.equal(r.catalogo.totalRegistros, 1);
    const c = await cache(); assert.equal(c.totalRegistros, 1); assert.ok(c.hash);
    const logs = await db.select().from(s.auditorias).where(and(eq(s.auditorias.empresaId, a), eq(s.auditorias.acao, "fiscal.cest_referencia")));
    assert.equal(logs.length, 1); assert.equal(logs[0].alteracoes.produtosAlterados, 0); assert.equal(logs[0].alteracoes.validacaoOficial, false);
    assert.deepEqual(await protegido(), antes);
  });
  await caso("um NCM pode corresponder a vários CESTs (relação um-para-vários)", async () => {
    await core.gerenciarCest(ator, { operacao: "upsert", registro: { cest: "0400100", descricao: "Charutos e cigarros de tabaco", ncm: ["2402"], ato: "Convênio ICMS 142/2018" } });
    await core.gerenciarCest(ator, { operacao: "upsert", registro: { cest: "0300100", descricao: "Água mineral em garrafa retornável", ncm: ["2201.10.00"], ato: "Convênio ICMS 142/2018" } });
    const porNcm = await core.consultarCest(a, "2203"); assert.equal(porNcm.total, 1); assert.equal(porNcm.itens[0].cest, "0300200");
    const exato = await core.consultarCest(a, "22030000"); assert.equal(exato.total, 1);
    const prefixoCest = await core.consultarCest(a, "03"); assert.equal(prefixoCest.total, 2);
    const texto = await core.consultarCest(a, "cerveja"); assert.equal(texto.total, 1); assert.equal(texto.itens[0].descricao, "Cervejas de malte");
    assert.equal(Object.hasOwn(texto.itens[0], "busca"), false);
  });
  await caso("limites e paginação; busca parametrizada; outra empresa não lê", async () => {
    for (let i = 0; i < 25; i++) await core.gerenciarCest(ator, { operacao: "upsert", registro: { cest: `17${String(i).padStart(3, "0")}00`, descricao: `Produto alimentício fixture ${i}`, ncm: ["1704"] } });
    const p1 = await core.consultarCest(a, "17"); assert.equal(p1.itens.length, 20); assert.equal(p1.total, 25);
    const p2 = await core.consultarCest(a, "17", 2); assert.equal(p2.itens.length, 5); assert.notEqual(p1.itens[0].cest, p2.itens[0].cest);
    const injection = "' OR 1=1 --"; const r = await core.consultarCest(a, injection);
    const termos = lib.termosConsultaCest(injection).termos;
    const esperado = (await cache()).registros.filter((x) => termos.every((t) => x.busca.includes(t))).length;
    assert.equal(r.total, esperado); assert.ok(r.total < 30);
    await assert.rejects(() => core.consultarCest(a, "a".repeat(81))); await assert.rejects(() => core.consultarCest(a, "", 2001));
    const outra = await core.consultarCest(b, "2203"); assert.equal(outra.catalogo.estado, "ausente"); assert.equal(outra.total, 0);
  });
  await caso("remover é explícito, auditado e preserva produtos", async () => {
    const r = await core.gerenciarCest(ator, { operacao: "remover", cest: "0300100" });
    assert.equal(r.ok, true); assert.equal(r.estado, "removido"); assert.equal((await core.consultarCest(a, "2201")).total, 0);
    const inexistente = await core.gerenciarCest(ator, { operacao: "remover", cest: "9999999" });
    assert.equal(inexistente.ok, false); assert.equal(inexistente.codigo, "nao_encontrado");
    const logs = await db.select().from(s.auditorias).where(and(eq(s.auditorias.empresaId, a), eq(s.auditorias.acao, "fiscal.cest_referencia"), sql`${s.auditorias.alteracoes}->>'operacao' = 'remover'`));
    assert.equal(logs.length, 1);
    assert.deepEqual(await protegido(), antes);
  });
  await caso("falha de auditoria reverte a alteração da referência", async () => {
    const foto = (await cache()).hash; falharAuditoria = true;
    try {
      const r = await core.gerenciarCest(ator, { operacao: "upsert", registro: { cest: "2300100", descricao: "Sorvetes de qualquer espécie", ncm: ["2105"] } });
      assert.equal(r.ok, false);
    } finally { falharAuditoria = false; }
    assert.equal((await cache()).hash, foto);
  });
  await caso("salvarProduto grava CEST com auditoria e preserva NCM; campo ausente em chamada antiga não apaga", async () => {
    const entrada = { nome: "Produto fixture CEST", sku: "FX-CEST", gtin: "SEM GTIN", categoria: "Fixture", marca: "", unidade: "UN", custo: 5, preco: 10, estoque: 2, estoqueMin: 0, pesavel: false, ativo: true, ncm: "2203.00.00", cfop: "5102", csosn: "102", icmsAliq: 0 };
    const r1 = await acoes.salvarProduto({ ...entrada, cest: "03.002.00", cestOrigem: "referencia_local" });
    assert.equal(r1.ok, true); const id = r1.id;
    const [p] = await db.select().from(s.produtos).where(eq(s.produtos.id, id));
    assert.equal(p.cest, "0300200"); assert.equal(p.ncm, "22030000");
    const [log] = await db.select().from(s.auditorias).where(and(eq(s.auditorias.registroId, id), eq(s.auditorias.acao, "produto.cest_informado")));
    assert.equal(log.alteracoes.depois, "0300200"); assert.equal(log.alteracoes.modo, "referencia_local"); assert.equal(log.alteracoes.validacaoOficial, false);
    // chamada legada sem cest não apaga o valor existente
    const r2 = await acoes.salvarProduto({ ...entrada, id, preco: 11 });
    assert.equal(r2.ok, true);
    const [p2] = await db.select().from(s.produtos).where(eq(s.produtos.id, id));
    assert.equal(p2.cest, "0300200"); assert.equal(Number(p2.preco), 11);
    // CEST inválido é recusado; curto nunca é completado
    const r3 = await acoes.salvarProduto({ ...entrada, id, cest: "123" }); assert.equal(r3.ok, false); assert.match(r3.erro, /7 dígitos/);
    const r4 = await acoes.salvarProduto({ ...entrada, id, cest: "0000000" }); assert.equal(r4.ok, false);
    // origem "oficial" declarada pelo cliente é descartada
    const r5 = await acoes.salvarProduto({ ...entrada, id, cest: "0400100", cestOrigem: "oficial" });
    assert.equal(r5.ok, true);
    const [log5] = await db.select().from(s.auditorias).where(and(eq(s.auditorias.registroId, id), eq(s.auditorias.acao, "produto.cest_informado"))).orderBy(sql`created_at desc`).limit(1);
    assert.equal(log5.alteracoes.modo, "informado_pelo_usuario"); assert.equal(log5.alteracoes.validacaoOficial, false);
  });
  await caso("referência local nunca alterou vendas, notas ou parâmetros; só o produto fixture novo entrou", async () => {
    const agora = await protegido();
    assert.equal(agora.nk_venda, antes.nk_venda);
    assert.equal(agora.nk_venda_item, antes.nk_venda_item);
    assert.equal(agora.nk_fiscal_parametro, antes.nk_fiscal_parametro);
    assert.equal(agora.nk_produto_tributacao, antes.nk_produto_tributacao);
    const total = Number((await db.execute(sql`select count(*)::int as n from nk_produto`)).rows[0].n);
    const antesQtd = Number((await db.execute(sql`select count(*)::int as n from nk_produto where empresa_id <> ${a} and empresa_id <> ${b}`)).rows[0].n);
    assert.equal(total - 1, antesQtd); // exatamente um produto fixture a mais
  });

  /* ---------------------------------- API (handlers) ---------------------------------- */
  let consultas = [], gerenciamentos = 0;
  const api = compilar("src/app/api/fiscal/cest/route.ts", { "@/server/cestCore": {
    consultarCest: async (...args) => { consultas.push(args); return { catalogo: { estado: "disponivel", totalRegistros: 1, fonte: "Referência local da empresa", nota: "x", hash: "h", atualizadoEm: null }, consulta: args[1], pagina: args[2], porPagina: 20, total: 1, itens: [{ cest: "0300200", descricao: "Cervejas de malte", segmento: "03", ncm: ["2203"], fonte: "local", ato: "", vigencia: "" }], podeGerenciar: args[3] }; },
    gerenciarCest: async (c, corpo) => { assert.equal(c.empresaId, a); gerenciamentos++; if (corpo?.operacao === "ruim") return { ok: false, erro: "Registro de CEST inválido.", codigo: "registro_invalido" }; return { ok: true, estado: "atualizado", mensagem: "ok", catalogo: { estado: "disponivel" } }; },
  } });
  const req = (rota = "", init = {}) => new Request(`http://localhost:3000/api/fiscal/cest${rota}`, init);
  const post = { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000", "X-NKWAY-CEST": "referencia" } };
  await caso("API sem sessão é 401 e não consulta nem altera", async () => { sessao = null; assert.equal((await api.GET(req())).status, 401); assert.equal((await api.POST(req("", post))).status, 401); assert.equal(consultas.length, 0); assert.equal(gerenciamentos, 0); });
  await caso("API nega usuário sem permissão de leitura", async () => { sessao = { ...ator, empresa, usuario: { ...ator.usuario, papel: "operador" } }; assert.equal((await api.GET(req())).status, 403); assert.equal((await api.POST(req("", post))).status, 403); });
  await caso("API lê somente a empresa da sessão e não expõe segredos", async () => {
    sessao = { ...ator, empresa }; const r = await api.GET(req("?q=2203&pagina=2")); assert.equal(r.status, 200); assert.deepEqual(consultas[0], [a, "2203", 2, true]);
    assert.match(r.headers.get("cache-control"), /no-store/); assert.doesNotMatch(JSON.stringify(await r.json()), /senha|token|DATABASE_URL/i);
  });
  for (const params of ["?empresaId=outra", "?url=https://exemplo.invalid", "?pagina=0", "?pagina=2001", `?q=${"a".repeat(81)}`]) await caso("API recusa parâmetros fora do contrato", async () => assert.equal((await api.GET(req(params))).status, 400));
  await caso("POST exige origem, cabeçalho da tela e sem query string", async () => {
    assert.equal((await api.POST(req("", { method: "POST" }))).status, 403);
    assert.equal((await api.POST(req("", { ...post, headers: { ...post.headers, Origin: "https://outro.invalid" } }))).status, 403);
    assert.equal((await api.POST(req("?x=1", post))).status, 400);
    assert.equal(gerenciamentos, 0);
  });
  await caso("POST recusa URL, empresa, catálogo externo e payload grande", async () => {
    assert.equal((await api.POST(req("", { ...post, body: JSON.stringify({ operacao: "upsert", url: "https://outro.invalid", empresaId: b }) }))).status, 400);
    assert.equal((await api.POST(req("", { ...post, body: JSON.stringify({ operacao: "upsert", registro: { cest: "0300200", url: "x" } }) }))).status, 400);
    assert.equal((await api.POST(req("", { ...post, body: "x".repeat(8193) }))).status, 413);
    assert.equal(gerenciamentos, 0);
  });
  await caso("POST válido altera a referência com contexto autenticado; erro vira status mapeado", async () => {
    assert.equal((await api.POST(req("", { ...post, body: JSON.stringify({ operacao: "upsert", registro: { cest: "0300200", descricao: "Cervejas de malte" } }) }))).status, 200);
    assert.equal(gerenciamentos, 1);
    assert.equal((await api.POST(req("", { ...post, body: JSON.stringify({ operacao: "ruim" }) }))).status, 400);
  });

  if (process.argv.includes("--http")) {
    const porta = Number(process.env.PORTA || 3000); assert.ok(Number.isInteger(porta) && porta > 0 && porta <= 65535);
    const base = `http://127.0.0.1:${porta}`;
    const fallback = fs.readFileSync("src/lib/session.ts", "utf8").match(/process\.env\.AUTH_SECRET\s*\|\|\s*["']([^"']+)["']/)?.[1];
    const segredo = process.env.AUTH_SECRET || env.AUTH_SECRET || fallback; assert.ok(segredo, "Chave local de sessão não identificada");
    const [demo] = await db.select().from(s.usuarios).where(eq(s.usuarios.email, "demo@nkway.com.br")).limit(1);
    const [emp] = await db.select().from(s.empresas).where(eq(s.empresas.id, demo.empresaId)).limit(1);
    assert.ok(demo && emp, "Seed demo ausente; rode build_and_start antes do --http");
    const payload = Buffer.from(JSON.stringify({ empresaId: emp.id, usuarioId: demo.id, iat: Date.now() })).toString("base64url");
    const cookie = `nkway.sessao=${payload}.${createHmac("sha256", segredo).update(payload).digest("base64url")}`;
    await caso("HTTP local: rota exige sessão", async () => {
      assert.equal((await fetch(`${base}/api/fiscal/cest?q=2203`)).status, 401);
      assert.equal((await fetch(`${base}/api/fiscal/cest`, { method: "POST" })).status, 401);
    });
    await caso("HTTP local: consulta autenticada retorna contrato sem segredos", async () => {
      const r = await fetch(`${base}/api/fiscal/cest?q=2203&pagina=1`, { headers: { Cookie: cookie } });
      assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.dados.catalogo.fonte, "Referência local da empresa");
      assert.match(r.headers.get("cache-control"), /no-store/);
      assert.doesNotMatch(JSON.stringify(j), /senha|token|DATABASE_URL/i);
    });
    await caso("HTTP local: POST sem cabeçalho da tela é 403", async () => {
      const r = await fetch(`${base}/api/fiscal/cest`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(r.status, 403);
    });
  }
} finally {
  await db.delete(s.usuarios).where(inArray(s.usuarios.id, [ua, ub, uop]));
  await db.delete(s.empresas).where(inArray(s.empresas.id, [a, b]));
  assert.deepEqual(await protegido(), antes, "Produtos, vendas, movimentos ou parâmetros preexistentes foram alterados");
  await pool.end();
}

console.log(`NKWAY CEST etapa 2: ${passou} cenários aprovados${process.argv.includes("--http") ? " (inclui HTTP local)" : " (sem HTTP)"}. Referência local; nenhuma fonte derivada de terceiro foi apresentada como oficial; nenhuma emissão real.`);
