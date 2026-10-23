# CONTEXTO DO PROJETO NKWAY (leia primeiro)

Instruções para a IA: leia só este arquivo antes de começar. Não adapte nem reescreva a stack. Abra apenas os arquivos necessários para a tarefa.

## 0. Como uma nova conversa localiza este projeto (já no GitHub)

**Memorando de acesso/configuração futura:** arquivo **`MEMORANDO.md`** na raiz (índice de pastas, DF-e, secrets, GitHub Desktop).  
**Roteiro DF-e completo:** `supabase/DFE_ROTEIRO_CONFIG.md`

**Fonte da verdade:** o repositório GitHub abaixo. Tudo o que foi feito e testado nesta fase está (ou deve estar) na branch `main`.

| Item | Valor |
|---|---|
| Repositório | https://github.com/enoquepj/nkway |
| Branch | `main` |
| Arquivo de memória | `CONTEXTO.md` (este arquivo, na raiz) |
| Visibilidade | privado (a IA precisa de token de leitura **ou** o usuário deixa público por um tempo) |

### O que a IA deve fazer ao receber CONTINUAR
1. Clonar `https://github.com/enoquepj/nkway` (branch `main`)
2. Ler **somente** este `CONTEXTO.md` primeiro
3. Restaurar o código no ambiente (seção 2) e rodar `npm run build`
4. Confirmar que existem: `src/erp/Tabela.tsx`, `src/erp/filtros.ts`, `src/erp/FiltroUI.tsx`, filtros em Financeiro/Vendas e listas em Produtos/Clientes/Fornecedores
5. Executar a **seção 7 (Próxima tarefa)** ou o pedido do usuário, abrindo só os arquivos necessários
6. Ao final, atualizar as seções 5, 6 e 7 e orientar o salvamento pelo GitHub Desktop (📦 Baixar projeto), sem pedir comandos git ao usuário

### Mensagem pronta — o usuário cola isto num chat NOVO
```
CONTINUAR NKWAY
Repositório: https://github.com/enoquepj/nkway
Branch: main

1. Clone o repositório e leia SOMENTE CONTEXTO.md e MEMORANDO.md primeiro.
2. Restaure o projeto pela seção 2 do CONTEXTO.md (não adapte a stack).
3. Rode npm run build e confirme que passa.
4. Confirme que estão no código: Tabela.tsx, filtros.ts, FiltroUI.tsx, PDV com pagamento dividido, filtros de Financeiro e Vendas, cadastros em lista.
5. Execute a tarefa da seção 7 (Próxima tarefa), ou a tarefa que eu descrever abaixo.
6. Siga as Preferências do usuário. Não peça comandos git nem "terminal" — use "comando prompt" se precisar citar, e GitHub Desktop com cliques.
7. Ao final, atualize CONTEXTO.md (seções 5–7) e diga como salvar pelo botão 📦 Baixar projeto + GitHub Desktop.

Tarefa agora: (escreva aqui o que quer — ou deixe em branco para seguir a seção 7)
```
Se o repositório estiver privado e a IA não conseguir clonar, o usuário envia um token Fine-grained só de leitura (Contents: Read-only) ou deixa o repo público temporariamente.

## Preferências do usuário (seguir sempre)
- Ao se referir ao terminal do computador do usuário, escrever **comando prompt** (Prompt de Comando do Windows), nunca "terminal"
- O usuário usa o GitHub Desktop: explicar processos só com cliques, sem comandos, a menos que ele peça
- Linguagem simples e um único caminho por vez
- O PC do usuário NÃO tem o Git instalado no comando prompt ('git' não é reconhecido). Nunca peça para ele digitar comandos git
- Salvar no GitHub: botão amarelo 📦 Baixar projeto (.zip) → extrair → copiar para a pasta do repositório → Commit → Push no GitHub Desktop

## 1. Projeto
- Nome: NKWAY, ERP e PDV para pequenos negócios (interface em português)
- Repositório: https://github.com/enoquepj/nkway (branch main)
- Stack: React 19, TypeScript strict, Vite 7, Tailwind 4, Supabase opcional
- Sem arquivo .env o sistema roda em modo demo, com os dados no localStorage
- Dependências além do template: `@supabase/supabase-js`, `fflate` (backup .zip)

## 2. Como restaurar (comando CONTINUAR) · ⚠️ PARA A IA EXECUTAR. O usuário NÃO roda estes comandos
1. git clone https://github.com/enoquepj/nkway /tmp/nkway
2. Copiar tudo para o projeto, exceto .git, *.zip, package.json, package-lock.json e vite.config.ts
3. npm install @supabase/supabase-js@^2.109.0 fflate@0.8.2
4. npm run build (precisa passar sem erros)

## 3. Como salvar · ⚠️ Usuário: GitHub Desktop. IA só se houver token SALVAR
**Usuário (padrão):** botão 📦 Baixar projeto (.zip) → extrair → copiar/substituir na pasta do repo → Summary → Commit to main → Push origin  
**IA (só com token):** atualizar seções 5–7, copiar arquivos, commit, push; nunca gravar o token em arquivo

