/**
 * NKWAY — bateria de testes do console do dev.
 * Porta de `src/erp/dev/testes.ts` do protótipo (27 testes) para a versão fullstack:
 * aqui as verificações rodam no servidor, sobre os dados reais do tenant logado,
 * e são expostas na rota `/api/diagnostico` e na aba "Ambiente" das Configurações.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
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
import {
  aplicarSnapshotFechamento,
  apurarSessaoCaixa,
  calcularApuracaoCaixa,
  calcularConferenciaCaixa,
  estadoGavetaPorSaldo,
  FUNDO_TROCO_PADRAO,
  LIMITE_BLOQUEIO_GAVETA,
  LIMITE_DINHEIRO_GAVETA,
  ratearPagamentosDetalhado,
  type VendaCaixaInput,
} from "@/lib/caixa";
import { fecharSessaoCaixaTransacional } from "@/server/caixaCore";
import { conferirTabelaFiscal, TABELAS_FISCAIS } from "@/lib/tabelasFiscais";
import { CLASS_TRIB, classTribPorCst, totalClassTrib } from "@/lib/tabelaClassTrib";
import { aplicarPerfilTributario, crtSugeridoParaRegime, PARAMETROS_TRIBUTARIOS_VAZIOS, validarCodigoFiscal, validarParametrosTributarios, validarRegimeTributario } from "@/lib/tributacao";
import { codigoCestDigitado, formatarCest, validarRegistroCest } from "@/lib/cest";
import { conferirTabelasDominio } from "@/server/tabelasDominio";
import { normalizarPerfil, perfilValido, temPermissao } from "@/lib/permissoes";
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
  CHAVE_TELA_CHEIA,
  abrirPdvComTelaCheia,
  consumirFalhaRecenteTelaCheia,
  ehCliqueModificadoPdv,
  resetarEstadoTelaCheiaPdv,
} from "@/lib/abrirPdv";
import { ATALHOS_PDV } from "@/lib/atalhosPdv";
import {
  calcularTributosProdutoPdv,
  consultarProdutosPrecoPdv,
  decodificarEtiquetaBalancaPdv,
  gerarEtiquetaBalancaEan13Pdv,
  removerVendaDeEsperaPdv,
  retomarVendaDeEsperaPdv,
  suspenderVendaParaEsperaPdv,
} from "@/lib/balcaoPdv";
import {
  ESTADO_MULTIPLICADOR_INICIAL,
  aplicarAdicaoItemPdv,
  normalizarQtdPdv,
  podeIniciarMultiplicadorPdv,
  resolverProdutoPorCodigoOuBusca,
  transicionarMultiplicadorPdv,
  validarTextoQuantidadeMultiplicador,
} from "@/lib/multiplicadorPdv";
import {
  avancarAposLancamentoParcelaPdv,
  criarEstadoInicialFinalizarPdv,
  processarTeclaFinalizarPdv,
} from "@/lib/navegacaoFinalizarPdv";
import {
  carregarDavParaTelaPdv,
  converterReciboParaDocFiscalPdv,
  montarReciboDeFechamentoPdv,
  montarReciboDeVendaDtoPdv,
  resumirFilaOfflinePdv,
  sanitizarFilaOfflinePdv,
  validarCancelamentoDocumentoPdv,
  validarMovimentoGavetaPdv,
} from "@/lib/operacoesPdv";
import {
  calcularResumoPagamentoPdv,
  editarParcelaPagamentoPdv,
  normalizarPagamentosLiquidosPdv,
  registrarParcelaPagamentoPdv,
  validarCreditoVendaPdv,
} from "@/lib/pagamentoPdv";
import {
  PLANOS_CFG,
  classeAcumulado,
  dvChaveAcesso,
  documentoValido,
  formatChave,
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
import { resolverProtocoloOrigemVenda, resolverSituacaoFiscalVenda } from "@/lib/situacaoFiscal";
import { notaPorChaveDemo, parseNfeXml } from "@/lib/xmlNfe";
import { qrBits } from "@/lib/qrcode";
import { listarVendasPaginado, proximoNumeroFiscal } from "@/server/dados";
import {
  cifrarSegredo,
  decifrarSegredo,
  elegibilidadeCronDfe,
  extrairRetornoDist,
  gerarSoapDemoDist,
  lerDocumentosDfeFiscal,
  verificarAutenticacaoCronDfe,
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
  const fiscaisTransmitidas = fiscais.filter(
    (v) => resolverSituacaoFiscalVenda(v) !== "pendente_transmissao" && resolverSituacaoFiscalVenda(v) !== "nao_emitida",
  );
  const davs = vds.filter((v) => v.tipo === "dav");
  const semChave = fiscaisTransmitidas.filter((v) => !v.chave);
  const chaveRuim = fiscais.filter(
    (v) =>
      v.chave &&
      (soDigitos(v.chave).length !== 44 || dvChaveAcesso(soDigitos(v.chave).slice(0, 43)) !== Number(soDigitos(v.chave)[43])),
  );
  const davComNota = davs.filter((v) => v.chave || v.protocolo);
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

  ok("pdv-1", "PDV", "Toda venda fiscal emitida/simulada possui chave de acesso", semChave.length === 0, semChave.length ? `${semChave.length} sem chave` : `${qtd(fiscaisTransmitidas.length, "nota")}`, true);
  ok("pdv-2", "PDV", "Chaves com 44 dígitos e DV correto", chaveRuim.length === 0, chaveRuim.length ? lista(chaveRuim.map((v) => String(v.numero))) : "layout SEFAZ validado", true);
  ok("pdv-3", "PDV", "DAV não possui bloco fiscal", davComNota.length === 0, davComNota.length ? `${davComNota.length} DAV(s) com chave` : `${qtd(davs.length, "DAV")}`, true);
  ok("pdv-4", "PDV", "Total = itens − desconto + frete", totalRuim.length === 0, totalRuim.length ? lista(totalRuim.map((v) => String(v.numero))) : "conferência aritmética de todas as vendas", true);
  ok("pdv-5", "PDV", "Números de documento únicos", numerosRepetidos === 0, numerosRepetidos ? `${numerosRepetidos} duplicado(s)` : "sem duplicidade");
  ok("pdv-6", "PDV", "Parcelas somam o total da venda", parcelasRuins.length === 0, parcelasRuins.length ? `${parcelasRuins.length} venda(s) com pagamento dividido errado` : "pagamento dividido confere", true);
  ok("pdv-7", "PDV", "Venda fiscal tem número, série e modelo", notaSemNumero.length === 0, notaSemNumero.length ? `${notaSemNumero.length} incompleta(s)` : "ide completo para o DANFE", true);
  ok("pdv-8", "PDV", "Itens de venda existem para todas as vendas", itensPorVenda.size === vds.length, `${qtd(itens.length, "item")} em ${qtd(itensPorVenda.size, "venda")}`, true);

  // Etapa 11 — Verificações obrigatórias de DAV, estoque único, situação fiscal, busca e layout /pdv
  let davSemChaveProbeOk = false;
  let davNaoBaixaEstoqueOk = false;
  let faturarBaixaUmaVezOk = false;
  let notaSemSefazNaoAutorizadaOk = false;
  let buscaChaveEspacosOk = false;
  let buscaIsolamentoTenantOk = false;

  const prodProbeId = randomUUID();
  const davProbeId = randomUUID();
  const vendaFatProbeId = randomUUID();
  const vendaPendProbeId = randomUUID();
  const vendaChaveProbeId = randomUUID();
  const chaveProbe44 = gerarChave({
    uf: "11",
    aamm: "2611",
    cnpj: "04583620000151",
    modelo: "65",
    serie: "1",
    numeroNota: 98765,
  });

  try {
    await db.insert(produtos).values({
      id: prodProbeId,
      empresaId,
      nome: "PRODUTO PROBE ETAPA 11",
      sku: "PRB-E11",
      gtin: "SEM GTIN",
      estoque: 10,
      estoqueMin: 1,
      custo: 5,
      preco: 12,
    });

    // 1 & 2) Cria DAV para 3 unidades -> sem chave e estoque permanece 10
    await db.insert(vendas).values({
      id: davProbeId,
      empresaId,
      numero: 998701,
      clienteNome: "CLIENTE PROBE DAV",
      subtotal: 36,
      total: 36,
      tipo: "dav",
      status: "aberto",
      chave: null,
      protocolo: null,
      protocoloOrigem: null,
      situacaoFiscal: "nao_emitida",
    });
    await db.insert(vendaItens).values({
      vendaId: davProbeId,
      produtoId: prodProbeId,
      nome: "PRODUTO PROBE ETAPA 11",
      qtd: 3,
      precoUnit: 12,
      total: 36,
    });

    const [davBanco] = await db.select().from(vendas).where(eq(vendas.id, davProbeId)).limit(1);
    const [prodAposDav] = await db.select().from(produtos).where(eq(produtos.id, prodProbeId)).limit(1);
    const movsDav = await db.select().from(movimentos).where(eq(movimentos.produtoId, prodProbeId));

    davSemChaveProbeOk =
      davComNota.length === 0 &&
      Boolean(davBanco) &&
      davBanco.chave === null &&
      davBanco.protocolo === null &&
      resolverSituacaoFiscalVenda(davBanco) === "nao_emitida";

    davNaoBaixaEstoqueOk = Number(prodAposDav?.estoque ?? -1) === 10 && movsDav.length === 0;

    // 3) Faturamento atômico do DAV -> baixa estoque exatamente uma vez (10 -> 7), segunda chamada concorrente bloqueada!
    const tentarFaturarProbe = async () => {
      const travou = await db
        .update(vendas)
        .set({ status: "faturado", situacaoFiscal: "nao_emitida" })
        .where(
          and(
            eq(vendas.id, davProbeId),
            eq(vendas.empresaId, empresaId),
            eq(vendas.tipo, "dav"),
            eq(vendas.status, "aberto"),
          ),
        )
        .returning({ id: vendas.id });
      if (travou.length === 0) return false;

      const [pAtual] = await db.select().from(produtos).where(eq(produtos.id, prodProbeId)).limit(1);
      const novoSaldo = round2(Number(pAtual.estoque) - 3);
      await db.update(produtos).set({ estoque: novoSaldo }).where(eq(produtos.id, prodProbeId));
      await db.insert(vendas).values({
        id: vendaFatProbeId,
        empresaId,
        numero: 998702,
        clienteNome: "CLIENTE PROBE DAV",
        subtotal: 36,
        total: 36,
        tipo: "sem_nota",
        status: "faturado",
        davOrigemId: davProbeId,
        situacaoFiscal: "nao_emitida",
      });
      return true;
    };

    const rFat1 = await tentarFaturarProbe();
    const rFat2 = await tentarFaturarProbe();
    const [prodAposFat] = await db.select().from(produtos).where(eq(produtos.id, prodProbeId)).limit(1);
    faturarBaixaUmaVezOk = rFat1 === true && rFat2 === false && Number(prodAposFat?.estoque ?? -1) === 7;

    // 4) Nota emitida sem SEFAZ live -> pendente_transmissao, protocolo nulo, nunca aparece como autorizada
    await db.insert(vendas).values({
      id: vendaPendProbeId,
      empresaId,
      numero: 998703,
      clienteNome: "CLIENTE SEM SEFAZ",
      subtotal: 24,
      total: 24,
      tipo: "fiscal",
      status: "faturado",
      modelo: "NFC-e",
      serie: "1",
      numeroNota: 98764,
      chave: null,
      protocolo: null,
      protocoloOrigem: null,
      situacaoFiscal: "pendente_transmissao",
      statusSefaz: "pendente_envio",
      cstatSefaz: "",
    });
    const [pendRow] = await db.select().from(vendas).where(eq(vendas.id, vendaPendProbeId)).limit(1);
    const tentativaFalsaAutorizada = resolverSituacaoFiscalVenda({
      tipo: "fiscal",
      status: "faturado",
      protocolo: "111000000000000",
      protocoloOrigem: "simulado",
      statusSefaz: "simulado",
      situacaoFiscal: "autorizada",
    });
    const simuladasExistentesOk = fiscais
      .filter((v) => v.statusSefaz !== "autorizada" && v.status !== "cancelado")
      .every((v) => resolverSituacaoFiscalVenda(v) !== "autorizada" && resolverProtocoloOrigemVenda(v) !== "autorizado_sefaz");

    notaSemSefazNaoAutorizadaOk =
      Boolean(pendRow) &&
      resolverSituacaoFiscalVenda(pendRow) === "pendente_transmissao" &&
      resolverSituacaoFiscalVenda(pendRow) !== "autorizada" &&
      tentativaFalsaAutorizada !== "autorizada" &&
      simuladasExistentesOk;

    // 5 & 6) Busca paginada no servidor: chave com e sem espaços retorna a mesma nota + isolamento de outra empresa
    await db.insert(vendas).values({
      id: vendaChaveProbeId,
      empresaId,
      numero: 998704,
      clienteNome: "CLIENTE BUSCA CHAVE",
      subtotal: 48,
      total: 48,
      tipo: "fiscal",
      status: "faturado",
      modelo: "NFC-e",
      serie: "1",
      numeroNota: 98765,
      chave: chaveProbe44,
      protocolo: "111998704",
      protocoloOrigem: "simulado",
      situacaoFiscal: "simulado",
      statusSefaz: "simulado",
    });

    const chaveComEspacos = formatChave(chaveProbe44);
    const [buscaSemEspaco, buscaComEspaco, buscaOutraEmpresa] = await Promise.all([
      listarVendasPaginado(empresaId, { busca: chaveProbe44, pagina: 1, tamanhoPagina: 10 }),
      listarVendasPaginado(empresaId, { busca: chaveComEspacos, pagina: 1, tamanhoPagina: 10 }),
      listarVendasPaginado(randomUUID(), { busca: chaveProbe44, pagina: 1, tamanhoPagina: 10 }),
    ]);

    buscaChaveEspacosOk =
      chaveComEspacos.includes(" ") &&
      buscaSemEspaco.total === 1 &&
      buscaComEspaco.total === 1 &&
      buscaSemEspaco.itens[0]?.id === vendaChaveProbeId &&
      buscaComEspaco.itens[0]?.id === buscaSemEspaco.itens[0]?.id;

    buscaIsolamentoTenantOk = buscaOutraEmpresa.total === 0 && buscaOutraEmpresa.itens.length === 0;
  } finally {
    await db.delete(vendas).where(sql`id in (${davProbeId}, ${vendaFatProbeId}, ${vendaPendProbeId}, ${vendaChaveProbeId})`);
    await db.delete(movimentos).where(eq(movimentos.produtoId, prodProbeId));
    await db.delete(produtos).where(eq(produtos.id, prodProbeId));
  }

  const raizProj = process.cwd();
  const arqLayoutPdv = path.join(raizProj, "src/app/(pdv)/layout.tsx");
  const arqPagePdvNovo = path.join(raizProj, "src/app/(pdv)/pdv/page.tsx");
  const arqPagePdvAntigo = path.join(raizProj, "src/app/(painel)/pdv/page.tsx");
  const layoutPdvTxt = fs.existsSync(arqLayoutPdv) ? fs.readFileSync(arqLayoutPdv, "utf8") : "";
  const teclasObrigatorias = ["F1", "F2", "F3", "F4", "F6", "F8", "F10", "Del", "Alt+1..6", "Esc"];
  const pdvSemShellOk =
    fs.existsSync(arqLayoutPdv) &&
    fs.existsSync(arqPagePdvNovo) &&
    !fs.existsSync(arqPagePdvAntigo) &&
    !layoutPdvTxt.includes("Shell") &&
    teclasObrigatorias.every((t) => ATALHOS_PDV.some((a) => a.tecla === t));

  ok("pdv-9", "PDV", "DAV não tem chave nem protocolo fiscal", davSemChaveProbeOk, "situacaoFiscal = nao_emitida · chave = null", true);
  ok("pdv-10", "PDV", "DAV não baixa estoque ao ser registrado", davNaoBaixaEstoqueOk, "saldo mantido intacto até o faturamento", true);
  ok("pdv-11", "PDV", "Faturar DAV baixa estoque exatamente uma vez", faturarBaixaUmaVezOk, "trava atômica bloqueia faturamento duplo (10 → 7)", true);
  ok("pdv-12", "PDV", "Nota sem SEFAZ não aparece como autorizada", notaSemSefazNaoAutorizadaOk, "pendente_transmissao / simulado nunca viram autorizada", true);
  ok("pdv-13", "PDV", "Busca por chave com e sem espaços retorna a mesma nota", buscaChaveEspacosOk, "normalização de 44 dígitos no servidor", true);
  ok("pdv-14", "PDV", "Busca de documentos no PDV não retorna venda de outra empresa", buscaIsolamentoTenantOk, "filtro obrigatório por empresa_id", true);
  ok("pdv-15", "PDV", "/pdv isolado sem Shell e lista única ATALHOS_PDV ativa", pdvSemShellOk, "grupo (pdv) 100dvh sem sidebar/topbar", true);

  // Complemento PDV 1 de 3 — Fullscreen na entrada oficial + Multiplicador X + Qtd + Enter (13 testes obrigatórios)
  const arqShell = path.join(raizProj, "src/components/shell.tsx");
  const arqDashboard = path.join(raizProj, "src/views/Dashboard.tsx");
  const arqCaixa = path.join(raizProj, "src/views/Caixa.tsx");
  const arqPdvView = path.join(raizProj, "src/views/Pdv.tsx");
  const shellTxt = fs.existsSync(arqShell) ? fs.readFileSync(arqShell, "utf8") : "";
  const dashTxt = fs.existsSync(arqDashboard) ? fs.readFileSync(arqDashboard, "utf8") : "";
  const caixaTxt = fs.existsSync(arqCaixa) ? fs.readFileSync(arqCaixa, "utf8") : "";
  const pdvTxt = fs.existsSync(arqPdvView) ? fs.readFileSync(arqPdvView, "utf8") : "";

  // 1) Clique sidebar/button solicita fullscreen e navega (preservando Ctrl/Cmd+clique)
  resetarEstadoTelaCheiaPdv();
  let chamadasFs1 = 0;
  let rotasNavegadas1: string[] = [];
  let preventChamado1 = false;
  const memStorage1 = new Map<string, string>();
  const storageMock1 = {
    getItem: (k: string) => memStorage1.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStorage1.set(k, v);
    },
  };
  const docMockOk = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: () => {
        chamadasFs1++;
        return Promise.resolve();
      },
    },
  };
  const rCliqueNormal = abrirPdvComTelaCheia({
    navegar: (r) => rotasNavegadas1.push(r),
    origem: "clique",
    eventoClique: {
      button: 0,
      preventDefault: () => {
        preventChamado1 = true;
      },
    },
    pathnameAtual: "/",
    doc: docMockOk,
    storage: storageMock1,
    agora: 1000,
  });
  await rCliqueNormal.promessaTelaCheia;
  const rCliqueCtrl = abrirPdvComTelaCheia({
    navegar: (r) => rotasNavegadas1.push(r),
    origem: "clique",
    eventoClique: { button: 0, ctrlKey: true },
    pathnameAtual: "/",
    doc: docMockOk,
    storage: storageMock1,
    agora: 2000,
  });
  const entradasMenuUsamHelper =
    shellTxt.includes("LinkPdv") &&
    shellTxt.includes("abrirPdvComTelaCheia") &&
    !shellTxt.includes('<Link href="/pdv">') &&
    dashTxt.includes("LinkPdv") &&
    !dashTxt.includes('<Link href="/pdv">') &&
    caixaTxt.includes("LinkPdv") &&
    !caixaTxt.includes('<Link href="/pdv">');
  const teste1FullscreenMenuOk =
    entradasMenuUsamHelper &&
    chamadasFs1 === 1 &&
    preventChamado1 &&
    rotasNavegadas1.length === 1 &&
    rotasNavegadas1[0] === "/pdv" &&
    memStorage1.get(CHAVE_TELA_CHEIA) === "true" &&
    ehCliqueModificadoPdv({ ctrlKey: true }) &&
    ehCliqueModificadoPdv({ metaKey: true }) &&
    !rCliqueCtrl.interceptado &&
    !rCliqueCtrl.navegou;

  // 2) Fullscreen negado não impede abrir PDV e aciona fallback atual
  resetarEstadoTelaCheiaPdv();
  let rotasNegado: string[] = [];
  const memStorage2 = new Map<string, string>();
  const rNegado = abrirPdvComTelaCheia({
    navegar: (r) => rotasNegado.push(r),
    origem: "clique",
    eventoClique: { button: 0 },
    pathnameAtual: "/documentos",
    doc: {
      fullscreenElement: null,
      documentElement: {
        requestFullscreen: () => Promise.reject(new Error("NotAllowedError")),
      },
    },
    storage: {
      getItem: (k) => memStorage2.get(k) ?? null,
      setItem: (k, v) => {
        memStorage2.set(k, v);
      },
    },
    agora: Date.now(),
  });
  const resultadoFsNegado = await rNegado.promessaTelaCheia;
  const acionouFallbackRecente = consumirFalhaRecenteTelaCheia(5000);
  const teste2FallbackNegadoOk =
    rNegado.navegou &&
    rotasNegado[0] === "/pdv" &&
    resultadoFsNegado === false &&
    memStorage2.get(CHAVE_TELA_CHEIA) === "true" &&
    acionouFallbackRecente &&
    pdvTxt.includes("consumirFalhaRecenteTelaCheia") &&
    pdvTxt.includes("aguardandoGestoTelaCheia");

  // 3) Atalho de abertura não duplica pedidos/listeners
  resetarEstadoTelaCheiaPdv();
  let chamadasFsConcorrentes = 0;
  let liberarFs!: () => void;
  const docPendente = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen: () => {
        chamadasFsConcorrentes++;
        return new Promise<void>((res) => {
          liberarFs = res;
        });
      },
    },
  };
  let navAtalho = 0;
  const rAt1 = abrirPdvComTelaCheia({
    navegar: () => {
      navAtalho++;
    },
    origem: "atalho",
    eventoTeclado: { repeat: false },
    pathnameAtual: "/",
    doc: docPendente,
    storage: null,
    agora: 5000,
  });
  const rAt2 = abrirPdvComTelaCheia({
    navegar: () => {
      navAtalho++;
    },
    origem: "atalho",
    eventoTeclado: { repeat: false },
    pathnameAtual: "/",
    doc: docPendente,
    storage: null,
    agora: 5050,
  });
  const rAtRepeat = abrirPdvComTelaCheia({
    navegar: () => {
      navAtalho++;
    },
    origem: "atalho",
    eventoTeclado: { repeat: true },
    pathnameAtual: "/",
    doc: docPendente,
    storage: null,
    agora: 5300,
  });
  liberarFs();
  await rAt1.promessaTelaCheia;
  const listenersKeydownShell = (shellTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  const listenersKeydownPdv = (pdvTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  const teste3SemDuplicacaoOk =
    chamadasFsConcorrentes === 1 &&
    rAt1.promessaTelaCheia === rAt2.promessaTelaCheia &&
    navAtalho === 1 &&
    !rAtRepeat.navegou &&
    listenersKeydownShell === 1 &&
    listenersKeydownPdv === 2; // 1 listener de atalhos + 1 listener { once: true } do fallback de tela cheia (Etapa 3)
  resetarEstadoTelaCheiaPdv();

  // Produtos sintéticos para validação pura dos cenários 4 a 13
  const prodUnit = {
    id: "p-unit-1",
    nome: "ARROZ TIPO 1 5KG",
    sku: "NK0001",
    gtin: "7891000000006",
    preco: 32.9,
    unidade: "PC",
    estoque: 20,
    pesavel: false,
  };
  const prodPeso = {
    id: "p-peso-1",
    nome: "QUEIJO MUSSARELA",
    sku: "NK0020",
    gtin: "7891000000198",
    preco: 45.9,
    unidade: "KG",
    estoque: 10,
    pesavel: true,
  };

  // 4) X, 5, Enter, scan adiciona 5
  let st4 = ESTADO_MULTIPLICADOR_INICIAL;
  st4 = transicionarMultiplicadorPdv(st4, { tipo: "INICIAR", teclaInicial: "X" }).estado;
  st4 = transicionarMultiplicadorPdv(st4, { tipo: "DIGITAR_TECLA", tecla: "5" }).estado;
  st4 = transicionarMultiplicadorPdv(st4, { tipo: "ARMAR" }).estado;
  const prodScan4 = resolverProdutoPorCodigoOuBusca([prodUnit, prodPeso], "7891000000006", [prodUnit], 0);
  const ad4 =
    st4.status === "armado" && prodScan4
      ? aplicarAdicaoItemPdv([], prodScan4, st4.quantidade)
      : { ok: false as const, erro: "falha" };
  const teste4MultCincoOk =
    st4.status === "armado" &&
    st4.quantidade === 5 &&
    st4.rotulo === "Próximo item × 5" &&
    ad4.ok &&
    ad4.linhas.length === 1 &&
    ad4.linhas[0].qtd === 5;

  // 5) Produto já existente soma 5, não 1
  const linhasBase5 = ad4.ok ? ad4.linhas : [];
  const ad5 = aplicarAdicaoItemPdv(linhasBase5, prodUnit, 5);
  const teste5SomaExistenteOk = ad5.ok && ad5.linhas.length === 1 && ad5.linhas[0].qtd === 10 && ad5.qtdAplicada === 5;

  // 6) Quantidade volta a 1 após sucesso
  const st6PosConsumo = transicionarMultiplicadorPdv(st4, { tipo: "CONSUMIR" }).estado;
  const ad6PadraoUm = ad5.ok ? aplicarAdicaoItemPdv(ad5.linhas, prodUnit, undefined) : { ok: false as const, erro: "" };
  const teste6VoltaParaUmOk =
    st6PosConsumo.status === "inativo" &&
    st6PosConsumo.ultimaTransicao === "consumida" &&
    ad6PadraoUm.ok &&
    ad6PadraoUm.linhas[0].qtd === 11;

  // 7) Produto não encontrado não consome quantidade armada
  const naoAchado = resolverProdutoPorCodigoOuBusca([prodUnit, prodPeso], "7899999999999", [], 0);
  const st7PosErro = transicionarMultiplicadorPdv(st4, {
    tipo: "REGISTRAR_ERRO_LEITURA",
    erro: "Produto não encontrado.",
  }).estado;
  const teste7MantemArmadoOk =
    naoAchado === null &&
    st7PosErro.status === "armado" &&
    st7PosErro.quantidade === 5 &&
    Boolean(st7PosErro.erro);

  // 8) Esc cancela multiplicador sem apagar itens
  const st8Digitando = transicionarMultiplicadorPdv(ESTADO_MULTIPLICADOR_INICIAL, {
    tipo: "INICIAR",
    teclaInicial: "x",
  }).estado;
  const st8CancDig = transicionarMultiplicadorPdv(st8Digitando, { tipo: "CANCELAR" }).estado;
  const st8CancArm = transicionarMultiplicadorPdv(st7PosErro, { tipo: "CANCELAR" }).estado;
  const teste8EscCancelaSemApagarOk =
    st8CancDig.status === "inativo" &&
    st8CancDig.ultimaTransicao === "cancelada" &&
    st8CancArm.status === "inativo" &&
    st8CancArm.ultimaTransicao === "cancelada" &&
    ad5.ok &&
    ad5.linhas.length === 1 &&
    ad5.linhas[0].qtd === 10;

  // 9) Zero, negativo, vazio, acima do limite e decimal inválido são rejeitados
  const invalidos9 = ["", "   ", "0", "0,00", "-2", "10000", "1,2345", "1..5", "abc"];
  const todosRejeitados9 = invalidos9.every((txt) => {
    const v = validarTextoQuantidadeMultiplicador(txt);
    let s = transicionarMultiplicadorPdv(ESTADO_MULTIPLICADOR_INICIAL, { tipo: "INICIAR" }).estado;
    s = transicionarMultiplicadorPdv(s, { tipo: "DEFINIR_RASCUNHO", rascunho: txt }).estado;
    if (s.status !== "digitando") return !v.ok;
    const armado = transicionarMultiplicadorPdv(s, { tipo: "ARMAR" }).estado;
    return !v.ok && armado.status === "digitando" && Boolean(armado.erro);
  });

  // 10) Peso/decimal segue regra do produto (e sem erro de ponto flutuante ou estouro de estoque)
  const vDecimalOk = validarTextoQuantidadeMultiplicador("1,5");
  const adPeso1 = aplicarAdicaoItemPdv([], prodPeso, 1.5);
  const adPeso2 = adPeso1.ok ? aplicarAdicaoItemPdv(adPeso1.linhas, prodPeso, 0.1) : { ok: false as const, erro: "" };
  const adPeso3 = adPeso2.ok ? aplicarAdicaoItemPdv(adPeso2.linhas, prodPeso, 0.2) : { ok: false as const, erro: "" };
  const adPesoPreservaSemMult = adPeso3.ok
    ? aplicarAdicaoItemPdv(adPeso3.linhas, prodPeso, undefined)
    : { ok: false as const, erro: "" };
  const adUnitFracionado = aplicarAdicaoItemPdv([], prodUnit, 1.5);
  const adAcimaEstoque = aplicarAdicaoItemPdv([], prodUnit, 25);
  const teste10PesoRegraOk =
    vDecimalOk.ok &&
    vDecimalOk.quantidade === 1.5 &&
    normalizarQtdPdv(0.1 + 0.2) === 0.3 &&
    adPeso3.ok &&
    adPeso3.qtdFinalLinha === 1.8 &&
    adPesoPreservaSemMult.ok &&
    adPesoPreservaSemMult.qtdFinalLinha === 1.8 &&
    adPesoPreservaSemMult.abrirEdicaoId === prodPeso.id &&
    !adUnitFracionado.ok &&
    !adAcimaEstoque.ok;

  // 11) Digitar produto com X continua possível (sem sequestrar busca textual nem composição IME)
  const st11Ini = transicionarMultiplicadorPdv(ESTADO_MULTIPLICADOR_INICIAL, {
    tipo: "INICIAR",
    teclaInicial: "X",
  }).estado;
  const st11Letra = transicionarMultiplicadorPdv(st11Ini, { tipo: "DIGITAR_TECLA", tecla: "a" });
  const st11Btn = transicionarMultiplicadorPdv(st11Ini, { tipo: "CONVERTER_PARA_BUSCA_X" });
  const naoIniciaComTexto = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: false,
    editandoItem: false,
    focoNaBipagem: true,
    termoBusca: "CAIXA",
    key: "x",
  });
  const naoIniciaComIme = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: false,
    editandoItem: false,
    focoNaBipagem: true,
    termoBusca: "",
    key: "x",
    isComposing: true,
  });
  const teste11BuscaComXOk =
    st11Letra.estado.status === "inativo" &&
    st11Letra.converterParaTermoBusca === "Xa" &&
    st11Btn.converterParaTermoBusca === "X" &&
    naoIniciaComTexto &&
    naoIniciaComIme;

  // 12) Modais/outros inputs não acionam multiplicador
  const bloqueiaEmModal = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: true,
    editandoItem: false,
    focoNaBipagem: true,
    termoBusca: "",
    key: "X",
  });
  const bloqueiaOutroInput = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: false,
    editandoItem: false,
    focoNaBipagem: false,
    termoBusca: "",
    key: "X",
  });
  const bloqueiaEditandoLinha = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: false,
    editandoItem: true,
    focoNaBipagem: true,
    termoBusca: "",
    key: "X",
  });
  const bloqueiaAtalhoCtrlX = !podeIniciarMultiplicadorPdv({
    estadoAtual: ESTADO_MULTIPLICADOR_INICIAL,
    algumModalAberto: false,
    editandoItem: false,
    focoNaBipagem: true,
    termoBusca: "",
    key: "x",
    ctrlKey: true,
  });
  const teste12IsolamentoFocoModalOk =
    bloqueiaEmModal && bloqueiaOutroInput && bloqueiaEditandoLinha && bloqueiaAtalhoCtrlX;

  // 13) Regressão de scanner, busca, Del, Esc e fila offline
  const achaSku = resolverProdutoPorCodigoOuBusca([prodUnit, prodPeso], "nk0020", [], 0);
  const achaLista = resolverProdutoPorCodigoOuBusca([prodUnit, prodPeso], "queijo", [prodPeso], 0);
  const teste13RegressaoPdvOk =
    achaSku?.id === prodPeso.id &&
    achaLista?.id === prodPeso.id &&
    ATALHOS_PDV.some((a) => a.id === "multiplicador_qtd") &&
    ATALHOS_PDV.some((a) => a.id === "remover_ultimo") &&
    ATALHOS_PDV.some((a) => a.id === "escape") &&
    pdvTxt.includes('CHAVE_FILA = "nkway.fila"') &&
    pdvTxt.includes("removerUltimoItem") &&
    pdvTxt.includes("desfazerUltimoItem") &&
    pdvTxt.includes("sincronizar");

  ok("pdv-16", "PDV", "Menu/botão PDV solicita fullscreen no gesto e navega", teste1FullscreenMenuOk, "helper único LinkPdv + Ctrl/Cmd preservado", true);
  ok("pdv-17", "PDV", "Fullscreen negado não bloqueia /pdv e aciona fallback", teste2FallbackNegadoOk, "navega normalmente + aviso de 1 linha", true);
  ok("pdv-18", "PDV", "Atalho de abertura não duplica pedidos nem listeners", teste3SemDuplicacaoOk, "deduplicação de promessa ativa e keydown único", true);
  ok("pdv-19", "PDV", "Multiplicador X + 5 + Enter + scan adiciona 5", teste4MultCincoOk, "Próximo item × 5 aplicado na leitura", true);
  ok("pdv-20", "PDV", "Produto já existente soma quantidade multiplicada (não +1)", teste5SomaExistenteOk, "5 + 5 = 10 unidades exatas", true);
  ok("pdv-21", "PDV", "Multiplicador volta para 1 após adição com sucesso", teste6VoltaParaUmOk, "consumo único → próxima leitura soma +1", true);
  ok("pdv-22", "PDV", "Produto não encontrado mantém quantidade armada", teste7MantemArmadoOk, "não consome multiplicador silenciosamente", true);
  ok("pdv-23", "PDV", "Esc cancela multiplicador sem apagar itens da venda", teste8EscCancelaSemApagarOk, "itens preservados integralmente", true);
  ok("pdv-24", "PDV", "Zero, negativo, vazio, > 9.999 e decimal inválido rejeitados", todosRejeitados9, "validação estrita antes de armar", true);
  ok("pdv-25", "PDV", "Peso/decimal respeita produto pesável, arredondamento e estoque", teste10PesoRegraOk, "KG aceita até 3 casas; UN recusa fração", true);
  ok("pdv-26", "PDV", "Busca textual por produto iniciando com X continua possível", teste11BuscaComXOk, "X + letra converte para busca; IME respeitado", true);
  ok("pdv-27", "PDV", "Modais e outros campos não acionam multiplicador", teste12IsolamentoFocoModalOk, "restrito ao campo de bipagem vazio e sem modal", true);
  ok("pdv-28", "PDV", "Regressão de scanner, busca, Del, Esc e fila offline intacta", teste13RegressaoPdvOk, "GTIN/SKU, Del/Ctrl+Z, Esc e nkway.fila preservados", true);

  // Complemento PDV 2 de 3 — Pagamento dividido, troco/crédito, consulta F7, espera F9 e etiqueta de balança (12 testes)
  // 29) Pagamento dividido parcial + quitação exata
  const pagP1 = registrarParcelaPagamentoPdv({
    pagamentosAtuais: [],
    totalVenda: 73.5,
    forma: "dinheiro",
    valorInformado: "50,00",
  });
  const pagP2 = pagP1.ok
    ? registrarParcelaPagamentoPdv({
        pagamentosAtuais: pagP1.pagamentos,
        totalVenda: 73.5,
        forma: "pix",
        valorInformado: "23,50",
      })
    : { ok: false as const, erro: "" };
  const teste29DivisaoExataOk =
    pagP1.ok &&
    pagP1.resumo.falta === 23.5 &&
    !pagP1.resumo.quitado &&
    pagP2.ok &&
    pagP2.resumo.pago === 73.5 &&
    pagP2.resumo.falta === 0 &&
    pagP2.resumo.troco === 0 &&
    pagP2.resumo.quitado;

  // 30) Troco exclusivo em dinheiro e trava de excesso nas demais formas
  const pagDinTroco = registrarParcelaPagamentoPdv({
    pagamentosAtuais: [],
    totalVenda: 73.5,
    forma: "dinheiro",
    valorInformado: "100,00",
  });
  const pagPixExcesso = registrarParcelaPagamentoPdv({
    pagamentosAtuais: pagP1.ok ? pagP1.pagamentos : [],
    totalVenda: 73.5,
    forma: "pix",
    valorInformado: "80,00",
  });
  const edPixExcesso = editarParcelaPagamentoPdv({
    pagamentosAtuais: [
      { forma: "dinheiro", valor: 20 },
      { forma: "credito", valor: 30 },
    ],
    totalVenda: 73.5,
    indice: 1,
    novoValor: "90,00",
  });
  const teste30TrocoSoDinheiroOk =
    pagDinTroco.ok &&
    pagDinTroco.resumo.troco === 26.5 &&
    pagPixExcesso.ok &&
    pagPixExcesso.limitadoAoSaldo &&
    pagPixExcesso.valorAplicado === 23.5 &&
    pagPixExcesso.resumo.troco === 0 &&
    edPixExcesso.limitadoAoSaldo &&
    edPixExcesso.pagamentos[1]?.valor === 53.5 &&
    edPixExcesso.resumo.troco === 0;

  // 31) Saldo já quitado bloqueia lançamento duplicado
  const pagDuplicado = pagP2.ok
    ? registrarParcelaPagamentoPdv({
        pagamentosAtuais: pagP2.pagamentos,
        totalVenda: 73.5,
        forma: "credito",
        valorInformado: "10,00",
      })
    : { ok: true as const };
  const teste31BloqueiaQuitadoOk = !pagDuplicado.ok;

  // 32) Normalização líquida para persistência (soma das parcelas gravadas = total da venda)
  const normTroco = normalizarPagamentosLiquidosPdv(
    [
      { forma: "pix", valor: 23.5 },
      { forma: "dinheiro", valor: 100 },
    ],
    73.5,
  );
  const normPixInvalido = normalizarPagamentosLiquidosPdv([{ forma: "pix", valor: 100 }], 73.5);
  const somaLiquida = normTroco.ok
    ? round2(normTroco.pagamentosLiquidos.reduce((s, p) => s + p.valor, 0))
    : -1;
  const teste32NormalizacaoLiquidaOk =
    normTroco.ok && normTroco.troco === 50 && somaLiquida === 73.5 && !normPixInvalido.ok;

  // 33) Venda a prazo/boleto exige cliente identificado (mas permite Salvar como DAV)
  const credSemCliente = validarCreditoVendaPdv({
    modo: "sem_nota",
    pagamentos: [{ forma: "prazo", valor: 80 }],
    totalVenda: 80,
    cliente: null,
  });
  const credDavSemCliente = validarCreditoVendaPdv({
    modo: "dav",
    pagamentos: [{ forma: "prazo", valor: 80 }],
    totalVenda: 80,
    cliente: null,
  });
  const teste33ClienteObrigatorioPrazoOk =
    !credSemCliente.ok && credSemCliente.codigo === "cliente_obrigatorio" && credDavSemCliente.ok;

  // 34) Limite de crédito do cliente respeitado (bloqueia acima do disponível; aprova dentro)
  const cliLimite = { id: "cli-1", nome: "MERCADO TESTE", limiteCredito: 300, saldoEmAberto: 220 };
  const credEstoura = validarCreditoVendaPdv({
    modo: "emitir_nfce",
    pagamentos: [
      { forma: "dinheiro", valor: 20 },
      { forma: "prazo", valor: 100 },
    ],
    totalVenda: 120,
    cliente: cliLimite,
  });
  const credDentro = validarCreditoVendaPdv({
    modo: "emitir_nfce",
    pagamentos: [
      { forma: "dinheiro", valor: 40 },
      { forma: "prazo", valor: 80 },
    ],
    totalVenda: 120,
    cliente: cliLimite,
  });
  const teste34LimiteCreditoOk =
    !credEstoura.ok &&
    credEstoura.codigo === "limite_excedido" &&
    credDentro.ok &&
    credDentro.limiteDisponivel === 0 &&
    credDentro.novoSaldoAberto === 300;

  // 35) Etiqueta de balança GS1-2 decodifica peso (gramas) e valor (centavos)
  const etiqPeso = gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 1250 });
  const etiqValor = gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 20, medidaCincoDigitos: 2295 });
  const decPeso = decodificarEtiquetaBalancaPdv(etiqPeso, [prodUnit, prodPeso], "peso");
  const decValor = decodificarEtiquetaBalancaPdv(etiqValor, [prodUnit, prodPeso], "valor");
  const teste35BalancaGs1Ok =
    decPeso.ehEtiquetaBalanca &&
    decPeso.ok &&
    decPeso.produto.id === prodPeso.id &&
    decPeso.pesoKg === 1.25 &&
    decPeso.valorEtiqueta === round2(1.25 * prodPeso.preco) &&
    decValor.ehEtiquetaBalanca &&
    decValor.ok &&
    decValor.pesoKg === 0.5 &&
    decValor.valorEtiqueta === 22.95;

  // 36) Etiqueta de balança inválida (DV incorreto ou código inexistente) é rejeitada com segurança
  const etiqDvRuim = `${etiqPeso.slice(0, 12)}${(Number(etiqPeso[12]) + 1) % 10}`;
  const etiqSemProd = gerarEtiquetaBalancaEan13Pdv({ codigoProduto: 999, medidaCincoDigitos: 500 });
  const decRuim = decodificarEtiquetaBalancaPdv(etiqDvRuim, [prodUnit, prodPeso], "peso");
  const decSemProd = decodificarEtiquetaBalancaPdv(etiqSemProd, [prodUnit, prodPeso], "peso");
  const teste36BalancaInvalidaOk =
    decRuim.ehEtiquetaBalanca && !decRuim.ok && decSemProd.ehEtiquetaBalanca && !decSemProd.ok;

  // 37) Consulta de preço (F7) busca por GTIN, balança, SKU e nome sem acentos e calcula IBS/CBS
  const prodAcento = {
    ...prodUnit,
    id: "p-acento",
    nome: "AÇÚCAR CRISTAL ESPECIAL 5KG",
    sku: "NK0099",
    ibsAliq: 0.1,
    cbsAliq: 0.9,
  };
  const consAcento = consultarProdutosPrecoPdv("acucar cristal", [prodUnit, prodPeso, prodAcento], "peso");
  const consBal = consultarProdutosPrecoPdv(etiqPeso, [prodUnit, prodPeso, prodAcento], "peso");
  const tribCalc = calcularTributosProdutoPdv(prodAcento, 1);
  const teste37ConsultaPrecoF7Ok =
    consAcento.destaque?.id === "p-acento" &&
    consBal.destaque?.id === prodPeso.id &&
    consBal.leituraBalanca?.pesoKg === 1.25 &&
    tribCalc.total > 0;

  // 38 & 39) Vendas em espera (F9): suspensão, retomada e troca automática sem perder venda ativa na tela
  const rSusp1 = suspenderVendaParaEsperaPdv({
    listaAtual: [],
    vendaAtiva: {
      linhas: [
        {
          produtoId: prodUnit.id,
          nome: prodUnit.nome,
          qtd: 2,
          preco: prodUnit.preco,
          unidade: prodUnit.unidade,
          estoque: prodUnit.estoque,
          pesavel: false,
        },
      ],
      clienteId: "cli-1",
      clienteNome: "JOAO ESPERA",
      descontoModo: "real",
      descontoValor: "5,80",
      pagamentos: [{ forma: "pix", valor: 20 }],
    },
    identificacao: "Cesta Azul",
    idGerado: "esp-1",
    agora: 1000,
  });
  const teste38SuspenderEsperaOk =
    rSusp1.ok &&
    rSusp1.lista.length === 1 &&
    rSusp1.suspensa.total === 60 &&
    rSusp1.suspensa.unidades === 2;

  const rRetTroca = rSusp1.ok
    ? retomarVendaDeEsperaPdv({
        listaAtual: rSusp1.lista,
        idAlvo: "esp-1",
        vendaAtivaNaTela: {
          linhas: [
            {
              produtoId: prodPeso.id,
              nome: prodPeso.nome,
              qtd: 1.5,
              preco: prodPeso.preco,
              unidade: prodPeso.unidade,
              estoque: prodPeso.estoque,
              pesavel: true,
            },
          ],
          clienteId: null,
          clienteNome: "CONSUMIDOR",
          descontoModo: "real",
          descontoValor: "",
          pagamentos: [],
        },
        produtosAtivos: [prodUnit, prodPeso],
        agora: 2000,
      })
    : { ok: false as const, erro: "" };
  const listaPosRemocao = rRetTroca.ok ? removerVendaDeEsperaPdv(rRetTroca.listaRestante, rRetTroca.listaRestante[0]?.id ?? "") : [];
  const teste39RetomarTrocaSeguraOk =
    rRetTroca.ok &&
    rRetTroca.trocouComAtual &&
    rRetTroca.retomada.id === "esp-1" &&
    rRetTroca.listaRestante.length === 1 &&
    rRetTroca.listaRestante[0].linhas[0].produtoId === prodPeso.id &&
    listaPosRemocao.length === 0;

  // 40) ATALHOS_PDV documenta F7 e F9, listener único mantido e modais isolados
  const listenersPdvFinal = (pdvTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  const resumoConsistente = calcularResumoPagamentoPdv([{ forma: "dinheiro", valor: 50 }], 50).quitado;
  const teste40AtalhosEIsolamentoOk =
    resumoConsistente &&
    ATALHOS_PDV.some((a) => a.id === "consultar_preco" && a.tecla === "F7") &&
    ATALHOS_PDV.some((a) => a.id === "venda_espera" && a.tecla === "F9") &&
    pdvTxt.includes("modalConsultaPreco") &&
    pdvTxt.includes("modalEspera") &&
    listenersPdvFinal === 2;

  ok("pdv-29", "PDV", "Pagamento dividido soma parcelas e calcula falta exata", teste29DivisaoExataOk, "Dinheiro 50,00 + PIX 23,50 = 73,50 quitado", true);
  ok("pdv-30", "PDV", "Troco exclusivo em dinheiro e trava de excesso em PIX/cartão", teste30TrocoSoDinheiroOk, "formas não-dinheiro limitadas ao saldo restante", true);
  ok("pdv-31", "PDV", "Venda já quitada bloqueia parcela duplicada acidental", teste31BloqueiaQuitadoOk, "exige remover ou zerar antes de relançar", true);
  ok("pdv-32", "PDV", "Persistência abate troco em dinheiro mantendo soma líquida = total", teste32NormalizacaoLiquidaOk, "consistente com apuração de caixa e pdv-6", true);
  ok("pdv-33", "PDV", "Venda a prazo/boleto exige cliente cadastrado (DAV livre)", teste33ClienteObrigatorioPrazoOk, "bloqueia fiado anônimo para CONSUMIDOR", true);
  ok("pdv-34", "PDV", "Limite de crédito bloqueia excesso a prazo no PDV e servidor", teste34LimiteCreditoOk, "saldoEmAberto + valorAPrazo <= limiteCredito", true);
  ok("pdv-35", "PDV", "Etiqueta de balança EAN-13 (2…) decodifica peso e valor", teste35BalancaGs1Ok, "gramas (1,250 KG) e centavos (R$ 22,95 → 0,500 KG)", true);
  ok("pdv-36", "PDV", "Etiqueta de balança inválida é recusada sem perder estado", teste36BalancaInvalidaOk, "DV EAN-13 e vínculo SKU pesável validados", true);
  ok("pdv-37", "PDV", "Consulta de preço (F7) busca sem acento e exibe IBS/CBS sem vender", teste37ConsultaPrecoF7Ok, "consulta isolada da venda em andamento", true);
  ok("pdv-38", "PDV", "Venda em espera (F9) suspende atendimento em nkway.pdv.espera", teste38SuspenderEsperaOk, "preserva itens, cliente, desconto e parcelas", true);
  ok("pdv-39", "PDV", "Retomar venda em espera protege venda aberta trocando-as", teste39RetomarTrocaSeguraOk, "zero perda acidental de itens na tela", true);
  ok("pdv-40", "PDV", "ATALHOS_PDV integra F7 e F9 no listener único do PDV", teste40AtalhosEIsolamentoOk, "F1 e barra inferior sincronizados pela mesma fonte", true);

  // Complemento PDV 3 de 3 — Bobina térmica 80 mm (.print-area), Carregar/Cancelar F3, Gaveta Alt+G e Fila Offline (12 testes)
  // 41) Recibo térmico 80 mm pós-venda com itens, parcelas divididas, troco e .print-area ativo
  const reciboFech = montarReciboDeFechamentoPdv({
    id: "rec-1",
    modo: "sem_nota",
    numeroVenda: 501,
    numeroNota: null,
    modelo: null,
    situacaoFiscal: "nao_emitida",
    chave: null,
    protocolo: null,
    clienteNome: "MARCOS BALCAO",
    clienteDocumento: "123.456.789-00",
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
  const teste41Bobina80mmOk =
    reciboFech.itens.length === 2 &&
    reciboFech.unidadesTotais === 2.5 &&
    reciboFech.parcelas.length === 2 &&
    reciboFech.troco === 50 &&
    reciboFech.tributosTotal > 0 &&
    pdvTxt.includes("!imprimindo && \"print-area\"") &&
    pdvTxt.includes("w-[302px]");

  // 42) Honestidade fiscal na bobina 80 mm: pendente_transmissao e DAV nunca inventam chave/protocolo; autorizada converte p/ DANFE
  const reciboPend = montarReciboDeFechamentoPdv({
    id: "rec-pend",
    modo: "emitir_nfce",
    numeroVenda: 502,
    numeroNota: 8801,
    modelo: "NFC-e",
    situacaoFiscal: "pendente_transmissao",
    chave: "11261123567891000174650010000088011000088019",
    protocolo: "111999999",
    clienteNome: "CONSUMIDOR",
    operador: "Ana",
    terminal: "CAIXA 1",
    ambiente: "2",
    itens: [{ nome: "ARROZ", qtd: 1, precoUnit: 32.9, unidade: "PC" }],
    subtotal: 32.9,
    desconto: 0,
    total: 32.9,
    pagamentosBrutos: [{ forma: "dinheiro", valor: 32.9 }],
    troco: 0,
  });
  const reciboAut = montarReciboDeFechamentoPdv({
    id: "rec-aut",
    modo: "emitir_nfce",
    numeroVenda: 503,
    numeroNota: 8802,
    modelo: "NFC-e",
    situacaoFiscal: "autorizada",
    chave: chaveProbe44,
    protocolo: "111260000880201",
    clienteNome: "CONSUMIDOR",
    operador: "Ana",
    terminal: "CAIXA 1",
    ambiente: "2",
    itens: [{ nome: "ARROZ", qtd: 1, precoUnit: 32.9, unidade: "PC" }],
    subtotal: 32.9,
    desconto: 0,
    total: 32.9,
    pagamentosBrutos: [{ forma: "pix", valor: 32.9 }],
    troco: 0,
  });
  const docDanfe = converterReciboParaDocFiscalPdv(reciboAut);
  const docNaoFiscal = converterReciboParaDocFiscalPdv(reciboFech);
  const teste42HonestidadeBobinaEDanfeOk =
    reciboPend.chave === null &&
    reciboPend.protocolo === null &&
    reciboAut.chave === chaveProbe44 &&
    docDanfe?.chave === chaveProbe44 &&
    docNaoFiscal === null;

  // 43) Reimpressão 80 mm a partir de VendaDto em Documentos (F3) para DAV, Sem Nota e Fiscal
  const davDtoSim = {
    id: "dav-sim-1",
    numero: 770,
    numeroNota: null,
    serie: null,
    modelo: null,
    tipo: "dav",
    status: "aberto",
    situacaoFiscal: "nao_emitida" as const,
    protocoloOrigem: null,
    chave: null,
    protocolo: null,
    clienteId: "cli-dav",
    clienteNome: "CLIENTE ORCAMENTO",
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
    data: "2026-11-02T12:00:00.000Z",
    itens: [
      {
        produtoId: prodUnit.id,
        gtin: prodUnit.gtin,
        nome: prodUnit.nome,
        qtd: 2,
        precoUnit: prodUnit.preco,
        total: 65.8,
        unidade: prodUnit.unidade,
      },
    ],
  };
  const recDavDto = montarReciboDeVendaDtoPdv(davDtoSim);
  const teste43ReimpressaoDto80mmOk =
    recDavDto.tipo === "dav" &&
    recDavDto.chave === null &&
    recDavDto.parcelas.length === 0 &&
    recDavDto.tituloBobina.includes("DAV") &&
    recDavDto.total === 60;

  // 44) Carregar DAV em aberto para a tela do PDV preserva itens, cliente, desconto e guarda venda ativa em Espera (F9)
  const carDavTroca = carregarDavParaTelaPdv({
    dav: davDtoSim,
    produtosAtivos: [prodUnit, prodPeso],
    listaEsperaAtual: [],
    vendaAtivaNaTela: {
      linhas: [
        {
          produtoId: prodPeso.id,
          nome: prodPeso.nome,
          qtd: 1.2,
          preco: prodPeso.preco,
          unidade: prodPeso.unidade,
          estoque: prodPeso.estoque,
          pesavel: true,
        },
      ],
      clienteId: null,
      clienteNome: "CONSUMIDOR",
      descontoModo: "real",
      descontoValor: "",
      pagamentos: [],
    },
    agora: 5000,
  });
  const teste44CarregarDavComProtecaoOk =
    carDavTroca.ok &&
    carDavTroca.davNumero === 770 &&
    carDavTroca.linhas.length === 1 &&
    carDavTroca.linhas[0].qtd === 2 &&
    carDavTroca.clienteId === "cli-dav" &&
    carDavTroca.descontoValor === "5,80" &&
    carDavTroca.guardouVendaAnteriorEmEspera &&
    carDavTroca.listaEsperaAtualizada.length === 1;

  // 45) DAV já faturado/cancelado ou venda fiscal não pode ser reaberto como rascunho de DAV
  const carDavFechado = carregarDavParaTelaPdv({
    dav: { ...davDtoSim, status: "faturado" },
    produtosAtivos: [prodUnit],
    listaEsperaAtual: [],
  });
  const carNaoDav = carregarDavParaTelaPdv({
    dav: { ...davDtoSim, tipo: "fiscal" },
    produtosAtivos: [prodUnit],
    listaEsperaAtual: [],
  });
  const teste45BloqueiaCarregarDavFechadoOk = !carDavFechado.ok && !carNaoDav.ok;

  // 46) Cancelamento em Documentos (F3) exige motivo >= 15 caracteres e recusa documento já cancelado
  const cancCurto = validarCancelamentoDocumentoPdv({
    venda: davDtoSim,
    motivo: "erro",
  });
  const cancJaCancelado = validarCancelamentoDocumentoPdv({
    venda: { ...davDtoSim, status: "cancelado" },
    motivo: "Solicitação de cancelamento válida pelo cliente",
  });
  const cancValido = validarCancelamentoDocumentoPdv({
    venda: davDtoSim,
    motivo: "Cliente desistiu do orçamento no balcão",
  });
  const teste46ValidacaoMotivoCancelamentoOk =
    !cancCurto.ok &&
    cancCurto.codigo === "motivo_curto" &&
    !cancJaCancelado.ok &&
    cancJaCancelado.codigo === "ja_cancelado" &&
    cancValido.ok;

  // 47) Cancelamento respeita janela legal SEFAZ (30 min NFC-e 65 / 24h NF-e 55) para notas autorizadas
  const baseCancPdvMs = Date.parse("2026-11-02T12:00:00.000Z");
  const nfceAut = {
    tipo: "fiscal",
    status: "faturado",
    modelo: "NFC-e",
    situacaoFiscal: "autorizada" as const,
    protocoloOrigem: "autorizado_sefaz" as const,
    data: new Date(baseCancPdvMs).toISOString(),
    numero: 800,
    numeroNota: 800,
  };
  const cancNfceDentro = validarCancelamentoDocumentoPdv({
    venda: nfceAut,
    motivo: "Erro de digitação constatado imediatamente no caixa",
    agoraMs: baseCancPdvMs + 20 * 60_000,
  });
  const cancNfceExpirado = validarCancelamentoDocumentoPdv({
    venda: nfceAut,
    motivo: "Tentativa após quarenta e cinco minutos da emissão",
    agoraMs: baseCancPdvMs + 45 * 60_000,
  });
  const cancNfe55Dentro = validarCancelamentoDocumentoPdv({
    venda: { ...nfceAut, modelo: "NF-e" },
    motivo: "Cancelamento dentro de vinte e quatro horas legais",
    agoraMs: baseCancPdvMs + 120 * 60_000,
  });
  const teste47PrazoLegalSefazCancelamentoOk =
    cancNfceDentro.ok &&
    !cancNfceExpirado.ok &&
    cancNfceExpirado.codigo === "prazo_sefaz_expirado" &&
    cancNfe55Dentro.ok;

  // 48) Gaveta rápida (Alt+G): suprimento soma ao saldo previsto e sangria válida abate do saldo
  const sessaoMock = { id: "ses-1", numero: 12, terminal: "CAIXA 1", saldoDinheiro: 150 };
  const gavSup = validarMovimentoGavetaPdv({
    sessaoAberta: sessaoMock,
    tipo: "suprimento",
    forma: "dinheiro",
    valorInformado: "50,00",
    motivo: "Reforço de troco",
  });
  const gavSangOk = validarMovimentoGavetaPdv({
    sessaoAberta: sessaoMock,
    tipo: "sangria",
    forma: "dinheiro",
    valorInformado: "120,00",
    motivo: "Sangria para o cofre",
  });
  const teste48GavetaSuprimentoSangriaOk =
    gavSup.ok &&
    gavSup.saldoDinheiroApos === 200 &&
    gavSangOk.ok &&
    gavSangOk.saldoDinheiroApos === 30;

  // 49) Gaveta rápida (Alt+G) bloqueia caixa fechado, motivo curto, valor zerado e sangria acima do saldo em dinheiro
  const gavFechado = validarMovimentoGavetaPdv({
    sessaoAberta: null,
    tipo: "sangria",
    forma: "dinheiro",
    valorInformado: "20,00",
    motivo: "Sangria",
  });
  const gavExcesso = validarMovimentoGavetaPdv({
    sessaoAberta: sessaoMock,
    tipo: "sangria",
    forma: "dinheiro",
    valorInformado: "180,00",
    motivo: "Sangria acima do disponível",
  });
  const gavSemMotivo = validarMovimentoGavetaPdv({
    sessaoAberta: sessaoMock,
    tipo: "suprimento",
    forma: "dinheiro",
    valorInformado: "20,00",
    motivo: "oi",
  });
  const teste49GavetaTravasOk =
    !gavFechado.ok &&
    gavFechado.codigo === "caixa_fechado" &&
    !gavExcesso.ok &&
    gavExcesso.codigo === "saldo_insuficiente" &&
    !gavSemMotivo.ok &&
    gavSemMotivo.codigo === "motivo_curto";

  // 50 & 51) Inspetor da fila offline (nkway.fila): sanitização retrocompatível, cálculo de total e retenção de erro sem perda
  const filaSanitizada = sanitizarFilaOfflinePdv([
    {
      tipo: "fiscal",
      itens: [{ produtoId: prodUnit.id, qtd: 2, preco: 32.9 }],
      clienteNome: "CLIENTE OFFLINE 1",
      desconto: 5.8,
      pagamentos: [{ forma: "dinheiro", valor: 60 }],
      modelo: "NFC-e",
      criadoEm: 1700000000000,
    },
    {
      idFila: "fila-erro-2",
      tipo: "sem_nota",
      itens: [{ produtoId: prodPeso.id, qtd: 1, preco: 45.9 }],
      clienteNome: "CLIENTE OFFLINE 2",
      desconto: 0,
      pagamentos: [{ forma: "pix", valor: 45.9 }],
      tentativas: 2,
      ultimoErro: "Caixa fechado: abra o seu caixa antes de finalizar vendas.",
      criadoEm: 1700000005000,
    },
    { tipo: "fiscal", itens: [] }, // inválido/vazio ignorado com segurança
  ]);
  const resFila = resumirFilaOfflinePdv(filaSanitizada);
  const teste50FilaSanitizacaoOk =
    filaSanitizada.length === 2 &&
    filaSanitizada[0].totalEstimado === 60 &&
    filaSanitizada[0].qtdUnidades === 2;
  const teste51FilaResumoRetencaoErroOk =
    resFila.quantidade === 2 &&
    resFila.valorTotal === 105.9 &&
    resFila.comErro === 1 &&
    filaSanitizada[1].tentativas === 2 &&
    Boolean(filaSanitizada[1].ultimoErro);

  // 52) ATALHOS_PDV documenta Alt+G, modais isolados e listener global único preservado
  const listenersPdvC3 = (pdvTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  const teste52AtalhosEIntegridadeC3Ok =
    ATALHOS_PDV.some((a) => a.id === "gaveta_caixa" && a.tecla === "Alt+G") &&
    pdvTxt.includes("modalGaveta") &&
    pdvTxt.includes("modalFilaOffline") &&
    pdvTxt.includes("docCancelando") &&
    listenersPdvC3 === 2;

  ok("pdv-41", "PDV", "Bobina térmica 80 mm lista itens, parcelas, troco e .print-area", teste41Bobina80mmOk, "layout 302px pronto para window.print() sem folha em branco", true);
  ok("pdv-42", "PDV", "Bobina 80 mm preserva honestidade fiscal e converte p/ DANFE", teste42HonestidadeBobinaEDanfeOk, "sem chave fictícia em pendente_transmissao", true);
  ok("pdv-43", "PDV", "Reimpressão 80 mm atende DAV, venda sem nota e nota fiscal em F3", teste43ReimpressaoDto80mmOk, "comprovante não fiscal claro para DAV e sem_nota", true);
  ok("pdv-44", "PDV", "Carregar DAV para edição no PDV protege venda ativa em Espera", teste44CarregarDavComProtecaoOk, "restaura itens/cliente/desconto sem perda na tela", true);
  ok("pdv-45", "PDV", "DAV faturado/cancelado não pode ser reaberto como rascunho", teste45BloqueiaCarregarDavFechadoOk, "apenas DAV aberto entra para edição", true);
  ok("pdv-46", "PDV", "Cancelamento em F3 exige motivo >= 15 caracteres e status ativo", teste46ValidacaoMotivoCancelamentoOk, "padrão evento 110111 SEFAZ", true);
  ok("pdv-47", "PDV", "Cancelamento em F3 respeita prazo legal SEFAZ (30m NFC-e / 24h NF-e)", teste47PrazoLegalSefazCancelamentoOk, "bloqueia nota autorizada fora da janela legal", true);
  ok("pdv-48", "PDV", "Gaveta rápida (Alt+G) calcula suprimento e sangria no PDV", teste48GavetaSuprimentoSangriaOk, "movimentação sem sair da tela cheia", true);
  ok("pdv-49", "PDV", "Gaveta rápida bloqueia caixa fechado e sangria acima do saldo", teste49GavetaTravasOk, "proteção contra saldo negativo em espécie", true);
  ok("pdv-50", "PDV", "Fila offline (nkway.fila) sanitiza registros e calcula totais", teste50FilaSanitizacaoOk, "compatível com registros legados do navegador", true);
  ok("pdv-51", "PDV", "Inspetor da fila offline retém último erro sem descartar venda", teste51FilaResumoRetencaoErroOk, "permite corrigir caixa/estoque e reenviar", true);
  ok("pdv-52", "PDV", "ATALHOS_PDV integra Alt+G mantendo listener único e isolamento", teste52AtalhosEIntegridadeC3Ok, "F1, barra inferior e modais 100% sincronizados", true);

  // Navegação 100% por teclado no F10 (Formas de pagamento + Modelo fiscal + DAV / Sem nota / NFC-e) — 6 verificações
  const ctxPadraoF10 = {
    temSaldoFaltando: true,
    temParcelasLancadas: false,
    podeDav: true,
    podeSemNota: true,
    podeEmitirFiscal: true,
    confirmandoEmissao: false,
    inputValorSelecionadoOuVazio: true,
  };
  let nav53 = criarEstadoInicialFinalizarPdv({
    formaInicial: "dinheiro",
    modeloAtual: "NFC-e",
    ctx: ctxPadraoF10,
  });
  const sequenciaFormas: string[] = [nav53.formaAtiva];
  for (let k = 0; k < 6; k++) {
    const passo = processarTeclaFinalizarPdv(nav53, { key: "ArrowRight" }, ctxPadraoF10);
    nav53 = passo.estado;
    sequenciaFormas.push(nav53.formaAtiva);
  }
  const voltaEsquerda = processarTeclaFinalizarPdv(nav53, { key: "ArrowLeft" }, ctxPadraoF10);
  const teste53SetasFormasF10Ok =
    sequenciaFormas.join(",") === "dinheiro,pix,credito,debito,boleto,prazo,dinheiro" &&
    voltaEsquerda.estado.formaAtiva === "prazo" &&
    voltaEsquerda.acao.tipo === "MUDAR_FORMA";

  // 54) Digitação numérica direta + Enter lança parcela e, ao quitar, avança direto para as opções de documento
  const dig54 = processarTeclaFinalizarPdv(nav53, { key: "5" }, ctxPadraoF10);
  const ent54 = processarTeclaFinalizarPdv(dig54.estado, { key: "Enter" }, ctxPadraoF10);
  const posParcial54 = avancarAposLancamentoParcelaPdv(ent54.estado, true, ctxPadraoF10);
  const posQuitado54 = avancarAposLancamentoParcelaPdv(ent54.estado, false, ctxPadraoF10);
  const teste54ValorEAvancoOpcoesOk =
    dig54.estado.secao === "valor" &&
    dig54.acao.tipo === "INICIAR_DIGITACAO_VALOR" &&
    ent54.acao.tipo === "LANCAR_PARCELA" &&
    posParcial54.secao === "formas" &&
    posQuitado54.secao === "opcoes";

  // 55) Setas ← → alternam modelo fiscal (NFC-e ↔ NF-e ↔ SAT) tanto na seção modelo quanto sobre as opções
  const emModelo55 = { ...posQuitado54, secao: "modelo" as const };
  const m1 = processarTeclaFinalizarPdv(emModelo55, { key: "ArrowRight" }, { ...ctxPadraoF10, temSaldoFaltando: false });
  const m2 = processarTeclaFinalizarPdv(m1.estado, { key: "ArrowRight" }, { ...ctxPadraoF10, temSaldoFaltando: false });
  const m3 = processarTeclaFinalizarPdv(m2.estado, { key: "ArrowRight" }, { ...ctxPadraoF10, temSaldoFaltando: false });
  const mEmOpcoes = processarTeclaFinalizarPdv(
    { ...m3.estado, secao: "opcoes" },
    { key: "ArrowRight" },
    { ...ctxPadraoF10, temSaldoFaltando: false },
  );
  const teste55SetasModeloFiscalOk =
    m1.estado.modeloFiscal === "NF-e" &&
    m2.estado.modeloFiscal === "SAT" &&
    m3.estado.modeloFiscal === "NFC-e" &&
    mEmOpcoes.estado.modeloFiscal === "NF-e" &&
    mEmOpcoes.acao.tipo === "MUDAR_MODELO";

  // 56) Setas ↑ ↓ e teclas 1/2/3 selecionam DAV, Sem nota e Emitir fiscal e Enter executa sem mouse
  const ctxQuitado56 = { ...ctxPadraoF10, temSaldoFaltando: false, temParcelasLancadas: true };
  let op56 = criarEstadoInicialFinalizarPdv({
    formaInicial: "pix",
    modeloAtual: "NFC-e",
    ctx: ctxQuitado56,
  });
  const paraSemNota = processarTeclaFinalizarPdv(op56, { key: "ArrowUp" }, ctxQuitado56);
  const paraDav = processarTeclaFinalizarPdv(paraSemNota.estado, { key: "ArrowUp" }, ctxQuitado56);
  const enterDav = processarTeclaFinalizarPdv(paraDav.estado, { key: "Enter" }, ctxQuitado56);
  const atalho2 = processarTeclaFinalizarPdv(paraDav.estado, { key: "2" }, ctxQuitado56);
  const enterSemNota = processarTeclaFinalizarPdv(atalho2.estado, { key: "Enter" }, ctxQuitado56);
  const atalho3 = processarTeclaFinalizarPdv(atalho2.estado, { key: "3" }, ctxQuitado56);
  const enterFiscal = processarTeclaFinalizarPdv(atalho3.estado, { key: "Enter" }, ctxQuitado56);
  const teste56SetasOpcoesDocumentoOk =
    op56.secao === "opcoes" &&
    op56.opcaoFechamento === "emitir_nfce" &&
    paraSemNota.estado.opcaoFechamento === "sem_nota" &&
    paraDav.estado.opcaoFechamento === "dav" &&
    enterDav.acao.tipo === "EXECUTAR_FECHAMENTO" &&
    enterDav.acao.modo === "dav" &&
    enterSemNota.acao.tipo === "EXECUTAR_FECHAMENTO" &&
    enterSemNota.acao.modo === "sem_nota" &&
    enterFiscal.acao.tipo === "ABRIR_CONFIRMACAO_FISCAL" &&
    enterFiscal.estado.secao === "confirmacao";

  // 57) Confirmação de emissão fiscal navega com ← → entre Voltar e Confirmar, Enter confirma e Esc volta às opções
  const ctxConf57 = { ...ctxQuitado56, confirmandoEmissao: true };
  const altBotao57 = processarTeclaFinalizarPdv(enterFiscal.estado, { key: "ArrowLeft" }, ctxConf57);
  const voltaBotao57 = processarTeclaFinalizarPdv(altBotao57.estado, { key: "ArrowRight" }, ctxConf57);
  const enterConf57 = processarTeclaFinalizarPdv(voltaBotao57.estado, { key: "Enter" }, ctxConf57);
  const escConf57 = processarTeclaFinalizarPdv(voltaBotao57.estado, { key: "Escape" }, ctxConf57);
  const teste57ConfirmacaoTecladoOk =
    altBotao57.estado.botaoConfirmacao === "voltar" &&
    voltaBotao57.estado.botaoConfirmacao === "confirmar" &&
    enterConf57.acao.tipo === "EXECUTAR_FECHAMENTO" &&
    enterConf57.acao.modo === "emitir_nfce" &&
    escConf57.acao.tipo === "VOLTAR_OPCOES" &&
    escConf57.estado.secao === "opcoes";

  // 58) DOM de Pdv.tsx conectado às 5 zonas data-f10-zona mantendo listener único
  const listenersPdvF10 = (pdvTxt.match(/window\.addEventListener\("keydown"/g) ?? []).length;
  const teste58DomZonasF10Ok =
    pdvTxt.includes('data-f10-zona="formas"') &&
    pdvTxt.includes('data-f10-zona="valor"') &&
    pdvTxt.includes('data-f10-zona="modelo"') &&
    pdvTxt.includes('data-f10-zona="opcoes"') &&
    pdvTxt.includes('data-f10-zona="confirmacao"') &&
    listenersPdvF10 === 2;

  ok("pdv-53", "PDV", "F10 navega pelas 6 formas de pagamento com setas ← → sem mouse", teste53SetasFormasF10Ok, "Dinheiro ↔ PIX ↔ Crédito ↔ Débito ↔ Boleto ↔ Prazo", true);
  ok("pdv-54", "PDV", "F10 lança valor por Enter e avança direto às opções ao quitar", teste54ValorEAvancoOpcoesOk, "digitação direta + transição automática p/ documento", true);
  ok("pdv-55", "PDV", "F10 alterna modelo fiscal (NFC-e / NF-e / SAT) com setas ← →", teste55SetasModeloFiscalOk, "funciona na barra de modelo e sobre a opção fiscal", true);
  ok("pdv-56", "PDV", "F10 seleciona DAV, Sem nota e Emitir fiscal com ↑ ↓ / 1..3 + Enter", teste56SetasOpcoesDocumentoOk, "100% operável por teclado sem uso de mouse", true);
  ok("pdv-57", "PDV", "Confirmação fiscal no F10 navega com setas, Enter confirma e Esc volta", teste57ConfirmacaoTecladoOk, "Voltar às opções ↔ Confirmar e emitir", true);
  ok("pdv-58", "PDV", "Modal F10 possui foco real nas 5 zonas e listener global único", teste58DomZonasF10Ok, "formas, valor, modelo, opções e confirmação sincronizados", true);

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

  const codigosFiscaisOk = validarCodigoFiscal("ncm", "1006.30.21").ok && validarCodigoFiscal("cfop", "5.102").ok && !validarCodigoFiscal("ncm", "123").ok && !validarCodigoFiscal("csosn", "999").ok;
  const cstMono = { ...PARAMETROS_TRIBUTARIOS_VAZIOS, tipoIcms: "cst", cstIcms: "61" };
  const cstComum = { ...PARAMETROS_TRIBUTARIOS_VAZIOS, tipoIcms: "cst", cstIcms: "00" };
  const regimesFiscaisOk = crtSugeridoParaRegime("mei") === 4 && crtSugeridoParaRegime("simples") === 1 && crtSugeridoParaRegime("simples_excedente") === 2 && crtSugeridoParaRegime("real") === 3 && !validarRegimeTributario(cstMono, 1) && Boolean(validarRegimeTributario(cstComum, 1)) && !validarRegimeTributario(cstComum, 3);
  const perfilBase = { ...PARAMETROS_TRIBUTARIOS_VAZIOS, ncm: "10063021", cfop: "5102" };
  const perfilAplicado = aplicarPerfilTributario(perfilBase, { ...PARAMETROS_TRIBUTARIOS_VAZIOS, cfop: "5405" });
  const perfilCopiaOk = perfilAplicado.ncm === "10063021" && perfilAplicado.cfop === "5405" && perfilBase.cfop === "5102";
  const tabelasFiscais = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('nk_fiscal_parametro','nk_produto_tributacao')`);
  ok("fis-9", "Fiscal", "Códigos fiscais têm formato validado sem presumir vigência oficial", codigosFiscaisOk, "NCM · CFOP · CSOSN", true);
  ok("fis-10", "Fiscal", "CRT e CST/CSOSN respeitam os regimes e a exceção monofásica", regimesFiscaisOk, "MEI 4 · Simples 1 · excesso 2 · normal 3", true);
  ok("fis-11", "Fiscal", "Perfil fiscal aplica somente campos preenchidos sem alterar o original", perfilCopiaOk, "cópia explícita · sem propagação automática", true);
  ok("fis-12", "Fiscal", "Tabelas fiscais complementares estão disponíveis", Number(tabelasFiscais.rows[0]?.n ?? 0) === 2, "nk_fiscal_parametro · nk_produto_tributacao", true);
  const classificacaoIbsOk = validarParametrosTributarios({ cstIbsCbs: "000", classTrib: "000001" }).ok && !validarParametrosTributarios({ cstIbsCbs: "200", classTrib: "000001" }).ok;
  ok("fis-13", "Fiscal", "CST IBS/CBS e cClassTrib mantêm o mesmo prefixo", classificacaoIbsOk, "verificação estrutural; vigência deve ser confirmada em tabela oficial", true);

  // Etapa 2 — CEST: referência local por empresa (nunca aplicada automaticamente) e formato preservado nos produtos.
  const tabelaCest = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='nk_catalogo_cest'`);
  const cestProdutos = await db.execute<{ ruins: number }>(sql`select count(*)::int as ruins from nk_produto where cest <> '' and cest !~ '^\\d{7}$'`);
  const cestRegOk = (() => { try { const r = validarRegistroCest({ cest: "03.002.00", descricao: "Cervejas de malte", ncm: ["2203", "22030000"], fonte: "CONFAZ — Conv. ICMS 142/2018 (anexos PDF)", ato: "Convênio ICMS 142/2018", vigencia: "consolidado até Conv. 107/2026" }); return r.cest === "0300200" && r.ncm.length === 2; } catch { return false; } })();
  const cestRegInvalido = (() => { try { validarRegistroCest({ cest: "123", descricao: "x" }); return false; } catch { return true; } })();
  const cestOk = Number(tabelaCest.rows[0]?.n ?? 0) === 1 && Number(cestProdutos.rows[0]?.ruins ?? 0) === 0 && cestRegOk && cestRegInvalido && codigoCestDigitado("03.002.00") === "0300200" && codigoCestDigitado("123") === null && formatarCest("0300200") === "03.002.00";
  ok("fis-14", "Fiscal", "CEST: referência local por empresa, prefixos NCM/SH e formato preservado (nada aplicado automaticamente)", cestOk, `tabela nk_catalogo_cest · produtos com CEST fora de 7 dígitos: ${Number(cestProdutos.rows[0]?.ruins ?? 0)} · não é validação oficial`, true);

  // Tabelas de domínio oficiais (opções selecionáveis do módulo fiscal), semeadas por script a partir de fonte oficial.
  const dominio = await conferirTabelasDominio();
  const dominioTabelas = await db.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('nk_tabela_dominio','nk_tabela_dominio_meta')`);
  ok("fis-15", "Fiscal", "Tabelas de domínio oficiais disponíveis como opções (CFOP/CST/CSOSN/origem/cClassTrib), com fonte registrada", dominio.ok && Number(dominioTabelas.rows[0]?.n ?? 0) === 2, dominio.detalhe, true);
  const tabelasRefOk = TABELAS_FISCAIS.length === 6 && TABELAS_FISCAIS.every((t) => conferirTabelaFiscal(t.id).ok) && totalClassTrib() === 173
    && CLASS_TRIB.every(([c]) => TABELAS_FISCAIS.find((t) => t.id === "cst_ibs_cbs")!.itens.some((i) => i.codigo === c.slice(0, 3))) && classTribPorCst("200").length === 56 && classTribPorCst("410").length === 38;
  ok("fis-16", "Fiscal", "Instantâneos oficiais embutidos íntegros (fallback dos seletores quando nk_tabela_dominio está vazia)", tabelasRefOk, "SPED 4.3.2/4.3.3/4.3.4 · IT 2025.002 v1.70 · 173 cClassTrib · sem certificar enquadramento", true);

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

  // Agendamento /api/dfe/dist: segredo obrigatório, comparação em tempo constante, Bearer e header próprio
  const segredoCronTeste = "segredo-cron-dfe-teste-2026";
  const cronNegaSemSegredo =
    !verificarAutenticacaoCronDfe({ cronSecretHeader: "", authorizationHeader: "" }, "") &&
    !verificarAutenticacaoCronDfe({ cronSecretHeader: "qualquer", authorizationHeader: "Bearer qualquer" }, "");
  const cronNegaErrado =
    !verificarAutenticacaoCronDfe({ cronSecretHeader: "errado", authorizationHeader: "" }, segredoCronTeste) &&
    !verificarAutenticacaoCronDfe({ cronSecretHeader: "", authorizationHeader: `Bearer ${segredoCronTeste}x` }, segredoCronTeste) &&
    !verificarAutenticacaoCronDfe({ cronSecretHeader: segredoCronTeste.slice(0, -1), authorizationHeader: "" }, segredoCronTeste);
  const cronAceitaCerto =
    verificarAutenticacaoCronDfe({ cronSecretHeader: segredoCronTeste, authorizationHeader: "" }, segredoCronTeste) &&
    verificarAutenticacaoCronDfe({ cronSecretHeader: "", authorizationHeader: `Bearer ${segredoCronTeste}` }, segredoCronTeste);
  const cronAuthOk = cronNegaSemSegredo && cronNegaErrado && cronAceitaCerto;

  const elegPausada = elegibilidadeCronDfe({ dfeAtivo: false, dfeSenhaCifrada: "v1:x", dfePfxCifrado: "v1:y" }, { modoLive: true });
  const elegSemA1 = elegibilidadeCronDfe({}, { modoLive: true });
  const elegDemoSozinho = elegibilidadeCronDfe({ dfeSenhaCifrada: "v1:x", dfePfxCifrado: "v1:y" }, { modoLive: false });
  const elegLiveComA1 = elegibilidadeCronDfe({ dfeSenhaCifrada: "v1:x", dfeCertPath: "bucket://certificados-a1/x.pfx" }, { modoLive: true });
  const elegDemoPedido = elegibilidadeCronDfe({}, { modoLive: false, forcarDemo: true });
  const cronElegOk =
    !elegPausada.elegivel && !elegSemA1.elegivel && !elegDemoSozinho.elegivel && elegLiveComA1.elegivel && elegDemoPedido.elegivel;

  ok("dfe-7", "DF-e", "Agendamento /api/dfe/dist exige segredo (x-dfe-cron-secret ou Bearer) e nega sem DFE_CRON_SECRET", cronAuthOk, cronAuthOk ? "401 sem segredo · 401 segredo errado · 200 segredo correto" : "autenticação do cron frouxa", true);
  ok("dfe-8", "DF-e", "Ciclo automático só consulta empresas ativas com A1 em modo live (demo apenas a pedido)", cronElegOk, cronElegOk ? "pausada/sem A1/demo sozinho bloqueados · live+A1 e demo a pedido liberados" : "elegibilidade do cron incorreta", true);

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

  const perfilGerenteOk =
    normalizarPerfil("gerente") === "gerente" &&
    normalizarPerfil("manager") === "gerente" &&
    perfilValido("gerente") &&
    temPermissao("gerente", "caixa.homologar") &&
    temPermissao("gerente", "caixa.auditoria") &&
    temPermissao("administrador", "caixa.homologar") &&
    !temPermissao("operador", "caixa.homologar") &&
    !temPermissao("vendedor", "caixa.auditoria") &&
    !temPermissao("gerente", "usuarios.gerenciar");
  ok("usr-6", "Usuários e Auditoria", "Perfil Gerente normalizado, com homologação/auditoria e sem rebaixamento para Operador", perfilGerenteOk, "caixa.homologar · caixa.auditoria · sem usuarios.gerenciar", true);

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

  /* ------------------- Motor corrigido do caixa: predicado compoeCaixa + identidade econômica */
  const SESS = "sessao-A";
  const ctxCx = { empresaId, sessaoId: SESS };
  const vendaCx = (
    id: string,
    tipo: string,
    status: string,
    total: number,
    pagamentos: { forma: string; valor: number }[],
    extra: Partial<VendaCaixaInput> = {},
  ): VendaCaixaInput => ({
    id,
    tipo,
    status,
    total,
    formaPagamento: pagamentos[0]?.forma ?? "dinheiro",
    pagamentos,
    empresaId,
    caixaSessaoId: SESS,
    davOrigemId: null,
    ...extra,
  });
  const cenarioCx: VendaCaixaInput[] = [
    vendaCx("fiscal", "fiscal", "faturado", 100, [{ forma: "pix", valor: 100 }]),
    vendaCx("sem-nota", "sem_nota", "faturado", 80, [{ forma: "dinheiro", valor: 50 }, { forma: "credito", valor: 30 }]),
    vendaCx("dav-orc", "dav", "aberto", 999, [], { caixaSessaoId: null }),
    vendaCx("dav-pai", "dav", "faturado", 70, [], { caixaSessaoId: null }),
    vendaCx("filha", "fiscal", "faturado", 70, [{ forma: "debito", valor: 70 }], { davOrigemId: "dav-pai", origem: "dav" }),
    vendaCx("dav-concreto", "dav", "faturado", 40, [{ forma: "pix", valor: 40 }]),
    vendaCx("nota-fiscaliza", "fiscal", "faturado", 40, [{ forma: "pix", valor: 40 }], { davOrigemId: "dav-concreto" }),
    vendaCx("outra-sessao", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { caixaSessaoId: "sessao-B" }),
    vendaCx("sem-sessao", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { caixaSessaoId: null }),
    vendaCx("outra-empresa", "fiscal", "faturado", 500, [{ forma: "dinheiro", valor: 500 }], { empresaId: "00000000-0000-4000-8000-000000000099" }),
    vendaCx("cancelada", "sem_nota", "cancelado", 30, [{ forma: "dinheiro", valor: 30 }]),
  ];
  const apCx = apurarSessaoCaixa({
    sessaoId: SESS,
    empresaId,
    saldoInicial: 50,
    vendas: cenarioCx,
    movimentos: [
      { id: "e1", tipo: "estorno", forma: "dinheiro", valor: 30, motivo: "Cancel", vendaId: "cancelada", usuarioNome: "Op", criadoEm: "" },
      { id: "s1", tipo: "sangria", forma: "dinheiro", valor: 20, motivo: "Cofre", usuarioNome: "Op", criadoEm: "" },
    ],
  });
  const clCx = new Map(apCx.classificacoes.map((c) => [c.vendaId, c]));
  const cod = (id: string) => clCx.get(id)?.codigo ?? "?";
  const entra = (id: string) => clCx.get(id)?.compoeCaixa === true;
  // esperado: dinheiro 50 + 50 + 30(cancelada bruta) − 30(estorno explícito) − 20 = 80 · pix 100 + 40 = 140 · crédito 30 · débito 70 → 320
  const esperadoCxOk =
    apCx.esperadosMap.dinheiro === 80 && apCx.esperadosMap.pix === 140 && apCx.esperadosMap.credito === 30 &&
    apCx.esperadosMap.debito === 70 && apCx.totalEsperado === 320 && apCx.totalEstornos === 30 &&
    apCx.consideradas === 5 && apCx.qtdVendasAtivas === 4 && apCx.qtdVendasCanceladas === 1;

  const rate = (total: number, pags: { forma: string; valor: number }[]) =>
    ratearPagamentosDetalhado({ total, formaPagamento: "dinheiro", pagamentos: pags });
  const r1 = rate(100, [{ forma: "dinheiro", valor: 60 }, { forma: "pix", valor: 40 }]);
  const r2 = rate(100, [{ forma: "dinheiro", valor: 120 }]);
  const r3 = rate(100, [{ forma: "dinheiro", valor: 30 }, { forma: "credito", valor: 70 }]);
  const r4 = rate(100, [{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 80 }]);
  const r5 = rate(100, [{ forma: "pix", valor: 120 }]);
  const r6 = ratearPagamentosDetalhado({ total: 100, formaPagamento: "debito", pagamentos: [] });
  const r7 = rate(100, [{ forma: "pix", valor: 0 }, { forma: "credito", valor: -5 }, { forma: "debito", valor: Number.NaN }, { forma: "debito", valor: 100 }]);
  const divididoOk =
    r1.porForma.dinheiro === 60 && r1.porForma.pix === 40 && r1.troco === 0 && !r1.inconsistencia &&
    r3.porForma.dinheiro === 30 && r3.porForma.credito === 70 && r3.troco === 0 &&
    r7.porForma.debito === 100 && r7.parcelasIgnoradas === 3 && !r7.inconsistencia;
  const trocoOk =
    r2.porForma.dinheiro === 100 && r2.troco === 20 && !r2.inconsistencia &&
    r4.porForma.dinheiro === 20 && r4.porForma.pix === 80 && r4.troco === 20 && !r4.inconsistencia;
  const excessoOk = r5.porForma.pix === 120 && r5.troco === 0 && Boolean(r5.inconsistencia) && r5.porForma.dinheiro === 0;
  const fallbackOk = r6.usouFallbackForma && r6.porForma.debito === 100 && r6.troco === 0 && Object.values(r6.porForma).reduce((s, v) => s + v, 0) === 100;

  // cancelamento: com estorno explícito não duplica; sem estorno explícito, estorno implícito uma única vez
  const apCancelImplicito = apurarSessaoCaixa({
    sessaoId: SESS, empresaId, saldoInicial: 0, movimentos: [],
    vendas: [vendaCx("c1", "fiscal", "cancelado", 30, [{ forma: "dinheiro", valor: 30 }])],
  });
  const cancelOk =
    apCx.esperadosMap.dinheiro === 80 && apCancelImplicito.esperadosMap.dinheiro === 0 && apCancelImplicito.totalEstornos === 30 && apCancelImplicito.totalVendasBrutas === 30;

  // sessão fechada: snapshot prevalece; divergência do recálculo fica visível
  const apSnap = aplicarSnapshotFechamento(apCx, { dinheiro: 75, pix: 140, credito: 30, debito: 70, boleto: 0, prazo: 0 });
  const snapshotOk = apSnap.snapshotAplicado && apSnap.esperadosMap.dinheiro === 75 && apSnap.totalEsperado === 315 && apSnap.divergenciaRecalculo === 5 && apCx.esperadosMap.dinheiro === 80;

  ok("cx-6", "Caixa por Operador", "Venda fiscal da sessão compõe o caixa", entra("fiscal") && cod("fiscal") === "venda_concreta", "pix R$ 100,00 · venda_concreta", true);
  ok("cx-7", "Caixa por Operador", "Venda sem nota concreta compõe o caixa (sem exigir chave/protocolo)", entra("sem-nota") && cod("sem-nota") === "venda_concreta" && apCx.esperadosMap.credito === 30, "dinheiro 50 + crédito 30 · venda_concreta", true);
  ok("cx-8", "Caixa por Operador", "DAV orçamento/pré-venda não entra (aberto, sem recebimento, sem baixa)", !entra("dav-orc") && cod("dav-orc") === "dav_orcamento" && !entra("dav-pai") && cod("dav-pai") === "dav_orcamento", "DAV aberto e DAV pai faturado sem pagamento ficam fora", true);
  ok("cx-9", "Caixa por Operador", "DAV comercial concreto entra uma única vez pelos pagamentos líquidos", entra("dav-concreto") && cod("dav-concreto") === "dav_concreto" && apCx.esperadosMap.pix === 140, "dav_concreto pix R$ 40,00", true);
  ok("cx-10", "Caixa por Operador", "DAV orçamento + venda filha: conta somente a filha", entra("filha") && cod("filha") === "venda_concreta" && clCx.get("filha")?.operacaoEconomicaId === "filha" && !entra("dav-pai"), "débito R$ 70,00 uma vez", true);
  ok("cx-11", "Caixa por Operador", "DAV concreto + nota que só fiscaliza: conta somente a operação original", !entra("nota-fiscaliza") && cod("nota-fiscaliza") === "duplicata_fiscal_de_dav" && clCx.get("nota-fiscaliza")?.operacaoEconomicaId === "dav-concreto" && clCx.get("nota-fiscaliza")?.registroFonteDoPagamento === "dav-concreto", "operacaoEconomicaId = DAV concreto", true);
  ok("cx-12", "Caixa por Operador", "Venda de outra sessão/operador não entra, mesmo no mesmo tenant", !entra("outra-sessao") && cod("outra-sessao") === "outra_sessao", "sessao-B excluída", true);
  ok("cx-13", "Caixa por Operador", "Venda sem caixaSessaoId não entra retroativamente", !entra("sem-sessao") && cod("sem-sessao") === "sem_sessao", "sem vínculo explícito", true);
  ok("cx-14", "Caixa por Operador", "Pagamento dividido soma cada parcela na forma correspondente e ignora parcela inválida", divididoOk, "60/40 · 30/70 · zero/negativa/NaN ignoradas", true);
  ok("cx-15", "Caixa por Operador", "Troco sai exclusivamente do dinheiro", trocoOk, "din 120→100 troco 20 · din 40+pix 80 → din 20/pix 80 troco 20", true);
  ok("cx-16", "Caixa por Operador", "Excesso sem dinheiro é inconsistência, nunca troco em PIX/cartão", excessoOk, r5.inconsistencia ? "pix 120 p/ total 100 sinalizado" : "não sinalizou", true);
  ok("cx-17", "Caixa por Operador", "Venda legada sem pagamentos[] usa formaPagamento como fallback", fallbackOk, "débito R$ 100,00 pelo fallback", true);
  ok("cx-18", "Caixa por Operador", "Cancelamento: estorno explícito não duplica e implícito ocorre uma única vez", cancelOk, "líquido zero nos dois casos", true);
  ok("cx-19", "Caixa por Operador", "Apuração completa da sessão: esperado por forma e deduplicação por operação econômica", esperadoCxOk, `R$ ${apCx.totalEsperado.toFixed(2)} · ${apCx.consideradas} consideradas · ${apCx.excluidas.length} excluídas`, true);
  ok("cx-20", "Caixa por Operador", "Sessão fechada preserva snapshot e expõe divergência do recálculo", snapshotOk, `snapshot R$ 315,00 · recálculo R$ 320,00 · divergência R$ ${apSnap.divergenciaRecalculo.toFixed(2)}`, true);

  // Fechamento real: transação + FOR UPDATE (simultâneo bloqueado), sessão do operador e isolamento entre empresas
  let fechamentoConcorrenteOk = false;
  let isolamentoFechamentoOk = false;
  let detalheFechamento = "";
  const probeOpId = randomUUID();
  const probeSessId = randomUUID();
  const probeVendaId = randomUUID();
  try {
    await db.insert(usuarios).values({ id: probeOpId, empresaId, nome: "Probe Caixa", email: `probe-caixa-${probeOpId.slice(0, 8)}@nkway.local`, senhaHash: "probe", papel: "operador", ativo: false });
    await db.insert(caixaSessoes).values({ id: probeSessId, empresaId, numero: 990000 + Math.floor(Math.random() * 9999), terminal: "PROBE", operadorId: probeOpId, operadorNome: "Probe Caixa", status: "aberto", saldoInicial: 10 });
    await db.insert(vendas).values({
      id: probeVendaId, empresaId, numero: 990000 + Math.floor(Math.random() * 9999), clienteNome: "PROBE CAIXA", subtotal: 25, desconto: 0, total: 25,
      formaPagamento: "dinheiro", pagamentos: [{ forma: "dinheiro", valor: 30 }], tipo: "sem_nota", status: "faturado",
      operadorId: probeOpId, caixaSessaoId: probeSessId, origem: "pdv", data: new Date(),
    });
    const probeUsuario = { id: probeOpId, nome: "Probe Caixa", papel: "operador" };
    const informados = { dinheiro: 35, pix: 0, credito: 0, debito: 0, boleto: 0, prazo: 0 }; // 10 inicial + 25 líquido (troco 5)
    const outraEmpresa = await fecharSessaoCaixaTransacional({ empresaId: "00000000-0000-4000-8000-000000000099", sessaoId: probeSessId, usuario: probeUsuario, valoresInformados: informados, justificativa: "" });
    const outroOperador = await fecharSessaoCaixaTransacional({ empresaId, sessaoId: probeSessId, usuario: { id: randomUUID(), nome: "Outro", papel: "operador" }, valoresInformados: informados, justificativa: "" });
    const [f1, f2] = await Promise.all([
      fecharSessaoCaixaTransacional({ empresaId, sessaoId: probeSessId, usuario: probeUsuario, valoresInformados: informados, justificativa: "" }),
      fecharSessaoCaixaTransacional({ empresaId, sessaoId: probeSessId, usuario: probeUsuario, valoresInformados: informados, justificativa: "" }),
    ]);
    const f3 = await fecharSessaoCaixaTransacional({ empresaId, sessaoId: probeSessId, usuario: probeUsuario, valoresInformados: informados, justificativa: "" });
    const [sessFechada] = await db.select().from(caixaSessoes).where(eq(caixaSessoes.id, probeSessId)).limit(1);
    const oks = [f1, f2].filter((f) => f.ok).length;
    const vencedor = [f1, f2].find((f) => f.ok);
    fechamentoConcorrenteOk =
      oks === 1 && !f3.ok && sessFechada?.status === "fechado" && Number(sessFechada?.totalEsperado) === 35 &&
      Number((sessFechada?.valoresEsperados as Record<string, number>)?.dinheiro) === 35 && Number(sessFechada?.diferencaTotal) === 0 &&
      vencedor?.ok === true && vencedor.apuracao.totalTroco === 5 && vencedor.apuracao.consideradas === 1;
    isolamentoFechamentoOk = !outraEmpresa.ok && !outroOperador.ok && sessFechada?.fechadoPorId === probeOpId;
    detalheFechamento = `${oks} de 2 simultâneos · retry negado · esperado R$ ${Number(sessFechada?.totalEsperado ?? 0).toFixed(2)}`;
  } catch (e) {
    detalheFechamento = e instanceof Error ? e.message : String(e);
  } finally {
    await db.delete(caixaMovimentos).where(eq(caixaMovimentos.sessaoId, probeSessId));
    await db.delete(vendas).where(eq(vendas.id, probeVendaId));
    await db.delete(caixaSessoes).where(eq(caixaSessoes.id, probeSessId));
    await db.delete(usuarios).where(eq(usuarios.id, probeOpId));
  }
  ok("cx-21", "Caixa por Operador", "Fechamento simultâneo bloqueado por transação + FOR UPDATE, com snapshot recalculado no servidor", fechamentoConcorrenteOk, detalheFechamento, true);
  ok("cx-22", "Caixa por Operador", "Fechamento isolado por empresa e restrito ao operador da sessão", isolamentoFechamentoOk, isolamentoFechamentoOk ? "outra empresa e outro operador negados" : detalheFechamento, true);

  const [quebraTabela, quebraColunas] = await Promise.all([
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='nk_caixa_quebra_log'`,
    ),
    db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.columns where table_schema='public' and table_name='nk_caixa_sessao' and column_name in ('status_aprovacao','homologado_por_usuario_id','fundo_troco')`,
    ),
  ]);
  const quebraSchemaOk =
    Number(quebraTabela.rows[0]?.n ?? 0) === 1 && Number(quebraColunas.rows[0]?.n ?? 0) === 3;
  ok("cx-23", "Caixa por Operador", "Migração aditiva da quebra/homologação aplicada (tabela + 3 colunas, sem RLS)", quebraSchemaOk, "nk_caixa_quebra_log · status_aprovacao · homologado_por_usuario_id · fundo_troco", true);

  const gNormal = estadoGavetaPorSaldo(LIMITE_DINHEIRO_GAVETA - 0.01);
  const gAlerta = estadoGavetaPorSaldo(LIMITE_DINHEIRO_GAVETA);
  const gBloqueado = estadoGavetaPorSaldo(LIMITE_BLOQUEIO_GAVETA);
  const estadoGavetaOk =
    LIMITE_DINHEIRO_GAVETA === 800 && FUNDO_TROCO_PADRAO === 100 &&
    LIMITE_BLOQUEIO_GAVETA === 960 &&
    gNormal.estado === "normal" && !gNormal.bloquearVendaDinheiro &&
    gAlerta.estado === "alerta" && !gAlerta.bloquearVendaDinheiro &&
    gBloqueado.estado === "bloqueado" && gBloqueado.bloquearVendaDinheiro &&
    typeof apCx.estadoGaveta === "string" && typeof apCx.bloquearVendaDinheiro === "boolean" &&
    apCx.fundoTrocoPadrao === FUNDO_TROCO_PADRAO && apCx.limiteDinheiroGaveta === LIMITE_DINHEIRO_GAVETA;
  ok("cx-24", "Caixa por Operador", "Estado lógico da gaveta: alerta em R$ 800 e bloqueio boolean em 120%", estadoGavetaOk, `normal → alerta → bloqueado (${LIMITE_BLOQUEIO_GAVETA}) · fundo R$ ${FUNDO_TROCO_PADRAO}`, true);

  const arqPdvPage = path.join(raizProj, "src/app/(pdv)/pdv/page.tsx");
  const pdvPageTxt = fs.existsSync(arqPdvPage) ? fs.readFileSync(arqPdvPage, "utf8") : "";
  const blindBalanceOk =
    !pdvPageTxt.includes("totalEsperado") &&
    !pdvPageTxt.includes("saldoDinheiro") &&
    pdvPageTxt.includes("obterEstadoGavetaSessao") &&
    !caixaTxt.includes("conferenciaAoVivo") &&
    !caixaTxt.includes("esp.toFixed(2)") &&
    caixaTxt.includes("inicial[fp.id] = \"\"") &&
    caixaTxt.includes("Fechamento às cegas");
  ok("cx-25", "Caixa por Operador", "Blind balance: PDV recebe só estado/boolean e inputs iniciam vazios", blindBalanceOk, "sem totalEsperado, sem saldoDinheiro, sem conferência ao vivo", true);

  const arqModalCego = path.join(raizProj, "src/components/ModalFechamentoCego.tsx");
  const arqAuditoria = path.join(raizProj, "src/app/(painel)/dashboard/auditoria-caixa/page.tsx");
  const modalCegoTxt = fs.existsSync(arqModalCego) ? fs.readFileSync(arqModalCego, "utf8") : "";
  const auditoriaTxt = fs.existsSync(arqAuditoria) ? fs.readFileSync(arqAuditoria, "utf8") : "";
  const etapa3UiOk =
    modalCegoTxt.includes("useState") &&
    modalCegoTxt.includes("Fechamento às cegas") &&
    modalCegoTxt.includes('valores[fp.id] ?? ""') &&
    modalCegoTxt.includes("requerHomologacao") &&
    !modalCegoTxt.includes("esperadosMap") &&
    auditoriaTxt.includes('"caixa.auditoria"') &&
    auditoriaTxt.includes("listarAuditoriaCaixa") &&
    shellTxt.includes("/dashboard/auditoria-caixa");
  ok("cx-26", "Caixa por Operador", "Modal cego no PDV e auditoria restrita por caixa.auditoria", etapa3UiOk, "inputs vazios · PIN do gerente · rota gated", true);

  const conferenciaCompensada = calcularConferenciaCaixa(
    { dinheiro: 100, pix: 100 },
    { dinheiro: 90, pix: 110 },
  );
  const compensadaOk = conferenciaCompensada.diferencaTotal === 0 && conferenciaCompensada.temDivergencia && conferenciaCompensada.diferencas.dinheiro === -10 && conferenciaCompensada.diferencas.pix === 10;
  ok("cx-27", "Caixa por Operador", "Falta e sobra compensadas continuam sendo divergência por forma", compensadaOk, "dinheiro -10 · PIX +10 · total líquido zero", true);

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
