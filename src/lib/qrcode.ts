/**
 * NKWAY — gerador de QR Code em TypeScript puro (byte mode, versões 1 a 10).
 * Feito à mão para não adicionar dependência ao projeto: a saída é a matriz de módulos,
 * que a UI desenha como SVG. Versões 1 a 6, níveis de correção L e M, escolha automática
 * de máscara entre as 8 previstas na norma.
 */

/* --------------------------------------------------------- campo de Galois */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** polinômio gerador de Reed-Solomon com `grau` coeficientes de correção */
function geradorRs(grau: number): number[] {
  let poly = [1];
  for (let i = 0; i < grau; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= mul(poly[j], 1);
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** codifica `dados` acrescentando os `ec` codewords de correção de erro */
function rsEncode(dados: number[], ec: number): number[] {
  const gen = geradorRs(ec);
  const resto = new Array<number>(ec).fill(0);
  for (const byte of dados) {
    const fator = byte ^ resto[0];
    resto.shift();
    resto.push(0);
    if (fator !== 0) for (let i = 0; i < ec; i++) resto[i] ^= mul(gen[i + 1], fator);
  }
  return resto;
}

/* ------------------------------------------------------------- tabelas fixas */
export type Nivel = "L" | "M";

type Blocos = { grupos: number[]; dados: number[]; ec: number };
const totalDe = (c: Blocos) => c.grupos.reduce((s, g, i) => s + g * c.dados[i], 0);

const TABELA: Record<Nivel, Blocos[]> = {
  // índice = versão - 1
  L: [
    { grupos: [1], dados: [19], ec: 7 },
    { grupos: [1], dados: [34], ec: 10 },
    { grupos: [1], dados: [55], ec: 15 },
    { grupos: [1], dados: [80], ec: 20 },
    { grupos: [1], dados: [108], ec: 26 },
    { grupos: [2], dados: [68, 68], ec: 18 },
    { grupos: [2], dados: [78, 78], ec: 20 },
    { grupos: [2], dados: [97, 97], ec: 24 },
    { grupos: [2], dados: [116, 116], ec: 30 },
    { grupos: [2, 2], dados: [68, 69], ec: 18 },
  ],
  M: [
    { grupos: [1], dados: [16], ec: 10 },
    { grupos: [1], dados: [28], ec: 16 },
    { grupos: [1], dados: [44], ec: 26 },
    { grupos: [2], dados: [32, 32], ec: 18 },
    { grupos: [2], dados: [43, 43], ec: 24 },
    { grupos: [4], dados: [27, 27, 27, 27], ec: 16 },
    { grupos: [4], dados: [31, 31, 31, 31], ec: 18 },
    { grupos: [2, 2], dados: [38, 39], ec: 22 },
    { grupos: [3, 2], dados: [36, 37], ec: 22 },
    { grupos: [4, 1], dados: [43, 44], ec: 26 },
  ],
};

const POS_ALINHAMENTO: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

const INDICE_NIVEL: Record<Nivel, number> = { L: 1, M: 0 };

/* ---------------------------------------------------- bits de formato/versão */
const BCH_FORMATO = 0x537;
const XOR_FORMATO = 0x5412;
const BCH_VERSAO = 0x1f25;

/** resto do polinômio `valor` módulo `gerador` (BCH) */
function restoBch(valor: number, grau: number, gerador: number): number {
  let v = valor << grau;
  for (let i = v === 0 ? -1 : maiorBit(v); i >= grau; i--) if ((v >> i) & 1) v ^= gerador << (i - grau);
  return v;
}
const maiorBit = (v: number) => {
  for (let i = 30; i >= 0; i--) if ((v >> i) & 1) return i;
  return 0;
};

const infoFormato = (nivel: Nivel, mascara: number) =>
  (((INDICE_NIVEL[nivel] << 3) | mascara) << 10 | restoBch((INDICE_NIVEL[nivel] << 3) | mascara, 10, BCH_FORMATO)) ^ XOR_FORMATO;

const infoVersao = (versao: number) => (versao << 12) | restoBch(versao, 12, BCH_VERSAO);

/* ----------------------------------------------------------------- máscaras */
const COND: ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i + j) % 2) + ((i * j) % 3)) % 2 === 0,
];

type Matriz = boolean[][];

