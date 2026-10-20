# NKWAY: Especificação de Filtros por Módulo

Legenda: ✅ o campo já existe no modelo de dados (`src/erp/types.ts`) ou pode ser calculado a partir dele · ➕ precisa de um campo novo

## Regras gerais (valem para todos os módulos)
- Busca textual sem diferença entre maiúsculas e minúsculas e sem acentos (reaproveitar `normalizar()` de `checkout/pdvConfig.ts`).
- CPF, CNPJ, chave de acesso e GTIN são encontrados com ou sem máscara e espaços (comparar só os dígitos).
- Valor digitado na busca (ex.: `150,00`) também procura por valor exato.
- Período padrão: **mês atual** (Financeiro: **próximos 30 dias + vencidos**; Vendas: **hoje**).
- Filtros ativos aparecem como chips removíveis, com contador de resultados e o botão "Limpar filtros".
- Filtros salvos por módulo no `localStorage` (`nkway.filtros.<modulo>`), além de "Filtros favoritos" com nome.
- Atalhos de período: Hoje · Ontem · 7 dias · Este mês · Mês anterior · Personalizado.

---

### 📦 Módulo: Financeiro (Contas a Pagar/Receber) · ✅ IMPLEMENTADO (itens ✅)
*   **Filtros Essenciais:**
    *   `Tipo (Receber / Pagar / Todos)` ✅: [Botões de alternância] - *É a primeira divisão que todo usuário faz; a aba já existe.*
    *   `Situação` ✅: [Chips de seleção múltipla: Em aberto · Vence hoje · Vencido · Pago] - *"Vencido" e "Vence hoje" são calculados (vencimento comparado com hoje e `pago = false`); é a pergunta diária do caixa.*
    *   `Período de vencimento` ✅: [Seletor de intervalo de datas com atalhos] - *Fluxo de caixa da semana e do mês.*
    *   `Categoria` ✅: [Lista de seleção múltipla] - *Separa vendas, aluguel, fornecedores e impostos.*
    *   `Cliente / Fornecedor` ➕: [Campo com autocompletar] - *Cobrança e negociação por parceiro. Hoje o nome só aparece na descrição; precisa de `contraparteId`.*
*   **Filtros Avançados:**
    *   `Data de pagamento (baixa)` ➕: [Intervalo de datas] - *Conciliação bancária: o que entrou ou saiu de fato no dia.*
    *   `Forma de pagamento/recebimento` ➕: [Seleção múltipla] - *Bate com o extrato da maquininha ou do Pix.*
    *   `Origem` ➕: [Lista: Venda PDV · Entrada XML · Devolução · Manual] - *Auditoria: separa lançamentos automáticos de manuais.*
    *   `Documento vinculado` ➕: [Texto: nº da venda ou NF] - *Rastreia de volta a venda ou compra.*
    *   `Conta / Caixa` ➕: [Lista] - *Saldo por banco ou caixa físico.*
    *   `Centro de custo` ➕: [Lista] - *Relatório gerencial por setor ou loja.*
    *   `Parcela` ➕: [Número: "2 de 3"] - *Acompanha vendas parceladas.*
    *   `Com juros / multa / desconto` ➕: [Caixa de seleção] - *Exceções que alteram o valor original.*
    *   `Pago em atraso` ✅/➕: [Caixa de seleção] - *Pagamento depois do vencimento; indicador de inadimplência real (precisa da data de pagamento).*
    *   `Criado por / criado em` ➕: [Usuário + intervalo de datas] - *Trilha de auditoria.*
*   **Operadores Lógicos / Agrupamentos:**
    *   `Valor de / até` ✅ · `Vencimento de / até` ✅ · `Pagamento de / até` ➕
    *   **Faixas de atraso** ✅: A vencer · 1–30 · 31–60 · 61–90 · mais de 90 dias - *Relatório de inadimplência.*
    *   **Situação com "OU"**: Vencido OU Vence hoje (padrão da tela "Cobrança do dia").
    *   **Categoria "é" / "não é"**: ex.: tudo exceto "Transferências".
    *   **Agrupar por**: categoria · cliente/fornecedor · mês de vencimento · semana · forma de pagamento.
    *   **Previsto x realizado**: soma em aberto × soma paga no mesmo período.
