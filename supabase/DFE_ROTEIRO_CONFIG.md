# Roteiro de configuração — Módulo DF-e (NF-e de entrada)

Objetivo: capturar automaticamente XML de NF-e emitidas **contra o CNPJ da loja** (destinatário), gravar no Supabase e importar no ERP (tela de tratamento).

Tempo estimado: **1 a 3 dias** (com certificado A1 em mãos e conta Supabase).

---

## O que você precisa antes de começar

| Item | Onde obter |
|---|---|
| Conta **Supabase** (projeto criado) | https://supabase.com |
| **CNPJ** da empresa destinatária | Contrato / cartão CNPJ |
| **Certificado digital A1** (arquivo `.pfx` ou `.p12`) | Contabilidade / Serasa / Certisign etc. |
| **Senha do A1** | A que foi definida na emissão do certificado |
| App NKWAY com build recente (módulos DF-e no menu) | Seu repositório / deploy |
| (Produção SEFAZ) Servidor pequeno para **mTLS** (Node) | Fly.io, Render, VPS ou PC servidor da loja |

**Não avance para produção SEFAZ sem A1 válido.** Em teste use o modo `demo`.

---

## Mapa do módulo (para não se perder)

```
[React] Certificado A1     → upload .pfx + senha cifrada
[React] DF-e / NF-e        → lista notas + botão Importar XML
[Postgres] empresas_config + nfe_entrada
[Storage] bucket certificados-a1
[Edge Function] dfe-dist   → consulta SEFAZ (ou demo) a cada 10 min
[Worker Node] (opcional)   → mTLS real com o A1
[Entradas]                 → tratamento (vínculo, margem, estoque)
```

Arquivos no projeto:
- `supabase/migrations/20260322_dfe_distribuicao.sql`
- `supabase/functions/dfe-dist/index.ts`
- `supabase/functions/dfe-dist/sefaz-mtls-worker.mjs`
- `src/erp/dfe/ConfigCertificado.tsx`
- `src/erp/dfe/DashboardNfe.tsx`

---

# FASE 1 — Projeto Supabase (30–60 min)

