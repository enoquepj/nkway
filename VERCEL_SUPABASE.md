# NKWAY — estado oficial Vercel + Supabase

**Atualizado em:** 2026-10-31  
**Produção:** https://nkway.vercel.app  
**Health confirmado:** `GET /api/health` → HTTP 200 `{"ok":true}`

## 1. Estado pronto — não refazer

- Next.js 16 App Router publicado no Vercel.
- Build, TypeScript e deploy aprovados.
- PostgreSQL hospedado no projeto Supabase **já existente**.
- Vercel conectado ao Supabase por variável secreta `DATABASE_URL` (pooler, porta 6543).
- Usuário PostgreSQL dedicado `nkway_app` criado para a aplicação; a senha nunca deve ir ao GitHub, docs, prints ou chat.
- Tabelas Next `nk_*` criadas no schema `public`, sem RLS por enquanto, porque o acesso é server-side e o tenant é filtrado por `empresa_id`.
- Tabelas legadas sem prefixo permanecem preservadas no mesmo Supabase para migração futura.
- Login e cadastro da empresa funcionam em produção.

**Regra para nova conversa:** não criar outro Supabase, não recomendar Neon, não redefinir senha, não recriar tabelas e não alterar Vercel/Supabase sem uma tarefa explícita ou falha comprovada no health.

## 2. Arquitetura atual

```text
Navegador
  → Vercel / Next.js (Server Components + Server Actions)
  → Drizzle ORM + node-postgres
  → DATABASE_URL secreta
  → Supabase PostgreSQL existente / pooler 6543
  → tabelas nk_* por empresa_id
```

- Login do Next: `nk_usuario` + cookie assinado em `src/lib/session.ts`.
- `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` são do protótipo antigo; podem existir no Vercel, mas a versão Next não as lê e elas não interferem.
- A versão Next não usa `@supabase/supabase-js` nem Supabase Auth no fluxo principal.

## 3. Dois conjuntos de tabelas

### Legado preservado

`empresas`, `usuarios`, `produtos`, `clientes`, `vendas`, `lancamentos`, `nfe_entrada`, `config_fiscal`, `empresas_config`, `erp_estados` e views.

### Next/Drizzle em produção

Definidas em `src/db/schema.ts`: `nk_empresa`, `nk_usuario`, `nk_produto`, `nk_cliente`, `nk_fornecedor`, `nk_venda`, `nk_venda_item`, `nk_movimento`, `nk_entrada`, `nk_conta`, `nk_mdfe`, `nk_devolucao`, `nk_inutilizacao`, `nk_evento_fiscal`.

Regras:

1. Nunca apagar tabelas legadas.
2. Não executar `supabase/schema.sql` novamente para a versão Next.
3. Não rodar `drizzle-kit push --force` sem o filtro `--tablesFilter="nk_*"` no Supabase existente.
4. Alterações futuras de schema exigem backup, revisão e preservação do legado.
5. Migração dos dados legados para `nk_*` é tarefa separada e ainda pendente.

## 4. Vercel

Configuração versionada:

- `vercel.json`: framework `nextjs`, build `npm run build`, output `.next`.
- `tsconfig.json`: exclui sobras Vite que quebram o build.
- `src/db/index.ts`: conexão PostgreSQL preguiçosa para não derrubar a coleta de páginas.

Variáveis:

- `DATABASE_URL`: Secret Production; URI do pooler Supabase na porta 6543 com usuário da aplicação.
- `AUTH_SECRET`: deve ser Secret forte antes de operação comercial.
- `NKWAY_SEED`: ausente/on habilita demo; `off` desliga.
- Variáveis `VITE_*`: legado, ignoradas pelo Next.

Nunca mostrar o campo Valor. Se uma senha aparecer em print/chat, rotacioná-la e atualizar o Vercel.

## 5. Aceite rápido

Antes de investigar qualquer problema de infraestrutura:

1. Abrir `https://nkway.vercel.app/api/health`.
2. Esperado: HTTP 200 e `{"ok":true}`.
3. Abrir `/login` e confirmar acesso.
4. Só se health falhar: olhar Vercel Runtime Logs, sem refazer projeto/banco.

Login demo (enquanto seed estiver ativo): `demo@nkway.com.br` / `nkway123`.

## 6. Próximos trabalhos

- Produto: seguir pendências em `CONTEXTO_ARENA.md`, seção 6.
- Infraestrutura: criar/confirmar `AUTH_SECRET` forte e planejar migração do legado para `nk_*`.
- DF-e real: usar `supabase/DFE_ROTEIRO_CONFIG.md` (A1, worker mTLS e secrets) sem alterar a conexão normal do ERP.
