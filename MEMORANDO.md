# MEMORANDO — Acesso aos arquivos e configurações futuras (NKWAY)

**Objetivo:** em qualquer momento (você, TI, contador ou um chat novo de IA), saber **onde está** cada instrução e **o que fazer** sem recomeçar do zero.

**Repositório:** https://github.com/enoquepj/nkway · branch `main`  
**Base desta retomada:** `main` `a16fe24` (`PDV_ofline`; NCM, CEST, perfil no cadastro, seletores/CFOP, DIVERGE, menu, estoque, PDV offline e carga das tabelas já versionados). Produção comprovada no mesmo commit em 2026-11-12.

Nesta retomada, o health de produção respondeu HTTP 200 com `X-NKWAY-Commit: a16fe24…`/`production`; `/api/versao` respondeu HTTP 200 identificado no mesmo commit. O baseline do main foi validado em prévia e banco **locais**: tipos, build, smoke 55/55, diagnóstico 228/228, motor 17, relatórios 50, fechamento cego 58 e 210 chamadas de ações sem erro 500. Sem código novo nesta consolidação; sem mudança de schema, ações, dependências ou infraestrutura. Sem teste autenticado fiscal em produção; o aceite contábil/SEFAZ (etapa 4 geral) continua pendente. Detalhes no item 41 de `CONTEXTO_ARENA.md`.

---

## 0. Estado atual em uma linha

**Produção pronta:** `https://nkway.vercel.app` · health HTTP 200 `{"ok":true}` · login/cadastro funcionando · Vercel conectado ao PostgreSQL do Supabase existente. **Não refazer infraestrutura.**

## 1. Ordem de leitura (recomendada para próxima conversa)

| Prioridade | Arquivo | Para quê |
|---|---|---|
| 1º | **`CONTINUAR_NKWAY.txt`** | bloco pronto para colar na nova conversa |
| 2º | **`VERCEL_SUPABASE.md`** | estado oficial da produção e regras de segurança |
| 3º | **`CONTEXTO_ARENA.md`** | mapa do Next e pendências do produto |
| 4º | **`MEMORANDO.md`** (este) | índice dos documentos e configurações |
| 5º | **`supabase/DFE_ROTEIRO_CONFIG.md`** | ler apenas quando a tarefa for DF-e/A1 |
| 6º | `CONTEXTO.md` e demais `.md` | legado/histórico; abrir só se a tarefa exigir |

---

## 2. Configurações críticas — onde estão

### 2.0 Produção atual — não refazer

