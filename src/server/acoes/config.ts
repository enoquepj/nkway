"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { empresas, pdvConfigs, usuarios } from "@/db/schema";
import { mascaraDocumento } from "@/lib/dominio";
import { sanitizarConfigPdvImpressao } from "@/lib/pdvImpressao";
import { normalizarPerfil } from "@/lib/permissoes";
import { cancelarAssinaturaCnpj, contratarAssinaturaCnpj } from "@/server/acoes/assinatura";
import { criarUsuario, alternarStatusUsuario } from "@/server/acoes/usuarios";
import { registrarAuditoria } from "@/server/auditoria";
import { comoErro, corpo, exigirPermissao, texto } from "@/server/tenant";

export type Resultado = { ok: true; aviso?: string } | { ok: false, erro: string };

export async function salvarEmpresa(input: {
  nome: string;
  nomeFantasia: string;
  cnpj: string;
  uf: string;
  municipio: string;
  codMunicipio: string;
  ie: string;
  regime: string;
  porte: string;
  telefone: string;
  email: string;
  endereco: string;
  numero: string;
  bairro: string;
  cep: string;
}): Promise<Resultado> {
  try {
    const { empresa, usuario } = await exigirPermissao("config.gerenciar");
    input = corpo(input);
    if (texto(input.nome).trim().length < 2) return { ok: false, erro: "Informe a razão social." };
    if (texto(input.cnpj).replace(/\D/g, "").length !== 14) return { ok: false, erro: "CNPJ deve ter 14 dígitos." };
    await db
      .update(empresas)
      .set({
        nome: texto(input.nome).trim(),
        nomeFantasia: texto(input.nomeFantasia).trim() || texto(input.nome).trim(),
        cnpj: mascaraDocumento(texto(input.cnpj).replace(/\D/g, "")),
        uf: input.uf,
        municipio: texto(input.municipio).trim(),
        codMunicipio: texto(input.codMunicipio).replace(/\D/g, "").slice(0, 7),
        ie: texto(input.ie).trim(),
        regime: input.regime,
        porte: input.porte,
        telefone: texto(input.telefone).trim(),
        email: texto(input.email).trim(),
        endereco: texto(input.endereco).trim(),
        numero: texto(input.numero).trim(),
        bairro: texto(input.bairro).trim(),
        cep: texto(input.cep).replace(/\D/g, ""),
      })
      .where(eq(empresas.id, empresa.id));
    await registrarAuditoria({
      empresaId: empresa.id,
      usuario,
      acao: "config.empresa",
      entidade: "empresa",
      registroId: empresa.id,
      resumo: `Dados cadastrais da empresa atualizados (${texto(input.nome).trim()})`,
      alteracoes: { cnpj: mascaraDocumento(texto(input.cnpj).replace(/\D/g, "")), uf: input.uf, regime: input.regime },
    });
    revalidatePath("/config");
    revalidatePath("/", "layout");
    return { ok: true, aviso: "Dados da empresa atualizados." };
  } catch (e) {
    return comoErro(e);
  }
}

