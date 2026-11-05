/** Parâmetros fiscais de produtos. Validação de formato não substitui tabela oficial ou contador. */
export const REGIMES_FISCAIS = [
  { id: "todos", rotulo: "Todos os regimes" },
  { id: "mei", rotulo: "MEI" },
  { id: "simples", rotulo: "Simples Nacional" },
  { id: "simples_excedente", rotulo: "Simples com excesso de sublimite" },
  { id: "presumido", rotulo: "Lucro Presumido" },
  { id: "real", rotulo: "Lucro Real" },
] as const;
export type RegimeFiscalPerfil = (typeof REGIMES_FISCAIS)[number]["id"];

export const TIPOS_CODIGO_FISCAL = [
  { id: "cfop", rotulo: "CFOP", tamanho: 4, dica: "Operação fiscal: 4 dígitos" },
  { id: "ncm", rotulo: "NCM", tamanho: 8, dica: "Classificação da mercadoria: 8 dígitos" },
  { id: "cest", rotulo: "CEST", tamanho: 7, dica: "Substituição tributária: 7 dígitos" },
  { id: "cst_icms", rotulo: "CST ICMS", tamanho: 2, dica: "Tributação do ICMS, sem a origem" },
  { id: "csosn", rotulo: "CSOSN", tamanho: 3, dica: "Situação do Simples Nacional / MEI" },
  { id: "cst_pis", rotulo: "CST PIS", tamanho: 2, dica: "Situação tributária do PIS" },
  { id: "cst_cofins", rotulo: "CST COFINS", tamanho: 2, dica: "Situação tributária da COFINS" },
  { id: "cst_ipi", rotulo: "CST IPI", tamanho: 2, dica: "Situação tributária do IPI" },
  { id: "cst_ibs_cbs", rotulo: "CST IBS/CBS", tamanho: 3, dica: "Situação da reforma tributária" },
  { id: "class_trib", rotulo: "cClassTrib IBS/CBS", tamanho: 6, dica: "Classificação tributária: 6 dígitos" },
] as const;
export type TipoCodigoFiscal = (typeof TIPOS_CODIGO_FISCAL)[number]["id"];

export const ORIGENS_MERCADORIA = [
  { id: "0", rotulo: "0 — Nacional" },
  { id: "1", rotulo: "1 — Estrangeira, importação direta" },
  { id: "2", rotulo: "2 — Estrangeira, adquirida no mercado interno" },
  { id: "3", rotulo: "3 — Nacional com conteúdo de importação superior a 40% e até 70%" },
  { id: "4", rotulo: "4 — Nacional conforme processos produtivos básicos" },
  { id: "5", rotulo: "5 — Nacional com conteúdo de importação até 40%" },
  { id: "6", rotulo: "6 — Estrangeira, importação direta sem similar nacional" },
  { id: "7", rotulo: "7 — Estrangeira, mercado interno sem similar nacional" },
  { id: "8", rotulo: "8 — Nacional com conteúdo de importação superior a 70%" },
] as const;
export const CSOSN_FISCAIS = ["101", "102", "103", "201", "202", "203", "300", "400", "500", "900"] as const;
export const CST_ICMS_FISCAIS = ["00", "02", "10", "15", "20", "30", "40", "41", "50", "51", "53", "60", "61", "70", "90"] as const;
export const CST_ICMS_MONOFASICO = ["02", "15", "53", "61"] as const;

export const CAMPOS_TRIBUTARIOS = [
  "ncm", "cest", "cfop", "cfopInterestadual", "origem", "tipoIcms", "csosn", "cstIcms",
  "cstPis", "cstCofins", "cstIpi", "cstIbsCbs", "classTrib", "beneficioFiscal",
  "icmsAliq", "pisAliq", "cofinsAliq", "ipiAliq", "icmsStAliq", "fcpAliq", "ibsAliq", "cbsAliq",
] as const;
export type CampoTributario = (typeof CAMPOS_TRIBUTARIOS)[number];
export type ParametrosTributarios = Record<CampoTributario, string>;

export const PARAMETROS_TRIBUTARIOS_VAZIOS: ParametrosTributarios = Object.fromEntries(CAMPOS_TRIBUTARIOS.map((campo) => [campo, ""])) as ParametrosTributarios;
const ALIQUOTAS = ["icmsAliq", "pisAliq", "cofinsAliq", "ipiAliq", "icmsStAliq", "fcpAliq", "ibsAliq", "cbsAliq"] as const;
const NOMES_ALIQUOTAS: Record<(typeof ALIQUOTAS)[number], string> = {
  icmsAliq: "ICMS", pisAliq: "PIS", cofinsAliq: "COFINS", ipiAliq: "IPI",
  icmsStAliq: "ICMS-ST", fcpAliq: "FCP", ibsAliq: "IBS", cbsAliq: "CBS",
};