| Item | Estado |
|---|---|
| Site | `https://nkway.vercel.app` |
| Health | `GET /api/health` = HTTP 200 `{"ok":true}` com `X-NKWAY-Commit`/`X-NKWAY-Ambiente`; produção `a16fe24`/`production` comprovada em 2026-11-12 |
| Identificação de deploy | Código no `main` e comprovado em produção: `GET /api/versao` (200, identificado), cabeçalhos do health e conferência em `/prontidao`. Sem metadados locais, informa não identificado; não altera variáveis. |
| Parametrização fiscal de produtos | Código no `main` desde `cf0200d`; commit de produção comprovado (`a16fe24`); homologação fiscal segue pendente de aceite contábil/SEFAZ. |
| Consulta oficial NCM — etapa 1 | Código no `main` (`8186ae1`): Produtos → Consultar NCM; API `/api/fiscal/ncm`; cache `nk_catalogo_ncm` por empresa, atualização administrativa explícita, integridade preservada em falhas. Sem certificação automática do enquadramento. |
| CEST assistido — etapa 2 | Código no `main` (`bf2931d`): referência local por empresa (`nk_catalogo_cest`, proveniência declarada); sem tabela oficial inventada, sem seleção automática. API `/api/fiscal/cest` + `ConsultaCest.tsx`; `fis-14`. |
| Perfil no cadastro — etapa 3 | Código no `main` (`bf2931d`): `PerfilFiscalProduto.tsx` com seleção ≠ aplicação, prévia antes/depois no servidor e NCM/CEST preservados por padrão. Transacional + auditado. |
| App | Next.js 16.4.5 + Drizzle no Vercel (atualizado de 16.2.6 em 2026-11-09 após avaliação do alerta crítico do `npm audit`; validação completa verde) |
| Seletores fiscais | Correção local 2026-11-09: CSTs e cClassTrib como listas com descrição nos perfis/produtos; dados do banco quando carregados, senão instantâneo oficial embutido. Ver `FISCAL_PRODUTOS.md`. |
| Fechamento de caixa | 2026-11-09: valores com ponto/vírgula equivalentes; divergência real é aceita como **DIVERGE** (justificativa obrigatória, gerente opcional; pendente até homologação em Auditoria de Caixa; auditoria crítica). Ver seção 6 de `CONTEXTO_ARENA.md`. |
| Banco | PostgreSQL do Supabase existente, pooler 6543 |
| Acesso do app | `DATABASE_URL` Secret; usuário PostgreSQL dedicado `nkway_app` |
| Tabelas | legado sem prefixo preservado + Next `nk_*` em produção (assistente somente-leitura em `/migracao`) |
| RLS `nk_*` | desativado por enquanto; tenant server-side por `empresa_id` |
| Guia | `VERCEL_SUPABASE.md` |
| Build Vercel e espelhos | A correção consta no main `dd9f0cd`: `tsconfig.json` exclui diretórios de entrega; `scripts/testar-tsconfig-entrega.mjs` valida configuração e lock. O aplicador histórico está bloqueado para não sobrescrever o caixa atual. |
| Motor de caixa e regras de `compoeCaixa` / `operacaoEconomicaId` | `CONTEXTO_ARENA.md` → seção 6c (matriz, exemplos de troco e roteiro manual) |

Regras: não criar outro Supabase, não recomendar Neon, não redefinir senha, não recriar tabelas e não alterar Vercel/banco se `/api/health` estiver ok. Nunca registrar segredo em documentação ou print.

### 2.1 Supabase (nuvem / DF-e / opcional ERP cloud)
| O quê | Onde |
|---|---|
| URL e chave anônima do front | Arquivo **`.env`** na raiz (não vai ao Git) · modelo em **`.env.example`** |
| Variáveis no host | Painel Netlify/Vercel → Environment variables → rebuild |
| Schema ERP multi-tenant | `supabase/schema.sql` |
| **Migration DF-e** (tabelas, RLS, bucket, cron modelo) | `supabase/migrations/20260322_dfe_distribuicao.sql` |
| **Roteiro DF-e** (fases 1–9, aceite, erros) | `supabase/DFE_ROTEIRO_CONFIG.md` |
| Edge Function captura SEFAZ | `supabase/functions/dfe-dist/index.ts` |
| Worker mTLS (A1 real) | `supabase/functions/dfe-dist/sefaz-mtls-worker.mjs` |
| Secrets da function | Dashboard Supabase → Edge Functions → Secrets: `DFE_CRON_SECRET`, `DFE_SECRET`, `DFE_SEFAZ_MODE`, `DFE_MTLS_WORKER_URL`, `DFE_MTLS_WORKER_SECRET` |
| Telas no app (Next.js em produção) | Menu **Compras e estoque → DF-e e Certificado A1** (`/dfe`) + cron `/api/dfe/dist` · código em `src/views/Dfe.tsx`, `src/server/dfeCore.ts`, `src/server/acoes/dfe.ts` (legado Vite preservado em `src/erp/dfe/`) |

**Front (Vite) — só estas no `.env`:**
```env
VITE_SUPABASE_URL=https://SEU_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```
Opcional (bridge antigo por chave pontual): `VITE_NFE_BRIDGE_URL=`

**Nunca no front / nunca no GitHub:** `service_role`, senha do A1, arquivo `.pfx`, secrets `DFE_*`.

