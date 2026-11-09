/**
 * CEST — etapa 2 do roteiro fiscal.
 * Referência LOCAL por empresa, com proveniência declarada. Nunca seleção automática
 * e nunca tabela "oficial" inventada: o CONFAZ publica o CEST apenas nos anexos em PDF
 * do Convênio ICMS 92/2015 (atualizados pelos Convênios 52/2017, 142/2018 e seguintes),
 * sem fonte estruturada oficial; fontes de terceiros exigem revisão de licença antes.
 * Modelo puro, sem rede e sem banco.
 */
export const FONTE_CEST_LOCAL = "Referência local da empresa";
export const NOTA_FONTE_CEST =
  "CONFAZ publica o CEST apenas em anexos PDF (Conv. ICMS 92/2015 e atualizações). Não há fonte oficial estruturada; nenhuma tabela de terceiro foi adotada sem revisão de licença. Esta referência é local, por empresa, e não é validação oficial.";
export const CEST_POR_PAGINA = 20;
export const CEST_MAX_REGISTROS = 5000;
export const CEST_MAX_NCM_POR_REGISTRO = 50;

export type CodigoErroCest = "registro_invalido" | "duplicado" | "limite_excedido" | "nao_encontrado" | "persistencia" | "acesso_negado";
export const MENSAGENS_CEST: Record<CodigoErroCest, string> = {
  registro_invalido: "Registro de CEST inválido: 7 dígitos (SS.III.DD), descrição e NCMs relacionados em formato válido.",
  duplicado: "Já existe referência local com este CEST nesta empresa.",
  limite_excedido: "A referência local excedeu o limite de registros permitido.",
  nao_encontrado: "CEST não encontrado na referência local desta empresa.",
  persistencia: "Não foi possível gravar a referência local. Nada foi alterado; tente novamente.",
  acesso_negado: "Somente quem gerencia a configuração pode alterar a referência local de CEST.",
};
export class ErroCest extends Error {
  constructor(public readonly codigo: CodigoErroCest) { super(MENSAGENS_CEST[codigo]); this.name = "ErroCest"; }
}
export function mensagemErroCest(codigo: unknown): string | null {
  return typeof codigo === "string" && Object.hasOwn(MENSAGENS_CEST, codigo) ? MENSAGENS_CEST[codigo as CodigoErroCest] : codigo ? "Referência local indisponível; o preenchimento manual do CEST continua possível." : null;
}

export type RegistroCest = {
  cest: string;
  descricao: string;
  segmento: string;
  ncm: string[];
  fonte: string;
  ato: string;
  vigencia: string;
  busca: string;
};
export type ItemCest = Omit<RegistroCest, "busca">;
export type MetadadosCest = {
  fonte: string;
  nota: string;
  totalRegistros: number;
  hash: string | null;
  atualizadoEm: string | null;
  estado: "ausente" | "disponivel";
};
export type ConsultaCestDto = {
  catalogo: MetadadosCest;
  consulta: string;
  pagina: number;
  porPagina: number;
  total: number;
  itens: ItemCest[];
  podeGerenciar: boolean;
};
export type ResultadoCest = { ok: true; estado: "atualizado" | "removido"; mensagem: string; catalogo: MetadadosCest } | { ok: false; erro: string; codigo?: CodigoErroCest };

