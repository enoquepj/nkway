# NKWAY — Guia de Hospedagem e Custos

## 1. O que o projeto é hoje

Aplicação **100% frontend** (React + Vite + Tailwind). O build gera um
**único arquivo `dist/index.html`** com todo o HTML, CSS e JS embutidos.

Consequências:

- **Não existe servidor.** Nada roda "do lado de fora"; tudo executa no navegador do usuário.
- Os dados ficam em `localStorage`, ou seja, **presos ao navegador de cada pessoa**.
- Por isso, hospedar hoje custa **R$ 0**.

---

## 2. Hospedagem da fase atual (demo / validação)

Qualquer host estático serve. Recomendados:

| Serviço | Plano grátis | Domínio próprio | Observação |
|---|---|---|---|
| **Vercel** | Sim, generoso | Sim, grátis | Mais simples, deploy via GitHub |
| **Netlify** | Sim | Sim, grátis | Permite arrastar a pasta `dist` |
| **Cloudflare Pages** | Sim, ilimitado | Sim, grátis | Melhor desempenho global |
| **GitHub Pages** | Sim | Sim | Exige repositório público no plano free |

### Deploy mais rápido (sem Git)

```bash
npm run build
```

Depois arraste a pasta `dist` em <https://app.netlify.com/drop>.
O site fica no ar em segundos, com HTTPS.

### Deploy recomendado (com Git e atualização automática)

```bash
git init && git add . && git commit -m "NKWAY"
git remote add origin <url-do-seu-repo>
git push -u origin main
```

Depois, em vercel.com → *Add New Project* → importe o repositório.
Configurações: build `npm run build`, output `dist`.
A partir daí, todo `git push` publica a nova versão automaticamente.

### Custo desta fase

| Item | Custo |
|---|---|
| Hospedagem | R$ 0 |
| HTTPS/SSL | R$ 0 (incluso) |
| Domínio `.com.br` | ~R$ 40/ano (registro.br) |
| **Total** | **~R$ 3/mês** |

---

## 3. Hospedagem da fase comercial (cobrando dos clientes)

Para vender, é obrigatório ter backend: os dados precisam estar na nuvem,
sincronizados entre dispositivos, e o plano pago **não pode** ser controlado
pelo navegador (hoje qualquer um liberaria o Pro pelo console).

### Arquitetura recomendada

```
Navegador (este app)
        │
        ├── Supabase  →  login, banco Postgres, isolamento por empresa
        ├── Stripe/Asaas  →  cobrança recorrente + webhook que libera o plano
        └── Focus NFe / PlugNotas  →  emissão de NF-e / NFC-e
```

### Custos mensais estimados

| Serviço | Grátis até | Depois |
|---|---|---|
| **Vercel** (frontend) | Uso pessoal/baixo | US$ 20/mês no Pro |
| **Supabase** (banco + auth) | 500 MB, 50k usuários | US$ 25/mês |
| **Stripe / Asaas** | Sem mensalidade | ~3,99% + R$0,39 por venda |
| **Focus NFe** (fiscal) | — | a partir de ~R$ 50/mês |
| **Domínio** | — | ~R$ 40/ano |

**Resumo realista:**

- **0 a 30 clientes:** ~R$ 0–60/mês (tudo nos planos gratuitos)
- **30 a 300 clientes:** ~R$ 300–500/mês
- Com 30 clientes pagando R$ 89, a receita é ~R$ 2.670/mês — a infra fica
  abaixo de 10% do faturamento, que é saudável para SaaS.

---

## 4. Como você acessa e administra

| Necessidade | Onde |
|---|---|
| Ver/editar o código | Este projeto (pasta `src`) |
| Publicar atualização | `git push` ou novo `npm run build` + upload |
| Ver acessos e logs | Painel da Vercel/Netlify |
| Ver clientes e dados | Painel do Supabase (Table Editor) |
| Ver assinaturas e receita | Dashboard do Stripe/Asaas |
| Seu domínio | Painel do registro.br apontando para a Vercel |

Todos esses painéis são web, acessados com **seu e-mail e senha**.
Nada exige servidor próprio, VPS ou manutenção de máquina.

---

## 5. O que NÃO recomendo

- **VPS / servidor dedicado** (Locaweb, Hostgator, AWS EC2): custa mais caro,
  exige você cuidar de atualização, backup e segurança. Sem vantagem aqui.
- **Hospedagem compartilhada com cPanel**: funciona para a demo estática, mas
  não suporta bem a fase com backend.

---

## 6. PASSO A PASSO — colocar no ar agora (grátis)

### Opção A — Netlify Drop (1 minuto, sem conta técnica)

1. Rode no comando prompt:
   ```bash
   npm run build
   ```
2. Abra <https://app.netlify.com/drop>
3. **Arraste a pasta `dist`** para a página
4. Pronto: o site sobe com HTTPS em algo como
   `https://nkway-abc123.netlify.app`
5. Em *Site settings > Change site name* você troca para `nkway.netlify.app`

### Opção B — Vercel com GitHub (atualização automática)

```bash
git init
git add .
git commit -m "NKWAY ERP"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/nkway.git
git push -u origin main
```

Depois em <https://vercel.com/new>: importe o repositório.
O `vercel.json` já está no projeto, então ele detecta tudo sozinho.
A partir daí, cada `git push` publica a nova versão.

### Opção C — Cloudflare Pages

<https://pages.cloudflare.com> → *Create project* → conecte o GitHub →
build command `npm run build`, output `dist`.

---

## 7. Ativar o modo nuvem (Supabase)

Enquanto não houver variáveis de ambiente, o NKWAY roda em **modo demo**
(dados no navegador). Para ativar o modo nuvem:

1. Crie um projeto grátis em <https://supabase.com>
2. Abra **SQL Editor** e cole todo o conteúdo de `supabase/schema.sql` → *Run*
3. Vá em **Project Settings > API** e copie `Project URL` e `anon public key`
4. No painel da Netlify/Vercel, em *Environment variables*, adicione:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   ```
5. Clique em **Redeploy**

O rodapé do menu lateral mostra o modo atual:
🟡 *Modo demonstração* ou 🟢 *Conectado à nuvem*.

---

## 8. Ordem sugerida

1. **Hoje:** publicar a demo na Vercel (grátis) e mostrar para clientes reais
2. **Validou interesse:** registrar domínio e CNPJ
3. **Primeiros interessados:** migrar para Supabase (dados na nuvem + login real)
4. **Primeira venda:** conectar Asaas/Stripe com webhook liberando o plano
5. **Escala:** adicionar emissor fiscal e suporte
