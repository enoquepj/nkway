"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { usuarios } from "@/db/schema";
import { planoById } from "@/lib/dominio";
import { normalizarPerfil, perfilValido, rotuloPerfil, type PerfilUsuario } from "@/lib/permissoes";
import { hashSenha } from "@/lib/session";
import { registrarAuditoria } from "@/server/auditoria";
import { comoErro, corpo, exigirPermissao, logico, texto } from "@/server/tenant";

export type ResultadoUsuario = { ok: true; id?: string; aviso?: string } | { ok: false; erro: string };

function revalidarUsuarios() {
  ["/usuarios", "/config", "/", "/pdv"].forEach((p) => revalidatePath(p));
}

async function contarAdminsAtivos(empresaId: string): Promise<number> {
  const lista = await db
    .select({ id: usuarios.id, papel: usuarios.papel, ativo: usuarios.ativo })
    .from(usuarios)
    .where(eq(usuarios.empresaId, empresaId));
  return lista.filter((u) => u.ativo !== false && normalizarPerfil(u.papel) === "administrador").length;
}

export async function criarUsuario(bruto: {
  nome?: string;
  email?: string;
  senha?: string;
  papel?: string;
  ativo?: boolean;
}): Promise<ResultadoUsuario> {
  try {
    const { empresaId, empresa, usuario: autor } = await exigirPermissao("usuarios.gerenciar");
    const input = corpo<{ nome?: string; email?: string; senha?: string; papel?: string; ativo?: boolean }>(bruto);
    const nome = texto(input.nome);
    const email = texto(input.email).toLowerCase();
    const senha = String(input.senha ?? "");
    const papelInformado = texto(input.papel).toLowerCase() || "operador";
    const ativo = input.ativo === undefined ? true : logico(input.ativo);

    if (nome.length < 2) return { ok: false, erro: "Informe o nome completo do usuário (mín. 2 caracteres)." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, erro: "Informe um e-mail válido." };
    if (senha.length < 6) return { ok: false, erro: "A senha inicial precisa ter ao menos 6 caracteres." };
    if (!perfilValido(papelInformado)) {
      return { ok: false, erro: "Perfil inválido. Escolha Administrador, Operador ou Vendedor." };
    }

    const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
    if (existente) return { ok: false, erro: "Já existe um usuário cadastrado com este e-mail." };

    if (ativo) {
      const [qtd] = await db
        .select({ n: sql<string>`count(*)` })
        .from(usuarios)
        .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.ativo, true)));
      const limite = planoById(empresa.plano).limiteUsuarios;
      if (Number(qtd?.n ?? 0) >= limite) {
        return {
          ok: false,
          erro: `O plano ${planoById(empresa.plano).nome} permite até ${limite} usuário(s) ativo(s). Desative um acesso ou faça upgrade.`,
        };
      }
    }

    const perfil: PerfilUsuario = normalizarPerfil(papelInformado);
    const [novo] = await db
      .insert(usuarios)
      .values({
        empresaId,
        nome,
        email,
        senhaHash: hashSenha(senha),
        papel: perfil,
        ativo,
        atualizadoEm: new Date(),
      })
      .returning({ id: usuarios.id });

    await registrarAuditoria({
      empresaId,
      usuario: autor,
      acao: "usuario.criar",
      entidade: "usuario",
      registroId: novo.id,
      resumo: `Usuário ${nome} (${email}) criado com perfil ${rotuloPerfil(perfil)}`,
      alteracoes: { depois: { nome, email, papel: perfil, ativo } },
    });

    revalidarUsuarios();
    return { ok: true, id: novo.id, aviso: `${nome} cadastrado como ${rotuloPerfil(perfil)}.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function editarUsuario(bruto: {
  id?: string;
  nome?: string;
  email?: string;
  papel?: string;
  novaSenha?: string;
  ativo?: boolean;
}): Promise<ResultadoUsuario> {
  try {
    const { empresaId, empresa, usuario: autor } = await exigirPermissao("usuarios.gerenciar");
    const input = corpo<{
      id?: string;
      nome?: string;
      email?: string;
      papel?: string;
      novaSenha?: string;
      ativo?: boolean;
    }>(bruto);

    const id = texto(input.id);
    if (!id) return { ok: false, erro: "Informe o usuário a ser editado." };

    const [alvo] = await db
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.id, id), eq(usuarios.empresaId, empresaId)))
      .limit(1);
    if (!alvo) return { ok: false, erro: "Usuário não encontrado nesta empresa." };

    const nome = texto(input.nome) || alvo.nome;
    const email = (texto(input.email) || alvo.email).toLowerCase();
    if (nome.length < 2) return { ok: false, erro: "Informe o nome do usuário." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, erro: "Informe um e-mail válido." };

    if (email !== alvo.email.toLowerCase()) {
      const [outro] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, email)).limit(1);
      if (outro && outro.id !== alvo.id) return { ok: false, erro: "Este e-mail já está em uso por outro usuário." };
    }

    const perfilAtual = normalizarPerfil(alvo.papel);
    const perfilNovo: PerfilUsuario = input.papel ? (perfilValido(input.papel) ? normalizarPerfil(input.papel) : perfilAtual) : perfilAtual;
    if (input.papel && !perfilValido(input.papel)) {
      return { ok: false, erro: "Perfil inválido. Escolha Administrador, Operador ou Vendedor." };
    }

    const ativoNovo = input.ativo === undefined ? alvo.ativo !== false : logico(input.ativo);

    if (alvo.id === autor.id && !ativoNovo) {
      return { ok: false, erro: "Você não pode desativar o seu próprio usuário." };
    }

    // Impede deixar a empresa sem nenhum administrador ativo
    if (perfilAtual === "administrador" && alvo.ativo !== false && (perfilNovo !== "administrador" || !ativoNovo)) {
      const adminsAtivos = await contarAdminsAtivos(empresaId);
      if (adminsAtivos <= 1) {
        return { ok: false, erro: "A empresa precisa manter ao menos um Administrador ativo." };
      }
    }

    // Se estiver reativando, respeita limite do plano
    if (alvo.ativo === false && ativoNovo) {
      const [qtd] = await db
        .select({ n: sql<string>`count(*)` })
        .from(usuarios)
        .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.ativo, true)));
      const limite = planoById(empresa.plano).limiteUsuarios;
      if (Number(qtd?.n ?? 0) >= limite) {
        return { ok: false, erro: `Limite de ${limite} usuário(s) ativo(s) do plano atingido.` };
      }
    }

    const novaSenha = String(input.novaSenha ?? "");
    if (novaSenha && novaSenha.length < 6) {
      return { ok: false, erro: "A nova senha deve ter no mínimo 6 caracteres." };
    }

    const atualizacao: Partial<typeof usuarios.$inferInsert> = {
      nome,
      email,
      papel: perfilNovo,
      ativo: ativoNovo,
      atualizadoEm: new Date(),
    };
    if (novaSenha) {
      atualizacao.senhaHash = hashSenha(novaSenha);
    }

    await db.update(usuarios).set(atualizacao).where(and(eq(usuarios.id, alvo.id), eq(usuarios.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario: autor,
      acao: "usuario.editar",
      entidade: "usuario",
      registroId: alvo.id,
      resumo: `Usuário ${nome} atualizado (${rotuloPerfil(perfilNovo)} · ${ativoNovo ? "ativo" : "inativo"})${novaSenha ? " · senha redefinida" : ""}`,
      alteracoes: {
        antes: { nome: alvo.nome, email: alvo.email, papel: perfilAtual, ativo: alvo.ativo !== false },
        depois: { nome, email, papel: perfilNovo, ativo: ativoNovo, senhaRedefinida: Boolean(novaSenha) },
      },
    });

    revalidarUsuarios();
    return { ok: true, id: alvo.id, aviso: `Cadastro de ${nome} atualizado.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function atribuirPerfilUsuario(bruto: { id?: string; papel?: string }): Promise<ResultadoUsuario> {
  try {
    const { empresaId, usuario: autor } = await exigirPermissao("usuarios.gerenciar");
    const input = corpo<{ id?: string; papel?: string }>(bruto);
    const id = texto(input.id);
    const papelStr = texto(input.papel).toLowerCase();

    if (!id) return { ok: false, erro: "Informe o usuário." };
    if (!perfilValido(papelStr)) return { ok: false, erro: "Perfil inválido. Use Administrador, Operador ou Vendedor." };

    const [alvo] = await db
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.id, id), eq(usuarios.empresaId, empresaId)))
      .limit(1);
    if (!alvo) return { ok: false, erro: "Usuário não pertence a esta empresa." };

    const perfilAntigo = normalizarPerfil(alvo.papel);
    const perfilNovo = normalizarPerfil(papelStr);
    if (perfilAntigo === "administrador" && perfilNovo !== "administrador" && alvo.ativo !== false) {
      const adminsAtivos = await contarAdminsAtivos(empresaId);
      if (adminsAtivos <= 1) {
        return { ok: false, erro: "Não é possível remover o perfil do último Administrador ativo." };
      }
    }

    await db
      .update(usuarios)
      .set({ papel: perfilNovo, atualizadoEm: new Date() })
      .where(and(eq(usuarios.id, alvo.id), eq(usuarios.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario: autor,
      acao: "usuario.perfil",
      entidade: "usuario",
      registroId: alvo.id,
      resumo: `Perfil de ${alvo.nome} alterado de ${rotuloPerfil(perfilAntigo)} para ${rotuloPerfil(perfilNovo)}`,
      alteracoes: { antes: { papel: perfilAntigo }, depois: { papel: perfilNovo } },
    });

    revalidarUsuarios();
    return { ok: true, id: alvo.id, aviso: `Perfil de ${alvo.nome} alterado para ${rotuloPerfil(perfilNovo)}.` };
  } catch (e) {
    return comoErro(e);
  }
}

