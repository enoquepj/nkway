"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Campo, Card, CardTitulo, Input, Modal, PageHeader, Vazio, useToast } from "@/components/ui";
import { dataHoraBR, moeda, round2 } from "@/lib/dominio";
import { homologarQuebraCaixa } from "@/server/acoes/caixa";

export type LinhaAuditoriaCaixaView = {
  sessaoId: string;
  numero: number;
  terminal: string;
  operadorNome: string;
  status: string;
  statusAprovacao: string | null;
  abertoEm: string;
  fechadoEm: string;
  valoresEsperados: Record<string, number>;
  valoresInformados: Record<string, number>;
  diferencas: Record<string, number>;
  totalEsperado: number;
  totalInformado: number;
  diferencaTotal: number;
  justificativaFechamento: string;
  quebras: {
    id: string;
    valorDiferenca: number;
    tipo: string;
    justificativa: string;
    homologadoPorUsuarioId: string | null;
    homologadoEm: string | null;
  }[];
};

function situacao(l: LinhaAuditoriaCaixaView): { rotulo: string; tom: "ok" | "alerta" | "erro" } {
  const pendente = l.quebras.some((q) => !q.homologadoPorUsuarioId) || l.statusAprovacao === "pendente";
  if (pendente) return { rotulo: "Pendente", tom: "alerta" };
  if (l.quebras.length > 0) return { rotulo: "Com Quebra", tom: "erro" };
  return { rotulo: "OK", tom: "ok" };
}

