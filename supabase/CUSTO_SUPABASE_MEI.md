# Supabase 100% para o NKWAY — custo × benefício (MEI / ME / Simples)

## Recomendação

**Sim: use o Supabase como backend principal** para MEI e ME no Simples.

| Critério | Avaliação |
|---|---|
| Custo inicial | **Excelente** (Free generoso para 1–20 lojas pequenas) |
| Complexidade | Média (Auth + RLS + SQL já no projeto) |
| Adequação MEI/ME | Alta (multi-empresa, backup na nuvem, acesso de qualquer PC) |
| Quando **não** basta | Dezenas de lojas grandes, TEF on-premise, SAT local pesado, BI pesado |

O PDV pode continuar com **cache local (localStorage/fila offline)** e gravar na nuvem quando houver internet — melhor dos dois mundos para mercearia/MEI.

---

## O que “100% Supabase” significa no NKWAY

| Função | Onde fica |
|---|---|
| Login | Supabase Auth |
| Empresa, produtos, clientes, vendas, financeiro | Postgres (`schema.sql` + RLS) |
| Certificado A1 + NF-e entrada (DF-e) | Storage + tabelas DF-e + Edge Function |
| Front (telas) | Vercel (HTML/JS) |
| Emissão NFC-e real | Provedor fiscal **à parte** (não é o Free do Supabase) |

---

## Custos aproximados (ordem de grandeza, 2026)

### Supabase (por projeto)

| Plano | Quando usar | Ordem de custo |
|---|---|---|
| **Free** | Você + poucos clientes piloto, pouco storage | **R$ 0** |
| **Pro** | Vários MEI/ME, Auth estável, backups | ~**US$ 25/mês** por projeto (verifique o site) |

No Free atual (valores mudam — confira o site):
- DB ~500 MB  
- Storage limitado  
- Auth com limites  
- Edge Functions com cota  
- Projeto pode pausar após inatividade  

**Para 10–50 MEI** com cadastro leve (milhares de produtos no máximo, não milhões de linhas): Free ou **um Pro** costuma bastar no início.

### Vercel (front)
- Hobby: **R$ 0** para o site do ERP  
- Domínio `.com.br`: ~**R$ 40–80/ano**

### O que **não** está no Supabase Free
| Item | Custo típico extra |
|---|---|
| Certificado A1 | ~R$ 200–400/ano **por empresa** (cliente compra) |
| Emissor NFC-e (Focus etc.) | mensalidade por CNPJ (varia) |
| TEF | mensalidade + por transação (adquirente) |
| Contabilidade / suporte seu | seu modelo de plano (ex. Pro R$ 49–89/mês cobrado do lojista) |

### Conta de padaria (exemplo)

| Item | Você (NKWAY SaaS) | Lojista MEI |
|---|---|---|
| Supabase Free/Pro | R$ 0–150/mês no início | — |
| Vercel + domínio | R$ 0 + domínio | — |
| Plano cobrado do lojista | receita | R$ 0 trial → R$ 49–89/mês |
| A1 + NFC-e | — | custo dele com contador/provedor |

**Conclusão financeira:** o gargalo de custo para o **lojista** não é o Supabase; é **A1 + emissão fiscal + TEF**. O Supabase é barato o bastante para ser o “cérebro” do NKWAY.

---

## Benefícios para MEI / ME / Simples

1. **Não perde dados** se formatar o PC  
2. **Dono + contador** podem ver (com usuários)  
3. **Celular/outro PC** com o mesmo login  
4. **DF-e** e backup de XML no mesmo lugar  
5. Você opera **um backend** para muitos clientes (RLS por empresa)

## Riscos / mitigações

| Risco | Mitigação |
|---|---|
| Free pausa | Pro barato ou ping de keep-alive |
| Estouro de storage (muitos XML) | Limpar resumos; guardar XML zipado; Pro |
| Offline na feira | Manter fila offline do PDV + sync |
| Fiscal real | Provedor externo; Supabase só orquestra dados |

---

## Arquitetura recomendada (custo-benefício)

```
[Vercel] NKWAY React
    ↓ Auth + REST
[Supabase] Auth + Postgres + Storage + Edge (DF-e)
    ↓ (futuro)
[Provedor NFC-e] só quando for emitir nota de verdade
[TEF] só quando houver maquininha
```

**Não** hospede o front “dentro” do Supabase: Vercel Free + Supabase Free/Pro é o combo mais barato e simples.

---

## Checklist para “ligar 100% nuvem” no produto

1. `schema.sql` + migration MEI (`20260322_mei_simples_cloud.sql`)  
2. Migration DF-e (já feita)  
3. `VITE_SUPABASE_*` na Vercel + redeploy  
4. Todo cadastro/venda passando por `cloud.ts` (evolução contínua do store)  
5. PDV: grava local + envia nuvem (já há offline)  
6. Monitorar uso no painel Supabase (Database → Usage)

---

## Resposta direta

> **Vale a pena o sistema “totalmente no Supabase” para MEI/ME/Simples?**  
> **Sim.** Melhor custo-benefício no início: Free/Pro barato, multi-empresa com RLS, Auth pronto, Storage para A1.  
> O que **não** deve ir “só no Supabase” é a **emissão SEFAZ/TEF** — use provedores; o Supabase guarda o resultado e a operação da loja.
