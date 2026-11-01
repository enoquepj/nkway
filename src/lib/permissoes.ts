/**
 * NKWAY — Perfis de acesso e matriz de permissões por ação (Fase 1).
 * Módulo puro (sem dependências Node), compartilhado entre Server Actions e interface.
 */

export const PERFIS_USUARIO = ["administrador", "operador", "vendedor"] as const;
export type PerfilUsuario = (typeof PERFIS_USUARIO)[number];

export const ROTULO_PERFIL: Record<PerfilUsuario, { nome: string; descricao: string; tom: "ok" | "info" | "roxo" }> = {
  administrador: {
    nome: "Administrador",
    descricao: "Acesso total à empresa, usuários, permissões, auditoria, reabertura de caixa e configurações fiscais.",
    tom: "ok",
  },
  operador: {
    nome: "Operador",
    descricao: "Opera frente de caixa (abertura, vendas fiscais, sangria/suprimento e fechamento), documentos e estoque operacional.",
    tom: "info",
  },
  vendedor: {
    nome: "Vendedor",
    descricao: "Atendimento e pré-venda: consulta catálogo, cadastra clientes e emite DAVs/orçamentos sem operar numerário de caixa.",
    tom: "roxo",
  },
};

export const PERMISSOES_ACAO = [
  "usuarios.ver",
  "usuarios.gerenciar",
  "auditoria.ver",
  "config.gerenciar",
  "pdv.vender",
  "dav.criar",
  "dav.faturar",
  "venda.cancelar",
  "caixa.abrir",
  "caixa.movimentar",
  "caixa.fechar",
  "caixa.reabrir",
  "caixa.ajustar",
  "caixa.relatorio_todos",
  "documentos.ver",
  "documentos.exportar_xml",
  "fiscal.eventos",
  "cadastros.produtos",
  "cadastros.clientes",
  "estoque.ajustar",
  "financeiro.gerenciar",
] as const;

export type PermissaoAcao = (typeof PERMISSOES_ACAO)[number];

export const CATALOGO_PERMISSOES: {
  acao: PermissaoAcao;
  grupo: string;
  rotulo: string;
}[] = [
  { acao: "usuarios.ver", grupo: "Usuários e Auditoria", rotulo: "Visualizar usuários e perfis" },
  { acao: "usuarios.gerenciar", grupo: "Usuários e Auditoria", rotulo: "Cadastrar, editar, ativar/desativar e atribuir perfil" },
  { acao: "auditoria.ver", grupo: "Usuários e Auditoria", rotulo: "Consultar trilha de auditoria da empresa" },
  { acao: "config.gerenciar", grupo: "Configurações", rotulo: "Alterar dados da empresa, fiscal, certificado A1 e plano" },
  { acao: "pdv.vender", grupo: "PDV e Vendas", rotulo: "Emitir venda fiscal na frente de caixa" },
  { acao: "dav.criar", grupo: "PDV e Vendas", rotulo: "Criar DAV / orçamento de pré-venda" },
  { acao: "dav.faturar", grupo: "PDV e Vendas", rotulo: "Faturar DAV em documento fiscal" },
  { acao: "venda.cancelar", grupo: "PDV e Vendas", rotulo: "Cancelar / estornar venda ou documento" },
  { acao: "caixa.abrir", grupo: "Caixa", rotulo: "Abrir sessão de caixa com saldo inicial" },
  { acao: "caixa.movimentar", grupo: "Caixa", rotulo: "Registrar suprimento e sangria no caixa aberto" },
  { acao: "caixa.fechar", grupo: "Caixa", rotulo: "Conferir valores e fechar sessão de caixa" },
  { acao: "caixa.reabrir", grupo: "Caixa", rotulo: "Reabrir sessão de caixa fechada (com justificativa)" },
  { acao: "caixa.ajustar", grupo: "Caixa", rotulo: "Ajustar conferência de caixa fechado (com justificativa)" },
  { acao: "caixa.relatorio_todos", grupo: "Caixa", rotulo: "Consultar histórico de caixa de todos os operadores" },
  { acao: "documentos.ver", grupo: "Documentos Fiscais", rotulo: "Consultar documentos de venda e DANFE" },
  { acao: "documentos.exportar_xml", grupo: "Documentos Fiscais", rotulo: "Exportar XML fiscal (individual e lote ZIP)" },
  { acao: "fiscal.eventos", grupo: "Documentos Fiscais", rotulo: "Inutilização, carta de correção, MDF-e e DF-e" },
  { acao: "cadastros.produtos", grupo: "Cadastros e Estoque", rotulo: "Criar/editar produtos e manutenção de preços" },
  { acao: "cadastros.clientes", grupo: "Cadastros e Estoque", rotulo: "Cadastrar e atualizar clientes e fornecedores" },
  { acao: "estoque.ajustar", grupo: "Cadastros e Estoque", rotulo: "Ajustes de kardex, inventário, entradas e devoluções" },
  { acao: "financeiro.gerenciar", grupo: "Financeiro", rotulo: "Lançar, baixar, reabrir e excluir títulos financeiros" },
];

const MATRIZ: Record<PerfilUsuario, readonly PermissaoAcao[]> = {
  administrador: PERMISSOES_ACAO,
  operador: [
    "pdv.vender",
    "dav.criar",
    "dav.faturar",
    "venda.cancelar",
    "caixa.abrir",
    "caixa.movimentar",
    "caixa.fechar",
    "documentos.ver",
    "documentos.exportar_xml",
    "fiscal.eventos",
    "cadastros.clientes",
    "estoque.ajustar",
  ],
  vendedor: [
    "dav.criar",
    "documentos.ver",
    "cadastros.clientes",
  ],
};

/** Normaliza papéis legados ("owner" → "administrador") sem perder compatibilidade */
export function normalizarPerfil(papel: string | null | undefined): PerfilUsuario {
  const p = String(papel ?? "").trim().toLowerCase();
  if (p === "owner" || p === "admin" || p === "administrador") return "administrador";
  if (p === "vendedor") return "vendedor";
  return "operador";
}

export function perfilValido(papel: string | null | undefined): papel is PerfilUsuario {
  return PERFIS_USUARIO.includes(String(papel ?? "").trim().toLowerCase() as PerfilUsuario);
}

export function permissoesDoPerfil(papel: string | null | undefined): PermissaoAcao[] {
  const perfil = normalizarPerfil(papel);
  return [...MATRIZ[perfil]];
}

export function temPermissao(papel: string | null | undefined, acao: PermissaoAcao): boolean {
  const perfil = normalizarPerfil(papel);
  return MATRIZ[perfil].includes(acao);
}

export function rotuloPerfil(papel: string | null | undefined): string {
  return ROTULO_PERFIL[normalizarPerfil(papel)].nome;
}
