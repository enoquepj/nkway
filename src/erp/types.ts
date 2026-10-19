export const uid = () => Math.random().toString(36).slice(2, 10);

export type Produto = {
  id: string;
  nome: string;
  sku: string;
  categoria: string;
  custo: number;
  preco: number;
  estoque: number;
  estoqueMin: number;
};

export type Cliente = {
  id: string;
  nome: string;
  documento: string;
  email: string;
  telefone: string;
  cidade: string;
};

export type ItemVenda = {
  produtoId: string;
  nome: string;
  qtd: number;
  preco: number;
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

export type Venda = {
  id: string;
  numero: number;
  clienteId: string | null;
  clienteNome: string;
  itens: ItemVenda[];
  total: number;
  desconto: number;
  pagamento: "dinheiro" | "pix" | "credito" | "debito" | "boleto" | "prazo";
  data: number;
  /** dav = Documento Auxiliar de Venda (sem valor fiscal) | fiscal = nota emitida */
  tipo: "dav" | "fiscal";
  status: "aberto" | "faturado" | "cancelado";
  validade?: string; // yyyy-mm-dd (apenas DAV)
  observacao?: string;
  fiscal?: Fiscal;
};

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
};

export type ItemEntrada = {
  produtoId: string | null; // null = produto novo, será criado
  nome: string;
  sku: string;
  ncm: string;
  cfop: string;
  unidade: string;
  qtd: number;
  custo: number;
  /** preço de venda sugerido no momento da entrada */
  preco: number;
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
  origem: "xml" | "manual";
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
  produtos: Produto[];
  clientes: Cliente[];
  vendas: Venda[];
  lancamentos: Lancamento[];
  fornecedores: Fornecedor[];
  entradas: Entrada[];
  movimentos: Movimento[];
  mdfes: MDFe[];
};

export const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const hoje = new Date();
const d = (offset: number) => {
  const x = new Date(hoje);
  x.setDate(x.getDate() + offset);
  return x.toISOString().slice(0, 10);
};

export const seed: DB = {
  produtos: [
    { id: uid(), nome: "Camiseta Básica Branca", sku: "CAM-001", categoria: "Vestuário", custo: 18, preco: 49.9, estoque: 42, estoqueMin: 10 },
    { id: uid(), nome: "Calça Jeans Slim", sku: "CAL-014", categoria: "Vestuário", custo: 62, preco: 159.9, estoque: 8, estoqueMin: 12 },
    { id: uid(), nome: "Tênis Runner Pro", sku: "TEN-200", categoria: "Calçados", custo: 140, preco: 329.9, estoque: 15, estoqueMin: 5 },
    { id: uid(), nome: "Boné Aba Reta", sku: "BON-031", categoria: "Acessórios", custo: 15, preco: 59.9, estoque: 3, estoqueMin: 8 },
    { id: uid(), nome: "Meia Esportiva (par)", sku: "MEI-007", categoria: "Acessórios", custo: 6, preco: 19.9, estoque: 120, estoqueMin: 30 },
    { id: uid(), nome: "Jaqueta Corta-Vento", sku: "JAQ-055", categoria: "Vestuário", custo: 95, preco: 249.9, estoque: 11, estoqueMin: 6 },
  ],
  clientes: [
    { id: uid(), nome: "Ana Ribeiro", documento: "123.456.789-00", email: "ana@email.com", telefone: "(11) 98888-1020", cidade: "São Paulo" },
    { id: uid(), nome: "Mercado Bom Preço LTDA", documento: "12.345.678/0001-90", email: "compras@bompreco.com", telefone: "(11) 3344-5566", cidade: "Guarulhos" },
    { id: uid(), nome: "Carlos Menezes", documento: "987.654.321-00", email: "carlos@email.com", telefone: "(21) 97777-3040", cidade: "Rio de Janeiro" },
  ],
  vendas: [],
  fornecedores: [
    { id: uid(), nome: "Têxtil Brasil Indústria SA", cnpj: "45.678.901/0001-23", uf: "SP", telefone: "(11) 4002-8922" },
    { id: uid(), nome: "Distribuidora Calçados Sul", cnpj: "78.901.234/0001-56", uf: "RS", telefone: "(51) 3344-7788" },
  ],
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
