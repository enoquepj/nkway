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
- src/erp/pages/PDV.tsx: frente de caixa (cerca de 1.400 linhas)
- src/erp/dev/ e pages/DevConsole.tsx: console do desenvolvedor (Ctrl+Shift+D) e testes
- src/erp/ui.tsx e src/utils/cn.ts: componentes de interface
- supabase/schema.sql: banco multiempresa com RLS
- Convenção: as chaves do localStorage começam com "nkway."
- src/ContextoViewer.tsx: botão amarelo "Copiar CONTEXTO.md" (só para desenvolvimento). Para remover: apagar o arquivo e a linha correspondente em src/main.tsx

## 5. Situação atual
- Build OK, 16 módulos funcionando em modo demo
- Pendente: a senha do console (devAuth.ts) aparece no README e no DEV.md
- Pendente: apagar o arquivo .zip duplicado do repositório
- Pendente: configurar o Supabase

## 6. Histórico
- 2026-10-19: projeto trazido para o arena.ai, build validado, CONTEXTO.md criado

## 7. Próxima tarefa
(escreva aqui o que quer fazer no próximo chat)
