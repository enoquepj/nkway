"use client";

import Link from "next/link";
import { IdentificacaoDeploy } from "@/components/IdentificacaoDeploy";
import type { VersaoDeploy } from "@/lib/versaoDeploy";
import { Badge, Card, CardTitulo, Icon, Kpi, PageHeader, cn } from "@/components/ui";
import { dataHoraBR } from "@/lib/dominio";
import {
  ROTULO_STATUS_PRONTIDAO,
  TOM_STATUS_PRONTIDAO,
  type BlocoProntidao,
  type ProntidaoDto,
} from "@/lib/prontidao";

function Bloco({ bloco }: { bloco: BlocoProntidao }) {
  const prontos = bloco.itens.filter((i) => i.status === "pronto").length;
  const pendentes = bloco.itens.filter((i) => i.status === "pendente").length;
  return (
    <Card className="anim-in flex flex-col">
      <CardTitulo
        titulo={bloco.titulo}
        descricao={bloco.descricao}
        icone={bloco.icone}
        acao={
          <Link
            href={bloco.rota}
            className="rounded-md px-2 py-1 text-[11.5px] font-semibold text-way-700 ring-1 ring-inset ring-way-100 transition hover:bg-way-50"
          >
            Abrir tela →
          </Link>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Badge tom="ok">{prontos} pronto(s)</Badge>
        {pendentes > 0 && <Badge tom="alerta">{pendentes} pendente(s)</Badge>}
        <Badge tom={bloco.id === "base" ? "info" : "neutro"}>{bloco.itens.length} verificação(ões)</Badge>
      </div>
      <ul className="flex-1 divide-y divide-ink-100 border-t border-ink-100">
        {bloco.itens.map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 py-2.5">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                item.status === "pronto"
                  ? "bg-way-50 text-way-700 ring-1 ring-inset ring-way-100"
                  : item.status === "pendente"
                    ? "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-100"
                    : "bg-ink-50 text-ink-400 ring-1 ring-inset ring-ink-100",
              )}
            >
              {item.status === "pronto" ? "✓" : item.status === "pendente" ? "!" : "·"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-ink-800">
                {item.titulo}
                <Badge tom={TOM_STATUS_PRONTIDAO[item.status]}>{ROTULO_STATUS_PRONTIDAO[item.status]}</Badge>
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{item.descricao}</p>
              {item.observacao && <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{item.observacao}</p>}
              {item.variavel && (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-ink-400">
                  <Icon name="cadeado" className="size-3" />
                  Variável de ambiente: <span className="font-mono font-semibold text-ink-600">{item.variavel}</span>
                  <span>(nome apenas)</span>
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ProntidaoView({ dados, versao }: { dados: ProntidaoDto; versao: VersaoDeploy }) {
  const { resumo, contagens } = dados;
  const barraTom = resumo.percentual >= 80 ? "bg-way-500" : resumo.percentual >= 50 ? "bg-signal-500" : "bg-rose-500";

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Central de prontidão"
        subtitulo="Um só lugar para ver o que está pronto e o que falta para operar fiscal e comercialmente"
        etiquetas={
          <>
            <Badge tom="info">Somente leitura</Badge>
            <Badge tom={dados.bancoConectado ? "ok" : "erro"}>
              Banco {dados.bancoConectado ? "conectado" : "indisponível"}
            </Badge>
            <Badge tom="neutro">Sem valores de segredos</Badge>
          </>
        }
      />

      <IdentificacaoDeploy versao={versao} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          rotulo="Verificações prontas"
          valor={String(resumo.prontos)}
          detalhe={`de ${resumo.total} verificação(ões)`}
          tom="ok"
          icone="atualizar"
          barra={resumo.percentual}
        />
        <Kpi
          rotulo="Pendências operacionais"
          valor={String(resumo.pendentes)}
          detalhe="Configuração de chaves externas / cadastro"
          tom={resumo.pendentes > 0 ? "alerta" : "ok"}
          icone="raio"
        />
        <Kpi
          rotulo="Itens opcionais"
          valor={String(resumo.opcionais)}
          detalhe="Não bloqueiam a operação em homologação"
          tom="neutro"
          icone="documento"
        />
        <Kpi
          rotulo="Tabelas nk_* no banco"
          valor={String(contagens.tabelasNk)}
          detalhe={`${contagens.tabelasLegadas} tabela(s) legada(s) preservada(s)`}
          tom="info"
          icone="caixaEstoque"
        />
      </div>

      <Card className="anim-in">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-ink-800">Resumo da empresa: {dados.empresaNome}</h2>
            <p className="mt-0.5 text-[11.5px] text-ink-400">
              {resumo.percentual}% das verificações obrigatórias concluídas · {contagens.documentos} documento(s) de venda ·{" "}
              {contagens.entradas} entrada(s) · {contagens.assinaturas} assinatura(s).
            </p>
          </div>
          <Badge tom={resumo.percentual >= 80 ? "ok" : "alerta"}>{resumo.percentual}% pronto</Badge>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={resumo.percentual} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full transition-all", barraTom)} style={{ width: `${resumo.percentual}%` }} />
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-500">
          As pendências exibidas são de configuração externa ou de cadastro, não de código: os módulos DF-e, Assinatura com
          gateway, Emissor fiscal e Migração do legado já estão implementados. O health oficial continua em{" "}
          <span className="font-mono font-semibold text-ink-700">/api/health</span>; não é necessário refazer Vercel ou Supabase.
        </p>
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        {dados.blocos.map((bloco) => (
          <Bloco key={bloco.id} bloco={bloco} />
        ))}
      </div>

      <Card className="anim-in">
        <CardTitulo
          titulo="Como ler esta tela"
          descricao="Segurança e ordem de trabalho"
          icone="engrenagem"
        />
        <ul className="space-y-1.5 text-[12px] leading-snug text-ink-600">
          <li>• <strong>Pronto</strong>: implementado e/ou configurado. <strong>Pendente</strong>: falta cadastro ou chave externa. <strong>Opcional</strong>: só entra quando a operação live for iniciada.</li>
          <li>• Nenhum valor de variável secreta, URL de conexão, token, senha ou certificado é exibido nem enviado ao navegador. A versão mostra somente SHA e ambiente públicos da publicação.</li>
          <li>• A migração do legado continua somente leitura nas tabelas antigas, com simulação Dry-Run antes de gravar em <span className="font-mono">nk_*</span>.</li>
          <li>• Para migrar dados antigos use a tela <Link href="/migracao" className="font-semibold text-way-700 hover:underline">Migração legado</Link>; para o certificado A1 use <Link href="/dfe" className="font-semibold text-way-700 hover:underline">DF-e</Link>.</li>
        </ul>
        <p className="mt-3 text-[11px] text-ink-400">
          Verificado em {dataHoraBR(dados.geradoEm)} · empresa legada {dados.legado.empresaEncontrada ? "localizada" : "não localizada neste banco"} ·
          {dados.legado.ultimaMigracaoEm ? ` última migração em ${dataHoraBR(dados.legado.ultimaMigracaoEm)}.` : " sem importação registrada."}
        </p>
      </Card>
    </div>
  );
}