*   **Busca Global (Texto Livre):** descrição · categoria · nome do cliente/fornecedor · CPF/CNPJ · nº da venda/NF de origem · valor exato · observação

---

### 📦 Módulo: Vendas e Faturamento · ✅ IMPLEMENTADO (itens ✅)
*   **Filtros Essenciais:**
    *   `Período` ✅: [Intervalo de datas e horas; padrão: Hoje] - *Fechamento de caixa diário.*
    *   `Tipo (DAV / Fiscal)` ✅: [Botões de alternância] - *Separa orçamento de nota emitida.*
    *   `Status` ✅: [Chips de seleção múltipla: Aberto · Faturado · Cancelado] - *O padrão deve esconder as canceladas.*
    *   `Forma de pagamento` ✅: [Seleção múltipla] - *Conferência do caixa por meio de pagamento; considera também `pagamentos[]` divididos.*
    *   `Cliente` ✅: [Campo com autocompletar] - *Histórico de compras e segunda via.*
*   **Filtros Avançados:**
    *   `Modelo fiscal` ✅: [NFC-e · NF-e · SAT] - *Cada modelo tem obrigação e prazo de cancelamento diferentes.*
    *   `Série + Nº da nota` ✅: [Texto + intervalo numérico] - *Localizar a nota e detectar números pulados (inutilização).*
    *   `Chave de acesso` ✅: [Texto com 44 dígitos] - *Atendimento à SEFAZ e ao contador.*
    *   `Protocolo de autorização` ✅: [Texto] - *Auditoria fiscal.*
    *   `Produto contido` ✅: [Campo com autocompletar] - *"Quem comprou o item X?" (recall, garantia).*
    *   `Categoria do produto` ✅: [Seleção múltipla] - *Desempenho por linha de produto.*
    *   `Com desconto` ✅: [Sim / Não] - *Controle de descontos concedidos.*
    *   `Com frete / transportadora / placa` ✅: [Caixa de seleção + texto] - *Vendas com entrega e ligação com o MDF-e.*
    *   `Pagamento dividido` ✅: [Caixa de seleção] - *`pagamentos.length > 1`; conferência de caixa.*
    *   `Com troco` ✅: [Caixa de seleção] - *Diferença de gaveta.*
    *   `DAV vencido` ✅: [Caixa de seleção] - *Validade menor que hoje e status aberto; orçamento a converter ou descartar.*
    *   `Motivo do cancelamento` ✅: [Texto / lista] - *Auditoria de cancelamentos.*
    *   `Operador / Nº do caixa` ➕: [Lista] - *Fechamento por operador; hoje não é gravado na venda.*
    *   `Sincronização` ✅: [Sincronizada · Na fila offline] - *Vendas feitas sem internet que ainda não subiram.*
    *   `Ambiente` ➕: [Produção · Homologação] - *Separa notas de teste.*
*   **Operadores Lógicos / Agrupamentos:**
    *   `Total de / até` ✅ · `Nº da venda de / até` ✅ · `Nº da nota de / até` ✅ · `Qtd. de itens de / até` ✅ · `Desconto % de / até` ✅
    *   **Turno**: hora de / até (ex.: 06h–14h, 14h–22h).
    *   **Status "é" / "não é"**: ex.: Aberto + Faturado, sem Cancelado.
    *   **Forma de pagamento**: alternar entre "forma principal" e "qualquer parte do pagamento".
    *   **Agrupar por**: dia · hora · forma de pagamento · cliente · produto · modelo fiscal · operador. Mostrar ticket médio por grupo.
*   **Busca Global (Texto Livre):** nº da venda · nº da nota · chave de acesso (com ou sem espaços) · nome do cliente · CPF/CNPJ · nome/SKU/GTIN dos itens · protocolo · transportadora · placa · observação

---

