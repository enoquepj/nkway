# CONTEXTO NKWAY · retomada na plataforma (Arena / Next.js + PostgreSQL)

> Este arquivo substitui o `CONTEXTO.md` do protótipo Vite **enquanto o projeto estiver nesta plataforma**.
> Produção e banco: leia primeiro `VERCEL_SUPABASE.md` (infraestrutura pronta; não refazer).
> Fonte de verdade do produto: https://github.com/enoquepj/nkway (`CONTEXTO.md`, `MEMORANDO.md`, `supabase/DFE_ROTEIRO_CONFIG.md`).

---

## 0. Próxima conversa

Use o arquivo **`CONTINUAR_NKWAY.txt`** inteiro como primeira mensagem. Ele registra a produção pronta, a arquitetura Vercel/Supabase, as proibições de segurança e a ordem mínima de leitura.

Custo de retomada: ler `CONTINUAR_NKWAY.txt` + `VERCEL_SUPABASE.md` + seções 1/2/4/6 deste arquivo, rodar baseline e executar uma tarefa. Não revisar o histórico inteiro.
---

## 1. Como rodar / validar (ordem exata)

```bash
npx drizzle-kit push --force          # SOMENTE Postgres local descartável; nunca produção sem filtro nk_*
npm run build                         # ou o tool build_and_start da plataforma
bash scripts/smoke.sh                 # typegen + tsc + build + teste HTTP de todas as rotas
```

- Local: `DATABASE_URL` no `.env`. Produção já funciona no Vercel/Supabase; health oficial `https://nkway.vercel.app/api/health`. Não alterar conexão se estiver `ok:true`.
- Seed automático: `src/instrumentation.ts` chama `semearAmbiente()` no boot (idempotente).
  - Login demo: **demo@nkway.com.br / nkway123**
  - Desligar: `NKWAY_SEED=off`
- Build da plataforma é gerenciado pelo runtime: use a ferramenta `build_and_start` (ela checa `/api/health`), nunca `npm run start`.

## 2. Mapa de arquivos

| Onde | O que é |
|---|---|
| `CONTINUAR_NKWAY.txt` | bloco curto para a próxima conversa |
| `VERCEL_SUPABASE.md` | produção atual, Vercel/Supabase e segurança |
| `src/db/schema.ts` + `src/db/migracao.ts` | 19 tabelas `nk_*` (`+ nk_auditoria`, `nk_caixa_sessao`, `nk_caixa_movimento`, `nk_assinatura`, `nk_assinatura_fatura`) + migrações `supabase/migrations/2026110*.sql` |
| `src/lib/permissoes.ts` + `src/server/auditoria.ts` | perfis `administrador` (`owner`), `operador` e `vendedor`, matriz de 21 permissões, `exigirPermissao()` e auditoria sanitizada |
| `src/server/acoes/usuarios.ts` + `src/views/Usuarios.tsx` | tela `/usuarios`: gestão de usuários, ativação/desativação, atribuição de perfis e consulta da trilha de auditoria |
| `src/lib/caixa.ts` + `src/server/acoes/caixa.ts` + `src/views/Caixa.tsx` | tela `/caixa` + barra no `/pdv`: abertura, suprimento, sangria, estorno, fechamento em transação por forma, reabertura/ajuste e relatório |
| `src/lib/caixa.ts` (puro) + `src/server/caixaCore.ts` (núcleo server-side) | **Motor unificado do `main` `ffa115c`**: `classificarVendaCaixa`, `compoeCaixa`, `selecionarVendasDaSessao`, `apurarSessaoCaixa`, `aplicarSnapshotFechamento`, `ratearPagamentosDetalhado`, `idsEquivalentes`, `totalTroco`, `InconsistenciaCaixa`; `carregarInsumosSessao`, `apurarSessaoNoBanco`, `fecharSessaoCaixaTransacional`, `obterEstadoGavetaSessao`, `listarAuditoriaCaixa` |
| `src/components/ModalFechamentoCego.tsx` + `src/views/AuditoriaCaixa.tsx` + `src/app/(painel)/dashboard/auditoria-caixa/page.tsx` | Modal de fechamento às cegas dentro do PDV (inputs vazios + PIN do gerente) e rota gerencial `/dashboard/auditoria-caixa` com esperado × declarado e homologação remota |
| `supabase/migrations/20261105_caixa_operacao_economica.sql` | migração aditiva mínima preservada: `nk_venda.status_comercial text` anulável, sem default; legado fica NULL (sem conversão automática de DAV) |
| `scripts/testar-caixa-motor.mjs` | suíte unificada do `main`: 16 cenários (motor puro + banco real com `FOR UPDATE` + `/api/diagnostico`); chamada pelo `smoke.sh` |
| `src/lib/zip.ts` + `src/server/exportacaoXmlCore.ts` + `src/server/acoes/documentosXml.ts` | exportação de XML real armazenado (individual `.xml` e lote `.zip` Deflate/CRC-32 sem XML fictício) + `POST /api/documentos/xml` |
| `src/lib/assinatura.ts` + `src/server/assinaturaGateway.ts` + `src/views/Assinatura.tsx` | tela `/assinatura` e aba Assinatura em `/config`: recorrência por CNPJ (Asaas/Stripe/Sandbox), PIX EMV + QR SVG, Boleto 47 dígitos, Cartão Luhn e webhook `POST /api/assinatura/webhook` |
| `src/lib/migracaoLegado.ts` + `src/server/migracaoLegadoCore.ts` + `src/views/MigracaoLegado.tsx` | tela `/migracao`: assistente somente-leitura das 10 tabelas legadas sem prefixo (ou backup `.json`), simulação Dry-Run por módulo e importação idempotente p/ `nk_*` |
| `src/lib/emissorFiscal.ts` + `src/server/emissorFiscalCore.ts` + `src/views/EmissorFiscal.tsx` | tela `/emissor` + `POST /api/fiscal/webhook`: pré-validador NF-e/NFC-e 4.00 (IBS/CBS LC 214/2025), adaptador REST (Focus NFe / Nuvem Fiscal / Fiscalo), contingência offline e gravação automática de `xml_fiscal` |
| `src/db/seed.ts` | ambiente demo: 23 produtos, ~200 vendas em 30 dias, DAVs, entradas (XML/SEFAZ/manual), kardex, financeiro, MDF-e |
| `src/lib/dominio.ts` | moeda/data, chave SEFAZ 44 dígitos + DV, GTIN, custo médio, situações de estoque, curva ABC, `PLANOS_CFG` |
| `src/lib/filtros.ts` | base de filtros (`casaTexto`, `lerNumero`, `emPeriodo`, `alternarItem`) |
| `src/lib/xmlNfe.ts` | parser de XML de NF-e + `notaPorChaveDemo` (chave 44 dígitos) |
| `src/lib/session.ts` | cookie assinado HMAC, `hashSenha`/`confereSenha` (scrypt-like), `contexto()` = tenant |
| `src/lib/dfe.ts` + `src/server/dfeCore.ts` | protocolo `NfeDistDFeInteresse` v1.01, `docZip` GZIP+Base64, cofre AES-256-GCM, inspeção A1 `.pfx`, bucket privado REST e worker mTLS |
| `src/server/acoes/dfe.ts` + `src/views/Dfe.tsx` | tela `/dfe`: Certificado A1, captura SEFAZ (`distNSU`/`consChNFe`), manifestação (210210/210200/210220/210240) e importação p/ Entrada |
| `src/app/api/dfe/dist/route.ts` | webhook/cron a cada 10 min (`DFE_CRON_SECRET` / `CRON_SECRET`, 401 sem segredo) |
| `src/lib/prontidao.ts` + `src/server/prontidaoCore.ts` + `src/views/Prontidao.tsx` | Central de prontidão em `/prontidao` e `GET /api/prontidao`: consolida (somente leitura, sem valores de segredos) base, DF-e/A1, assinatura, emissor fiscal e migração do legado; reaproveita `obterPainelDfe`, `diagnosticoGatewayServidor`, `diagnosticoEmissorServidor` e `inspecionarFontesLegadas` |
| `src/lib/atalhosPdv.ts` + `src/lib/situacaoFiscal.ts` | fonte única `ATALHOS_PDV` (ajuda `F1` + barra inferior) e modelo `situacaoFiscal` / `protocoloOrigem` (`autorizado_sefaz` vs `simulado`) |
| `src/server/dados.ts` | todas as leituras + `listarVendasPaginado` (busca no servidor por chave c/ ou s/ espaços, nº, CPF/CNPJ, cliente, protocolo) |
| `src/server/diagnostico.ts` | console do dev: 152 testes (25 módulos) → `Diagnostico` |
| `src/server/acoes/numeracao.ts` | inutilização de faixa + carta de correção (evento 110110) |
| `src/views/Numeracao.tsx` | aba Numeração e eventos em Documentos (faixas, próximo número, timeline de eventos) |
| `src/server/acoes/devolucoes.ts` | devolução de compra: emite, cancela, baixa estoque, cria crédito |
| `src/views/Devolucoes.tsx` + `src/app/(painel)/devolucoes` | tela de devoluções (CFOP, NFref, kardex das baixas) |
| `src/lib/qrcode.ts` | gerador de QR Code próprio (byte mode, versões 1-6, níveis L/M, 8 máscaras) |
| `src/lib/danfe.ts` | dados de impressão: emitente, itens, payload do QR, DAMDFE |
| `src/components/Impressao.tsx` | DANFE NFC-e 80 mm · DANFE NF-e A4 · DAMDFE A4 + CSS de impressão |
| `src/server/acoes/*.ts` | escrituras: `auth cadastros config entradas estoque financeiro pdv transporte` |
| `src/components/ui.tsx` | Card/Badge/Button/Campo/Filtro\*/Modal/Kpi/Toast + `FiltrosSalvos` (localStorage `nkway.filtros.*`) |
| `src/components/Tabela.tsx` | ordenação, paginação, CSV (BOM + `;`) |
| `src/components/shell.tsx` | sidebar grafite + topbar com trial/plano/ambiente |
| `src/views/*.tsx` | 11 telas + `Diagnostico.tsx` + `Devolucoes.tsx` + `Numeracao.tsx` |
| `src/app/api/diagnostico/route.ts` | `GET` → bateria de testes do tenant logado (401 sem sessão) |
| `src/app/(painel)/*/page.tsx` | páginas finas com `<Shell />` (exceto `/pdv`): `contexto()` → `dados` → `<View />` |
| `src/app/(pdv)/layout.tsx` + `src/app/(pdv)/pdv/page.tsx` | grupo de rotas isolado do `/pdv` em tela cheia real (`100dvh`), sem `<Shell />`, com `contexto()` → `redirect("/login")` |