export function crtSugeridoParaRegime(regime: string): number | null {
  if (regime === "mei") return 4;
  if (regime === "simples") return 1;
  if (regime === "simples_excedente") return 2;
  if (regime === "presumido" || regime === "real") return 3;
  return null;
}
export function rotuloRegimeFiscal(regime: string): string {
  return REGIMES_FISCAIS.find((r) => r.id === regime)?.rotulo ?? regime;
}

function textoCampo(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number" ? String(valor).trim() : "";
}
function apenasCodigo(valor: unknown): string {
  return textoCampo(valor).replace(/[.\s-]/g, "");
}

export function validarCodigoFiscal(tipo: unknown, valor: unknown): { ok: true; tipo: TipoCodigoFiscal; codigo: string } | { ok: false; erro: string } {
  const definicao = TIPOS_CODIGO_FISCAL.find((t) => t.id === tipo);
  if (!definicao) return { ok: false, erro: "Selecione um tipo de código fiscal válido." };
  const codigo = apenasCodigo(valor);
  if (!/^\d+$/.test(codigo) || codigo.length !== definicao.tamanho) return { ok: false, erro: `${definicao.rotulo} deve conter ${definicao.tamanho} dígitos.` };
  if (definicao.id === "cfop" && !/^[123567]/.test(codigo)) return { ok: false, erro: "CFOP deve iniciar com 1, 2, 3, 5, 6 ou 7." };
  if (definicao.id === "ncm" && codigo === "00000000") return { ok: false, erro: "NCM genérico não pode ser cadastrado como código válido." };
  if (definicao.id === "csosn" && !(CSOSN_FISCAIS as readonly string[]).includes(codigo)) return { ok: false, erro: "CSOSN não reconhecido. Consulte a tabela vigente." };
  if (definicao.id === "cst_icms" && !(CST_ICMS_FISCAIS as readonly string[]).includes(codigo)) return { ok: false, erro: "CST ICMS não reconhecido. Consulte a tabela vigente." };
  return { ok: true, tipo: definicao.id, codigo };
}

