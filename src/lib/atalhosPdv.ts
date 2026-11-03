/**
 * NKWAY — Fonte única de verdade dos atalhos de teclado da Frente de Caixa (Etapa 4).
 * Tanto o modal de Ajuda (F1) quanto a legenda da barra inferior leem exclusivamente desta lista.
 */

export type IdAcaoAtalhoPdv =
  | "ajuda"
  | "bipagem"
  | "multiplicador_qtd"
  | "documentos"
  | "desconto"
  | "cancelar_venda"
  | "consultar_preco"
  | "cliente"
  | "venda_espera"
  | "finalizar"
  | "remover_ultimo"
  | "desfazer_item"
  | "formas_pagamento"
  | "gaveta_caixa"
  | "escape"
  | "voltar"
  | "tela_cheia";

export type AtalhoPdvItem = {
  id: IdAcaoAtalhoPdv;
  tecla: string;
  rotuloCurto: string;
  descricao: string;
  alternativaNavegador?: string;
  exibirNaBarra: boolean;
  roteiroTeste: string;
};

export const FORMAS_ATALHO_ALT: {
  digito: "1" | "2" | "3" | "4" | "5" | "6";
  forma: "dinheiro" | "pix" | "credito" | "debito" | "boleto" | "prazo";
  rotulo: string;
}[] = [
  { digito: "1", forma: "dinheiro", rotulo: "Dinheiro" },
  { digito: "2", forma: "pix", rotulo: "PIX" },
  { digito: "3", forma: "credito", rotulo: "Crédito" },
  { digito: "4", forma: "debito", rotulo: "Débito" },
  { digito: "5", forma: "boleto", rotulo: "Boleto" },
  { digito: "6", forma: "prazo", rotulo: "Prazo" },
];

