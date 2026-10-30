"use client";

import { qrMatriz, type Nivel } from "@/lib/qrcode";

/** QR Code desenhado como SVG puro (sem biblioteca) */
export function QrCode({
  valor,
  tamanho = 132,
  nivel = "M",
  className,
}: {
  valor: string;
  tamanho?: number;
  nivel?: Nivel;
  className?: string;
}) {
  let modulos: boolean[][] = [];
  try {
    try {
      modulos = qrMatriz(valor, nivel);
    } catch {
      // conteúdo longo para o nível pedido: sobe a correção para L (mais capacidade)
      modulos = qrMatriz(valor, "L");
    }
  } catch {
    return (
      <div
        className={className}
        style={{ width: tamanho, height: tamanho }}
        title={valor}
      >
        <div className="grid size-full place-items-center rounded bg-ink-100 px-1 text-center text-[7px] font-semibold leading-tight text-ink-400">
          conteúdo longo demais para o QR
        </div>
      </div>
    );
  }
  const n = modulos.length;
  const caixa = 1;
  const borda = 2;
  const lado = (n + borda * 2) * caixa;
  return (
    <svg
      viewBox={`0 0 ${lado} ${lado}`}
      width={tamanho}
      height={tamanho}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR Code: ${valor.slice(0, 40)}`}
      className={className}
    >
      <rect width={lado} height={lado} fill="#fff" />
      {modulos.map((linha, i) =>
        linha.map((escuro, j) =>
          escuro ? (
            <rect key={`${i}-${j}`} x={(j + borda) * caixa} y={(i + borda) * caixa} width={caixa} height={caixa} fill="#111827" />
          ) : null,
        ),
      )}
    </svg>
  );
}