### 📦 Módulo: Estoque e Logística · ✅ IMPLEMENTADO (itens ✅ em pages/Estoque.tsx)
*   **Filtros Essenciais:**
    *   `Situação do estoque` ✅: [Chips: OK · Abaixo do mínimo · Zerado · Negativo] - *Reposição diária; calculada a partir de `estoque` e `estoqueMin`.*
    *   `Categoria` ✅: [Seleção múltipla] - *Navegação por seção da loja.*
    *   `Marca` ✅: [Seleção múltipla] - *Pedido por fabricante.*
    *   `Tipo de movimento (kardex)` ✅: [Seleção múltipla: entrada · venda · ajuste · perda · devolução · inventário · transferência] - *Entender por que o saldo mudou.*
    *   `Período do movimento` ✅: [Intervalo de datas] - *Kardex do mês.*
*   **Filtros Avançados:**
    *   `Produto específico` ✅: [Campo com autocompletar] - *Kardex individual.*
    *   `Documento do movimento` ✅: [Texto: venda, NF de entrada, devolução] - *Rastreabilidade.*
    *   `Pesável` ✅ · `Unidade` ✅: [Sim / Não · Lista] - *Itens de balança e conferência de unidade.*
    *   `GTIN ausente ou inválido` ✅: [Caixa de seleção] - *Usa `validarGtin()`; evita rejeição na NF-e.*
    *   `Fiscal incompleto (sem NCM/CFOP)` ✅: [Caixa de seleção] - *Saneamento do cadastro antes de emitir nota.*
    *   `Sem venda há N dias` ✅: [Número] - *Estoque parado, calculado pelos movimentos.*
    *   `Margem negativa / custo zerado` ✅: [Caixa de seleção] - *Erro de preço que gera prejuízo.*
    *   `Lote / Validade` ➕: [Texto + intervalo de datas] - *Perecíveis e vencimento próximo.*
    *   `Localização (corredor/prateleira) / Depósito` ➕: [Lista] - *Separação e inventário por endereço.*
    *   `Ajustado por (usuário)` ➕: [Lista] - *Auditoria de ajustes e perdas.*
    *   `MDF-e: Status` ✅: [Autorizado · Encerrado · Cancelado] - *Logística de transporte.*
    *   `MDF-e: UF de início/fim · Placa · Condutor` ✅: [Lista / texto] - *Rotas e veículos.*
    *   `MDF-e aberto há mais de N dias` ✅: [Número] - *A SEFAZ exige o encerramento do manifesto.*
*   **Operadores Lógicos / Agrupamentos:**
    *   `Estoque de / até` ✅ · `Valor em estoque (estoque × custo) de / até` ✅ · `Margem % de / até` ✅
    *   **Cobertura em dias** ✅: estoque ÷ média de venda diária - *Quantos dias o estoque dura.*
    *   **Curva ABC** ✅: grupos A / B / C por faturamento - *Prioriza onde concentrar a atenção.*
    *   **Direção do movimento**: Entradas (qtd > 0) · Saídas (qtd < 0).
    *   **Divergências**: tipo = perda OU ajuste OU inventário.
    *   **MDF-e**: emissão de / até · peso bruto de / até · valor da carga de / até.
    *   **Agrupar por**: categoria · marca · tipo de movimento · dia · produto.
*   **Busca Global (Texto Livre):** nome · SKU · GTIN · código de balança · marca · categoria · NCM · (kardex) documento, observação · (MDF-e) nº, chave, placa, condutor, CPF, município, chaves das notas vinculadas

---

### 📦 Módulo: Compras e Suprimentos
*   **Filtros Essenciais:**
    *   `Fornecedor` ✅: [Campo com autocompletar] - *Histórico de compras por parceiro.*
    *   `Período de emissão` ✅: [Intervalo de datas] - *Compras do mês.*
    *   `Status da entrada` ✅: [Chips: Pendente · Conferida · Lançada] - *O que ainda não entrou no estoque.*
    *   `Origem` ✅: [XML · Manual] - *Entradas digitadas à mão merecem conferência.*
    *   `Gerou financeiro` ✅: [Sim / Não] - *Garante que toda compra virou conta a pagar.*