## 3. Convenções que o projeto segue

- **numeric sempre** `numeric(name, { precision, scale, mode: "number" })` e `.default(0)` (número, não string).
- Views = `"use client"` recebendo **dados serializáveis**; nenhuma função como prop vinda de server component.
- Ações em `"use server"`, resolvent o tenant por sessão (`tenant()`), retornam `{ok:true,…} | {ok:false, erro}` e chamam `revalidatePath`.
- Dinheiro: `round2` nas pontas; estoque com 3 casas; custo com 4.
- Toda saída de estoque gera linha em `nk_movimento` (kardex) com `saldoApos` e `custoMedioApos`.
- Rótulos de UI em português; prefixo `nkway.` para chaves de navegador.

## 4. Armadilhas que custaram tempo (não repita)

0. **Infraestrutura está pronta:** `nkway.vercel.app/api/health` está ok. Não criar novo Supabase/Neon, não trocar senha e não refazer tabelas sem erro atual comprovado.
0.1. Supabase continua sendo o PostgreSQL da versão Next. “Não instalar Supabase” significa não voltar ao SDK/Vite; Drizzle conecta server-side por `DATABASE_URL`.
0.2. Variáveis `VITE_*` são legado e não interferem no Next. O login Next usa `nk_usuario`, não Supabase Auth.
0.3. Tabelas antigas sem prefixo e `nk_*` coexistem. Nunca apagar legado, rodar `supabase/schema.sql` de novo ou usar `push --force` sem `--tablesFilter="nk_*"` na produção.
0.4. Nunca mostrar `DATABASE_URL`, senha, `.env` ou campo Valor em print/chat. O usuário PostgreSQL `nkway_app` não é login do sistema.

