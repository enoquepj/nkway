import type { DB } from "../types";
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

  return r;
}
