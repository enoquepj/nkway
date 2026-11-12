#!/usr/bin/env node
/** Etapa 1 PDV/impressão: config pura, sanitização, vias, confissão, recibo com cancelados/desconto e persistência por empresa. */
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { randomUUID } from "node:crypto";
import ts from "typescript"; import dotenv from "dotenv"; import pg from "pg"; import { drizzle } from "drizzle-orm/node-postgres"; import { eq } from "drizzle-orm";
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
let passou = 0; const caso = async (nome, fn) => { try { await fn(); passou++; console.log(`  ok ${nome}`); } catch (e) { console.error(`FALHA ${nome}: ${String(e?.message ?? e).slice(0, 600)}`); process.exitCode = 1; throw e; } };
const cfg = carregar("src/lib/pdvImpressao.ts");
const op = carregar("src/lib/operacoesPdv.ts");

/* ---------------- puros: padrão e sanitização ---------------- */
await caso("padrão preserva o comportamento atual (1 via, 80mm, confirma, cabeçalho, sem logo/confissão)", () => {
  const p = cfg.PDV_IMPRESSAO_PADRAO;
  assert.equal(p.nroVias, 1); assert.equal(p.layoutCupom, "80mm"); assert.equal(p.confirmarAntesImprimir, true);
  assert.equal(p.imprimeCabecalho, true); assert.equal(p.imprimeLogo, false); assert.equal(p.confissaoDivida, false);
  assert.equal(p.imprimirUmaLinha, false); assert.equal(p.imprimirItensCancelados, false);
  assert.equal(p.imprimirDescontoAcrescimoItens, true); assert.equal(p.exibirTributos, true);
});
await caso("sanitizar: nulo/lixo volta ao padrão sem lançar", () => {
  for (const bruto of [null, undefined, 42, "x", [], { nroVias: 99, layoutCupom: "XX" }]) {
    const s = cfg.sanitizarConfigPdvImpressao(bruto);
    assert.equal(s.nroVias, 1); assert.equal(s.layoutCupom, "80mm");
  }
});
await caso("sanitizar: vias aceita só 1–3; layout só 80mm/A4; fonte só normal/grande", () => {
  assert.equal(cfg.sanitizarConfigPdvImpressao({ nroVias: 2 }).nroVias, 2);
  assert.equal(cfg.sanitizarConfigPdvImpressao({ nroVias: 3 }).nroVias, 3);
  assert.equal(cfg.sanitizarConfigPdvImpressao({ nroVias: 0 }).nroVias, 1);
  assert.equal(cfg.sanitizarConfigPdvImpressao({ layoutCupom: "A4" }).layoutCupom, "A4");
  assert.equal(cfg.sanitizarConfigPdvImpressao({ layoutCupom: "a4" }).layoutCupom, "80mm");
  assert.equal(cfg.sanitizarConfigPdvImpressao({ tamanhoFonte: "grande" }).tamanhoFonte, "grande");
  assert.equal(cfg.sanitizarConfigPdvImpressao({ tamanhoFonte: "gigante" }).tamanhoFonte, "normal");
});
await caso("sanitizar: textos são aparados e limitados (logo 40, rodapé 140, confissão 600, sem controle)", () => {
  const s = cfg.sanitizarConfigPdvImpressao({ logoTexto: "  A".repeat(50), mensagemRodape: "B".repeat(500), confissaoTexto: "CD  ok" });
  assert.ok(s.logoTexto.length <= 40); assert.ok(s.mensagemRodape.length <= 140); assert.ok(s.confissaoTexto.length <= 600);
  assert.doesNotMatch(s.confissaoTexto, / /);
  assert.ok(cfg.sanitizarConfigPdvImpressao({ confissaoTexto: "   " }).confissaoTexto.length > 20);
});
await caso("sanitizar: booleanos aceitam 1/0 e sim/não; resto volta ao padrão", () => {
  const s = cfg.sanitizarConfigPdvImpressao({ confirmarAntesImprimir: 0, imprimeLogo: 1, confissaoDivida: "sim", impressaoAutomatica: "não" });
  assert.equal(s.confirmarAntesImprimir, false); assert.equal(s.imprimeLogo, true);
  assert.equal(s.confissaoDivida, true); assert.equal(s.impressaoAutomatica, false);
});

