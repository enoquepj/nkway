#!/usr/bin/env node
/**
 * NKWAY — Suíte dedicada do Complemento PDV 1 de 3:
 * 1) Fullscreen ao abrir pelo menu / botões oficiais / atalho Alt+K
 * 2) Multiplicador X + quantidade + Enter e refatoração de adicionar(p, qtd)
 * 3) Integridade das rotas do painel principal + /pdv + /api/diagnostico (pdv-16..pdv-28)
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

function carregarModuloTs(caminhoRelativo) {
  const arq = path.join(RAIZ, caminhoRelativo);
  const fonte = fs.readFileSync(arq, "utf8");
  const { outputText } = ts.transpileModule(fonte, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      throw new Error(`Import externo não esperado em módulo puro: ${id}`);
    },
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    Intl,
    RegExp,
  };
  vm.runInNewContext(outputText, sandbox, { filename: arq });
  return mod.exports;
}

const abrirPdvMod = carregarModuloTs("src/lib/abrirPdv.ts");
const multMod = carregarModuloTs("src/lib/multiplicadorPdv.ts");
const atalhosMod = carregarModuloTs("src/lib/atalhosPdv.ts");

let passou = 0;
function testar(id, descricao, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou++;
      console.log(`  ok    [${id}] ${descricao}`);
    });
}

console.log("→ Complemento PDV 1/3 — Testes unitários e de máquina de estados");

// 1. Clique sidebar/button solicita fullscreen e navega (preservando Ctrl/Cmd+clique)
await testar("T01", "Clique sidebar/botão solicita fullscreen, grava preferência e navega (Ctrl/Cmd preservado)", async () => {
  abrirPdvMod.resetarEstadoTelaCheiaPdv();
  let fsCount = 0;
  const nav = [];
  const store = new Map();
  let prevented = false;
  const doc = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: () => {
        fsCount++;
        return Promise.resolve();
      },
    },
  };
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  };

  const r = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: (x) => nav.push(x),
    origem: "clique",
    eventoClique: { button: 0, preventDefault: () => { prevented = true; } },
    pathnameAtual: "/",
    doc,
    storage,
    agora: 1000,
  });
  assert.equal(r.interceptado, true);
  assert.equal(r.navegou, true);
  assert.equal(prevented, true);
  assert.deepEqual(nav, ["/pdv"]);
  assert.equal(fsCount, 1);
  assert.equal(store.get(abrirPdvMod.CHAVE_TELA_CHEIA), "true");
  assert.equal(await r.promessaTelaCheia, true);

  // Ctrl+clique, Cmd+clique, botão do meio e target=_blank não são sequestrados
  for (const ev of [
    { button: 0, ctrlKey: true },
    { button: 0, metaKey: true },
    { button: 0, shiftKey: true },
    { button: 1 },
  ]) {
    const modClick = abrirPdvMod.abrirPdvComTelaCheia({
      navegar: (x) => nav.push(x),
      origem: "clique",
      eventoClique: ev,
      pathnameAtual: "/",
      doc,
      storage,
      agora: 2000,
    });
    assert.equal(modClick.interceptado, false);
    assert.equal(modClick.navegou, false);
  }
  const blankClick = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: (x) => nav.push(x),
    origem: "clique",
    eventoClique: { button: 0 },
    target: "_blank",
    pathnameAtual: "/",
    doc,
    storage,
    agora: 2500,
  });
  assert.equal(blankClick.interceptado, false);
  assert.equal(fsCount, 1);
});

// 2. Fullscreen negado não impede abrir PDV e aciona fallback atual
await testar("T02", "Fullscreen negado ou ausente não bloqueia navegação para /pdv e sinaliza fallback", async () => {
  abrirPdvMod.resetarEstadoTelaCheiaPdv();
  const nav = [];
  const store = new Map();
  const rNeg = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: (x) => nav.push(x),
    origem: "clique",
    eventoClique: { button: 0 },
    pathnameAtual: "/caixa",
    doc: {
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: () => Promise.reject(new Error("Fullscreen denied")),
      },
    },
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  });
  assert.equal(rNeg.navegou, true);
  assert.deepEqual(nav, ["/pdv"]);
  assert.equal(await rNeg.promessaTelaCheia, false);
  assert.equal(store.get(abrirPdvMod.CHAVE_TELA_CHEIA), "true");
  assert.equal(abrirPdvMod.consumirFalhaRecenteTelaCheia(5000), true);
  assert.equal(abrirPdvMod.consumirFalhaRecenteTelaCheia(5000), false);

  // API inexistente
  const rSemApi = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: (x) => nav.push(x),
    origem: "clique",
    eventoClique: { button: 0 },
    pathnameAtual: "/documentos",
    doc: { fullscreenElement: null, documentElement: {} },
    storage: null,
  });
  assert.equal(rSemApi.navegou, true);
  assert.equal(await rSemApi.promessaTelaCheia, false);
  assert.deepEqual(nav, ["/pdv", "/pdv"]);
});

// 3. Atalho de abertura não duplica pedidos/listeners
await testar("T03", "Atalho Alt+K deduplica promessas simultâneas, ignora key repeat e mantém listener único", async () => {
  abrirPdvMod.resetarEstadoTelaCheiaPdv();
  let fsCalls = 0;
  let resolver;
  const docPend = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: () => {
        fsCalls++;
        return new Promise((r) => { resolver = r; });
      },
    },
  };
  let pushes = 0;
  const a1 = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: () => { pushes++; },
    origem: "atalho",
    eventoTeclado: { repeat: false },
    pathnameAtual: "/",
    doc: docPend,
    storage: null,
    agora: 10000,
  });
  const a2 = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: () => { pushes++; },
    origem: "atalho",
    eventoTeclado: { repeat: false },
    pathnameAtual: "/",
    doc: docPend,
    storage: null,
    agora: 10040,
  });
  const aRepeat = abrirPdvMod.abrirPdvComTelaCheia({
    navegar: () => { pushes++; },
    origem: "atalho",
    eventoTeclado: { repeat: true },
    pathnameAtual: "/",
    doc: docPend,
    storage: null,
    agora: 10500,
  });
  assert.equal(fsCalls, 1);
  assert.equal(a1.promessaTelaCheia, a2.promessaTelaCheia);
  assert.equal(pushes, 1);
  assert.equal(aRepeat.navegou, false);
  resolver();
  await a1.promessaTelaCheia;
});

const prodArroz = {
  id: "prod-arroz",
  nome: "ARROZ TIPO 1 5KG",
  sku: "NK0001",
  gtin: "7891000000006",
  preco: 32.9,
  unidade: "PC",
  estoque: 50,
  pesavel: false,
};

const prodQueijo = {
  id: "prod-queijo",
  nome: "QUEIJO MUSSARELA",
  sku: "NK0020",
  gtin: "7891000000198",
  preco: 45.9,
  unidade: "KG",
  estoque: 11,
  pesavel: true,
};

// 4. X, 5, Enter, scan adiciona 5
let linhasFluxo = [];
let estadoFluxo = multMod.ESTADO_MULTIPLICADOR_INICIAL;

await testar("T04", "X + 5 + Enter arma 'Próximo item × 5' e scan adiciona 5 unidades", () => {
  assert.equal(
    multMod.podeIniciarMultiplicadorPdv({
      estadoAtual: estadoFluxo,
      algumModalAberto: false,
      editandoItem: false,
      focoNaBipagem: true,
      termoBusca: "",
      key: "X",
    }),
    true,
  );
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "INICIAR", teclaInicial: "X" }).estado;
  assert.equal(estadoFluxo.status, "digitando");
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "DIGITAR_TECLA", tecla: "5" }).estado;
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "DIGITAR_TECLA", tecla: "9" }).estado;
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "BACKSPACE" }).estado;
  assert.equal(estadoFluxo.rascunho, "5");
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "ARMAR" }).estado;
  assert.equal(estadoFluxo.status, "armado");
  assert.equal(estadoFluxo.quantidade, 5);
  assert.equal(estadoFluxo.rotulo, "Próximo item × 5");

  const localizado = multMod.resolverProdutoPorCodigoOuBusca([prodArroz, prodQueijo], "7891000000006", [], 0);
  assert.equal(localizado.id, prodArroz.id);
  const res = multMod.aplicarAdicaoItemPdv(linhasFluxo, localizado, estadoFluxo.quantidade);
  assert.equal(res.ok, true);
  linhasFluxo = res.linhas;
  assert.equal(linhasFluxo.length, 1);
  assert.equal(linhasFluxo[0].qtd, 5);
});

// 5. Produto já existente soma 5, não 1
await testar("T05", "Produto já existente na venda soma exatamente a quantidade multiplicada (5 + 5 = 10, não +1)", () => {
  const res = multMod.aplicarAdicaoItemPdv(linhasFluxo, prodArroz, 5);
  assert.equal(res.ok, true);
  linhasFluxo = res.linhas;
  assert.equal(linhasFluxo.length, 1);
  assert.equal(linhasFluxo[0].qtd, 10);
});

// 6. Quantidade volta a 1 após sucesso
await testar("T06", "Após adição com sucesso, multiplicador é consumido e próxima leitura usa quantidade padrão 1", () => {
  estadoFluxo = multMod.transicionarMultiplicadorPdv(estadoFluxo, { tipo: "CONSUMIR" }).estado;
  assert.equal(estadoFluxo.status, "inativo");
  assert.equal(estadoFluxo.ultimaTransicao, "consumida");
  const qtdArmada = estadoFluxo.status === "armado" ? estadoFluxo.quantidade : undefined;
  const res = multMod.aplicarAdicaoItemPdv(linhasFluxo, prodArroz, qtdArmada);
  assert.equal(res.ok, true);
  linhasFluxo = res.linhas;
  assert.equal(linhasFluxo[0].qtd, 11);
});

// 7. Produto não encontrado não consome quantidade armada
await testar("T07", "Produto não encontrado preserva a quantidade armada para nova tentativa", () => {
  let st = multMod.transicionarMultiplicadorPdv(multMod.ESTADO_MULTIPLICADOR_INICIAL, { tipo: "INICIAR", teclaInicial: "x" }).estado;
  st = multMod.transicionarMultiplicadorPdv(st, { tipo: "DIGITAR_TECLA", tecla: "4" }).estado;
  st = multMod.transicionarMultiplicadorPdv(st, { tipo: "ARMAR" }).estado;
  assert.equal(st.status, "armado");

  const inexistente = multMod.resolverProdutoPorCodigoOuBusca([prodArroz, prodQueijo], "7890000999991", [], 0);
  assert.equal(inexistente, null);
  st = multMod.transicionarMultiplicadorPdv(st, {
    tipo: "REGISTRAR_ERRO_LEITURA",
    erro: 'Produto não encontrado para "7890000999991".',
  }).estado;
  assert.equal(st.status, "armado");
  assert.equal(st.quantidade, 4);
  assert.equal(st.rotulo, "Próximo item × 4");
  assert.ok(st.erro.includes("7890000999991"));
});

// 8. Esc cancela multiplicador sem apagar itens
await testar("T08", "Esc cancela multiplicador (digitando ou armado) sem apagar itens da venda", () => {
  const qtdAntes = linhasFluxo[0].qtd;
  let stDig = multMod.transicionarMultiplicadorPdv(multMod.ESTADO_MULTIPLICADOR_INICIAL, { tipo: "INICIAR" }).estado;
  stDig = multMod.transicionarMultiplicadorPdv(stDig, { tipo: "DIGITAR_TECLA", tecla: "7" }).estado;
  stDig = multMod.transicionarMultiplicadorPdv(stDig, { tipo: "CANCELAR" }).estado;
  assert.equal(stDig.status, "inativo");
  assert.equal(stDig.ultimaTransicao, "cancelada");

  let stArm = multMod.transicionarMultiplicadorPdv(multMod.ESTADO_MULTIPLICADOR_INICIAL, { tipo: "INICIAR" }).estado;
  stArm = multMod.transicionarMultiplicadorPdv(stArm, { tipo: "DIGITAR_TECLA", tecla: "3" }).estado;
  stArm = multMod.transicionarMultiplicadorPdv(stArm, { tipo: "ARMAR" }).estado;
  stArm = multMod.transicionarMultiplicadorPdv(stArm, { tipo: "CANCELAR" }).estado;
  assert.equal(stArm.status, "inativo");
  assert.equal(linhasFluxo.length, 1);
  assert.equal(linhasFluxo[0].qtd, qtdAntes);
});

// 9. Zero, negativo, vazio, acima do limite e decimal inválido são rejeitados
await testar("T09", "Zero, negativo, vazio, acima de 9.999 e > 3 casas decimais são rejeitados", () => {
  assert.equal(multMod.validarTextoQuantidadeMultiplicador("   ").ok, false);
  for (const entrada of ["", "0", "0,0", "0.000", "-1", "-0,5", "10000", "99999", "1,2345", "2..5", "1,2,3"]) {
    const v = multMod.validarTextoQuantidadeMultiplicador(entrada);
    assert.equal(v.ok, false, `Entrada "${entrada}" deveria falhar`);
    let st = multMod.transicionarMultiplicadorPdv(multMod.ESTADO_MULTIPLICADOR_INICIAL, { tipo: "INICIAR" }).estado;
    st = multMod.transicionarMultiplicadorPdv(st, { tipo: "DEFINIR_RASCUNHO", rascunho: entrada }).estado;
    st = multMod.transicionarMultiplicadorPdv(st, { tipo: "ARMAR" }).estado;
    assert.equal(st.status, "digitando");
    assert.ok(st.erro && st.erro.length > 0);
  }
});

// 10. Peso/decimal segue regra do produto
await testar("T10", "Peso/decimal aceita vírgula/ponto em pesável, bloqueia fração em UN, evita erro float e respeita estoque", () => {
  const vVirgula = multMod.validarTextoQuantidadeMultiplicador("1,5");
  const vPonto = multMod.validarTextoQuantidadeMultiplicador("1.5");
  assert.equal(vVirgula.ok && vVirgula.quantidade, 1.5);
  assert.equal(vPonto.ok && vPonto.quantidade, 1.5);

  // Unitário recusa decimal
  const recusaUnit = multMod.aplicarAdicaoItemPdv([], prodArroz, 1.5);
  assert.equal(recusaUnit.ok, false);

  // Pesável aceita decimal e soma 0.1 + 0.2 sem ruído de ponto flutuante
  let r1 = multMod.aplicarAdicaoItemPdv([], prodQueijo, 0.1);
  assert.equal(r1.ok, true);
  assert.equal(r1.abrirEdicaoId, null);
  let r2 = multMod.aplicarAdicaoItemPdv(r1.linhas, prodQueijo, 0.2);
  assert.equal(r2.ok, true);
  assert.equal(r2.qtdFinalLinha, 0.3);

  // Pesável adicionado novamente sem multiplicador abre edição sem sobrescrever 0.3
  let rSemMult = multMod.aplicarAdicaoItemPdv(r2.linhas, prodQueijo, undefined);
  assert.equal(rSemMult.ok, true);
  assert.equal(rSemMult.qtdFinalLinha, 0.3);
  assert.equal(rSemMult.abrirEdicaoId, prodQueijo.id);

  // Estoque máximo respeitado
  const estoura = multMod.aplicarAdicaoItemPdv(r2.linhas, prodQueijo, 11);
  assert.equal(estoura.ok, false);
});

// 11. Digitar produto com X continua possível
await testar("T11", "Digitar produto começando com X converte naturalmente para busca e respeita IME", () => {
  let st = multMod.transicionarMultiplicadorPdv(multMod.ESTADO_MULTIPLICADOR_INICIAL, {
    tipo: "INICIAR",
    teclaInicial: "X",
  }).estado;
  const conv = multMod.transicionarMultiplicadorPdv(st, { tipo: "DIGITAR_TECLA", tecla: "a" });
  assert.equal(conv.estado.status, "inativo");
  assert.equal(conv.converterParaTermoBusca, "Xa");

  // Com texto já presente ou IME compondo, X não entra no multiplicador
  assert.equal(
    multMod.podeIniciarMultiplicadorPdv({
      estadoAtual: multMod.ESTADO_MULTIPLICADOR_INICIAL,
      algumModalAberto: false,
      editandoItem: false,
      focoNaBipagem: true,
      termoBusca: "ABACAXI",
      key: "x",
    }),
    false,
  );
  assert.equal(
    multMod.podeIniciarMultiplicadorPdv({
      estadoAtual: multMod.ESTADO_MULTIPLICADOR_INICIAL,
      algumModalAberto: false,
      editandoItem: false,
      focoNaBipagem: true,
      termoBusca: "",
      key: "x",
      isComposing: true,
    }),
    false,
  );
});

// 12. Modais/outros inputs não acionam multiplicador
await testar("T12", "Modais, desconto, pagamento, cliente, edição inline e atalhos não acionam multiplicador", () => {
  for (const caso of [
    { algumModalAberto: true, editandoItem: false, focoNaBipagem: true, termoBusca: "", key: "X" },
    { algumModalAberto: false, editandoItem: false, focoNaBipagem: false, termoBusca: "", key: "X" },
    { algumModalAberto: false, editandoItem: true, focoNaBipagem: true, termoBusca: "", key: "X" },
    { algumModalAberto: false, editandoItem: false, focoNaBipagem: true, termoBusca: "", key: "x", ctrlKey: true },
    { algumModalAberto: false, editandoItem: false, focoNaBipagem: true, termoBusca: "", key: "x", altKey: true },
  ]) {
    assert.equal(
      multMod.podeIniciarMultiplicadorPdv({
        estadoAtual: multMod.ESTADO_MULTIPLICADOR_INICIAL,
        ...caso,
      }),
      false,
    );
  }
});

// 13. Regressão de scanner, busca, Del, Esc e fila offline + HTTP /api/diagnostico
await testar("T13", "Regressão de scanner/SKU, ATALHOS_PDV, fila offline e verificações HTTP vivas", async () => {
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "multiplicador_qtd" && a.tecla === "X + Qtd"));
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "remover_ultimo" && a.tecla === "Del"));
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "escape" && a.tecla === "Esc"));

  // Se o servidor estiver ativo, valida rotas do painel principal, /pdv isolado e pdv-1..pdv-28 em /api/diagnostico
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
      assert.equal(r.rows.length, 1, "Usuário demo presente no banco");
      const p = Buffer.from(
        JSON.stringify({ empresaId: r.rows[0].eid, usuarioId: r.rows[0].uid, iat: Date.now() }),
      ).toString("base64url");
      const s = createHmac("sha256", SECRET).update(p).digest("base64url");
      const cookie = `nkway.sessao=${p}.${s}`;

      for (const rota of ["/", "/pdv", "/caixa", "/documentos", "/produtos", "/estoque", "/financeiro", "/config"]) {
        const resp = await fetch(`${BASE}${rota}`, { headers: { Cookie: cookie } });
        assert.equal(resp.status, 200, `GET ${rota} deve responder 200`);
      }

      const diagResp = await fetch(`${BASE}/api/diagnostico`, { headers: { Cookie: cookie } });
      assert.equal(diagResp.status, 200);
      const diag = await diagResp.json();
      assert.equal(diag.resumo.falhou, 0, `Nenhuma verificação pode falhar em /api/diagnostico`);

      for (let n = 1; n <= 28; n++) {
        const item = diag.testes.find((t) => t.id === `pdv-${n}`);
        assert.ok(item && item.passou, `Verificação pdv-${n} deve existir e passar`);
      }
    } finally {
      await pool.end();
    }
  }
});

console.log(`\nNKWAY Complemento PDV 1/3: ${passou}/13 suítes aprovadas.`);