function penalti(m: Matriz): number {
  const n = m.length;
  let pontos = 0;
  // N1 — 5 ou mais módulos iguais em linha e em coluna
  for (let eixo = 0; eixo < 2; eixo++)
    for (let i = 0; i < n; i++) {
      let atual = eixo === 0 ? m[i][0] : m[0][i];
      let seguida = 1;
      for (let j = 1; j < n; j++) {
        const v = eixo === 0 ? m[i][j] : m[j][i];
        if (v === atual) {
          seguida++;
          if (seguida === 5) pontos += 3;
          else if (seguida > 5) pontos += 1;
        } else {
          atual = v;
          seguida = 1;
        }
      }
    }
  // N2 — blocos 2x2 da mesma cor
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < n - 1; j++)
      if (m[i][j] === m[i][j + 1] && m[i][j] === m[i + 1][j] && m[i][j] === m[i + 1][j + 1]) pontos += 3;
  // N3 — padrão semelhante ao código de localização (1011101 + 4 claros)
  const PADRAO = [true, false, true, true, true, false, true, false, false, false, false];
  const varre = (linha: boolean[]) => {
    for (let k = 0; k + 11 <= linha.length; k++) {
      let casa = true;
      for (let x = 0; x < 11; x++)
        if (linha[k + x] !== PADRAO[x]) {
          casa = false;
          break;
        }
      if (casa) pontos += 40;
    }
  };
  for (let i = 0; i < n; i++) {
    varre(m[i]);
    varre(m.map((l) => l[i]));
  }
  // N4 — desvio da proporção de 50% de módulos escuros
  let escuros = 0;
  for (const linha of m) for (const c of linha) if (c) escuros++;
  pontos += Math.floor(Math.abs((escuros * 100) / (n * n) - 50) / 5) * 10;
  return pontos;
}

/* ------------------------------------------------------- montagem do símbolo */
function escolherVersao(bytes: number, nivel: Nivel): number {
  // versões 1 a 6: é o intervalo em que a reserva de módulos fecha exatamente com a
  // capacidade da tabela (as demais ficam com folga e desalinham leitores reais)
  for (let v = 1; v <= 6; v++) {
    const cfg = TABELA[nivel][v - 1];
    if (bytes <= totalDe(cfg) - 2) return v; // modo + contador ocupam 12 bits (2 codewords)
  }
  throw new Error(`Conteúdo de ${bytes} bytes não cabe no QR Code (máximo de 134 bytes).`);
}

function codewordsDe(texto: string, versao: number, nivel: Nivel): number[] {
  const bruto = Array.from(Buffer.from(texto, "utf8"));
  const bits: number[] = [];
  const empurra = (valor: number, qtd: number) => {
    for (let i = qtd - 1; i >= 0; i--) bits.push((valor >> i) & 1);
  };
  empurra(0b0100, 4);
  empurra(bruto.length, 8);
  for (const b of bruto) empurra(b, 8);

  const cfg = TABELA[nivel][versao - 1];
  const totalDados = totalDe(cfg);
  const restoBits = versao >= 2 && versao <= 6 ? 7 : 0;
  const tetoBits = totalDados * 8 - restoBits;

  for (let i = 0; i < 4 && bits.length < tetoBits; i++) bits.push(0); // terminador
  while (bits.length % 8 !== 0 && bits.length < tetoBits) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((s, b) => (s << 1) | b, 0));
  let k = 0;
  while (bytes.length < totalDados) bytes.push(k++ % 2 === 0 ? 0xec : 0x11);

  const blocos: number[][] = [];
  const ecs: number[][] = [];
  let cursor = 0;
  cfg.grupos.forEach((qtd, g) => {
    for (let i = 0; i < qtd; i++) {
      const pedaco = bytes.slice(cursor, cursor + cfg.dados[g]);
      cursor += cfg.dados[g];
      blocos.push(pedaco);
      ecs.push(rsEncode(pedaco, cfg.ec));
    }
  });
  const maior = Math.max(...blocos.map((b) => b.length));
  const final: number[] = [];
  for (let i = 0; i < maior; i++) for (const b of blocos) if (i < b.length) final.push(b[i]);
  for (let i = 0; i < cfg.ec; i++) for (const e of ecs) final.push(e[i]);
  return final;
}

