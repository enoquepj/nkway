 HEAD
\# CONTEXTO DO PROJETO NKWAY (leia primeiro)



Instruções para a IA: leia só este arquivo antes de começar. Não adapte nem reescreva a stack. Abra apenas os arquivos necessários para a tarefa.



\## Preferências do usuário (seguir sempre)

\- Ao se referir ao terminal do computador do usuário, escrever \*\*comando prompt\*\* (Prompt de Comando do Windows), nunca "terminal"

\- O usuário usa o GitHub Desktop: explicar processos só com cliques, sem comandos, a menos que ele peça

\- Linguagem simples e um único caminho por vez

\- O PC do usuário NÃO tem o Git instalado no comando prompt ('git' não é reconhecido). Nunca peça para ele digitar comandos git



\## 1. Projeto

\- Nome: NKWAY, ERP e PDV para pequenos negócios (interface em português)

\- Repositório: https://github.com/enoquepj/nkway (branch main)

\- Stack: React 19, TypeScript strict, Vite 7, Tailwind 4, Supabase opcional

\- Sem arquivo .env o sistema roda em modo demo, com os dados no localStorage



\## 2. Como restaurar (comando CONTINUAR) · ⚠️ PARA A IA EXECUTAR. O usuário NÃO roda estes comandos

1\. git clone https://github.com/enoquepj/nkway /tmp/nkway

2\. Copiar tudo para o projeto, exceto .git, \*.zip, package.json, package-lock.json e vite.config.ts

3\. npm install @supabase/supabase-js@^2.109.0 fflate@0.8.2

4\. npm run build (precisa passar sem erros)



\## 3. Como salvar (comando SALVAR + token) · ⚠️ PARA A IA EXECUTAR. O usuário salva pelo GitHub Desktop (botão 📦 Baixar projeto)

1\. Atualizar as seções 5, 6 e 7 deste arquivo

2\. Copiar os arquivos alterados para /tmp/nkway

3\. git add -A, depois git commit -m "resumo"

4\. git push https://TOKEN@github.com/enoquepj/nkway main

5\. Nunca gravar o token em nenhum arquivo. Confirmar ao usuário quais arquivos foram enviados



\## 4. Onde fica cada coisa

\- src/App.tsx: menu (MENU), navegação e providers. Página nova: criar em src/erp/pages e registrar no MENU e no switch

\- src/erp/store.tsx: estado central (useStore): cadastros, vendas, estoque, kardex, financeiro

\- src/erp/types.ts: tipos (Produto, Cliente, Venda, DB), seed() e uid()

\- src/erp/auth.tsx: contas multiempresa e trial de 14 dias

\- src/erp/plan.tsx: planos free, pro e ultra

\- src/erp/cloud.ts e src/lib/supabase.ts: modo nuvem

\- src/erp/offline.ts, useOffline.ts e StatusConexao.tsx: fila offline

\- src/erp/pages/PDV.tsx: frente de caixa (cerca de 1.700 linhas). Pagamento dividido: estados pagamentos/pagMsg, funções calcularRegistro, registrarPagamento, confirmarVenda, enterPagamento, teclaPagRef (teclado). Busca ao vivo: sugestoes/listaBusca/teclaBusca

\- src/erp/checkout/pdvConfig.ts: interpretarEntrada, buscarProduto (Enter) e sugerirPorNome (nome começa com, sem acento/maiúscula)

\- Venda.pagamentos (types.ts) guarda a divisão; Venda.pagamento = forma de maior valor. valorAPrazo() calcula a parte boleto/prazo (vira conta a receber)

\- src/erp/dev/ e pages/DevConsole.tsx: console do desenvolvedor (Ctrl+Shift+D) e testes

\- src/erp/ui.tsx e src/utils/cn.ts: componentes de interface

\- supabase/schema.sql: banco multiempresa com RLS

\- Convenção: as chaves do localStorage começam com "nkway."

\- FILTROS.md: especificação dos filtros de Financeiro, Vendas, Estoque e Compras (✅ campo existe, ➕ campo novo)

\- Filtros: base reutilizável em src/erp/filtros.ts (casaTexto, lerNumero, períodos, useFiltrosSalvos) e src/erp/FiltroUI.tsx (PainelFiltros, BuscaGlobal, LinhaFiltros, SelectFiltro = caixa única, MultiSelectFiltro = caixa com marcação múltipla e contagens, IntervaloFiltro, ChipAtivo). Padrão: filtros principais em caixas de seleção, não em fileiras de botões

\- Tabelas: src/erp/Tabela.tsx (useOrdenacao + ThOrd = ordenar pelo título da coluna, usePaginacao + Paginacao, exportarCsv + BotaoExportar). citaNome() em filtros.ts liga lançamento ↔ cliente ignorando LTDA/ME/acentos

\- Cadastros em lista com filtros: Produtos ✅ · Clientes ✅ · Fornecedores ✅