/* ---------------- vias, logo, confissão ---------------- */
await caso("vias: 1 = sem rótulo; 2–3 = Via X de N com destino", () => {
  assert.deepEqual(cfg.rotulosViasPdv(1), [""]);
  assert.deepEqual(cfg.rotulosViasPdv(2), ["Via 1 de 2 — Consumidor", "Via 2 de 2 — Arquivo / Caixa"]);
  assert.equal(cfg.rotulosViasPdv(3)[2], "Via 3 de 3 — Contabilidade");
});
await caso("logo: iniciais de 1–2 letras, sem acento quebrado", () => {
  assert.equal(cfg.iniciaisLogoPdv("Mercado São Jorge"), "MJ");
  assert.equal(cfg.iniciaisLogoPdv("NK"), "NK");
  assert.equal(cfg.iniciaisLogoPdv(""), "NK");
});
await caso("confissão: só com config ligada + prazo/boleto + não-DAV", () => {
  const on = { ...cfg.PDV_IMPRESSAO_PADRAO, confissaoDivida: true };
  const off = { ...cfg.PDV_IMPRESSAO_PADRAO, confissaoDivida: false };
  assert.equal(cfg.deveImprimirConfissao(on, ["prazo"], "fiscal"), true);
  assert.equal(cfg.deveImprimirConfissao(on, ["boleto"], "sem_nota"), true);
  assert.equal(cfg.deveImprimirConfissao(on, ["dinheiro", "pix"], "fiscal"), false);
  assert.equal(cfg.deveImprimirConfissao(on, ["prazo"], "dav"), false);
  assert.equal(cfg.deveImprimirConfissao(off, ["prazo"], "fiscal"), false);
  assert.equal(cfg.vendaTemPrazo(["BOLETO"]), true);
});

/* ---------------- recibo: cancelados e desconto por item ---------------- */
await caso("recibo carrega desconto/acréscimo por item e cancelados sem alterar totais", () => {
  const r = op.montarReciboDeFechamentoPdv({ id: "v1", modo: "sem_nota", numeroVenda: 7, numeroNota: null, modelo: null, situacaoFiscal: "nao_emitida", chave: null, protocolo: null, clienteNome: "C", operador: "A", terminal: "T", ambiente: "2", itens: [{ nome: "X", qtd: 2, precoUnit: 10, total: 20, desconto: 1.5, acrescimo: 0.5 }], subtotal: 20, desconto: 0, total: 20, pagamentosBrutos: [{ forma: "dinheiro", valor: 20 }], troco: 0, itensCancelados: [{ nome: "Y", qtd: 1, unidade: "UN", total: 5 }] });
  assert.equal(r.itens[0].desconto, 1.5); assert.equal(r.itens[0].acrescimo, 0.5);
  assert.equal(r.itensCancelados?.length, 1); assert.equal(r.total, 20);
  const limpo = op.montarReciboDeFechamentoPdv({ id: "v2", modo: "sem_nota", numeroVenda: 8, numeroNota: null, modelo: null, situacaoFiscal: "nao_emitida", chave: null, protocolo: null, clienteNome: "C", operador: "A", terminal: "T", ambiente: "2", itens: [{ nome: "X", qtd: 1, precoUnit: 10 }], subtotal: 10, desconto: 0, total: 10, pagamentosBrutos: [], troco: 0 });
  assert.equal(limpo.itens[0].desconto, undefined); assert.equal(limpo.itensCancelados, undefined);
});
await caso("conversão p/ DANFE preserva desconto do item", () => {
  const r = op.montarReciboDeFechamentoPdv({ id: "v3", modo: "emitir_nfce", numeroVenda: 9, numeroNota: 9, modelo: "NFC-e", situacaoFiscal: "simulado", chave: "1".repeat(44), protocolo: "P", clienteNome: "C", operador: "A", terminal: "T", ambiente: "2", itens: [{ nome: "X", qtd: 1, precoUnit: 10, total: 10, desconto: 2 }], subtotal: 10, desconto: 0, total: 10, pagamentosBrutos: [{ forma: "pix", valor: 10 }], troco: 0 });
  const d = op.converterReciboParaDocFiscalPdv(r);
  assert.equal(d?.itens[0].desconto, 2);
});