export const ATALHOS_PDV: readonly AtalhoPdvItem[] = [
  {
    id: "ajuda",
    tecla: "F1",
    rotuloCurto: "Ajuda",
    descricao: "Abre a lista completa de atalhos e dicas do navegador.",
    alternativaNavegador: "Botão Ajuda (F1) na barra superior",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F1 no PDV e confirmar abertura do modal com todos os atalhos.",
  },
  {
    id: "bipagem",
    tecla: "F2",
    rotuloCurto: "Bipagem",
    descricao: "Volta o foco imediatamente para o campo de busca / leitor de código de barras.",
    exibirNaBarra: true,
    roteiroTeste: "Clicar em outro campo, pressionar F2 e confirmar foco no campo de bipagem.",
  },
  {
    id: "multiplicador_qtd",
    tecla: "X + Qtd",
    rotuloCurto: "Multiplicar",
    descricao:
      "Com o campo de bipagem vazio, pressione X, digite a quantidade (ex.: 5 ou 1,5 p/ pesáveis) e Enter para armar o próximo item.",
    alternativaNavegador:
      "Esc cancela o multiplicador sem apagar itens; para buscar produto iniciado por X, continue digitando o nome normalmente",
    exibirNaBarra: true,
    roteiroTeste: "No campo vazio, teclar X, 5, Enter, ver 'Próximo item × 5' e bipar um produto.",
  },
  {
    id: "documentos",
    tecla: "F3",
    rotuloCurto: "Documentos",
    descricao: "Abre a busca paginada de vendas, notas fiscais e DAVs no servidor.",
    alternativaNavegador: "Botão Documentos (F3) na barra superior",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F3 e buscar uma nota por chave com e sem espaços.",
  },
  {
    id: "desconto",
    tecla: "F4",
    rotuloCurto: "Desconto",
    descricao: "Leva o cursor direto para o campo de desconto (R$ ou %).",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F4, digitar valor de desconto e confirmar abatimento no total.",
  },
  {
    id: "cancelar_venda",
    tecla: "F6",
    rotuloCurto: "Cancelar venda",
    descricao: "Abre confirmação para esvaziar todos os itens da venda atual.",
    alternativaNavegador: "Botão Cancelar venda na lista de itens (caso o navegador foque a barra de URL)",
    exibirNaBarra: true,
    roteiroTeste: "Com itens na venda, pressionar F6, confirmar no modal e verificar limpeza.",
  },
  {
    id: "consultar_preco",
    tecla: "F7",
    rotuloCurto: "Preço",
    descricao: "Consulta preço, saldo em estoque, NCM/CSOSN e tributos (IBS/CBS/ICMS) sem adicionar à venda.",
    alternativaNavegador: "Botão Preço (F7) na barra superior",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F7, bipar ou buscar um produto e fechar com Esc confirmando que a venda não mudou.",
  },
  {
    id: "cliente",
    tecla: "F8",
    rotuloCurto: "Cliente",
    descricao: "Abre a identificação de cliente por nome, CPF ou CNPJ.",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F8, selecionar um cliente cadastrado e confirmar vínculo na venda.",
  },
  {
    id: "venda_espera",
    tecla: "F9",
    rotuloCurto: "Espera",
    descricao: "Suspende a venda atual em espera no caixa ou retoma um atendimento suspenso sem perder itens.",
    alternativaNavegador: "Botão Espera (F9) na barra superior",
    exibirNaBarra: true,
    roteiroTeste: "Com itens na venda, pressionar F9, suspender o atendimento e retomá-lo em seguida.",
  },
  {
    id: "finalizar",
    tecla: "F10",
    rotuloCurto: "Finalizar",
    descricao:
      "Abre a finalização 100% por teclado: setas ← → ↑ ↓ e Enter escolhem pagamento, modelo (NFC-e/NF-e/SAT) e ação (1 DAV, 2 Sem nota, 3 Emitir).",
    alternativaNavegador: "Teclas rápidas 1, 2 e 3 selecionam DAV, Sem nota ou Emissão fiscal; Alt+1..6 escolhem a forma",
    exibirNaBarra: true,
    roteiroTeste: "Pressionar F10, navegar só com setas ← → ↑ ↓ entre formas de pagamento e DAV/Sem nota/NFC-e e confirmar com Enter.",
  },
  {
    id: "remover_ultimo",
    tecla: "Del",
    rotuloCurto: "Remove último",
    descricao: "Remove o último item da venda sem travar o caixa (permite desfazer com Ctrl+Z).",
    alternativaNavegador: "Ctrl+Z desfaz a remoção imediatamente",
    exibirNaBarra: true,
    roteiroTeste: "Fora de campos de texto, pressionar Delete para remover o último item e Ctrl+Z para restaurar.",
  },
  {
    id: "desfazer_item",
    tecla: "Ctrl+Z",
    rotuloCurto: "Desfazer item",
    descricao: "Restaura o último item removido pela tecla Del.",
    exibirNaBarra: false,
    roteiroTeste: "Após remover um item com Del, pressionar Ctrl+Z e confirmar restauração.",
  },
  {
    id: "formas_pagamento",
    tecla: "Alt+1..6",
    rotuloCurto: "Pagamentos",
    descricao: "1 Dinheiro · 2 PIX · 3 Crédito · 4 Débito · 5 Boleto · 6 Prazo.",
    alternativaNavegador: "Ctrl+Alt+1..6 ou botões numerados [1] a [6] na coluna de pagamento",
    exibirNaBarra: true,
    roteiroTeste: "Com itens na venda, pressionar Alt+1..Alt+6 e verificar seleção da forma de pagamento.",
  },
  {
    id: "gaveta_caixa",
    tecla: "Alt+G",
    rotuloCurto: "Gaveta",
    descricao: "Registra Suprimento (reforço de troco) ou Sangria (retirada) sem sair da tela cheia do PDV.",
    alternativaNavegador: "Botão Caixa # / Gaveta na barra superior",
    exibirNaBarra: true,
    roteiroTeste: "Com caixa aberto, pressionar Alt+G, lançar sangria ou suprimento e verificar saldo atualizado.",
  },
  {
    id: "escape",
    tecla: "Esc",
    rotuloCurto: "Limpa busca / fecha modal",
    descricao: "Fecha modal aberto, cancela edição de quantidade ou limpa só o texto da busca. Nunca apaga a venda.",
    alternativaNavegador: "Em tela cheia, o navegador usa o primeiro Esc para sair da tela cheia",
    exibirNaBarra: true,
    roteiroTeste: "Com 3 itens na venda, pressionar Esc no campo de busca e confirmar que os 3 itens permanecem.",
  },
  {
    id: "voltar",
    tecla: "Alt+←",
    rotuloCurto: "Voltar",
    descricao: "Retorna ao painel do ERP (pede confirmação com 3 opções se houver itens na venda).",
    alternativaNavegador: "Botão ← Voltar no canto superior esquerdo",
    exibirNaBarra: false,
    roteiroTeste: "Com itens na venda, acionar ← Voltar e validar as 3 saídas do modal.",
  },
  {
    id: "tela_cheia",
    tecla: "Alt+Enter",
    rotuloCurto: "Tela cheia",
    descricao: "Alterna a tela cheia do navegador e grava preferência em nkway.pdv.telaCheia.",
    alternativaNavegador: "F11 (padrão do navegador) ou botão Tela cheia no topo",
    exibirNaBarra: false,
    roteiroTeste: "Ativar Tela cheia, reabrir /pdv e confirmar o aviso de clique para entrar.",
  },
] as const;