*   **Filtros Avançados:**
    *   `Nº da nota + Série` ✅ · `Chave de acesso` ✅: [Texto] - *Localização exata da nota.*
    *   `UF do fornecedor / Interestadual` ✅: [Lista / caixa de seleção] - *Impacta ICMS-ST e diferencial de alíquota.*
    *   `CFOP do item` ✅ · `NCM` ✅: [Seleção múltipla / texto] - *Conferência fiscal da entrada.*
    *   `Produto contido` ✅: [Campo com autocompletar] - *"De quem comprei o item X e por quanto?"*
    *   `Item novo cadastrado na entrada` ✅: [Caixa de seleção] - *`produtoId = null`; revisar cadastros criados automaticamente.*
    *   `Com devolução vinculada` ✅: [Caixa de seleção] - *Usa `Devolucao.entradaId`; problemas de qualidade.*
    *   `Variação de custo maior que X%` ✅: [Número] - *Alerta de reajuste do fornecedor em relação à última compra.*
    *   `Prazo de pagamento do fornecedor` ✅: [Intervalo numérico, em dias] - *Negociação de prazo.*
    *   `Devoluções: CFOP (5201/6201) · Tipo de estorno` ✅: [Lista] - *Auditoria das devoluções.*
    *   `Data de lançamento` ➕ · `Pedido de compra / Cotação` ➕: [Data / texto] - *Exigem um módulo de pedidos, que ainda não existe.*
*   **Operadores Lógicos / Agrupamentos:**
    *   `Total de / até` ✅ · `Emissão de / até` ✅ · `Qtd. de itens de / até` ✅ · `Variação de custo % de / até` ✅
    *   **Não lançadas**: status = Pendente OU Conferida.
    *   **Prazo de entrega** ➕: lançamento − emissão (em dias).
    *   **Agrupar por**: fornecedor · mês · UF · CFOP · categoria do produto. Mostrar o total comprado e o custo médio.
*   **Busca Global (Texto Livre):** nº da nota · chave de acesso · nome do fornecedor · CNPJ (com ou sem máscara) · nome/SKU/GTIN/NCM dos itens · (devoluções) nº, chave, chave referente

---

### 📦 Cadastros · ✅ IMPLEMENTADO
*   **Produtos:** Categoria · Marca · Estoque (OK / abaixo do mínimo / zerado / negativo, com contagem) · Situação fiscal · *Avançados:* Unidade · Tipo (unitário/pesável) · Exceções (sem código de barras, código inválido, sem NCM/CFOP, margem negativa, custo zerado) · Preço, Margem % e Estoque de/até
    *   **Busca:** nome · SKU · código de barras · código de balança · marca · categoria · NCM · CEST · preço
*   **Clientes:** Tipo de pessoa (PF/PJ) · UF · Cidade (depende da UF) · Crédito/Financeiro (em aberto, vencido, acima de 85% do limite, sem limite) · Cadastro SEFAZ · *Avançados:* Última compra (últimos 30 dias / sem comprar há +30/60/90 / nunca) · Contribuinte ICMS · Condição de pagamento · Total comprado e Limite de/até
    *   **Busca:** nome · CPF/CNPJ (com ou sem máscara) · e-mail · telefone · cidade · bairro · endereço · CEP · UF · IE
*   **Fornecedores:** UF · Cidade · Financeiro (em aberto, vencido, sem débitos) · Prazo de pagamento · Endereço SEFAZ · *Avançados:* Movimentação (com notas, sem compras, com devoluções) · Última compra · Contribuinte ICMS
    *   **Busca:** razão social · CNPJ · e-mail · telefone · cidade · bairro · UF · CEP · IE
*   **Todos:** lista com ordenação pelo título da coluna, paginação (10/25/50/100/Todos), exportar CSV para Excel, resumo do resultado, filtros salvos

## Campos novos necessários (➕), em ordem de prioridade
1. `Lancamento`: `contraparteId`, `origem` + `origemId`, `pagoEm`, `formaPagamento`, `criadoEm`
2. `Venda`: `operador`, `caixa`, `ambiente`
3. `Movimento`: `usuario`
4. `Produto`: `lote`, `validade`, `localizacao`
5. `Entrada`: `lancadaEm`