1. `numeric` sem `mode:"number"` → insert quebra esperando string.
2. `Promise.all([...])` já devolve o resultado de cada query — não existe `resultado[0]`.
3. `server-only` **não** está instalado neste template.
4. Não usar `next/font/google` (build sem rede falha) — stack de fontes em `globals.css`.
5. Clientes do template: `read_file`/`bash` só enxergam caminhos a partir da raiz do projeto (nada de `../`). Para ler o clone use `bash` com `cat`/`sed` em `/tmp/nkway`.
6. Tabela de UI com `render` precisa viver em client component; senão quebra ao passar função do servidor.
7. Não clonar o repo inteiro dentro do projeto: `git clone --depth 1 … /tmp/nkway` e ler só o que interessa.
8. Criar arquivo novo + importar antes de existir gera erro "Cannot find module" — crie a view na mesma leva.
9. `cd` não persiste entre chamadas do `bash` — use caminho absoluto (`/tmp/nkway`, `/app`) em cada comando.
10. No `smoke.sh`, `$COOKIE` só existe dentro do bloco "rotas autenticadas": teste que usa cookie tem de vir **depois** do `node -e` que o gera (era `unbound variable`).
11. `criterion` de teste com `Number` de 3 casas: compare em milésimos (`round2(x*1000)`), não passe 2 casas como segundo argumento — `round2` só aceita 1 argumento.
12. **Kardex é trilha cronológica**: se o seed lançar entrada de estoque com data anterior à última venda mas `saldoApos` final, o teste `est-5` (saldo do cadastro = último `saldoApos`) falha. Entrada entra com data **depois** do último movimento de venda (`emissao` da nota pode ficar no passado; a mercadoria entra quando é recebida).
15. **QR Code**: só versões 1 a 6 são seguras neste gerador — a contagem de módulos livres fecha exatamente com a tabela de capacidade (v1=208, v2-6=7 bits de resto). Das versões 7 a 10 sobram 40 módulos livres e o QR desalinha leitores reais. Limite prático: **134 bytes** no payload.
16. `round2` aceita **1 argumento**. Para comparar valores com 3 casas, multiplique antes (`round2(x*1000)`).
17. O `Modal` de `ui.tsx` recebe `largura` como **classe Tailwind** (`max-w-2xl`), não como `px`.
13. **CNPJ/CPF do seed têm de ter DV real** — a bateria de testes valida dígito verificador. Use os helpers `cnpjComDv()` / `cpfComDv()` de `src/db/seed.ts` em vez de colar número inventado (CNPJ `23.567.891/0001-02` do seed antigo era inválido e derrubava `fis-1`).
18. Arquivo `"use server"` **só pode exportar funções async**. Helper síncrono (`cfopDevolucao`) tem de morar em `src/lib/dominio.ts` — senão o build falha com "Server Actions must be async functions".
19. `dataBR`/`dataHoraBR` quebram com `RangeError: Invalid time value` quando recebem data futura ou string longa. Já estão blindadas (retornam `"—"`), mas evite gravar `emissao` à frente de `agora` no seed.
21. Toda lógica compartilhada entre painel e PDV deve ficar em `src/server/dados.ts`. Duplicar "próximo número" fez o KPI mostrar um valor e o PDV emitir outro — a `numeracao.ts` (que é `"use server"`) só repassa via import dinâmico.
22. Server action precisa de `await import()` quando chama código de `dados.ts`, para não criar dependência circular com `tenant()`.
20. Coluna nova no schema exige `truncate` das tabelas + `build_and_start` para o seed recriar o ambiente; a bateria de testes assume que devolução, kardex e crédito estão coerentes entre si.
26. Contadores numéricos em `diagnostico.ts`: ao escrever o detalhe com template string, `x.length` em número dá `undefined`. Defina `const x = lista.filter(...).length` e use `x` direto (sem `.length`).
31. **Caixa:** nunca voltar a filtrar vendas por `tipo = fiscal` em `carregarInsumosSessao()`/`listarSessoesCaixa()` — `sem_nota` e DAV concreto somem do fechamento. `status_comercial` é anulável: legado NULL **não** deve ser convertido para `concretizado`. `db` é um Proxy preguiçoso, mas `db.transaction()` funciona (testado em runtime); o fechamento precisa de `SELECT ... FOR UPDATE` + `UPDATE ... WHERE status='aberto'`. O snapshot de um caixa fechado é imutável: `ajustarCaixaFechado()` mexe só em `valoresInformados`/`diferencas`.
30. **Sobra do template da plataforma:** `src/app/page.tsx` (starter "Starter template") sombreia o Dashboard de `src/app/(painel)/page.tsx` na rota `/`. Ao alinhar com o `main`, apague esse arquivo; o `smoke.sh` agora falha se a palavra "Starter template" aparecer autenticada em `/`.
28. Um id de server action truncado devolve **404**, o id completo pode devolver **500**. Ao investigar, use o id inteiro (64 hex) e identifique a ação pelo último argumento de `createServerReference(...,"nomeDaAcao")` no chunk.
29. `export const X = ...` em arquivo `"use server"` derruba **todas** as ações do arquivo com "can only export async functions, found object". Tipo e `const` só em `src/lib/`.
27. `FiltroMulti` é popover: as opções só aparecem no HTML quando o menu está aberto. Para conferir filtro novo por `curl`, valide o **rótulo do gatilho** (`rotulo`), não o texto das opções.
24. **Server action com parâmetro tipado quebra com "An unexpected response was received from the server"**: se o cliente enviar o corpo em formato inesperado, `input` chega `undefined` e `input.email.trim()` vira `TypeError` (500, sem stack útil no navegador). Assine as ações como `(bruto: unknown)` e normalize dentro: `const input = (bruto ?? {}) as {...}` + `String(x ?? "")`. O `entrar`/`cadastrar` de `auth.ts` já estão assim.
25. Para reproduzir erro de server action por linha de comando: extraia o id hex de 40+ caracteres dos chunks `/_next/static/chunks/*.js` da página e faça `POST` com o header `Next-Action: <id>`. O log real da exceção está em `/tmp/arena-start.log`.
23. **Vínculo por nome é armadilha silenciosa: dois cadastros homônimos somam o saldo um do outro, e renomear perde o histórico. Sempre grave `contraparteId` + `contraparteTipo` junto de `contraparteNome` (o nome fica só como rótulo). Ao trocar a chave de agrupamento, mantenha fallback pelo nome para títulos antigos.
14. O seed é idempotente pelo e-mail `demo@nkway.com.br`: para recriar os dados depois de mudar o seed, `truncate nk_usuario, nk_produto, … nk_empresa cascade;` e reinicie a prévia (`build_and_start`).

## 5. Produtos vs protótipo (o que mudou na portabilidade)

| Protótipo (Vite/Supabase) | Aqui (Next/Drizzle) |
|---|---|
| `store.tsx` + localStorage | Postgres multi-tenant + server actions |
| fila offline no navegador | fila local só do PDV (`nkway.fila`) com botão sincronizar + persistência real no resto |
| `auth.tsx` contas no navegador | login e-mail/senha com cookie assinado, papéis owner/operador |
| DAV/nota em memória | `nk_venda` com `tipo`/`status`, DAV → `faturarDav` gera nota e baixa estoque |
| `Entradas.tsx` com filtros pendentes | **feito**: status, fornecedor, período, origem, faixa de valor, divergência, sem vínculo, filtros salvos |
| `DevConsole` (Ctrl+Shift+D, 27 testes) | **feito**: 114 verificações em 19 módulos (`GET /api/diagnostico` + aba Ambiente) |
| DF-e / certificado A1 (edge function) | **feito**: `/dfe` nativo no Next + worker mTLS + bucket privado REST / cofre AES-256-GCM + `/api/dfe/dist` |

## 6. Pendências (ordem recomendada)

0. ✅ **Produção concluída** — Next/Vercel + Supabase existente; tabelas `nk_*`; health 200; login e cadastro funcionando. Não reabrir esta etapa sem falha comprovada.

