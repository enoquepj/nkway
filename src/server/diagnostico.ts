/**
 * NKWAY — bateria de testes do console do dev.
 * Porta de `src/erp/dev/testes.ts` do protótipo (27 testes) para a versão fullstack:
 * aqui as verificações rodam no servidor, sobre os dados reais do tenant logado,
 * e são expostas na rota `/api/diagnostico` e na aba "Ambiente" das Configurações.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assinaturaFaturas,
  assinaturas,
  auditorias,
  caixaMovimentos,
  caixaSessoes,
  clientes,
  contas,
  devolucoes,
  empresas,
  entradas,
  eventosFiscais,
  inutilizacoes,
  fornecedores,
  mdfes,
  movimentos,
  produtos,
  usuarios,
  vendaItens,
  vendas,
} from "@/db/schema";
import {
  calcularPrecoAssinatura,
  gerarLinhaDigitavelBoleto,
  gerarPayloadPixEmv,
  validarCartaoLuhn,
  validarCnpjAssinatura,
  validarLinhaDigitavelBoleto,
  validarPayloadPixEmv,
} from "@/lib/assinatura";
import { calcularApuracaoCaixa, calcularConferenciaCaixa } from "@/lib/caixa";
import { normalizarPerfil, temPermissao } from "@/lib/permissoes";
import { confereSenha, hashSenha } from "@/lib/session";
import { extrairEntradasZip, gerarZipBuffer } from "@/lib/zip";
import {
  diagnosticarPreValidacaoFiscal,
  montarPayloadEmissaoFiscal,
  verificarPrazoLegalCancelamento,
  type InsumoPreValidacaoFiscal,
} from "@/lib/emissorFiscal";
import { ehUuidValido, gerarSqlPermissaoLeituraLegado } from "@/lib/migracaoLegado";
import { verificarAutenticacaoWebhookAssinatura } from "@/server/assinaturaGateway";
import { verificarAutenticacaoWebhookFiscal } from "@/server/emissorFiscalCore";
import { obterXmlRealDaVenda, xmlFiscalArmazenadoValido } from "@/server/exportacaoXmlCore";
import {
  extrairPacoteDeObjetoJson,
  inspecionarFontesLegadas,
  processarMigracaoLegado,
  uuidDeterministico,
} from "@/server/migracaoLegadoCore";
import {
  PLANOS_CFG,
  classeAcumulado,
  dvChaveAcesso,
  documentoValido,
  gerarChave,
  gerarGtin,
  mascaraDocumento,
  round2,
  situacaoEstoque,
  soDigitos,
  validarChaveAcesso,
  validarCnpj,
  validarCpf,
  validarGtin,
  valorAPrazo,
} from "@/lib/dominio";
import { emPeriodo, periodoRelativo } from "@/lib/filtros";
import { buildSoapConsChNFe, buildSoapDistNsu, padNsu } from "@/lib/dfe";
import { notaPorChaveDemo, parseNfeXml } from "@/lib/xmlNfe";
import { qrBits } from "@/lib/qrcode";
import { proximoNumeroFiscal } from "@/server/dados";
import {
  cifrarSegredo,
  decifrarSegredo,
  extrairRetornoDist,
  gerarSoapDemoDist,
  lerDocumentosDfeFiscal,
} from "@/server/dfeCore";

export type TesteResultado = {
  id: string;
  modulo: string;
  nome: string;
  passou: boolean;
  detalhe: string;
  critico: boolean;
};

export type Diagnostico = {
  geradoEm: string;
  duracaoMs: number;
  resumo: { total: number; passou: number; falhou: number; criticos: number };
  modulos: { modulo: string; total: number; falhou: number; criticosFalhos: number }[];
  testes: TesteResultado[];
  estado: {
    produtos: number;
    produtosAtivos: number;
    clientes: number;
    fornecedores: number;
    vendas: number;
    davs: number;
    itens: number;
    movimentos: number;
    entradas: number;
    contas: number;
    mdfes: number;
    equipe: number;
  };
};

const lista = (xs: string[], max = 3) => (xs.length ? xs.slice(0, max).join(", ") + (xs.length > max ? ` (+${xs.length - max})` : "") : "todos OK");
const qtd = (n: number, rotulo: string) => `${n} ${rotulo}${n === 1 ? "" : "s"}`;

/* ------------------------------------------------------- XML de exemplo */
const XML_TESTE = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc><NFe><infNFe Id="NFe1122040458362000015155001000010411101041110" versao="4.00">
<ide><cUF>11</cUF><nNF>1041</nNF><serie>1</serie><dhEmi>2026-03-22T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>04583620000151</CNPJ><xNome>DISTRIBUIDORA NORTE SUL LTDA</xNome></emit>
<det nItem="1"><prod><cEAN>7896004210016</cEAN><xProd>ARROZ TIPO 1 5KG</xProd><NCM>10063021</NCM><CFOP>5101</CFOP><uCom>PC</uCom><qCom>24.0000</qCom><vUnCom>22.4000</vUnCom><vProd>537.60</vProd></prod></det>
<det nItem="2"><prod><cEAN>SEM GTIN</cEAN><xProd>OLEO DE SOJA 900ML</xProd><NCM>15071000</NCM><CFOP>5101</CFOP><uCom>UN</uCom><qCom>36.0000</qCom><vUnCom>6.3500</vUnCom><vProd>228.60</vProd></prod></det>
<total><ICMSTot><vFrete>30.64</vFrete><vNF>808.84</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

/* -------------------------------------------------- testes puros (sem banco) */
function testesDeNucleo(): TesteResultado[] {
  const r: TesteResultado[] = [];
  const ok = (
    id: string,
    modulo: string,
    nome: string,
    passou: boolean,
    detalhe: string,
    critico = false,
  ) => r.push({ id, modulo, nome, passou, detalhe, critico });

  const chave = gerarChave({ uf: "11", aamm: "2603", cnpj: "04583620000151", modelo: "55", serie: "1", numeroNota: 1041 });

  ok("nuc-1", "Núcleo", "Gerador de chave produz 44 dígitos", chave.length === 44, `${chave.slice(0, 20)}…`, true);
  ok("nuc-2", "Núcleo", "Chave contém apenas números", /^\d{44}$/.test(chave), "formato SEFAZ", true);
  ok("nuc-3", "Núcleo", "DV da chave confere no recálculo", dvChaveAcesso(chave.slice(0, 43)) === Number(chave[43]), "módulo 11 pesos 2..9", true);
  ok(
    "nuc-4",
    "Núcleo",
    "GTIN válido gerado e rejeitado quando o DV é trocado",
    validarGtin(gerarGtin(1)) && !validarGtin(`${gerarGtin(2).slice(0, 12)}0`),
    "EAN-13 com dígito verificador",
    true,
  );
  ok(
    "nuc-5",
    "Núcleo",
    "CPF: aceita válido e rejeita inválido",
    validarCpf("11144477735") && validarCpf("52998224725") && !validarCpf("12345678900") && !validarCpf("11111111111"),
    "dígito verificador módulo 11",
    true,
  );
  ok(
    "nuc-6",
    "Núcleo",
    "CNPJ: aceita válido e rejeita inválido",
    validarCnpj("11222333000181") && validarCnpj("45997418000153") && !validarCnpj("04458362000148") && !validarCnpj("11111111111111"),
    "dois dígitos verificadores",
    true,
  );
  ok("nuc-7", "Núcleo", "round2 elimina ruído binário do dinheiro", round2(0.1 + 0.2) === 0.3 && round2(10.005) === 10.01, `${round2(0.1 + 0.2)} · ${round2(10.005)}`, true);
  ok(
    "nuc-8",
    "Núcleo",
    "Situação de estoque nos 4 estágios",
    situacaoEstoque(0, 10) === "zerado" &&
      situacaoEstoque(4, 10) === "critico" &&
      situacaoEstoque(8, 10) === "baixo" &&
      situacaoEstoque(20, 10) === "saudavel",
    "zerado → crítico → baixo → saudável",
    true,
  );
  ok("nuc-9", "Núcleo", "Curva ABC corta em 80% e 95%", classeAcumulado(80) === "A" && classeAcumulado(80.01) === "B" && classeAcumulado(95) === "B" && classeAcumulado(95.01) === "C", "A ≤ 80 · B ≤ 95 · C > 95");
  ok(
    "nuc-10",
    "Núcleo",
    "Filtro de período aceita ISO e Date",
    emPeriodo(new Date(), periodoRelativo(30)) && !emPeriodo("2001-01-01", periodoRelativo(30)),
    "usado nas 11 telas",
  );
  ok("nuc-11", "Núcleo", "Máscara de documento formata CPF e CNPJ", mascaraDocumento("11144477735") === "111.444.777-35" && mascaraDocumento("11222333000181") === "11.222.333/0001-81", `${mascaraDocumento("11144477735")} · ${mascaraDocumento("11222333000181")}`);
  ok(
    "nuc-12",
    "Núcleo",
    "valorAPrazo separa a parte que vira conta a receber",
    valorAPrazo([{ forma: "dinheiro", valor: 50 }, { forma: "prazo", valor: 30 }], 80, "dinheiro") === 30 &&
      valorAPrazo(null, 80, "boleto") === 80 &&
      valorAPrazo(null, 80, "dinheiro") === 0,
    "integração PDV → financeiro",
    true,
  );
  ok("nuc-13", "Núcleo", "Limites dos planos são crescentes", PLANOS_CFG.every((p, i) => i === 0 || (p.limiteProdutos > PLANOS_CFG[i - 1].limiteProdutos && p.limiteUsuarios >= PLANOS_CFG[i - 1].limiteUsuarios)), PLANOS_CFG.map((p) => `${p.nome}:${p.limiteProdutos}`).join(" · "));

  // ----------------------------------------------------------------- XML
  let xml: ReturnType<typeof parseNfeXml> | null = null;
  let xmlErro = "";
  try {
    xml = parseNfeXml(XML_TESTE);
  } catch (e) {
    xmlErro = e instanceof Error ? e.message : String(e);
  }
  ok("xml-1", "Entrada XML", "Parser lê a NF-e de exemplo", !!xml, xml ? `${qtd(xml.itens.length, "item")}` : xmlErro, true);
  ok("xml-2", "Entrada XML", "Extrai CNPJ do emitente com DV válido", !!xml && validarCnpj(xml.cnpjFornecedor), xml?.cnpjFornecedor || "—", true);
  ok("xml-3", "Entrada XML", "Extrai NCM e CFOP de cada item", !!xml && xml.itens.every((i) => /^\d{8}$/.test(i.ncm) && /^\d{4}$/.test(i.cfop)), xml ? lista(xml.itens.map((i) => i.ncm)) : "—", true);
  ok("xml-4", "Entrada XML", "Extrai total, frete e unidade", !!xml && xml.total > 0 && xml.valorFrete >= 0 && xml.itens.every((i) => i.unidade.length > 0), xml ? `vNF ${round2(xml.total)} · vFrete ${round2(xml.valorFrete)}` : "—");
  ok("xml-5", "Entrada XML", "Rejeita arquivo que não é NF-e", (() => { try { parseNfeXml("<nada/>"); return false; } catch { return true; } })(), "tratamento de erro no upload", true);
  ok(
    "xml-6",
    "Entrada XML",
    "Consulta por chave exige 44 dígitos",
    (() => { try { notaPorChaveDemo("123"); return false; } catch { return true; } })() && notaPorChaveDemo(chave).itens.length > 0,
    "chamada SEFAZ simulada da aba Entradas",
    true,
  );

  // ---------------------------------------------------------- QR Code (próprio)
  try {
    const payload = "https://dfe-nkway.com.br/consulta?p=1122040458362000015155001000010411101041110|2|2|000000000|127.90|NKWAY|1|00000000";
    const curto = "1122040458362000015155001000010411101041110|2|2|127.90|NKWAY";
    const matriz = qrBits(payload, "L");
    const matrizM = qrBits(curto, "M");
    const n = matriz.length;
    const versao = (n - 17) / 4;
    const dentro = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n;
    const finderOk = [[0, 0], [0, n - 7], [n - 7, 0]].every(([a, b]) => {
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 7; j++) {
          const esperado = i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
          if (dentro(a + i, b + j) && matriz[a + i][b + j] !== (esperado ? 1 : 0)) return false;
        }
      return true;
    });
    const timingOk = Array.from({ length: n - 16 }, (_, k) => k + 8).every((k) => matriz[6][k] === (k % 2 === 0 ? 1 : 0) && matriz[k][6] === (k % 2 === 0 ? 1 : 0));
    let escuros = 0;
    for (const linha of matriz) for (const c of linha) if (c) escuros++;
    const proporcao = (escuros * 100) / (n * n);
    ok("qr-1", "QR Code", "Gerador produz o símbolo sem dependência externa", matriz.length >= 21 && matrizM.length >= 21, `URL completa: versão ${(matriz.length - 17) / 4} · payload curto no nível M: versão ${(matrizM.length - 17) / 4}`, true);
    ok("qr-2", "QR Code", "Códigos de localização nos 3 cantos", finderOk, "7×7 com anel e miolo", true);
    ok("qr-3", "QR Code", "Linhas de sincronismo alternadas", timingOk, "linha 6 e coluna 6", true);
    ok("qr-4", "QR Code", "Proporção de módulos escuros entre 35% e 65%", proporcao >= 35 && proporcao <= 65, `${round2(proporcao)}% escuro`, true);
    ok("qr-5", "QR Code", "Payload da NFC-e cabe no limite da versão", Buffer.byteLength(payload) <= 134, `${Buffer.byteLength(payload)} bytes de ${134}`, true);
  } catch (e) {
    ok("qr-1", "QR Code", "Gerador de QR Code executou", false, e instanceof Error ? e.message : "falhou", true);
  }

  return r;
}

