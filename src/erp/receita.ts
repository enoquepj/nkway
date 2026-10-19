/**
 * Validação e consulta de documentos fiscais (CPF/CNPJ).
 * Fonte pública: BrasilAPI (https://brasilapi.com.br) — dados da Receita
 * Federal + IBGE, gratuita, sem chave e com CORS liberado.
 */

const apenasDigitos = (s: string) => s.replace(/\D/g, "");

// --------------------------------------------------------------- VALIDAÇÕES
export function validarCnpj(cnpj: string): boolean {
  const c = apenasDigitos(cnpj);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: number) => {
    let soma = 0;
    let peso = base - 7;
    for (let i = 0; i < base; i++) {
      soma += Number(c[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function validarCpf(cpf: string): boolean {
  const c = apenasDigitos(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (base: number) => {
    let soma = 0;
    for (let i = 0; i < base; i++) soma += Number(c[i]) * (base + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export const tipoDocumento = (d: string): "cpf" | "cnpj" | "invalido" => {
  const n = apenasDigitos(d).length;
  return n === 11 ? "cpf" : n === 14 ? "cnpj" : "invalido";
};

export function formatDoc(d: string): string {
  const n = apenasDigitos(d);
  if (n.length === 11)
    return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (n.length === 14)
    return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return d;
}

// ------------------------------------------------------------ CONSULTA CNPJ
export type DadosReceita = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  codMunicipio: string;
  telefone: string;
  email: string;
  situacao: string;
};

export type ResultadoConsulta =
  | { ok: true; dados: DadosReceita }
  | { ok: false; erro: string };

export async function consultarCnpj(cnpjBruto: string): Promise<ResultadoConsulta> {
  const cnpj = apenasDigitos(cnpjBruto);

  if (!validarCnpj(cnpj))
    return { ok: false, erro: "CNPJ inválido — dígito verificador não confere." };

  let j: any;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404)
      return { ok: false, erro: "CNPJ não encontrado na base da Receita Federal." };
    if (!res.ok) return { ok: false, erro: `Rejeitado pela consulta pública (${res.status}).` };
    j = await res.json();
  } catch {
    return { ok: false, erro: "Sem conexão com a consulta pública. Verifique a internet." };
  }

  // Busca o código IBGE do município (obrigatório na NF-e)
  let codMunicipio = "";
  try {
    const r = await fetch(
      `https://brasilapi.com.br/api/ibge/municipios/v1/${j.uf}?providers=dados-abertos-br`,
      { signal: AbortSignal.timeout(8000) },
    );
    const lista: { codigo_ibge: string; nome: string }[] = await r.json();
    const norm = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const achado = lista.some((m) => norm(m.nome) === norm(j.municipio ?? ""))
      ? lista.find((m) => norm(m.nome) === norm(j.municipio ?? ""))!
      : lista.find((m) => norm(m.nome).includes(norm(j.municipio ?? ""))) ?? lista[0];
    codMunicipio = achado?.codigo_ibge ?? "";
  } catch {
    /* código fica vazio e a validação SEFAZ alertará */
  }

  return {
    ok: true,
    dados: {
      razaoSocial: j.razao_social ?? "",
      nomeFantasia: j.nome_fantasia ?? "",
      cnpj: formatDoc(cnpj),
      cep: apenasDigitos(j.cep ?? ""),
      logradouro: j.logradouro ?? "",
      numero: j.numero ?? "",
      complemento: j.complemento ?? "",
      bairro: j.bairro ?? "",
      municipio: j.municipio ?? "",
      uf: j.uf ?? "",
      codMunicipio,
      telefone: j.ddd_telefone_1 ?? "",
      email: j.email ?? "",
      situacao: j.situacao_cadastral ?? "",
    },
  };
}