1. ~~Testes do console do dev~~ **FEITO (2026)** — `src/server/diagnostico.ts` (74 verificações) → `GET /api/diagnostico` + `<PainelDiagnostico />` na aba **Ambiente** das Configurações. 12 módulos: Núcleo, Entrada XML, Cadastros, PDV, Estoque, Compras, Financeiro, MDF-e, Clientes, Fornecedores, Fiscal, Ambiente. O `smoke.sh` também imprime o resumo e lista as falhas. Validadores em `src/lib/dominio.ts`: `validarCpf`, `validarCnpj`, `documentoValido`, `dvChaveAcesso`, `validarChaveAcesso`. Hoje são **14 módulos** (Núcleo, Entrada XML, Cadastros, PDV, Estoque, Compras, Devoluções, Financeiro, MDF-e, Clientes, Fornecedores, Fiscal, Ambiente, QR Code).
2. ~~Impressão DANFE/DAMDFE com layout 80 mm e QR Code~~ **FEITO (2026)** — `src/components/Impressao.tsx` (DANFE NFC-e 80 mm, DANFE NF-e A4, DAMDFE A4) + `src/components/QrCode.tsx` (SVG) + `src/lib/danfe.ts` (payload do QR, chave em blocos, tributos da Lei 12.741) + `src/lib/qrcode.ts` (gerador próprio). Impressão via CSS `@media print` com `visibility` (esconder por `display` derruba o modal).
3. ~~Devoluções de compra~~ **FEITO (2026)** — tabela `nk_devolucao` (CFOP, `chaveReferente` = NFref, itens jsonb) + `src/server/acoes/devolucoes.ts` (`emitirDevolucao`, `cancelarDevolucao`, `itensDaEntrada`) + `src/views/Devolucoes.tsx` em `/devolucoes`. CFOP escolhido por UF com `cfopDevolucao()` (`src/lib/dominio.ts`), valida `validarChaveAcesso` da entrada antes de emitir, baixa estoque item por item com linha no kardex (`tipo: "devolucao"`, qtd negativa) e cria crédito (conta a receber, categoria `Devoluções`). Cancelamento restaura o estoque.
4. ~~Inutilização de numeração e carta de correção~~ **FEITO (2026)** — tabelas `nk_inutilizacao` e `nk_evento_fiscal` + `src/server/acoes/numeracao.ts` (`inutilizarNumeracao`, `cancelarInutilizacao`, `emitirCartaCorrecao`, `proximoNumeroNota`) + `src/views/Numeracao.tsx` (aba **Numeração e eventos** em Documentos). Justificativa de 15–255 caracteres, recusa número já emitido, máximo 500 por pedido, faixa sobreposta bloqueada. Carta de correção (evento 110110) valida chave, protocolo, texto ≥ 15 e **rejeita correção de valor/quantidade/CNPJ/CFOP/NCM/data**; limite de 20 eventos por documento. `proximoNumeroFiscal()` em `src/server/dados.ts` é a implementação única usada pelo PDV e pelo painel — pula intervalos inutilizados.
5. ~~DF-e real: captura de NF-e por worker mTLS + bucket privado (roteiro do repo), `dfe-dist`~~ **FEITO (2026)** — `src/lib/dfe.ts` + `src/server/dfeCore.ts` + `src/server/acoes/dfe.ts` + `src/views/Dfe.tsx` em `/dfe` + `src/app/api/dfe/dist/route.ts`. Validação PKCS#12 (`.pfx`/`.p12`) via `node:tls`, senha cifrada com AES-256-GCM (`DFE_SECRET` / `AUTH_SECRET`), upload do `.pfx` via HTTP REST para o bucket privado `certificados-a1` (`DFE_STORAGE_URL` + `DFE_STORAGE_SERVICE_KEY`) com fallback automático em cofre criptografado AES-256-GCM (zero DDL nova nas 14 tabelas `nk_*` de produção e zero `@supabase/supabase-js`). Suporta modo `demo` (lotes `docZip` GZIP+Base64 reais com chave de 44 dígitos + DV) e `live` via worker Node (`DFE_MTLS_WORKER_URL` → `supabase/functions/dfe-dist/sefaz-mtls-worker.mjs`, atualizado para aceitar `pfxBase64` + `passphrase` além de PEM), trava de 60s contra `cStat 656`, consulta pontual `consChNFe`, manifestação do destinatário (`210210`/`210200`/`210220`/`210240`) e importação 1-clique para `nk_entrada` (`origem: "dfe"`). Bateria: módulo **DF-e** (6 testes).
6. ~~Assinatura com gateway (recorrência por CNPJ) no lugar do `alterarPlano` simulado~~ **FEITO (2026)** — tabelas `nk_assinatura` e `nk_assinatura_fatura` + `src/lib/assinatura.ts` + `src/server/assinaturaGateway.ts` + `src/server/acoes/assinatura.ts` + `src/views/Assinatura.tsx` (em `/assinatura` e na aba **Assinatura** de `/config`) + webhook autenticado `POST /api/assinatura/webhook` (token Asaas ou HMAC-SHA256, 401 sem credencial). Exige CNPJ de 14 dígitos com DV real (`validarCnpjAssinatura`), ciclos `mensal` e `anual` (-20%), cobrança por PIX (payload EMV BR Code com CRC-16/CCITT-FALSE ≤ 124 bytes + QR Code SVG próprio), Boleto Registrado FEBRABAN de 47 dígitos (Mod-10 e Mod-11) e Cartão Recorrente (validação Luhn em memória, persistindo só bandeira e 4 últimos dígitos). Conecta nativamente ao Asaas v3 (`ASAAS_API_KEY`) ou Stripe (`STRIPE_SECRET_KEY`) com modo Sandbox Homologação integrado e liquidação auditada em `nk_auditoria`. Bateria: módulo **Assinatura CNPJ** (6 testes).
7. ~~`contraparteId` em vez de vínculo por nome~~ **FEITO (2026)** — `nk_conta` ganhou `contraparteId` + `contraparteTipo` (`cliente` | `fornecedor` | nulo para lançamento avulso). PDV, entradas, devoluções e lançamento manual gravam o id junto do nome. `saldoEmAberto` em `listarClientes()` casa por **id**, com fallback pelo nome só para títulos antigos sem id. Financeiro agora tem Select de cliente/fornecedor em vez de nome digitado. Bateria: módulo **Vínculos** (4 testes). Obs.: o protótipo usava `citaNome` para vendas — aqui `nk_venda.clienteId` **já era uuid**, então o ajuste foi em `nk_conta`, onde o vínculo por nome realmente existia.
8. ~~Campos ➕ do `FILTROS.md`~~ **FEITO (2026)** — campos novos: `nk_produto.lote/validade/localizacao`, `nk_venda.caixa/ambiente/origem`, `nk_movimento.usuarioId/usuarioNome`, `nk_conta.origem/origemId` (`contraparteId` e `lancadaEm` já existiam). Gravados em PDV, entradas, devoluções, ajuste de estoque e lançamento manual. **Filtros de Produtos**: situação fiscal (CSOSN), unidade, tipo (unitário/pesável), exceções (sem GTIN, GTIN inválido, sem NCM, margem negativa, custo zerado, preço abaixo do custo, sem localização, validade em 30 dias), faixas de margem máxima e estoque. **Filtros de Clientes**: tipo de pessoa (PF/PJ), cidade, crédito (em aberto, acima de 85% do limite, sem limite, com limite disponível), cadastro SEFAZ, contribuinte ICMS (indIEDest), recência da última compra (30d/30-60/60-90/+90/nunca), faixas de total comprado e limite. Busca de ambos aceita documento **com ou sem máscara**. Bateria: módulo **FILTROS** (5 testes).
9. ~~Melhoria do PDV em Etapas (Etapas 0 a 11)~~ **FEITO (2026)** —
   - **Etapa 1:** grupo isolado `src/app/(pdv)/layout.tsx` + `src/app/(pdv)/pdv/page.tsx` sem `<Shell />`, `src/app/(painel)/pdv/page.tsx` removido, layout `100dvh` em duas colunas com rolagem própria e sem rolagem da página (`smoke.sh` valida ausência do `Shell` em `/pdv` e presença em `/documentos`).
   - **Etapa 2:** barra escura fixa no topo com `← Voltar` (`Alt+←`) e modal de saída com 3 opções (`Continuar no PDV`, `Descartar e sair`, `Sair mantendo a fila offline`) quando há itens; saída direta sem modal quando vazio.
   - **Etapa 3:** botão `Tela cheia` + `Alt+Enter` (`F11`), preferência em `localStorage["nkway.pdv.telaCheia"]`, aviso de 1 linha `"Clique em qualquer lugar para entrar em tela cheia"` quando bloqueado sem gesto e entrada no primeiro gesto.
   - **Etapa 4:** lista única `ATALHOS_PDV` em `src/lib/atalhosPdv.ts` alimentando o modal `F1` e a legenda inferior (`F1`, `F2`, `F3`, `F4`, `F6` com confirmação, `F8`, `F10`, `Del` + `Ctrl+Z` p/ desfazer [D1], `Alt+1..6` + botões `[1]..[6]` [D6], `Esc`).
   - **Etapa 5:** barra escura superior preservando `Caixa`, `Ambiente` e `Sincronizar fila`; barra inferior com itens, unidades bipadas, pago/falta/troco, situação da fila offline e legenda de `ATALHOS_PDV`.
   - **Etapa 6:** `Esc` na busca limpa apenas o texto digitado [D5], sem jamais apagar a venda.
   - **Etapas 7 e 8:** migração aditiva `situacao_fiscal` e `protocolo_origem` em `nk_venda` (`src/lib/situacaoFiscal.ts`, sem mutar registros existentes [D2]); `registrarDav` sem chave e sem baixa de estoque; `faturarDav` com trava atômica baixando estoque exatamente 1 vez; `emitirNfceDaVenda` sem SEFAZ grava `"pendente_transmissao"` (nunca `"autorizada"` e sem inventar chave/protocolo).
   - **Etapa 9:** modal `F10` com 3 opções (`Salvar como DAV`, `Finalizar sem nota`, `Finalizar e emitir NFC-e`) e confirmação explícita antes de emitir.
   - **Etapas 10 e 11:** busca paginada no servidor (`F3` [D3] → `buscarDocumentosPdv` / `listarVendasPaginado`) aceitando nº da venda, nº da nota, chave c/ ou s/ espaços, CPF/CNPJ, cliente e protocolo, reaproveitando `Tabela` e `Impressao`, + 7 testes novos no módulo **PDV** (`pdv-9` a `pdv-15` em `src/server/diagnostico.ts`).
