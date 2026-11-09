#!/usr/bin/env node
/** NCM etapa 1. Fixtures + respostas simuladas. Banco/HTTP exclusivamente locais; limpa empresas temporárias. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import ts from "typescript";
import dotenv from "dotenv";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, inArray, sql } from "drizzle-orm";

const require = createRequire(import.meta.url);
const memo = new Map();
let db, sessao = null, falharAuditoria = false, falharRevalidacao = false;
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
    if (nome === "next/cache") return { revalidatePath: () => { if (falharRevalidacao) throw new Error("Falha simulada de revalidação"); } };
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
const lib = carregar("src/lib/ncm.ts");
const fonte = carregar("src/server/ncmFonte.ts");
const bruto = JSON.parse(fs.readFileSync("scripts/fixtures/ncm.json", "utf8"));
const pequeno = lib.validarCatalogoNcm(bruto);
let passou = 0;
async function caso(nome, executar) {
  try { await executar(); passou++; console.log(`  ok ${nome}`); }
  catch (e) {
    const detalhe = String(e?.cause?.message || e?.message || "falha").replace(/postgres(?:ql)?:\/\/\S+/gi, "[conexão oculta]").slice(0, 600);
    console.error(`FALHA ${nome}: ${detalhe}`); throw new Error(`Cenário reprovado: ${nome}`);
  }
}
const rejeita = (fn, codigo) => assert.rejects(fn, (e) => e instanceof lib.ErroNcm && (!codigo || e.codigo === codigo));
const resposta = (obj) => new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });

// Verificação OPCIONAL, separada do smoke/build: consulta somente a fonte pública, sem banco ou credenciais.
if (process.argv.includes("--fonte-real")) {
  const catalogo = await fonte.baixarNcmOficial(); lib.conferirIntegridadeNcm(catalogo);
  console.log(JSON.stringify({ fonte: lib.FONTE_NCM, consultaEm: new Date().toISOString(), referenciaDeclarada: catalogo.referenciaFonte, registros: catalogo.registros.length, codigosCompletos: catalogo.totalCodigos, ato: catalogo.ato }, null, 2));
  process.exit(0);
}

await caso("NCM com zero inicial e pontuação permanece string de oito dígitos", () => {
  assert.equal(lib.codigoNcmDigitado("0101.21.00"), "01012100"); assert.equal(lib.codigoNcmDigitado(1012100), null);
  assert.equal(lib.codigoNcmDigitado("0101"), null); assert.equal(lib.codigoNcmDigitado("010121001"), null);
});
await caso("parser preserva hierarquia sem torná-la selecionável", () => {
  assert.equal(pequeno.totalCodigos, 4); assert.equal(pequeno.registros.length, 10);
  assert.equal(lib.selecionavelNcm(pequeno.registros.find((x) => x.codigo === "0101"), "2026-11-08"), false);
  assert.equal(lib.selecionavelNcm(pequeno.registros.find((x) => x.codigo === "01012100"), "2026-11-08"), true);
});
await caso("descrição herda contexto de ancestrais e ignora acentos na busca", () => {
  const cafe = pequeno.registros.find((x) => x.codigo === "09012100");
  assert.ok(cafe.busca.includes("cafe torrado")); assert.ok(cafe.caminho.includes("Café"));
  assert.deepEqual(lib.termosConsultaNcm(" CAFÉ torrado ").termos, ["cafe", "torrado"]);
  assert.equal(lib.termosConsultaNcm("0101.21").codigo, "010121");
});
await caso("referência, vigência individual e coleta não são confundidas", () => {
  assert.equal(pequeno.referencia, "2026-11-08"); assert.equal(pequeno.referenciaFonte, "Vigente em 08/11/2026");
  assert.equal(pequeno.registros[0].inicio, "2022-04-01"); assert.ok(!Object.hasOwn(pequeno, "coletadoEm"));
});
for (const [nome, mudar] of [
  ["envelope vazio", () => ({})], ["array na raiz", () => []], ["sem referência", (x) => { delete x.Data_Ultima_Atualizacao_NCM; return x; }],
  ["código numérico", (x) => { x.Nomenclaturas[3].Codigo = 1012100; return x; }],
  ["duplicidade normalizada", (x) => { x.Nomenclaturas.push({ ...x.Nomenclaturas[3], Codigo: "01012100" }); return x; }],
  ["descrição inválida", (x) => { x.Nomenclaturas[3].Descricao = null; return x; }],
  ["data impossível", (x) => { x.Nomenclaturas[3].Data_Inicio = "31/02/2022"; return x; }],
  ["código futuro", (x) => { x.Nomenclaturas[3].Data_Inicio = "01/01/2030"; return x; }],
  ["código expirado", (x) => { x.Nomenclaturas[3].Data_Fim = "01/01/2023"; return x; }],
  ["sem códigos completos", (x) => { x.Nomenclaturas = x.Nomenclaturas.filter((r) => r.Codigo.replaceAll(".", "").length < 8); return x; }],
  ["código genérico", (x) => { x.Nomenclaturas[3].Codigo = "00000000"; return x; }],
  ["descrição excessiva", (x) => { x.Nomenclaturas[3].Descricao = "a".repeat(2001); return x; }],
]) await caso(`catálogo com ${nome} é recusado integralmente`, () => assert.throws(() => lib.validarCatalogoNcm(mudar(structuredClone(bruto))), lib.ErroNcm));
await caso("ênfase da fonte vira texto, não HTML executável", () => {
  const b = structuredClone(bruto); b.Nomenclaturas[3].Descricao = "<i>Descrição</i> sintética";
  assert.equal(lib.validarCatalogoNcm(b).registros.find((x) => x.codigo === "01012100").descricao, "Descrição sintética");
});
await caso("cache ausente, vencido, referência velha e relógio inválido são sinalizados", () => {
  const agora = new Date("2026-11-08T12:00:00Z");
  assert.equal(lib.estadoCatalogoNcm(null, null, agora), "ausente");
  assert.equal(lib.estadoCatalogoNcm(new Date("2026-11-08T11:00:00Z"), "2026-11-08", agora), "atual");
  assert.equal(lib.estadoCatalogoNcm(new Date("2026-11-07T10:00:00Z"), "2026-11-08", agora), "desatualizado");
  assert.equal(lib.estadoCatalogoNcm(new Date("2026-11-08T11:00:00Z"), "2026-10-01", agora), "desatualizado");
  assert.equal(lib.estadoCatalogoNcm(new Date("2026-11-09T11:00:00Z"), "2026-11-08", agora), "desatualizado");
  assert.equal(lib.estadoCatalogoNcm(new Date(NaN), "2026-11-08", agora), "desatualizado");
  assert.equal(lib.estadoCatalogoNcm(new Date("2026-11-08T11:00:00Z"), "2026-11-07", agora), "desatualizado");
});
await caso("fonte fixa e redirecionamento público restrito", async () => {
  const urls = []; const r = await fonte.baixarNcmOficial(async (url, opcoes) => {
    urls.push(url); assert.equal(opcoes.redirect, "manual"); assert.equal(opcoes.cache, "no-store"); assert.ok(!opcoes.headers.Authorization);
    return urls.length === 1 ? new Response(null, { status: 307, headers: { location: `${lib.URL_NCM}?perfil=publico` } }) : resposta(bruto);
  });
  assert.equal(r.totalCodigos, 4); assert.deepEqual(urls, [lib.URL_NCM, `${lib.URL_NCM}?perfil=publico`]);
});
await caso("redirecionamento PUBLICO observado na fonte real é aceito sem abrir outros destinos", async () => {
  let chamadas = 0;
  const r = await fonte.baixarNcmOficial(async (url) => {
    chamadas++;
    if (chamadas === 1) return new Response(null, { status: 307, headers: { location: `${lib.URL_NCM}?perfil=PUBLICO` } });
    assert.equal(url, `${lib.URL_NCM}?perfil=PUBLICO`); return resposta(bruto);
  });
  assert.equal(r.totalCodigos, 4); assert.equal(chamadas, 2);
});
for (const url of ["http://127.0.0.1/", "https://exemplo.invalid/", `${lib.URL_NCM}?url=outro`, "https://usuario:senha@portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json"]) {
  await caso("redirecionamento fora da lista é bloqueado", async () => {
    assert.equal(fonte.redirecionamentoNcmPermitido(url), false);
    await rejeita(() => fonte.baixarNcmOficial(async () => new Response(null, { status: 302, headers: { location: url } })), "fonte_indisponivel");
  });
}
await caso("fonte fora do ar não vira catálogo", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response("indisponível", { status: 503 })), "fonte_indisponivel"));
await caso("HTML com HTTP 200 não vira catálogo", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response("<html>proteção</html>", { headers: { "content-type": "text/html" } })), "resposta_invalida"));
await caso("JSON truncado não vira catálogo", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response('{"Nomenclaturas":[')), "resposta_invalida"));
await caso("UTF-8 inválido é recusado", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response(new Uint8Array([0xff, 0xfe, 0xff]))), "resposta_invalida"));
await caso("limite de resposta é aplicado pelo cabeçalho", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response("{}", { headers: { "content-length": String(lib.NCM_MAX_BYTES + 1) } })), "tamanho_excedido"));
await caso("limite de resposta também vale sem Content-Length", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response(new Uint8Array(lib.NCM_MAX_BYTES + 1))), "tamanho_excedido"));
await caso("timeout limita inclusive um fetch que não conclui", () => rejeita(() => fonte.baixarNcmOficial(() => new Promise(() => {}), 15), "tempo_esgotado"));
await caso("loop de redirecionamento tem limite", () => rejeita(() => fonte.baixarNcmOficial(async () => new Response(null, { status: 307, headers: { location: lib.URL_NCM } })), "fonte_indisponivel"));
await caso("amostra pequena não pode substituir catálogo íntegro", () => assert.throws(() => lib.conferirIntegridadeNcm(pequeno), (e) => e.codigo === "integridade"));

// Unidade dos handlers da interface, sem dependência adicional ou automação de navegador.
function interfaceTeste({ itens, disabled = false, estado = "atual" } = {}) {
  const estadoLocal = [true, "", 1, 0, {
    catalogo: { estado, referenciaFonte: "Vigente em 08/11/2026", ato: "Fixture", coletadoEm: null, erro: null, atualizando: false },
    hoje: "2026-11-08", podeAtualizar: true, pagina: 1, porPagina: 20, total: 1,
    itens: itens || [pequeno.registros.find((r) => r.codigo === "01012100")], grupos: [pequeno.registros.find((r) => r.codigo === "0101")],
  }, false, false, "", ""];
  let indice = 0; const saidas = []; const elementos = [];
  const jsx = (type, props) => ({ type, props });
  const modulo = compilar("src/components/ConsultaNcm.tsx", {
    react: { useId: () => "teste-ncm", useRef: (inicial) => ({ current: inicial }), useEffect: () => {}, useState: (inicial) => { const i = indice++; return [i in estadoLocal ? estadoLocal[i] : inicial, (v) => { estadoLocal[i] = typeof v === "function" ? v(estadoLocal[i]) : v; }]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "@/components/ui": { Badge: "span", Button: "button", cn: (...v) => v.filter(Boolean).join(" ") },
  });
  const arvore = modulo.ConsultaNcm({ valor: "00000000", aoMudar: (v) => saidas.push(v), podeAtualizar: true, disabled });
  const visitar = (n) => { if (Array.isArray(n)) n.forEach(visitar); else if (n && typeof n === "object" && n.props) { elementos.push(n); visitar(n.props.children); } }; visitar(arvore);
  return { estadoLocal, saidas, elementos };
}
await caso("seleção explícita modifica somente o NCM do rascunho", () => {
  const h = interfaceTeste(); const item = h.elementos.find((n) => n.type === "button" && typeof n.props.ref === "function"); item.props.onClick();
  assert.deepEqual(h.saidas, ["01012100"]); assert.ok(h.estadoLocal[8].includes("não houve alteração de CEST"));
});
await caso("navegar em um grupo não seleciona NCM", () => {
  const h = interfaceTeste(); const grupo = h.elementos.find((n) => n.type === "button" && !n.props.ref && Array.isArray(n.props.children) && n.props.children[0]?.props?.children === "0101");
  assert.ok(grupo); grupo.props.onClick(); assert.equal(h.estadoLocal[1], "0101"); assert.equal(h.saidas.length, 0);
});
await caso("hierarquia e interface bloqueada não permitem seleção", () => {
  for (const op of [{ itens: [pequeno.registros[0]] }, { disabled: true }]) {
    const h = interfaceTeste(op); h.elementos.find((n) => n.type === "button" && typeof n.props.ref === "function").props.onClick(); assert.equal(h.saidas.length, 0);
  }
});
await caso("cache vencido é apresentado como referência manual", () => {
  const h = interfaceTeste({ estado: "desatualizado" }); h.elementos.find((n) => n.type === "button" && typeof n.props.ref === "function").props.onClick();
  assert.ok(h.estadoLocal[8].includes("referência manual desatualizada"));
});
await caso("setas e Escape navegam e devolvem foco sem alterar produto", () => {
  const h = interfaceTeste(); let foco = "", propagacao = false;
  const busca = h.elementos.find((n) => n.type === "input" && n.props.type === "search"); busca.props.ref.current = { focus: () => { foco = "busca"; } };
  const abertura = h.elementos.find((n) => n.type === "button" && n.props["aria-controls"]); abertura.props.ref.current = { focus: () => { foco = "abertura"; } };
  const item = h.elementos.find((n) => n.type === "button" && typeof n.props.ref === "function"); item.props.ref({ disabled: false, focus: () => { foco = "item"; } });
  const evento = (key) => ({ key, preventDefault() {}, stopPropagation() { propagacao = true; } });
  busca.props.onKeyDown(evento("ArrowDown")); assert.equal(foco, "item"); item.props.onKeyDown(evento("ArrowUp")); assert.equal(foco, "busca");
  item.props.onKeyDown(evento("Escape")); assert.equal(foco, "abertura"); assert.equal(h.estadoLocal[0], false); assert.equal(propagacao, true); assert.equal(h.saidas.length, 0);
});

const env = dotenv.parse(fs.readFileSync(".env", "utf8"));
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(dbUrl && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(dbUrl).hostname), "Testes de banco bloqueados fora do ambiente local.");
const pool = new pg.Pool({ connectionString: dbUrl }); db = drizzle(pool);
const s = carregar("src/db/schema.ts"); const core = carregar("src/server/ncmCore.ts"); const acoes = carregar("src/server/acoes/cadastros.ts");
const a = randomUUID(), b = randomUUID(), ua = randomUUID(), ub = randomUUID(), uop = randomUUID();
const ids = [a, b]; const ator = { empresaId: a, usuario: { id: ua, nome: "Admin fixture NCM", papel: "administrador" } };
const grandeBruto = structuredClone(bruto); grandeBruto.Data_Ultima_Atualizacao_NCM = `Vigente em ${lib.dataNcmBR(lib.hojeNcm())}`;
const codigos = new Set(grandeBruto.Nomenclaturas.map((r) => r.Codigo.replaceAll(".", "")));
for (let cap = 1; cap <= 50; cap++) {
  const prefixo = String(cap).padStart(2, "0");
  for (const codigo of [prefixo, ...Array.from({ length: 100 }, (_, i) => `${prefixo}01${String(i).padStart(4, "0")}`)]) if (!codigos.has(codigo)) {
    codigos.add(codigo); grandeBruto.Nomenclaturas.push({ Codigo: codigo, Descricao: `Fixture sintética ${codigo}`, Data_Inicio: "01/04/2022", Data_Fim: "31/12/9999", Tipo_Ato_Ini: "Teste", Numero_Ato_Ini: "1", Ano_Ato_Ini: "2022" });
  }
}
const grande = lib.validarCatalogoNcm(grandeBruto); const nova = structuredClone(grande); nova.ato = "Outra fixture sintética, sem validade fiscal";
const cache = async (id = a) => (await db.select().from(s.catalogosNcm).where(eq(s.catalogosNcm.empresaId, id)))[0];
const imagem = async () => (await db.execute(sql`select hash, referencia, coletado_em, md5(registros::text) as registros from nk_catalogo_ncm where empresa_id = ${a}`)).rows[0];
const vencer = async () => db.update(s.catalogosNcm).set({ coletadoEm: new Date(Date.now() - 25 * 3600000), leaseId: null, leaseAte: null, repetirApos: null }).where(eq(s.catalogosNcm.empresaId, a));
async function esperarLease(diferente = null) { for (let i = 0; i < 100; i++) { const r = await db.select({ lease: s.catalogosNcm.leaseId }).from(s.catalogosNcm).where(eq(s.catalogosNcm.empresaId, a)); if (r[0]?.lease && r[0].lease !== diferente) return r[0].lease; await new Promise((r) => setTimeout(r, 10)); } throw new Error("Lease não adquirida no prazo de teste"); }
const protegido = async () => {
  const hashes = {}; for (const tabela of ["nk_produto", "nk_venda", "nk_venda_item", "nk_movimento", "nk_fiscal_parametro", "nk_produto_tributacao"]) {
    hashes[tabela] = (await db.execute(sql`select md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id)::text,'[]')) as hash from ${sql.identifier(tabela)} t`)).rows[0].hash;
  } return hashes;
};
const antes = await protegido();
try {
  await db.insert(s.empresas).values(ids.map((id, i) => ({ id, nome: `Fixture NCM ${i}`, cnpj: "00000000000000", plano: "loja_mais" })));
  await db.insert(s.usuarios).values([[ua, a, "administrador"], [ub, b, "administrador"], [uop, a, "operador"]].map(([id, empresaId, papel]) => ({ id, empresaId, nome: "Usuário fixture", email: `${id}@teste.invalid`, senhaHash: "fixture-nao-usavel", papel, ativo: true })));
  const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, a)); sessao = { ...ator, empresa };
  await caso("migração local é aditiva e idempotente", async () => { const ddl = fs.readFileSync("supabase/migrations/20261108_catalogo_ncm.sql", "utf8"); assert.doesNotMatch(ddl.replace(/--[^\n]*/g, ""), /\b(?:drop|truncate|alter table|update nk_produto)\b/i); await db.execute(sql.raw(ddl)); await db.execute(sql.raw(ddl)); });
  await caso("consulta sem cache não grava nem faz download", async () => { const r = await core.consultarNcm(a, "cafe"); assert.equal(r.catalogo.estado, "ausente"); assert.equal(r.total, 0); assert.equal(await cache(), undefined); });
  await caso("atualização exige permissão mesmo no núcleo servidor", async () => { await assert.rejects(() => core.atualizarNcm({ ...ator, usuario: { ...ator.usuario, papel: "operador" } }, async () => grande), /Acesso negado/); assert.equal(await cache(), undefined); });
  await caso("catálogo íntegro e auditoria são gravados juntos", async () => {
    assert.equal((await core.atualizarNcm(ator, async () => grande)).estado, "atualizado");
    const c = await cache(); assert.equal(c.totalCodigos, grande.totalCodigos); assert.equal(c.leaseId, null);
    const logs = await db.select().from(s.auditorias).where(and(eq(s.auditorias.empresaId, a), eq(s.auditorias.acao, "fiscal.ncm_coletar"))); assert.equal(logs.length, 1); assert.equal(logs[0].alteracoes.produtosAlterados, 0);
  });
  await caso("cache recente é idempotente e evita nova chamada externa", async () => { let chamadas = 0; const foto = await imagem(); assert.equal((await core.atualizarNcm(ator, async () => { chamadas++; return nova; })).estado, "reutilizado"); assert.equal(chamadas, 0); assert.deepEqual(await imagem(), foto); });
  await caso("mudança da referência diária permite coleta antes de 24 horas", async () => {
    const ontem = new Date(`${lib.hojeNcm()}T12:00:00Z`); ontem.setUTCDate(ontem.getUTCDate() - 1);
    await db.update(s.catalogosNcm).set({ referencia: ontem.toISOString().slice(0, 10) }).where(eq(s.catalogosNcm.empresaId, a));
    assert.equal((await core.consultarNcm(a, "01012100")).catalogo.estado, "desatualizado");
    let chamadas = 0; const r = await core.atualizarNcm(ator, async () => { chamadas++; return grande; });
    assert.equal(r.estado, "atualizado"); assert.equal(chamadas, 1);
  });
  await caso("busca SQL preserva zero, pontuação, descrição e ancestrais", async () => {
    const r = await core.consultarNcm(a, "0101.21.00"); assert.equal(r.itens[0].codigo, "01012100"); assert.equal(r.total, 1);
    const cafe = await core.consultarNcm(a, "cafe torrado"); assert.equal(cafe.total, 2); assert.ok(cafe.itens.every((x) => x.caminho.includes("Café")));
    assert.equal(Object.hasOwn(r.itens[0], "busca"), false);
  });
  await caso("limite, paginação e navegação não oferecem grupos como código", async () => {
    const r = await core.consultarNcm(a, "01"); const p2 = await core.consultarNcm(a, "01", 2);
    assert.equal(r.itens.length, 20); assert.equal(p2.itens.length, 20); assert.notEqual(r.itens[0].codigo, p2.itens[0].codigo);
    assert.ok(r.itens.every((x) => x.codigo.length === 8)); assert.ok(r.grupos.every((x) => x.codigo.length < 8));
    await assert.rejects(() => core.consultarNcm(a, "a".repeat(81))); await assert.rejects(() => core.consultarNcm(a, "", 2001));
  });
  await caso("busca é parametrizada e empresa sem cache não lê a outra", async () => {
    const texto = "' OR 1=1 --"; const termos = lib.termosConsultaNcm(texto).termos;
    const esperado = grande.registros.filter((r) => r.codigo.length === 8 && termos.every((t) => r.busca.includes(t))).length;
    const resultado = await core.consultarNcm(a, texto); assert.equal(resultado.total, esperado); assert.ok(resultado.total < grande.totalCodigos);
    assert.equal((await core.consultarNcm(b, "01012100")).catalogo.estado, "ausente");
  });
  for (const [nome, baixar] of [
    ["fonte fora do ar", () => fonte.baixarNcmOficial(async () => new Response("erro", { status: 503 }))],
    ["JSON inválido", () => fonte.baixarNcmOficial(async () => new Response("{incompleto"))],
    ["timeout", () => fonte.baixarNcmOficial(() => new Promise(() => {}), 15)],
    ["catálogo incompleto", async () => pequeno],
    ["regressão da referência", async () => ({ ...grande, referencia: "2022-04-01" })],
  ]) await caso(`falha por ${nome} preserva registros, hash e última coleta`, async () => { await vencer(); const foto = await imagem(); assert.equal((await core.atualizarNcm(ator, baixar)).estado, "falha"); assert.deepEqual(await imagem(), foto); assert.ok((await cache()).erro); });
  await caso("falhas têm recuo persistente de quinze minutos", async () => { let chamadas = 0; assert.equal((await core.atualizarNcm(ator, async () => { chamadas++; return grande; })).estado, "aguardar"); assert.equal(chamadas, 0); });
  await caso("cache vencido permanece consultável com alerta", async () => { const r = await core.consultarNcm(a, "01012100"); assert.equal(r.catalogo.estado, "desatualizado"); assert.equal(r.itens.length, 1); assert.ok(r.catalogo.erro); });
  await caso("referência antiga não é confundida com coleta recente", async () => {
    const antigo = structuredClone(grande); antigo.referencia = "2022-04-01"; antigo.referenciaFonte = "Vigente em 01/04/2022";
    await core.atualizarNcm({ empresaId: b, usuario: { ...ator.usuario, id: ub } }, async () => antigo);
    const r = await core.consultarNcm(b, "01012100"); assert.equal(r.catalogo.estado, "desatualizado"); assert.notEqual(r.catalogo.coletadoEm.slice(0, 10), r.catalogo.referencia);
  });
  await caso("fonte com referência defasada também respeita recuo entre tentativas", async () => {
    let chamadas = 0; const r = await core.atualizarNcm({ empresaId: b, usuario: { ...ator.usuario, id: ub } }, async () => { chamadas++; return grande; });
    assert.equal(r.estado, "aguardar"); assert.equal(chamadas, 0);
  });
  await caso("dois workers compartilham uma única concessão persistente", async () => {
    await vencer(); let liberar; let chamadas = 0; const espera = new Promise((r) => { liberar = r; });
    const primeira = core.atualizarNcm(ator, async () => { chamadas++; return espera; }); await esperarLease();
    const segunda = await core.atualizarNcm(ator, async () => { chamadas++; return nova; }); assert.equal(segunda.estado, "em_atualizacao");
    liberar(grande); assert.equal((await primeira).estado, "atualizado"); assert.equal(chamadas, 1);
  });
  await caso("lease expirada pode ser retomada; resposta antiga não sobrescreve a nova", async () => {
    await vencer(); let liberar; const espera = new Promise((r) => { liberar = r; }); const primeira = core.atualizarNcm(ator, async () => espera); const antiga = await esperarLease();
    await db.update(s.catalogosNcm).set({ leaseAte: new Date(Date.now() - 1000) }).where(eq(s.catalogosNcm.empresaId, a));
    assert.equal((await core.atualizarNcm(ator, async () => nova)).estado, "atualizado"); const foto = await imagem();
    liberar(grande); assert.equal((await primeira).estado, "em_atualizacao"); assert.deepEqual(await imagem(), foto); assert.notEqual((await cache()).leaseId, antiga);
  });
  await caso("erro de um worker antigo não limpa a concessão do novo", async () => {
    await vencer(); let recusar, liberar; const primeira = core.atualizarNcm(ator, () => new Promise((_, reject) => { recusar = reject; })); const velha = await esperarLease();
    await db.update(s.catalogosNcm).set({ leaseAte: new Date(Date.now() - 1000) }).where(eq(s.catalogosNcm.empresaId, a));
    const segunda = core.atualizarNcm(ator, () => new Promise((resolve) => { liberar = resolve; })); const atual = await esperarLease(velha);
    recusar(new lib.ErroNcm("fonte_indisponivel")); await primeira; assert.equal((await cache()).leaseId, atual); liberar(grande); assert.equal((await segunda).estado, "atualizado");
  });
  await caso("falha de auditoria reverte toda a substituição do catálogo", async () => {
    await vencer(); const foto = await imagem(); falharAuditoria = true;
    try { assert.equal((await core.atualizarNcm(ator, async () => nova)).estado, "falha"); } finally { falharAuditoria = false; }
    assert.deepEqual(await imagem(), foto);
  });
  await caso("quedas abruptas de quantidade exigem revisão", () => assert.throws(() => lib.conferirIntegridadeNcm(grande, { referencia: grande.referencia, totalCodigos: grande.totalCodigos * 2 }), (e) => e.codigo === "integridade"));

  const entrada = { nome: "Produto fixture NCM", sku: "FX-NCM", gtin: "SEM GTIN", categoria: "Fixture", marca: "", unidade: "UN", custo: 5, preco: 10, estoque: 3, estoqueMin: 1, pesavel: false, ativo: true, ncm: "0101.21.00", cfop: "5102", csosn: "102", icmsAliq: 7 };
  let produtoId;
  await caso("produto sem perfil é criado com zero inicial e auditoria honesta", async () => {
    const r = await acoes.salvarProduto(entrada); assert.equal(r.ok, true); produtoId = r.id;
    const [p] = await db.select().from(s.produtos).where(eq(s.produtos.id, produtoId)); assert.equal(p.ncm, "01012100"); assert.equal(p.estoque, 3); assert.equal(p.icmsAliq, 7);
    const [log] = await db.select().from(s.auditorias).where(and(eq(s.auditorias.registroId, produtoId), eq(s.auditorias.acao, "produto.ncm_informado"))); assert.equal(log.alteracoes.validacaoOficial, false); assert.equal(log.alteracoes.modo, "informado_pelo_usuario");
    assert.equal((await db.select().from(s.produtoTributacoes).where(eq(s.produtoTributacoes.produtoId, produtoId))).length, 0);
  });
  const perfilId = randomUUID(); await db.insert(s.parametrosFiscais).values({ id: perfilId, empresaId: a, tipo: "perfil", nome: "Perfil fixture preservado", dados: { ncm: "99999999", cest: "7654321", icmsAliq: "18" } });
  await db.insert(s.produtoTributacoes).values({ empresaId: a, produtoId, perfilId, dados: { ncm: "01012100", cest: "1234567", tipoIcms: "csosn", csosn: "102", cstIbsCbs: "000", classTrib: "000001" } });
  await db.update(s.produtos).set({ cest: "1234567", pisAliq: 1.65, cofinsAliq: 7.6, ibsAliq: 0.2, cbsAliq: 1 }).where(eq(s.produtos.id, produtoId));
  await caso("editar NCM não aplica perfil nem altera CEST, CFOP ou tributos", async () => {
    const [complemento] = await db.select().from(s.produtoTributacoes).where(eq(s.produtoTributacoes.produtoId, produtoId));
    assert.equal((await acoes.salvarProduto({ ...entrada, id: produtoId, ncm: "0901.21.00" })).ok, true);
    const [p] = await db.select().from(s.produtos).where(eq(s.produtos.id, produtoId)); assert.equal(p.ncm, "09012100");
    assert.deepEqual([p.cest, p.cfop, p.csosn, p.icmsAliq, p.pisAliq, p.cofinsAliq, p.ibsAliq, p.cbsAliq], ["1234567", "5102", "102", 7, 1.65, 7.6, 0.2, 1]);
    assert.deepEqual((await db.select().from(s.produtoTributacoes).where(eq(s.produtoTributacoes.produtoId, produtoId)))[0], complemento);
  });
  await caso("grupo digitado não é completado com zeros nem salvo", async () => { const r = await acoes.salvarProduto({ ...entrada, ncm: "0101" }); assert.equal(r.ok, false); assert.match(r.erro, /8 dígitos/); });
  await caso("código longo não é truncado nem salvo", async () => assert.equal((await acoes.salvarProduto({ ...entrada, ncm: "010121001" })).ok, false));
  await caso("cadastro manual sem referência oficial continua possível e auditado", async () => { const r = await acoes.salvarProduto({ ...entrada, ncm: "99999999", nome: "Manual fixture" }); assert.equal(r.ok, true); const [l] = await db.select().from(s.auditorias).where(eq(s.auditorias.registroId, r.id)); assert.equal(l.alteracoes.validacaoOficial, false); });
  await caso("NCM genérico permanece explicitamente não informado", async () => { const r = await acoes.salvarProduto({ ...entrada, ncm: "", nome: "Sem NCM fixture" }); assert.equal(r.ok, true); assert.match(r.aviso, /genérico/); });
  await caso("NCM legado não editado é preservado literalmente", async () => { await db.update(s.produtos).set({ ncm: "0101 " }).where(eq(s.produtos.id, produtoId)); assert.equal((await acoes.salvarProduto({ ...entrada, id: produtoId, ncm: "0101 " })).ok, true); assert.equal((await db.select().from(s.produtos).where(eq(s.produtos.id, produtoId)))[0].ncm, "0101 "); });
  await caso("usuário sem permissão não grava produto", async () => { sessao = { ...ator, empresa, usuario: { ...ator.usuario, id: uop, papel: "operador" } }; const r = await acoes.salvarProduto(entrada); assert.equal(r.ok, false); sessao = { ...ator, empresa }; });
  await caso("produto de outra empresa é preservado", async () => {
    const [p] = await db.insert(s.produtos).values({ empresaId: b, nome: "Produto estrangeiro fixture", ncm: "11111111" }).returning();
    assert.equal((await acoes.salvarProduto({ ...entrada, id: p.id })).ok, false); assert.deepEqual((await db.select().from(s.produtos).where(eq(s.produtos.id, p.id)))[0], p);
  });
  await caso("falha de auditoria reverte criação, estoque e NCM", async () => {
    const contagem = async () => (await db.select().from(s.produtos).where(eq(s.produtos.empresaId, a))).length;
    const movimentos = async () => (await db.select().from(s.movimentos).where(eq(s.movimentos.empresaId, a))).length;
    const p = await contagem(), m = await movimentos(); falharAuditoria = true;
    try { assert.equal((await acoes.salvarProduto({ ...entrada, nome: "Rollback fixture" })).ok, false); } finally { falharAuditoria = false; }
    assert.equal(await contagem(), p); assert.equal(await movimentos(), m);
  });
  await caso("falha de auditoria reverte edição e movimento de estoque", async () => {
    const [p] = await db.select().from(s.produtos).where(eq(s.produtos.id, produtoId));
    const m = (await db.select().from(s.movimentos).where(eq(s.movimentos.produtoId, produtoId))).length; falharAuditoria = true;
    try { assert.equal((await acoes.salvarProduto({ ...entrada, id: produtoId, estoque: 9, ncm: "01012900" })).ok, false); } finally { falharAuditoria = false; }
    assert.deepEqual((await db.select().from(s.produtos).where(eq(s.produtos.id, produtoId)))[0], p); assert.equal((await db.select().from(s.movimentos).where(eq(s.movimentos.produtoId, produtoId))).length, m);
  });
  await caso("revalidação de tela não produz falso rollback após commit", async () => {
    falharRevalidacao = true; let r;
    try { r = await acoes.salvarProduto({ ...entrada, nome: "Revalidação fixture" }); } finally { falharRevalidacao = false; }
    assert.equal(r.ok, true); assert.equal((await db.select().from(s.produtos).where(eq(s.produtos.id, r.id))).length, 1);
  });

  let consultas = [], atualizacoes = 0;
  const api = compilar("src/app/api/fiscal/ncm/route.ts", { "@/server/ncmCore": {
    consultarNcm: async (...args) => { consultas.push(args); return { catalogo: { estado: "ausente" } }; },
    atualizarNcm: async (c) => { assert.equal(c.empresaId, a); atualizacoes++; return { estado: "atualizado", mensagem: "Fixture" }; },
  } });
  const req = (rota = "", init = {}) => new Request(`http://localhost:3000/api/fiscal/ncm${rota}`, init);
  const post = { method: "POST", headers: { Origin: "http://localhost:3000", "X-NKWAY-NCM": "atualizar" } };
  await caso("API sem sessão é 401 e não consulta nem atualiza", async () => { sessao = null; assert.equal((await api.GET(req())).status, 401); assert.equal((await api.POST(req("", post))).status, 401); assert.equal(consultas.length, 0); assert.equal(atualizacoes, 0); });
  await caso("API nega usuário sem permissão", async () => { sessao = { ...ator, empresa, usuario: { ...ator.usuario, papel: "operador" } }; assert.equal((await api.GET(req())).status, 403); assert.equal((await api.POST(req("", post))).status, 403); });
  await caso("API usa somente empresa da sessão e não expõe segredo", async () => {
    sessao = { ...ator, empresa }; const r = await api.GET(req("?q=0101.21.00&pagina=2")); assert.equal(r.status, 200); assert.deepEqual(consultas[0], [a, "0101.21.00", 2, true]); assert.match(r.headers.get("cache-control"), /no-store/); assert.doesNotMatch(JSON.stringify(await r.json()), /senha|token|DATABASE_URL/);
  });
  for (const params of ["?empresaId=outra", "?url=https://exemplo.invalid", "?pagina=0", "?pagina=2001", `?q=${"a".repeat(81)}`]) await caso("API recusa parâmetros fora do contrato", async () => assert.equal((await api.GET(req(params))).status, 400));
  await caso("POST exige origem e cabeçalho da tela", async () => { assert.equal((await api.POST(req("", { method: "POST" }))).status, 403); assert.equal((await api.POST(req("", { ...post, headers: { ...post.headers, Origin: "https://outro.invalid" } }))).status, 403); assert.equal(atualizacoes, 0); });
  await caso("POST recusa URL, empresa, arquivo e corpo grande", async () => {
    assert.equal((await api.POST(req("?url=outra", post))).status, 400);
    assert.equal((await api.POST(req("", { ...post, body: JSON.stringify({ url: "https://outro.invalid", empresaId: b }) }))).status, 400);
    assert.equal((await api.POST(req("", { ...post, body: "x".repeat(1025) }))).status, 413); assert.equal(atualizacoes, 0);
  });
  await caso("POST permitido atualiza só o catálogo com contexto autenticado", async () => { assert.equal((await api.POST(req("", post))).status, 200); assert.equal(atualizacoes, 1); });

  if (process.argv.includes("--http")) {
    const porta = Number(process.env.PORTA || 3000); assert.ok(Number.isInteger(porta) && porta > 0 && porta <= 65535);
    const base = `http://127.0.0.1:${porta}`;
    const fallback = fs.readFileSync("src/lib/session.ts", "utf8").match(/process\.env\.AUTH_SECRET\s*\|\|\s*["']([^"']+)["']/)?.[1];
    const segredo = process.env.AUTH_SECRET || env.AUTH_SECRET || fallback; assert.ok(segredo, "Chave local de sessão não identificada");
    function cookie(empresaId, usuarioId) { const p = Buffer.from(JSON.stringify({ empresaId, usuarioId, iat: Date.now() })).toString("base64url"); return `nkway.sessao=${p}.${createHmac("sha256", segredo).update(p).digest("base64url")}`; }
    const consultar = (rota, ck, init = {}) => fetch(`${base}${rota}`, { ...init, headers: { ...(ck ? { Cookie: ck } : {}), ...init.headers }, signal: AbortSignal.timeout(15000) });
    await caso("HTTP local: consulta e atualização anônimas são 401", async () => { assert.equal((await consultar("/api/fiscal/ncm")).status, 401); assert.equal((await consultar("/api/fiscal/ncm", null, { method: "POST" })).status, 401); });
    await caso("HTTP local: operador sem permissão recebe 403", async () => { assert.equal((await consultar("/api/fiscal/ncm", cookie(a, uop))).status, 403); });
    await caso("HTTP local: consulta por descrição é paginada e segura", async () => { const r = await consultar("/api/fiscal/ncm?q=cafe%20torrado", cookie(a, ua)); assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.dados.total, 2); assert.equal(j.dados.itens.length, 2); assert.doesNotMatch(JSON.stringify(j), /leaseId|senha|token|DATABASE_URL/); });
    await caso("HTTP local: caches de empresas permanecem isolados", async () => { const r = await consultar("/api/fiscal/ncm?q=01012100", cookie(b, ub)); const j = await r.json(); assert.equal(j.dados.catalogo.referencia, "2022-04-01"); assert.equal((await consultar(`/api/fiscal/ncm?empresaId=${b}`, cookie(a, ua))).status, 400); });
    await caso("HTTP local: POST com URL arbitrária é recusado sem consultar fonte", async () => { const r = await consultar("/api/fiscal/ncm", cookie(a, ua), { method: "POST", headers: { Origin: base, "X-NKWAY-NCM": "atualizar" }, body: JSON.stringify({ url: "https://exemplo.invalid" }) }); assert.equal(r.status, 400); });
    await caso("HTTP local: formulário de produtos preservado", async () => { const r = await consultar("/produtos", cookie(a, ua)); assert.equal(r.status, 200); assert.ok((await r.text()).includes("Tributação fiscal")); });
  }
} finally {
  falharAuditoria = false; falharRevalidacao = false;
  try { await db.delete(s.empresas).where(inArray(s.empresas.id, ids)); assert.deepEqual(await protegido(), antes, "Produtos, notas/XMLs, movimentos ou parâmetros preexistentes foram alterados"); }
  finally { await pool.end(); }
}
await caso("dados legados e notas/XMLs anteriores permanecem idênticos", () => {});
console.log(`NKWAY NCM etapa 1: ${passou} cenários aprovados${process.argv.includes("--http") ? " (inclui HTTP local)" : " (sem HTTP)"}. Nenhum teste de emissão real.`);
