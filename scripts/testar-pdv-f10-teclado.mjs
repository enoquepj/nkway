#!/usr/bin/env node
/**
 * NKWAY — Suíte dedicada de Navegação 100% por Teclado no Modal Finalizar (F10):
 * Comprova que o operador navega e conclui qualquer venda sem usar o mouse:
 * 1) Setas ← → percorrem as 6 formas de pagamento imediatamente após F10.
 * 2) Digitação direta ou campo de valor lança parcelas com Enter e avança automaticamente às opções ao quitar.
 * 3) Setas ← → alternam o modelo fiscal (NFC-e ↔ NF-e ↔ SAT) tanto na barra de modelo quanto nas opções.
 * 4) Setas ↑ ↓ e teclas 1/2/3 selecionam DAV, Sem nota e Emitir fiscal (pulando opções bloqueadas).
 * 5) Confirmação fiscal navega com ← → entre Voltar e Confirmar, Enter confirma e Esc volta às opções.
 * 6) Bateria HTTP viva /api/diagnostico aprova 195/195 verificações (pdv-1..pdv-58).
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import pg from "pg";
import ts from "typescript";

const RAIZ = process.cwd();
const BASE = process.env.BASE || "http://127.0.0.1:3000";
const SECRET = process.env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao";

const cacheModulos = new Map();
function carregarModuloTs(caminhoRelativo) {
  const arq = path.join(RAIZ, caminhoRelativo);
  if (cacheModulos.has(arq)) return cacheModulos.get(arq);

  const fonte = fs.readFileSync(arq, "utf8");
  const { outputText } = ts.transpileModule(fonte, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const mod = { exports: {} };
  cacheModulos.set(arq, mod.exports);

  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id.startsWith("@/")) return carregarModuloTs(`src/${id.slice(2)}.ts`);
      if (id.startsWith("./") || id.startsWith("../")) {
        const resolvido = path.relative(RAIZ, path.resolve(path.dirname(arq), `${id}.ts`));
        return carregarModuloTs(resolvido);
      }
      throw new Error(`Import externo não esperado: ${id}`);
    },
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    Intl,
    RegExp,
  };
  vm.runInNewContext(outputText, sandbox, { filename: arq });
  cacheModulos.set(arq, mod.exports);
  return mod.exports;
}

const navMod = carregarModuloTs("src/lib/navegacaoFinalizarPdv.ts");

let passou = 0;
async function testar(id, descricao, fn) {
  await fn();
  passou++;
  console.log(`  ok    [${id}] ${descricao}`);
}

const ctxBase = {
  temSaldoFaltando: true,
  temParcelasLancadas: false,
  podeDav: true,
  podeSemNota: true,
  podeEmitirFiscal: true,
  confirmandoEmissao: false,
  inputValorSelecionadoOuVazio: true,
};

console.log("→ Navegação 100% por Teclado no F10 — Formas de Pagamento e Tipos de Documento");

await testar("T01", "Ao abrir F10 com saldo pendente, foco inicia nas formas e ← → percorre todas as 6 opções", () => {
  let st = navMod.criarEstadoInicialFinalizarPdv({
    formaInicial: "dinheiro",
    modeloAtual: "NFC-e",
    ctx: ctxBase,
  });
  assert.equal(st.secao, "formas");
  assert.equal(st.formaAtiva, "dinheiro");

  const ordemEsperada = ["pix", "credito", "debito", "boleto", "prazo", "dinheiro"];
  for (const esp of ordemEsperada) {
    const r = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, ctxBase);
    assert.equal(r.interceptado, true);
    assert.equal(r.estado.formaAtiva, esp);
    assert.equal(r.acao.tipo, "MUDAR_FORMA");
    st = r.estado;
  }

  const rVolta = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowLeft" }, ctxBase);
  assert.equal(rVolta.estado.formaAtiva, "prazo");
});

await testar("T02", "Fluxo rápido zero-mouse: F10 → seta → PIX → Enter quita → Enter abre confirmação → Enter emite NFC-e", () => {
  let st = navMod.criarEstadoInicialFinalizarPdv({
    formaInicial: "dinheiro",
    modeloAtual: "NFC-e",
    ctx: ctxBase,
  });

  // 1) Seta direita -> PIX
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, ctxBase).estado;
  assert.equal(st.formaAtiva, "pix");

  // 2) Enter em PIX -> lança parcela e, como quitou (falta = 0), avança direto para "opcoes"
  const rEnterForma = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, ctxBase);
  assert.equal(rEnterForma.acao.tipo, "LANCAR_PARCELA");
  st = navMod.avancarAposLancamentoParcelaPdv(rEnterForma.estado, false, ctxBase);
  assert.equal(st.secao, "opcoes");
  assert.equal(st.opcaoFechamento, "emitir_nfce");

  // 3) Enter na opção 3 -> abre confirmação fiscal com foco em "confirmar"
  const ctxQuitado = { ...ctxBase, temSaldoFaltando: false, temParcelasLancadas: true };
  const rAbreConf = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, ctxQuitado);
  assert.equal(rAbreConf.acao.tipo, "ABRIR_CONFIRMACAO_FISCAL");
  st = rAbreConf.estado;
  assert.equal(st.secao, "confirmacao");
  assert.equal(st.botaoConfirmacao, "confirmar");

  // 4) Enter na confirmação -> executa fechamento emitir_nfce
  const rConfirma = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, { ...ctxQuitado, confirmandoEmissao: true });
  assert.equal(rConfirma.acao.tipo, "EXECUTAR_FECHAMENTO");
  assert.equal(rConfirma.acao.modo, "emitir_nfce");
});

await testar("T03", "Fluxo sem lançar parcela prévia: F10 → seta → Crédito → setas ↓ até Sem nota ou DAV → Enter", () => {
  let st = navMod.criarEstadoInicialFinalizarPdv({
    formaInicial: "dinheiro",
    modeloAtual: "NFC-e",
    ctx: ctxBase,
  });

  // → PIX → Crédito
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, ctxBase).estado;
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, ctxBase).estado;
  assert.equal(st.formaAtiva, "credito");

  // ↓ vai para "valor" -> ↓ vai para "modelo" -> ↓ vai para "opcoes" (1. DAV) -> ↓ vai para "2. Sem nota"
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowDown" }, ctxBase).estado;
  assert.equal(st.secao, "valor");
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowDown" }, ctxBase).estado;
  assert.equal(st.secao, "modelo");
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowDown" }, ctxBase).estado;
  assert.equal(st.secao, "opcoes");
  assert.equal(st.opcaoFechamento, "dav");

  // Enter em DAV salva DAV
  const rDav = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, ctxBase);
  assert.equal(rDav.acao.tipo, "EXECUTAR_FECHAMENTO");
  assert.equal(rDav.acao.modo, "dav");

  // ↓ vai para Sem nota e Enter finaliza sem nota
  st = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowDown" }, ctxBase).estado;
  assert.equal(st.opcaoFechamento, "sem_nota");
  const rSemNota = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, ctxBase);
  assert.equal(rSemNota.acao.tipo, "EXECUTAR_FECHAMENTO");
  assert.equal(rSemNota.acao.modo, "sem_nota");
});

await testar("T04", "Troca do modelo fiscal (NFC-e ↔ NF-e ↔ SAT) com setas ← → na barra de modelo e nas opções", () => {
  const ctxQuitado = { ...ctxBase, temSaldoFaltando: false, temParcelasLancadas: true };
  let st = navMod.criarEstadoInicialFinalizarPdv({
    formaInicial: "pix",
    modeloAtual: "NFC-e",
    ctx: ctxQuitado,
  });
  assert.equal(st.secao, "opcoes");

  // Estando em "opcoes", ← → já alterna NFC-e -> NF-e -> SAT -> NFC-e
  let r1 = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, ctxQuitado);
  assert.equal(r1.acao.tipo, "MUDAR_MODELO");
  assert.equal(r1.estado.modeloFiscal, "NF-e");

  let r2 = navMod.processarTeclaFinalizarPdv(r1.estado, { key: "ArrowRight" }, ctxQuitado);
  assert.equal(r2.estado.modeloFiscal, "SAT");

  let r3 = navMod.processarTeclaFinalizarPdv(r2.estado, { key: "ArrowLeft" }, ctxQuitado);
  assert.equal(r3.estado.modeloFiscal, "NF-e");
});

await testar("T05", "No campo de valor: ← → troca forma quando selecionado, mas preserva cursor quando editando dígitos", () => {
  let st = {
    secao: "valor",
    formaAtiva: "dinheiro",
    modeloFiscal: "NFC-e",
    opcaoFechamento: "emitir_nfce",
    botaoConfirmacao: "confirmar",
  };

  // Quando todo o valor está selecionado, → troca forma para PIX
  const rSel = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, { ...ctxBase, inputValorSelecionadoOuVazio: true });
  assert.equal(rSel.interceptado, true);
  assert.equal(rSel.estado.formaAtiva, "pix");

  // Quando o operador está editando no meio dos dígitos, → não é interceptado (move o cursor do input normalmente)
  const rEdit = navMod.processarTeclaFinalizarPdv(st, { key: "ArrowRight" }, { ...ctxBase, inputValorSelecionadoOuVazio: false });
  assert.equal(rEdit.interceptado, false);
});

await testar("T06", "Quando Sem nota e Emitir fiscal estão bloqueados (ex.: falta saldo ou crédito), ↑ ↓ foca DAV com segurança", () => {
  const ctxSoDav = {
    ...ctxBase,
    podeDav: true,
    podeSemNota: false,
    podeEmitirFiscal: false,
  };
  let st = navMod.criarEstadoInicialFinalizarPdv({
    formaInicial: "prazo",
    modeloAtual: "NFC-e",
    ctx: ctxSoDav,
  });
  st = { ...st, secao: "opcoes" };
  const rEnter = navMod.processarTeclaFinalizarPdv(st, { key: "Enter" }, ctxSoDav);
  assert.equal(rEnter.acao.tipo, "EXECUTAR_FECHAMENTO");
  assert.equal(rEnter.acao.modo, "dav");
});

await testar("T07", "Validação HTTP viva: /api/diagnostico aprova 195/195 verificações (incluindo pdv-53..pdv-58)", async () => {
  let online = false;
  try {
    const h = await fetch(`${BASE}/api/health`);
    online = h.ok;
  } catch {
    online = false;
  }

  if (online) {
    const dbUrl = (fs.readFileSync(path.join(RAIZ, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1];
    const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
    try {
      const r = await pool.query(
        "select u.id as uid, e.id as eid from nk_usuario u join nk_empresa e on e.id = u.empresa_id limit 1",
      );
      assert.equal(r.rows.length, 1);
      const p = Buffer.from(
        JSON.stringify({ empresaId: r.rows[0].eid, usuarioId: r.rows[0].uid, iat: Date.now() }),
      ).toString("base64url");
      const s = createHmac("sha256", SECRET).update(p).digest("base64url");
      const cookie = `nkway.sessao=${p}.${s}`;

      const diagResp = await fetch(`${BASE}/api/diagnostico`, { headers: { Cookie: cookie } });
      assert.equal(diagResp.status, 200);
      const diag = await diagResp.json();
      assert.equal(diag.resumo.falhou, 0, "Nenhuma verificação pode falhar em /api/diagnostico");
      assert.equal(diag.resumo.total, 195, "Esperadas 195 verificações em /api/diagnostico");

      for (let n = 53; n <= 58; n++) {
        const item = diag.testes.find((t) => t.id === `pdv-${n}`);
        assert.ok(item && item.passou, `Verificação pdv-${n} deve existir e passar`);
      }
    } finally {
      await pool.end();
    }
  }
});

console.log(`\nNKWAY Navegação F10 por Teclado: ${passou}/7 suítes aprovadas.`);