10. ~~Complemento PDV 1 de 3: Entrada em Fullscreen pelo menu e Multiplicador de Quantidade (`X + Qtd + Enter`)~~ **FEITO (2026)** —
   - **Entrada oficial em tela cheia:** helper único `src/lib/abrirPdv.ts` (`abrirPdvComTelaCheia`, deduplicação de promessa ativa, preservação de `Ctrl/Cmd+clique` / nova aba, gravação de `nkway.pdv.telaCheia` e sinalização de fallback `consumirFalhaRecenteTelaCheia`) + componente `src/components/LinkPdv.tsx` conectado às entradas oficiais (`src/components/shell.tsx` sidebar + botão `Abrir PDV` + atalho `Alt+K`, `src/views/Dashboard.tsx` `Abrir PDV` e `src/views/Caixa.tsx` `Ir para o PDV`).
   - **Multiplicador `X + Qtd + Enter` e `adicionar(p, qtd)`:** máquina de estados tipada única em `src/lib/multiplicadorPdv.ts` (`inativo → digitando → armado → consumida/cancelada`), limite máximo `9.999`, até `3` casas decimais para produtos `pesavel: true` (bloqueando fração em unitários e respeitando saldo em estoque), soma exata da quantidade multiplicada em produto novo ou já existente (sem erro de ponto flutuante e sem incrementar `+1` indevido), indicador acessível `Próximo item × N` junto ao campo e na barra inferior, conversão natural para busca textual iniciada por `X`, documentado em `ATALHOS_PDV` (`X + Qtd`) + 13 testes novos (`pdv-16` a `pdv-28` em `src/server/diagnostico.ts`, totalizando 165 verificações, e suíte `scripts/testar-pdv-complemento1.mjs`).
11. ~~Complemento PDV 2 de 3: Pagamento Dividido Guiado, Troco/Crédito e Operação de Balcão (`F7`, `F9` e Etiqueta de Balança)~~ **FEITO (2026)** —
   - **Pagamento dividido guiado, troco exclusivo em dinheiro e limite de crédito (`src/lib/pagamentoPdv.ts` + `src/views/Pdv.tsx` + `src/server/acoes/pdv.ts`):** lançamento de parcelas tanto na coluna lateral quanto dentro do modal `F10` (`Alt+1..6`, setas `↑`/`↓`, cédulas rápidas e `Enter`), trava impedindo excesso/troco em PIX/cartão/boleto/prazo (troco apenas em `dinheiro`), recusa de duplicação sobre venda quitada, normalização líquida `normalizarPagamentosLiquidosPdv` para `nk_venda.pagamentos` (consistente com `pdv-6` e `ratearPagamentosLiquidos`) e trava de venda a prazo/boleto exigindo cliente identificado (`F8`) e respeitando `limiteCredito > 0` (`saldoEmAberto + valorAPrazo <= limiteCredito`) na UI e no servidor (mantendo `Salvar como DAV` livre).
   - **Operação de balcão (`src/lib/balcaoPdv.ts` + `ATALHOS_PDV`):** Consulta de Preço, Estoque, NCM/CSOSN e Tributos IBS/CBS/Lei 12.741 (`F7`) sem alterar a venda; Vendas em Espera (`F9` em `nkway.pdv.espera`) com suspensão imediata e retomada com troca automática caso haja outra venda aberta na tela; e decodificação automática de etiqueta EAN-13 de balança iniciando em `2` (`2CCCCCMMMMM0D`, modos `peso` em gramas e `valor` em centavos em `nkway.pdv.etiquetaBalanca`) + 12 testes novos (`pdv-29` a `pdv-40` em `src/server/diagnostico.ts`, totalizando 177 verificações, e suíte `scripts/testar-pdv-complemento2.mjs`).
