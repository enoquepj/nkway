"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Abas,
  Area,
  Badge,
  Button,
  Card,
  CardTitulo,
  Icon,
  Kpi,
  Modal,
  PageHeader,
  Vazio,
  cn,
  useToast,
} from "@/components/ui";
import { dataHoraBR } from "@/lib/dominio";
import {
  MODULOS_MIGRACAO,
  gerarSqlPermissaoLeituraLegado,
  type InspecaoBancoLegadoDto,
  type ModuloMigracaoId,
  type PlanoMigracaoLegadoDto,
  type ResultadoExecucaoMigracaoDto,
} from "@/lib/migracaoLegado";
import { temPermissao, type PerfilUsuario } from "@/lib/permissoes";
import { executarMigracaoLegado, simularMigracaoLegado } from "@/server/acoes/migracaoLegado";

export function MigracaoLegadoView({
  inspecao,
  empresaAtual,
  usuarioPapel = "administrador",
}: {
  inspecao: InspecaoBancoLegadoDto;
  empresaAtual: { nome: string; cnpj: string };
  usuarioPapel?: PerfilUsuario;
}) {
  const toast = useToast();
  const podeGerenciar = temPermissao(usuarioPapel, "config.gerenciar");

  const [fonte, setFonte] = useState<"banco" | "json">(
    inspecao.empresaLegadaEncontrada || inspecao.dfeLegadoEncontradas > 0 ? "banco" : "json",
  );
  const [jsonTexto, setJsonTexto] = useState("");
  const [nomeArquivoJson, setNomeArquivoJson] = useState("");
  const [modulosSel, setModulosSel] = useState<ModuloMigracaoId[]>(MODULOS_MIGRACAO.map((m) => m.id));
  const [plano, setPlano] = useState<PlanoMigracaoLegadoDto | null>(null);
  const [resultado, setResultado] = useState<ResultadoExecucaoMigracaoDto | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [modalSql, setModalSql] = useState(false);

  if (!podeGerenciar) {
    return (
      <div className="space-y-4">
        <PageHeader
          titulo="Migração do legado para nk_*"
          subtitulo="Importação planejada e idempotente das tabelas antigas sem prefixo"
        />
        <Vazio>Apenas usuários com perfil Administrador podem simular e executar a migração de dados legados.</Vazio>
      </div>
    );
  }

  function alternarModulo(id: ModuloMigracaoId) {
    setModulosSel((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function rodarSimulacao() {
    setOcupado(true);
    setResultado(null);
    setConfirmado(false);
    const r = await simularMigracaoLegado({
      fonte,
      jsonConteudo: fonte === "json" ? jsonTexto : undefined,
      modulos: modulosSel,
    });
    setOcupado(false);
    if (!r.ok) {
      toast(r.erro, "erro");
      return;
    }
    setPlano(r.plano);
    toast(
      `Simulação concluída: ${r.plano.totalNovos} registro(s) novo(s) · ${r.plano.totalIgnorados} já existente(s).`,
      "ok",
    );
  }

  async function rodarImportacao() {
    setOcupado(true);
    const r = await executarMigracaoLegado({
      fonte,
      jsonConteudo: fonte === "json" ? jsonTexto : undefined,
      modulos: modulosSel,
      confirmado,
    });
    setOcupado(false);
    if (!r.ok) {
      toast(r.erro, "erro");
      return;
    }
    setPlano(r.plano);
    setResultado(r.execucao);
    setConfirmado(false);
    toast(r.aviso, "ok");
  }

  const sqlReadonly = gerarSqlPermissaoLeituraLegado();

  return (
    <div className="space-y-4">
      <PageHeader
        titulo="Migração planejada do legado → nk_*"
        subtitulo="Transfira produtos, clientes, vendas, contas e DF-e das tabelas antigas (ou backup JSON) sem apagar nem alterar o legado"
        etiquetas={
          <>
            <Badge tom="ok">Somente leitura no legado (SELECT)</Badge>
            <Badge tom="info">Importação idempotente (zero duplicidade)</Badge>
            <Badge tom="neutro" mono>
              CNPJ {empresaAtual.cnpj}
            </Badge>
          </>
        }
        acao={
          <>
            <Link href="/usuarios">
              <Button tamanho="sm" variante="secundario" icone="documento">
                Ver auditoria
              </Button>
            </Link>
            <Link href="/config">
              <Button tamanho="sm" variante="secundario" icone="engrenagem">
                Voltar p/ Configurações
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          rotulo="Tabelas legadas no banco"
          valor={`${inspecao.tabelasPresentes} / 10`}
          detalhe={`${inspecao.tabelasAcessiveis} acessível(eis) p/ leitura`}
          tom={inspecao.faltaPermissaoLeitura ? "alerta" : inspecao.tabelasPresentes > 0 ? "info" : "neutro"}
          icone="caixaEstoque"
        />
        <Kpi
          rotulo="Empresa legada vinculada"
          valor={inspecao.empresaLegadaEncontrada ? "Localizada" : "Não encontrada"}
          detalhe={
            inspecao.empresaLegadaEncontrada
              ? `${inspecao.empresaLegadaEncontrada.nome}${inspecao.empresaLegadaEncontrada.possuiSnapshotJson ? ` · snapshot v${inspecao.empresaLegadaEncontrada.versaoSnapshot}` : ""}`
              : "use o backup .json ou verifique CNPJ"
          }
          tom={inspecao.empresaLegadaEncontrada ? "ok" : "neutro"}
          icone="painel"
        />
        <Kpi
          rotulo="DF-e legadas (nfe_entrada)"
          valor={String(inspecao.dfeLegadoEncontradas)}
          detalhe="filtradas pelo CNPJ destinatário"
          tom={inspecao.dfeLegadoEncontradas > 0 ? "ok" : "neutro"}
          icone="cadeado"
        />
        <Kpi
          rotulo="Última migração auditada"
          valor={inspecao.ultimaMigracaoEm ? "Executada" : "Pendente"}
          detalhe={inspecao.ultimaMigracaoEm ? dataHoraBR(inspecao.ultimaMigracaoEm) : "nenhuma execução registrada"}
          tom={inspecao.ultimaMigracaoEm ? "ok" : "neutro"}
          icone="atualizar"
        />
      </div>

      {/* Passo 1: Escolha da Fonte */}
      <Card>
        <CardTitulo
          titulo="1. Escolha a origem dos dados legados"
          descricao="Você pode ler diretamente as tabelas antigas preservadas no mesmo Supabase ou enviar um arquivo .json do protótipo"
          icone="entrada"
        />

        <Abas
          atual={fonte}
          aoTrocar={(v) => {
            setFonte(v as "banco" | "json");
            setPlano(null);
            setResultado(null);
          }}
          abas={[
            {
              id: "banco",
              rotulo: "Tabelas legadas no Banco PostgreSQL / Supabase",
              contagem: inspecao.tabelasAcessiveis,
            },
            {
              id: "json",
              rotulo: "Arquivo .json de Backup / Snapshot do Protótipo",
            },
          ]}
        />

        {fonte === "banco" ? (
          <div className="space-y-3">
            {inspecao.faltaPermissaoLeitura && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-[12.5px] text-amber-900">
                <div>
                  <p className="font-bold">Permissão de leitura pendente em tabelas legadas</p>
                  <p className="text-[11.5px] text-amber-800">
                    Algumas tabelas antigas existem no banco, mas o usuário da aplicação ainda não tem permissão{" "}
                    <code className="font-mono">SELECT</code> nelas.
                  </p>
                </div>
                <Button tamanho="sm" variante="secundario" onClick={() => setModalSql(true)}>
                  Ver SQL somente-leitura (GRANT SELECT)
                </Button>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {inspecao.tabelas.map((t) => (
                <div
                  key={t.tabela}
                  className="flex items-center justify-between rounded-lg border border-ink-100 bg-ink-50/40 px-2.5 py-2 text-[12px]"
                >
                  <span className="font-mono font-semibold text-ink-800">{t.tabela}</span>
                  <Badge
                    tom={!t.existe ? "neutro" : t.acessivel ? "ok" : "alerta"}
                  >
                    {!t.existe ? "ausente" : t.acessivel ? "leitura ok" : "s/ SELECT"}
                  </Badge>
                </div>
              ))}
            </div>

            <p className="text-[11.5px] text-ink-400">
              Isolamento ativo: a consulta lê exclusivamente a empresa legada com CNPJ igual a <b>{empresaAtual.cnpj}</b> ou
              vinculada ao e-mail do administrador desta conta. Nenhuma tabela legada sofre alteração ou exclusão.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink-700 hover:bg-ink-50">
                <Icon name="entrada" className="size-4 text-way-600" />
                Selecionar arquivo .json
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const txt = await f.text();
                    setNomeArquivoJson(f.name);
                    setJsonTexto(txt);
                    setPlano(null);
                    setResultado(null);
                    toast(`Arquivo "${f.name}" carregado. Clique em Simular migração.`, "ok");
                  }}
                />
              </label>
              {nomeArquivoJson && (
                <Badge tom="ok">
                  {nomeArquivoJson} ({(jsonTexto.length / 1024).toFixed(1)} KB)
                </Badge>
              )}
            </div>

            <Area
              rotulo="Ou cole o conteúdo JSON do snapshot legado (erp_estados / backup do protótipo)"
              valor={jsonTexto}
              aoMudar={(v) => {
                setJsonTexto(v);
                setPlano(null);
                setResultado(null);
              }}
              linhas={5}
              placeholder='{"produtos":[...],"clientes":[...],"vendas":[...],"lancamentos":[...]}'
            />
          </div>
        )}
      </Card>

      {/* Passo 2: Seleção de Módulos e Simulação Dry-Run */}
      <Card>
        <CardTitulo
          titulo="2. Módulos a migrar e Simulação Prévia (Dry-Run)"
          descricao="Selecione quais conjuntos de dados deseja avaliar antes de gravar qualquer linha em nk_*"
          icone="check"
          acao={
            <div className="flex items-center gap-2">
              <Button
                tamanho="sm"
                variante="fantasma"
                onClick={() =>
                  setModulosSel(
                    modulosSel.length === MODULOS_MIGRACAO.length ? [] : MODULOS_MIGRACAO.map((m) => m.id),
                  )
                }
              >
                {modulosSel.length === MODULOS_MIGRACAO.length ? "Desmarcar todos" : "Marcar todos"}
              </Button>
              <Button
                icone="busca"
                disabled={ocupado || modulosSel.length === 0 || (fonte === "json" && !jsonTexto.trim())}
                onClick={rodarSimulacao}
              >
                {ocupado ? "Analisando dados…" : "Simular migração (Dry-Run)"}
              </Button>
            </div>
          }
        />

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MODULOS_MIGRACAO.map((m) => {
            const ativo = modulosSel.includes(m.id);
            return (
              <label
                key={m.id}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 text-[12px] transition",
                  ativo ? "border-way-300 bg-way-50/40" : "border-ink-100 bg-white opacity-70 hover:opacity-100",
                )}
              >
                <input
                  type="checkbox"
                  checked={ativo}
                  onChange={() => alternarModulo(m.id)}
                  className="mt-0.5 size-4 accent-way-600"
                />
                <div className="min-w-0">
                  <p className="font-bold text-ink-900">{m.rotulo}</p>
                  <p className="font-mono text-[10px] text-way-700">→ {m.destino}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ink-400">{m.descricao}</p>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Passo 3: Relatório do Plano e Execução Idempotente */}
      {plano && (
        <Card padding={false}>
          <div className="p-4 pb-2">
            <CardTitulo
              titulo={`3. Resultado da Simulação · Origem: ${plano.empresaOrigemNome} (${plano.fonte === "banco" ? "Banco Supabase" : "Backup JSON"})`}
              descricao={`Gerado em ${dataHoraBR(plano.geradoEm)} · Apenas os registros da coluna "Novos a importar" serão inseridos`}
              icone="documento"
              acao={
                <div className="flex items-center gap-1.5">
                  <Badge tom="info">{plano.totalEncontrados} analisado(s)</Badge>
                  <Badge tom={plano.totalNovos > 0 ? "ok" : "neutro"}>{plano.totalNovos} novo(s)</Badge>
                  <Badge tom="neutro">{plano.totalIgnorados} já em nk_*</Badge>
                </div>
              }
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-y border-ink-100 bg-ink-50/70 text-[11px] uppercase text-ink-400">
                <tr>
                  <th className="px-4 py-2.5">Módulo</th>
                  <th className="px-3 py-2.5">Tabela destino</th>
                  <th className="px-3 py-2.5 text-right">Encontrados</th>
                  <th className="px-3 py-2.5 text-right">Novos a importar</th>
                  <th className="px-3 py-2.5 text-right">Já existentes</th>
                  <th className="px-4 py-2.5 text-right">Saneados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {plano.modulos.map((m) => (
                  <tr key={m.modulo} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5 font-semibold text-ink-800">{m.rotulo}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-ink-500">{m.destino}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-600">{m.encontrados}</td>
                    <td className="tabular px-3 py-2.5 text-right font-bold text-way-700">{m.novos}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-400">{m.ignoradosExistentes}</td>
                    <td className="tabular px-4 py-2.5 text-right text-amber-700">{m.saneados}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-ink-200 bg-ink-50/70 font-bold text-ink-900">
                <tr>
                  <td className="px-4 py-2.5" colSpan={2}>
                    Total consolidado
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{plano.totalEncontrados}</td>
                  <td className="tabular px-3 py-2.5 text-right text-way-700">{plano.totalNovos}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-500">{plano.totalIgnorados}</td>
                  <td className="tabular px-4 py-2.5 text-right text-amber-700">{plano.totalAvisos}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {plano.modulos.some((m) => m.avisos.length > 0) && (
            <div className="border-t border-ink-100 bg-amber-50/50 px-4 py-3 text-[12px] text-amber-900">
              <p className="font-bold">Ajustes automáticos de saneamento fiscal identificados:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11.5px] text-amber-800">
                {plano.modulos.flatMap((m) => m.avisos).map((av, i) => (
                  <li key={i}>{av}</li>
                ))}
              </ul>
            </div>
          )}

          {resultado ? (
            <div className="border-t border-way-200 bg-way-50/70 p-4 text-[12.5px] text-way-900">
              <p className="font-bold">
                Migração executada e registrada na trilha de auditoria ({dataHoraBR(resultado.executadoEm)})
              </p>
              <p className="mt-0.5">
                Foram importados <b>{resultado.totalImportados}</b> registro(s) novos para as tabelas <code className="font-mono">nk_*</code> e{" "}
                <b>{resultado.totalIgnorados}</b> registros já existentes foram preservados sem duplicação. As tabelas legadas permaneceram 100% intactas.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium text-ink-800">
                <input
                  type="checkbox"
                  checked={confirmado}
                  onChange={(e) => setConfirmado(e.target.checked)}
                  className="size-4 accent-way-600"
                />
                Confirmo a importação aditiva para as tabelas nk_* (as tabelas legadas não serão apagadas nem alteradas).
              </label>

              <Button
                icone="check"
                disabled={ocupado || !confirmado}
                onClick={rodarImportacao}
              >
                {ocupado
                  ? "Importando para nk_*…"
                  : `Importar ${plano.totalNovos} registro(s) novo(s)`}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Modal: SQL Somente Leitura para nkway_app */}
      <Modal
        aberto={modalSql}
        aoFechar={() => setModalSql(false)}
        titulo="SQL somente-leitura (GRANT SELECT) para tabelas legadas"
        descricao="Opcional: rode no SQL Editor do Supabase caso deseje liberar leitura direta das tabelas antigas para nkway_app"
        largura="max-w-2xl"
        rodape={
          <div className="flex justify-end gap-2">
            <Button
              variante="secundario"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sqlReadonly);
                  toast("SQL copiado para a área de transferência.", "ok");
                } catch {
                  toast("Selecione o bloco na tela para copiar.", "info");
                }
              }}
            >
              Copiar SQL
            </Button>
            <Button onClick={() => setModalSql(false)}>Fechar</Button>
          </div>
        }
      >
        <div className="space-y-2.5">
          <p className="text-[12px] text-ink-500">
            Este comando concede apenas permissão <code className="font-mono font-bold">SELECT</code> (leitura). Ele{" "}
            <b>não apaga</b>, <b>não altera</b> e <b>não recria</b> nenhuma tabela legada.
          </p>
          <pre className="overflow-x-auto rounded-xl bg-ink-900 p-3.5 font-mono text-[11px] leading-relaxed text-ink-100">
            {sqlReadonly}
          </pre>
        </div>
      </Modal>
    </div>
  );
}
