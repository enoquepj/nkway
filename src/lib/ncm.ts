/** NCM: consulta de classificação, nunca decisão de tributação. Modelo puro, sem rede ou banco. */
export const FONTE_NCM = "Receita Federal / Portal Único Siscomex — Classif";
export const URL_NCM = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";
export const URL_CLASSIF = "https://portalunico.siscomex.gov.br/classif/#/sumario?perfil=publico";
export const NCM_POR_PAGINA = 20;
export const NCM_CACHE_MS = 24 * 60 * 60 * 1000;
export const NCM_MAX_BYTES = 8 * 1024 * 1024;
export const NCM_MAX_REGISTROS = 40000;

export type CodigoErroNcm = "fonte_indisponivel" | "tempo_esgotado" | "resposta_invalida" | "tamanho_excedido" | "integridade" | "regressao" | "persistencia";
export const MENSAGENS_NCM: Record<CodigoErroNcm, string> = {
  fonte_indisponivel: "A fonte oficial não respondeu com sucesso. A última versão íntegra foi preservada.",
  tempo_esgotado: "A consulta à fonte oficial excedeu o tempo limite. A última versão íntegra foi preservada.",
  resposta_invalida: "A resposta da fonte não atende ao formato esperado. Nenhuma tabela válida foi substituída.",
  tamanho_excedido: "A resposta excedeu os limites de segurança e não foi importada.",
  integridade: "O catálogo exige revisão de integridade. A versão anterior foi preservada.",
  regressao: "A fonte retornou uma referência anterior à já coletada. A versão anterior foi preservada.",
  persistencia: "Não foi possível concluir a gravação do catálogo. Consulte novamente; os produtos não foram alterados.",
};
export class ErroNcm extends Error {
  constructor(public readonly codigo: CodigoErroNcm) { super(MENSAGENS_NCM[codigo]); this.name = "ErroNcm"; }
}
export function mensagemErroNcm(codigo: unknown): string | null {
  return typeof codigo === "string" && Object.hasOwn(MENSAGENS_NCM, codigo) ? MENSAGENS_NCM[codigo as CodigoErroNcm] : codigo ? "Consulta indisponível; mantenha os valores atuais e confirme a classificação manualmente." : null;
}

export type ItemNcm = { codigo: string; descricao: string; caminho: string; inicio: string; fim: string; ato: string };
export type RegistroNcm = ItemNcm & { busca: string };
export type CatalogoNcm = {
  referencia: string;
  referenciaFonte: string;
  ato: string;
  registros: RegistroNcm[];
  totalCodigos: number;
};
export type EstadoCatalogoNcm = "ausente" | "atual" | "desatualizado";
export type MetadadosNcm = {
  fonte: string;
  url: string;
  referencia: string | null;
  referenciaFonte: string | null;
  ato: string | null;
  coletadoEm: string | null;
  tentativaEm: string | null;
  falhaEm: string | null;
  erro: string | null;
  hash: string | null;
  totalRegistros: number;
  totalCodigos: number;
  estado: EstadoCatalogoNcm;
  atualizando: boolean;
  repetirApos: string | null;
};
export type ConsultaNcmDto = {
  catalogo: MetadadosNcm;
  consulta: string;
  pagina: number;
  porPagina: number;
  total: number;
  itens: ItemNcm[];
  grupos: ItemNcm[];
  podeAtualizar: boolean;
  hoje: string;
};

export function hojeNcm(agora = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(agora);
}
export function normalizarBuscaNcm(valor: string): string {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
/** Pontuação não transforma um grupo em NCM: nunca completar ou truncar dígitos. */
export function codigoNcmDigitado(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const codigo = valor.trim().replace(/[.\s-]/g, "");
  return /^\d{8}$/.test(codigo) ? codigo : null;
}
export function formatarCodigoNcm(codigo: string): string {
  return /^\d{8}$/.test(codigo) ? `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6)}` : codigo;
}
export function dataNcmBR(iso: string | null): string {
  return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "Não informada";
}
export function selecionavelNcm(item: ItemNcm, hoje: string): boolean {
  return /^\d{8}$/.test(item.codigo) && item.codigo !== "00000000" && item.inicio <= hoje && item.fim >= hoje;
}
export function termosConsultaNcm(consulta: string): { codigo: string | null; termos: string[] } {
  const digitos = consulta.replace(/[.\s-]/g, "");
  return /^\d+$/.test(digitos) ? { codigo: digitos, termos: [] } : { codigo: null, termos: normalizarBuscaNcm(consulta).split(" ").filter(Boolean).slice(0, 8) };
}
export function estadoCatalogoNcm(coletadoEm: Date | null, referencia: string | null, agora = new Date()): EstadoCatalogoNcm {
  if (!coletadoEm || !referencia) return "ausente";
  const hoje = hojeNcm(agora);
  const idadeReferencia = Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${referencia}T00:00:00Z`);
  const idadeColeta = agora.getTime() - coletadoEm.getTime();
  return !Number.isFinite(idadeColeta) || !Number.isFinite(idadeReferencia) || idadeReferencia !== 0 || idadeColeta < 0 || idadeColeta >= NCM_CACHE_MS ? "desatualizado" : "atual";
}

function objeto(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroNcm("resposta_invalida");
  return valor as Record<string, unknown>;
}
function textoFonte(valor: unknown, maximo: number): string {
  if (typeof valor !== "string" || !valor.trim() || valor.length > maximo || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(valor)) throw new ErroNcm("resposta_invalida");
  // O Classif ainda contém marcações de ênfase. Texto é sempre renderizado como texto, nunca HTML.
  return valor.replace(/<\/?(?:i|b|em|strong|sub|sup)\b[^>]*>/gi, "").replace(/\s+/g, " ").trim();
}
function dataFonte(valor: unknown): string {
  if (typeof valor !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) throw new ErroNcm("resposta_invalida");
  const [dia, mes, ano] = valor.split("/");
  const iso = `${ano}-${mes}-${dia}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== iso || Number(ano) < 1900) throw new ErroNcm("resposta_invalida");
  return iso;
}

