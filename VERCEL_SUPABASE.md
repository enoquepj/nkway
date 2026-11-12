# NKWAY — estado oficial Vercel + Supabase

**Base desta retomada:** `main` `a16fe24` (`PDV_ofline`, 2026-11-09)  
**Produção:** https://nkway.vercel.app  
**Produção reconferida em 2026-11-12:** `GET /api/health` → HTTP 200 `{"ok":true}` com `X-NKWAY-Commit: a16fe24db9261bda69b0e57103e6884cdc46845a` e `X-NKWAY-Ambiente: production`; `GET /api/versao` → HTTP 200 `{"identificado":true,"commit":"a16fe24…","ambiente":"production","origem":"vercel"}`

O `main` consultado é `a16fe24` e já contém NCM (etapa 1), CEST (etapa 2), perfil no cadastro (etapa 3), seletores/CFOP, DIVERGE, menu, estoque, PDV offline e carga das tabelas. O baseline passou em prévia e banco **locais** (tipos, build, smoke 55/55, diagnóstico 228/228, motor 17, relatórios 50, fechamento cego 58, NCM + CEST + offline 11 + estoque 11 + tabelas, e 210 chamadas de ações sem erro 500). A identificação de deploy está publicada e comprovada em produção. Não houve teste autenticado fiscal em produção nesta sessão; o aceite contábil/SEFAZ continua pendente. Nenhuma alteração de Vercel, Supabase, conexão ou segredos.

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
2. Esperado: HTTP 200 e `{"ok":true}` com `X-NKWAY-Commit` e `X-NKWAY-Ambiente`.
3. Abrir `/api/versao` e comparar o SHA completo com o commit publicado (em 2026-11-12: `a16fe24db9261bda69b0e57103e6884cdc46845a`, `production`). O JSON do health permanece igual. API ausente ou commit não identificado não são falhas da conexão.
4. Abrir `/login` e confirmar acesso; em `/prontidao`, usar **Conferir publicação** com o SHA completo. A conferência checa primeiro o health e não homologa regras fiscais nem substitui o teste das rotas autenticadas.
5. Só se health falhar: olhar Vercel Runtime Logs, sem refazer projeto/banco.

Login demo (enquanto seed estiver ativo): `demo@nkway.com.br` / `nkway123`.

## 6. Próximos trabalhos

- **Lock do Next (2026-11-09):** o `main` `6e64928` pede `next ^16.4.5` no manifesto, mas o `package-lock.json` publicado ainda resolve 16.2.6 (`npm ci` falha por dessincronia). Este pacote sincroniza o lock e alinha `eslint-config-next`/`postcss`. Sem mudança de variáveis, Vercel ou Supabase.

