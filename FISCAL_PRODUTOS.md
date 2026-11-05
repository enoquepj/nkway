# Parametrização fiscal de produtos · NKWAY

## Referências e decisões de produto

- **Bling:** o cadastro do produto mantém NCM e origem; CFOP, CST/CSOSN e alíquotas dependem da natureza e das regras da operação. A orientação é confirmar a tributação com a contabilidade. Referências: [cadastro e tributação de produtos](https://ajuda.bling.com.br/hc/pt-br/articles/360037529613-Como-resolver-Problemas-na-Emiss%C3%A3o-de-Notas-Fiscais-no-Bling) e [regras por produto, grupo ou NCM](https://ajuda.bling.com.br/hc/pt-br/articles/15921613163927-Como-preencher-o-Benef%C3%ADcio-Fiscal-na-NF-e-do-Bling-cBenef-cCredPresumido-cBenefRBC).
- **Omie:** dados fiscais podem ser definidos por produto, NCM e CFOP e associados a cenários fiscais. Referências: [configuração por produto/NCM/CFOP](https://ajuda.omie.com.br/pt-BR/articles/3850350-configurando-produtos-monofasicos-com-substituicao-tributaria-ou-com-outras-regras-tributarias-para-apuracao-do-simples-nacional) e [informações tributárias do item](https://ajuda.omie.com.br/pt-BR/articles/498924-cadastrando-uma-nova-remessa-de-produto).
- **Fontes oficiais:** [Portal NF-e: tabelas de CFOP e classificação IBS/CBS](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D), [CST, CSOSN e CRT em legislação estadual](https://legislacao.sef.sc.gov.br/html/decretos/2025/dec_25_0820.htm) e [NCM de oito dígitos](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=CtiBWEXJP0k%3D&AspxAutoDetectCookieSupport=1).
- **Reforma tributária:** o [Comitê Gestor do IBS](https://www.cgibs.gov.br/novo-marco-da-reforma-tributaria-inicia-em-03-de-agosto-com-preenchimento-obrigatorio-dos-campos-relativos-ao-ibs-e-a-cbs) descreve a fase de 2026 para o regime regular; o [validador oficial NF-e/NFC-e](https://dfe-portal.svrs.rs.gov.br/Cff/ValidadorRtcNfe) detalha CST, cClassTrib e componentes de IBS da UF e do município. As exigências variam conforme operação e regime.
- **Provedores fiscais:** consulte a [documentação da Focus NFe](https://focusnfe.com.br/doc/) e a [API da Nuvem Fiscal](https://dev.nuvemfiscal.com.br/docs/api/) para os campos, autenticação e formatos específicos; os formatos não devem ser presumidos como equivalentes ao contrato canônico do NKWAY.

## Situação verificada em 2026-11-05

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
6. O modelo atual usa uma alíquota única de IBS e valores estimados; não separa IBS da UF e do município, não aplica automaticamente reduções, créditos, bases ou regras por vigência e não atualiza tabelas oficiais. Os valores iniciais de 0,10% e 0,90% existentes em produtos são padrões de teste, não uma indicação de que se aplicam a toda operação.
7. Lucro Real e Presumido permitem informar os parâmetros do produto, mas o projeto não apura integralmente IRPJ, CSLL, créditos de PIS/COFINS ou todas as exceções específicas de cada regime.

## Banco e validação

- Migração idempotente **aditiva**: `supabase/migrations/20261105_parametros_fiscais_produtos.sql`, espelhada em `src/db/migracao.ts`. Cria `nk_fiscal_parametro` e `nk_produto_tributacao`; não modifica a estrutura nem atualiza registros de `nk_produto` e não toca tabelas legadas. Sem RLS novo; isolamento por empresa é feito no servidor.
- O boot da aplicação tenta aplicar a migração. Antes de publicar, preserve o backup e revise permissões do usuário da aplicação. Se a tabela não puder ser criada, a central mostra aviso e a emissão em produção bloqueia a ausência do complemento; o health simples não confirma a presença das tabelas. Não execute `supabase/schema.sql` nem aplique SQL manualmente sem revisão.
- Testes locais: `scripts/testar-tributacao-produtos.mjs` cobre 66 cenários de códigos, regimes, permissões, isolamento, perfil, auditoria, preservação do legado e inspeção do payload sem transmissão. O smoke também valida a rota e executa a suíte. O diagnóstico ganhou `fis-9..fis-13`.