/** Os campos em branco representam ausência de informação, nunca uma alíquota presumida. */
export function validarParametrosTributarios(bruto: unknown): { ok: true; dados: ParametrosTributarios } | { ok: false; erro: string } {
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, unknown> : {};
  const dados = { ...PARAMETROS_TRIBUTARIOS_VAZIOS };
  for (const campo of CAMPOS_TRIBUTARIOS) dados[campo] = textoCampo(entrada[campo]);
  const codigos: { campo: CampoTributario; tamanho: number; rotulo: string }[] = [
    { campo: "ncm", tamanho: 8, rotulo: "NCM" }, { campo: "cest", tamanho: 7, rotulo: "CEST" },
    { campo: "cfop", tamanho: 4, rotulo: "CFOP de saída" }, { campo: "cfopInterestadual", tamanho: 4, rotulo: "CFOP interestadual" },
    { campo: "csosn", tamanho: 3, rotulo: "CSOSN" }, { campo: "cstIcms", tamanho: 2, rotulo: "CST ICMS" },
    { campo: "cstPis", tamanho: 2, rotulo: "CST PIS" }, { campo: "cstCofins", tamanho: 2, rotulo: "CST COFINS" },
    { campo: "cstIpi", tamanho: 2, rotulo: "CST IPI" }, { campo: "cstIbsCbs", tamanho: 3, rotulo: "CST IBS/CBS" },
    { campo: "classTrib", tamanho: 6, rotulo: "cClassTrib" },
  ];
  for (const { campo, tamanho, rotulo } of codigos) {
    dados[campo] = apenasCodigo(dados[campo]);
    // Campos ICMS inativos são preservados para não apagar cadastros antigos ou regimes anteriores.
    if ((campo === "csosn" && dados.tipoIcms !== "csosn") || (campo === "cstIcms" && dados.tipoIcms !== "cst")) continue;
    if (dados[campo] && (!/^\d+$/.test(dados[campo]) || dados[campo].length !== tamanho)) return { ok: false, erro: `${rotulo} deve conter ${tamanho} dígitos.` };
  }
  if (dados.cfop && !/^[567]/.test(dados.cfop)) return { ok: false, erro: "CFOP de saída deve iniciar com 5, 6 ou 7." };
  if (dados.cfopInterestadual && !dados.cfopInterestadual.startsWith("6")) return { ok: false, erro: "CFOP interestadual de saída deve iniciar com 6." };
  if (dados.origem && !/^[0-8]$/.test(dados.origem)) return { ok: false, erro: "Origem da mercadoria deve ser um código de 0 a 8." };
  if (dados.tipoIcms && !["csosn", "cst"].includes(dados.tipoIcms)) return { ok: false, erro: "Escolha CST ou CSOSN para o ICMS." };
  if (dados.tipoIcms === "csosn" && dados.csosn && !(CSOSN_FISCAIS as readonly string[]).includes(dados.csosn)) return { ok: false, erro: "CSOSN não reconhecido. Consulte a tabela vigente." };
  if (dados.tipoIcms === "cst" && dados.cstIcms && !(CST_ICMS_FISCAIS as readonly string[]).includes(dados.cstIcms)) return { ok: false, erro: "CST ICMS não reconhecido. Consulte a tabela vigente." };
  if (dados.tipoIcms === "csosn" && !dados.csosn) return { ok: false, erro: "Informe o CSOSN escolhido." };
  if (dados.tipoIcms === "cst" && !dados.cstIcms) return { ok: false, erro: "Informe o CST ICMS escolhido." };
  if (dados.cstIbsCbs && dados.classTrib && !dados.classTrib.startsWith(dados.cstIbsCbs)) return { ok: false, erro: "Os três primeiros dígitos do cClassTrib devem coincidir com o CST IBS/CBS." };
  dados.beneficioFiscal = dados.beneficioFiscal.toUpperCase();
  if (dados.beneficioFiscal && !/^[A-Z0-9]{1,16}$/.test(dados.beneficioFiscal)) return { ok: false, erro: "Benefício fiscal deve conter apenas letras e números (até 16 caracteres)." };
  for (const campo of ALIQUOTAS) {
    const valor = dados[campo].replace(",", ".");
    if (!valor) continue;
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(valor) || Number(valor) > 100) return { ok: false, erro: `Alíquota de ${NOMES_ALIQUOTAS[campo]} deve estar entre 0 e 100, com até 2 casas decimais.` };
    dados[campo] = String(Number(valor));
  }
  return { ok: true, dados };
}

export function validarRegimeTributario(dados: ParametrosTributarios, crt: number): string | null {
  if (dados.tipoIcms === "csosn" && ![1, 4].includes(crt)) return "CSOSN é usado com CRT 1 ou 4. Para CRT 2 ou 3, informe CST ICMS.";
  if (dados.tipoIcms === "cst" && [1, 4].includes(crt) && !(CST_ICMS_MONOFASICO as readonly string[]).includes(dados.cstIcms)) return "Para CRT 1 ou 4, use CSOSN; CST ICMS só deve ser usado nas situações monofásicas aplicáveis (02, 15, 53 ou 61).";
  return null;
}

/** Aplicar perfil é uma cópia explícita: campo em branco não apaga a informação do produto. */
export function aplicarPerfilTributario(atual: ParametrosTributarios, perfil: ParametrosTributarios): ParametrosTributarios {
  const resultado = { ...atual };
  for (const campo of CAMPOS_TRIBUTARIOS) if (perfil[campo] !== "") resultado[campo] = perfil[campo];
  return resultado;
}

export function avisosTributarios(dados: ParametrosTributarios, crt: number): string[] {
  const avisos: string[] = [];
  if (!dados.ncm || dados.ncm === "00000000") avisos.push("NCM não informado ou genérico: confirme o código vigente.");
  if (!dados.cfop) avisos.push("CFOP de saída não informado.");
  if (!dados.origem) avisos.push("Origem da mercadoria não informada.");
  if (!dados.tipoIcms) avisos.push("CST/CSOSN do produto ainda não foi revisado para o CRT atual.");
  const incompatibilidade = validarRegimeTributario(dados, crt);
  if (incompatibilidade) avisos.push(incompatibilidade);
  if (!dados.cstIbsCbs && !dados.classTrib) avisos.push("CST IBS/CBS e cClassTrib não informados; confirme a aplicabilidade com a contabilidade.");
  else if (Boolean(dados.cstIbsCbs) !== Boolean(dados.classTrib)) avisos.push("Informe CST IBS/CBS e cClassTrib em conjunto após validação contábil.");
  else if (!dados.classTrib.startsWith(dados.cstIbsCbs)) avisos.push("Os três primeiros dígitos do cClassTrib não coincidem com o CST IBS/CBS.");
  return avisos;
}
