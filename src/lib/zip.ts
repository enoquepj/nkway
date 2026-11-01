/**
 * NKWAY — Gerador e inspetor PKZIP nativo em Node.js (Fase 3).
 * Usa exclusivamente `node:zlib` (deflateRawSync / inflateRawSync) e CRC-32 IEEE 802.3,
 * sem adicionar dependências externas ao package.json.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type ArquivoZipEntrada = {
  nome: string;
  conteudo: string | Buffer;
};

const TABELA_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

export function calcularCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = TABELA_CRC32[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dataHoraDos(d: Date): { hora: number; data: number } {
  const ano = Math.max(1980, d.getFullYear());
  const mes = d.getMonth() + 1;
  const dia = d.getDate();
  const h = d.getHours();
  const m = d.getMinutes();
  const s = Math.floor(d.getSeconds() / 2);
  return {
    hora: ((h & 0x1f) << 11) | ((m & 0x3f) << 5) | (s & 0x1f),
    data: (((ano - 1980) & 0x7f) << 9) | ((mes & 0x0f) << 5) | (dia & 0x1f),
  };
}

function sanitizarNomeArquivoZip(nome: string): string {
  return (
    String(nome || "documento.xml")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/^\.+/, "")
      .trim() || "documento.xml"
  );
}

/** Gera um Buffer `.zip` padrão compatível com Windows, macOS, Linux unzip e 7-Zip */
export function gerarZipBuffer(arquivos: ArquivoZipEntrada[], agora = new Date()): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  const { hora, data } = dataHoraDos(agora);
  let offsetAtual = 0;

  const nomesUsados = new Set<string>();

  for (const item of arquivos) {
    let nomeLimpo = sanitizarNomeArquivoZip(item.nome);
    if (nomesUsados.has(nomeLimpo)) {
      const idxPonto = nomeLimpo.lastIndexOf(".");
      const base = idxPonto > 0 ? nomeLimpo.slice(0, idxPonto) : nomeLimpo;
      const ext = idxPonto > 0 ? nomeLimpo.slice(idxPonto) : "";
      let sufixo = 2;
      while (nomesUsados.has(`${base}-${sufixo}${ext}`)) sufixo++;
      nomeLimpo = `${base}-${sufixo}${ext}`;
    }
    nomesUsados.add(nomeLimpo);

    const nomeBuf = Buffer.from(nomeLimpo, "utf8");
    const bruto = Buffer.isBuffer(item.conteudo) ? item.conteudo : Buffer.from(item.conteudo, "utf8");
    const crc = calcularCrc32(bruto);
    const comprimido = deflateRawSync(bruto, { level: 6 });

    // Local File Header (30 bytes + nome)
    const cabecalhoLocal = Buffer.alloc(30);
    cabecalhoLocal.writeUInt32LE(0x04034b50, 0); // assinatura PK\x03\x04
    cabecalhoLocal.writeUInt16LE(20, 4); // versão 2.0
    cabecalhoLocal.writeUInt16LE(0x0800, 6); // bit 11 = nome UTF-8
    cabecalhoLocal.writeUInt16LE(8, 8); // método 8 = Deflate
    cabecalhoLocal.writeUInt16LE(hora, 10);
    cabecalhoLocal.writeUInt16LE(data, 12);
    cabecalhoLocal.writeUInt32LE(crc, 14);
    cabecalhoLocal.writeUInt32LE(comprimido.length, 18);
    cabecalhoLocal.writeUInt32LE(bruto.length, 22);
    cabecalhoLocal.writeUInt16LE(nomeBuf.length, 26);
    cabecalhoLocal.writeUInt16LE(0, 28); // extra length

    locais.push(cabecalhoLocal, nomeBuf, comprimido);

    // Central Directory File Header (46 bytes + nome)
    const cabecalhoCentral = Buffer.alloc(46);
    cabecalhoCentral.writeUInt32LE(0x02014b50, 0); // assinatura PK\x01\x02
    cabecalhoCentral.writeUInt16LE(20, 4); // versão criadora
    cabecalhoCentral.writeUInt16LE(20, 6); // versão necessária
    cabecalhoCentral.writeUInt16LE(0x0800, 8); // UTF-8
    cabecalhoCentral.writeUInt16LE(8, 10); // Deflate
    cabecalhoCentral.writeUInt16LE(hora, 12);
    cabecalhoCentral.writeUInt16LE(data, 14);
    cabecalhoCentral.writeUInt32LE(crc, 16);
    cabecalhoCentral.writeUInt32LE(comprimido.length, 20);
    cabecalhoCentral.writeUInt32LE(bruto.length, 24);
    cabecalhoCentral.writeUInt16LE(nomeBuf.length, 28);
    cabecalhoCentral.writeUInt16LE(0, 30); // extra
    cabecalhoCentral.writeUInt16LE(0, 32); // comentário
    cabecalhoCentral.writeUInt16LE(0, 34); // disco
    cabecalhoCentral.writeUInt16LE(0, 36); // atributos internos
    cabecalhoCentral.writeUInt32LE(0, 38); // atributos externos
    cabecalhoCentral.writeUInt32LE(offsetAtual, 42); // offset local header

    centrais.push(cabecalhoCentral, nomeBuf);
    offsetAtual += cabecalhoLocal.length + nomeBuf.length + comprimido.length;
  }

  const blocoCentral = Buffer.concat(centrais);
  const fimCentral = Buffer.alloc(22);
  fimCentral.writeUInt32LE(0x06054b50, 0); // assinatura PK\x05\x06
  fimCentral.writeUInt16LE(0, 4);
  fimCentral.writeUInt16LE(0, 6);
  fimCentral.writeUInt16LE(arquivos.length, 8);
  fimCentral.writeUInt16LE(arquivos.length, 10);
  fimCentral.writeUInt32LE(blocoCentral.length, 12);
  fimCentral.writeUInt32LE(offsetAtual, 16);
  fimCentral.writeUInt16LE(0, 20);

  return Buffer.concat([...locais, blocoCentral, fimCentral]);
}

/** Lê e valida as entradas de um Buffer `.zip` gerado (usado nos testes automatizados) */
export function extrairEntradasZip(zipBuf: Buffer): { nome: string; texto: string; crcOk: boolean }[] {
  const saida: { nome: string; texto: string; crcOk: boolean }[] = [];
  let pos = 0;
  while (pos + 30 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(pos);
    if (sig !== 0x04034b50) break;
    const metodo = zipBuf.readUInt16LE(pos + 8);
    const crcEsperado = zipBuf.readUInt32LE(pos + 14);
    const tamComp = zipBuf.readUInt32LE(pos + 18);
    const tamNome = zipBuf.readUInt16LE(pos + 26);
    const tamExtra = zipBuf.readUInt16LE(pos + 28);
    const iniNome = pos + 30;
    const nome = zipBuf.subarray(iniNome, iniNome + tamNome).toString("utf8");
    const iniDados = iniNome + tamNome + tamExtra;
    const fatia = zipBuf.subarray(iniDados, iniDados + tamComp);
    const descomprimido = metodo === 8 ? inflateRawSync(fatia) : fatia;
    const crcCalc = calcularCrc32(descomprimido);
    saida.push({
      nome,
      texto: descomprimido.toString("utf8"),
      crcOk: crcCalc === crcEsperado,
    });
    pos = iniDados + tamComp;
  }
  return saida;
}
