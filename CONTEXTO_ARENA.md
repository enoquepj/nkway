# CONTEXTO NKWAY · retomada na plataforma (Arena / Next.js + PostgreSQL)

> Este arquivo substitui o `CONTEXTO.md` do protótipo Vite **enquanto o projeto estiver nesta plataforma**.
> Fonte de verdade do produto: https://github.com/enoquepj/nkway (`CONTEXTO.md`, `MEMORANDO.md`, `supabase/DFE_ROTEIRO_CONFIG.md`).

---

## 0. Cole isto na próxima conversa (bloco único)

```
CONTINUAR NKWAY (plataforma Next.js)
1. Abra SOMENTE /CONTEXTO_ARENA.md e siga o mapa de arquivos — não reescreva a stack.
2. Rode `bash scripts/smoke.sh` e confirme que typegen/tsc/build passam e todas as rotas devolvem 200.
3. Estado: 11 módulos portados do protótipo Vite/Supabase para Next.js 16 (App Router) + Drizzle/Postgres, multi-tenant por empresa_id.
4. Tarefa agora: (escreva aqui — ou deixe vazio para a seção 6 "pendências").
5. Regras da plataforma: nunca editar package.json (usar a ferramenta de instalar pacotes); validar com typegen + tsc --noEmit + npm run build + build_and_start; não subir next dev/next start manual.
6. Linguagem simples, UI em português, um caminho por vez.
```

Custo médio de uma retomada bem feita: **6 a 10 passos** (ler este arquivo → smoke → editar → smoke → build_and_start).

---

## 1. Como rodar / validar (ordem exata)

```bash
npx drizzle-kit push --force          # aplica schema.ts no Postgres local
npm run build                         # ou o tool build_and_start da plataforma
bash scripts/smoke.sh                 # typegen + tsc + build + teste HTTP de todas as rotas
```

- Env: só `DATABASE_URL` é obrigatório (`.env`).
- Seed automático: `src/instrumentation.ts` chama `semearAmbiente()` no boot (idempotente).
  - Login demo: **demo@nkway.com.br / nkway123**
  - Desligar: `NKWAY_SEED=off`
- Build da plataforma é gerenciado pelo runtime: use a ferramenta `build_and_start` (ela checa `/api/health`), nunca `npm run start`.

## 2. Mapa de arquivos

| Onde | O que é |
|---|---|
| `src/db/schema.ts` | 14 tabelas `nk_*` (empresa, usuario, produto, cliente, fornecedor, venda, venda_item, movimento, entrada, devolucao, **inutilizacao**, **evento_fiscal**, conta, mdfe) |
| `src/db/seed.ts` | ambiente demo: 23 produtos, ~200 vendas em 30 dias, DAVs, entradas (XML/SEFAZ/manual), kardex, financeiro, MDF-e |
| `src/lib/dominio.ts` | moeda/data, chave SEFAZ 44 dígitos + DV, GTIN, custo médio, situações de estoque, curva ABC, `PLANOS_CFG` |
| `src/lib/filtros.ts` | base de filtros (`casaTexto`, `lerNumero`, `emPeriodo`, `alternarItem`) |
| `src/lib/xmlNfe.ts` | parser de XML de NF-e + `notaPorChaveDemo` (chave 44 dígitos) |
| `src/lib/session.ts` | cookie assinado HMAC, `hashSenha`/`confereSenha` (scrypt-like), `contexto()` = tenant |
| `src/server/dados.ts` | todas as leituras (painel, produtos, vendas, entradas, kardex, contas, curva ABC) |
| `src/server/diagnostico.ts` | console do dev: 99 testes (16 módulos) → `Diagnostico` |
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
| `src/app/(painel)/*/page.tsx` | páginas finas: `contexto()` → `dados` → `<View />` |

## 3. Convenções que o projeto segue

- **numeric sempre** `numeric(name, { precision, scale, mode: "number" })` e `.default(0)` (número, não string).
- Views = `"use client"` recebendo **dados serializáveis**; nenhuma função como prop vinda de server component.
- Ações em `"use server"`, resolvent o tenant por sessão (`tenant()`), retornam `{ok:true,…} | {ok:false, erro}` e chamam `revalidatePath`.
- Dinheiro: `round2` nas pontas; estoque com 3 casas; custo com 4.
- Toda saída de estoque gera linha em `nk_movimento` (kardex) com `saldoApos` e `custoMedioApos`.
- Rótulos de UI em português; prefixo `nkway.` para chaves de navegador.

## 4. Armadilhas que custaram tempo (não repita)

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
14. O seed é idempotente pelo e-mail `demo@nkway.com.br`: para recriar os dados depois de mudar o seed, `truncate nk_usuario, nk_produto, … nk_empresa cascade;` e reinicie a prévia (`build_and_start`).