### 2.2 Módulos operacionais principais (ERP Next.js em produção)
| O quê | Onde |
|---|---|
| PDV Frente de Caixa em Tela Cheia (`100dvh`, sem `<Shell />`, abertura em fullscreen pelo menu via `LinkPdv`/`abrirPdv.ts`, multiplicador `X + Qtd + Enter`, pagamento dividido + troco em dinheiro + crédito em `pagamentoPdv.ts`, consulta `F7` + espera `F9` + etiqueta balança `2…` em `balcaoPdv.ts`, bobina 80 mm `.print-area` + editar/cancelar em `F3` + gaveta `Alt+G` + fila offline em `operacoesPdv.ts`, navegação 100% por setas no `F10` em `navegacaoFinalizarPdv.ts`, `← Voltar`, `ATALHOS_PDV`) | Rota `/pdv` · `src/app/(pdv)/layout.tsx`, `src/app/(pdv)/pdv/page.tsx`, `src/views/Pdv.tsx`, `src/components/LinkPdv.tsx`, `src/lib/abrirPdv.ts`, `src/lib/multiplicadorPdv.ts`, `src/lib/pagamentoPdv.ts`, `src/lib/balcaoPdv.ts`, `src/lib/operacoesPdv.ts`, `src/lib/navegacaoFinalizarPdv.ts`, `src/lib/atalhosPdv.ts`, `src/lib/situacaoFiscal.ts`, `src/server/acoes/pdv.ts` |
| Entrada de mercadoria (XML, chave SEFAZ, manual, tratamento) | Rota `/entradas` · `src/views/Entradas.tsx` + `src/server/acoes/entradas.ts` + `src/lib/xmlNfe.ts` |
| Emissor Fiscal SEFAZ 4.00, contingência e webhook | Rota `/emissor` + `/api/fiscal/webhook` · `src/views/EmissorFiscal.tsx` + `src/server/emissorFiscalCore.ts` |
| PDV e impressão configuráveis (Etapa 1) | Aba “PDV e impressão” em `/config` · `src/lib/pdvImpressao.ts` + `nk_pdv_config` + `obterConfigPdv`/`salvarConfigPdv` · confirmação, vias, logo, cancelados, confissão, 80mm/A4 |
| Produtos e manutenção de preços | Rota `/produtos` · `src/views/Produtos.tsx` + `src/server/acoes/cadastros.ts` |
| Script consolidado aditivo de tabelas/colunas `nk_*` | `ATUALIZAR_SUPABASE_AGORA.sql` + `src/db/migracao.ts` |
| Central de prontidão (o que está pronto e o que falta por chave externa, sem expor valores) | Rota `/prontidao` + `GET /api/prontidao` · `src/lib/prontidao.ts` + `src/server/prontidaoCore.ts` + `src/views/Prontidao.tsx` |
| Captura automática de DF-e por cron (restaurada no baseline; 401 sem segredo) | `GET|POST /api/dfe/dist` · `src/app/api/dfe/dist/route.ts` + `DFE_CRON_SECRET` / `CRON_SECRET` |
| Perfil Gerente e quebra de caixa (Etapa 1) | `src/lib/permissoes.ts` (`gerente`, `caixa.homologar`, `caixa.auditoria`) · `src/db/schema.ts` (`nk_caixa_quebra_log` + 3 colunas em `nk_caixa_sessao`) · `src/db/migracao.ts` · `src/lib/migracaoLegado.ts` · `supabase/migrations/20261106_caixa_quebra_aprovacao.sql` · `usr-6` / `cx-23` no diagnóstico |
| Gaveta, blind balance e fechamento às cegas (Etapa 2) | `src/lib/caixa.ts` (constantes + `estadoGavetaPorSaldo` + `"cofre"`) · `src/server/caixaCore.ts` (`obterEstadoGavetaSessao`, `listarAuditoriaCaixa`) · `src/server/acoes/caixa.ts` (`fecharTurnoCego`, `homologarQuebraCaixa`, fundo automático, `ajustarCaixaFechado` sem sobrescrever `valoresEsperados`) · `src/app/(pdv)/pdv/page.tsx` · `src/views/Pdv.tsx` · `src/views/Caixa.tsx` · `src/lib/operacoesPdv.ts` · `cx-24` / `cx-25` |
| UI de fechamento e auditoria (Etapa 3) | `src/components/ModalFechamentoCego.tsx` · `src/views/Pdv.tsx` (botão Encerrar Turno) · `src/app/(painel)/dashboard/auditoria-caixa/page.tsx` · `src/views/AuditoriaCaixa.tsx` · link no `src/components/shell.tsx` · `cx-26` |
| Relatórios gerenciais de PDV | `/dashboard/relatorios/pdv` + `GET /api/relatorios/pdv` · `src/lib/relatoriosPdv.ts` · `src/server/relatoriosPdv.ts` · `src/views/RelatoriosPdv.tsx` · `scripts/testar-relatorios-pdv.mjs` (50 verificações locais) |
| Central e impressão dos relatórios | Entrada única `/relatorios` · `src/components/MenuRelatorios.tsx` · prévia gerencial `/dashboard/relatorios/pdv/imprimir` · impressão dos gerais com tabela completa. Código incluído no main `e78d44c`; health não identifica o commit ativo. |
| Parametrização fiscal de produtos | `/config/fiscal/produtos` · `src/lib/tributacao.ts` · `src/server/tributacaoCore.ts` · `src/server/acoes/tributacao.ts` · `src/views/TributacaoProdutos.tsx` · migração aditiva `20261105_parametros_fiscais_produtos.sql` · 66 testes locais. IBS/CBS e regimes normais têm parametrização parcial, não apuração integral nem homologação automática. Ver `FISCAL_PRODUTOS.md` antes de operar fiscalmente. |
| Correção de quebra compensada e blind balance | Código no main `dd9f0cd`, testado localmente; health não identifica o commit ativo em produção. Turnos antigos não foram alterados. Ver `CONTEXTO_ARENA.md` → item 22. |
| Motor de apuração/fechamento de caixa (alinhado ao `main` `ffa115c`, sem módulo paralelo) | `src/lib/caixa.ts` (puro: `compoeCaixa`, `classificarVendaCaixa`, `apurarSessaoCaixa`, `idsEquivalentes`, `totalTroco`) + `src/server/caixaCore.ts` (`carregarInsumosSessao`, `apurarSessaoNoBanco`, `fecharSessaoCaixaTransacional`) + `src/server/acoes/caixa.ts` + `src/server/dados.ts` + `src/server/diagnostico.ts` (`cx-1..cx-27`, 220 verificações) + `scripts/testar-caixa-motor.mjs` (16 cenários) |
| Migração aditiva mínima do motor de caixa | `supabase/migrations/20261105_caixa_operacao_economica.sql` + `src/db/migracao.ts` + `src/lib/migracaoLegado.ts` — coluna `nk_venda.status_comercial text` anulável, sem default, legado preservado |

