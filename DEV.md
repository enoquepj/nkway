# NKWAY — Ambiente de Desenvolvedor

## 1. Como acessar

O console fica **oculto e protegido por senha**.

| Caminho | Como |
|---|---|
| **Atalho** | `Ctrl + Shift + D` → abre a tela de senha |
| **URL** | `?dev=1` → ex.: `http://localhost:5173/?dev=1` |
| **Bloquear** | `Ctrl + Shift + D` de novo, ou o botão na faixa roxa |

### 🔑 Senha do desenvolvedor

A senha **não fica escrita** no código nem na documentação. Em
`src/erp/dev/devAuth.ts` existe apenas o **hash SHA-256** dela
(constante `HASH_PADRAO`). Guarde a senha com você.

Opcionalmente você pode definir uma senha pessoal apenas para o seu
navegador em: Console → aba *Simuladores* → **🔐 Senha do console**.
O botão *↺ Restaurar senha definitiva* volta para a senha do `HASH_PADRAO`.

**Para trocar a senha definitiva:**

```bash
node -e 'console.log(require("crypto").createHash("sha256").update("nkway::NOVA_SENHA").digest("hex"))'
```

Cole o resultado em `HASH_PADRAO` e incremente `VERSAO_SENHA` no mesmo
arquivo. Assim o hash antigo salvo nos navegadores é descartado.

### Proteções implementadas

- Senha guardada como **hash SHA-256** (Web Crypto), nunca em texto puro
- **5 tentativas** e depois **bloqueio de 5 minutos**, com contador
- Sessão expira ao bloquear; nova entrada exige a senha de novo

### ⚠️ Limite desta proteção

Validação no frontend é **barreira de conveniência**, não segurança real.
Todo o código roda no navegador e pode ser inspecionado. Para produção,
controle no servidor:

```sql
-- no Supabase, a coluna já existe em usuarios.papel
alter table usuarios drop constraint if exists usuarios_papel_check;
alter table usuarios add constraint usuarios_papel_check
  check (papel in ('admin','vendedor','financeiro','dev'));
```

E no app, liberar o console só quando `perfil.papel === 'dev'`.

Chaves usadas: `nkway.dev` (sessão), `nkway.dev.hash` (hash da senha),
`nkway.dev.tentativas` (bloqueio).

---

## 2. Rodar o projeto

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # gera dist/index.html
npm run preview  # testa o build de produção
```

---

## 3. As quatro abas do console

### ✅ Testes de módulo
Bateria de ~27 verificações rodando **sobre o estado real** do sistema,
agrupadas por módulo. Falhas marcadas como `CRÍTICO` indicam quebra de
regra de negócio.

| Módulo | O que valida |
|---|---|
| Cadastros | preço ≥ custo, estoque não negativo, SKU único |
| PDV | bloco fiscal presente, chave 44 dígitos, DAV sem fiscal, aritmética do total |
| Fiscal | gerador de chave e formato numérico |
| Entrada XML | parser lê exemplo, extrai CNPJ/NCM/CFOP, rejeita inválido |
| Estoque | sinal dos movimentos, saldo nunca negativo |
| Compras | entrada lançada gera movimento |
| MDF-e | só NF-e vinculada, valor da carga confere |
| Financeiro | valores positivos, data ISO, venda a prazo gera título |
| Offline | fila acessível, Service Worker, conexão |

### 🗄️ Inspetor de estado
Navega por todas as tabelas (`produtos`, `vendas`, `movimentos`, `entradas`,
`mdfes`, `lancamentos`...), mostra o JSON formatado, exporta a base completa
e copia uma tabela para a área de transferência.

### ⚙️ Ambiente
Runtime (modo de dados, Supabase, Service Worker, conexão, build), sessão e
plano efetivo, e todas as chaves `nkway.*` do localStorage com tamanho e
botão de remoção individual.

### 🧪 Simuladores
Troca de plano, ciclo de trial (14 dias / 2 dias / expirado), limpeza da fila
offline e reset da base.

---

## 4. Roteiro de verificação por módulo

| # | Módulo | Passos | Esperado |
|---|---|---|---|
| 1 | **PDV Fiscal** | PDV → Venda Fiscal → NFC-e → finalizar | cupom com chave 44 díg., QR e protocolo |
| 2 | **DAV** | PDV → DAV → gerar | estoque **não** muda; carimbo "não fiscal" |
| 3 | **Faturar DAV** | Documentos → Faturar → NF-e | vira nota, baixa estoque, entra no financeiro |
| 4 | **Entrada XML** | Entradas → *Usar XML de exemplo* → Importar → Lançar | 3 produtos, custo médio, conta a pagar |
| 5 | **Kardex** | Estoque → aba Kardex | entradas (+) e vendas (−) com saldo |
| 6 | **Inventário** | Estoque → Ajustar | movimento com motivo registrado |
| 7 | **MDF-e** | emitir NF-e no PDV → MDF-e → vincular | DAMDFE com chave; encerrar manifesto |
| 8 | **Financeiro** | Financeiro → Baixar título | status muda, totais recalculam |
| 9 | **Offline** | F12 → Network → Offline → vender | banner vermelho, fila cresce, sync ao voltar |
| 10 | **Paywall** | Dev → plano Grátis → 51º produto | modal de upgrade |

---

## 5. Estrutura do código

```
src/
├── App.tsx                 shell, menu, gate de login, modo dev
├── lib/supabase.ts         detecção cloud/demo
└── erp/
    ├── types.ts            tipos + seed + gerador de chave SEFAZ
    ├── store.tsx           estado central e regras de negócio
    ├── auth.tsx            sessão (demo e Supabase)
    ├── plan.tsx            planos, limites e trial
    ├── cloud.ts            CRUD Supabase
    ├── offline.ts          fila de sincronização
    ├── useOffline.ts       hook de conexão
    ├── xmlNfe.ts           parser de NF-e
    ├── Documento.tsx       cupom fiscal / DAV
    ├── dev/testes.ts       bateria de verificações
    └── pages/              Dashboard, PDV, Vendas, Entradas,
                            Estoque, Mdfe, Produtos, Clientes,
                            Financeiro, Planos, Login, DevConsole
```

---

## 6. Antes de ir para produção

- [ ] Desativar o modo dev (`localStorage.removeItem("nkway.dev")`)
- [ ] Configurar Supabase (`supabase/schema.sql` + variáveis)
- [ ] Integrar emissor fiscal real (Focus NFe / PlugNotas)
- [ ] Webhook de pagamento gravando `plano` no banco
- [ ] Zerar falhas críticas no console