export function normalizarBuscaCest(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
/** Pontuação não transforma código curto em CEST: nunca completa nem trunca dígitos; zero inicial preservado. */
export function codigoCestDigitado(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const codigo = valor.trim().replace(/[.\s-]/g, "");
  return /^\d{7}$/.test(codigo) && !/^0+$/.test(codigo) ? codigo : null;
}
export function formatarCest(cest: string): string {
  return /^\d{7}$/.test(cest) ? `${cest.slice(0, 2)}.${cest.slice(2, 5)}.${cest.slice(5)}` : cest;
}
export function segmentoCest(cest: string): string {
  return /^[0-9]{2}/.test(cest) ? cest.slice(0, 2) : "";
}
/**
 * Busca por dígitos cobre prefixo de CEST (1–7 dígitos) e prefixo/exato de NCM/SH
 * (os anexos do Conv. 142/2018 usam NCM de 2, 4, 6 ou 8 dígitos, ex.: 2205, 2402, 3003).
 * Texto livre vira termos de busca na descrição/fonte.
 */
export function termosConsultaCest(consulta: string): { digitos: string | null; termos: string[] } {
  const digitos = consulta.replace(/[.\s-]/g, "");
  if (/^\d+$/.test(digitos)) return { digitos, termos: [] };
  return { digitos: null, termos: normalizarBuscaCest(consulta).split(" ").filter(Boolean).slice(0, 8) };
}

function objeto(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroCest("registro_invalido");
  return valor as Record<string, unknown>;
}
function textoLimpo(valor: unknown, maximo: number): string {
  if (typeof valor !== "string" || valor.length > maximo || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(valor)) throw new ErroCest("registro_invalido");
  return valor.replace(/\s+/g, " ").trim();
}
/** NCM/SH nos anexos pode ser prefixo de 2, 4, 6 ou 8 dígitos; zero inicial preservado. */
function ncmValido(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const codigo = valor.trim().replace(/[.\s-]/g, "");
  return /^\d{2}(\d{2})?(\d{2})?(\d{2})?$/.test(codigo) && !/^0+$/.test(codigo) ? codigo : null;
}

/** Um registro da referência local: CEST de 7 dígitos + descrição + NCMs relacionados + proveniência declarada. */
export function validarRegistroCest(bruto: unknown): RegistroCest {
  const r = objeto(bruto);
  const cest = codigoCestDigitado(String(r.cest ?? ""));
  if (!cest) throw new ErroCest("registro_invalido");
  const descricao = textoLimpo(r.descricao, 300);
  if (descricao.length < 3) throw new ErroCest("registro_invalido");
  let ncmBruto: unknown = r.ncm ?? [];
  if (typeof ncmBruto === "string") ncmBruto = ncmBruto.split(/[\s,;/]+/).filter(Boolean);
  if (!Array.isArray(ncmBruto) || ncmBruto.length > CEST_MAX_NCM_POR_REGISTRO) throw new ErroCest("registro_invalido");
  const ncmParseado = ncmBruto.map(ncmValido);
  if (ncmParseado.some((n) => !n)) throw new ErroCest("registro_invalido");
  const ncm = [...new Set(ncmParseado as string[])].sort();
  const fonte = textoLimpo(r.fonte ?? "", 120) || FONTE_CEST_LOCAL;
  const ato = textoLimpo(r.ato ?? "", 120);
  const vigencia = textoLimpo(r.vigencia ?? "", 40);
  const segmento = segmentoCest(cest);
  return { cest, descricao, segmento, ncm, fonte, ato, vigencia, busca: normalizarBuscaCest(`${cest} ${formatarCest(cest)} ${segmento} ${descricao} ${ncm.join(" ")}`) };
}

/** Catálogo local: unicidade de CEST, limite de sanidade e ordenação. Nunca altera produtos. */
export function validarCatalogoCest(registros: unknown[]): RegistroCest[] {
  if (!Array.isArray(registros)) throw new ErroCest("registro_invalido");
  if (registros.length > CEST_MAX_REGISTROS) throw new ErroCest("limite_excedido");
  const vistos = new Set<string>();
  const validos = registros.map((r) => {
    const registro = validarRegistroCest(r);
    if (vistos.has(registro.cest)) throw new ErroCest("duplicado");
    vistos.add(registro.cest);
    return registro;
  });
  validos.sort((a, b) => a.cest.localeCompare(b.cest));
  return validos;
}

export function estadoCatalogoCest(totalRegistros: number): MetadadosCest["estado"] {
  return totalRegistros > 0 ? "disponivel" : "ausente";
}
