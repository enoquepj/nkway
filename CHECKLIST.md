# NKWAY — Checklist de QA antes de publicar
_(Roda 100% grátis, no localhost. Use Chrome. Se algo falhar, anote o número do teste)_

## 0. Preparação
```bash
npm install
npm run dev          # abre http://localhost:5173
```
- [ ] Tela de login abre sem erro
- [ ] `Ctrl+Shift+D` → senha `Pc_123456@` → **aba Testes mostra 51 verificações**
- [ ] Botão ▶ Rodar testes → placar em ou acima de ~90%

---

## 1. Cadastro & Acesso (multi-empresa)
- [ ] Criar conta nova funciona (empresa, CNPJ, nome, e-mail)
- [ ] Entra no dashboard com trial de 14 dias (banner azul)
- [ ] Criar **segunda conta** com outro e-mail → **dados NÃO vazam** *(cada empresa tem base isolada)*
- [ ] Voltar pra primeira conta → dados dela estão lá

## 2. Cadastros
### 2.1 Produtos
- [ ] Nome vazio → não salva
- [ ] Editar produto → mostra NCM, CFOP, GTIN, unidade, marca
- [ ] Coluna Fiscal: 🟢 "OK p/ NF-e" ou 🔴
- [ ] Etiqueta com código de barras EAN-13 abre e imprime
### 2.2 Clientes
- [ ] Consultar CNPJ real (use qualquer CNPJ ativo conhecido) → preenche endereço + código IBGE
- [ ] CNPJ incorreto → trava com alerta de dígito verificador
- [ ] Badge "OK p/ autorização SEFAZ" aparece quando completo
### 2.3 Fornecedores
- [ ] Mesma consulta CNPJ funciona
- [ ] Badge OK p/ devolução NF-e

## 3. PDV — frente de caixa tela cheia
- [ ] Standby "CAIXA LIVRE" com ofertas configuráveis
- [ ] Digitar qualquer letra → inicia venda na hora
- [ ] **`3x` + Enter, depois `camiseta` + Enter → entram 3 camisetas** ✅ *(corrigido hoje)*
- [ ] "banana" + Enter → modal da balança abre e estabiliza
- [ ] Busca por código de barras completo → adiciona direto
- [ ] Resultados múltiplos → clique no produto certo
- [ ] F4 → cancela último item, sem travamento
- [ ] Cliente com limite de crédito + venda a prazo alta → bloqueia
- [ ] Fechar → modal total com pagamento e troco em dinheiro
- [ ] Recibo volta automaticamente pra espera
- [ ] **F6 vendas do dia**: reimprimir e cancelar (prazo!) funcionam

## 4. Consulta preço
- [ ] F7 → digita nome do produto → mostra preço, estoque, tributos CBS/IBS
- [ ] Não adiciona à venda

## 5. Fiscal
- [ ] Vendas fiscal → todas com chave de 44 dígitos
- [ ] Cancelar nota dentro do prazo → estoque volta, financeiro some
- [ ] Cancelamento registra motivo obrigatório
- [ ] Configurações → mudar Homologação → Produção → aviso sobe
- [ ] Certificado A1 → upload arquivo → contador de validade aparece
- [ ] CSC incompleto → alerta âmbar; completo → verde
- [ ] Cupom mostra "Tributos estimados CBS/IBS"

## 6. Compras & Estoque
- [ ] XML de exemplo → importa 3 produtos
- [ ] Lançar entrada → **custo médio** recalcula, estoque soma
- [ ] Devolver → baixa estoque e estorna conta a pagar
- [ ] Estoque → kardex existe com todos os movimentos
- [ ] Ajuste manual p/ inventário → aparece no kardex

## 7. Financeiro
- [ ] Lançamento atrasado aparece em vermelho "Atrasado"
- [ ] Baixar título → muda para "Pago"
- [ ] Saldo projetado = a receber − a pagar

## 8. Plano & Trial (Dev Console)
- [ ] Simuladores → "Expirar trial" → banner vermelho e paywall volta aos 50 produtos
- [ ] Simuladores → assinar Pro → limites somem
- [ ] Reiniciar trial 14d → voltão notas

## 9. Offline & Resiliência
- [ ] F12 → Network Offline → banner vermelho no PDV
- [ ] Vender offline → funciona, cupom sai
- [ ] Voltar online → badge "Sincronizar" manda a fila
- [ ] F5 recarrega → continua logado e dados intactos
- [ ] Recarregar página com F5 → sem travamento

## 10. Build de produção (pré-publicação)
```bash
npm run build
npm start          # ou npm run preview
```
- [ ] Build passa **sem erro**
- [ ] `dist/index.html` abre isolado no navegador (PWA)

---

## 🐛 Encontrou problemas?
Anote:
1. Número do teste que falhou
2. O que apareceu na tela (texto vermelho, tela branca, valor quebrado)
3. O que você clicou/digitou ANTES

E me manda exatamente isso — resolvemos um por vez **antes de gastar R$ 1**.
