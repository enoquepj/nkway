#!/usr/bin/env node
/** Garante que os espelhos de entrega não entram no programa TypeScript da aplicação. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const raiz = process.cwd();
const config = JSON.parse(readFileSync(path.join(raiz, "tsconfig.json"), "utf8"));
const manifesto = JSON.parse(readFileSync(path.join(raiz, "package.json"), "utf8"));
const lock = JSON.parse(readFileSync(path.join(raiz, "package-lock.json"), "utf8"));
for (const grupo of ["dependencies", "devDependencies"]) {
  for (const [nome, versao] of Object.entries(manifesto[grupo] ?? {})) {
    assert.equal(lock.packages?.[""]?.[grupo]?.[nome], versao, `Dependência ${nome} divergente no package-lock.json.`);
    assert.ok(lock.packages?.[`node_modules/${nome}`], `Dependência ${nome} ausente no package-lock.json.`);
  }
}
const ignorados = ["ENTREGA_GITHUB", "ARQUIVOS_PARA_GITHUB", "public/downloads", "ENTREGA_ATUAL"];
const exclusoes = new Set((config.exclude ?? []).map((p) => String(p).replace(/\\/g, "/").replace(/\/$/, "")));
for (const diretorio of ignorados) assert.ok(exclusoes.has(diretorio), `O espelho ${diretorio} precisa ficar fora do programa TypeScript.`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const resultado = spawnSync(npm, ["exec", "tsc", "--", "--listFilesOnly", "--pretty", "false"], {
  cwd: raiz,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024,
});
if (resultado.error) throw resultado.error;
assert.equal(resultado.status, 0, "Não foi possível listar os arquivos do TypeScript.");
const arquivos = resultado.stdout.split(/\r?\n/).filter(Boolean).map((p) => path.resolve(p).replace(/\\/g, "/"));
for (const diretorio of ignorados) {
  const prefixo = `${path.resolve(raiz, diretorio).replace(/\\/g, "/")}/`;
  assert.ok(!arquivos.some((arquivo) => arquivo.startsWith(prefixo)), `O espelho ${diretorio} entrou na verificação.`);
}
for (const fonte of ["src/app/(painel)/caixa/page.tsx", "src/views/Caixa.tsx", "src/lib/caixaVisivel.ts"]) {
  const arquivo = path.resolve(raiz, fonte).replace(/\\/g, "/");
  assert.ok(arquivos.includes(arquivo), `O arquivo real ${fonte} precisa continuar na verificação.`);
}
const aplicador = path.join(raiz, "ENTREGA_GITHUB", "APLICAR_ENTREGA.cmd");
if (existsSync(aplicador)) {
  const conteudo = readFileSync(aplicador, "utf8");
  const saida = conteudo.search(/^\s*exit\s+\/b\s+1\s*$/im);
  const copia = conteudo.search(/^\s*call\s+:um\b/im);
  assert.ok(conteudo.includes("[BLOQUEADO]") && saida >= 0 && copia > saida, "O aplicador histórico deve parar antes de copiar arquivos antigos.");
}
console.log("Build: lock sincronizado, espelhos excluídos, código real verificado e aplicador histórico bloqueado.");
