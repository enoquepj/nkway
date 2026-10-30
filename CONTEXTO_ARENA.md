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
| `src/db/schema.ts` | 10 tabelas `nk_*` (empresa, usuario, produto, cliente, fornecedor, venda, venda_item, movimento, entrada, conta, mdfe) |
| `src/db/seed.ts` | ambiente demo: 23 produtos, ~200 vendas em 30 dias, DAVs, entradas (XML/SEFAZ/manual), kardex, financeiro, MDF-e |
| `src/lib/dominio.ts` | moeda/data, chave SEFAZ 44 dígitos + DV, GTIN, custo médio, situações de estoque, curva ABC, `PLANOS_CFG` |
| `src/lib/filtros.ts` | base de filtros (`casaTexto`, `lerNumero`, `emPeriodo`, `alternarItem`) |
| `src/lib/xmlNfe.ts` | parser de XML de NF-e + `notaPorChaveDemo` (chave 44 dígitos) |
| `src/lib/session.ts` | cookie assinado HMAC, `hashSenha`/`confereSenha` (scrypt-like), `contexto()` = tenant |
| `src/server/dados.ts` | todas as leituras (painel, produtos, vendas, entradas, kardex, contas, curva ABC) |
| `src/server/acoes/*.ts` | escrituras: `auth cadastros config entradas estoque financeiro pdv transporte` |
| `src/components/ui.tsx` | Card/Badge/Button/Campo/Filtro\*/Modal/Kpi/Toast + `FiltrosSalvos` (localStorage `nkway.filtros.*`) |
| `src/components/Tabela.tsx` | ordenação, paginação, CSV (BOM + `;`) |
| `src/components/shell.tsx` | sidebar grafite + topbar com trial/plano/ambiente |
| `src/views/*.tsx` | 11 telas (Login, Dashboard, Pdv, Documentos, Entradas, Estoque, Produtos, Clientes, Financeiro, Relatorios, Transporte, Config) |
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
5. Clientes do template: `read_file`/`bash` só enxergam caminhos a partir da raiz do projeto (nada de `../`).
6. Tabela de UI com `render` precisa viver em client component; senão quebra ao passar função do servidor.
7. Não clonar o repo inteiro dentro do projeto: `git clone --depth 1 … /tmp/nkway` e ler só o que interessa.
8. Criar arquivo novo + importar antes de existir gera erro "Cannot find module" — crie a view na mesma leva.

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

1. Testes do console do dev (porta `src/dev/testes.ts` → rota `/api/diagnostico` + aba Ambiente).
2. Impressão DANFE/DAMDFE com layout 80 mm e QR Code (SVG próprio, sem lib).
3. Devoluções de compra (CFOP 5201/6201, `NFref` da nota de entrada) + baixa de estoque.
4. Inutilização de numeração e evento de carta de correção.
5. DF-e real: captura de NF-e por worker mTLS + bucket privado (roteiro do repo), `dfe-dist`.
6. Assinatura com gateway (recorrência por CNPJ) no lugar do `alterarPlano` simulado.
7. `Venda.contraparteId` em vez de vínculo por nome (`citaNome`).
8. Campos ➕ do `FILTROS.md` que faltam em Produtos/Clientes.

## 7. Como salvar (plataforma)

A prévia é reconstruída ao fim da conversa. Para versionar: baixe o projeto e faça commit/push pelo **GitHub Desktop** (cliques, sem linha de comando). Nunca coloque `service_role`, senha do A1 ou `.pfx` no repositório.

*NKWAY · contexto de retomada na plataforma · mantenha as seções 4 e 6 atualizadas a cada tarefa concluída.*
