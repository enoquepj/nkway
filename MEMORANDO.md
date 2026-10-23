# MEMORANDO — Acesso aos arquivos e configurações futuras (NKWAY)

**Objetivo:** em qualquer momento (você, TI, contador ou um chat novo de IA), saber **onde está** cada instrução e **o que fazer** sem recomeçar do zero.

**Repositório:** https://github.com/enoquepj/nkway · branch `main`  
**Atualizado em:** 2026-03-22 (módulo DF-e + roteiro de configuração)

---

## 1. Ordem de leitura (recomendado)

| Prioridade | Arquivo | Para quê |
|---|---|---|
| 1º | **`CONTEXTO.md`** | Memória do projeto: stack, o que já foi feito, preferências do usuário, próxima tarefa, mensagem **CONTINUAR** |
| 2º | **`MEMORANDO.md`** (este) | Índice de acessos e configurações |
| 3º | **`supabase/DFE_ROTEIRO_CONFIG.md`** | Passo a passo completo do módulo **DF-e / NF-e de entrada** |
| 4º | Demais `.md` da raiz | Deploy, GitHub Desktop, filtros, checklist, dev |

---

## 2. Configurações críticas — onde estão

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
| Telas no app | Menu **Compras → Certificado A1 (DF-e)** e **DF-e / NF-e recebidas** · código em `src/erp/dfe/` |

**Front (Vite) — só estas no `.env`:**
```env
VITE_SUPABASE_URL=https://SEU_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```
Opcional (bridge antigo por chave pontual): `VITE_NFE_BRIDGE_URL=`

**Nunca no front / nunca no GitHub:** `service_role`, senha do A1, arquivo `.pfx`, secrets `DFE_*`.

### 2.2 Entrada de mercadoria (ERP)
| O quê | Onde |
|---|---|
| XML, chave SEFAZ (demo/bridge), manual, tratamento | `src/erp/pages/Entradas.tsx` |
| Parse XML / importar por chave | `src/erp/xmlNfe.ts` |
| Manutenção de preços / markup / massa | `src/erp/pages/ManutencaoPrecos.tsx` |

### 2.3 Publicar código no GitHub (seu PC)
| O quê | Onde |
|---|---|
| Preferência: **GitHub Desktop**, cliques, sem comando prompt | `CONTEXTO.md` → Preferências |
| Backup .zip do app | Botão amarelo **Contexto / Backup** no app |
| Guia antigo GitHub | `GITHUB.md` |
| Deploy Netlify/Vercel | `DEPLOY.md` |

### 2.4 Outros guias
| Arquivo | Conteúdo |
|---|---|
| `FILTROS.md` | Especificação de filtros por módulo |
| `CHECKLIST.md` | QA antes de publicar |
| `DEV.md` | Console do desenvolvedor |
| `README.md` | Visão geral do produto |

---

## 3. Como um chat novo de IA retoma o trabalho

Cole no chat novo (também está na seção 0 do `CONTEXTO.md`):

```
CONTINUAR NKWAY
Repositório: https://github.com/enoquepj/nkway
Branch: main

1. Clone e leia SOMENTE CONTEXTO.md e MEMORANDO.md primeiro.
2. Para DF-e, use supabase/DFE_ROTEIRO_CONFIG.md.
3. Restaure pela seção 2 do CONTEXTO.md e rode npm run build.
4. Siga Preferências: "comando prompt" (nunca "terminal"); GitHub Desktop com cliques; sem git no PC do usuário.
5. Execute a seção 7 do CONTEXTO ou a tarefa que eu descrever.
```

Se o repositório estiver **privado**, deixe público temporariamente ou envie token **só de leitura**.

---

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