\- Status dos filtros: Financeiro ✅ · Vendas ✅ (itens ✅ do FILTROS.md) · Estoque ⏳ · Compras ⏳. Nos multi-selects use toggle() do useFiltrosSalvos (seguro para cliques rápidos)

\- src/ContextoViewer.tsx + src/backupProjeto.ts: botão amarelo "Contexto / Backup" (só para desenvolvimento): copia o CONTEXTO.md e baixa o projeto completo em .zip (fflate, import.meta.glob ?raw, UTF-8 nativo). Testado: o .zip recompila o projeto idêntico byte a byte. Para remover: apagar os dois arquivos, a linha em src/main.tsx e a dependência fflate



\## 5. Situação atual

\- Build OK (TypeScript strict sem erros), 16 módulos funcionando em modo demo

\- Feito nesta fase: PDV com pagamento dividido e busca ao vivo · filtros do Financeiro e de Vendas · cadastros em lista com filtros, ordenação, paginação e exportação CSV

\- Pendente: filtros de Estoque e de Compras (ver FILTROS.md)

\- Pendente: campos ➕ do FILTROS.md (ex.: data da baixa e forma de pagamento no Lancamento, operador na Venda)

\- Pendente: apagar o arquivo .zip duplicado do repositório

\- Pendente: configurar o Supabase

\- Atenção: o vínculo lançamento ↔ cliente/fornecedor ainda é pelo nome na descrição (citaNome); o ideal é um campo contraparteId



\## 6. Histórico (do mais antigo para o mais recente)

1\. 2026-10-19: projeto trazido para o arena.ai, build validado, CONTEXTO.md criado

2\. 2026-10-19: senha do console trocada por hash (devAuth.ts) e removida do README, DEV.md e CHECKLIST.md. Botão ContextoViewer adicionado

3\. 2026-10-19: PDV: pagamento dividido (várias formas, saldo, troco), teclado ↑↓/Enter/F10/Esc, valor editável, busca ao vivo por início do nome, correção do "3x" que abria a balança para produto comum. Arquivos: PDV.tsx, pdvConfig.ts, types.ts, store.tsx, Financeiro.tsx, Documento.tsx

4\. 2026-10-19: criado FILTROS.md (especificação de filtros dos 4 módulos, baseada em types.ts)

5\. 2026-10-19: filtros do Financeiro (situação, período, categoria é/não é, faixas de atraso, valor de/até, agrupamento, busca global, filtros salvos). lerNumero aceita "1.000" como milhar (também no PDV)

6\. 2026-10-19: filtros de Vendas (período, situação, forma principal/qualquer parte, cliente, modelo, nº da nota, produto, categoria, exceções, total, horário, agrupamento com ticket médio, busca por chave/CPF/produto, aviso de numeração pulada, marcador de venda na fila offline)

7\. 2026-10-19: filtros principais trocados por caixas de seleção (SelectFiltro / MultiSelectFiltro) no Financeiro e em Vendas

8\. 2026-10-19: cadastros (Produtos, Clientes, Fornecedores) em lista com filtros, ordenação por coluna, paginação, exportar CSV, editar com clique no nome/duplo clique, confirmação ao excluir. Corrigido vínculo cliente ↔ conta a receber com sufixo LTDA (citaNome) e notas de fornecedor ligadas pelo CNPJ

9\. 2026-10-20: botão "📦 Baixar projeto (.zip)" para levar a versão ao GitHub sem token (GitHub Desktop)



\## 7. Próxima tarefa

Implementar os filtros de Estoque e Logística (FILTROS.md) em src/erp/pages/Estoque.tsx, reaproveitando filtros.ts e FiltroUI.tsx


# CONTEXTO DO PROJETO NKWAY (leia primeiro)

Instruções para a IA: leia só este arquivo antes de começar. Não adapte nem reescreva a stack. Abra apenas os arquivos necessários para a tarefa.

## 1. Projeto
- Nome: NKWAY, ERP e PDV para pequenos negócios (interface em português)
- Repositório: https://github.com/enoquepj/nkway (branch main)
- Stack: React 19, TypeScript strict, Vite 7, Tailwind 4, Supabase opcional
- Sem arquivo .env o sistema roda em modo demo, com os dados no localStorage

## 2. Como restaurar (comando CONTINUAR)
1. git clone https://github.com/enoquepj/nkway /tmp/nkway
2. Copiar tudo para o projeto, exceto .git, *.zip, package.json, package-lock.json e vite.config.ts
3. npm install @supabase/supabase-js@^2.109.0
4. npm run build (precisa passar sem erros)

## 3. Como salvar (comando SALVAR + token)
1. Atualizar as seções 5 e 6 deste arquivo
2. Copiar os arquivos alterados para /tmp/nkway
3. git add -A, depois git commit -m "resumo"
4. git push https://TOKEN@github.com/enoquepj/nkway main
5. Nunca gravar o token em nenhum arquivo. Confirmar ao usuário quais arquivos foram enviados

