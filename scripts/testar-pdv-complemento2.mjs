#!/usr/bin/env node
/**
 * NKWAY — Suíte dedicada do Complemento PDV 2 de 3:
 * 1) Pagamento dividido guiado, troco exclusivo em dinheiro, normalização líquida e trava de venda quitada
 * 2) Bloqueio de venda a prazo/boleto sem cliente e validação de limite de crédito (DAV permitido)
 * 3) Decodificação de etiqueta de balança EAN-13 iniciando em 2 (peso em gramas e valor em centavos)
 * 4) Consulta rápida de preço/tributos (F7) sem alterar a venda + Vendas em Espera (F9) com troca segura
 * 5) Regressão HTTP das rotas do painel principal + /pdv + /api/diagnostico (pdv-1..pdv-40)
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
      if (id.startsWith("@/")) {
        return carregarModuloTs(`src/${id.slice(2)}.ts`);
      }
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

const pagMod = carregarModuloTs("src/lib/pagamentoPdv.ts");
const balcaoMod = carregarModuloTs("src/lib/balcaoPdv.ts");
const atalhosMod = carregarModuloTs("src/lib/atalhosPdv.ts");
const multMod = carregarModuloTs("src/lib/multiplicadorPdv.ts");

let passou = 0;
function testar(id, descricao, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou++;
      console.log(`  ok    [${id}] ${descricao}`);
    });
}

console.log("→ Complemento PDV 2/3 — Testes unitários, regras de caixa e balcão");

await testar("T01", "Pagamento dividido soma parcelas, consolida mesma forma e quita saldo exato", () => {
  const r1 = pagMod.registrarParcelaPagamentoPdv({
    pagamentosAtuais: [],
    totalVenda: 120.5,
    forma: "dinheiro",
    valorInformado: "50,00",
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.resumo.pago, 50);
  assert.equal(r1.resumo.falta, 70.5);
  assert.equal(r1.resumo.quitado, false);

  const r2 = pagMod.registrarParcelaPagamentoPdv({
    pagamentosAtuais: r1.pagamentos,
    totalVenda: 120.5,
    forma: "pix",
    valorInformado: "30,50",
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.resumo.falta, 40);

  const r3 = pagMod.registrarParcelaPagamentoPdv({
    pagamentosAtuais: r2.pagamentos,
    totalVenda: 120.5,
    forma: "pix",
    valorInformado: "40",
  });
  assert.equal(r3.ok, true);
  assert.equal(r3.pagamentos.length, 2, "Duas parcelas de PIX devem consolidar em uma única linha PIX");
  assert.equal(r3.resumo.pago, 120.5);
  assert.equal(r3.resumo.falta, 0);
  assert.equal(r3.resumo.troco, 0);
  assert.equal(r3.resumo.quitado, true);
});

await testar("T02", "Troco é permitido apenas em dinheiro; PIX, cartão, boleto e prazo são limitados ao saldo", () => {
  const rDin = pagMod.registrarParcelaPagamentoPdv({
    pagamentosAtuais: [],
    totalVenda: 73.5,
    forma: "dinheiro",
    valorInformado: "100,00",
  });
  assert.equal(rDin.ok, true);
  assert.equal(rDin.limitadoAoSaldo, false);
  assert.equal(rDin.resumo.troco, 26.5);
  assert.equal(rDin.resumo.quitado, true);

  for (const forma of ["pix", "credito", "debito", "boleto", "prazo"]) {
    const rLim = pagMod.registrarParcelaPagamentoPdv({
      pagamentosAtuais: [{ forma: "dinheiro", valor: 20 }],
      totalVenda: 73.5,
      forma,
      valorInformado: "100,00",
    });
    assert.equal(rLim.ok, true);
    assert.equal(rLim.limitadoAoSaldo, true, `Forma ${forma} deve ser limitada ao saldo restante`);
    assert.equal(rLim.valorAplicado, 53.5);
    assert.equal(rLim.resumo.troco, 0);
  }
});

await testar("T03", "Edição inline de parcelas e bloqueio de lançamento duplicado quando já quitado", () => {
  const rQuitado = pagMod.registrarParcelaPagamentoPdv({
    pagamentosAtuais: [{ forma: "pix", valor: 50 }],
    totalVenda: 50,
    forma: "dinheiro",
    valorInformado: "10",
  });
  assert.equal(rQuitado.ok, false, "Não deve aceitar nova parcela com saldo já quitado");

  const editado = pagMod.editarParcelaPagamentoPdv({
    pagamentosAtuais: [
      { forma: "dinheiro", valor: 30 },
      { forma: "debito", valor: 10 },
    ],
    totalVenda: 50,
    indice: 1,
    novoValor: "80,00",
  });
  assert.equal(editado.limitadoAoSaldo, true);
  assert.equal(editado.pagamentos[1].valor, 20);
  assert.equal(editado.resumo.troco, 0);
});

await testar("T04", "Normalização líquida para nk_venda.pagamentos desconta troco em dinheiro e mantém soma = total", () => {
  const norm = pagMod.normalizarPagamentosLiquidosPdv(
    [
      { forma: "pix", valor: 30 },
      { forma: "dinheiro", valor: 100 },
    ],
    73.5,
  );
  assert.equal(norm.ok, true);
  assert.equal(norm.troco, 56.5);
  const soma = norm.pagamentosLiquidos.reduce((s, p) => s + p.valor, 0);
  assert.equal(Math.round(soma * 100) / 100, 73.5);

  const invalido = pagMod.normalizarPagamentosLiquidosPdv([{ forma: "credito", valor: 90 }], 73.5);
  assert.equal(invalido.ok, false);
});

await testar("T05", "Venda a prazo/boleto exige cliente cadastrado, mas Salvar como DAV continua livre", () => {
  const semCli = pagMod.validarCreditoVendaPdv({
    modo: "sem_nota",
    pagamentos: [{ forma: "prazo", valor: 60 }],
    totalVenda: 60,
    cliente: null,
  });
  assert.equal(semCli.ok, false);
  assert.equal(semCli.codigo, "cliente_obrigatorio");

  const boletoSemCli = pagMod.validarCreditoVendaPdv({
    modo: "emitir_nfce",
    pagamentos: [{ forma: "boleto", valor: 60 }],
    totalVenda: 60,
    cliente: null,
  });
  assert.equal(boletoSemCli.ok, false);

  const davLivre = pagMod.validarCreditoVendaPdv({
    modo: "dav",
    pagamentos: [{ forma: "prazo", valor: 60 }],
    totalVenda: 60,
    cliente: null,
  });
  assert.equal(davLivre.ok, true);
});

await testar("T06", "Limite de crédito do cliente bloqueia excesso a prazo e aprova pagamento misto dentro do limite", () => {
  const cliente = {
    id: "cli-teste",
    nome: "PADARIA CENTRAL",
    limiteCredito: 500,
    saldoEmAberto: 420,
  };

  const estoura = pagMod.validarCreditoVendaPdv({
    modo: "emitir_nfce",
    pagamentos: [{ forma: "prazo", valor: 90 }],
    totalVenda: 90,
    cliente,
  });
  assert.equal(estoura.ok, false);
  assert.equal(estoura.codigo, "limite_excedido");
  assert.equal(estoura.limiteDisponivel, 80);

  // Pagamento misto: R$ 30 à vista no PIX + R$ 60 a prazo (dentro dos R$ 80 disponíveis!)
  const mistoOk = pagMod.validarCreditoVendaPdv({
    modo: "emitir_nfce",
    pagamentos: [
      { forma: "pix", valor: 30 },
      { forma: "prazo", valor: 60 },
    ],
    totalVenda: 90,
    cliente,
  });
  assert.equal(mistoOk.ok, true);
  assert.equal(mistoOk.valorAPrazo, 60);
  assert.equal(mistoOk.limiteDisponivel, 20);
  assert.equal(mistoOk.novoSaldoAberto, 480);
});

const catalogo = [
  {
    id: "p1",
    nome: "AÇÚCAR REFINADO 5KG",
    sku: "NK0004",
    gtin: "7891000000037",
    categoria: "Mercearia",
    unidade: "PC",
    preco: 21.9,
    estoque: 60,
    pesavel: false,
    ncm: "17019900",
    csosn: "102",
    ibsAliq: 0.1,
    cbsAliq: 0.9,
  },
  {
    id: "p20",
    nome: "QUEIJO MUSSARELA",
    sku: "NK0020",
    gtin: "7891000000198",
    categoria: "Frios",
    unidade: "KG",
    preco: 45.9,
    estoque: 11,
    pesavel: true,
    ncm: "04061010",
    csosn: "102",
    ibsAliq: 0.1,
    cbsAliq: 0.9,
  },
];

await testar("T07", "Etiqueta de balança EAN-13 (2…) decodifica peso em gramas, valor em R$ e integra com adicionar()", () => {
  // 1.350g de NK0020 (Queijo Mussarela)
  const etiqPeso = balcaoMod.gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 1350 });
  const decPeso = balcaoMod.decodificarEtiquetaBalancaPdv(etiqPeso, catalogo, "peso");
  assert.equal(decPeso.ehEtiquetaBalanca, true);
  assert.equal(decPeso.ok, true);
  assert.equal(decPeso.produto.id, "p20");
  assert.equal(decPeso.pesoKg, 1.35);

  const ad = multMod.aplicarAdicaoItemPdv([], decPeso.produto, decPeso.pesoKg);
  assert.equal(ad.ok, true);
  assert.equal(ad.linhas[0].qtd, 1.35);

  // R$ 22,95 de Queijo Mussarela a R$ 45,90/KG = 0,500 KG
  const etiqVal = balcaoMod.gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 2295 });
  const decVal = balcaoMod.decodificarEtiquetaBalancaPdv(etiqVal, catalogo, "valor");
  assert.equal(decVal.ok, true);
  assert.equal(decVal.pesoKg, 0.5);
  assert.equal(decVal.valorEtiqueta, 22.95);
});

await testar("T08", "Etiqueta de balança inválida (DV incorreto, produto não pesável ou código ausente) é rejeitada", () => {
  const etiqUnit = balcaoMod.gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 4, medidaCincoDigitos: 1000 });
  const decUnit = balcaoMod.decodificarEtiquetaBalancaPdv(etiqUnit, catalogo, "peso");
  assert.equal(decUnit.ehEtiquetaBalanca, true);
  assert.equal(decUnit.ok, false, "Produto não pesável (NK0004) não deve aceitar etiqueta de balança");

  const etiqPeso = balcaoMod.gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 1000 });
  const dvErrado = `${etiqPeso.slice(0, 12)}${(Number(etiqPeso[12]) + 1) % 10}`;
  const decDv = balcaoMod.decodificarEtiquetaBalancaPdv(dvErrado, catalogo, "peso");
  assert.equal(decDv.ok, false, "DV EAN-13 inválido deve ser recusado");
});

await testar("T09", "Consulta de preço (F7) encontra produto sem acentos, lê etiqueta de balança e calcula IBS/CBS", () => {
  const rNome = balcaoMod.consultarProdutosPrecoPdv("acucar refinado", catalogo, "peso");
  assert.equal(rNome.destaque?.id, "p1");
  assert.equal(rNome.leituraBalanca, null);

  const trib = balcaoMod.calcularTributosProdutoPdv(rNome.destaque, 1);
  assert.ok(trib.total > 0);
  assert.equal(trib.itens.length, 5);

  const etiq = balcaoMod.gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 750 });
  const rBal = balcaoMod.consultarProdutosPrecoPdv(etiq, catalogo, "peso");
  assert.equal(rBal.destaque?.id, "p20");
  assert.equal(rBal.leituraBalanca?.pesoKg, 0.75);
});

await testar("T10", "Venda em espera (F9) suspende atendimento completo e sanitiza armazenamento local", () => {
  const rSusp = balcaoMod.suspenderVendaParaEsperaPdv({
    listaAtual: [],
    vendaAtiva: {
      linhas: [
        {
          produtoId: "p1",
          nome: "AÇÚCAR REFINADO 5KG",
          qtd: 3,
          preco: 21.9,
          unidade: "PC",
          estoque: 60,
          pesavel: false,
        },
      ],
      clienteId: "cli-9",
      clienteNome: "MARIA SILVA",
      descontoModo: "real",
      descontoValor: "5,70",
      pagamentos: [{ forma: "dinheiro", valor: 20 }],
    },
    identificacao: "Maria — voltou na padaria",
    idGerado: "esp-maria",
    agora: 10000,
  });
  assert.equal(rSusp.ok, true);
  assert.equal(rSusp.suspensa.subtotal, 65.7);
  assert.equal(rSusp.suspensa.total, 60);
  assert.equal(rSusp.suspensa.unidades, 3);

  const sanitizada = balcaoMod.sanitizarListaEsperaPdv(JSON.parse(JSON.stringify(rSusp.lista)));
  assert.equal(sanitizada.length, 1);
  assert.equal(sanitizada[0].id, "esp-maria");
});

await testar("T11", "Retomar venda em espera (F9) com caixa ocupado guarda a venda atual automaticamente sem perda", () => {
  const inicial = balcaoMod.suspenderVendaParaEsperaPdv({
    listaAtual: [],
    vendaAtiva: {
      linhas: [{ produtoId: "p1", nome: "AÇÚCAR REFINADO 5KG", qtd: 2, preco: 21.9, unidade: "PC", estoque: 60, pesavel: false }],
      clienteId: null,
      clienteNome: "CONSUMIDOR",
      descontoModo: "real",
      descontoValor: "",
      pagamentos: [],
    },
    identificacao: "Venda A",
    idGerado: "esp-a",
  });
  assert.equal(inicial.ok, true);

  const retomada = balcaoMod.retomarVendaDeEsperaPdv({
    listaAtual: inicial.lista,
    idAlvo: "esp-a",
    vendaAtivaNaTela: {
      linhas: [{ produtoId: "p20", nome: "QUEIJO MUSSARELA", qtd: 0.8, preco: 45.9, unidade: "KG", estoque: 11, pesavel: true }],
      clienteId: null,
      clienteNome: "CONSUMIDOR",
      descontoModo: "real",
      descontoValor: "",
      pagamentos: [],
    },
    produtosAtivos: catalogo,
  });
  assert.equal(retomada.ok, true);
  assert.equal(retomada.trocouComAtual, true);
  assert.equal(retomada.retomada.id, "esp-a");
  assert.equal(retomada.listaRestante.length, 1);
  assert.equal(retomada.listaRestante[0].linhas[0].produtoId, "p20");
});

await testar("T12", "ATALHOS_PDV documenta F7 e F9 e bateria HTTP /api/diagnostico aprova pdv-1..pdv-40 + rotas", async () => {
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "consultar_preco" && a.tecla === "F7"));
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "venda_espera" && a.tecla === "F9"));

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

      // Confirma que o painel principal inteiro e o PDV seguem respondendo HTTP 200
      for (const rota of [
        "/",
        "/pdv",
        "/caixa",
        "/documentos",
        "/emissor",
        "/dfe",
        "/entradas",
        "/devolucoes",
        "/estoque",
        "/produtos",
        "/clientes",
        "/financeiro",
        "/relatorios",
        "/transporte",
        "/usuarios",
        "/assinatura",
        "/migracao",
        "/config",
      ]) {
        const resp = await fetch(`${BASE}${rota}`, { headers: { Cookie: cookie } });
        assert.equal(resp.status, 200, `GET ${rota} deve responder HTTP 200`);
      }

      const diagResp = await fetch(`${BASE}/api/diagnostico`, { headers: { Cookie: cookie } });
      assert.equal(diagResp.status, 200);
      const diag = await diagResp.json();
      assert.equal(diag.resumo.falhou, 0, "Nenhuma verificação pode falhar em /api/diagnostico");

      for (let n = 1; n <= 40; n++) {
        const item = diag.testes.find((t) => t.id === `pdv-${n}`);
        assert.ok(item && item.passou, `Verificação pdv-${n} deve existir e passar`);
      }
    } finally {
      await pool.end();
    }
  }
});

console.log(`\nNKWAY Complemento PDV 2/3: ${passou}/12 suítes aprovadas.`);