12. ~~Complemento PDV 3 de 3: Bobina Térmica 80 mm Real, Operação Completa de Documentos/DAV (`F3`), Gaveta Rápida (`Alt+G`) e Inspetor da Fila Offline~~ **FEITO (2026)** —
   - **Bobina térmica 80 mm completa no pós-venda e reimpressão (`src/lib/operacoesPdv.ts` + `src/views/Pdv.tsx`):** layout `302px` dentro de `.print-area` exclusivo (corrigindo impressão em branco de `window.print()`), listando todos os itens numerados, subtotal, desconto, parcelas divididas, troco em dinheiro, cliente/documento, operador/terminal, tributos Lei 12.741 + IBS/CBS LC 214/2025, situação fiscal honesta (sem chave fictícia em `pendente_transmissao`/`dav`/`sem_nota`), botão 1-clique para **DANFE Oficial** nas vendas fiscais e tecla `Enter` para iniciar nova venda imediatamente.
   - **Carregar DAV para edição no PDV + Cancelamento/Estorno seguro em `Documentos (F3)`:** botão `Editar no PDV` carrega DAV em aberto para conferência/edição/pagamento dividido (salvando eventual venda aberta em `Vendas em Espera F9`) e fatura atomicamente via `faturarDav`; botão `Recibo 80 mm` habilita reimpressão também para `DAV` e `Venda sem nota`; botão `Cancelar` reusa `cancelarVenda` exigindo motivo `≥ 15` caracteres e respeitando prazo legal SEFAZ (`30 min` NFC-e 65 / `24h` NF-e 55).
   - **Gaveta rápida (`Alt+G`) e Inspetor da Fila Offline (`nkway.fila`):** modal de Suprimento e Sangria sem sair da tela cheia conectado a `registrarMovimentoCaixa` (com trava de caixa fechado e saldo insuficiente em espécie) + inspetor visual da fila offline com reenvio individual/lote e retenção segura do último erro do servidor + 12 testes novos (`pdv-41` a `pdv-52` em `src/server/diagnostico.ts`, e suíte `scripts/testar-pdv-complemento3.mjs`).
   - **Navegação 100% por teclado no `F10` e `F8` sem mouse (`src/lib/navegacaoFinalizarPdv.ts` + `src/views/Pdv.tsx`):** ao pressionar `F10`, o foco entra direto nas formas de pagamento (`← →` percorre `Dinheiro`, `PIX`, `Crédito`, `Débito`, `Boleto`, `Prazo`), digitação direta ou `Enter` lança parcelas e avança automaticamente às opções ao quitar, `← →` alterna o modelo fiscal (`NFC-e`, `NF-e`, `SAT`), `↑ ↓` (ou teclas `1`, `2`, `3`) seleciona `1. Salvar como DAV`, `2. Finalizar sem nota` ou `3. Finalizar e emitir` e `Enter` confirma (com navegação por setas também na confirmação final, na coluna lateral e em `F8`) + 6 testes novos (`pdv-53` a `pdv-58` em `src/server/diagnostico.ts`, totalizando **195 verificações**, e suíte `scripts/testar-pdv-f10-teclado.mjs`).

13. **Reparo do baseline (2026):** o `main` documentava `src/app/api/dfe/dist/route.ts`, mas o arquivo **não estava versionado** — o `smoke.sh` devolvia 404 em `GET /api/dfe/dist`. A rota foi restaurada de forma compatível: `GET`/`POST` autenticados por `DFE_CRON_SECRET` (ou `CRON_SECRET`) via `Authorization: Bearer`, `x-cron-secret` ou `?secret=`, comparação de tempo constante, 401 sem segredo, processamento sequencial de até 20 empresas com `dfeAtivo` habilitado chamando `executarCapturaDfeEmpresa`, resposta sanitizada (sem segredos, URLs, senha A1 ou `.pfx`). Nenhuma mudança de schema.

14. ~~Central de prontidão operacional~~ **FEITO (2026)** — tela `/prontidao` + `GET /api/prontidao` (401 sem sessão) + `src/lib/prontidao.ts` (DTO e resumo puros) + `src/server/prontidaoCore.ts` (agregação somente-leitura e contagens por `empresa_id`) + `src/views/Prontidao.tsx` + link no `shell.tsx` para o perfil com `config.gerenciar`. Responde de uma vez às três pendências antigas do prompt: mostra que **DF-e real (A1 + worker mTLS + bucket/cofre)**, **Assinatura com gateway** e **Migração planejada do legado** já estão implementados e separa o que é código pronto do que é apenas configuração externa de chaves. Nenhuma variável tem seu valor lido para a tela/API — só o **nome** da variável e booleanos/contagens. `scripts/smoke.sh` passou a validar a rota, o 401 sem sessão, os 5 blocos e a ausência de segredos no JSON. Nenhuma alteração de infraestrutura, schema ou `DATABASE_URL`.

15. ~~Motor de apuração e fechamento de caixa~~ **FEITO (2026)** — escopo único de backend, sem reformular telas/PDV, sem relatórios, sem atalhos, sem SEFAZ/XML e sem segundo módulo de caixa. `carregarInsumosSessao()` e `listarSessoesCaixa()` deixaram de filtrar `tipo = fiscal`: agora buscam por `empresa_id + caixa_sessao_id` e passam pelo predicado central `compoeCaixa`. `calcularApuracaoCaixa()` usa `selecao` (deduplicada por `operacaoEconomicaId`), trata canceladas como auditáveis com efeito líquido zero, ignora estorno de outra sessão e devolve `avisos`/`inconsistencias`. `fecharCaixa()` roda em `db.transaction` com `SELECT ... FOR UPDATE`, recálculo interno, `UPDATE ... WHERE status='aberto'` e snapshot imutável; `ajustarCaixaFechado()` não sobrescreve mais `valoresEsperados`. Migração aditiva `status_comercial` preserva 100% do legado. Bateria: **200 verificações** (`cx-6` a `cx-10` novas) + suíte `scripts/testar-motor-caixa.mjs` (16 cenários) + smoke 34 ok + ações 194 chamadas sem 500. Nenhuma alteração de `DATABASE_URL`, Vercel, Supabase ou RLS.