### 2.3 Publicar código no GitHub (seu PC)
| O quê | Onde |
|---|---|
| Preferência: **GitHub Desktop**, cliques, sem prompt de comando | `CONTINUAR_NKWAY.txt` e `CONTEXTO_ARENA.md` → seção 7 |
| Produção oficial Vercel + Supabase | `VERCEL_SUPABASE.md` |
| Guia antigo GitHub / Deploy | `GITHUB.md` / `DEPLOY.md` |

### 2.4 Outros guias
| Arquivo | Conteúdo |
|---|---|
| `FILTROS.md` | Especificação de filtros por módulo |
| `CHECKLIST.md` | QA antes de publicar |
| `DEV.md` | Console do desenvolvedor (`/api/diagnostico` — 195 testes / 25 módulos) |
| `README.md` | Visão geral do produto |

---

## 3. Como um chat novo de IA retoma o trabalho

Copie e cole o conteúdo inteiro do arquivo **`CONTINUAR_NKWAY.txt`** na primeira mensagem da nova conversa (ele já traz as regras de produção Next.js + Vercel + Supabase, segurança, estado atual dos módulos e validações obrigatórias).

Se o repositório estiver **privado**, deixe público temporariamente ou envie token **só de leitura**.

---

## 3.1 MEI / ME / Simples + nuvem
| Arquivo | Uso |
|---|---|
| `supabase/migrations/20260322_mei_simples_cloud.sql` | Porte/regime na empresa + config_fiscal + signup |
| `supabase/CUSTO_SUPABASE_MEI.md` | Custo-benefício Supabase 100% |
| Login do app | Campos porte (MEI/ME), UF, regime |

