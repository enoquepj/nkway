# NKWAY — estado oficial Vercel + Supabase

**Atualizado em:** 2026-11-05  
**Produção:** https://nkway.vercel.app  
**Health confirmado em 2026-11-05:** `GET /api/health` → HTTP 200 `{"ok":true}`

Na retomada, o `main` consultado era `ec4f01b`; seu código Next é o mesmo da base `c719aac`. O baseline foi executado em prévia e banco **locais** (smoke 36/36, diagnóstico 219/219, 16 cenários de caixa e 196 chamadas de ações sem erro 500). Em produção, nesta retomada, foi verificado somente o health, sem teste autenticado e sem alterar Vercel, Supabase, conexão ou segredos.

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
6. **Coluna aditiva do motor de caixa:** `nk_venda.status_comercial text` (`supabase/migrations/20261105_caixa_operacao_economica.sql`), anulável e sem default. Aplicada automaticamente por `src/db/migracao.ts` (`add column if not exists`), sem `UPDATE`, sem converter DAV legado, sem nova tabela, sem RLS e sem tocar em `DATABASE_URL`. Confirmado no boot: coluna presente, registros antigos com NULL.

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

- **Relatórios gerenciais de PDV:** entrega local em `/dashboard/relatorios/pdv` e `GET /api/relatorios/pdv`, pendente de publicação para chegar à produção. Gerente/administrador verificados no servidor, consulta da empresa da sessão, paginação Drizzle e CSV seguro. Não há nova tabela, RLS, SDK Supabase, variável de ambiente ou alteração da conexão. Dados não registrados aparecem como indisponíveis; detalhes em `CONTEXTO_ARENA.md` item 21.
- **Correção de segurança do fechamento cego:** implementada e testada localmente, ainda pendente de publicação. A homologação é exigida por modalidade, inclusive com total líquido zero; `/caixa` não envia esperados de turnos abertos ao navegador. Snapshot, homologação, logs, recolhimento e auditoria são gravados juntos. Turnos antigos não foram modificados. Até publicar e validar o deploy, não presumir que a produção está corrigida. Detalhes e limites no item 22 de `CONTEXTO_ARENA.md`.
- **Dependências:** o `npm audit` identificou alertas na base existente, incluindo um crítico no Next; avaliar correção e compatibilidade em tarefa separada. Nenhuma atualização automática da stack foi aplicada nesta entrega.
- Produto: todas as pendências funcionais da seção 6 de `CONTEXTO_ARENA.md` estão concluídas (incluindo DF-e em `/dfe`, Assinatura com Gateway por CNPJ em `/assinatura` e Migração planejada em `/migracao`). A tela `/prontidao` (`GET /api/prontidao` para checagem por máquina) consolida o que está pronto e o que depende só de chaves externas; mostra apenas nomes de variáveis, booleanos e contagens — nenhum valor de Secret sai do servidor.
- **Não confundir:** DF-e real (A1 + worker mTLS + bucket privado/cofre), assinatura com gateway e migração do legado são código **já entregue**. O que resta é configurar as chaves abaixo quando a operação live começar; health ok não autoriza mexer na conexão.
- Reparo de baseline: a rota de cron `GET|POST /api/dfe/dist` estava documentada, mas ausente no `main`; foi restaurada com autenticação por `DFE_CRON_SECRET`/`CRON_SECRET` (401 sem segredo) e está coberta pelo `smoke.sh`.
- **Etapa 0 (alinhamento sem retrocesso):** a Arena foi alinhada ao `main` `ffa115c` — núcleo único em `src/server/caixaCore.ts` + `src/lib/caixa.ts`, suíte `scripts/testar-caixa-motor.mjs` e diagnóstico com 219 verificações (`cx-1..cx-26`). Aposentados somente `src/lib/operacaoCaixa.ts` e `scripts/testar-motor-caixa.mjs`, sem perda de lógica ou testes. Preservados a Central de prontidão, `/api/dfe/dist`, a coluna aditiva `status_comercial`, os espelhos de entrega e os documentos. **Nenhuma alteração de Vercel, Supabase, `DATABASE_URL`, RLS ou segredos.**
- **Etapa 1 (produto, sem infraestrutura):** perfil `gerente` com `caixa.homologar` / `caixa.auditoria` em `src/lib/permissoes.ts` (checagem server-side por `exigirPermissao()`, sem RLS/JWT client-side). Migração **aditiva** `supabase/migrations/20261106_caixa_quebra_aprovacao.sql`: tabela `nk_caixa_quebra_log` e colunas `status_aprovacao`, `homologado_por_usuario_id`, `fundo_troco` em `nk_caixa_sessao`, auto-aplicadas por `src/db/migracao.ts` com `IF NOT EXISTS`. Nenhum `UPDATE` em dados existentes, nenhuma tabela legada tocada, `DATABASE_URL` intacta.
- **Etapa 2 (produto, sem infraestrutura):** constantes de gaveta (R$ 800 / bloqueio em 120% / fundo de troco R$ 100) no motor puro; `obterEstadoGavetaSessao()` devolve só estado/boolean ao PDV; `fecharTurnoCego()` e `homologarQuebraCaixa()` com `exigirPermissao()`, `confereSenha()` e log auditado; blind balance sem valores esperados no cliente. **Etapa 2b (2026), FEITO — correção do ajuste de fechamento.** `ajustarCaixaFechado()` em `src/server/acoes/caixa.ts` **não sobrescreve mais `valoresEsperados` nem `totalEsperado`** (snapshot imutável do fechamento). Apenas `valoresInformados`, `diferencas`, `totalInformado`, `diferencaTotal` e `justificativaFechamento` são atualizados. Nenhuma variável de ambiente nova, nenhuma alteração de Vercel, Supabase, `DATABASE_URL` ou segredos.
- **Etapa 3 (produto, sem infraestrutura):** Modal de Fechamento Cego em React/Tailwind dentro do `/pdv` (inputs vazios, justificativa e PIN de gerente revelados só após o servidor detectar quebra) e nova rota `/dashboard/auditoria-caixa` restrita a `caixa.auditoria`, com esperado × declarado e homologação remota. `/caixa` foi mantido. Nenhuma variável de ambiente, Vercel, Supabase, `DATABASE_URL` ou segredo alterado.
- **Produto:** motor de apuração/fechamento de caixa corrigido (somente backend). A fonte de verdade é `caixa_sessao_id` + `empresa_id`; todas as vendas comerciais válidas entram, DAV orçamento fica fora, DAV concreto entra uma vez e `DAV + nota` é deduplicado por identidade econômica. Pagamentos divididos e troco exclusivo em dinheiro, cancelamentos com estorno único, fechamento em transação e snapshot imutável. Regras e roteiro manual em `CONTEXTO_ARENA.md` → seção 6c. **Nenhuma alteração de Vercel, Supabase, conexão, RLS ou segredos.**
- Infraestrutura: criar/confirmar `AUTH_SECRET` forte; para migrar dados do protótipo antigo, usar o assistente `/migracao` (lê tabelas legadas por CNPJ/e-mail ou arquivo `.json` de backup com simulação Dry-Run antes de gravar).
- Variáveis opcionais de Assinatura (servidor Vercel, quando ativar cobrança `live`): `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_AMBIENTE` (`producao` ou `sandbox`) ou `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` / `BILLING_WEBHOOK_SECRET` (webhook em `/api/assinatura/webhook`; sem elas opera em Sandbox Homologação seguro).
- Variáveis opcionais do Emissor Fiscal de Saída (`/emissor`, servidor Vercel quando ativar SEFAZ `live`): `EMISSOR_FISCAL_PROVIDER` (`focusnfe` | `nuvemfiscal` | `webhook_custom`), `EMISSOR_FISCAL_URL`, `EMISSOR_FISCAL_TOKEN`, `EMISSOR_WEBHOOK_SECRET` (webhook em `/api/fiscal/webhook`) e opcionalmente `EMISSOR_FISCAL_XML_URL`.
- Variáveis opcionais do módulo `/dfe` (servidor Vercel, quando ativar SEFAZ `live`): `DFE_SECRET`, `DFE_SEFAZ_MODE` (`demo` ou `live`), `DFE_MTLS_WORKER_URL`, `DFE_MTLS_WORKER_SECRET`, `DFE_CRON_SECRET` (para `/api/dfe/dist`), e opcionalmente `DFE_STORAGE_URL` + `DFE_STORAGE_SERVICE_KEY` (bucket privado `certificados-a1`; sem eles o `.pfx` usa o cofre AES-256-GCM integrado). Nenhuma altera `DATABASE_URL`.
