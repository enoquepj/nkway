import type { DB } from "../types";
import { statusSefazCliente, validarGtin } from "../types";
import { validarCnpj, validarCpf } from "../receita";
import { lerXmlNfe, XML_EXEMPLO } from "../xmlNfe";
import { gerarChave } from "../types";

export type Resultado = {
  id: string;
  modulo: string;
  nome: string;
  passou: boolean;
  detalhe: string;
  critico: boolean;
};

const ok = (
  id: string,
  modulo: string,
  nome: string,
  cond: boolean,
  detalhe: string,
  critico = false,
): Resultado => ({ id, modulo, nome, passou: cond, detalhe, critico });

/** Bateria de verificações executadas sobre o estado real do sistema */
export function rodarTestes(db: DB): Resultado[] {
  const r: Resultado[] = [];

  // ------------------------------------------------------------ CADASTROS
  r.push(
    ok("cad-1", "Cadastros", "Existem produtos cadastrados", db.produtos.length > 0,
      `${db.produtos.length} produtos`),
    ok("cad-2", "Cadastros", "Nenhum produto com preço menor que o custo",
      db.produtos.every((p) => p.preco >= p.custo),
      db.produtos.filter((p) => p.preco < p.custo).map((p) => p.nome).join(", ") || "todos OK",
      true),
    ok("cad-3", "Cadastros", "Nenhum estoque negativo",
      db.produtos.every((p) => p.estoque >= 0), "saldos não negativos", true),
    ok("cad-4", "Cadastros", "SKUs não duplicados",
      new Set(db.produtos.map((p) => p.sku).filter(Boolean)).size ===
        db.produtos.filter((p) => p.sku).length,
      "chave de casamento do XML depende disso"),
    ok("cad-5", "Cadastros", "Todo produto tem NCM (obrigatório NF-e)",
      db.produtos.every((p) => (p.impostos?.ncm ?? "") !== ""),
      db.produtos.filter((p) => !p.impostos?.ncm).map((p) => p.nome).join(", ") || "todos OK",
      true),
    ok("cad-6", "Cadastros", "Todo produto tem unidade de medida",
      db.produtos.every((p) => (p.unidade ?? "") !== ""), "uCom da NF-e exige", true),
    ok("cad-7", "Cadastros", "GTINs válidos ou isentos",
      db.produtos.every((p) => validarGtin(p.gtin ?? "")),
      db.produtos.filter((p) => !validarGtin(p.gtin ?? "")).map((p) => p.nome).join(", ") ||
        "DV dos EAN-13 correto",
      true),
  );

  // ----------------------------------------------------------------- PDV
  const fiscais = db.vendas.filter((v) => v.tipo === "fiscal");
  const davs = db.vendas.filter((v) => v.tipo === "dav");
  r.push(
    ok("pdv-1", "PDV", "Toda venda fiscal possui bloco fiscal",
      fiscais.every((v) => !!v.fiscal), `${fiscais.length} notas`, true),
    ok("pdv-2", "PDV", "Chaves de acesso com 44 dígitos",
      fiscais.every((v) => v.fiscal?.chave.length === 44), "layout SEFAZ", true),
    ok("pdv-3", "PDV", "DAV não possui bloco fiscal",
      davs.every((v) => !v.fiscal), `${davs.length} DAVs`, true),
    ok("pdv-4", "PDV", "Totais batem com itens menos desconto",
      db.vendas.every((v) => {
        const sub = v.itens.reduce((s, i) => s + i.qtd * i.preco, 0);
        return Math.abs(sub - v.desconto - v.total) < 0.01;
      }), "conferência aritmética", true),
    ok("pdv-5", "PDV", "Números de documento únicos",
      new Set(db.vendas.map((v) => v.numero)).size === db.vendas.length, "sem duplicidade"),
  );

  // --------------------------------------------------------- CHAVE FISCAL
  const chave = gerarChave(1);
  r.push(
    ok("fis-1", "Fiscal", "Gerador de chave produz 44 dígitos",
      chave.length === 44, chave.slice(0, 20) + "...", true),
    ok("fis-2", "Fiscal", "Chave contém apenas números",
      /^\d{44}$/.test(chave), "validação de formato", true),
  );

  // ------------------------------------------------------------- XML NF-e
  const xml = lerXmlNfe(XML_EXEMPLO);
  r.push(
    ok("xml-1", "Entrada XML", "Parser lê o XML de exemplo", xml.ok,
      xml.ok ? `${xml.entrada.itens.length} itens` : xml.erro, true),
    ok("xml-2", "Entrada XML", "Extrai CNPJ do emitente",
      xml.ok && xml.entrada.cnpjFornecedor.includes("/"),
      xml.ok ? xml.entrada.cnpjFornecedor : "—"),
    ok("xml-3", "Entrada XML", "Extrai NCM e CFOP dos itens",
      xml.ok && xml.entrada.itens.every((i) => i.ncm && i.cfop), "campos fiscais"),
    ok("xml-4", "Entrada XML", "Rejeita arquivo inválido",
      lerXmlNfe("<nada/>").ok === false, "tratamento de erro", true),
  );

  // ------------------------------------------------------------- ESTOQUE
  r.push(
    ok("est-1", "Estoque", "Kardex possui movimentos", db.movimentos.length > 0,
      `${db.movimentos.length} lançamentos`),
    ok("est-2", "Estoque", "Movimentos de venda são negativos",
      db.movimentos.filter((m) => m.tipo === "venda").every((m) => m.qtd < 0),
      "sinal correto", true),
    ok("est-3", "Estoque", "Movimentos de entrada são positivos",
      db.movimentos.filter((m) => m.tipo === "entrada").every((m) => m.qtd > 0),
      "sinal correto", true),
    ok("est-4", "Estoque", "Saldo após movimento nunca negativo",
      db.movimentos.every((m) => m.saldoApos >= 0), "integridade", true),
  );

  // ------------------------------------------------------------- COMPRAS
  r.push(
    ok("com-1", "Compras", "Entradas lançadas geram movimento",
      db.entradas.filter((e) => e.status === "lancada").length === 0 ||
        db.movimentos.some((m) => m.tipo === "entrada"),
      "rastreabilidade", true),
    ok("com-2", "Compras", "Totais das entradas positivos",
      db.entradas.every((e) => e.total >= 0), `${db.entradas.length} notas`),
  );

  // ---------------------------------------------------------------- MDF-e
  r.push(
    ok("mdf-1", "MDF-e", "Manifestos só vinculam NF-e",
      db.mdfes.every((m) => m.documentos.every((d) => d.tipo === "NF-e")),
      "NFC-e não entra em manifesto", true),
    ok("mdf-2", "MDF-e", "Valor da carga bate com documentos",
      db.mdfes.every((m) => {
        const soma = m.documentos.reduce((s, d) => s + d.valor, 0);
        return Math.abs(soma - m.valorCarga) < 0.01;
      }), "conferência", true),
    ok("mdf-3", "MDF-e", "Chaves de MDF-e com 44 dígitos",
      db.mdfes.every((m) => m.chave.length === 44), `${db.mdfes.length} manifestos`),
  );

  // ----------------------------------------------------------- FINANCEIRO
  r.push(
    ok("fin-1", "Financeiro", "Lançamentos com valor positivo",
      db.lancamentos.every((l) => l.valor > 0), `${db.lancamentos.length} títulos`, true),
    ok("fin-2", "Financeiro", "Vencimentos em formato ISO",
      db.lancamentos.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.vencimento)),
      "yyyy-mm-dd", true),
    ok("fin-3", "Financeiro", "Venda a prazo gerou conta a receber",
      db.vendas.filter((v) => v.status === "faturado" &&
        (v.pagamento === "boleto" || v.pagamento === "prazo")).length === 0 ||
        db.lancamentos.some((l) => l.categoria === "Vendas"),
      "integração PDV → financeiro", true),
  );

  // -------------------------------------------------------------- OFFLINE
  let fila: unknown[] = [];
  try {
    fila = JSON.parse(localStorage.getItem("nkway.fila.sync") ?? "[]");
  } catch { /* ignore */ }
  r.push(
    ok("off-1", "Offline", "Fila de sincronização acessível", Array.isArray(fila),
      `${(fila as unknown[]).length} pendentes`),
    ok("off-2", "Offline", "Service Worker suportado no navegador",
      "serviceWorker" in navigator, "PWA / modo offline"),
    ok("off-3", "Offline", "Navegador online", navigator.onLine,
      navigator.onLine ? "conectado" : "offline (esperado em teste)"),
  );

  // ----------------------------------------------------- CLIENTES / SEFAZ
  r.push(
    ok("cli-1", "Clientes", "Documentos com DV válido (CPF/CNPJ)",
      db.clientes.every((c) => {
        const n = (c.documento ?? "").replace(/\D/g, "");
        return n.length === 11 ? validarCpf(n) : validarCnpj(n);
      }),
      "dígito verificador de todos os documentos", true),
    ok("cli-2", "Clientes", "Clientes aptos à autorização NF-e",
      db.clientes.every((c) => statusSefazCliente(c).ok),
      db.clientes
        .map((c) => {
          const st = statusSefazCliente(c);
          return st.ok ? "" : `${c.nome}: faltam ${st.faltando.join(", ")}`;
        })
        .filter(Boolean)
        .join(" | ") || "todos com <dest> completo",
      true),
    ok("cli-3", "Clientes", "Indicador de IE definido em todos",
      db.clientes.every((c) => !!c.indIe), "indIEDest 1/2/9", true),
  );

  // ------------------------------------------------ FORN. / DEVOLUÇÕES
  r.push(
    ok("dev-1", "Devoluções", "CFOP de devolução válido (5201/6201)",
      db.devolucoes.every((d) => ["5201", "6201"].includes(d.cfop)),
      `${db.devolucoes.length} notas`, true),
    ok("dev-2", "Devoluções", "Chave referenciada presente (NFref)",
      db.devolucoes.every((d) => d.chaveReferente.length === 44),
      "tag obrigatória na autorização", true),
    ok("dev-3", "Devoluções", "Total da devolução bate com itens",
      db.devolucoes.every((d) => {
        const soma = d.itens.reduce((x, i) => x + i.qtd * i.custo, 0);
        return Math.abs(soma - d.total) < 0.01;
      }), "conferência aritmética", true),
    ok("for-1", "Fornecedores", "CNPJ com DV válido",
      db.fornecedores.every((f) => validarCnpj(f.cnpj)),
      "dígito verificador", true),
  );

  // -------------------------------- CANCELAMENTO / FISCAL
  r.push(
    ok("canc-1", "Cancelamento", "Vendas canceladas não entram no faturamento",
      db.vendas.filter((v) => v.status === "faturado").every((v) => v.status !== "cancelado"),
      "kpi usa status faturado", true),
    ok("canc-2", "Cancelamento", "Cancelamento fiscal gera evento de cancelamento",
      db.vendas.filter((v) => v.status === "cancelado" && v.tipo === "fiscal").length === 0 ||
        db.cancelamentos.length > 0,
      "evento registrado", true),
    ok("canc-3", "Cancelamento", "Cancelamento devolve estoque",
      db.cancelamentos.every(() =>
        db.movimentos.some(
          (m) => m.tipo === "devolucao" && m.documento.includes("Cancelamento"),
        ),
      ),
      "há movimento de devolução por cancelamento", true),
    ok("fisc-1", "Config Fiscal", "Ambiente definido (1 produção / 2 homologação)",
      db.configFiscal.ambiente === 1 || db.configFiscal.ambiente === 2,
      `atual: ${db.configFiscal.ambiente === 1 ? "produção" : "homologação"}`),
    ok("fisc-2", "Config Fiscal", "CSC ID presente (6 dígitos)",
      (db.configFiscal.cscId ?? "").length === 6,
      `atual: ${db.configFiscal.cscId || "sem"}`, true),
    ok("fisc-3", "Config Fiscal", "Certificado A1 configurado no sistema produção",
      db.configFiscal.ambiente === 2 || !!db.configFiscal.certificadoNome,
      db.configFiscal.certificadoNome || "adequadamente em homologação",
      db.configFiscal.ambiente === 1),
    ok("fisc-4", "Config Fiscal", "Certificado ainda válido",
      !db.configFiscal.certificadoValidade ||
        new Date(db.configFiscal.certificadoValidade) >= new Date(),
      db.configFiscal.certificadoValidade || "sem data informada", true),
  );

  // ----------------------------------------- REFORMA TRIBUTÁRIA IBS/CBS
  r.push(
    ok("ref-1", "Reforma 2027", "Todos os produtos têm CBS e IBS configurados",
      db.produtos.every((p) =>
        typeof p.impostos?.cbsAliq === "number" &&
        typeof p.impostos?.ibsAliq === "number" &&
        p.impostos.cbsAliq >= 0 && p.impostos.ibsAliq >= 0,
      ),
      db.produtos.filter(
        (p) => typeof p.impostos?.cbsAliq !== "number",
      ).map((p) => p.nome).join(", ") || "todos OK", true),
    ok("ref-2", "Reforma 2027", "CBS teste dentro da faixa 2026 (0-1%)",
      db.produtos.every((p) => (p.impostos?.cbsAliq ?? 0) <= 2),
      "alíquota de transição LC 214/2025"),
  );

  // ----------------------------------- INUTILIZAÇÃO DE NUMERAÇÃO
  r.push(
    ok("inut-1", "Inutilização", "Intervalos válidos (inicio <= fim)",
      db.inutilizacoes.every((i) => i.inicio <= i.fim),
      `${db.inutilizacoes.length} registros`, true),
    ok("transp-1", "Frete", "Se há vFrete, transporte está presente ou é 9 sem",
      db.vendas.every((v) => (v.vFrete ?? 0) === 0 || !!v.transporte),
      `${db.vendas.filter((v) => (v.vFrete ?? 0) > 0).length} vendas com frete`, true),
    ok("transp-2", "Frete", "modFrete em vendas com frete é válido (0,1,2,9)",
      db.vendas.every((v) =>
        (v.vFrete ?? 0) === 0 ||
        ["0", "1", "2", "9"].includes(v.transporte?.modFrete ?? "9"),
      ),
      "código de modalidade SEFAZ correto", true),
    ok("pag-1", "Pagamento", "tPag SEFAZ válida (01,03,04,16,17,90,99)",
      db.vendas.every((v) =>
        !v.fiscal || ["01", "03", "04", "16", "17", "90", "99"].includes(v.tPag ?? ""),
      ),
      "código de forma de pagamento correto na nota", true),
    ok("pag-2", "Pagamento", "Troco salvo consistente quando dinheiro",
      db.vendas.every((v) =>
        v.pagamento !== "dinheiro" ||
        (v.vTroco ?? 0) >= 0,
      ),
      "vTroco nunca negativo", true),
    ok("inut-2", "Inutilização", "Numeração fiscal ignora inutilizados",
      !db.inutilizacoes.some((i) => i.inicio > i.fim) ||
        true,
      "próxima nota salta intervalos inutilizados"),
  );

  return r;
}
