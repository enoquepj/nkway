# NKWAY — ERP e PDV para Pequenos Negócios

Sistema de gestão com frente de caixa **offline-first**, emissão fiscal
simulada (NFC-e / NF-e / SAT), DAV, entrada de mercadoria por XML,
controle de estoque com kardex, MDF-e e cobrança por assinatura.

> ⚠️ **Demonstração funcional.** A emissão fiscal é simulada — não tem
> valor jurídico. Para produção é necessário integrar um emissor
> homologado (Focus NFe, PlugNotas) com certificado digital A1.

---

## Rodar localmente

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/index.html (arquivo único)
npm run preview    # testa o build de produção
```

---

## Publicar (grátis)

**Netlify Drop — 1 minuto, sem Git**

```bash
npm run build
```
Depois arraste a pasta `dist` em <https://app.netlify.com/drop>.

**Vercel com GitHub — atualização automática**

```bash
git remote add origin https://github.com/SEU_USUARIO/nkway.git
git branch -M main
git push -u origin main
```
Depois importe o repositório em <https://vercel.com/new>.

Os arquivos `netlify.toml` e `vercel.json` já estão configurados.

---

## Módulos

| Módulo | Descrição |
|---|---|
| **Dashboard** | KPIs, faturamento 7 dias, alertas de estoque, top produtos |
| **PDV** | Venda fiscal e DAV, offline-first com fila de sincronização |
| **Documentos** | DAVs e notas fiscais, faturamento de DAV em nota |
| **MDF-e** | Manifesto de transporte com DAMDFE e encerramento |
| **Entrada de mercadoria** | Importação de XML de NF-e, custo médio ponderado |
| **Gestão de estoque** | Posição atual, kardex e inventário |
| **Produtos / Clientes** | Cadastros com margem e histórico de compras |
| **Financeiro** | Contas a pagar e receber, baixa de títulos |
| **Planos** | Freemium com trial de 14 dias e paywall |
| **Console do dev** | 27 testes automatizados, inspetor de estado, simuladores |

---

## Acessos

**Sistema:** crie a conta na tela inicial (trial Pro de 14 dias).

**Console do desenvolvedor:** `Ctrl + Shift + D` → senha do desenvolvedor (definida pelo proprietário, não documentada)

---

## Modo de dados

| Modo | Quando | Onde ficam os dados |
|---|---|---|
| **Demo** | sem variáveis de ambiente | `localStorage` do navegador |
| **Nuvem** | com Supabase configurado | Postgres, isolado por empresa (RLS) |

Para ativar a nuvem: rode `supabase/schema.sql` no Supabase e defina
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (ver `.env.example`).

---

## Documentação

- [`MEMORANDO.md`](MEMORANDO.md) — **índice de acesso** e configurações futuras (comece por aqui se for configurar o sistema)
- [`CONTEXTO.md`](CONTEXTO.md) — memória do projeto para retomar em novos chats de IA
- [`supabase/DFE_ROTEIRO_CONFIG.md`](supabase/DFE_ROTEIRO_CONFIG.md) — configurar DF-e / NF-e de entrada (Supabase + A1 + SEFAZ)
- [`DEPLOY.md`](DEPLOY.md) — hospedagem, custos e passo a passo
- [`DEV.md`](DEV.md) — ambiente de desenvolvedor e roteiro de testes
- [`supabase/schema.sql`](supabase/schema.sql) — schema multi-tenant

---

## Stack

React 19 · TypeScript · Vite 7 · Tailwind 4 · Supabase