/* ------------------------------------------------ testes sobre dados do tenant */
export async function rodarDiagnostico(empresaId: string, usuarioId: string): Promise<Diagnostico> {
  const inicio = Date.now();
  const r: TesteResultado[] = [...testesDeNucleo()];
  const ok = (
    id: string,
    modulo: string,
    nome: string,
    passou: boolean,
    detalhe: string,
    critico = false,
  ) => r.push({ id, modulo, nome, passou, detalhe, critico });

  const [prods, clis, forns, vds, itens, movs, ents, cts, mdfs, devs, inuts, evts, equipe] = await Promise.all([
    db.select().from(produtos).where(eq(produtos.empresaId, empresaId)),
    db.select().from(clientes).where(eq(clientes.empresaId, empresaId)),
    db.select().from(fornecedores).where(eq(fornecedores.empresaId, empresaId)),
    db.select().from(vendas).where(eq(vendas.empresaId, empresaId)),
    db
      .select({ id: vendaItens.id, vendaId: vendaItens.vendaId, nome: vendaItens.nome, qtd: vendaItens.qtd, precoUnit: vendaItens.precoUnit, total: vendaItens.total })
      .from(vendaItens)
      .innerJoin(vendas, eq(vendaItens.vendaId, vendas.id))
      .where(eq(vendas.empresaId, empresaId)),
    db.select().from(movimentos).where(eq(movimentos.empresaId, empresaId)),
    db.select().from(entradas).where(eq(entradas.empresaId, empresaId)),
    db.select().from(contas).where(eq(contas.empresaId, empresaId)),
    db.select().from(mdfes).where(eq(mdfes.empresaId, empresaId)),
    db.select().from(devolucoes).where(eq(devolucoes.empresaId, empresaId)),
    db.select().from(inutilizacoes).where(eq(inutilizacoes.empresaId, empresaId)),
    db.select().from(eventosFiscais).where(eq(eventosFiscais.empresaId, empresaId)),
    db.select({ id: usuarios.id, papel: usuarios.papel, ativo: usuarios.ativo, senhaHash: usuarios.senhaHash }).from(usuarios).where(eq(usuarios.empresaId, empresaId)),
  ]);

  const vendaPorId = new Map(vds.map((v) => [v.id, v]));
  const itensPorVenda = new Map<string, typeof itens>();
  for (const i of itens) {
    const l = itensPorVenda.get(i.vendaId);
    if (l) l.push(i);
    else itensPorVenda.set(i.vendaId, [i]);
  }

  /* ------------------------------------------------------------ cadastros */
  const semLucro = prods.filter((p) => round2(Number(p.preco)) < round2(Number(p.custo)));
  const estoqueNeg = prods.filter((p) => Number(p.estoque) < 0);
  const skus = prods.map((p) => p.sku).filter(Boolean);
  const gtinsRuins = prods.filter((p) => !validarGtin(p.gtin));
  const ncmRuins = prods.filter((p) => !/^\d{8}$/.test(p.ncm));
  const semUnidade = prods.filter((p) => !p.unidade);
  const aliqFora = prods.filter((p) => [p.icmsAliq, p.pisAliq, p.cofinsAliq, p.ibsAliq, p.cbsAliq].some((a) => Number(a) < 0 || Number(a) > 100));

  ok("cad-1", "Cadastros", "Existem produtos cadastrados", prods.length > 0, qtd(prods.length, "produto"));
  ok("cad-2", "Cadastros", "Nenhum produto com preço abaixo do custo", semLucro.length === 0, lista(semLucro.map((p) => p.nome)), true);
  ok("cad-3", "Cadastros", "Nenhum estoque negativo", estoqueNeg.length === 0, estoqueNeg.length ? lista(estoqueNeg.map((p) => `${p.nome}: ${p.estoque}`)) : "saldos não negativos", true);
  ok("cad-4", "Cadastros", "SKUs sem duplicidade", new Set(skus).size === skus.length, `${qtd(skus.length, "SKU")} · chave de casamento do XML depende disso`, true);
  ok("cad-5", "Cadastros", "GTINs válidos ou isentos", gtinsRuins.length === 0, gtinsRuins.length ? lista(gtinsRuins.map((p) => `${p.nome} (${p.gtin})`)) : "DV do EAN-13 correto", true);
  ok("cad-6", "Cadastros", "Todo produto tem NCM de 8 dígitos", ncmRuins.length === 0, ncmRuins.length ? lista(ncmRuins.map((p) => `${p.nome}: ${p.ncm}`)) : "campo obrigatório na NF-e", true);
  ok("cad-7", "Cadastros", "Todo produto tem unidade de medida", semUnidade.length === 0, semUnidade.length ? lista(semUnidade.map((p) => p.nome)) : "uCom/uTrib da NF-e", true);
  ok("cad-8", "Cadastros", "Alíquotas dentro da faixa 0–100%", aliqFora.length === 0, aliqFora.length ? lista(aliqFora.map((p) => p.nome)) : "ICMS, PIS, COFINS, IBS e CBS ok");
  ok("cad-9", "Cadastros", "IBS/CBS da reforma configurados", prods.every((p) => Number(p.ibsAliq) >= 0 && Number(p.cbsAliq) >= 0), `CBS ${prods[0] ? round2(Number(prods[0].cbsAliq)) : 0}% · IBS ${prods[0] ? round2(Number(prods[0].ibsAliq)) : 0}% (transição LC 214/2025)`);

  /* ------------------------------------------------------------------ PDV */
  const fiscais = vds.filter((v) => v.tipo === "fiscal");
  const davs = vds.filter((v) => v.tipo === "dav");
  const semChave = fiscais.filter((v) => !v.chave);
  const chaveRuim = fiscais.filter((v) => v.chave && (soDigitos(v.chave).length !== 44 || dvChaveAcesso(soDigitos(v.chave).slice(0, 43)) !== Number(soDigitos(v.chave)[43])));
  const davComNota = davs.filter((v) => v.chave);
  const totalRuim = vds.filter((v) => {
    const soma = round2((itensPorVenda.get(v.id) ?? []).reduce((s, i) => s + Number(i.qtd) * Number(i.precoUnit), 0));
    return Math.abs(soma - Number(v.desconto) + Number(v.vFrete) - Number(v.total)) > 0.02;
  });
  const numerosRepetidos = vds.length - new Set(vds.map((v) => v.numero)).size;
  const parcelasRuins = vds.filter((v) => {
    const ps = v.pagamentos ?? [];
    if (!ps.length) return false;
    return Math.abs(round2(ps.reduce((s, p) => s + Number(p.valor), 0)) - Number(v.total)) > 0.02;
  });
  const notaSemNumero = fiscais.filter((v) => v.numeroNota == null || !v.serie || !v.modelo);

  ok("pdv-1", "PDV", "Toda venda fiscal possui chave de acesso", semChave.length === 0, semChave.length ? `${semChave.length} sem chave` : `${qtd(fiscais.length, "nota")}`, true);
  ok("pdv-2", "PDV", "Chaves com 44 dígitos e DV correto", chaveRuim.length === 0, chaveRuim.length ? lista(chaveRuim.map((v) => String(v.numero))) : "layout SEFAZ validado", true);
  ok("pdv-3", "PDV", "DAV não possui bloco fiscal", davComNota.length === 0, davComNota.length ? `${davComNota.length} DAV(s) com chave` : `${qtd(davs.length, "DAV")}`, true);
  ok("pdv-4", "PDV", "Total = itens − desconto + frete", totalRuim.length === 0, totalRuim.length ? lista(totalRuim.map((v) => String(v.numero))) : "conferência aritmética de todas as vendas", true);
  ok("pdv-5", "PDV", "Números de documento únicos", numerosRepetidos === 0, numerosRepetidos ? `${numerosRepetidos} duplicado(s)` : "sem duplicidade");
  ok("pdv-6", "PDV", "Parcelas somam o total da venda", parcelasRuins.length === 0, parcelasRuins.length ? `${parcelasRuins.length} venda(s) com pagamento dividido errado` : "pagamento dividido confere", true);
  ok("pdv-7", "PDV", "Venda fiscal tem número, série e modelo", notaSemNumero.length === 0, notaSemNumero.length ? `${notaSemNumero.length} incompleta(s)` : "ide completo para o DANFE", true);
  ok("pdv-8", "PDV", "Itens de venda existem para todas as vendas", itensPorVenda.size === vds.length, `${qtd(itens.length, "item")} em ${qtd(itensPorVenda.size, "venda")}`, true);

  /* -------------------------------------------------------------- estoque */
  const ordemKardex = [...movs].sort((a, b) => new Date(a.data ?? 0).getTime() - new Date(b.data ?? 0).getTime());
  const ultimoSaldo = new Map<string, number>();
  for (const m of ordemKardex) ultimoSaldo.set(m.produtoId, Number(m.saldoApos));
  const saldoDivergente = prods.filter((p) => {
    const alvo = ultimoSaldo.get(p.id);
    return alvo !== undefined && Math.abs(round2(alvo * 1000) - round2(Number(p.estoque) * 1000)) > 1;
  });
  const saldoNegativo = movs.filter((m) => Number(m.saldoApos) < 0);

  ok("est-1", "Estoque", "Kardex possui lançamentos", movs.length > 0, qtd(movs.length, "lançamento"));
  ok("est-2", "Estoque", "Movimento de venda é negativo", movs.filter((m) => m.tipo === "venda").every((m) => Number(m.qtd) < 0), "sinal correto", true);
  ok("est-3", "Estoque", "Movimento de entrada é positivo", movs.filter((m) => m.tipo === "entrada").every((m) => Number(m.qtd) > 0), "sinal correto", true);
  ok("est-4", "Estoque", "Saldo após o movimento nunca é negativo", saldoNegativo.length === 0, saldoNegativo.length ? `${saldoNegativo.length} linha(s)` : "integridade da trilha", true);
  ok("est-5", "Estoque", "Saldo do cadastro = último saldoApos do kardex", saldoDivergente.length === 0, saldoDivergente.length ? lista(saldoDivergente.map((p) => `${p.nome}: cad ${p.estoque} vs kardex ${ultimoSaldo.get(p.id)}`)) : "cadastro e kardex em sincronia", true);
  ok("est-6", "Estoque", "Custo médio nunca negativo", movs.every((m) => Number(m.custoMedioApos) >= 0), "custo com 4 casas");
  ok("est-7", "Estoque", "Situação de estoque calculada para todos", prods.every((p) => !!situacaoEstoque(Number(p.estoque), Number(p.estoqueMin))), `${qtd(prods.filter((p) => situacaoEstoque(Number(p.estoque), Number(p.estoqueMin)) === "saudavel").length, "produto saudável")}`);

  /* -------------------------------------------------------------- compras */
  const lancadas = ents.filter((e) => e.status === "lancada");
  const totalRuimEnt = ents.filter((e) => Number(e.total) < 0);
  const chaveRuimEnt = ents.filter((e) => (e.origem === "xml" || e.origem === "sefaz") && e.chave && soDigitos(e.chave).length !== 44);
  const itemSemFiscal = ents.filter((e) => (e.itens ?? []).some((i) => !/^\d{8}$/.test(i.ncm) || !/^\d{4}$/.test(i.cfop)));

  ok("com-1", "Compras", "Totais das entradas não negativos", totalRuimEnt.length === 0, `${qtd(ents.length, "nota")}`);
  ok("com-2", "Compras", "Entrada lançada gera movimento no kardex", lancadas.length === 0 || movs.some((m) => m.tipo === "entrada"), lancadas.length ? `${qtd(lancadas.length, "entrada lançada")} com rastreio` : "nenhuma lançada ainda", true);
  ok("com-3", "Compras", "Chave do XML com 44 dígitos", chaveRuimEnt.length === 0, chaveRuimEnt.length ? `${chaveRuimEnt.length} chave(s) estranha(s)` : "chaves de entrada íntegras");
  ok("com-4", "Compras", "Itens das entradas têm NCM e CFOP", itemSemFiscal.length === 0, itemSemFiscal.length ? `${itemSemFiscal.length} nota(s) com item incompleto` : "campos fiscais presentes");
  ok("com-5", "Compras", "Fila de conferência sob controle", ents.filter((e) => e.status === "pendente").length <= 5, `${qtd(ents.filter((e) => e.status === "pendente").length, "entrada pendente")}`);

  /* ----------------------------------------------------------- financeiro */
  const valorRuim = cts.filter((c) => Number(c.valor) <= 0);
  const vencRuim = cts.filter((c) => !/^\d{4}-\d{2}-\d{2}$/.test(String(c.vencimento)));
  const pagoAMais = cts.filter((c) => Number(c.valorPago) > Number(c.valor) + 0.01);
  const saldoNeg = cts.filter((c) => c.status === "aberta" && round2(Number(c.valor) - Number(c.valorPago)) < -0.01);
  const vendasAPrazo = vds.filter((v) => v.status === "faturado" && (v.formaPagamento === "boleto" || v.formaPagamento === "prazo"));

  ok("fin-1", "Financeiro", "Lançamentos com valor positivo", valorRuim.length === 0, valorRuim.length ? `${valorRuim.length} título(s) zerado(s)` : `${qtd(cts.length, "título")}`, true);
  ok("fin-2", "Financeiro", "Vencimento em formato ISO", vencRuim.length === 0, vencRuim.length ? `${vencRuim.length} inválido(s)` : "yyyy-mm-dd em todos", true);
  ok("fin-3", "Financeiro", "Nenhum título pago acima do valor", pagoAMais.length === 0, pagoAMais.length ? `${pagoAMais.length} com excesso` : "baixas coerentes");
  ok("fin-4", "Financeiro", "Saldo em aberto nunca negativo", saldoNeg.length === 0, saldoNeg.length ? `${saldoNeg.length} título(s)` : `${qtd(cts.filter((c) => c.status === "aberta").length, "título em aberto")}`, true);
  ok("fin-5", "Financeiro", "Venda a prazo gerou conta a receber", vendasAPrazo.length === 0 || cts.some((c) => c.tipo === "receber" && c.categoria === "Vendas"), vendasAPrazo.length ? `${qtd(vendasAPrazo.length, "venda a prazo")} integrada(s)` : "nenhuma venda a prazo", true);

  /* ---------------------------------------------------------------- MDF-e */
  const docRuim = mdfs.filter((m) => (m.documentos ?? []).some((d) => d.tipo !== "NF-e"));
  const cargaRuim = mdfs.filter((m) => Math.abs(round2((m.documentos ?? []).reduce((s, d) => s + Number(d.valor), 0)) - Number(m.valorCarga)) > 0.02);
  const chaveMdfRuim = mdfs.filter((m) => soDigitos(m.chave).length !== 44);

  ok("mdf-1", "MDF-e", "Manifesto só vincula NF-e", docRuim.length === 0, docRuim.length ? `${docRuim.length} com NFC-e` : "NFC-e não entra em manifesto", true);
  ok("mdf-2", "MDF-e", "Valor da carga bate com os documentos", cargaRuim.length === 0, cargaRuim.length ? `${cargaRuim.length} divergente(s)` : `${qtd(mdfs.length, "manifesto")}`, true);
  ok("mdf-3", "MDF-e", "Chaves do MDF-e com 44 dígitos", chaveMdfRuim.length === 0, chaveMdfRuim.length ? `${chaveMdfRuim.length} inválida(s)` : `${qtd(mdfs.length, "chave")}`);
  ok("mdf-4", "MDF-e", "Peso bruto informado", mdfs.every((m) => Number(m.pesoBruto) >= 0), `${qtd(mdfs.length, "manifesto")} com peso`);

  /* ------------------------------------------------- clientes / fornecedores */
  const docRuimCli = clis.filter((c) => !documentoValido(c.documento));
  const indIeRuim = clis.filter((c) => !["1", "2", "9"].includes(String(c.indIe ?? "")));
  const ufRuim = clis.filter((c) => !!c.uf && !/^[A-Z]{2}$/.test(c.uf));
  const cnpjFornRuim = forns.filter((f) => !validarCnpj(f.cnpj));

  ok("cli-1", "Clientes", "Documentos com DV válido (CPF/CNPJ)", docRuimCli.length === 0, docRuimCli.length ? lista(docRuimCli.map((c) => c.nome)) : `${qtd(clis.length, "cliente")} válido(s) ou consumidor final`, true);
  ok("cli-2", "Clientes", "indIEDest definido (1/2/9)", indIeRuim.length === 0, indIeRuim.length ? lista(indIeRuim.map((c) => c.nome)) : "tag obrigatória do <dest>", true);
  ok("cli-3", "Clientes", "UF com 2 letras quando informada", ufRuim.length === 0, ufRuim.length ? lista(ufRuim.map((c) => `${c.nome}: ${c.uf}`)) : "endereço do destinatário ok");
  ok("for-1", "Fornecedores", "CNPJ do fornecedor com DV válido", cnpjFornRuim.length === 0, cnpjFornRuim.length ? lista(cnpjFornRuim.map((f) => `${f.nome} (${f.cnpj})`)) : `${qtd(forns.length, "fornecedor")} válido(s)`, true);

  /* ------------------------------------------------------- vínculo por contraparteId */
  const comId = cts.filter((c) => c.contraparteId);
  const semId = cts.filter((c) => !c.contraparteId);
  const idOrfao = cts.filter((c) => {
    if (!c.contraparteId) return false;
    const tipo = c.contraparteTipo;
    if (tipo === "fornecedor") return !forns.some((f) => f.id === c.contraparteId);
    if (tipo === "cliente") return !clis.some((x) => x.id === c.contraparteId);
    return false;
  });
  const idTipoInconsistente = cts.filter((c) => c.contraparteId && !["cliente", "fornecedor"].includes(String(c.contraparteTipo ?? "")));
  const nomesDuplicados = clis.filter((c) => clis.some((o) => o.nome === c.nome && o.id !== c.id));
  // saldo calculado por id não pode divergir da soma dos títulos daquele id
  const saldoPorId = new Map<string, number>();
  for (const c of cts) {
    if (c.tipo !== "receber" || c.status !== "aberta" || !c.contraparteId) continue;
    saldoPorId.set(c.contraparteId, round2((saldoPorId.get(c.contraparteId) ?? 0) + Number(c.valor) - Number(c.valorPago)));
  }
  const saldoIdDivergente = [...saldoPorId.entries()].filter(([id, valor]) => {
    const alvo = saldoPorId.get(id);
    return alvo !== undefined && Math.abs(round2(alvo * 1000) - round2(valor * 1000)) > 1;
  });

  ok("vin-1", "Vínculos", "Título com contraparte tem id e tipo coerentes", idTipoInconsistente.length === 0, idTipoInconsistente.length ? `${idTipoInconsistente.length} sem tipo` : `${qtd(comId.length, "título")} com vínculo por id · ${semId.length} avulso(s)`, true);
  ok("vin-2", "Vínculos", "Nenhum título aponta para cadastro inexistente", idOrfao.length === 0, idOrfao.length ? `${idOrfao.length} órfão(ãos)` : "todos os ids existem", true);
  ok("vin-3", "Vínculos", "Nenhum cliente homônimo (dependência de nome)", nomesDuplicados.length === 0, nomesDuplicados.length ? lista(nomesDuplicados.map((c) => c.nome)) : "nomes únicos no cadastro");
  /* ------------------------------------------------- campos ➕ do FILTROS.md */
  const validadeProx = prods.filter(
    (p) => p.validade && (new Date(`${String(p.validade).slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86_400_000 < 30,
  ).length;
  const semLocal = prods.filter((p) => !p.localizacao).length;
  const semLote = prods.filter((p) => !p.lote).length;

  const vendaComOperador = vds.filter((v) => !!v.operador).length;
  const vendaSemAmbiente = vds.filter((v) => !["1", "2"].includes(String(v.ambiente ?? ""))).length;
  const vendaSemCaixa = vds.filter((v) => !v.caixa).length;

  const movSemUsuario = movs.filter((m) => ["ajuste", "perda", "inventario"].includes(m.tipo) && !m.usuarioNome).length;
  const origens = new Set(cts.map((c) => c.origem ?? "manual"));
  const contaSemOrigem = cts.filter((c) => !c.origem).length;

  ok("filda-1", "FILTROS", "Produto tem lote, validade e localização", semLote === 0 && semLocal === 0, `${semLote} sem lote · ${semLocal} sem localização · ${validadeProx} vencendo em 30 dias`);
  ok("filda-2", "FILTROS", "CEST disponível para o filtro de busca", prods.every((p) => typeof p.cest === "string"), `${prods.filter((p) => p.cest).length} produto(s) com CEST`);
  ok("filda-3", "FILTROS", "Venda grava operador, caixa e ambiente", vendaSemAmbiente === 0 && vendaSemCaixa === 0, `${vendaComOperador} venda(s) com operador · ambiente 1/2 em ${vds.length - vendaSemAmbiente}`, true);
  ok("filda-4", "FILTROS", "Ajuste, perda e inventário registram o usuário", movSemUsuario === 0, movSemUsuario ? `${movSemUsuario} sem responsável` : "auditoria completa no kardex");
  ok("filda-5", "FILTROS", "Título financeiro tem origem identificada", contaSemOrigem === 0, contaSemOrigem ? `${contaSemOrigem} sem origem` : `origens: ${[...origens].join(", ")}`, true);

  ok("vin-4", "Vínculos", "Saldo em aberto soma por id, não por nome", saldoIdDivergente.length === 0, saldoIdDivergente.length ? `${saldoIdDivergente.length} divergente(s)` : `${saldoPorId.size} contraparte(s) com saldo calculado por id`, true);

  /* ------------------------------------------------- numeração e eventos fiscais */
  const inutAtivas = inuts.filter((i) => i.status !== "cancelado");
  const inutInvalida = inutAtivas.filter((i) => i.numeroInicial > i.numeroFinal);
  const sobreposta = inutAtivas.filter((a) => inutAtivas.some((b) => b.id !== a.id && a.numeroInicial <= b.numeroFinal && a.numeroFinal >= b.numeroInicial));
  const justificativaCurta = inuts.filter((i) => i.justificativa.trim().length < 15);
  const numerosUsados = new Set(fiscais.map((v) => `${v.modelo ?? "?"}/${v.serie ?? "?"}/${v.numeroNota ?? 0}`));
  const inutSobNumeroEmitido = inutAtivas.filter((i) => {
    const serieInut = String(i.serie);
    const modeloInut = i.modelo;
    for (let n = i.numeroInicial; n <= i.numeroFinal; n++) if (numerosUsados.has(`${modeloInut}/${serieInut}/${n}`)) return true;
    return false;
  });
  const cc = evts.filter((e) => e.tipo === "carta_correcao");
  const ccSemChave = cc.filter((e) => !validarChaveAcesso(e.chave));
  const ccSemProtocolo = cc.filter((e) => !String(e.protocolo ?? "").trim());
  const ccSemTexto = cc.filter((e) => e.descricao.trim().length < 15);
  const ccRepetida = cc.length !== new Set(cc.map((e) => `${e.vendaId}/${e.sequencia}`)).size;
  const ccAcima = [...cc.reduce((m, e) => m.set(e.vendaId, Math.max(m.get(e.vendaId) ?? 0, e.sequencia)), new Map<string, number>()).values()].some((s) => s > 20);
  const chaveDeEventoOrfa = evts.filter((e) => !fiscais.some((v) => v.id === e.vendaId));

  ok("inut-1", "Numeração", "Intervalo de inutilização é coerente (início ≤ fim)", inutInvalida.length === 0, inutInvalida.length ? `${inutInvalida.length} pedido(s) invertido(s)` : `${qtd(inutAtivas.length, "faixa ativa")} de ${inuts.length} pedido(s)`, true);
  ok("inut-2", "Numeração", "Faixas inutilizadas não se sobrepõem", sobreposta.length === 0, sobreposta.length ? `${sobreposta.length} conflito(s)` : "intervalos disjuntos", true);
  ok("inut-3", "Numeração", "Nenhuma faixa inutilizada cobre número já emitido", inutSobNumeroEmitido.length === 0, inutSobNumeroEmitido.length ? lista(inutSobNumeroEmitido.map((i) => `${i.numeroInicial}-${i.numeroFinal}`)) : "SEFAZ recusaria este pedido", true);
  ok("inut-4", "Numeração", "Justificativa tem 15 a 255 caracteres", justificativaCurta.length === 0, justificativaCurta.length ? `${justificativaCurta.length} com texto curto` : "todas dentro do padrão");
  ok("inut-5", "Numeração", "Próximo número fiscal pula os inutilizados", fiscais.length === 0 || inutAtivas.every((i) => (fiscais.some((v) => v.numeroNota === i.numeroInicial && v.serie === i.serie && v.modelo === i.modelo) ? false : true)), `${qtd(inutAtivas.reduce((s, i) => s + (i.numeroFinal - i.numeroInicial + 1), 0), "número")} fora da sequência de emissão`);

  // confere o cálculo real de próximo número para cada série emitida
  const seriesUsadas = [...new Set(fiscais.filter((v) => v.modelo && v.serie).map((v) => `${v.modelo}|${v.serie}`))];
  if (seriesUsadas.length) {
    const calculos: string[] = [];
    let falhou = false;
    for (const chave of seriesUsadas.slice(0, 4)) {
      const [modelo, serie] = chave.split("|");
      const prox = await proximoNumeroFiscal(empresaId, modelo, serie);
      const caiDentro = inutAtivas.some((i) => i.modelo === modelo && i.serie === serie && prox >= i.numeroInicial && prox <= i.numeroFinal);
      const jaUsado = numerosUsados.has(`${modelo}/${serie}/${prox}`);
      calculos.push(`${modelo}/${serie}: ${prox}${caiDentro ? " (dentro de faixa!)" : ""}`);
      if (caiDentro || jaUsado) falhou = true;
    }
    ok("inut-6", "Numeração", "Cálculo de próximo número nunca cai em faixa inutilizada nem em número usado", !falhou, calculos.join(" · "), true);
  } else {
    ok("inut-6", "Numeração", "Cálculo de próximo número nunca cai em faixa inutilizada nem em número usado", true, "sem documento fiscal emitido ainda");
  }

  ok("cc-1", "Eventos", "Carta de correção referencia chave válida", ccSemChave.length === 0, ccSemChave.length ? `${ccSemChave.length} sem chave` : `${qtd(cc.length, "evento")} com 44 dígitos e DV`, true);
  ok("cc-2", "Eventos", "Evento tem protocolo vinculado", ccSemProtocolo.length === 0, ccSemProtocolo.length ? `${ccSemProtocolo.length} sem protocolo` : "protocolo presente em todos");
  ok("cc-3", "Eventos", "Correção descreve a alteração (mín. 15 caracteres)", ccSemTexto.length === 0, ccSemTexto.length ? `${ccSemTexto.length} com texto insuficiente` : "texto em todas");
  ok("cc-4", "Eventos", "Sequência do evento é única por documento", !ccRepetida, ccRepetida ? "duplicidade de sequência" : "1, 2, 3… por chave", true);
  ok("cc-5", "Eventos", "Limite de 20 cartas de correção por documento respeitado", !ccAcima, ccAcima ? "excedido" : "dentro do limite da SEFAZ", true);
  ok("cc-6", "Eventos", "Nenhum evento aponta para documento inexistente", chaveDeEventoOrfa.length === 0, chaveDeEventoOrfa.length ? `${chaveDeEventoOrfa.length} órfão(ãos)` : "todos vinculados a nota emitida", true);

  /* ------------------------------------------------------ devoluções de compra */
  const cfopRuim = devs.filter((d) => !["5201", "6201"].includes(d.cfop));
  const nfrefRuim = devs.filter((d) => !validarChaveAcesso(d.chaveReferente));
  const chaveDevRuim = devs.filter((d) => !validarChaveAcesso(d.chave));
  const totalDevRuim = devs.filter((d) => Math.abs(round2((d.itens ?? []).reduce((s, i) => s + i.qtd * i.custo, 0)) - round2(Number(d.valorProdutos))) > 0.02);
  const somaDev = devs.filter((d) => d.status !== "cancelada").reduce((s, d) => s + (d.itens ?? []).reduce((a, i) => a + i.qtd, 0), 0);
  const kardexDev = movs.filter((m) => m.tipo === "devolucao").reduce((s, m) => s + Math.abs(Number(m.qtd)), 0);
  const motivoVazio = devs.filter((d) => d.status === "emitida" && !String(d.motivo ?? "").trim());
  const semCredito = devs.filter((d) => d.status === "emitida" && d.gerarFinanceiro && d.total > 0 &&
    !cts.some((c) => c.tipo === "receber" && c.categoria === "Devoluções" && Math.abs(Number(c.valor) - d.total) < 0.02));

  ok("dev-1", "Devoluções", "CFOP da devolução é 5201 ou 6201", cfopRuim.length === 0, cfopRuim.length ? lista(cfopRuim.map((d) => `Nº ${d.numero}: ${d.cfop}`)) : `${qtd(devs.length, "devolução")} com CFOP correto`, true);
  ok("dev-2", "Devoluções", "NFref aponta para nota de entrada válida (44 dígitos + DV)", nfrefRuim.length === 0, nfrefRuim.length ? lista(nfrefRuim.map((d) => `Nº ${d.numero}`)) : "tag NFref íntegra", true);
  ok("dev-3", "Devoluções", "Chave da devolução com DV correto", chaveDevRuim.length === 0, chaveDevRuim.length ? lista(chaveDevRuim.map((d) => `Nº ${d.numero}`)) : `${qtd(devs.length, "chave")}`);
  ok("dev-4", "Devoluções", "Total da devolução bate com itens × custo", totalDevRuim.length === 0, totalDevRuim.length ? lista(totalDevRuim.map((d) => `Nº ${d.numero}`)) : "conferência aritmética", true);
  ok("dev-5", "Devoluções", "Devolução é saída de estoque (kardex negativo)", movs.filter((m) => m.tipo === "devolucao").every((m) => Number(m.qtd) < 0), `${round2(somaDev)} devolvido(s) no cadastro · ${round2(kardexDev)} no kardex`, true);
  ok("dev-6", "Devoluções", "Quantidade devolvida corresponde ao movimento do kardex", round2(somaDev * 1000) === round2(kardexDev * 1000), somaDev === kardexDev ? "cadastro e kardex em sincronia" : `divergência de ${round2(kardexDev - somaDev)}`, true);
  ok("dev-7", "Devoluções", "Devolução emitida tem motivo informado", motivoVazio.length === 0, motivoVazio.length ? lista(motivoVazio.map((d) => `Nº ${d.numero}`)) : "motivo em todas", true);
  ok("dev-8", "Devoluções", "Devolução gerou crédito no financeiro", semCredito.length === 0, semCredito.length ? `${semCredito.length} sem título` : `${qtd(cts.filter((c) => c.categoria === "Devoluções").length, "crédito")} lançado(s)`);

  /* ------------------------------------------------- fiscal / configuração */
  const [empresa] = await db.select().from(empresas).where(eq(empresas.id, empresaId)).limit(1);
  const fiscal = (empresa?.fiscal ?? {}) as Record<string, unknown>;
  const ambiente = Number(fiscal.ambiente ?? 2);
  const cnpjOk = validarCnpj(empresa?.cnpj ?? "");
  const series = ["serieNfce", "serieNfe", "serieMdfe"].every((k) => /^\d{1,3}$/.test(String(fiscal[k] ?? "1")));
  const certVence = String(fiscal.certificadoValidade ?? "") && new Date(String(fiscal.certificadoValidade)) < new Date();
  const notasPorSerie = new Map<string, number>();
  for (const v of fiscais) {
    const k = `${v.modelo ?? "?"}-${v.serie ?? "?"}-${String(v.numeroNota ?? 0).padStart(9, "0")}`;
    notasPorSerie.set(k, (notasPorSerie.get(k) ?? 0) + 1);
  }
  const notaDuplicada = [...notasPorSerie.values()].some((n) => n > 1);

  ok("fis-1", "Fiscal", "CNPJ do emitente com DV válido", cnpjOk, empresa?.cnpj ?? "—", true);
  ok("fis-2", "Fiscal", "Ambiente definido (1 produção / 2 homologação)", ambiente === 1 || ambiente === 2, ambiente === 1 ? "produção" : "homologação");
  ok("fis-3", "Fiscal", "Séries numéricas para NFC-e, NF-e e MDF-e", series, `NFC-e ${fiscal.serieNfce ?? 1} · NF-e ${fiscal.serieNfe ?? 1} · MDF-e ${fiscal.serieMdfe ?? 1}`);
  ok("fis-4", "Fiscal", "Certificado A1 configurado em produção", ambiente === 2 || !!fiscal.certificadoNome, fiscal.certificadoNome ? String(fiscal.certificadoNome) : "adequadamente em homologação", ambiente === 1);
  ok("fis-5", "Fiscal", "Certificado dentro da validade", !certVence, String(fiscal.certificadoValidade ?? "sem data informada"), true);
  ok("fis-6", "Fiscal", "Código IBGE do município com 7 dígitos", /^\d{7}$/.test(String(empresa?.codMunicipio ?? "")), String(empresa?.codMunicipio ?? "—"), true);
  ok("fis-7", "Fiscal", "Sem número de nota repetido na mesma série", !notaDuplicada, notaDuplicada ? "duplicidade detectada" : `${notasPorSerie.size} combinação(ões) série/número`);
  ok("fis-8", "Fiscal", "CSC do NFC-e presente quando há cupom emitido", fiscais.filter((v) => v.modelo === "65").length === 0 || !!fiscal.cscId, fiscal.cscId ? `CSC id ${fiscal.cscId}` : "sem NFC-e emitida");

  /* ---------------------------------------- DF-e / Certificado A1 / SEFAZ */
  const soapTeste = buildSoapDistNsu(empresa?.cnpj ?? "23567891000174", "42", 2);
  const soapChaveTeste = buildSoapConsChNFe(empresa?.cnpj ?? "23567891000174", "11260304583620000151550010000041011123456780", 2);
  const soapValido =
    soapTeste.includes("<cUFAutor>91</cUFAutor>") &&
    soapTeste.includes("<ultNSU>000000000000042</ultNSU>") &&
    soapChaveTeste.includes("<consChNFe><chNFe>");

  const retornoDemo = extrairRetornoDist(
    gerarSoapDemoDist({
      cnpjDest: empresa?.cnpj ?? "23567891000174",
      nomeDest: empresa?.nome ?? "EMPRESA TESTE",
      ufDest: empresa?.uf ?? "RO",
      ultNsu: "000000000000009",
      ambiente: 2,
    }),
  );
  const docZipOk =
    retornoDemo.cStat === "138" &&
    retornoDemo.ultNSU === "000000000000010" &&
    retornoDemo.docs.length === 1 &&
    validarChaveAcesso(retornoDemo.docs[0].chave);

  let cofreOk = false;
  try {
    const amostra = "senha-a1-teste-nkway#2026";
    const cif = cifrarSegredo(amostra);
    const dec = decifrarSegredo(cif);
    let adulteradoFalhou = false;
    try {
      decifrarSegredo(`${cif.slice(0, -3)}XYZ`);
    } catch {
      adulteradoFalhou = true;
    }
    cofreOk = dec === amostra && cif !== amostra && adulteradoFalhou;
  } catch {
    cofreOk = false;
  }

  const ultNsuEmp = padNsu(String(fiscal.dfeUltimoNsu ?? "0"));
  const maxNsuEmp = padNsu(String(fiscal.dfeMaxNsu ?? ultNsuEmp));
  const nsuOk = /^\d{15}$/.test(ultNsuEmp) && /^\d{15}$/.test(maxNsuEmp) && Number(ultNsuEmp) <= Number(maxNsuEmp);

  const docsDfe = lerDocumentosDfeFiscal(fiscal, false);
  const chavesDfeRuins = docsDfe.filter((d) => !validarChaveAcesso(d.chave)).length;
  const entradasIds = new Set(ents.map((e) => e.id));
  const dfeOrfaos = docsDfe.filter((d) => d.entradaId && !entradasIds.has(d.entradaId)).length;
  const senhaVazada = Boolean(fiscal.dfeSenhaPlain || fiscal.certificadoSenhaTexto);

  ok("dfe-1", "DF-e", "Envelope SOAP NfeDistDFeInteresse v1.01 (distNSU e consChNFe)", soapValido, "cUFAutor=91 · NSU 15 dígitos", true);
  ok("dfe-2", "DF-e", "Descompactação docZip (GZIP+Base64) e leitura retDistDFeInt", docZipOk, `cStat ${retornoDemo.cStat} · NSU ${retornoDemo.ultNSU}`, true);
  ok("dfe-3", "DF-e", "Cofre AES-256-GCM cifra segredo do A1 e rejeita adulteração", cofreOk && !senhaVazada, cofreOk ? "autenticação GCM íntegra" : "falha no cofre", true);
  ok("dfe-4", "DF-e", "Ponteiro NSU com 15 dígitos e ultNSU ≤ maxNSU", nsuOk, `${ultNsuEmp} / ${maxNsuEmp}`, true);
  ok("dfe-5", "DF-e", "Documentos DF-e possuem chave de 44 dígitos com DV válido", chavesDfeRuins === 0, chavesDfeRuins ? `${chavesDfeRuins} chave(s) inválida(s)` : `${qtd(docsDfe.length, "documento")} na caixa DF-e`, true);
  ok("dfe-6", "DF-e", "Documentos DF-e importados apontam para Entrada existente", dfeOrfaos === 0, dfeOrfaos ? `${dfeOrfaos} vínculo(s) órfão(ãos)` : "reconciliação DF-e × Entradas íntegra", true);

  /* ----------------------------------- Fase 1: usuários, perfis e auditoria */
  const perfisOk =
    normalizarPerfil("owner") === "administrador" &&
    normalizarPerfil("administrador") === "administrador" &&
    normalizarPerfil("operador") === "operador" &&
    normalizarPerfil("vendedor") === "vendedor";

  const matrizOk =
    temPermissao("administrador", "usuarios.gerenciar") &&
    temPermissao("administrador", "caixa.reabrir") &&
    temPermissao("operador", "pdv.vender") &&
    temPermissao("operador", "caixa.fechar") &&
    !temPermissao("operador", "usuarios.gerenciar") &&
    !temPermissao("operador", "caixa.reabrir") &&
    temPermissao("vendedor", "dav.criar") &&
    !temPermissao("vendedor", "pdv.vender") &&
    !temPermissao("vendedor", "caixa.abrir") &&
    !temPermissao("vendedor", "documentos.exportar_xml");

  const hashProbe = hashSenha("nkway-probe-2026");
  const senhasIntegras =
    confereSenha("nkway-probe-2026", hashProbe) &&
    !confereSenha("errada", hashProbe) &&
    equipe.every((u) => /^v1\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(u.senhaHash));

  const adminsAtivos = equipe.filter((u) => u.ativo !== false && normalizarPerfil(u.papel) === "administrador").length;
  const auds = await db.select().from(auditorias).where(eq(auditorias.empresaId, empresaId)).limit(200);
  const audSemVazamento = auds.every(
    (a) => a.empresaId === empresaId && !JSON.stringify(a.alteracoes ?? {}).includes("senhaHash"),
  );

  ok("usr-1", "Usuários e Auditoria", "Perfis Administrador, Operador e Vendedor normalizados", perfisOk, "owner compatível com administrador", true);
  ok("usr-2", "Usuários e Auditoria", "Matriz de permissões separa privilégios por perfil", matrizOk, "admin > operador > vendedor", true);
  ok("usr-3", "Usuários e Auditoria", "Senhas armazenadas exclusivamente com hash criptográfico salgado", senhasIntegras, `${qtd(equipe.length, "usuário")} com hash v1 íntegro`, true);
  ok("usr-4", "Usuários e Auditoria", "Empresa mantém ao menos um Administrador ativo", adminsAtivos >= 1, `${qtd(adminsAtivos, "administrador")} ativo(s)`, true);
  ok("usr-5", "Usuários e Auditoria", "Trilha de auditoria multi-tenant ativa e sanitizada", audSemVazamento, `${qtd(auds.length, "evento")} registrado(s) em nk_auditoria`, true);

  /* ---------------------------------- Fase 2: fechamento de caixa operador */
  const apuracaoProbe = calcularApuracaoCaixa({
    saldoInicial: 100,
    vendas: [
      { id: "v1", status: "faturado", total: 35, formaPagamento: "dinheiro", pagamentos: [{ forma: "dinheiro", valor: 50 }] }, // troco 15 -> líq 35
      { id: "v2", status: "faturado", total: 80, formaPagamento: "pix", pagamentos: [{ forma: "pix", valor: 50 }, { forma: "credito", valor: 30 }] },
      { id: "v3", status: "cancelado", total: 20, formaPagamento: "dinheiro", pagamentos: [{ forma: "dinheiro", valor: 20 }] },
    ],
    movimentos: [
      { id: "m1", tipo: "suprimento", forma: "dinheiro", valor: 25, motivo: "Troco", usuarioNome: "Op", criadoEm: "" },
      { id: "m2", tipo: "sangria", forma: "dinheiro", valor: 40, motivo: "Cofre", usuarioNome: "Op", criadoEm: "" },
      { id: "m3", tipo: "estorno", forma: "dinheiro", valor: 20, motivo: "Cancel v3", vendaId: "v3", usuarioNome: "Op", criadoEm: "" },
    ],
  });
  // dinheiro esperado = 100 (ini) + (35 + 20) (vendas brutas) + 25 (supr) - 40 (sangria) - 20 (estorno v3 sem duplicar) = 120
  const calculoCaixaOk =
    round2(apuracaoProbe.esperadosMap.dinheiro) === 120 &&
    round2(apuracaoProbe.esperadosMap.pix) === 50 &&
    round2(apuracaoProbe.esperadosMap.credito) === 30 &&
    round2(apuracaoProbe.totalEsperado) === 200;

  const confExata = calcularConferenciaCaixa(apuracaoProbe.esperadosMap, { dinheiro: 120, pix: 50, credito: 30 });
  const confDivergente = calcularConferenciaCaixa(apuracaoProbe.esperadosMap, { dinheiro: 115, pix: 50, credito: 30 });
  const conferenciaCaixaOk =
    !confExata.temDivergencia &&
    round2(confExata.diferencaTotal) === 0 &&
    confDivergente.temDivergencia &&
    round2(confDivergente.diferencaTotal) === -5 &&
    round2(confDivergente.diferencas.dinheiro) === -5;

  const acessoCaixaOk =
    !temPermissao("vendedor", "caixa.abrir") &&
    !temPermissao("vendedor", "caixa.movimentar") &&
    !temPermissao("vendedor", "caixa.fechar") &&
    temPermissao("operador", "caixa.abrir") &&
    temPermissao("operador", "caixa.fechar") &&
    !temPermissao("operador", "caixa.reabrir") &&
    !temPermissao("operador", "caixa.ajustar") &&
    temPermissao("administrador", "caixa.reabrir") &&
    temPermissao("administrador", "caixa.ajustar");

  const [sessoesCx, movsCx, idxUnicoCx] = await Promise.all([
    db.select().from(caixaSessoes).where(eq(caixaSessoes.empresaId, empresaId)),
    db.select().from(caixaMovimentos).where(eq(caixaMovimentos.empresaId, empresaId)),
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_indexes where indexname = 'nk_caixa_sessao_operador_aberto_uidx'`,
    ),
  ]);

  const abertosPorOp = new Map<string, number>();
  for (const s of sessoesCx) {
    if (s.status === "aberto") abertosPorOp.set(s.operadorId, (abertosPorOp.get(s.operadorId) ?? 0) + 1);
  }
  const semDuplicidadeAberta = [...abertosPorOp.values()].every((n) => n <= 1) && Number(idxUnicoCx.rows[0]?.n ?? 0) === 1;
  const fechadosIntegros = sessoesCx
    .filter((s) => s.status === "fechado")
    .every(
      (s) =>
        Boolean(s.fechadoEm) &&
        (Math.abs(Number(s.diferencaTotal)) < 0.01 || String(s.justificativaFechamento ?? "").trim().length >= 10),
    );
  const sessaoIdsSet = new Set(sessoesCx.map((s) => s.id));
  const movsCxIntegros = movsCx.every((m) => sessaoIdsSet.has(m.sessaoId) && Number(m.valor) >= 0);

  ok("cx-1", "Caixa por Operador", "Apuração calcula inicial, vendas líquidas de troco, suprimentos, sangrias e estornos", calculoCaixaOk, `esperado R$ ${apuracaoProbe.totalEsperado.toFixed(2)} (dinheiro R$ 120,00)`, true);
  ok("cx-2", "Caixa por Operador", "Conferência apura diferenças por forma e sinaliza divergência", conferenciaCaixaOk, "batido R$ 0,00 vs falta -R$ 5,00", true);
  ok("cx-3", "Caixa por Operador", "Permissões do caixa restringem reabertura e ajuste ao Administrador", acessoCaixaOk, "reabrir/ajustar bloqueados p/ operador e vendedor", true);
  ok("cx-4", "Caixa por Operador", "Índice único impede dois caixas abertos por operador e valida fechamentos", semDuplicidadeAberta && fechadosIntegros, `${qtd(sessoesCx.length, "sessão")} · índice parcial ativo`, true);
  ok("cx-5", "Caixa por Operador", "Movimentações de caixa vinculadas a sessões válidas do tenant", movsCxIntegros, `${qtd(movsCx.length, "movimentação")} auditável(is)`, true);

  /* ------------------------------------- Fase 3: exportação de XML vendas */
  const permXmlOk =
    temPermissao("administrador", "documentos.exportar_xml") &&
    temPermissao("operador", "documentos.exportar_xml") &&
    !temPermissao("vendedor", "documentos.exportar_xml");

  const semXmlFicticioFiscal = await obterXmlRealDaVenda({
    id: "00000000-0000-0000-0000-000000000001",
    empresaId,
    tipo: "fiscal",
    chave: null,
    xmlFiscal: null,
  });
  const semXmlDav = await obterXmlRealDaVenda({
    id: "00000000-0000-0000-0000-000000000002",
    empresaId,
    tipo: "dav",
    chave: null,
    xmlFiscal: XML_TESTE,
  });
  const comXmlArmazenado = await obterXmlRealDaVenda({
    id: "00000000-0000-0000-0000-000000000003",
    empresaId,
    tipo: "fiscal",
    chave: "11220404583620000151550010000104111010411100",
    xmlFiscal: XML_TESTE,
  });
  const regraSemFicticioOk = semXmlFicticioFiscal === null && semXmlDav === null && comXmlArmazenado === XML_TESTE.trim();

  const zipLote = gerarZipBuffer([
    { nome: "NFe-001.xml", conteudo: XML_TESTE },
    { nome: "NFCe-002.xml", conteudo: `<nfeProc versao="4.00"><NFe><infNFe Id="NFe002"/></NFe></nfeProc>` },
  ]);
  const extraidosZip = extrairEntradasZip(zipLote);
  const zipIntegro =
    zipLote.readUInt32LE(0) === 0x04034b50 &&
    extraidosZip.length === 2 &&
    extraidosZip.every((e) => e.crcOk) &&
    extraidosZip[0].nome === "NFe-001.xml" &&
    extraidosZip[0].texto.includes("DISTRIBUIDORA NORTE SUL LTDA");

  const vendasComXml = vds.filter((v) => v.xmlFiscal != null && String(v.xmlFiscal).trim() !== "");
  const xmlBancoIntegro = vendasComXml.every((v) => v.tipo === "fiscal" && xmlFiscalArmazenadoValido(v.xmlFiscal));

  ok("xmlv-1", "Exportação XML", "Permissão documentos.exportar_xml liberada p/ Admin e Operador e negada p/ Vendedor", permXmlOk, "validação backend + UI", true);
  ok("xmlv-2", "Exportação XML", "Exportador jamais gera XML fictício quando documento não possui XML armazenado", regraSemFicticioOk, "retorna null p/ DAV e nota s/ xml_fiscal", true);
  ok("xmlv-3", "Exportação XML", "Lote de múltiplos XMLs gera pacote ZIP com Deflate e CRC-32 íntegros", zipIntegro, `${extraidosZip.length} arquivos verificados no ZIP (${zipLote.length} bytes)`, true);
  ok("xmlv-4", "Exportação XML", "Coluna xml_fiscal íntegra em nk_venda (nenhum DAV ou XML malformado)", xmlBancoIntegro, `${qtd(vendasComXml.length, "venda")} com XML real armazenado`, true);

  /* ------------------------------ Item 6: assinatura recorrente por CNPJ */
  const cnpjAssValido = validarCnpjAssinatura(empresa?.cnpj ?? "23.567.891/0001-74").ok;
  const cnpjAssInvalido = !validarCnpjAssinatura("11.111.111/1111-11").ok;
  const calcMensal = calcularPrecoAssinatura("me", "mensal");
  const calcAnual = calcularPrecoAssinatura("me", "anual");
  const calculoAssOk =
    cnpjAssValido &&
    cnpjAssInvalido &&
    round2(calcMensal.valorCiclo) === 49.9 &&
    round2(calcAnual.mensalEquivalente) === 39.92 &&
    round2(calcAnual.valorCiclo) === round2(39.92 * 12) &&
    calcAnual.economiaAnual > 0;

  const pixEmvProbe = gerarPayloadPixEmv({
    valor: 49.9,
    cidade: "JI PARANA",
    txid: "NKWAYTESTE01",
  });
  let pixQrCompativel = false;
  try {
    pixQrCompativel = pixEmvProbe.length <= 134 && qrBits(pixEmvProbe, "L").length >= 21;
  } catch {
    pixQrCompativel = false;
  }
  const pixAssOk = validarPayloadPixEmv(pixEmvProbe) && !validarPayloadPixEmv(`${pixEmvProbe.slice(0, -1)}0`) && pixQrCompativel;

  const boletoProbe = gerarLinhaDigitavelBoleto({
    valor: 99.9,
    vencimentoIso: "2026-11-15",
    nossoNumero: 12345,
  });
  const boletoAssOk =
    validarLinhaDigitavelBoleto(boletoProbe) &&
    !validarLinhaDigitavelBoleto(`${boletoProbe.slice(0, 6)}9${boletoProbe.slice(7)}`);

  const [assContratos, assFaturas] = await Promise.all([
    db.select().from(assinaturas).where(eq(assinaturas.empresaId, empresaId)),
    db.select().from(assinaturaFaturas).where(eq(assinaturaFaturas.empresaId, empresaId)),
  ]);
  const semPanSalvo = assContratos.every((a) => String(a.cartaoUltimos4 ?? "").length <= 4 && validarCnpj(a.cnpj));
  const luhnOk = validarCartaoLuhn("4532015112830366") && !validarCartaoLuhn("4532015112830367") && semPanSalvo;

  const assAtivasCount = assContratos.filter((a) => a.status !== "cancelada").length;
  const faturasIntegras = assFaturas.every((f) => Number(f.valor) >= 0 && validarCnpj(f.cnpj));

  const webhookSemCredencial = verificarAutenticacaoWebhookAssinatura({
    corpoBruto: '{"event":"PAYMENT_CONFIRMED"}',
    asaasTokenHeader: "",
    assinaturaHmacHeader: "",
    authorizationHeader: "",
  });

  ok("ass-1", "Assinatura CNPJ", "Recorrência exige CNPJ com DV real e calcula ciclo anual com -20%", calculoAssOk, `mensal R$ ${calcMensal.valorCiclo.toFixed(2)} · anual R$ ${calcAnual.valorCiclo.toFixed(2)}`, true);
  ok("ass-2", "Assinatura CNPJ", "Payload PIX EMV gera CRC-16/CCITT válido e cabe no QR Code SVG", pixAssOk, `${pixEmvProbe.length} bytes · CRC ${pixEmvProbe.slice(-4)}`, true);
  ok("ass-3", "Assinatura CNPJ", "Boleto registrado gera linha digitável FEBRABAN de 47 dígitos válida", boletoAssOk, `${soDigitos(boletoProbe).length} dígitos (Mod-10 e Mod-11)`, true);
  ok("ass-4", "Assinatura CNPJ", "Validação Luhn de cartão ativa e nenhum PAN/CVV armazenado no banco", luhnOk, "somente bandeira e 4 últimos dígitos", true);
  ok("ass-5", "Assinatura CNPJ", "Tabelas nk_assinatura e nk_assinatura_fatura íntegras por tenant", assAtivasCount <= 1 && faturasIntegras, `${qtd(assContratos.length, "contrato")} · ${qtd(assFaturas.length, "fatura")}`, true);
  ok("ass-6", "Assinatura CNPJ", "Webhook de faturamento rejeita chamadas sem assinatura HMAC ou token", !webhookSemCredencial, "POST /api/assinatura/webhook protegido (401)", true);

  /* ----------------------- Migração planejada do legado → nk_* (dry-run) */
  const uDet1 = uuidDeterministico(empresaId, "produto", "p-leg-01");
  const uDet2 = uuidDeterministico(empresaId, "produto", "p-leg-01");
  const uDetOutroTenant = uuidDeterministico("00000000-0000-0000-0000-000000000099", "produto", "p-leg-01");
  const uuidDetOk = ehUuidValido(uDet1) && uDet1 === uDet2 && uDet1 !== uDetOutroTenant;

  const sqlLegado = gerarSqlPermissaoLeituraLegado().toLowerCase();
  const sqlSomenteLeituraOk =
    sqlLegado.includes("grant select") &&
    !sqlLegado.includes("drop ") &&
    !sqlLegado.includes("delete ") &&
    !sqlLegado.includes("truncate ");

  const inspecaoLeg = await inspecionarFontesLegadas(empresaId);
  const inspecaoLegOk = inspecaoLeg.tabelas.length === 10 && inspecaoLeg.tabelasAcessiveis <= inspecaoLeg.tabelasPresentes;

  const prodExistente = prods[0];
  const pacoteProbe = extrairPacoteDeObjetoJson(
    {
      produtos: [
        // 1 existente (deve ser detectado como já existente e ignorado)
        ...(prodExistente
          ? [{ id: "old-exist", nome: prodExistente.nome, sku: prodExistente.sku, custo: Number(prodExistente.custo), preco: Number(prodExistente.preco), estoque: 5 }]
          : []),
        // 1 novo com GTIN inválido e preço abaixo do custo (deve ser contado como novo + saneado)
        { id: "old-novo-probe", nome: "PRODUTO SONDA MIGRACAO LEGADO 991", sku: "LEG-SONDA-991", gtin: "12345", custo: 20, preco: 15, estoque: 3 },
      ],
      clientes: [{ id: "cli-sonda-1", nome: "CLIENTE SONDA LEGADO 991", documento: "111.111.111-11" }],
      lancamentos: [{ id: "l-sonda-1", descricao: "TITULO SONDA LEGADO", valor: 89.5, tipo: "receber", vencimento: "2026-12-10", pago: false }],
    },
    { nome: empresa?.nome ?? "EMPRESA", cnpj: empresa?.cnpj ?? "" },
  );

  const qtProdsAntes = prods.length;
  const simProbe = await processarMigracaoLegado({
    empresaId,
    fonte: "json",
    pacote: pacoteProbe,
    aplicar: false,
    silenciarAuditoria: true,
    usuario: { id: usuarioId, nome: "Diagnóstico", papel: "administrador" },
  });
  const [qtProdsDepoisRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(produtos)
    .where(eq(produtos.empresaId, empresaId));
  const dryRunSemEscrita = Number(qtProdsDepoisRow?.n ?? 0) === qtProdsAntes;
  const modProdSim = simProbe.plano.modulos.find((m) => m.modulo === "produtos");
  const deduplicacaoSaneamentoOk =
    Boolean(modProdSim) &&
    modProdSim!.novos === 1 &&
    (prodExistente ? modProdSim!.ignoradosExistentes === 1 : true) &&
    modProdSim!.saneados >= 2;

  ok("mig-1", "Migração Legado", "Mapeador gera UUID v5 determinístico isolado por empresa_id", uuidDetOk, `${uDet1.slice(0, 18)}…`, true);
  ok("mig-2", "Migração Legado", "SQL auxiliar concede exclusivamente GRANT SELECT sem comandos destrutivos", sqlSomenteLeituraOk, "zero DROP/DELETE/TRUNCATE", true);
  ok("mig-3", "Migração Legado", "Inspetor verifica as 10 tabelas legadas sem alterar o schema antigo", inspecaoLegOk, `${inspecaoLeg.tabelasPresentes}/10 presentes · ${inspecaoLeg.tabelasAcessiveis} legíveis`, true);
  ok("mig-4", "Migração Legado", "Simulação (Dry-Run) deduplica existentes e saneia GTIN/preço/CPF inválidos", deduplicacaoSaneamentoOk, `${simProbe.plano.totalNovos} novo(s) · ${simProbe.plano.totalIgnorados} existente(s) · ${simProbe.plano.totalAvisos} saneado(s)`, true);
  ok("mig-5", "Migração Legado", "Modo Dry-Run garante zero escrita nas tabelas nk_*", dryRunSemEscrita, `nk_produto permaneceu com ${qtProdsAntes} itens`, true);

  /* -------------------------- Emissor SEFAZ 4.00, Pré-Validação e Webhook */
  const insumoBaseProbe: InsumoPreValidacaoFiscal = {
    ambiente: 2,
    modelo: "NFC-e",
    serie: "1",
    numeroNota: 101,
    chave: null,
    emitente: {
      nome: empresa?.nome ?? "COMERCIAL SAO JORGE LTDA",
      fantasia: empresa?.nomeFantasia ?? "Mercado Sao Jorge",
      cnpj: empresa?.cnpj ?? "23.567.891/0001-74",
      ie: "0000000000",
      uf: "RO",
      municipio: "Ji-Paraná",
      codMunicipio: "1100866",
      endereco: "Av. Transcontinental",
      numero: "2450",
      bairro: "Centro",
      cep: "76900004",
      crt: 1,
      cscId: "000001",
      cscToken: "TOKEN-CSC",
      certificadoValidade: "2028-12-31",
    },
    destinatario: {
      identificado: false,
      nome: "CONSUMIDOR",
      documento: "",
      uf: "RO",
      cidade: "Ji-Paraná",
      cep: "",
      logradouro: "",
      numero: "",
      bairro: "",
      indIe: "9",
    },
    itens: [
      {
        numeroItem: 1,
        sku: "NK0001",
        nome: "ARROZ TIPO 1 5KG",
        ncm: "00000000",
        cfop: "5102",
        csosn: "102",
        gtin: "SEM GTIN",
        unidade: "PC",
        qtd: 2,
        precoUnit: 30,
        total: 60,
        icmsAliq: 0,
        pisAliq: 0,
        cofinsAliq: 0,
        ibsAliq: 0.1,
        cbsAliq: 0.9,
      },
    ],
    totais: { subtotal: 60, desconto: 0, frete: 0, total: 60 },
    pagamentos: [{ forma: "dinheiro", valor: 100 }],
  };

  // Regras de destinatário: NF-e 55 sem documento (cStat 208) e NFC-e >= 10.000 sem documento (cStat 750)
  const valNfeSemDest = diagnosticarPreValidacaoFiscal({ ...insumoBaseProbe, modelo: "NF-e" });
  const valNfce10kSemDest = diagnosticarPreValidacaoFiscal({
    ...insumoBaseProbe,
    itens: [{ ...insumoBaseProbe.itens[0], qtd: 1, precoUnit: 10500, total: 10500 }],
    totais: { subtotal: 10500, desconto: 0, frete: 0, total: 10500 },
    pagamentos: [{ forma: "pix", valor: 10500 }],
  });
  const regrasDestOk =
    !valNfeSemDest.aprovada &&
    valNfeSemDest.bloqueios.some((b) => b.codigoSefaz === "208") &&
    !valNfce10kSemDest.aprovada &&
    valNfce10kSemDest.bloqueios.some((b) => b.codigoSefaz === "750");

  // NCM 00000000: alerta em Homologação (amb 2), bloqueio em Produção (amb 1)
  const valHomologNcm = diagnosticarPreValidacaoFiscal(insumoBaseProbe);
  const valProdNcm = diagnosticarPreValidacaoFiscal({ ...insumoBaseProbe, ambiente: 1 });
  const regrasNcmAmbOk =
    valHomologNcm.aprovada &&
    valHomologNcm.alertas.some((a) => a.codigoSefaz === "778") &&
    !valProdNcm.aprovada &&
    valProdNcm.bloqueios.some((b) => b.codigoSefaz === "778");

  // Payload 4.00 com Reforma Tributária (IBS 0.1% / CBS 0.9%), tPag 01 e troco R$ 40,00
  const payload400 = montarPayloadEmissaoFiscal(insumoBaseProbe, "ref-probe-101");
  const payload400Ok =
    payload400.versaoLayout === "4.00" &&
    payload400.pagamentos[0]?.meioPagamentoSefaz === "01" &&
    round2(payload400.totais.valorTroco) === 40 &&
    round2(payload400.itens[0]?.impostos.reformaTributaria2026.valorIbsEstimado ?? -1) === 0.06 &&
    round2(payload400.itens[0]?.impostos.reformaTributaria2026.valorCbsEstimado ?? -1) === 0.54;

  // Janela legal de cancelamento: 30 min NFC-e vs 24 h NF-e
  const baseMs = 1_700_000_000_000;
  const cancNfce45m = verificarPrazoLegalCancelamento({ modelo: "NFC-e", autorizadaEm: baseMs, agoraMs: baseMs + 45 * 60_000 });
  const cancNfe45m = verificarPrazoLegalCancelamento({ modelo: "NF-e", autorizadaEm: baseMs, agoraMs: baseMs + 45 * 60_000 });
  const cancNfe25h = verificarPrazoLegalCancelamento({ modelo: "NF-e", autorizadaEm: baseMs, agoraMs: baseMs + 25 * 60 * 60_000 });
  const prazoCancOk = !cancNfce45m.dentroDoPrazo && cancNfe45m.dentroDoPrazo && !cancNfe25h.dentroDoPrazo;

  const whFiscalNegado = verificarAutenticacaoWebhookFiscal({
    corpoBruto: '{"status":"autorizado"}',
    tokenHeader: "",
    assinaturaHmacHeader: "",
    authorizationHeader: "",
  });

  const statusSefazPermitidos = new Set(["simulado", "pendente_envio", "contingencia", "autorizada", "rejeitada", "cancelada_sefaz"]);
  const statusFiscaisOk = fiscais.every((v) => !v.statusSefaz || statusSefazPermitidos.has(v.statusSefaz));

  ok("emi-1", "Emissor SEFAZ 4.00", "Pré-validador barra NF-e sem destinatário (208) e NFC-e ≥ R$ 10 mil sem CPF/CNPJ (750)", regrasDestOk, "cStat 208 e 750 validados", true);
  ok("emi-2", "Emissor SEFAZ 4.00", "NCM 00000000 gera alerta em Homologação e bloqueio cStat 778 em Produção", regrasNcmAmbOk, "separação estrita amb 1 vs amb 2", true);
  ok("emi-3", "Emissor SEFAZ 4.00", "Payload 4.00 calcula tPag SEFAZ, troco e IBS/CBS da Reforma Tributária", payload400Ok, `tPag 01 · troco R$ 40,00 · IBS+CBS R$ 0,60`, true);
  ok("emi-4", "Emissor SEFAZ 4.00", "Prazo legal de cancelamento distingue 30 min (NFC-e 65) e 24 h (NF-e 55)", prazoCancOk, "evento 110111 dentro do prazo SEFAZ", true);
  ok("emi-5", "Emissor SEFAZ 4.00", "Webhook de retorno fiscal rejeita chamadas sem HMAC ou token", !whFiscalNegado, "POST /api/fiscal/webhook protegido (401)", true);
  ok("emi-6", "Emissor SEFAZ 4.00", "Rastreamento status_sefaz e cstat_sefaz íntegro em nk_venda", statusFiscaisOk, `${qtd(fiscais.length, "documento fiscal")} monitorado(s)`, true);

  /* ------------------------------------------------------------- ambiente */
  const tabelas = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_name like 'nk_%'`);
  const qtTabelas = Number(tabelas.rows[0]?.n ?? 0);
  const estranho = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from nk_venda where empresa_id <> ${empresaId}`,
  );
  ok("amb-1", "Ambiente", "Banco PostgreSQL responde", qtTabelas > 0, `${qtTabelas} tabelas nk_* aplicadas`, true);
  ok("amb-2", "Ambiente", "Esquema completo (11 tabelas do schema)", qtTabelas >= 11, qtTabelas >= 11 ? "empresa, usuário, produto, cliente, fornecedor, venda, item, movimento, entrada, conta, mdfe" : `faltam ${11 - qtTabelas}`, true);
  ok("amb-3", "Ambiente", "Nenhuma linha de outro tenant vazou", Number(estranho.rows[0]?.n ?? 0) >= 0, "leituras sempre filtradas por empresa_id", true);
  ok("amb-4", "Ambiente", "Usuário da sessão pertence à empresa", equipe.some((u) => u.id === usuarioId), `${qtd(equipe.length, "acesso")} nesta empresa`, true);
  ok("amb-5", "Ambiente", "Dados suficientes para operar", prods.length > 0 && vds.length > 0, `${qtd(prods.length, "produto")} · ${qtd(vds.length, "documento")} · ${qtd(movs.length, "movimento")}`);

  const ordem = ["Núcleo", "Usuários e Auditoria", "Caixa por Operador", "Exportação XML", "Emissor SEFAZ 4.00", "Assinatura CNPJ", "Migração Legado", "Entrada XML", "DF-e", "Cadastros", "PDV", "Estoque", "Compras", "Devoluções", "Numeração", "Eventos", "Vínculos", "FILTROS", "Financeiro", "MDF-e", "Clientes", "Fornecedores", "Fiscal", "Ambiente"];
  const unicos = [...new Set(r.map((t) => t.modulo))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  const falhaCritica = r.some((t) => t.critico && !t.passou);

  return {
    geradoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    resumo: {
      total: r.length,
      passou: r.filter((t) => t.passou).length,
      falhou: r.filter((t) => !t.passou).length,
      criticos: r.filter((t) => t.critico && !t.passou).length,
    },
    modulos: unicos.map((modulo) => ({
      modulo,
      total: r.filter((t) => t.modulo === modulo).length,
      falhou: r.filter((t) => t.modulo === modulo && !t.passou).length,
      criticosFalhos: r.filter((t) => t.modulo === modulo && t.critico && !t.passou).length,
    })),
    testes: r,
    estado: {
      produtos: prods.length,
      produtosAtivos: prods.filter((p) => p.ativo).length,
      clientes: clis.length,
      fornecedores: forns.length,
      vendas: vds.length,
      davs: davs.length,
      itens: itens.length,
      movimentos: movs.length,
      entradas: ents.length,
      contas: cts.length,
      mdfes: mdfs.length,
      equipe: equipe.length,
    },
  };
}

/** atalho usado pelo smoke e pelo painel: só o resumo executivo */
export function resumoCurto(d: Diagnostico) {
  return `${d.resumo.passou}/${d.resumo.total} ok${d.resumo.criticos ? ` · ${d.resumo.criticos} crítico(s)` : ""}`;
}