export async function alternarStatusUsuario(bruto: { id?: string; ativo?: boolean }): Promise<ResultadoUsuario> {
  try {
    const { empresaId, empresa, usuario: autor } = await exigirPermissao("usuarios.gerenciar");
    const input = corpo<{ id?: string; ativo?: boolean }>(bruto);
    const id = texto(input.id);
    if (!id) return { ok: false, erro: "Informe o usuário." };

    const [alvo] = await db
      .select()
      .from(usuarios)
      .where(and(eq(usuarios.id, id), eq(usuarios.empresaId, empresaId)))
      .limit(1);
    if (!alvo) return { ok: false, erro: "Usuário não encontrado nesta empresa." };

    const atualAtivo = alvo.ativo !== false;
    const novoAtivo = input.ativo === undefined ? !atualAtivo : logico(input.ativo);

    if (alvo.id === autor.id && !novoAtivo) {
      return { ok: false, erro: "Você não pode desativar o seu próprio acesso." };
    }

    if (atualAtivo && !novoAtivo && normalizarPerfil(alvo.papel) === "administrador") {
      const adminsAtivos = await contarAdminsAtivos(empresaId);
      if (adminsAtivos <= 1) {
        return { ok: false, erro: "Não é possível desativar o último Administrador ativo da empresa." };
      }
    }

    if (!atualAtivo && novoAtivo) {
      const [qtd] = await db
        .select({ n: sql<string>`count(*)` })
        .from(usuarios)
        .where(and(eq(usuarios.empresaId, empresaId), eq(usuarios.ativo, true)));
      const limite = planoById(empresa.plano).limiteUsuarios;
      if (Number(qtd?.n ?? 0) >= limite) {
        return { ok: false, erro: `Limite do plano (${limite} acessos ativos) atingido.` };
      }
    }

    await db
      .update(usuarios)
      .set({ ativo: novoAtivo, atualizadoEm: new Date() })
      .where(and(eq(usuarios.id, alvo.id), eq(usuarios.empresaId, empresaId)));

    await registrarAuditoria({
      empresaId,
      usuario: autor,
      acao: novoAtivo ? "usuario.ativar" : "usuario.desativar",
      entidade: "usuario",
      registroId: alvo.id,
      resumo: `Usuário ${alvo.nome} (${alvo.email}) ${novoAtivo ? "ativado" : "desativado"}`,
      alteracoes: { antes: { ativo: atualAtivo }, depois: { ativo: novoAtivo } },
    });

    revalidarUsuarios();
    return {
      ok: true,
      id: alvo.id,
      aviso: `${alvo.nome} foi ${novoAtivo ? "ativado e já pode acessar o sistema" : "desativado e teve o acesso bloqueado"}.`,
    };
  } catch (e) {
    return comoErro(e);
  }
}