16. **Etapa 0 — Alinhamento sem retrocesso ao `main` `ffa115c` (2026), FEITO.** Base única de código: `src/server/caixaCore.ts` + `src/lib/caixa.ts` + `src/server/acoes/caixa.ts` + `src/server/dados.ts` + `src/server/diagnostico.ts` + `src/server/dfeCore.ts` + `supabase/DFE_ROTEIRO_CONFIG.md` + `scripts/testar-caixa-motor.mjs` adotados do `main`. **Aposentados e registrados:** `src/lib/operacaoCaixa.ts` (sua lógica já existia nativamente em `compoeCaixa`/`classificarVendaCaixa`/`idsEquivalentes`/`totalTroco`) e `scripts/testar-motor-caixa.mjs` (os 16 cenários já estavam em `testar-caixa-motor.mjs`). **Preservados sem exceção:** Central de prontidão (`/prontidao`, `/api/prontidao`, 5 arquivos), `/api/dfe/dist/route.ts`, coluna aditiva `nk_venda.status_comercial` (NULL no legado, sem conversão), `src/components/shell.tsx` com o link da prontidão, `tsconfig.json` com a exclusão dos espelhos de entrega, `ARQUIVOS_PARA_GITHUB/` e `public/downloads/` regenerados, e os quatro documentos de retomada. `scripts/smoke.sh` unificado: checagens do `main` (incluindo `POST /api/dfe/dist` com segredo errado = 401) + checagens da Arena (`/prontidao`, Dashboard, 401 do cron) + suíte com o **nome correto** `testar-caixa-motor.mjs`. Bateria **sem redução**: 219 verificações com `cx-1..cx-26` (a Arena tinha 200 com `cx-1..cx-10`). Nenhuma tabela legada apagada, nenhuma funcionalidade removida, nenhuma mudança de `DATABASE_URL`, Vercel, Supabase, RLS ou `package.json`.

17. **Etapa 1 (2026), FEITO — perfil `gerente` + migração aditiva da quebra.** `src/lib/permissoes.ts` ganhou `gerente` em `PERFIS_USUARIO`, `ROTULO_PERFIL`, `MATRIZ`, **mapeamento explícito em `normalizarPerfil()`**, e as ações `caixa.homologar` / `caixa.auditoria` em `PERMISSOES_ACAO` + `CATALOGO_PERMISSOES`; `administrador` continua com todas e `operador`/`vendedor` não mudaram. Consumidores atualizados: `src/views/Usuarios.tsx` (KPI da equipe), `src/server/diagnostico.ts` (`usr-6`). **Schema:** `nk_caixa_sessao` ganhou `status_aprovacao`, `homologado_por_usuario_id`, `fundo_troco`; nova tabela `nk_caixa_quebra_log` (SOBRA/FALTA, justificativa, homologação). Aplicação idempotente em `src/db/migracao.ts`, SQL consolidado em `src/lib/migracaoLegado.ts` (incluindo grant a `nkway_app`) e arquivo `supabase/migrations/20261106_caixa_quebra_aprovacao.sql`. `CaixaSessaoDto` expõe os novos campos como opcionais; `cx-23` valida a migração no diagnóstico. Sem RLS, sem Supabase Auth, sem `UPDATE` em legado, sem `package.json` ou `DATABASE_URL`. As regras de negócio (sangria, fechamento cego, PIN, fundo de troco) ficam para as próximas etapas.

18. **Etapa 2 (2026), FEITO — motor de gaveta, blind balance e fechamento às cegas no backend.** Constantes em `src/lib/caixa.ts`: `LIMITE_DINHEIRO_GAVETA = 800`, `LIMITE_BLOQUEIO_GAVETA = 960` (120%), `FUNDO_TROCO_PADRAO = 100`, helper puro `estadoGavetaPorSaldo()` e tipo de movimento `"cofre"` (ignorado pela apuração). `ApuracaoSessaoCaixa` ganhou `saldoDinheiroGaveta`, `estadoGaveta`, `bloquearVendaDinheiro`, `limiteDinheiroGaveta`, `fundoTrocoPadrao`. `src/server/caixaCore.ts` ganhou `obterEstadoGavetaSessao()` (devolve **só estado/boolean**, nunca valor) e `listarAuditoriaCaixa()` (join `nk_caixa_sessao` × `nk_caixa_quebra_log`). **Blind balance:** `src/app/(pdv)/pdv/page.tsx` não envia mais `totalEsperado`/`saldoDinheiro`; `src/views/Pdv.tsx` mostra rótulo de estado, dispara toast e bloqueia conclusão em dinheiro quando `bloquearVendaDinheiro`; `src/views/Caixa.tsx` abre modal com inputs **vazios**, sem conferência ao vivo e sem coluna “Esperado”. **Server Actions** em `src/server/acoes/caixa.ts`: `abrirCaixa()` provisiona automaticamente o fundo de troco do turno anterior, `fecharTurnoCego()` recalcula esperados no servidor, exige justificativa em quebra, valida PIN/senha de usuário com `caixa.homologar` via `confereSenha()`, grava `nk_caixa_quebra_log` (SOBRA/FALTA), gera movimento `"cofre"` e deixa R$ 100 provisionados; `homologarQuebraCaixa()` usa `exigirPermissao("caixa.homologar")` para aprovação remota. Conciliação TEF/PIX continua em `apurarSessaoCaixa` (fonte única, sem `GROUP BY` cru sobre `jsonb`). Diagnóstico: `cx-24` (estados) e `cx-25` (blind balance). **Etapa 2b (2026), FEITO — correção do ajuste de fechamento.** `ajustarCaixaFechado()` em `src/server/acoes/caixa.ts` **não sobrescreve mais `valoresEsperados` nem `totalEsperado`** (snapshot imutável do fechamento). Apenas `valoresInformados`, `diferencas`, `totalInformado`, `diferencaTotal` e `justificativaFechamento` são atualizados. O `deltaAjuste` compara o que foi informado agora contra o que estava informado antes, não contra um novo recálculo. Trilha de auditoria mantida. **Ainda pendente (Etapa 3):** o Modal React de fechamento no PDV, o campo de PIN na própria tela e a rota `/dashboard/auditoria-caixa` com o menu do gerente. Nenhuma mudança de infraestrutura, RLS, `package.json` ou `DATABASE_URL`.