- **Consolidação a16fe24 (2026-11-12):** o `main` atual já contém as etapas 1 (NCM, `8186ae1`), 2 (CEST) e 3 (perfil no cadastro, ambas em `bf2931d`), seletores/CFOP, DIVERGE, menu, estoque, PDV offline e carga das tabelas. Produção comprovada no mesmo commit via `/api/health` + `/api/versao`. Baseline local verde (smoke 55/55, diagnóstico 228/228, ações 210/0). Próxima tarefa é a etapa 4 geral (aceite contábil + homologação SEFAZ/provedor + chaves live); não reabrir etapas sem falha comprovada.
- **NCM oficial — etapa 1 (código no `main` `8186ae1`, produção `a16fe24` comprovada):** consulta em Produtos e `/api/fiscal/ncm` autenticada; fonte oficial da Receita validada separadamente por download real. Só a seleção explícita muda o NCM do rascunho. Cache persistente por empresa em `nk_catalogo_ncm` (aditiva, idempotente), limite/paginação, datas distintas, timeout e proteção de concorrência; preenchimento manual auditável sem declarar código oficialmente validado. Em falha, mantém última cópia íntegra. Rollback lógico mantém tabela/auditorias. Detalhes: `FISCAL_PRODUTOS.md` e item 27 de `CONTEXTO_ARENA.md`.
- **CEST etapa 2 + perfil etapa 3 (código no `main` `bf2931d`, produção `a16fe24` comprovada):** CEST é referência **local por empresa** (`nk_catalogo_cest`, aditiva) com proveniência declarada — CONFAZ publica só em PDF, sem fonte estruturada adotada, sem seleção automática. Perfil no cadastro com seleção ≠ aplicação, prévia antes/depois no servidor e NCM/CEST preservados por padrão. Detalhes em `FISCAL_PRODUTOS.md` e item 41 de `CONTEXTO_ARENA.md`.
- **Identificação segura de deploy (código no `main`, produção `a16fe24` comprovada):** API pública `/api/versao`, cabeçalhos `X-NKWAY-Commit`/`X-NKWAY-Ambiente` no health (JSON e status preservados), DTO em `/api/prontidao` e conferência em `/prontidao`. Somente SHA completo e ambiente de sistema da Vercel, sem cache, sem banco na nova API e sem valores de segredos. Identificar o commit não comprova homologação fiscal. Referência oficial: https://vercel.com/docs/environment-variables/system-environment-variables.
- **Parametrização fiscal de produtos (código desde `cf0200d`, produção `a16fe24` comprovada no commit):** rota `/config/fiscal/produtos` com códigos e perfis por empresa. Migração aditiva (`nk_fiscal_parametro`, `nk_produto_tributacao`); sem atualização automática de produtos antigos. Emissão recebe parâmetros no contrato canônico, mas cálculos e mapeamento do provedor exigem homologação. IBS/CBS parcial; sem apuração integral de IRPJ/CSLL. Detalhes em `FISCAL_PRODUTOS.md` e item 25 de `CONTEXTO_ARENA.md`.
- **Central e impressão de relatórios:** código no `main` `e78d44c`; health isolado não identifica o commit ativo em produção. Uma entrada `/relatorios` reúne gerais/documentos e PDV, preservando visões distintas; `/dashboard/relatorios/pdv/imprimir` revalida sessão, permissão e tenant, imprime a tabela filtrada em A4 e limita a 10.000 linhas. Sem mudança de banco, RLS ou variáveis. Detalhes no item 24 de `CONTEXTO_ARENA.md`.
- **Reparo de build versionado no main:** o deploy do `main` `43a8e4b` falhou por incluir a cópia antiga `ENTREGA_GITHUB` na verificação TypeScript. A correção no `main` `dd9f0cd` exclui os diretórios de entrega no `tsconfig.json`, sem desativar a verificação da aplicação. O aplicador histórico foi bloqueado para evitar sobrescrever o caixa atual. O `package-lock.json` também foi sincronizado com as dependências já declaradas, pois uma instalação limpa falhava; o manifesto não foi alterado nesta correção. O clone completo passou em instalação limpa, geração de tipos, TypeScript e build com o espelho presente. O health do deploy anterior continua `ok:true`; não houve alteração de conexão, banco, RLS ou segredos. Detalhes no item 23 de `CONTEXTO_ARENA.md`.
- **Relatórios gerenciais de PDV:** código no `main` `dd9f0cd` em `/dashboard/relatorios/pdv` e `GET /api/relatorios/pdv`; health isolado não identifica o commit ativo. Gerente/administrador verificados no servidor, consulta da empresa da sessão, paginação Drizzle e CSV seguro. Não há nova tabela, RLS, SDK Supabase, variável de ambiente ou alteração da conexão. Dados não registrados aparecem como indisponíveis; detalhes em `CONTEXTO_ARENA.md` item 21.
- **Correção de segurança do fechamento cego:** código no `main` `dd9f0cd`, testado localmente; health não identifica o commit ativo. A homologação é exigida por modalidade, inclusive com total líquido zero; `/caixa` não envia esperados de turnos abertos ao navegador. Snapshot, homologação, logs, recolhimento e auditoria são gravados juntos. Turnos antigos não foram modificados. Até publicar e validar o deploy, não presumir que a produção está corrigida. Detalhes e limites no item 22 de `CONTEXTO_ARENA.md`.
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

## 7. Atualização de segurança do Next.js (avaliada em 2026-11-09)

- `npm audit` marcava `next@16.2.6` como **crítico** (faixa afetada `9.3.4-canary.0 - 16.4.0`, incluindo RCEs não autenticados: GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4, GHSA-vcvr-r3jv-pc5j, GHSA-673q-mjm6-r5xr etc.).
- Versão corrigida mais próxima segundo o próprio npm: `fixAvailable = next@16.4.5, isSemVerMajor: false` (`latest` = 16.4.5; 16.5.x é canary e não foi usado). Peer `react ^19.0.0` atendido pelo react 19.2.6; `node >=20.9.0` atendido.
- Compatibilidade: mesma major 16; `next.config.ts` vazio e sem flag `cacheComponents`, portanto o 16.4 não ativa Cache Components neste app (padrão só para create-next-app; vira padrão no Next 17). Sem mudança de API usada (`next typegen`, App Router, server actions, instrumentation).
- Aplicado via ferramenta de instalação de pacotes (sem editar `package.json` à mão): `next` 16.2.6 → 16.4.5, manifesto e `package-lock.json` sincronizados. Após a troca, `npm audit` não reporta mais `next` e há **0 críticos** (restam 21 não críticos preexistentes, majoritariamente dev/transitivos).
- Validação completa após a troca: `next typegen`, `tsc --noEmit`, `npm run build`, `build_and_start`, `smoke.sh --sem-build` 51/51 (diagnóstico 226/226) e `acoes.sh` 206 chamadas sem erro 500 — tudo verde.
- Pendências de dependência (não urgentes, avaliar separadamente, sem `audit fix --force`): `eslint-config-next@16.2.6` (moderado, correção só em outra major segundo o audit) e transitivos de dev (postcss, sharp, js-yaml, nanoid, brace-expansion, browserslist, source-map-js, zod).
- Nenhuma alteração de Vercel, Supabase, conexão, banco, RLS ou segredos. Publicação no Vercel ocorre ao publicar o commit (ver `/api/versao` após o deploy).