### 1.1 Criar / abrir o projeto
1. Acesse o [Dashboard Supabase](https://supabase.com/dashboard).
2. Abra o projeto do NKWAY (ou crie um novo).
3. Anote:
   - **Project URL** → será `VITE_SUPABASE_URL`
   - **anon public** key → será `VITE_SUPABASE_ANON_KEY`
   - **service_role** key → **só no servidor / secrets** (nunca no front nem no GitHub)

Onde achar: **Project Settings → API**.

### 1.2 Ativar autenticação (login)
1. **Authentication → Providers**.
2. Deixe **Email** habilitado (ou o provedor que você já usa no ERP).
3. Crie um usuário de teste (**Authentication → Users → Add user**)  
   **ou** use o fluxo de cadastro do próprio NKWAY se já estiver ligado ao Supabase Auth.

> O upload do certificado e o RLS exigem usuário **autenticado** (`auth.uid()`).

### 1.3 Conferir extensões
1. **Database → Extensions**.
2. Confirme (ou ative):
   - `pgcrypto`
   - `pg_cron` (se o plano permitir)
   - `pg_net` (opcional, para o cron chamar a function por HTTP)

---

# FASE 2 — Banco de dados (15–30 min)

### 2.1 Rodar a migration
1. No Supabase: **SQL → New query**.
2. Abra no seu PC o arquivo:
   `supabase/migrations/20260322_dfe_distribuicao.sql`
3. Copie **todo** o conteúdo e cole no SQL Editor.
4. Clique em **Run**.
5. Confira se não houve erro vermelho.

### 2.2 O que deve existir depois
Em **Table Editor**:
- `empresas_config`
- `nfe_entrada`

Em **Storage**:
- bucket `certificados-a1` (privado)

Em **Database → Functions** (ou via SQL):
- `dfe_salvar_empresa`
- `dfe_encrypt_password` / `dfe_decrypt_password`

### 2.3 Definir o segredo de criptografia da senha do A1
A senha do `.pfx` é cifrada no Postgres. Escolha uma frase longa (32+ caracteres).

**Opção A — temporária (teste):** no SQL Editor:

```sql
-- Só para a sessão atual de testes manuais; prefira Vault em produção
select set_config('app.dfe_secret', 'TROQUE_POR_UMA_CHAVE_LONGA_E_SECRETA_32+', false);
```

**Opção B — produção (recomendado):**  
Use **Supabase Vault** ou um secret de infraestrutura e alinhe a **mesma** string no secret da Edge Function `DFE_SECRET` (a RPC de decrypt no banco e a function precisam da mesma política que você adotou).

> Anote a chave em local seguro (cofre / gerenciador de senhas). Se perder, será preciso **reenviar** os certificados.

### 2.4 (Opcional) Ajustar o default do SQL
No script há fallback `CHANGE_ME_DFE_SECRET_MIN_32_CHARS!!`.  
Em produção **não** deixe esse valor: configure Vault/`DFE_SECRET` de verdade.

---

# FASE 3 — Variáveis do frontend NKWAY (15 min)

### 3.1 Arquivo `.env` na raiz do projeto
1. Na pasta do NKWAY (GitHub Desktop → **Repository → Show in Explorer**).
2. Se não existir `.env`, copie `.env.example` e renomeie a cópia para `.env`.
3. Preencha (exemplo):

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...sua_anon_key
```

4. **Não** coloque `service_role` no `.env` do Vite.
5. O arquivo `.env` já deve estar no `.gitignore` (não versionar).

### 3.2 Deploy (Netlify / Vercel / outro)
No painel do site, crie as **mesmas** variáveis de ambiente e **publique de novo** o front (rebuild).  
Variáveis `VITE_*` só entram no bundle na hora do **build**.

### 3.3 Conferência rápida no app
1. Abra o NKWAY.
2. Faça **login** (conta Supabase Auth).
3. Menu **Compras** deve mostrar:
   - **DF-e / NF-e recebidas**
   - **Certificado A1 (DF-e)**
4. Se ainda aparecer “modo demo” nessas telas, URL/key não entraram no build ou o login falhou.

---

# FASE 4 — Edge Function `dfe-dist` (30–90 min)

### 4.1 Secrets da function
No Dashboard: **Project Settings → Edge Functions → Secrets** (ou CLI).

| Secret | Valor | Obrigatório |
|---|---|---|
| `DFE_CRON_SECRET` | String aleatória longa (ex. 32+ chars) | Sim (cron) |
| `DFE_SECRET` | Mesma lógica de proteção da senha A1 | Sim se decrypt via app |
| `DFE_SEFAZ_MODE` | `demo` no início; depois `live` | Sim |
| `DFE_MTLS_WORKER_URL` | `https://seu-worker...` | Só em `live` |
| `DFE_MTLS_WORKER_SECRET` | Senha do worker | Só em `live` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` costumam já existir no ambiente das functions.

### 4.2 Publicar a function
Quem tiver Supabase CLI no ambiente de desenvolvimento:

```text
supabase functions deploy dfe-dist
```

(Se você não usa comando prompt, peça a um dev ou use o fluxo de deploy do seu CI.)

### 4.3 Teste em modo DEMO (sem certificado SEFAZ)
1. Secret: `DFE_SEFAZ_MODE=demo`.
2. Cadastre empresa + A1 no app (mesmo em demo o path é salvo; a SEFAZ não é chamada).
3. Em **DF-e / NF-e recebidas**, clique **⚡ Capturar agora**  
   **ou** chame a function com o header `x-dfe-cron-secret` e Bearer service_role.
4. Deve aparecer ao menos 1 documento **DEMO** na tabela.
5. Clique **Importar no ERP (XML)** → abre **Entrada de mercadoria** no tratamento.

**Critério de sucesso da Fase 4:** nota na lista + XML importável no ERP.

---

# FASE 5 — Certificado A1 no app (15 min)

1. Menu **Compras → Certificado A1 (DF-e)**.
2. Preencha:
   - CNPJ (14 dígitos)
   - Razão social
   - Arquivo **.pfx**
   - Senha do certificado
   - Ambiente: **Homologação (2)** para testes; **Produção (1)** só quando for real
3. **Salvar certificado e empresa**.
4. A empresa deve aparecer na tabela com NSU inicial `000000000000000`.

Problemas comuns:
| Sintoma | O que checar |
|---|---|
| Erro de login / RLS | Usuário autenticado? |
| Erro no Storage | Bucket `certificados-a1` e policies da migration |
| Erro na RPC | Migration rodou? `dfe_salvar_empresa` existe? |
| Senha inválida depois | Segredo pgcrypto/`DFE_SECRET` inconsistente |

---

# FASE 6 — Worker mTLS (somente produção / live) (1–3 h)

A SEFAZ exige **HTTPS com certificado do cliente (A1)**. O runtime Deno do Edge é limitado; o worker Node resolve.

### 6.1 Subir o worker
Arquivo: `supabase/functions/dfe-dist/sefaz-mtls-worker.mjs`

1. Crie um app Node 20 em **Fly.io**, **Render**, **Railway** ou VPS.
2. Variáveis:
   - `PORT=8787` (ou a do provedor)
   - `DFE_MTLS_WORKER_SECRET=outra_senha_longa`
3. Comando de start (exemplo): `node sefaz-mtls-worker.mjs`
4. URL pública HTTPS, ex.: `https://nkway-dfe-worker.fly.dev`

### 6.2 Ligar na Edge Function
Secrets:
```text
DFE_SEFAZ_MODE=live
DFE_MTLS_WORKER_URL=https://nkway-dfe-worker.fly.dev
DFE_MTLS_WORKER_SECRET=a_mesma_senha_do_worker
```

### 6.3 Teste live (homologação SEFAZ primeiro)
1. Ambiente da empresa = **2 (Homologação)** no cadastro A1.
2. **Capturar agora**.
3. Interprete `cStat` / `xMotivo` na linha da empresa:
   - **137** — nenhum documento (normal se não há DF-e)
   - **138** — documentos encontrados
   - **656** — consumo indevido → **pare**, espere ~1 hora, não fique clicando

### 6.4 Produção
1. Empresa com ambiente **1**.
2. A1 de **produção**.
3. Só então mude consultas para produção.
4. Prefira o **cron a cada 10 min**; evite “Capturar agora” em loop.

---

# FASE 7 — Agendar a cada 10 minutos (20–40 min)

### Opção A — Schedule no Dashboard Supabase
**Edge Functions → dfe-dist → Schedules** (se disponível no seu plano): a cada 10 minutos, com headers de autorização.

### Opção B — pg_cron + pg_net
1. Ative `pg_net` e `pg_cron`.
2. No SQL (ajuste PROJECT_REF e secrets):

```sql
select cron.schedule(
  'nkway-dfe-dist-10min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://PROJECT_REF.supabase.co/functions/v1/dfe-dist',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer SERVICE_ROLE_KEY_AQUI',
      'x-dfe-cron-secret', 'DFE_CRON_SECRET_AQUI'
    ),
    body := '{"origem":"pg_cron"}'::jsonb
  );
  $$
);
```

3. Veja jobs: `select * from cron.job;`

### Opção C — Cron externo
GitHub Actions / cron-job.org chamando o mesmo POST a cada 10 min (útil se pg_cron/pg_net não estiver disponível).

**Regra de ouro:** 1 empresa ≈ no máximo 1 consulta “pesada” por minuto; o código já espera 60s entre lotes e limita lotes por tick.

---

# FASE 8 — Uso no dia a dia da loja

### 8.1 Captura automática
- Cron roda → notas novas caem em **DF-e / NF-e recebidas**.

### 8.2 Importar no ERP
1. Abra **DF-e / NF-e recebidas**.
2. Localize a nota (filtro emitente ou chave).
3. **Importar no ERP (XML)**.
4. Vai para **Entrada de mercadoria** → **tela de tratamento**:
   - vincular produto fornecedor × cadastro
   - markup / margem / preço
   - quantidade
5. **Salvar entrada tratada**.
6. Na lista: **Lançar estoque**.

### 8.3 XML só para arquivo
Botão **XML** baixa o `.xml` no computador (backup / contador).

### 8.4 Resumo `resNFe`
Se a SEFAZ mandar **só resumo**, pode não haver XML completo de NF-e ainda.  
Aí é preciso **manifestação do destinatário** (ciência/confirmação) — módulo futuro — e nova distribuição para receber o `procNFe`.

---

# FASE 9 — Checklist de aceite (marque um a um)

**Infra**
- [ ] Migration sem erro
- [ ] Bucket `certificados-a1` privado
- [ ] `.env` / host com URL + anon key
- [ ] Login Auth funciona

**Demo**
- [ ] Empresa + A1 salvos
- [ ] `DFE_SEFAZ_MODE=demo`
- [ ] “Capturar agora” gera linha na tabela
- [ ] “Importar no ERP” abre tratamento
- [ ] Lançar estoque atualiza produto

**Live (homologação)**
- [ ] Worker mTLS no ar
- [ ] Secrets `live` + URL do worker
- [ ] Ambiente empresa = 2
- [ ] Consulta retorna 137 ou 138 (não 656 em loop)
- [ ] XML real parseia na Entrada

**Produção**
- [ ] Ambiente = 1, A1 produção
- [ ] Cron 10 min ativo
- [ ] Monitorar `ultimo_cstat` / `ultimo_xmotivo`
- [ ] Plano de renovação do A1 (30 dias antes)

---

# Problemas frequentes

| Situação | O que fazer |
|---|---|
| Tela diz modo demo / sem cloud | Falta `VITE_SUPABASE_*` no **build** |
| Upload A1 falha | Policies do Storage; path deve começar com `user_id/` |
| RPC salva empresa falha | Rode de novo a migration; confira login |
| Captura “Não autorizado” | `x-dfe-cron-secret` ou Bearer service_role |
| mTLS / certificado | Suba o worker Node; confira senha do PFX |
| cStat **656** | Pare consultas; espere ~1h; NSU já salvo não “volta atrás” à toa |
| XML vazio no import | Documento era só resumo; aguarde NF-e completa |
| CORS no worker | Worker já libera `*`; confira URL HTTPS |

---

# Segurança (obrigatório)

1. **Nunca** commit de `.pfx`, senha A1, `service_role` ou `DFE_*` no GitHub.  
2. Bucket de certificado **privado**.  
3. RLS ativo nas tabelas (já no SQL).  
4. Rotação de `DFE_CRON_SECRET` se vazar.  
5. Acesso ao Dashboard Supabase só para quem administra.  
6. Em produção, restrinja CORS do worker ao domínio do app (hoje está aberto para facilitar o teste).

---

# Ordem resumida (uma página)

1. Criar projeto Supabase + Auth  
2. Rodar SQL da migration  
3. Configurar segredo da senha A1  
4. `.env` / host: `VITE_SUPABASE_URL` + `ANON_KEY` → rebuild  
5. Deploy function `dfe-dist` + secrets (`demo` primeiro)  
6. Login no app → **Certificado A1** → salvar  
7. **Capturar agora** (demo) → importar ERP  
8. Subir worker mTLS → `live` + homologação SEFAZ  
9. Validar cStat → produção + cron 10 min  
10. Treinar a loja no fluxo DF-e → Entrada → estoque  

---

## Contatos / frases prontas

**Contador:**  
> “Preciso do certificado A1 (.pfx) e senha da empresa para o sistema baixar automaticamente as NF-e de compra (destinatário) na SEFAZ, como distribuição de DF-e.”

**DevOps / TI:**  
> “Publique a Edge Function `dfe-dist`, o worker `sefaz-mtls-worker.mjs` com mTLS, secrets DFE_*, e o cron de 10 minutos no endpoint da function.”

**Você no dia a dia:**  
> Menu Compras → DF-e → Importar no ERP → tratar → lançar estoque.

---

*Documento do projeto NKWAY · módulo DF-e · use junto com `20260322_dfe_distribuicao.sql` e a function `dfe-dist`.*
