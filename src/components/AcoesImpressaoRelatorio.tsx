"use client";

import { Icon } from "@/components/ui";

export function AcoesImpressaoRelatorio() {
  return (
    <div className="relatorio-pdv-acoes no-print">
      <div><strong>Prévia de impressão</strong><span>Confira os filtros e imprima ou salve em PDF.</span></div>
      <div className="relatorio-pdv-acoes-botoes">
        <a className="relatorio-pdv-voltar" href="/dashboard/relatorios/pdv">Voltar aos relatórios</a>
        <button type="button" className="relatorio-pdv-imprimir" onClick={() => window.print()}><Icon name="imprimir" className="size-4" /> Imprimir / Salvar PDF</button>
      </div>
    </div>
  );
}