/** Contrato observado no endpoint oficial. Falha integralmente: nunca descarta linhas inválidas em silêncio. */
export function validarCatalogoNcm(bruto: unknown): CatalogoNcm {
  const raiz = objeto(bruto);
  const referenciaFonte = textoFonte(raiz.Data_Ultima_Atualizacao_NCM, 80);
  const referencia = dataFonte(referenciaFonte.replace(/^Vigente em /, ""));
  const ato = textoFonte(raiz.Ato, 300);
  if (!Array.isArray(raiz.Nomenclaturas) || !raiz.Nomenclaturas.length) throw new ErroNcm("resposta_invalida");
  if (raiz.Nomenclaturas.length > NCM_MAX_REGISTROS) throw new ErroNcm("tamanho_excedido");
  const vistos = new Set<string>();
  const registros: RegistroNcm[] = raiz.Nomenclaturas.map((valor) => {
    const r = objeto(valor);
    const codigoOriginal = textoFonte(r.Codigo, 12);
    if (!/^[\d.]+$/.test(codigoOriginal)) throw new ErroNcm("resposta_invalida");
    const codigo = codigoOriginal.replace(/\./g, "");
    if (![2, 4, 5, 6, 7, 8].includes(codigo.length) || /^0+$/.test(codigo) || vistos.has(codigo)) throw new ErroNcm("resposta_invalida");
    vistos.add(codigo);
    const inicio = dataFonte(r.Data_Inicio), fim = dataFonte(r.Data_Fim);
    if (inicio > fim || inicio > referencia || fim < referencia) throw new ErroNcm("resposta_invalida");
    return {
      codigo, descricao: textoFonte(r.Descricao, 2000), caminho: "", inicio, fim,
      ato: `${textoFonte(r.Tipo_Ato_Ini, 120)} ${textoFonte(r.Numero_Ato_Ini, 40)}/${textoFonte(r.Ano_Ato_Ini, 4)}`,
      busca: "",
    };
  });
  const porCodigo = new Map(registros.map((r) => [r.codigo, r]));
  for (const registro of registros) {
    const pais = [2, 4, 5, 6, 7].filter((n) => n < registro.codigo.length).map((n) => porCodigo.get(registro.codigo.slice(0, n))).filter((r): r is RegistroNcm => !!r);
    registro.caminho = pais.map((p) => p.descricao.replace(/^[-\s]+/, "")).join(" › ");
    registro.busca = normalizarBuscaNcm(`${registro.codigo} ${registro.caminho} ${registro.descricao}`);
  }
  registros.sort((a, b) => a.codigo.localeCompare(b.codigo));
  const totalCodigos = registros.filter((r) => r.codigo.length === 8).length;
  if (!totalCodigos) throw new ErroNcm("resposta_invalida");
  return { referencia, referenciaFonte, ato, registros, totalCodigos };
}

/** Limites de sanidade, não contagens oficiais fixas. Redução abrupta exige revisão humana. */
export function conferirIntegridadeNcm(catalogo: CatalogoNcm, anterior?: { referencia: string | null; totalCodigos: number }, agora = new Date()): void {
  const completos = catalogo.registros.filter((r) => r.codigo.length === 8).length;
  const capitulos = catalogo.registros.filter((r) => r.codigo.length === 2).length;
  if (completos < 5000 || capitulos < 50 || completos !== catalogo.totalCodigos || catalogo.registros.length > NCM_MAX_REGISTROS) throw new ErroNcm("integridade");
  if (catalogo.referencia > hojeNcm(agora)) throw new ErroNcm("integridade");
  if (anterior?.referencia && catalogo.referencia < anterior.referencia) throw new ErroNcm("regressao");
  if (anterior && anterior.totalCodigos > 0 && completos < anterior.totalCodigos * 0.9) throw new ErroNcm("integridade");
}