19. **Etapa 3 (2026), FEITO — Modal de Fechamento Cego no PDV e Auditoria de Caixa.** Novo `src/components/ModalFechamentoCego.tsx` (`useState` + Tailwind), acionado pelo botão **Encerrar Turno** na própria tela de vendas (`src/views/Pdv.tsx`): inputs de Dinheiro / PIX / Crédito / Débito / Boleto / Prazo **iniciam vazios**, nenhum esperado é exibido; só após o servidor responder `requerHomologacao` o modal revela Justificativa + e-mail/PIN de gerente. `fecharTurnoCego()` passou a sinalizar esse estado no retorno. Nova rota **`src/app/(painel)/dashboard/auditoria-caixa/page.tsx`** → `/dashboard/auditoria-caixa`, exclusiva para quem tem `caixa.auditoria` (redirect para `/` caso contrário), com `src/views/AuditoriaCaixa.tsx`: tabela de turnos (OK / Com Quebra / Pendente), cruzamento Esperado × Declarado por forma, detalhe expansível e homologação remota via `homologarQuebraCaixa()` com senha conferida no servidor. `src/components/shell.tsx` ganhou o item de menu do gerente sem remover `/caixa`. `scripts/smoke.sh` cobre a nova rota; diagnóstico ganhou `cx-26` (**219 verificações**, `cx-1..cx-26`). Nenhuma mudança de infraestrutura, RLS, `package.json` ou `DATABASE_URL`.

## 6b. Blindagem das server actions (2026)

Toda ação de escrita está protegida contra corpo malformado — a causa do erro *“An unexpected response was received from the server”*.

| Helper em `src/server/tenant.ts` | Uso |
|---|---|
| `corpo(input)` | primeira linha das ações que recebem objeto: `input = corpo(input)` |
| `texto(v)` | substitui `input.x.trim()` / `.replace()` / `.toUpperCase()` |
| `numero(v)` | aceita `"1.234,56"`, `1234` e `null` → `0` |
| `cadeia(v)` | ações que recebem **string** (`trocarSenha(nova)`) |
| `logico(v)` | boleanos vindos do cliente |

Cobertura: **70** pontos de acesso direto trocados por `texto()`, **20** ações com guarda `corpo()`, **1** com `cadeia()`, e `export const FORMAS` removido de `pdv.ts` (objeto em arquivo `"use server"` quebrava 5 ações).

**Verificação:** `bash scripts/acoes.sh` varre os chunks de 12 telas, extrai os ids das server actions e as chama com `[null]` e `[{}]` — espera **0 erros 500**. Ids que devolvem 404 são de build antigo (`Failed to find Server Action`) e não contam. Rodar junto com `scripts/smoke.sh` a cada tarefa.

---

## 6c. Motor de caixa — predicado, matriz e roteiro (2026)

**Predicado central** (`src/lib/caixa.ts` → `classificarVendaCaixa` / `compoeCaixa` / `apurarSessaoCaixa`, após o alinhamento da Etapa 0): uma linha compõe o caixa quando pertence à `empresa_id` e à `caixa_sessao_id` solicitadas, é operação comercial concretizada, possui `pagamentos[]` válidos (ou fallback legado por `formaPagamento`), não é rascunho/orçamento, não está cancelada e não é duplicata fiscal. Chave/protocolo SEFAZ, nome de operador, terminal, data e horário **nunca** são critério.

**Identidade econômica:** `operacaoEconomicaId = davOrigemId ?? id`. `selecionarOperacoesCaixa()` deduplica por essa chave antes da apuração, com precedência: registro de origem → DAV concreto → venda filha. `registroFonteDoPagamento` é sempre a linha que guarda `pagamentos[]`; kardex só prova saída física, nunca é fonte financeira.

| Registro | `compoeCaixa` | `operacaoEconomicaId` | Fonte do pagamento | Efeito no esperado |
|---|---|---|---|---|
| Venda fiscal concreta | sim | próprio `id` | ela mesma | entra |
| Venda sem nota concreta | sim | próprio `id` | ela mesma | entra; NFC-e posterior é `UPDATE` na mesma linha |
| DAV orçamento / pré-venda | não (`dav_orcamento`) | próprio `id` | nenhuma | não entra |
| DAV comercial concreto | sim (`status_comercial='concretizado'`) | próprio `id` | ele mesmo | entra uma vez |
| DAV orçamento + venda filha | não / sim | `davOrigemId` | filha | **conta somente a filha** |
| DAV concreto + nota de fiscalização | sim / duplicata | `id` do DAV | DAV | **conta somente a operação original** |
| Nota sem DAV | sim | próprio `id` | ela mesma | entra |
| Cancelada | não (`cancelada`, auditável) | próprio `id` | ela mesma | bruto + estorno = líquido zero |

**Pagamentos divididos e troco** (`normalizarPagamentosCaixa`): soma cada parcela na sua forma, ignora parcela zero/negativa/inválida com aviso, usa `formaPagamento` só quando `pagamentos[]` não existe, `troco = somaRecebida - total` subtraído **exclusivamente do dinheiro**. Excedente sem dinheiro suficiente gera inconsistência (a operação é rejeitada no diagnóstico), sem reduzir PIX/cartão silenciosamente.

| Total | Recebido | Dinheiro | PIX | Crédito | Troco | Esperado |
|---|---|---|---|---|---|---|
| 100 | dinheiro 60 + PIX 40 | 60 | 40 | 0 | 0 | 100 |
| 100 | dinheiro 120 | 100 | 0 | 0 | 20 | 100 |
| 100 | dinheiro 30 + crédito 70 | 30 | 0 | 70 | 0 | 100 |
| 100 | dinheiro 40 + PIX 80 | 20 | 80 | 0 | 20 | 100 |
| 100 | PIX 120, sem dinheiro | 0 | 120 | 0 | 20 | **inconsistência** |
| 100 | legado sem `pagamentos[]`, `formaPagamento='credito'` | 0 | 0 | 100 | 0 | 100 |

**Boleto/prazo:** entram na própria forma como **recebimento esperado não físico** (geram `nk_conta` a receber com `vendaId`), nunca como dinheiro em gaveta e nunca geram troco. Cancelamento usa estorno explícito com `vendaId` quando existir; sem ele, o motor cria estorno implícito uma única vez. Estorno de venda que não pertence à sessão é ignorado com aviso.

**Roteiro manual curto (operador):**
1. Entrar com o operador, abrir o caixa com fundo de troco.
2. Registrar uma venda fiscal, uma venda sem nota e salvar um DAV como orçamento.
3. Faturar outro DAV com pagamento dividido (dinheiro + PIX) e troco somente em dinheiro.
4. Cancelar uma venda informando o motivo (estorno fica auditado).
5. Abrir `/caixa`, conferir os valores por forma e fechar com a confirmação; um segundo clique deve devolver mensagem clara de caixa já fechado.
6. No histórico, conferir que o snapshot do fechamento não mudou; um ajuste mexe apenas na conferência informada.
7. Opcional: abrir o console do dev / `/api/diagnostico` e confirmar **200/200** sem reprovações.

---

## 7. Como salvar (plataforma)

A prévia é reconstruída ao fim da conversa. Para versionar: baixe o projeto e faça commit/push pelo **GitHub Desktop** (cliques, sem linha de comando). Nunca coloque `service_role`, senha do A1 ou `.pfx` no repositório.

*NKWAY · contexto de retomada na plataforma · mantenha as seções 4 e 6 atualizadas a cada tarefa concluída.*