## 5. Produtos vs protótipo (o que mudou na portabilidade)

| Protótipo (Vite/Supabase) | Aqui (Next/Drizzle) |
|---|---|
| `store.tsx` + localStorage | Postgres multi-tenant + server actions |
| fila offline no navegador | fila local só do PDV (`nkway.fila`) com botão sincronizar + persistência real no resto |
| `auth.tsx` contas no navegador | login e-mail/senha com cookie assinado, papéis owner/operador |
| DAV/nota em memória | `nk_venda` com `tipo`/`status`, DAV → `faturarDav` gera nota e baixa estoque |
| `Entradas.tsx` com filtros pendentes | **feito**: status, fornecedor, período, origem, faixa de valor, divergência, sem vínculo, filtros salvos |
| `DevConsole` (Ctrl+Shift+D, 27 testes) | ainda não portado |
| DF-e / certificado A1 (edge function) | telas prontas em Config; integração real pendente |

## 6. Pendências (ordem recomendada)

1. ~~Testes do console do dev~~ **FEITO (2026)** — `src/server/diagnostico.ts` (74 verificações) → `GET /api/diagnostico` + `<PainelDiagnostico />` na aba **Ambiente** das Configurações. 12 módulos: Núcleo, Entrada XML, Cadastros, PDV, Estoque, Compras, Financeiro, MDF-e, Clientes, Fornecedores, Fiscal, Ambiente. O `smoke.sh` também imprime o resumo e lista as falhas. Validadores em `src/lib/dominio.ts`: `validarCpf`, `validarCnpj`, `documentoValido`, `dvChaveAcesso`, `validarChaveAcesso`. Hoje são **14 módulos** (Núcleo, Entrada XML, Cadastros, PDV, Estoque, Compras, Devoluções, Financeiro, MDF-e, Clientes, Fornecedores, Fiscal, Ambiente, QR Code).
2. ~~Impressão DANFE/DAMDFE com layout 80 mm e QR Code~~ **FEITO (2026)** — `src/components/Impressao.tsx` (DANFE NFC-e 80 mm, DANFE NF-e A4, DAMDFE A4) + `src/components/QrCode.tsx` (SVG) + `src/lib/danfe.ts` (payload do QR, chave em blocos, tributos da Lei 12.741) + `src/lib/qrcode.ts` (gerador próprio). Impressão via CSS `@media print` com `visibility` (esconder por `display` derruba o modal).
3. ~~Devoluções de compra~~ **FEITO (2026)** — tabela `nk_devolucao` (CFOP, `chaveReferente` = NFref, itens jsonb) + `src/server/acoes/devolucoes.ts` (`emitirDevolucao`, `cancelarDevolucao`, `itensDaEntrada`) + `src/views/Devolucoes.tsx` em `/devolucoes`. CFOP escolhido por UF com `cfopDevolucao()` (`src/lib/dominio.ts`), valida `validarChaveAcesso` da entrada antes de emitir, baixa estoque item por item com linha no kardex (`tipo: "devolucao"`, qtd negativa) e cria crédito (conta a receber, categoria `Devoluções`). Cancelamento restaura o estoque.
4. ~~Inutilização de numeração e carta de correção~~ **FEITO (2026)** — tabelas `nk_inutilizacao` e `nk_evento_fiscal` + `src/server/acoes/numeracao.ts` (`inutilizarNumeracao`, `cancelarInutilizacao`, `emitirCartaCorrecao`, `proximoNumeroNota`) + `src/views/Numeracao.tsx` (aba **Numeração e eventos** em Documentos). Justificativa de 15–255 caracteres, recusa número já emitido, máximo 500 por pedido, faixa sobreposta bloqueada. Carta de correção (evento 110110) valida chave, protocolo, texto ≥ 15 e **rejeita correção de valor/quantidade/CNPJ/CFOP/NCM/data**; limite de 20 eventos por documento. `proximoNumeroFiscal()` em `src/server/dados.ts` é a implementação única usada pelo PDV e pelo painel — pula intervalos inutilizados.
5. DF-e real: captura de NF-e por worker mTLS + bucket privado (roteiro do repo), `dfe-dist`.
6. Assinatura com gateway (recorrência por CNPJ) no lugar do `alterarPlano` simulado.
7. `Venda.contraparteId` em vez de vínculo por nome (`citaNome`).
8. Campos ➕ do `FILTROS.md` que faltam em Produtos/Clientes.

## 7. Como salvar (plataforma)

A prévia é reconstruída ao fim da conversa. Para versionar: baixe o projeto e faça commit/push pelo **GitHub Desktop** (cliques, sem linha de comando). Nunca coloque `service_role`, senha do A1 ou `.pfx` no repositório.

*NKWAY · contexto de retomada na plataforma · mantenha as seções 4 e 6 atualizadas a cada tarefa concluída.*