export function AuditoriaCaixaView({
  linhas,
  podeHomologar,
}: {
  linhas: LinhaAuditoriaCaixaView[];
  podeHomologar: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [quebraSel, setQuebraSel] = useState<{ id: string; rotulo: string } | null>(null);
  const [senha, setSenha] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [detalhe, setDetalhe] = useState<string | null>(null);

  async function homologar() {
    if (!quebraSel || ocupado) return;
    setOcupado(true);
    try {
      const r = await homologarQuebraCaixa({ quebraId: quebraSel.id, senha });
      if (!r.ok) {
        toast(r.erro, "erro");
        return;
      }
      toast(r.aviso ?? "Quebra homologada.", "ok");
      setQuebraSel(null);
      setSenha("");
      router.refresh();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Auditoria de caixa"
        subtitulo="Cruzamento entre o valor esperado pelo sistema e o valor declarado pelo operador"
        etiquetas={
          <>
            <Badge tom="info">Acesso gerencial</Badge>
            <Badge tom="neutro">{linhas.length} turno(s) encerrado(s)</Badge>
          </>
        }
      />

      {linhas.length === 0 ? (
        <Vazio>Nenhum turno encerrado até agora. Os fechamentos aparecem aqui assim que o operador encerrar o caixa no PDV.</Vazio>
      ) : (
        <Card padding={false}>
          <CardTitulo
            titulo="Turnos encerrados"
            descricao="Esperado × Declarado por forma de pagamento, com homologação de quebras"
            icone="carteira"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="bg-ink-50 text-[11px] uppercase text-ink-400">
                <tr>
                  <th className="px-3.5 py-2.5">Turno</th>
                  <th className="px-3.5 py-2.5">Operador</th>
                  <th className="px-3.5 py-2.5">Fechado em</th>
                  <th className="px-3.5 py-2.5">Situação</th>
                  <th className="px-3.5 py-2.5 text-right">Esperado</th>
                  <th className="px-3.5 py-2.5 text-right">Declarado</th>
                  <th className="px-3.5 py-2.5 text-right">Diferença</th>
                  <th className="px-3.5 py-2.5">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {linhas.map((l) => {
                  const s = situacao(l);
                  const pendentes = l.quebras.filter((q) => !q.homologadoPorUsuarioId);
                  return (
                    <tr key={l.sessaoId} className="hover:bg-ink-50/50">
                      <td className="px-3.5 py-2.5 font-semibold text-ink-800">
                        #{l.numero} · {l.terminal}
                        <button
                          type="button"
                          onClick={() => setDetalhe(detalhe === l.sessaoId ? null : l.sessaoId)}
                          className="ml-2 text-[11px] font-semibold text-way-700 hover:underline"
                        >
                          {detalhe === l.sessaoId ? "Ocultar" : "Detalhar"}
                        </button>
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-600">{l.operadorNome}</td>
                      <td className="px-3.5 py-2.5 text-ink-500">{l.fechadoEm ? dataHoraBR(l.fechadoEm) : "—"}</td>
                      <td className="px-3.5 py-2.5"><Badge tom={s.tom}>{s.rotulo}</Badge></td>
                      <td className="tabular px-3.5 py-2.5 text-right">{moeda(l.totalEsperado)}</td>
                      <td className="tabular px-3.5 py-2.5 text-right">{moeda(l.totalInformado)}</td>
                      <td className="tabular px-3.5 py-2.5 text-right font-semibold">
                        {moeda(round2(l.diferencaTotal))}
                      </td>
                      <td className="px-3.5 py-2.5">
                        {podeHomologar && pendentes.length > 0 ? (
                          <Button
                            tamanho="sm"
                            variante="suave"
                            onClick={() =>
                              setQuebraSel({
                                id: pendentes[0].id,
                                rotulo: `${pendentes[0].tipo} de ${moeda(pendentes[0].valorDiferenca)} no Caixa #${l.numero}`,
                              })
                            }
                          >
                            Homologar
                          </Button>
                        ) : (
                          <span className="text-[11px] text-ink-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detalhe && (
            <div className="border-t border-ink-100 bg-ink-50/40 p-4">
              {linhas
                .filter((l) => l.sessaoId === detalhe)
                .map((l) => (
                  <div key={l.sessaoId} className="space-y-2 text-[12px] text-ink-600">
                    <p className="font-semibold text-ink-800">Conferência por forma · Caixa #{l.numero}</p>
                    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.keys(l.valoresEsperados).map((forma) => (
                        <p key={forma} className="rounded-md bg-white px-2.5 py-1.5 ring-1 ring-inset ring-ink-100">
                          <span className="font-semibold capitalize">{forma}</span>: esperado {moeda(l.valoresEsperados[forma])} ·
                          declarado {moeda(l.valoresInformados[forma] ?? 0)} · diferença {moeda(l.diferencas[forma] ?? 0)}
                        </p>
                      ))}
                    </div>
                    {l.justificativaFechamento && (
                      <p className="rounded-md bg-white px-2.5 py-1.5 ring-1 ring-inset ring-ink-100">
                        <span className="font-semibold">Justificativa:</span> {l.justificativaFechamento}
                      </p>
                    )}
                    {l.quebras.map((q) => (
                      <p key={q.id} className="rounded-md bg-white px-2.5 py-1.5 ring-1 ring-inset ring-ink-100">
                        <span className="font-semibold">{q.tipo} {moeda(q.valorDiferenca)}</span> ·{" "}
                        {q.homologadoPorUsuarioId ? "homologada" : "aguardando homologação"} · {q.justificativa || "sem justificativa"}
                      </p>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      <Modal
        aberto={Boolean(quebraSel)}
        aoFechar={() => {
          if (ocupado) return;
          setQuebraSel(null);
          setSenha("");
        }}
        titulo="Homologar quebra de caixa"
        descricao={quebraSel?.rotulo}
        largura="max-w-md"
        rodape={
          <>
            <Button variante="secundario" onClick={() => setQuebraSel(null)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button icone="check" onClick={() => void homologar()} disabled={ocupado || !senha}>
              {ocupado ? "Processando…" : "Confirmar homologação"}
            </Button>
          </>
        }
      >
        <Campo rotulo="PIN / senha do gerente" obrigatorio dica="Conferida no servidor; nunca exibida ou gravada em log.">
          <Input
            type="password"
            autoComplete="off"
            placeholder="••••••"
            valor={senha}
            aoMudar={setSenha}
          />
        </Campo>
      </Modal>
    </div>
  );
}