/* ---------------- telas consomem a config ---------------- */
await caso("PDV usa pdvConfig: confirmação, vias, logo, uma linha, cancelados, confissão e Impressao com cfg", () => {
  const v = fs.readFileSync("src/views/Pdv.tsx", "utf8");
  assert.match(v, /pdvConfig\?: PdvImpressaoConfig/); assert.match(v, /modalConfirmarImpressao/);
  assert.match(v, /rotulosViasPdv\(pdvConfig\.nroVias\)/); assert.match(v, /pdvConfig\.imprimeLogo/);
  assert.match(v, /pdvConfig\.imprimirUmaLinha/); assert.match(v, /pdvConfig\.imprimirItensCancelados/);
  assert.match(v, /deveImprimirConfissao\(pdvConfig/); assert.match(v, /<Impressao alvo=\{imprimindo\}.*cfg=\{pdvConfig\}/);
  assert.match(v, /itensCanceladosCaixa/); assert.match(v, /impressaoAutomatica/);
});
await caso("Impressao respeita cfg: logo, cabeçalho, uma linha, desconto, cancelados, vias, A4 e confissão", () => {
  const v = fs.readFileSync("src/components/Impressao.tsx", "utf8");
  assert.match(v, /cfg\?: PdvImpressaoConfig/); assert.match(v, /cfg\.imprimeLogo/); assert.match(v, /cfg\.imprimeCabecalho/);
  assert.match(v, /cfg\.imprimirUmaLinha|umaLinha/); assert.match(v, /cfg\.imprimirDescontoAcrescimoItens/);
  assert.match(v, /cfg\.imprimirItensCancelados/); assert.match(v, /rotulosViasPdv\(cfg\.nroVias\)/);
  assert.match(v, /cfg\.layoutCupom !== "A4"/); assert.match(v, /deveImprimirConfissao\(cfg/);
});
await caso("Config tem aba PDV e impressão com os 10 itens + salvamento auditado", () => {
  const v = fs.readFileSync("src/views/Config.tsx", "utf8");
  assert.match(v, /id: "pdv", rotulo: "PDV e impressão"/); assert.match(v, /salvarConfigPdv\(p\)/);
  assert.match(v, /Confirmar antes de imprimir/); assert.match(v, /Nº de vias/); assert.match(v, /Confissão de dívida/);
  const a = fs.readFileSync("src/server/acoes/config.ts", "utf8");
  assert.match(a, /export async function salvarConfigPdv/); assert.match(a, /config\.pdv_impressao/);
});

/* ---------------- banco local: persistência por empresa ---------------- */
const env = dotenv.parse(fs.readFileSync(".env", "utf8")); const url = process.env.DATABASE_URL || env.DATABASE_URL;
assert.ok(url && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Testes de banco bloqueados fora do ambiente local.");
const pool = new pg.Pool({ connectionString: url }); db = drizzle(pool);
const s = carregar("src/db/schema.ts"); const dados = carregar("src/server/dados.ts"); const acoes = carregar("src/server/acoes/config.ts");
const emp = randomUUID(), adm = randomUUID();
try {
  await db.insert(s.empresas).values({ id: emp, nome: "Fixture PDV cfg", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
  await db.insert(s.usuarios).values({ id: adm, empresaId: emp, nome: "Admin PDV", email: `${adm}@t.invalid`, senhaHash: "x", papel: "administrador", ativo: true });
  const [empresa] = await db.select().from(s.empresas).where(eq(s.empresas.id, emp));
  sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Admin PDV", papel: "administrador" } };
  await caso("sem linha = padrão; salvar + ler devolve a config da empresa", async () => {
    const antes = await dados.obterConfigPdv(emp);
    assert.equal(antes.nroVias, 1);
    const r = await acoes.salvarConfigPdv({ nroVias: 2, layoutCupom: "A4", imprimeLogo: true, logoTexto: "LOJA X", confissaoDivida: true });
    assert.equal(r.ok, true);
    const depois = await dados.obterConfigPdv(emp);
    assert.equal(depois.nroVias, 2); assert.equal(depois.layoutCupom, "A4"); assert.equal(depois.imprimeLogo, true);
  });
  await caso("isolamento por empresa: outra empresa continua no padrão", async () => {
    const emp2 = randomUUID();
    await db.insert(s.empresas).values({ id: emp2, nome: "Fixture PDV cfg 2", cnpj: "00000000000000", plano: "loja_mais", regime: "simples" });
    const c2 = await dados.obterConfigPdv(emp2);
    assert.equal(c2.nroVias, 1); assert.equal(c2.layoutCupom, "80mm");
    await db.delete(s.empresas).where(eq(s.empresas.id, emp2));
  });
  await caso("permissão: operador não salva config do PDV", async () => {
    const opId = randomUUID();
    await db.insert(s.usuarios).values({ id: opId, empresaId: emp, nome: "Op", email: `${opId}@t.invalid`, senhaHash: "x", papel: "operador", ativo: true });
    sessao = { empresaId: emp, empresa, usuario: { id: opId, nome: "Op", papel: "operador" } };
    const r = await acoes.salvarConfigPdv({ nroVias: 3 });
    assert.equal(r.ok, false);
    sessao = { empresaId: emp, empresa, usuario: { id: adm, nome: "Admin PDV", papel: "administrador" } };
    const ainda = await dados.obterConfigPdv(emp);
    assert.equal(ainda.nroVias, 2);
  });
} finally {
  try { await db.delete(s.empresas).where(eq(s.empresas.id, emp)); } finally { await pool.end(); }
}
console.log(`NKWAY PDV impressão: ${passou} cenários aprovados (banco local, empresas temporárias removidas).`);