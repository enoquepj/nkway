"use server";

import { revalidatePath } from "next/cache";
import {
  MODULOS_MIGRACAO,
  type ModuloMigracaoId,
  type PlanoMigracaoLegadoDto,
  type ResultadoExecucaoMigracaoDto,
} from "@/lib/migracaoLegado";
import {
  carregarPacoteLegadoDoBanco,
  extrairPacoteDeObjetoJson,
  processarMigracaoLegado,
} from "@/server/migracaoLegadoCore";
import { comoErro, corpo, exigirPermissao, logico, texto } from "@/server/tenant";

export type RespostaSimulacaoLegado =
  | { ok: true; plano: PlanoMigracaoLegadoDto }
  | { ok: false; erro: string };

export type RespostaExecucaoLegado =
  | { ok: true; plano: PlanoMigracaoLegadoDto; execucao: ResultadoExecucaoMigracaoDto; aviso: string }
  | { ok: false; erro: string };

const IDS_VALIDOS = new Set<string>(MODULOS_MIGRACAO.map((m) => m.id));

function filtrarModulos(brutos: unknown): ModuloMigracaoId[] {
  if (!Array.isArray(brutos)) return MODULOS_MIGRACAO.map((m) => m.id);
  const lista = brutos.map((x) => String(x ?? "")).filter((x): x is ModuloMigracaoId => IDS_VALIDOS.has(x));
  return lista.length > 0 ? lista : MODULOS_MIGRACAO.map((m) => m.id);
}

function revalidarTudoPosMigracao() {
  [
    "/",
    "/migracao",
    "/config",
    "/produtos",
    "/clientes",
    "/entradas",
    "/estoque",
    "/documentos",
    "/financeiro",
    "/dfe",
    "/transporte",
    "/usuarios",
  ].forEach((p) => revalidatePath(p));
}

export async function simularMigracaoLegado(bruto: {
  fonte?: "banco" | "json";
  jsonConteudo?: string;
  modulos?: string[];
}): Promise<RespostaSimulacaoLegado> {
  try {
    const { empresaId, empresa, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{ fonte?: string; jsonConteudo?: string; modulos?: string[] }>(bruto);
    const fonte = texto(input.fonte) === "json" ? "json" : "banco";
    const modulosSelecionados = filtrarModulos(input.modulos);

    const pacote =
      fonte === "json"
        ? (() => {
            const txt = String(input.jsonConteudo ?? "").trim();
            if (!txt) throw new Error("Selecione ou cole o arquivo JSON de backup/snapshot do legado.");
            let parsed: unknown;
            try {
              parsed = JSON.parse(txt);
            } catch {
              throw new Error("O arquivo enviado não possui JSON válido.");
            }
            return extrairPacoteDeObjetoJson(parsed, { nome: empresa.nome, cnpj: empresa.cnpj });
          })()
        : await carregarPacoteLegadoDoBanco(empresaId);

    const { plano } = await processarMigracaoLegado({
      empresaId,
      fonte,
      pacote,
      modulosSelecionados,
      aplicar: false,
      usuario,
    });

    revalidatePath("/migracao");
    revalidatePath("/usuarios");
    return { ok: true, plano };
  } catch (e) {
    return comoErro(e);
  }
}

export async function executarMigracaoLegado(bruto: {
  fonte?: "banco" | "json";
  jsonConteudo?: string;
  modulos?: string[];
  confirmado?: boolean;
}): Promise<RespostaExecucaoLegado> {
  try {
    const { empresaId, empresa, usuario } = await exigirPermissao("config.gerenciar");
    const input = corpo<{
      fonte?: string;
      jsonConteudo?: string;
      modulos?: string[];
      confirmado?: boolean;
    }>(bruto);

    if (!logico(input.confirmado)) {
      return {
        ok: false,
        erro: "Marque a confirmação de segurança antes de importar os registros para as tabelas nk_*.",
      };
    }

    const fonte = texto(input.fonte) === "json" ? "json" : "banco";
    const modulosSelecionados = filtrarModulos(input.modulos);

    const pacote =
      fonte === "json"
        ? (() => {
            const txt = String(input.jsonConteudo ?? "").trim();
            if (!txt) throw new Error("Selecione ou cole o arquivo JSON de backup/snapshot do legado.");
            let parsed: unknown;
            try {
              parsed = JSON.parse(txt);
            } catch {
              throw new Error("O arquivo enviado não possui JSON válido.");
            }
            return extrairPacoteDeObjetoJson(parsed, { nome: empresa.nome, cnpj: empresa.cnpj });
          })()
        : await carregarPacoteLegadoDoBanco(empresaId);

    const { plano, execucao } = await processarMigracaoLegado({
      empresaId,
      fonte,
      pacote,
      modulosSelecionados,
      aplicar: true,
      usuario,
    });

    if (!execucao) {
      return { ok: false, erro: "Falha inesperada ao consolidar o relatório da migração." };
    }

    revalidarTudoPosMigracao();

    const aviso =
      execucao.totalImportados > 0
        ? `Migração concluída: ${execucao.totalImportados} registro(s) novo(s) importado(s) para nk_* (${execucao.totalIgnorados} já existentes preservados). As tabelas legadas permaneceram intactas.`
        : `Tudo já estava sincronizado: nenhum registro novo precisou ser importado (${execucao.totalIgnorados} já existentes em nk_*).`;

    return { ok: true, plano, execucao, aviso };
  } catch (e) {
    return comoErro(e);
  }
}
