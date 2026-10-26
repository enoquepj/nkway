# erp_estados — limite 10 MB por empresa

## O que é
Tabela `erp_estados`: **um JSON completo** do ERP por empresa (produtos, vendas, etc.).
RPC `salvar_estado_erp` / `carregar_estado_erp`.

## Limite
**10 MB (10.485.760 bytes)** medidos com `octet_length` do JSON.

## O que ocorre ao ultrapassar
1. A RPC devolve `{ ok: false, erro: "LIMITE_10MB", ... }`.
2. O app **não grava** o snapshot na nuvem.
3. Dados **locais** (localStorage) podem continuar; a barra fica vermelha.
4. Não apaga dados antigos sozinho.

## O que fazer
- Apagar vendas/entradas antigas no app
- Evitar embutir XML gigante no estado (DF-e fica em `nfe_entrada`)
- "Forçar save" não ignora o teto de 10 MB
- Upgrade futuro: subir o CHECK no SQL ou fatiar módulos

## Conflito de versão
Se dois dispositivos salvam juntos: `CONFLITO_VERSAO` → **Puxar** nuvem ou **Forçar save** (usa version 0 / force).
