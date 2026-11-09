#!/usr/bin/env node
/** Testes de identificação: sem conexão externa, sem escrita no banco e sem ler segredos. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const ler = (arquivo) => fs.readFileSync(`${raiz}${arquivo}`, "utf8");
function carregar(arquivo, imports = {}, env = {}) {
  const { outputText } = ts.transpileModule(ler(arquivo), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: arquivo,
  });
  const modulo = { exports: {} };
  const require = (nome) => {
    assert.ok(Object.hasOwn(imports, nome), `Import inesperado: ${nome}`);
    return imports[nome];
  };
  new Function("module", "exports", "require", "process", "Response", outputText)(
    modulo, modulo.exports, require, { env }, Response,
  );
  return modulo.exports;
}

let passou = 0;
async function caso(nome, executar) {
  await executar();
  passou++;
  console.log(`  ok ${nome}`);
}
const lib = carregar("src/lib/versaoDeploy.ts");
const SHA = "a".repeat(40);
const OUTRO = "b".repeat(40);
const metadados = { vercel: "1", commit: SHA, ambiente: "production" };
const identificada = lib.identificarVersaoDeploy(metadados);
const desconhecida = lib.identificarVersaoDeploy();
const servidor = (env = {}) => carregar("src/server/versaoDeploy.ts", { "@/lib/versaoDeploy": lib }, env);
const core = servidor({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_ENV: "production" });

await caso("SHA completo normalizado; prefixo não é identidade", () => {
  assert.equal(lib.normalizarCommitDeploy(` ${SHA.toUpperCase()} `), SHA);
  assert.equal(lib.normalizarCommitDeploy(SHA.slice(0, 7)), null);
});
for (const [nome, valor] of [
  ["ausente", undefined], ["nulo", null], ["número", 123], ["objeto", {}],
  ["array", [SHA]], ["vazio", ""], ["longo", `${SHA}a`], ["não hexadecimal", "g".repeat(40)],
  ["URL", "https://exemplo.invalid/valor"], ["HTML", "<script>valor</script>"],
  ["injeção em cabeçalho", `${SHA}\r\nX-Outro: valor`], ["controle interno", `${SHA.slice(1)}\u0000`],
]) {
  await caso(`SHA ${nome} é recusado e não refletido`, () => {
    const v = lib.identificarVersaoDeploy({ ...metadados, commit: valor });
    assert.equal(v.identificado, false);
    assert.equal(v.commit, null);
    assert.equal(v.commitCurto, null);
  });
}
await caso("contrato público contém somente cinco campos permitidos", () => {
  assert.deepEqual(identificada, { identificado: true, commit: SHA, commitCurto: SHA.slice(0, 7), ambiente: "production", origem: "vercel" });
});
for (const ambiente of ["production", "preview", "development"]) {
  await caso(`ambiente conhecido ${ambiente} é preservado`, () => {
    assert.equal(lib.identificarVersaoDeploy({ ...metadados, ambiente }).ambiente, ambiente);
  });
}
for (const ambiente of [undefined, "customizado", "production\r\nX-Outro: valor", { production: true }]) {
  await caso("ambiente ausente ou fora da lista não é refletido", () => {
    assert.equal(lib.identificarVersaoDeploy({ ...metadados, ambiente }).ambiente, "desconhecido");
  });
}
await caso("sem Vercel, não inventa SHA nem ambiente de produção", () => {
  assert.deepEqual(lib.identificarVersaoDeploy({ commit: SHA, ambiente: "production" }), desconhecida);
  assert.equal(desconhecida.identificado, false);
  assert.equal(desconhecida.ambiente, "desconhecido");
});
await caso("Vercel sem SHA é identificada como origem, não como commit", () => {
  const v = lib.identificarVersaoDeploy({ vercel: "1", ambiente: "production" });
  assert.equal(v.origem, "vercel");
  assert.equal(v.identificado, false);
  assert.equal(lib.compararCommitDeploy(v, SHA), "nao_identificado");
});
await caso("NODE_ENV e metadados de outro fornecedor não provam publicação", () => {
  const v = servidor({ NODE_ENV: "production", GITHUB_SHA: SHA, COMMIT_SHA: SHA }).obterVersaoDeploy();
  assert.deepEqual(v, desconhecida);
});
await caso("servidor lê exclusivamente três metadados de sistema", () => {
  const acessadas = [];
  const env = new Proxy({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_ENV: "production" }, {
    get(alvo, chave) { assert.ok(Object.hasOwn(alvo, chave)); acessadas.push(chave); return alvo[chave]; },
  });
  assert.deepEqual(servidor(env).obterVersaoDeploy(), identificada);
  assert.deepEqual(acessadas.sort(), ["VERCEL", "VERCEL_ENV", "VERCEL_GIT_COMMIT_SHA"]);
});
await caso("segredos sintéticos nunca entram na identificação", () => {
  const v = servidor({ VERCEL: "1", VERCEL_GIT_COMMIT_SHA: SHA, VERCEL_ENV: "production", DATABASE_URL: "segredo-sintetico", AUTH_SECRET: "segredo-sintetico" }).obterVersaoDeploy();
  assert.deepEqual(v, identificada);
  assert.ok(!JSON.stringify(v).includes("segredo-sintetico"));
});
await caso("comparação exige igualdade do SHA completo", () => {
  assert.equal(lib.compararCommitDeploy(identificada, SHA.toUpperCase()), "confere");
  assert.equal(lib.compararCommitDeploy(identificada, OUTRO), "diverge");
  assert.equal(lib.compararCommitDeploy(identificada, `${SHA.slice(0, 39)}b`), "diverge");
  assert.equal(lib.compararCommitDeploy(identificada, SHA.slice(0, 7)), "invalido");
  assert.equal(lib.compararCommitDeploy(desconhecida, SHA), "nao_identificado");
});
await caso("contratos canônicos são aceitos pelo navegador", () => {
  assert.ok(lib.versaoDeployValida(identificada));
  assert.ok(lib.versaoDeployValida(desconhecida));
});
for (const alterada of [
  null, [], {}, { ...identificada, commitCurto: "outro" }, { ...identificada, identificado: false },
  { ...identificada, ambiente: "outro" }, { ...identificada, origem: "git-local" },
  { ...identificada, commit: SHA.toUpperCase() }, { ...identificada, extra: "não permitido" },
]) {
  await caso("contrato ausente, adulterado ou ampliado é recusado", () => assert.equal(lib.versaoDeployValida(alterada), false));
}
await caso("cabeçalhos não armazenam cache e usam somente valores seguros", () => {
  const h = core.cabecalhosVersaoDeploy();
  assert.equal(h["X-NKWAY-Commit"], SHA);
  assert.equal(h["X-NKWAY-Ambiente"], "production");
  assert.match(h["Cache-Control"], /no-store/);
  assert.equal(h["CDN-Cache-Control"], "no-store");
});
await caso("cabeçalhos recusam identificação adulterada", () => {
  const h = core.cabecalhosVersaoDeploy({ ...identificada, commit: "valor\r\nX:1" });
  assert.equal(h["X-NKWAY-Commit"], "nao-identificado");
  assert.equal(h["X-NKWAY-Ambiente"], "desconhecido");
});
const rotaVersao = carregar("src/app/api/versao/route.ts", { "@/server/versaoDeploy": core });
await caso("API pública identifica sem banco, sessão ou parâmetro de commit", async () => {
  const resposta = await rotaVersao.GET(new Request(`https://exemplo.invalid/api/versao?commit=${OUTRO}`));
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), identificada);
  assert.equal(resposta.headers.get("X-NKWAY-Commit"), SHA);
  assert.equal(rotaVersao.dynamic, "force-dynamic");
  assert.equal(rotaVersao.runtime, "nodejs");
});
await caso("API sem metadados é honesta, mesmo em build de produção", async () => {
  const rota = carregar("src/app/api/versao/route.ts", { "@/server/versaoDeploy": servidor({ NODE_ENV: "production" }) });
  const resposta = await rota.GET();
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), desconhecida);
});
for (const falhar of [false, true]) {
  await caso(`health preserva JSON e status ${falhar ? "500" : "200"}, com identificação`, async () => {
    let consultas = 0;
    const rota = carregar("src/app/api/health/route.ts", {
      "@/server/versaoDeploy": core,
      "@/db": { db: { execute: async () => { consultas++; if (falhar) throw new Error("Detalhe interno não público"); } } },
      "drizzle-orm": { sql: (trechos) => { assert.equal(trechos.join(""), "select 1"); return {}; } },
    });
    const resposta = await rota.GET();
    assert.equal(consultas, 1);
    assert.equal(resposta.status, falhar ? 500 : 200);
    assert.deepEqual(await resposta.json(), { ok: !falhar });
    assert.equal(resposta.headers.get("X-NKWAY-Commit"), SHA);
    assert.match(resposta.headers.get("Cache-Control"), /no-store/);
  });
}
for (const autenticado of [false, true]) {
  await caso(`prontidão ${autenticado ? "mantém tenant e inclui versão" : "continua 401 sem sessão"}`, async () => {
    let consultas = 0;
    const rota = carregar("src/app/api/prontidao/route.ts", {
      "@/server/versaoDeploy": core,
      "@/lib/session": { contexto: async () => autenticado ? { empresaId: "empresa-da-sessao", empresa: { nome: "Empresa teste" } } : null },
      "@/server/prontidaoCore": { obterProntidao: async (empresaId, empresaNome) => {
        consultas++; assert.equal(empresaId, "empresa-da-sessao");
        return { bancoConectado: true, empresaNome, geradoEm: "2026-01-01T00:00:00.000Z", resumo: {}, contagens: {}, blocos: [] };
      } },
    });
    const resposta = await rota.GET(new Request("https://exemplo.invalid/api/prontidao?empresaId=outra"));
    assert.equal(resposta.status, autenticado ? 200 : 401);
    assert.equal(consultas, autenticado ? 1 : 0);
    const dados = await resposta.json();
    if (autenticado) assert.deepEqual(dados.versao, identificada);
    else assert.equal(dados.ok, false);
  });
}
await caso("tela confere health primeiro, recusa troca de deploy e não importa servidor", () => {
  const tela = ler("src/components/IdentificacaoDeploy.tsx");
  assert.ok(tela.indexOf('fetch("/api/health"') < tela.indexOf('fetch("/api/versao"'));
  assert.match(tela, /mesmaPublicacao/);
  assert.match(tela, /Identificação não é homologação/);
  assert.match(tela, /aria-live="polite"/);
  assert.doesNotMatch(tela, /process\.env|@\/server|@\/db/);
});

if (process.argv.includes("--http")) {
  const porta = Number(process.env.PORTA || 3000);
  assert.ok(Number.isInteger(porta) && porta > 0 && porta <= 65535, "Porta local inválida");
  const base = `http://127.0.0.1:${porta}`;
  const consultar = (rota, init = {}) => fetch(`${base}${rota}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(12000) });
  let viva;
  await caso("HTTP real: health primeiro, sem cache e compatível", async () => {
    const resposta = await consultar("/api/health");
    assert.equal(resposta.status, 200);
    assert.deepEqual(await resposta.json(), { ok: true });
    assert.match(resposta.headers.get("Cache-Control"), /no-store/);
  });
  await caso("HTTP real: identificação pública válida sem cache", async () => {
    const resposta = await consultar("/api/versao");
    assert.equal(resposta.status, 200);
    viva = await resposta.json();
    assert.ok(lib.versaoDeployValida(viva));
    assert.match(resposta.headers.get("Cache-Control"), /no-store/);
    assert.equal(resposta.headers.get("X-NKWAY-Commit"), viva.commit ?? "nao-identificado");
  });
  await caso("HTTP real: versão e health identificam a mesma publicação", async () => {
    const resposta = await consultar("/api/health");
    assert.equal(resposta.headers.get("X-NKWAY-Commit"), viva.commit ?? "nao-identificado");
    assert.equal(resposta.headers.get("X-NKWAY-Ambiente"), viva.ambiente);
  });
  await caso("HTTP real: query não altera a identificação", async () => {
    const resposta = await consultar(`/api/versao?commit=${OUTRO}&ambiente=production&empresaId=outra`);
    assert.deepEqual(await resposta.json(), viva);
  });
  await caso("HTTP real: identificação não permite POST", async () => {
    const resposta = await consultar("/api/versao", { method: "POST" });
    assert.equal(resposta.status, 405);
  });
  await caso("HTTP real: prontidão segue protegida por sessão", async () => {
    const resposta = await consultar("/api/prontidao");
    assert.equal(resposta.status, 401);
  });
}
console.log(`NKWAY identificação de deploy: ${passou} cenários aprovados${process.argv.includes("--http") ? " (inclui HTTP local)" : " (sem HTTP)"}.`);