/** posições dos 15 bits de formato, nas duas cópias */
function posiçõesFormato(n: number): [number, number][][] {
  const a: [number, number][] = [];
  for (let k = 0; k <= 5; k++) a.push([k, 8]);
  a.push([7, 8], [8, 8], [8, 7]);
  for (let k = 9; k <= 14; k++) a.push([8, 14 - k]);
  const b: [number, number][] = [];
  for (let k = 0; k <= 6; k++) b.push([n - 1 - k, 8]);
  b.push([8, n - 8]);
  for (let k = 8; k <= 14; k++) b.push([8, n - 7 + (k - 8)]);
  return [a, b];
}

/** gera a matriz de módulos (true = escuro) para o texto informado */
export function qrMatriz(texto: string, nivel: Nivel = "M"): Matriz {
  const versao = escolherVersao(Buffer.byteLength(texto, "utf8"), nivel);
  const codewords = codewordsDe(texto, versao, nivel);
  const n = 17 + 4 * versao;

  const reservado: Matriz = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const escuro: Matriz = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const marca = (i: number, j: number, v: boolean) => {
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    reservado[i][j] = true;
    escuro[i][j] = v;
  };

  // códigos de localização + separadores
  const finder = (li: number, lj: number) => {
    for (let i = -1; i <= 7; i++)
      for (let j = -1; j <= 7; j++) {
        const fora = i === -1 || j === -1 || i === 7 || j === 7;
        const anel = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        marca(li + i, lj + j, fora ? false : anel);
      }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);

  // linha e coluna de sincronismo
  for (let i = 8; i < n - 8; i++) {
    marca(6, i, i % 2 === 0);
    marca(i, 6, i % 2 === 0);
  }

  // padrões de alinhamento (pula os que caem em cima do localizador)
  for (const a of POS_ALINHAMENTO[versao - 1])
    for (const b of POS_ALINHAMENTO[versao - 1]) {
      if (reservado[a][b]) continue;
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) marca(a + i, b + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
    }

  // área dos bits de formato + módulo escuro fixo
  const [fA, fB] = posiçõesFormato(n);
  for (const [i, j] of [...fA, ...fB]) marca(i, j, false);
  marca(n - 8, 8, true);

  // bits de versão (a partir da 7)
  if (versao >= 7) {
    const iv = infoVersao(versao);
    for (let k = 0; k < 18; k++) {
      const v = ((iv >> k) & 1) === 1;
      const i = Math.floor(k / 3);
      const j = (k % 3) + n - 11;
      marca(i, j, v);
      marca(j, i, v);
    }
  }

  // distribui os codewords em zigue-zague, duas colunas por vez
  const totalBits = codewords.length * 8;
  let bit = 0;
  let subindo = true;
  let col = n - 1;
  while (col > 0) {
    if (col === 6) col = 5; // pula a coluna de sincronismo
    for (let passo = 0; passo < n; passo++) {
      const linha = subindo ? n - 1 - passo : passo;
      for (const cc of [col, col - 1]) {
        if (reservado[linha][cc]) continue;
        escuro[linha][cc] = bit < totalBits ? ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1 : false;
        bit++;
      }
    }
    col -= 2;
    subindo = !subindo;
  }

  // aplica as 8 máscaras e fica com a de menor penalidade
  let melhor: Matriz = escuro;
  let melhorPontos = Number.POSITIVE_INFINITY;
  for (let m = 0; m < 8; m++) {
    const copia: Matriz = escuro.map((linha) => [...linha]);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) if (!reservado[i][j] && COND[m](i, j)) copia[i][j] = !copia[i][j];

    const fmt = infoFormato(nivel, m);
    for (let k = 0; k < 15; k++) {
      const v = ((fmt >> (14 - k)) & 1) === 1;
      const [p1, p2] = [fA[k], fB[k]];
      copia[p1[0]][p1[1]] = v;
      copia[p2[0]][p2[1]] = v;
    }
    const p = penalti(copia);
    if (p < melhorPontos) {
      melhorPontos = p;
      melhor = copia;
    }
  }
  return melhor;
}

/** matriz de 0/1 (útil em testes e para exportar) */
export const qrBits = (texto: string, nivel: Nivel = "M"): number[][] =>
  qrMatriz(texto, nivel).map((l) => l.map((b) => (b ? 1 : 0)));
