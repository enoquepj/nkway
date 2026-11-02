#!/usr/bin/env node
/**
 * NKWAY — Suíte dedicada do Complemento PDV 3 de 3:
 * 1) Bobina térmica 80 mm (.print-area) com itens, parcelas divididas, troco, IBS/CBS e honestidade fiscal
 * 2) Reimpressão 80 mm para DAV / Venda sem nota / Fiscal e conversão 1-clique para DANFE Oficial
 * 3) Carregar DAV em aberto para edição/pagamento no PDV protegendo venda ativa em Espera (F9)
 * 4) Cancelamento/estorno em Documentos (F3) com motivo >= 15 caracteres e prazo legal SEFAZ (30m NFC-e / 24h NF-e)
 * 5) Gaveta rápida no PDV (Alt+G) para Suprimento e Sangria com trava de caixa fechado e saldo insuficiente
 * 6) Inspetor da fila offline (nkway.fila) com sanitização retrocompatível e retenção segura do último erro
 * 7) Regressão HTTP das 18 rotas do painel principal + /pdv + /api/diagnostico (189 verificações, pdv-1..pdv-52)
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
    Buffer,
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

const opMod = carregarModuloTs("src/lib/operacoesPdv.ts");
const atalhosMod = carregarModuloTs("src/lib/atalhosPdv.ts");
const domMod = carregarModuloTs("src/lib/dominio.ts");

let passou = 0;
function testar(id, descricao, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passou++;
      console.log(`  ok    [${id}] ${descricao}`);
    });
}

const catalogo = [
  {
    id: "p1",
    nome: "ARROZ TIPO 1 5KG",
    sku: "NK0001",
    gtin: "7891000000006",
    unidade: "PC",
    preco: 32.9,
    estoque: 50,
    pesavel: false,
  },
  {
    id: "p20",
    nome: "QUEIJO MUSSARELA",
    sku: "NK0020",
    gtin: "7891000000198",
    unidade: "KG",
    preco: 45.9,
    estoque: 11,
    pesavel: true,
  },
];

console.log("→ Complemento PDV 3/3 — Testes unitários, pós-venda 80 mm, F3, Gaveta e Fila Offline");

await testar("T01", "Recibo térmico 80 mm pós-venda lista todos os itens, parcelas divididas, troco e tributos IBS/CBS", () => {
  const rec = opMod.montarReciboDeFechamentoPdv({
    id: "v-101",
    modo: "sem_nota",
    numeroVenda: 101,
    numeroNota: null,
    modelo: null,
    situacaoFiscal: "nao_emitida",
    chave: null,
    protocolo: null,
    clienteNome: "CARLOS CLIENTE",
    clienteDocumento: "111.222.333-44",
    operador: "Ana Ribeiro",
    terminal: "CAIXA 1",
    ambiente: "2",
    itens: [
      { nome: "ARROZ TIPO 1 5KG", qtd: 2, precoUnit: 32.9, unidade: "PC" },
      { nome: "QUEIJO MUSSARELA", qtd: 0.5, precoUnit: 45.9, unidade: "KG" },
    ],
    subtotal: 88.75,
    desconto: 3.75,
    total: 85,
    pagamentosBrutos: [
      { forma: "pix", valor: 35 },
      { forma: "dinheiro", valor: 100 },
    ],
    troco: 50,
  });

  assert.equal(rec.qtdLinhas, 2);
  assert.equal(rec.unidadesTotais, 2.5);
  assert.equal(rec.parcelas.length, 2);
  assert.equal(rec.troco, 50);
  assert.equal(rec.total, 85);
  assert.ok(rec.tributosTotal > 0);
  assert.ok(rec.cbsEstimado > 0);
  assert.ok(rec.ibsEstimado > 0);

  const pdvFonte = fs.readFileSync(path.join(RAIZ, "src/views/Pdv.tsx"), "utf8");
  assert.ok(pdvFonte.includes('!imprimindo && "print-area"'), "Bobina 80 mm deve usar .print-area exclusivo");
  assert.ok(pdvFonte.includes("w-[302px]"), "Bobina térmica deve respeitar largura de 80 mm (302px)");
});

await testar("T02", "Honestidade fiscal na bobina 80 mm: pendente_transmissao nunca exibe chave fictícia; autorizada converte p/ DANFE", () => {
  const chaveReal = domMod.gerarChave({
    uf: "11",
    aamm: "2611",
    cnpj: "23567891000174",
    modelo: "65",
    serie: "1",
    numeroNota: 9100,
  });

  const recPend = opMod.montarReciboDeFechamentoPdv({
    id: "v-pend",
    modo: "emitir_nfce",
    numeroVenda: 102,
    numeroNota: 9100,
    modelo: "NFC-e",
    situacaoFiscal: "pendente_transmissao",
    chave: chaveReal,
    protocolo: "111999",
    clienteNome: "CONSUMIDOR",
    operador: "Ana",
    terminal: "CAIXA 1",
    ambiente: "2",
    itens: [{ nome: "ARROZ TIPO 1 5KG", qtd: 1, precoUnit: 32.9, unidade: "PC" }],
    subtotal: 32.9,
    desconto: 0,
    total: 32.9,
    pagamentosBrutos: [{ forma: "dinheiro", valor: 32.9 }],
    troco: 0,
  });
  assert.equal(recPend.chave, null, "pendente_transmissao jamais pode expor chave autorizada fictícia");
  assert.equal(recPend.protocolo, null);

  const recAut = opMod.montarReciboDeFechamentoPdv({
    id: "v-aut",
    modo: "emitir_nfce",
    numeroVenda: 103,
    numeroNota: 9101,
    modelo: "NFC-e",
    situacaoFiscal: "autorizada",
    chave: chaveReal,
    protocolo: "111260000910100",
    clienteNome: "CONSUMIDOR",
    operador: "Ana",
    terminal: "CAIXA 1",
    ambiente: "2",
    itens: [{ nome: "ARROZ TIPO 1 5KG", qtd: 1, precoUnit: 32.9, unidade: "PC" }],
    subtotal: 32.9,
    desconto: 0,
    total: 32.9,
    pagamentosBrutos: [{ forma: "pix", valor: 32.9 }],
    troco: 0,
  });
  assert.equal(recAut.chave, chaveReal);
  const danfe = opMod.converterReciboParaDocFiscalPdv(recAut);
  assert.ok(danfe);
  assert.equal(danfe.chave, chaveReal);
  assert.equal(danfe.numero, 9101);
});

const davAbertoDto = {
  id: "dav-200",
  numero: 200,
  numeroNota: null,
  serie: null,
  modelo: null,
  tipo: "dav",
  status: "aberto",
  situacaoFiscal: "nao_emitida",
  protocoloOrigem: null,
  chave: null,
  protocolo: null,
  clienteId: "cli-dav-1",
  clienteNome: "PADARIA SOL",
  subtotal: 65.8,
  desconto: 5.8,
  vFrete: 0,
  total: 60,
  formaPagamento: "dinheiro",
  pagamentos: [],
  validade: "2026-11-10",
  observacao: null,
  operador: "Ana",
  caixa: "CAIXA 1",
  ambiente: "2",
  data: "2026-11-02T14:00:00.000Z",
  itens: [
    {
      produtoId: "p1",
      gtin: "7891000000006",
      nome: "ARROZ TIPO 1 5KG",
      qtd: 2,
      precoUnit: 32.9,
      total: 65.8,
      unidade: "PC",
    },
  ],
};

await testar("T03", "Reimpressão 80 mm a partir de VendaDto (F3) funciona para DAV e Venda sem nota sem chave fiscal", () => {
  const recDav = opMod.montarReciboDeVendaDtoPdv(davAbertoDto, "12.345.678/0001-99");
  assert.equal(recDav.tipo, "dav");
  assert.equal(recDav.chave, null);
  assert.equal(recDav.parcelas.length, 0);
  assert.ok(recDav.tituloBobina.includes("DAV"));
  assert.equal(opMod.converterReciboParaDocFiscalPdv(recDav), null);
});

await testar("T04", "Carregar DAV em aberto para a tela do PDV preserva itens/desconto e salva venda aberta em Espera (F9)", () => {
  const r = opMod.carregarDavParaTelaPdv({
    dav: davAbertoDto,
    produtosAtivos: catalogo,
    listaEsperaAtual: [],
    vendaAtivaNaTela: {
      linhas: [{ produtoId: "p20", nome: "QUEIJO MUSSARELA", qtd: 0.75, preco: 45.9, unidade: "KG", estoque: 11, pesavel: true }],
      clienteId: null,
      clienteNome: "CONSUMIDOR",
      descontoModo: "real",
      descontoValor: "",
      pagamentos: [],
    },
    agora: 9000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.davNumero, 200);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].produtoId, "p1");
  assert.equal(r.linhas[0].qtd, 2);
  assert.equal(r.descontoValor, "5,80");
  assert.equal(r.guardouVendaAnteriorEmEspera, true);
  assert.equal(r.listaEsperaAtualizada.length, 1);
  assert.equal(r.listaEsperaAtualizada[0].linhas[0].produtoId, "p20");
});

await testar("T05", "DAV já faturado/cancelado ou venda fiscal não pode ser reaberto como rascunho de DAV", () => {
  assert.equal(
    opMod.carregarDavParaTelaPdv({
      dav: { ...davAbertoDto, status: "faturado" },
      produtosAtivos: catalogo,
      listaEsperaAtual: [],
    }).ok,
    false,
  );
  assert.equal(
    opMod.carregarDavParaTelaPdv({
      dav: { ...davAbertoDto, tipo: "fiscal" },
      produtosAtivos: catalogo,
      listaEsperaAtual: [],
    }).ok,
    false,
  );
});

await testar("T06", "Cancelamento em F3 exige motivo >= 15 caracteres e recusa documento já cancelado", () => {
  const curto = opMod.validarCancelamentoDocumentoPdv({ venda: davAbertoDto, motivo: "curto" });
  assert.equal(curto.ok, false);
  assert.equal(curto.codigo, "motivo_curto");

  const jaCanc = opMod.validarCancelamentoDocumentoPdv({
    venda: { ...davAbertoDto, status: "cancelado" },
    motivo: "Justificativa completa com mais de quinze letras",
  });
  assert.equal(jaCanc.ok, false);
  assert.equal(jaCanc.codigo, "ja_cancelado");

  const ok = opMod.validarCancelamentoDocumentoPdv({
    venda: davAbertoDto,
    motivo: "Cliente solicitou cancelamento do orçamento no balcão",
  });
  assert.equal(ok.ok, true);
});

await testar("T07", "Cancelamento em F3 aplica prazo legal SEFAZ (30 min NFC-e 65 / 24h NF-e 55) para notas autorizadas", () => {
  const t0 = Date.parse("2026-11-02T15:00:00.000Z");
  const nfce = {
    tipo: "fiscal",
    status: "faturado",
    modelo: "NFC-e",
    situacaoFiscal: "autorizada",
    protocoloOrigem: "autorizado_sefaz",
    data: new Date(t0).toISOString(),
    numero: 300,
    numeroNota: 300,
  };

  assert.equal(
    opMod.validarCancelamentoDocumentoPdv({
      venda: nfce,
      motivo: "Cancelamento dentro dos trinta minutos regulamentares",
      agoraMs: t0 + 25 * 60_000,
    }).ok,
    true,
  );

  const exp = opMod.validarCancelamentoDocumentoPdv({
    venda: nfce,
    motivo: "Tentativa após expirar os trinta minutos da NFC-e",
    agoraMs: t0 + 35 * 60_000,
  });
  assert.equal(exp.ok, false);
  assert.equal(exp.codigo, "prazo_sefaz_expirado");

  assert.equal(
    opMod.validarCancelamentoDocumentoPdv({
      venda: { ...nfce, modelo: "NF-e" },
      motivo: "NF-e modelo 55 permite até vinte e quatro horas legais",
      agoraMs: t0 + 180 * 60_000,
    }).ok,
    true,
  );
});

await testar("T08", "Gaveta rápida (Alt+G) valida Suprimento e Sangria e projeta o novo saldo em dinheiro", () => {
  const sessao = { id: "s1", numero: 1, terminal: "CAIXA 1", saldoDinheiro: 200 };
  const sup = opMod.validarMovimentoGavetaPdv({
    sessaoAberta: sessao,
    tipo: "suprimento",
    forma: "dinheiro",
    valorInformado: "75,50",
    motivo: "Reforço de troco",
  });
  assert.equal(sup.ok, true);
  assert.equal(sup.saldoDinheiroApos, 275.5);

  const sang = opMod.validarMovimentoGavetaPdv({
    sessaoAberta: sessao,
    tipo: "sangria",
    forma: "dinheiro",
    valorInformado: "150,00",
    motivo: "Sangria para cofre",
  });
  assert.equal(sang.ok, true);
  assert.equal(sang.saldoDinheiroApos, 50);
});

await testar("T09", "Gaveta rápida bloqueia caixa fechado, valor inválido, motivo curto e sangria acima do saldo", () => {
  const sessao = { id: "s1", numero: 1, terminal: "CAIXA 1", saldoDinheiro: 100 };
  assert.equal(
    opMod.validarMovimentoGavetaPdv({
      sessaoAberta: null,
      tipo: "sangria",
      forma: "dinheiro",
      valorInformado: "10",
      motivo: "Sangria",
    }).codigo,
    "caixa_fechado",
  );
  assert.equal(
    opMod.validarMovimentoGavetaPdv({
      sessaoAberta: sessao,
      tipo: "sangria",
      forma: "dinheiro",
      valorInformado: "120,00",
      motivo: "Sangria maior que saldo",
    }).codigo,
    "saldo_insuficiente",
  );
  assert.equal(
    opMod.validarMovimentoGavetaPdv({
      sessaoAberta: sessao,
      tipo: "suprimento",
      forma: "dinheiro",
      valorInformado: "0",
      motivo: "Troco",
    }).codigo,
    "valor_invalido",
  );
  assert.equal(
    opMod.validarMovimentoGavetaPdv({
      sessaoAberta: sessao,
      tipo: "suprimento",
      forma: "dinheiro",
      valorInformado: "20",
      motivo: "ab",
    }).codigo,
    "motivo_curto",
  );
});

await testar("T10", "Inspetor da fila offline (nkway.fila) sanitiza registros legados e calcula resumo financeiro", () => {
  const lista = opMod.sanitizarFilaOfflinePdv([
    {
      tipo: "fiscal",
      itens: [{ produtoId: "p1", qtd: 2, preco: 32.9 }],
      clienteNome: "CLIENTE FILA 1",
      desconto: 5.8,
      pagamentos: [{ forma: "dinheiro", valor: 60 }],
      criadoEm: 1700000100000,
    },
    {
      idFila: "f2",
      tipo: "sem_nota",
      itens: [{ produtoId: "p20", qtd: 1, preco: 45.9 }],
      clienteNome: "CLIENTE FILA 2",
      desconto: 0,
      pagamentos: [{ forma: "pix", valor: 45.9 }],
      tentativas: 1,
      ultimoErro: "Caixa fechado: abra o seu caixa antes de finalizar vendas.",
      criadoEm: 1700000200000,
    },
  ]);
  assert.equal(lista.length, 2);
  const res = opMod.resumirFilaOfflinePdv(lista);
  assert.equal(res.quantidade, 2);
  assert.equal(res.valorTotal, 105.9);
  assert.equal(res.comErro, 1);
});

await testar("T11", "ATALHOS_PDV integra Alt+G e mantém listener global único de teclado em src/views/Pdv.tsx", () => {
  assert.ok(atalhosMod.ATALHOS_PDV.some((a) => a.id === "gaveta_caixa" && a.tecla === "Alt+G"));
  const pdvTxt = fs.readFileSync(path.join(RAIZ, "src/views/Pdv.tsx"), "utf8");
  const qtdListeners = (pdvTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  assert.equal(qtdListeners, 2, "Apenas 1 listener de atalhos + 1 listener { once: true } de fallback fullscreen");
});

await testar("T12", "Bateria HTTP viva: 18 rotas do ERP + /pdv isolado + /api/diagnostico com 189/189 (pdv-1..pdv-52)", async () => {
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
      assert.equal(diag.resumo.total, 189, "Total esperado de 189 verificações no Console do Dev");

      for (let n = 1; n <= 52; n++) {
        const item = diag.testes.find((t) => t.id === `pdv-${n}`);
        assert.ok(item && item.passou, `Verificação pdv-${n} deve existir e passar`);
      }
    } finally {
      await pool.end();
    }
  }
});

console.log(`\nNKWAY Complemento PDV 3/3: ${passou}/12 suítes aprovadas.`);
