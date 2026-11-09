"use client";

import { useState, type FormEvent } from "react";
import { Badge, Card, CardTitulo, cn } from "@/components/ui";
import {
  compararCommitDeploy,
  normalizarCommitDeploy,
  ROTULO_AMBIENTE_DEPLOY,
  versaoDeployValida,
  type VersaoDeploy,
} from "@/lib/versaoDeploy";

type Conferencia = { tom: "ok" | "alerta" | "erro"; mensagem: string };

export function IdentificacaoDeploy({ versao }: { versao: VersaoDeploy }) {
  const [ultimaLeitura, setUltimaLeitura] = useState<VersaoDeploy | null>(null);
  const [esperado, setEsperado] = useState("");
  const [conferindo, setConferindo] = useState(false);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const publicacao = ultimaLeitura ?? versao;

  async function conferir(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conferindo) return;
    const commitEsperado = normalizarCommitDeploy(esperado);
    if (!commitEsperado) {
      setConferencia({ tom: "erro", mensagem: "Informe o SHA completo do commit: 40 caracteres hexadecimais." });
      return;
    }

    setConferindo(true);
    setConferencia(null);
    try {
      // Primeiro diagnóstico continua sendo o health. Ambas as leituras são locais à publicação atual.
      const health = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const saude: unknown = await health.json().catch(() => null);
      const healthOk = health.ok && !!saude && typeof saude === "object" && "ok" in saude && saude.ok === true;
      const resposta = await fetch("/api/versao", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const recebida: unknown = await resposta.json();
      if (!resposta.ok || !versaoDeployValida(recebida)) throw new Error("Identificação indisponível");
      setUltimaLeitura(recebida);

      // Recusa também respostas de publicações diferentes durante uma troca de deploy.
      const mesmaPublicacao = health.headers.get("X-NKWAY-Commit") === (recebida.commit ?? "nao-identificado") &&
        health.headers.get("X-NKWAY-Ambiente") === recebida.ambiente;
      if (!mesmaPublicacao) {
        setConferencia({
          tom: "alerta",
          mensagem: "O health e a identificação não confirmaram a mesma publicação. Aguarde a conclusão do deploy e confira novamente.",
        });
        return;
      }

      const resultado = compararCommitDeploy(recebida, commitEsperado);
      const mensagens = {
        confere: "O commit em execução confere com o esperado.",
        diverge: "O commit em execução é diferente do esperado. Esta entrega não está confirmada nesta publicação.",
        nao_identificado: "Este ambiente não informou um commit válido. Não é possível confirmar a publicação.",
        invalido: "Informe o SHA completo do commit esperado.",
      };
      const ambiente = recebida.ambiente === "production"
        ? "Ambiente informado: produção."
        : "Esta leitura não comprova publicação em produção.";
      setConferencia({
        tom: resultado === "confere" && healthOk ? "ok" : resultado === "diverge" || !healthOk ? "erro" : "alerta",
        mensagem: `${mensagens[resultado]} ${healthOk ? "Health disponível." : "Health falhou; a conectividade não está confirmada."} ${ambiente}`,
      });
    } catch {
      setConferencia({
        tom: "erro",
        mensagem: "Não foi possível concluir a conferência. A identificação exibida é a última leitura, não uma confirmação nova. Tente novamente.",
      });
    } finally {
      setConferindo(false);
    }
  }

  return (
    <Card className="anim-in">
      <CardTitulo
        titulo="Versão em execução"
        descricao="Identifique o código desta publicação antes de validar a entrega"
        icone="documento"
        acao={<Badge tom={publicacao.identificado ? "info" : "alerta"}>{publicacao.identificado ? "Commit identificado" : "Commit não identificado"}</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tom="neutro">{ROTULO_AMBIENTE_DEPLOY[publicacao.ambiente]}</Badge>
            <span className="text-[11px] text-ink-400">
              {publicacao.origem === "vercel" ? "Metadados públicos da Vercel" : "Sem metadados de publicação"}
            </span>
          </div>
          <p className="text-[11px] font-semibold text-ink-500">Commit em execução</p>
          <code className="mt-1 block select-all break-all rounded-md border border-ink-100 bg-ink-50 px-3 py-2 font-mono text-[12px] text-ink-700">
            {publicacao.commit ?? "Não identificado neste ambiente"}
          </code>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-500">
            Sem metadados válidos, o sistema não deduz a versão pelo Git local ou pelo health.
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] font-semibold text-way-700">
            <a href="/api/health" target="_blank" rel="noreferrer" className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-way-600">Abrir health ↗</a>
            <a href="/api/versao" target="_blank" rel="noreferrer" className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-way-600">Abrir identificação ↗</a>
          </div>
        </div>
        <form onSubmit={conferir} className="min-w-0">
          <label htmlFor="deploy-commit-esperado" className="block text-[12px] font-semibold text-ink-700">
            Commit esperado (SHA completo)
          </label>
          <p id="deploy-commit-ajuda" className="mb-2 mt-1 text-[11.5px] leading-snug text-ink-500">
            Cole os 40 caracteres do commit que deseja conferir no GitHub ou no deploy da Vercel.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="deploy-commit-esperado"
              name="commitEsperado"
              type="text"
              value={esperado}
              onChange={(event) => { setEsperado(event.target.value.trim()); setConferencia(null); }}
              required
              minLength={40}
              maxLength={40}
              pattern="[a-fA-F0-9]{40}"
              autoComplete="off"
              spellCheck={false}
              readOnly={conferindo}
              aria-describedby="deploy-commit-ajuda"
              placeholder="SHA completo do commit"
              className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-3 py-2 font-mono text-[12px] text-ink-800 outline-none transition placeholder:text-ink-400 focus:border-way-500 focus:ring-2 focus:ring-way-100"
            />
            <button
              type="submit"
              disabled={conferindo}
              aria-busy={conferindo}
              className="shrink-0 rounded-md bg-way-600 px-3 py-2 text-[12px] font-semibold text-white transition hover:bg-way-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-way-600 disabled:cursor-wait disabled:opacity-60"
            >
              {conferindo ? "Conferindo…" : "Conferir publicação"}
            </button>
          </div>
          <div role="status" aria-live="polite" aria-atomic="true" className="mt-2">
            {conferindo && <p className="text-[11.5px] text-ink-500">Consultando o health e a versão, sem cache…</p>}
            {conferencia && (
              <p className={cn(
                "rounded-md border px-3 py-2 text-[11.5px] leading-relaxed",
                conferencia.tom === "ok" ? "border-way-100 bg-way-50 text-way-800" :
                  conferencia.tom === "erro" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800",
              )}>{conferencia.mensagem}</p>
            )}
          </div>
        </form>
      </div>
      <p className="mt-4 border-t border-ink-100 pt-3 text-[11.5px] leading-snug text-ink-500">
        <strong className="font-semibold text-ink-700">Identificação não é homologação.</strong>{" "}
        Esta conferência não valida migrações, permissões, rotas autenticadas ou cálculos fiscais.
        Nenhum segredo é exibido e nenhuma configuração é alterada.
      </p>
    </Card>
  );
}