/** configuração fiscal (séries, ambiente, CSC e dados do certificado A1 — a senha nunca vai ao banco) */
export async function salvarFiscal(input: {
  serieNfce: string;
  serieNfe: string;
  serieMdfe: string;
  ambiente: 1 | 2;
  cscId: string;
  cscToken: string;
  crt: number;
  certificadoNome: string;
  certificadoValidade: string;
  certificadoSerial: string;
}): Promise<Resultado> {
  try {
    const { empresa, usuario } = await exigirPermissao("config.gerenciar");
    input = corpo(input);
    if (![1, 2, 3, 4].includes(Number(input.crt))) return { ok: false, erro: "Selecione um CRT válido entre 1 e 4." };
    const anterior = (empresa.fiscal ?? {}) as Record<string, unknown>;
    await db
      .update(empresas)
      .set({
        fiscal: {
          ...anterior,
          serieNfce: input.serieNfce || "1",
          serieNfe: input.serieNfe || "1",
          serieMdfe: input.serieMdfe || "1",
          ambiente: input.ambiente,
          cscId: input.cscId,
          cscToken: input.cscToken ? `${texto(input.cscToken).slice(0, 4)}···${texto(input.cscToken).slice(-4)}` : "",
          crt: input.crt,
          certificadoNome: input.certificadoNome,
          certificadoValidade: input.certificadoValidade,
          certificadoSerial: input.certificadoSerial,
          ufPadrao: empresa.uf,
        },
      })
      .where(eq(empresas.id, empresa.id));
    await registrarAuditoria({
      empresaId: empresa.id,
      usuario,
      acao: "config.fiscal",
      entidade: "empresa",
      registroId: empresa.id,
      resumo: `Configuração fiscal atualizada (ambiente ${input.ambiente === 1 ? "Produção" : "Homologação"})`,
      alteracoes: { ambiente: input.ambiente, serieNfce: input.serieNfce, serieNfe: input.serieNfe },
    });
    revalidatePath("/config");
    return { ok: true, aviso: "Configuração fiscal salva. O CSC é gravado mascarado no banco." };
  } catch (e) {
    return comoErro(e);
  }
}

export async function alterarPlano(planoId: string): Promise<Resultado> {
  const pid = texto(planoId);
  if (!pid) return { ok: false, erro: "Informe o plano desejado." };
  if (pid === "start") {
    return cancelarAssinaturaCnpj({
      motivo: "Retorno ao plano gratuito MEI Start pela tela de configurações",
      imediato: true,
    });
  }
  return contratarAssinaturaCnpj({
    planoId: pid,
    ciclo: "mensal",
    formaPagamento: "pix",
  });
}

export async function criarOperador(input: { nome: string; email: string; senha: string; papel?: string }): Promise<Resultado> {
  const b = corpo<{ nome?: string; email?: string; senha?: string; papel?: string }>(input);
  return criarUsuario({
    nome: texto(b.nome) || "Operador",
    email: texto(b.email),
    senha: String(b.senha ?? ""),
    papel: normalizarPerfil(b.papel || "operador"),
    ativo: true,
  });
}

export async function removerOperador(id: string): Promise<Resultado> {
  return alternarStatusUsuario({ id, ativo: false });
}

/** Etapa 1 PDV/impressão: salva a configuração do cupom da empresa (somente config.gerenciar). */
export async function salvarConfigPdv(bruto: unknown): Promise<Resultado> {
  try {
    const { empresa, usuario } = await exigirPermissao("config.gerenciar");
    const cfg = sanitizarConfigPdvImpressao((corpo(bruto) as Record<string, unknown> | null) ?? {});
    await db
      .insert(pdvConfigs)
      .values({ empresaId: empresa.id, dados: cfg as unknown as Record<string, unknown>, atualizadoEm: new Date() })
      .onConflictDoUpdate({
        target: pdvConfigs.empresaId,
        set: { dados: cfg as unknown as Record<string, unknown>, atualizadoEm: new Date() },
      });
    await registrarAuditoria({
      empresaId: empresa.id,
      usuario,
      acao: "config.pdv_impressao",
      entidade: "pdv_config",
      registroId: empresa.id,
      resumo: `Configuração de PDV/impressão atualizada (vias ${cfg.nroVias}, layout ${cfg.layoutCupom}, confirmação ${cfg.confirmarAntesImprimir ? "sim" : "não"})`,
      alteracoes: { nroVias: cfg.nroVias, layoutCupom: cfg.layoutCupom, confirmarAntesImprimir: cfg.confirmarAntesImprimir, imprimeLogo: cfg.imprimeLogo, confissaoDivida: cfg.confissaoDivida },
    });
    revalidatePath("/config");
    revalidatePath("/pdv");
    return { ok: true, aviso: "Configuração do PDV salva e aplicada ao cupom." };
  } catch (e) {
    return comoErro(e);
  }
}
