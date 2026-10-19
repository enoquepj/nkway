/**
 * Renderiza um código de barras EAN-13 real em SVG (padrão GS1).
 * Lida com "SEM GTIN" (isentos) exibindo aviso.
 */

const L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const PARIDADE = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

function encodeEan13(c: string): string {
  const d = c.padEnd(13, "0").slice(0, 13);
  const par = PARIDADE[Number(d[0])];
  let out = "101";
  for (let i = 1; i <= 6; i++) {
    const n = Number(d[i]);
    out += par[i - 1] === "L" ? L[n] : G[n];
  }
  out += "01010";
  for (let i = 7; i <= 12; i++) out += R[Number(d[i])];
  return out + "101";
}

export default function Barcode({
  valor,
  altura = 44,
  mostrarTexto = true,
}: {
  valor: string;
  altura?: number;
  mostrarTexto?: boolean;
}) {
  if (!valor || valor === "SEM GTIN")
    return (
      <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-400">
        SEM GTIN (isento)
      </span>
    );

  if (!/^\d{13}$/.test(valor))
    return (
      <span className="rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
        GTIN inválido
      </span>
    );

  const bits = encodeEan13(valor);
  const modulo = 2;
  const quiet = 8;
  const largura = (bits.length + quiet * 2) * modulo;

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura + (mostrarTexto ? 14 : 0)}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Código de barras ${valor}`}
    >
      <rect width={largura} height="100%" fill="white" />
      {bits.split("").map((b, i) =>
        b === "1" ? (
          <rect
            key={i}
            x={(i + quiet) * modulo}
            y={0}
            width={modulo}
            height={altura}
            fill="#0f172a"
          />
        ) : null,
      )}
      {mostrarTexto && (
        <text
          x={largura / 2}
          y={altura + 11}
          textAnchor="middle"
          fontSize="11"
          fontFamily="monospace"
          fill="#0f172a"
        >
          {valor}
        </text>
      )}
    </svg>
  );
}
