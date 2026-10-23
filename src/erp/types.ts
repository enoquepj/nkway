export const uid = () => Math.random().toString(36).slice(2, 10);

export type ConfigFiscal = {
  regime: "simples" | "simples_excedente" | "presumido" | "real" | "mei";
  crt: number; // Código de Regime Tributário SEFAZ (1=Simples, 2=SN excedente, 3=Normal, 4=MEI)
  ufPadrao: string;
  ie?: string;
  /** Series padrão de emissão por modelo */
  serieNfce?: string;
  serieNfe?: string;
  serieMdfe?: string;
  /** ---- Ambiente SEFAZ ---- */
  /** 1 = produção · 2 = homologação */
  ambiente: 1 | 2;
  /** ---- Certificado Digital A1 (.pfx) ---- */
  certificadoNome?: string;
  certificadoValidade?: string; // yyyy-mm-dd
  certificadoSerial?: string;
  /** ---- CSC — Código de Segurança do Contribuinte (NFC-e / QR Code) ---- */
  cscId?: string; // Identificador do token (1-6 dígitos)
  cscToken?: string; // Token informado pela SEFAZ
};

/** Inutilização de numeração fiscal — quando uma numeração pula sem emitir nota */
export type Inutilizacao = {
  id: string;
  /** Intervalo de numeração inutilizada */
  inicio: number;
  fim: number;
  justificativa: string;
  /** Protocolo retornado pela SEFAZ (inutilização não gera chave) */
  protocolo: string;
  chave: string; // formato próprio da SEFAZ p/ inutilização
  autorizadaEm: number;
};

/** Devolve a próxima numeração fiscal livre p/ a empresa, saltando números inutilizados */
export function proximaNotaFiscal(
  vendas: Venda[],
  inutilizacoes: Inutilizacao[],
): number {
  const usadas = new Set(vendas.filter((v) => v.fiscal).map((v) => v.fiscal!.numeroNota));
  const inutilizadas = new Set<number>();
  inutilizacoes.forEach((i) => {
    for (let n = i.inicio; n <= i.fim; n++) inutilizadas.add(n);
  });
  let proximo = 1;
  while (usadas.has(proximo) || inutilizadas.has(proximo)) proximo++;
  return proximo;
}

/** Evento de cancelamento fiscal (NF-e/NFC-e) — exista alcance de 30 min/24 h */
export type Cancelamento = {
  vendaId: string;
  motivo: string;
  /** Evento de cancelamento registrado pela loja */
  numeroEvento: number;
  protocolo: string;
  autenticadoEm: number;
};

export type ImpostosProduto = {
  ncm: string;
  cest: string;
  cfop: string;
  cstIcms: string;
  csosn: string; // Para Simples Nacional (101, 102, 103, 201...)
  icmsAliq: number;
  icmsReducao: number;
  cstIpi: string;
  ipiAliq: number;
  cstPis: string;
  pisAliq: number;
  cstCofins: string;
  cofinsAliq: number;
  origemMercadoria: number; // 0=Nacional, 1=Estrangeira, 2=Estrangeira adquirida...
  /** ---- Reforma Tributária (LC 214/2025 · transição 2026–2032) ---- */
  /** CBS — substitui PIS/COFINS; ano de teste 2026: 0,9% (compensável com IBS) */
  cbsAliq: number;
  /** IBS — substituirá ICMS/ISS; ano de teste 2026: 0,1% */
  ibsAliq: number;
};

export type Produto = {
  id: string;
  nome: string;
  sku: string;
  categoria: string;
  custo: number;
  preco: number;
  estoque: number;
  estoqueMin: number;
  /** GTIN/EAN-13 — código de barras. "SEM GTIN" quando isento */
  gtin: string;
  /** Unidade de comercialização usada na NF-e (uCom): UN, CX, KG... */
  unidade: string;
  marca: string;
  /** Produto pesável: preço por KG, exigido peso da balança no PDV */
  pesavel?: boolean;
  /** Código interno usado na etiqueta de balança (EAN começando com 2) */
  codBalanca?: string;
  impostos: ImpostosProduto;
};