## 4. Ordem curta — configurar DF-e no futuro

1. Supabase: projeto + Auth + keys  
2. SQL: `20260322_dfe_distribuicao.sql`  
3. Segredo senha A1 (`app.dfe_secret` / Vault + `DFE_SECRET`)  
4. `.env` do NKWAY + **rebuild**  
5. Deploy function `dfe-dist` com `DFE_SEFAZ_MODE=demo`  
6. App: login → **Certificado A1** → salvar `.pfx`  
7. **DF-e → Capturar agora** → Importar no ERP  
8. (Produção) Worker mTLS + `live` + homologação → depois produção  
9. Cron a cada 10 minutos  
10. Detalhes e troubleshooting: **`supabase/DFE_ROTEIRO_CONFIG.md`**

---

## 5. Responsabilidades

| Quem | Faz |
|---|---|
| **Você** | A1, CNPJ, GitHub Desktop, testes na loja, variáveis no painel do site |
| **Contador** | Emitir/renovar A1, orientação fiscal |
| **TI / DevOps** | Supabase secrets, deploy function, worker mTLS, cron |
| **IA (chat)** | Código do ERP, lembrar pelo `CONTEXTO.md` + este memorando; **não** pede `git` no comando prompt |

---

## 6. Segurança — memorando permanente

- [ ] `.pfx` e senhas **fora** do Git  
- [ ] `service_role` só no Supabase/cron  
- [ ] Bucket `certificados-a1` privado  
- [ ] Não colar tokens no chat em repositórios que ficam no histórico  
- [ ] Renovar A1 antes do vencimento  

---

## 7. Manutenção deste memorando

Ao mudar configuração importante (novo secret, nova URL, novo provedor fiscal):
1. Atualize **este arquivo** e/ou `DFE_ROTEIRO_CONFIG.md`  
2. Atualize **`CONTEXTO.md`** (seções 5–6)  
3. Envie ao GitHub (zip + Desktop ou commit)  

Assim a próxima configuração futura parte **sempre** do repositório, não da memória de um chat antigo.

---

*NKWAY · memorando de acesso e configuração · manter na raiz do repositório*

## Retomada do roteiro NCM / CEST / perfil (consolidado em 2026-11-12 sobre `a16fe24`)

1. **Etapa 1 no main (`8186ae1`):** consulta NCM oficial da Receita, fonte/datas separadas, cache persistente com concorrência, preenchimento manual e gravação auditada/transacional. Guia em `FISCAL_PRODUTOS.md`; item 27 de `CONTEXTO_ARENA.md`.
2. **Etapa 2 no main (`bf2931d`):** CEST como referência local por empresa (`nk_catalogo_cest`, proveniência declarada); CONFAZ só publica em PDF, sem fonte estruturada adotada, sem seleção automática. Guia em `FISCAL_PRODUTOS.md`; item 41.
3. **Etapa 3 no main (`bf2931d`):** perfil no cadastro com seleção ≠ aplicação, prévia antes/depois e NCM/CEST preservados por padrão. Históricos não apagados. Guia em `FISCAL_PRODUTOS.md`; item 41.
4. **Etapa 4 geral pendente:** aceite contábil + homologação SEFAZ/provedor + chaves live. As suítes por etapa não são homologação fiscal integral. Produção comprovada no commit (`a16fe24`/`production`); sem teste autenticado fiscal nesta sessão; nenhum segredo alterado.
