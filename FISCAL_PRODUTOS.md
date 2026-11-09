# Parametrização fiscal de produtos · NKWAY

## Referências e decisões de produto

- **Bling:** o cadastro do produto mantém NCM e origem; CFOP, CST/CSOSN e alíquotas dependem da natureza e das regras da operação. A orientação é confirmar a tributação com a contabilidade. Referências: [cadastro e tributação de produtos](https://ajuda.bling.com.br/hc/pt-br/articles/360037529613-Como-resolver-Problemas-na-Emiss%C3%A3o-de-Notas-Fiscais-no-Bling) e [regras por produto, grupo ou NCM](https://ajuda.bling.com.br/hc/pt-br/articles/15921613163927-Como-preencher-o-Benef%C3%ADcio-Fiscal-na-NF-e-do-Bling-cBenef-cCredPresumido-cBenefRBC).
- **Omie:** dados fiscais podem ser definidos por produto, NCM e CFOP e associados a cenários fiscais. Referências: [configuração por produto/NCM/CFOP](https://ajuda.omie.com.br/pt-BR/articles/3850350-configurando-produtos-monofasicos-com-substituicao-tributaria-ou-com-outras-regras-tributarias-para-apuracao-do-simples-nacional) e [informações tributárias do item](https://ajuda.omie.com.br/pt-BR/articles/498924-cadastrando-uma-nova-remessa-de-produto).
- **Fontes oficiais:** [Portal NF-e: tabelas de CFOP e classificação IBS/CBS](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D), [CST, CSOSN e CRT em legislação estadual](https://legislacao.sef.sc.gov.br/html/decretos/2025/dec_25_0820.htm) e [NCM de oito dígitos](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=CtiBWEXJP0k%3D&AspxAutoDetectCookieSupport=1).
- **Reforma tributária:** o [Comitê Gestor do IBS](https://www.cgibs.gov.br/novo-marco-da-reforma-tributaria-inicia-em-03-de-agosto-com-preenchimento-obrigatorio-dos-campos-relativos-ao-ibs-e-a-cbs) descreve a fase de 2026 para o regime regular; o [validador oficial NF-e/NFC-e](https://dfe-portal.svrs.rs.gov.br/Cff/ValidadorRtcNfe) detalha CST, cClassTrib e componentes de IBS da UF e do município. As exigências variam conforme operação e regime.
- **Provedores fiscais:** consulte a [documentação da Focus NFe](https://focusnfe.com.br/doc/) e a [API da Nuvem Fiscal](https://dev.nuvemfiscal.com.br/docs/api/) para os campos, autenticação e formatos específicos; os formatos não devem ser presumidos como equivalentes ao contrato canônico do NKWAY.

## Situação histórica verificada em 2026-11-05

O `main` consultado (`e78d44c`) ainda não continha a central `/config/fiscal/produtos`; ela está implementada na prévia local e depende de publicação. O `health` de produção confirma somente a conexão, não o commit ativo nem a disponibilidade do cadastro fiscal.

O projeto já possui campos de alíquota IBS/CBS e cálculos estimados. Na prévia há cadastro de CST IBS/CBS, cClassTrib e alíquotas por produto ou perfil, além de ICMS, PIS, COFINS, IPI, ICMS-ST e FCP para os regimes aceitos. Isso é **parametrização parcial**, não uma homologação completa da Reforma Tributária nem uma apuração integral de Lucro Real ou Presumido.

## O que foi entregue

A rota `/config/fiscal/produtos` reúne **Produtos**, **Perfis fiscais** e **Códigos da empresa**. O acesso e as ações exigem `config.gerenciar`, com `empresa_id` derivado da sessão no servidor. A tela também é acessível pelas Configurações fiscais e pelo cadastro de produtos.

- Códigos próprios de CFOP, NCM, CEST, CST ICMS, CSOSN, CST PIS/COFINS/IPI, CST IBS/CBS e cClassTrib podem ser cadastrados, editados, desativados e reativados. A descrição é local à empresa; **não é uma cópia oficial nem consulta automática da tabela vigente**.
- Perfis são modelos por regime (`todos`, MEI, Simples, Simples com excesso, Lucro Presumido e Lucro Real). Aplicar é uma cópia explícita no formulário do produto; campos vazios não apagam os existentes. Editar ou desativar um perfil não altera produtos automaticamente.
- A ficha do produto permite origem, NCM, CEST, CFOP padrão/interestadual, CST ou CSOSN, benefício fiscal, PIS/COFINS/IPI, ICMS-ST/FCP e IBS/CBS. Alíquotas aceitam de 0 a 100% com até duas casas, conforme precisão atual de `nk_produto`.
- CRT sugerido por regime: MEI 4, Simples 1, Simples com excesso 2 e Lucro Presumido/Real 3. O CRT configurado é respeitado e divergências são sinalizadas; não há mudança automática de regime. Para CRT 1/4, CST ICMS é permitido apenas nos códigos monofásicos previstos (02, 15, 53, 61); os demais casos usam CSOSN.
- A edição fiscal é transacional e auditada. A edição/exclusão anterior do cadastro de produtos também foi limitada ao tenant da sessão. Nenhuma alteração massiva ou conversão automática de cadastros antigos é executada.

## Limites fiscais importantes

1. Validação de quantidade/formato de dígitos e compatibilidade básica **não comprova vigência, incidência, benefício, cálculo de tributos ou compatibilidade com toda a tabela oficial**. O sistema verifica apenas se os três primeiros dígitos do cClassTrib coincidem com o CST IBS/CBS, além do tamanho. Revise com a contabilidade e as tabelas oficiais antes de operar.
2. O CFOP interestadual informado é selecionado na NF-e quando há UF destinatária diferente; a NFC-e mantém o CFOP padrão. A operação concreta e a necessidade de CFOP específico devem ser conferidas.
3. O contrato canônico do emissor recebe os campos parametrizados de origem, CEST, CST/CSOSN, PIS/COFINS/IPI, benefício, ICMS-ST/FCP e IBS/CBS quando informados. **Isso não implementa o cálculo completo de ICMS-ST, FCP ou IPI e não comprova que um provedor externo aceite o mapeamento.** Homologue com o provedor e a contabilidade antes de transmissão real; nenhum teste desta entrega transmitiu notas.
4. Para CRT 2/3, a ausência de CST ICMS é alerta em homologação e bloqueio em produção. CST IBS/CBS e cClassTrib preenchidos de forma incompleta seguem a mesma regra. Sem complemento, o comportamento legado usa origem 0 e apresenta aviso de revisão.
5. XMLs e notas já emitidas não são modificados. Como no emissor existente, documentos ainda pendentes são montados com o cadastro atual do produto; revise-os antes de retransmitir.
6. O modelo atual usa uma alíquota única de IBS e valores estimados; não separa IBS da UF e do município, não aplica automaticamente reduções, créditos, bases ou regras por vigência e não atualiza tabelas oficiais de IBS/CBS. Os valores iniciais de 0,10% e 0,90% existentes em produtos são padrões de teste, não uma indicação de que se aplicam a toda operação.
7. Lucro Real e Presumido permitem informar os parâmetros do produto, mas o projeto não apura integralmente IRPJ, CSLL, créditos de PIS/COFINS ou todas as exceções específicas de cada regime.

## Banco e validação

- Migração idempotente **aditiva**: `supabase/migrations/20261105_parametros_fiscais_produtos.sql`, espelhada em `src/db/migracao.ts`. Cria `nk_fiscal_parametro` e `nk_produto_tributacao`; não modifica a estrutura nem atualiza registros de `nk_produto` e não toca tabelas legadas. Sem RLS novo; isolamento por empresa é feito no servidor.
- O boot da aplicação tenta aplicar a migração. Antes de publicar, preserve o backup e revise permissões do usuário da aplicação. Se a tabela não puder ser criada, a central mostra aviso e a emissão em produção bloqueia a ausência do complemento; o health simples não confirma a presença das tabelas. Não execute `supabase/schema.sql` nem aplique SQL manualmente sem revisão.
- Testes locais: `scripts/testar-tributacao-produtos.mjs` cobre 66 cenários de códigos, regimes, permissões, isolamento, perfil, auditoria, preservação do legado e inspeção do payload sem transmissão. O smoke também valida a rota e executa a suíte. O diagnóstico ganhou `fis-9..fis-13`.

## NCM por fonte pública — etapa 1 (2026-11-08)

**Base reconferida:** `main cf0200d` já contém a central e os perfis descritos acima. A consulta NCM desta etapa e a identificação de deploy anterior são entregas locais ainda não publicadas. O health público respondeu 200, mas isso não comprova a versão ativa nem o funcionamento fiscal autenticado. CEST (etapa 2), perfil no formulário principal (etapa 3) e aceite global do roteiro permanecem pendentes.

### Fonte, proveniência, frequência e licença

- Fonte escolhida: **Receita Federal / Portal Único Siscomex — Classif**, não um catálogo comunitário. [Página oficial de download](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/classificacao-fiscal-de-mercadorias/download-ncm-nomenclatura-comum-do-mercosul), [JSON oficial](https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json), [documentação técnica, seção Classificação Fiscal](https://docs.portalunico.siscomex.gov.br/rn/r36-guaiba/) e [orientação de integração, item 13](https://www.gov.br/siscomex/pt-br/sistemas-de-comercio-exterior/integre-seu-sistema).
- A Receita disponibiliza expressamente o download público/gratuito e a integração. Não foi atribuída uma licença MIT ou de outro repositório aos dados oficiais; não se importou biblioteca externa. A integração mantém atribuição, endereço, texto de referência e atos legais. Não foi identificada nessa consulta uma licença adicional específica do JSON; o download autorizado não é uma certificação contábil nem uma autorização para apresentar base derivada como oficial.
- A documentação informa geração diária. O arquivo contém **apenas a tabela vigente**, não o histórico completo nem os códigos futuros; histórico deve ser consultado no próprio Classif. O build e o seed não fazem coleta externa.
- Na verificação real separada de 2026-11-08, o arquivo apresentou 15.157 registros, 10.516 códigos completos e `Data_Ultima_Atualizacao_NCM = "Vigente em 08/11/2026"`, com ato “Resolução Gecex nº 926/2026”. O campo foi tratado como **referência/vigência declarada**, não como prova da última alteração legal. Estes números e datas são observações, não valores permanentes da aplicação.
- A resposta atual usa `Nomenclaturas`, `Codigo`, `Descricao`, `Data_Inicio`, `Data_Fim`, `Tipo_Ato_Ini`, `Numero_Ato_Ini`, `Ano_Ato_Ini`. A variação em relação aos nomes genéricos da documentação antiga foi conferida no JSON real. O redirecionamento público observado usa `perfil=PUBLICO`; somente o mesmo endpoint, sem query ou com `perfil=PUBLICO`/`publico`, é permitido. Não são aceitos URLs/arquivos enviados pelo cliente.
- **CEST não foi adotado nesta etapa.** A análise de CONFAZ e de candidatos estruturados, incluindo licença dos dados, abrangência e manutenção, pertence à etapa 2. Não foi importada biblioteca Python nem feita afirmação de que um repositório seja usado pela maioria dos ERPs.

### Fluxo e comparação com ERPs

O [Bling](https://ajuda.bling.com.br/hc/pt-br/articles/360036756914-Como-cadastrar-produtos) orienta NCM/CEST no produto e consulta/apoio contábil. O [Omie.PDV](https://ajuda.omie.com.br/pt-BR/articles/12899612-omie-pdv-varejo-configuracao-de-impostos-pelo-app) separa imposto padrão, regras por NCM e exceções por produto. São referências de fluxo, não prova de adoção de um fornecedor de dados.

**NCM e CEST são atributos da mercadoria; perfil fiscal é um modelo reutilizável de regras da operação.** NCM pode servir futuramente como critério opcional de aplicabilidade do perfil, mas não deve decidir sozinho CEST, CST/CSOSN, alíquotas, benefício ou incidência. A etapa 1 consulta apenas NCM. Os valores históricos nos perfis e a função `aplicarPerfilTributario` foram preservados; a proteção contra sobrescrita por perfil será implementada explicitamente na etapa 3, não está entregue aqui.

No cadastro de Produtos:

1. Abrir **Novo produto** ou **Editar produto** e clicar em **Consultar NCM**.
2. Buscar por descrição, código com pontuação ou prefixo. A busca inclui descrições dos ancestrais, para não perder itens cuja descrição própria é apenas “Outros”. Grupos navegam; somente códigos completos de oito dígitos, dentro de sua vigência individual, oferecem seleção. Listagem de até 20 itens por página, navegação por teclado e mensagens acessíveis.
3. Conferir origem, referência da tabela, última coleta íntegra, vigência e ato do código. Coleta e vigência não são a mesma data.
4. Selecionar um código muda somente o NCM no **rascunho**. É preciso salvar o produto; nenhuma alíquota, CEST ou perfil é preenchido pela consulta.
5. Sem cópia confiável, o valor atual é mantido. Digitação manual continua possível com orientação contábil; referência antiga aparece como desatualizada e só pode ser usada como apoio manual. Não há mensagem de “tributação validada”.

O cadastro deixa de completar NCM curto com zeros ou truncar código longo. Valores legados não editados são mantidos literalmente. O genérico `00000000` continua identificado como não informado, com aviso; não é tratado como código oficial. A auditoria de criação/alteração do NCM registra antes/depois, autor, modo informado pelo usuário e `validacaoOficial: false`, mesmo quando houve consulta assistida: encontrar um código na tabela não comprova seu enquadramento na mercadoria. Produto, estoque e essa auditoria são transacionais; falha reverte o conjunto. Uma falha posterior de atualização visual não é apresentada como rollback de gravação confirmada.

### Cache e segurança no ambiente serverless

- `GET /api/fiscal/ncm`: sessão + permissão `cadastros.produtos` ou `config.gerenciar`. Apenas leitura do cache. Busca e paginação no PostgreSQL com parâmetros, snapshot consistente e limite de resposta; não transfere o catálogo inteiro ao navegador.
- `POST /api/fiscal/ncm`: somente `config.gerenciar`, origem/cabeçalho da aplicação e corpo vazio. A empresa é exclusivamente a da sessão; não aceita empresa, URL ou catálogo no corpo/query. Erros públicos são sanitizados, sem valores de segredos.
- Tabela `nk_catalogo_ncm` por `empresa_id`, mantendo última versão íntegra e metadados de atualização. Coleta **sob demanda**, acionada pelo botão administrativo; sem cron novo. Cache de até 24h; referência de dia anterior, no fuso de Brasília, é marcada como defasada e permite nova coleta antes de 24h. Falha ou referência ainda defasada tem intervalo de 15 minutos entre tentativas.
- Concessão persistente de 45s com UUID funciona entre instâncias Vercel. Download ocorre fora da transação, sem conexão de banco reservada durante a rede. Só o detentor atual pode publicar o resultado; resposta/erro tardio não sobrescreve uma nova concessão. Uma concessão abandonada pode ser retomada após expirar.
- Timeout de 12s para download/stream, máximo de 8 MiB e 40.000 registros. JSON, UTF-8, códigos, duplicidades, descrições e datas são validados integralmente. Guardas de sanidade exigem pelo menos 5.000 códigos e 50 capítulos e recusam queda superior a 10% contra a cópia anterior. Esses limites conservadores exigem revisão se a fonte mudar legitimamente; não fixam a contagem oficial observada. Nenhuma linha inválida é descartada silenciosamente para fabricar uma tabela parcial.
- Substituição do catálogo e auditoria ocorrem na mesma transação. Falha de rede, JSON inválido, truncamento, regressão de referência, anomalia de volume ou erro de auditoria preserva os registros e a data da última coleta íntegra. Não há dependência exclusiva de memória de processo.

### Migração, preservação e rollback

Migração **aditiva e idempotente** `supabase/migrations/20261108_catalogo_ncm.sql`, refletida no schema e no mecanismo de boot já existente. Cria somente `nk_catalogo_ncm`; não altera tabelas legadas, produtos, documentos, RLS ou conexão. A migração foi aplicada e reaplicada somente no banco local nesta sessão. Antes de publicar, preservar backup e revisar a permissão de criar/acessar a nova tabela. Não executar `supabase/schema.sql` nem push destrutivo. Em falha da nova tabela, a consulta avisa e o cadastro manual não depende do cache.

**Rollback lógico:** reverter os arquivos de código da etapa, mantendo a nova tabela e as auditorias. Não é necessário apagar nada. Não desfazer automaticamente NCMs que usuários tenham escolhido. Qualquer remoção física futura exige backup/exportação e revisão própria; nenhum DROP é executado pela migração. XMLs e notas históricas não são reescritos. Documentos ainda pendentes continuam seguindo as regras existentes do emissor e devem ser revisados antes de retransmissão.

### Testes e limites do aceite

`scripts/testar-ncm.mjs` usa `scripts/fixtures/ncm.json` e geradores sintéticos **somente em empresas temporárias de banco local**, removidas ao fim. Cobre 85 cenários de modelo/fonte simulada/interface/banco, mais 6 em `--http`: zero inicial, hierarquia, descrição com acentos/ancestrais, limites, falhas e atualização diária, recuo, concorrência, resposta/erro atrasado, auditoria/rollback, permissões, isolamento, criação/edição sem aplicação de perfil e preservação literal de legado. Hashes confirmam que produtos, notas/XMLs, movimentos e parâmetros preexistentes não mudaram. Os testes dos handlers da interface são unitários; não são prova de homologação fiscal ou de uso autenticado em produção.

O smoke chama o modo `--http` após o build/prévia. As suítes existentes de caixa, relatórios, fechamento cego, tributação e identificação de deploy permanecem. O modo opcional `--fonte-real` é uma consulta separada à Receita, sem banco e sem credenciais; não faz parte do build nem torna a validação automatizada dependente da internet. Nenhuma emissão real foi feita. CEST e aplicação de perfil no cadastro **não estão implementados por esta etapa**; IBS/CBS continua parcial, conforme os limites anteriores.

## Tabelas de domínio oficiais como opções selecionáveis (2026-11-09)

- **Base de dados seguida (mesmo caminho dos ERPs mais usados):** tabela de domínio estática **no próprio banco do sistema**, semeada de fonte oficial e atualizada por ato (Informe Técnico), como o Protheus faz ao importar a tabela cClassTrib para a CKB e o cBenef para a CDV. Não há consulta online por código; o webservice SVRS CFF exige certificado A1 e não é usado na tela.
- **Implementação:** tabelas aditivas `nk_tabela_dominio` + `nk_tabela_dominio_meta` (`supabase/migrations/20261109_tabelas_dominio_fiscal.sql` + `src/db/migracao.ts`), dados públicos de referência (não de tenant).
- **Script por etapas:** `node scripts/inserir-tabelas-fiscais.mjs --etapa N|--todas [--arquivo planilha.csv] [--uf XX]` — só roda em banco local, idempotente (upsert por tipo+código+UF). Etapa 1: CST PIS, CST COFINS, CST ICMS, CSOSN, CST IPI, origem 0-8 (leis, embarcadas com fonte por linha). Etapa 2: CST IBS/CBS (18 códigos) + alíquotas padrão IBS/CBS 2026-2028 + metadados **IT 2025.002 v1.71** (Portal NF-e/SVRS); cClassTrib (173) e cCredPres entram via `--arquivo` com a planilha oficial do portal. Etapa 3: CFOP (meta **IT 2023.002 v2.10**, 619 códigos; `--arquivo` para importar). Etapa 4: cBenef por UF (meta das 27 SEFAZ; `--arquivo --uf XX` para importar a tabela da UF). CSV esperado: `codigo;descricao;vigIni;vigFim`.
- **Uso no módulo:** a central `/config/fiscal/produtos` (produto e perfil) passa a sugerir as opções oficiais nos datalists (`CamposTributarios`), com a fonte registrada em `nk_tabela_dominio_meta`; códigos locais da empresa continuam como complemento. Seleção continua manual e auditada; nada é aplicado automaticamente a produtos ou documentos.
- **Validação:** `scripts/testar-tabelas-dominio.mjs` (script recusa banco não local, idempotência, metadados, leitura, importação CSV, produtos/notas intocados) é chamado pelo smoke; diagnóstico ganhou `fis-15` (227/227). Smoke 52/52 e 206 ações sem erro 500 no build local.
- **Limites:** cClassTrib/cCredPres/CFOP/cBenef começam só com metadados até alguém importar a planilha oficial da versão vigente (`--arquivo`); isso é proposital — não inventamos tabela. Vigência: confirme sempre a tabela vigente no portal oficial antes de operar em produção.