/** Unidades de medida usadas na NF-e (uCom / uTrib) */
export const UNIDADES = [
  "UN", "CX", "KG", "G", "L", "ML", "M", "M2", "M3",
  "PAR", "DZ", "PC", "KIT", "SC", "ROL",
] as const;

/** Gera um EAN-13 válido (com dígito verificador) a partir de um número */
export function gerarGtin(base: number): string {
  const s = `789${String(base).padStart(9, "0")}`; // 3 + 9 = 12 dígitos
  let soma = 0;
  for (let i = 0; i < 12; i++)
    soma += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  const dv = (10 - (soma % 10)) % 10;
  return `${s}${dv}`;
}

/** Valida dígito verificador de EAN-13 */
export function validarGtin(g: string): boolean {
  if (g === "" || g === "SEM GTIN") return true;
  if (!/^\d{13}$/.test(g)) return false;
  let soma = 0;
  for (let i = 0; i < 12; i++)
    soma += Number(g[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (soma % 10)) % 10 === Number(g[12]);
}

export type Cliente = {
  id: string;
  nome: string;
  /** CPF (11) ou CNPJ (14) com ou sem máscara */
  documento: string;
  email: string;
  telefone: string;
  cidade: string;
  /** ---- Campos exigidos pela SEFAZ no <dest> da NF-e ---- */
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  uf?: string;
  /** Código IBGE do município (7 dígitos) — obrigatório na NF-e */
  codMunicipio?: string;
  /** indIEDest: 1=contribuinte ICMS, 2=isento, 9=não contribuinte */
  indIe?: "1" | "2" | "9";
  ie?: string;
  /** ---- Integração financeira ---- */
  limiteCredito?: number;
  condicaoPadrao?: "a vista" | "7d" | "14d" | "30d" | "60d";
};

export type ModeloFiscal = "NFC-e" | "NF-e" | "SAT";

export type Fiscal = {
  modelo: ModeloFiscal;
  serie: string;
  numeroNota: number;
  chave: string;
  protocolo: string;
  autorizadaEm: number;
};

/** transporte (tag <transp>) — frete e logística do despacho */
export type Transporte = {
  /** 0=por conta do emitente · 1=destinatário · 2=terceiro · 9=sem cobrança de frete */
  modFrete: "0" | "1" | "2" | "9";
  vFrete: number;
  transportadorNome?: string;
  transportadorCnpj?: string;
  /** veículo principal */
  placa?: string;
  ufVeiculo?: string;
  rntrc?: string;
  /** volumes */
  qtdVolumes?: number;
  especie?: string; // cx, saco, palete, etc.
  pesoLiquido?: number;
  pesoBruto?: number;
};

export const T_ROTULO_MOD_FRETE: Record<Transporte["modFrete"], string> = {
  "0": "Emitente",
  "1": "Destinatário",
  "2": "Terceiros",
  "9": "Sem frete",
};

export type Venda = {
  id: string;
  numero: number;
  clienteId: string | null;
  clienteNome: string;
  itens: ItemVenda[];
  total: number;
  desconto: number;
  /** frete excluso da formação do total (soma separadamente na nota) */
  vFrete: number;
  transporte?: Transporte | null;
  pagamento: "dinheiro" | "pix" | "credito" | "debito" | "boleto" | "prazo";
  /** tPag da tag <pag>: 01 dinheiro, 03 crédito, 04 débito, 16 depósito, 17 PIX, 18 consignado, 90 sem pagamento (DAV), 99 outros */
  tPag?: string;
  /** <pag><vPago> recebido e <vTroco> restante — só em dinheiro */
  vPago?: number;
  vTroco?: number;
  /** Pagamentos divididos (várias formas na mesma venda). `pagamento` guarda a forma principal. */
  pagamentos?: PagamentoParcial[];
  data: number;
  /** dav = Documento Auxiliar de Venda (sem valor fiscal) | fiscal = nota emitida */
  tipo: "dav" | "fiscal";
  status: "aberto" | "faturado" | "cancelado";
  validade?: string; // yyyy-mm-dd (apenas DAV)
  observacao?: string;
  fiscal?: Fiscal;
};

export type FormaPagamento = Venda["pagamento"];
export type PagamentoParcial = { forma: FormaPagamento; valor: number };

/** Parte da venda que vira conta a receber (boleto / a prazo) */
export function valorAPrazo(v: Pick<Venda, "pagamento" | "pagamentos" | "total">): number {
  if (v.pagamentos?.length)
    return Math.round(
      v.pagamentos
        .filter((p) => p.forma === "boleto" || p.forma === "prazo")
        .reduce((s, p) => s + p.valor, 0) * 100,
    ) / 100;
  return v.pagamento === "boleto" || v.pagamento === "prazo" ? v.total : 0;
}

/** Gera uma chave de acesso de 44 dígitos no formato da SEFAZ (simulada) */
export const gerarChave = (numeroNota: number) => {
  const d = new Date();
  const uf = "35";
  const aamm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const cnpj = "12345678000190";
  const mod = "65";
  const serie = "001";
  const nNF = String(numeroNota).padStart(9, "0");
  const tp = "1";
  const cNF = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
  const base = `${uf}${aamm}${cnpj}${mod}${serie}${nNF}${tp}${cNF}`;
  let soma = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    soma += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return `${base}${dv}`;
};

export const formatChave = (c: string) => c.replace(/(.{4})/g, "$1 ").trim();

export type Lancamento = {
  id: string;
  descricao: string;
  valor: number;
  tipo: "receber" | "pagar";
  vencimento: string; // yyyy-mm-dd
  pago: boolean;
  categoria: string;
};

// ---------------------------------------------------------------- COMPRAS
export type Fornecedor = {
  id: string;
  nome: string;
  cnpj: string;
  uf: string;
  telefone: string;
  email?: string;
  /** ---- Endereço estruturado exigido pela SEFAZ ---- */
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  codMunicipio?: string;
  /** indIEDest do destinatário quando a loja emite devolução */
  indIe?: "1" | "2" | "9";
  ie?: string;
  /** ---- Condições comerciais ---- */
  prazoPagDias?: number;
};

/** Devolução fiscal de compra (loja → fornecedor) */
export type Devolucao = {
  id: string;
  numero: number;
  fornecedor: string;
  cnpjFornecedor: string;
  itens: ItemEntrada[];
  total: number;
  /** Chave da NF-e de entrada original (tag NFref — obrigatória) */
  chaveReferente: string;
  /** CFOP da devolução: 5201 intraestadual / 6201 interestadual */
  cfop: string;
  /** Nota fiscal de devolução emitida pela loja */
  chave: string;
  protocolo: string;
  emitidoEm: number;
  /** Como o estorno foi lançado no financeiro */
  estorno: "estorno_pagar" | "a_receber";
  entradaId: string;
};

export type ItemEntrada = {
  produtoId: string | null; // null = produto novo, será criado
  nome: string;
  sku: string;
  ncm: string;
  cfop: string;
  unidade: string;
  qtd: number;
  /** quantidade original da nota (para conferência / divergência) */
  qtdNota?: number;
  custo: number;
  /** preço de venda sugerido no momento da entrada */
  preco: number;
  /** cEAN do XML — código de barras do fornecedor */
  gtin?: string;
  /** nome do item como veio no XML/SEFAZ (antes do vínculo interno) */
  nomeFornecedor?: string;
};

export type ItemVenda = {
  produtoId: string;
  nome: string;
  qtd: number;
  preco: number;
  unidade?: string;
  gtin?: string;
};

export type Entrada = {
  id: string;
  numeroNota: string;
  serie: string;
  chave: string;
  fornecedor: string;
  cnpjFornecedor: string;
  itens: ItemEntrada[];
  total: number;
  emissao: string; // yyyy-mm-dd
  status: "pendente" | "conferida" | "lancada";
  origem: "xml" | "manual" | "sefaz";
  gerarFinanceiro: boolean;
};

// ------------------------------------------------------- MOVIMENTO ESTOQUE
export type TipoMov =
  | "entrada"
  | "venda"
  | "ajuste"
  | "perda"
  | "devolucao"
  | "inventario"
  | "transferencia";

export type Movimento = {
  id: string;
  produtoId: string;
  produtoNome: string;
  tipo: TipoMov;
  qtd: number; // positivo = entra, negativo = sai
  saldoApos: number;
  custoUnit: number;
  documento: string;
  observacao?: string;
  data: number;
};

// ---------------------------------------------------------------- MDF-e
export type MDFe = {
  id: string;
  numero: number;
  serie: string;
  chave: string;
  protocolo: string;
  ufInicio: string;
  ufFim: string;
  municipioCarregamento: string;
  municipioDescarregamento: string;
  placa: string;
  ufVeiculo: string;
  rntrc: string;
  condutor: string;
  cpfCondutor: string;
  documentos: { chave: string; tipo: "NF-e" | "NFC-e"; valor: number }[];
  pesoBruto: number;
  valorCarga: number;
  status: "autorizado" | "encerrado" | "cancelado";
  emitidoEm: number;
  encerradoEm?: number;
};

export type DB = {
  configFiscal: ConfigFiscal;
  produtos: Produto[];
  clientes: Cliente[];
  vendas: Venda[];
  lancamentos: Lancamento[];
  fornecedores: Fornecedor[];
  entradas: Entrada[];
  movimentos: Movimento[];
  mdfes: MDFe[];
  devolucoes: Devolucao[];
  cancelamentos: Cancelamento[];
  inutilizacoes: Inutilizacao[];
};

/** Tributos estimados para transparência fiscal (Lei 12.741) — inclui fase IBS/CBS da reforma */
export function tributosEstimados(
  valor: number,
  imp: Pick<ImpostosProduto, "icmsAliq" | "pisAliq" | "cofinsAliq" | "cbsAliq" | "ibsAliq">,
) {
  const icms = (valor * imp.icmsAliq) / 100;
  const pisCofins = (valor * (imp.pisAliq + imp.cofinsAliq)) / 100;
  const cbs = (valor * imp.cbsAliq) / 100;
  const ibs = (valor * imp.ibsAliq) / 100;
  return { icms, pisCofins, cbs, ibs, total: icms + pisCofins + cbs + ibs };
}

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Verifica se o cliente tem todos os campos que a SEFAZ exige no <dest> da NF-e */
export function statusSefazCliente(c: Cliente): { ok: boolean; faltando: string[] } {
  const faltando: string[] = [];
  if (!c.nome?.trim()) faltando.push("nome");
  if ((c.documento ?? "").replace(/\D/g, "").length < 11) faltando.push("CPF/CNPJ válido");
  if (((c.cep ?? "").replace(/\D/g, "").length) !== 8) faltando.push("CEP (8 dígitos)");
  if (!c.logradouro?.trim()) faltando.push("logradouro");
  if (!c.numero?.trim()) faltando.push("número");
  if (!c.bairro?.trim()) faltando.push("bairro");
  if (!c.cidade?.trim()) faltando.push("município");
  if (!c.uf?.trim()) faltando.push("UF");
  if (((c.codMunicipio ?? "").length) !== 7) faltando.push("código IBGE do município");
  if (!c.indIe) faltando.push("indicador de IE");
  if (c.indIe === "1" && !c.ie?.trim()) faltando.push("inscrição estadual");
  return { ok: faltando.length === 0, faltando };
}

const hoje = new Date();
const d = (offset: number) => {
  const x = new Date(hoje);
  x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};

const IMPOSTOS_PADRAO: ImpostosProduto = {
  ncm: "61091000",
  cest: "",
  cfop: "5102",
  cstIcms: "00",
  csosn: "101",
  icmsAliq: 18,
  icmsReducao: 0,
  cstIpi: "55",
  ipiAliq: 0,
  cstPis: "01",
  pisAliq: 1.65,
  cstCofins: "01",
  cofinsAliq: 7.6,
  origemMercadoria: 0,
  cbsAliq: 0.9,
  ibsAliq: 0.1,
};

export const seed: DB = {
  configFiscal: {
    regime: "simples",
    crt: 1,
    ufPadrao: "SP",
    ie: "123.456.789.000",
    serieNfce: "1",
    serieNfe: "1",
    ambiente: 2 as const, // homologação — troque p/ 1 em produção
    certificadoNome: "",
    certificadoValidade: "",
    certificadoSerial: "",
    cscId: "000001",
    cscToken: "",
  },
  fornecedores: [
    {
      id: uid(), nome: "Têxtil Brasil Indústria SA", cnpj: "45.678.901/0001-23",
      telefone: "(11) 4002-8922", email: "vendas@textilbrasil.com.br",
      cep: "01121010", logradouro: "Rua da Mooca", numero: "1240", bairro: "Mooca",
      cidade: "São Paulo", uf: "SP", codMunicipio: "3550308", indIe: "1",
      ie: "112.515.229.100", prazoPagDias: 30,
    },
    {
      id: uid(), nome: "Distribuidora Calçados Sul", cnpj: "78.901.234/0001-56",
      telefone: "(51) 3344-7788", email: "pedidos@calcadossul.com.br",
      cep: "93260000", logradouro: "Rodovia Presidente Dutra", numero: "Km 221", bairro: "Distrito Industrial",
      cidade: "Sapucaia do Sul", uf: "RS", codMunicipio: "4320008", indIe: "1",
      ie: "096.281.960.10", prazoPagDias: 45,
    },
  ],
  devolucoes: [],
  cancelamentos: [],
  inutilizacoes: [],
  produtos: [
    {
      id: uid(), nome: "Camiseta Básica Branca",
      gtin: gerarGtin(101001), unidade: "UN", marca: "Básica", sku: "CAM-001", categoria: "Vestuário",
      custo: 18, preco: 49.9, estoque: 42, estoqueMin: 10,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    {
      id: uid(), nome: "Calça Jeans Slim",
      gtin: gerarGtin(102014), unidade: "UN", marca: "Denim Co", sku: "CAL-014", categoria: "Vestuário",
      custo: 62, preco: 159.9, estoque: 8, estoqueMin: 12,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    {
      id: uid(), nome: "Tênis Runner Pro",
      gtin: gerarGtin(103200), unidade: "PAR", marca: "RunStep", sku: "TEN-200", categoria: "Calçados",
      custo: 140, preco: 329.9, estoque: 15, estoqueMin: 5,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    {
      id: uid(), nome: "Boné Aba Reta",
      gtin: gerarGtin(104031), unidade: "UN", marca: "Capline", sku: "BON-031", categoria: "Acessórios",
      custo: 15, preco: 59.9, estoque: 3, estoqueMin: 8,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    {
      id: uid(), nome: "Meia Esportiva (par)",
      gtin: gerarGtin(105007), unidade: "PAR", marca: "SockPro", sku: "MEI-007", categoria: "Acessórios",
      custo: 6, preco: 19.9, estoque: 120, estoqueMin: 30,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    {
      id: uid(), nome: "Jaqueta Corta-Vento",
      gtin: gerarGtin(106055), unidade: "UN", marca: "WindOff", sku: "JAQ-055", categoria: "Vestuário",
      custo: 95, preco: 249.9, estoque: 11, estoqueMin: 6,
      impostos: { ...IMPOSTOS_PADRAO },
    },
    // ---- produtos pesáveis (frutas, hortifrúti, açougue, frios) ----
    {
      id: uid(), nome: "Banana Prata", sku: "FRU-101", categoria: "Hortifrúti",
      gtin: "", unidade: "KG", marca: "", pesavel: true, codBalanca: "00101",
      custo: 4.2, preco: 7.99, estoque: 38, estoqueMin: 8,
      impostos: { ...IMPOSTOS_PADRAO, ncm: "08039000", cfop: "5102" },
    },
    {
      id: uid(), nome: "Queijo Mussarela Fatiado", sku: "FRI-102", categoria: "Frios",
      gtin: "", unidade: "KG", marca: "Laticínios Vale", pesavel: true, codBalanca: "00102",
      custo: 32, preco: 59.9, estoque: 14, estoqueMin: 4,
      impostos: { ...IMPOSTOS_PADRAO, ncm: "04061010", cfop: "5102" },
    },
    {
      id: uid(), nome: "Peito de Frango Resfriado", sku: "ACO-103", categoria: "Açougue",
      gtin: "", unidade: "KG", marca: "", pesavel: true, codBalanca: "00103",
      custo: 11.9, preco: 21.9, estoque: 26, estoqueMin: 6,
      impostos: { ...IMPOSTOS_PADRAO, ncm: "02071300", cfop: "5102" },
    },
  ],
  clientes: [
    {
      id: uid(), nome: "Mercado Bom Preço LTDA", documento: "12.345.678/0001-90",
      email: "compras@bompreco.com", telefone: "(11) 3344-5566", cidade: "Guarulhos",
      cep: "07094420", logradouro: "Av. Guarulhos", numero: "1250", bairro: "Centro",
      uf: "SP", codMunicipio: "3518800", indIe: "1", ie: "149.626.224.113",
      limiteCredito: 10000, condicaoPadrao: "30d",
    },
    {
      id: uid(), nome: "Ana Ribeiro", documento: "123.456.789-00", email: "ana@email.com",
      telefone: "(11) 98888-1020", cidade: "São Paulo",
      cep: "01310930", logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista",
      uf: "SP", codMunicipio: "3550308", indIe: "9",
      limiteCredito: 1000, condicaoPadrao: "a vista",
    },
    {
      id: uid(), nome: "Carlos Menezes", documento: "987.654.321-00", email: "carlos@email.com",
      telefone: "(21) 97777-3040", cidade: "Rio de Janeiro",
      cep: "20040004", logradouro: "Rua da Quitanda", numero: "50", bairro: "Centro",
      uf: "RJ", codMunicipio: "3304557", indIe: "9",
      limiteCredito: 500, condicaoPadrao: "a vista",
    },
  ],
  vendas: [],
  entradas: [],
  movimentos: [],
  mdfes: [],
  lancamentos: [
    { id: uid(), descricao: "Aluguel da loja", valor: 3200, tipo: "pagar", vencimento: d(5), pago: false, categoria: "Fixo" },
    { id: uid(), descricao: "Fornecedor Têxtil SA", valor: 4850.4, tipo: "pagar", vencimento: d(-2), pago: false, categoria: "Compras" },
    { id: uid(), descricao: "Energia elétrica", valor: 740.25, tipo: "pagar", vencimento: d(12), pago: false, categoria: "Fixo" },
    { id: uid(), descricao: "Venda a prazo — Mercado Bom Preço", valor: 2890, tipo: "receber", vencimento: d(8), pago: false, categoria: "Vendas" },
    { id: uid(), descricao: "Venda a prazo — Ana Ribeiro", valor: 459.8, tipo: "receber", vencimento: d(-1), pago: false, categoria: "Vendas" },
  ],
};