## 4. Onde fica cada coisa
- src/App.tsx: menu (MENU), navegação e providers. Página nova: criar em src/erp/pages e registrar no MENU e no switch
- src/erp/store.tsx: estado central (useStore): cadastros, vendas, estoque, kardex, financeiro
- src/erp/types.ts: tipos (Produto, Cliente, Venda, DB), seed() e uid()
- src/erp/auth.tsx: contas multiempresa e trial de 14 dias
- src/erp/plan.tsx: planos free, pro e ultra
- src/erp/cloud.ts e src/lib/supabase.ts: modo nuvem
- src/erp/offline.ts, useOffline.ts e StatusConexao.tsx: fila offline
- src/erp/pages/PDV.tsx: frente de caixa (cerca de 1.700 linhas). Pagamento dividido: estados pagamentos/pagMsg, funções calcularRegistro, registrarPagamento, confirmarVenda, enterPagamento, teclaPagRef (teclado). Busca ao vivo: sugestoes/listaBusca/teclaBusca
- src/erp/checkout/pdvConfig.ts: interpretarEntrada, buscarProduto (Enter) e sugerirPorNome (nome começa com, sem acento/maiúscula)
- Venda.pagamentos (types.ts) guarda a divisão; Venda.pagamento = forma de maior valor. valorAPrazo() calcula a parte boleto/prazo (vira conta a receber)
- src/erp/dev/ e pages/DevConsole.tsx: console do desenvolvedor (Ctrl+Shift+D) e testes
- src/erp/ui.tsx e src/utils/cn.ts: componentes de interface
- supabase/schema.sql: banco multiempresa com RLS
- Convenção: as chaves do localStorage começam com "nkway."
- FILTROS.md: especificação dos filtros de Financeiro, Vendas, Estoque e Compras (✅ campo existe, ➕ campo novo)
- Filtros: base reutilizável em src/erp/filtros.ts (casaTexto, lerNumero, períodos, useFiltrosSalvos) e src/erp/FiltroUI.tsx (PainelFiltros, BuscaGlobal, LinhaFiltros, SelectFiltro = caixa única, MultiSelectFiltro = caixa com marcação múltipla e contagens, IntervaloFiltro, ChipAtivo). Padrão: filtros principais em caixas de seleção, não em fileiras de botões
- Status dos filtros: Financeiro ✅ · Vendas ✅ (itens ✅ do FILTROS.md) · Estoque ⏳ · Compras ⏳. Nos multi-selects use toggle() do useFiltrosSalvos (seguro para cliques rápidos)
- src/ContextoViewer.tsx: botão amarelo "Copiar CONTEXTO.md" (só para desenvolvimento). Para remover: apagar o arquivo e a linha correspondente em src/main.tsx

## 5. Situação atual
- Build OK, 16 módulos funcionando em modo demo
- Resolvido: a senha do console agora fica só como hash (HASH_PADRAO em devAuth.ts), fora do código e dos documentos
- Pendente: apagar o arquivo .zip duplicado do repositório
- Pendente: configurar o Supabase

## 6. Histórico
- 2026-10-19: projeto trazido para o arena.ai, build validado, CONTEXTO.md criado
- 2026-10-19: filtros principais trocados por caixas de seleção (Vencimento/Período, Situação, Categoria, Pagamento, Cliente e avançados) no Financeiro e em Vendas
- 2026-10-19: filtros de Vendas (período, situação, forma principal/qualquer parte, cliente, modelo, nº da nota, produto, categoria, exceções, total, horário, agrupamento com ticket médio, busca por chave/CPF/produto, aviso de numeração pulada, marcador de venda na fila offline)
- 2026-10-19: filtros do Financeiro (situação, período, categoria é/não é, faixas de atraso, valor de/até, agrupamento, busca global, filtros salvos). lerNumero aceita "1.000" como milhar (também no PDV)
- 2026-10-19: criado FILTROS.md (especificação de filtros dos 4 módulos, baseada em types.ts)
- 2026-10-19: PDV: pagamento dividido (várias formas, saldo, troco), teclado ↑↓/Enter/F10/Esc, valor editável, busca ao vivo por início do nome, correção do "3x" que abria a balança para produto comum. Arquivos: PDV.tsx, pdvConfig.ts, types.ts, store.tsx, Financeiro.tsx, Documento.tsx, CHECKLIST.md
- 2026-10-19: senha do console trocada por hash (devAuth.ts) e removida do README, DEV.md e CHECKLIST.md. Botão ContextoViewer adicionado

## 7. Próxima tarefa
Implementar os filtros de Estoque e Logística (FILTROS.md) em src/erp/pages/Estoque.tsx, reaproveitando filtros.ts e FiltroUI.tsx
cd3cd2c3e904a0b0cd0176433f33441aeaa8a872