## 4. Onde fica cada coisa
- src/App.tsx: menu (MENU), navegação e providers. Página nova: criar em src/erp/pages e registrar no MENU e no switch
- src/erp/store.tsx: estado central (useStore): cadastros, vendas, estoque, kardex, financeiro
- src/erp/types.ts: tipos (Produto, Cliente, Venda, DB), seed() e uid()
- src/erp/auth.tsx: contas multiempresa e trial de 14 dias
- src/erp/plan.tsx: planos free, pro e ultra
- src/erp/cloud.ts e src/lib/supabase.ts: modo nuvem
- src/erp/offline.ts, useOffline.ts e StatusConexao.tsx: fila offline
- src/erp/pages/PDV.tsx: frente de caixa. Pagamento dividido + teclado ↑↓/Enter/F10/Esc + busca ao vivo por início do nome
- src/erp/checkout/pdvConfig.ts: interpretarEntrada, buscarProduto, sugerirPorNome
- Venda.pagamentos: divisão; Venda.pagamento = forma de maior valor; valorAPrazo() para boleto/prazo
- src/erp/filtros.ts + FiltroUI.tsx: base de filtros (casaTexto, lerNumero, períodos, useFiltrosSalvos, SelectFiltro, MultiSelectFiltro)
- src/erp/Tabela.tsx: ordenação, paginação, exportar CSV
- Cadastros com lista + filtros: pages/Produtos.tsx, Clientes.tsx, Fornecedores.tsx
- Filtros prontos: pages/Financeiro.tsx, Vendas.tsx, Estoque.tsx · Pendente: Entradas.tsx (Compras)
- pages/Estoque.tsx: abas Posição e Kardex com filtros em caixas; CSV; ajuste de inventário mantido
- pages/Entradas.tsx: abas Lista / XML / Chave SEFAZ / Manual; BuscaProduto por nome; TelaTratamento (vínculo fornecedor↔interno, markup/margem, qtd nota vs entrada, preço); xmlNfe.importarPorChaveSefaz()
- pages/ManutencaoPrecos.tsx: markup, preço, estoque, alteração em massa (% / R$ / markup), arredondamento
- Menu: um único item "Documentos fiscais" (DAV + NF-e na mesma tela Vendas). Removido menu duplicado nfe
- Relatórios: filtros de período/status/tipo/cliente/categoria/pagamento/modelo; abas Vendas, ABC, Clientes, Financeiro, Fiscal, Estoque; pré-visualizar, imprimir e CSV
- FILTROS.md: especificação ✅/➕ por módulo
- src/ContextoViewer.tsx + backupProjeto.ts: botão amarelo Contexto / Backup (.zip)
- Convenção: chaves localStorage com prefixo `nkway.`

## 5. Situação atual
- Build OK (TypeScript strict), 16 módulos em modo demo
- Publicado no GitHub (usuário concluiu Commit + Push / Publish pelo GitHub Desktop; lista local zerada)
- Feito: PDV · filtros · cadastros · Documentos fiscais · Relatórios · Entrada estilo HOTLINE (XML/SEFAZ/manual + tratamento) · Manutenção de preços · backup · CONTEXTO.md
- Pendente: filtros de Compras (Entradas) · campos ➕ do FILTROS.md · apagar .zip duplicado no repo · Supabase
- Atenção: vínculo lançamento ↔ cliente ainda por nome (citaNome); ideal contraparteId
- Repo costuma estar privado: clone na IA exige token de leitura ou repo público temporário

## 6. Histórico (do mais antigo para o mais recente)
1. 2026-10-19: projeto trazido para o arena.ai, build validado, CONTEXTO.md criado
2. 2026-10-19: senha do console trocada por hash (devAuth.ts); botão ContextoViewer
3. 2026-10-19: PDV pagamento dividido, teclado, busca ao vivo, correção "3x"
4. 2026-10-19: FILTROS.md criado
5. 2026-10-19: filtros do Financeiro
6. 2026-10-19: filtros de Vendas
7. 2026-10-19: filtros em caixas de seleção (SelectFiltro / MultiSelectFiltro)
8. 2026-10-19: cadastros em lista + CSV; citaNome; notas de fornecedor por CNPJ
9. 2026-10-20: botão 📦 Baixar projeto (.zip); preferências (comando prompt, GitHub Desktop)
10. 2026-10-20: usuário publicou no GitHub via Desktop (merge do CONTEXTO.md resolvido); mensagem CONTINUAR padronizada na seção 0
11. 2026-10-20: filtros de Estoque (posição: situação/categoria/marca/produto/saldo/valor; kardex: período/tipo/direção/divergências/produto) + ordenação, paginação e CSV
12. 2026-10-20: menu unificado "Documentos fiscais"; Relatórios com filtros, pré-visualização, impressão e CSV (padrão ERP varejo)
13. 2026-10-20: Entrada (XML + manual) e Manutenção de preços (markup, estoque, massa R$/%)
14. 2026-10-20: Entrada estilo HOTLINE — busca produto por nome, importação por chave SEFAZ, tela de tratamento (vínculo, margem/markup, qtd, preço) para XML e SEFAZ

## 7. Próxima tarefa
Filtros de lista em Entradas (status, fornecedor, período, origem XML/manual) e/ou melhorias pedidas pelo usuário
