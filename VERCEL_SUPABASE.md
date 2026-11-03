# NKWAY — estado oficial Vercel + Supabase

**Atualizado em:** 2026-11-03 (rota de agendamento `/api/dfe/dist` restaurada no código; infraestrutura inalterada)  
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

Definidas em `src/db/schema.ts`: `nk_empresa`, `nk_usuario`, `nk_produto`, `nk_cliente`, `nk_fornecedor`, `nk_venda`, `nk_venda_item`, `nk_movimento`, `nk_entrada`, `nk_conta`, `nk_mdfe`, `nk_devolucao`, `nk_inutilizacao`, `nk_evento_fiscal`, `nk_auditoria`, `nk_caixa_sessao`, `nk_caixa_movimento`, `nk_assinatura`, `nk_assinatura_fatura` (migrações SQL aditivas em `supabase/migrations/2026110*.sql` e auto-aplicação idempotente em `src/db/migracao.ts`).

Regras:

1. Nunca apagar tabelas legadas.
2. Não executar `supabase/schema.sql` novamente para a versão Next.
3. Não rodar `drizzle-kit push --force` sem o filtro `--tablesFilter="nk_*"` no Supabase existente.
4. Alterações futuras de schema exigem backup, revisão e preservação do legado.
5. Migração planejada dos dados legados para `nk_*` disponível em `/migracao` (somente leitura `SELECT` nas tabelas antigas + simulação Dry-Run + importação idempotente auditada, preservando 100% do legado).

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

- Produto: todas as pendências funcionais da seção 6 de `CONTEXTO_ARENA.md` estão concluídas (incluindo DF-e em `/dfe` e Assinatura com Gateway por CNPJ em `/assinatura`).
- Infraestrutura: criar/confirmar `AUTH_SECRET` forte; para migrar dados do protótipo antigo, usar o assistente `/migracao` (lê tabelas legadas por CNPJ/e-mail ou arquivo `.json` de backup com simulação Dry-Run antes de gravar).
- Variáveis opcionais de Assinatura (servidor Vercel, quando ativar cobrança `live`): `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_AMBIENTE` (`producao` ou `sandbox`) ou `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` / `BILLING_WEBHOOK_SECRET` (webhook em `/api/assinatura/webhook`; sem elas opera em Sandbox Homologação seguro).
- Variáveis opcionais do Emissor Fiscal de Saída (`/emissor`, servidor Vercel quando ativar SEFAZ `live`): `EMISSOR_FISCAL_PROVIDER` (`focusnfe` | `nuvemfiscal` | `webhook_custom`), `EMISSOR_FISCAL_URL`, `EMISSOR_FISCAL_TOKEN`, `EMISSOR_WEBHOOK_SECRET` (webhook em `/api/fiscal/webhook`) e opcionalmente `EMISSOR_FISCAL_XML_URL`.
- Variáveis opcionais do módulo `/dfe` (servidor Vercel, quando ativar SEFAZ `live`): `DFE_SECRET`, `DFE_SEFAZ_MODE` (`demo` ou `live`), `DFE_MTLS_WORKER_URL`, `DFE_MTLS_WORKER_SECRET`, `DFE_CRON_SECRET` (para `/api/dfe/dist`), e opcionalmente `DFE_STORAGE_URL` + `DFE_STORAGE_SERVICE_KEY` (bucket privado `certificados-a1`; sem eles o `.pfx` usa o cofre AES-256-GCM integrado). Nenhuma altera `DATABASE_URL`.
- Agendamento DF-e (`GET`/`POST https://nkway.vercel.app/api/dfe/dist`, código em `src/app/api/dfe/dist/route.ts`): responde **401** enquanto `DFE_CRON_SECRET` (ou `CRON_SECRET`) não existir no Vercel — é o estado atual e é seguro. Para ligar: criar `DFE_CRON_SECRET` como Secret, redeploy, e agendar a cada 10 min por **um** caminho: pg_cron + pg_net no Supabase existente (`net.http_post` com header `x-dfe-cron-secret`), cron-job.org/GitHub Actions (`POST` com o mesmo header) ou Vercel Cron (envia `Authorization: Bearer CRON_SECRET`; no plano Hobby só 1 vez ao dia). Passo a passo em `supabase/DFE_ROTEIRO_CONFIG.md` → Fase 7 → Opção 0. Em modo demo a rota não fabrica documentos (só com `{"forcarDemo":true}`); em live processa apenas empresas ativas com A1. Nada disso toca `DATABASE_URL`, tabelas ou senha.
