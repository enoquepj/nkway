"use client";

import { useState } from "react";
import { Area, Badge, Button, Campo, Input, Modal, useToast } from "@/components/ui";
import { FORMAS_PAGAMENTO } from "@/lib/dominio";
import { fecharTurnoCego } from "@/server/acoes/caixa";

/**
 * NKWAY — Fechamento às cegas (blind balance) direto na tela de vendas do PDV.
 *
 * Regras:
 * - Todos os inputs começam VAZIOS; nenhum valor esperado é recebido ou exibido.
 * - Os esperados são recalculados pela Server Action `fecharTurnoCego`.
 * - Se o servidor detectar quebra, ele responde `requerHomologacao: true` e só então
 *   o modal revela Justificativa + PIN/senha de um usuário com `caixa.homologar`.
 * - Boleto/prazo aparecem como formas não físicas (conta a receber), nunca como dinheiro.
 */
export function ModalFechamentoCego({
  aberto,
  aoFechar,
  sessao,
  aoConcluir,
}: {
  aberto: boolean;
  aoFechar: () => void;
  sessao: { id: string; numero: number; terminal: string } | null;
  aoConcluir?: () => void;
}) {
  const toast = useToast();
  const [valores, setValores] = useState<Record<string, string>>({});
  const [justificativa, setJustificativa] = useState("");
  const [gerenteEmail, setGerenteEmail] = useState("");
  const [gerenteSenha, setGerenteSenha] = useState("");
  const [requerHomologacao, setRequerHomologacao] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  function limpar() {
    setValores({});
    setJustificativa("");
    setGerenteEmail("");
    setGerenteSenha("");
    setRequerHomologacao(false);
  }

  function fechar() {
    if (ocupado) return;
    limpar();
    aoFechar();
  }

  async function confirmar() {
    if (!sessao || ocupado) return;
    setOcupado(true);
    try {
      const r = await fecharTurnoCego({
        sessaoId: sessao.id,
        valoresInformados: valores,
        justificativa,
        gerenteEmail,
        gerenteSenha,
      });
      if (!r.ok) {
        if (r.requerHomologacao) setRequerHomologacao(true);
        toast(r.erro, "erro");
        return;
      }
      toast(r.aviso ?? "Turno encerrado com sucesso.", "ok");
      limpar();
      aoFechar();
      aoConcluir?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Falha ao encerrar o turno.", "erro");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      aberto={aberto && Boolean(sessao)}
      aoFechar={fechar}
      titulo={sessao ? `Encerrar turno · Caixa #${sessao.numero} (${sessao.terminal})` : "Encerrar turno"}
      descricao="Conte o dinheiro físico e preencha apenas o que você tem em mãos."
      largura="max-w-2xl"
      rodape={
        <>
          <Button variante="secundario" onClick={fechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button icone="check" onClick={() => void confirmar()} disabled={ocupado || !sessao}>
            {ocupado ? "Processando…" : "Confirmar encerramento"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-sky-100 bg-sky-50/70 p-3 text-[12px] leading-snug text-sky-900">
          <span className="font-semibold">Fechamento às cegas:</span> os campos abaixo começam vazios.
          O sistema calcula o esperado no servidor e não mostra valores antes da confirmação.
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {FORMAS_PAGAMENTO.map((fp) => (
            <Campo
              key={fp.id}
              rotulo={`${fp.label}${fp.id === "boleto" || fp.id === "prazo" ? " (não físico)" : ""}`}
              dica={fp.id === "boleto" || fp.id === "prazo" ? "Conta a receber — não é dinheiro em gaveta" : undefined}
            >
              <Input
                dinheiro
                inputMode="decimal"
                placeholder="0,00"
                valor={valores[fp.id] ?? ""}
                aoMudar={(v) => setValores((atual) => ({ ...atual, [fp.id]: v }))}
              />
            </Campo>
          ))}
        </div>

        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-400">
          <Badge tom="info">Fundo de troco</Badge>
          R$ 100,00 ficam provisionados na gaveta para o próximo turno; o restante em dinheiro é
          recolhido automaticamente para o cofre.
        </p>

        {requerHomologacao && (
          <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
            <p className="text-[12px] font-semibold text-amber-900">
              Foi identificada uma quebra de caixa. Preencha a justificativa e solicite a
              homologação de um gerente presente para concluir o encerramento.
            </p>
            <Area
              rotulo="Justificativa (mín. 10 caracteres)"
              valor={justificativa}
              aoMudar={setJustificativa}
              linhas={2}
              placeholder="Descreva o motivo da sobra ou falta..."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="E-mail do gerente" obrigatorio>
                <Input
                  type="email"
                  placeholder="gerente@empresa.com.br"
                  valor={gerenteEmail}
                  aoMudar={setGerenteEmail}
                />
              </Campo>
              <Campo rotulo="PIN / senha do gerente" obrigatorio dica="Verificado no servidor; nunca é exibido ou gravado em log.">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder="••••••"
                  valor={gerenteSenha}
                  aoMudar={setGerenteSenha}
                />
              </Campo>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
