#!/usr/bin/env node
/** Integração fiscal local: não transmite notas nem acessa banco remoto; limpa dados ao final. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

const env = dotenv.parse(readFileSync(".env"));
const dbUrl = env.DATABASE_URL;
const base = process.env.BASE || "http://127.0.0.1:3000";
const locais = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!dbUrl || !locais.includes(new URL(dbUrl).hostname) || !locais.includes(new URL(base).hostname)) throw new Error("Teste permitido somente em banco e servidor locais.");
const client = new pg.Client({ connectionString: dbUrl });
const empresaA = randomUUID(), empresaB = randomUUID(), adminA = randomUUID(), adminB = randomUUID(), operador = randomUUID(), gerente = randomUUID();
const produtoA = randomUUID(), produtoA2 = randomUUID(), produtoB = randomUUID(), produtoLegadoB = randomUUID(), clienteA = randomUUID();
const ids = new Map();
const nomes = new Set(["salvarCodigoFiscal", "salvarPerfilFiscal", "alterarStatusParametroFiscal", "salvarTributacaoProduto", "salvarProduto", "excluirProduto", "inspecionarDocumentoFiscal"]);
function procurarAcoes(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) procurarAcoes(p);
    else if (p.endsWith(".js")) for (const m of readFileSync(p, "utf8").matchAll(/createServerReference\)\("([0-9a-f]{40,64})",[^\n]{0,250}?"([A-Za-z][A-Za-z0-9]*)"\)/g)) if (nomes.has(m[2])) ids.set(m[2], m[1]);
  }
}
procurarAcoes(".next/static/chunks");
for (const nome of nomes) if (!ids.has(nome)) throw new Error(`Ação ${nome} não encontrada no build atual.`);
function cookie(empresaId, usuarioId) { const p = Buffer.from(JSON.stringify({ empresaId, usuarioId, iat: Date.now() })).toString("base64url"); return `nkway.sessao=${p}.${createHmac("sha256", process.env.AUTH_SECRET || env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao").update(p).digest("base64url")}`; }
const ckA = cookie(empresaA, adminA), ckB = cookie(empresaB, adminB), ckOp = cookie(empresaA, operador), ckGerente = cookie(empresaA, gerente);
let passou = 0;
function ok(condicao, nome) { assert.ok(condicao, nome); passou++; console.log(`  ok    ${nome}`); }
/** Lê registros JSON e textos longos (T + tamanho hexadecimal) do protocolo Flight. */
function lerResultadoFlight(texto) {
  const bytes = Buffer.from(texto, "utf8"), registros = new Map();
  let pos = 0;
  while (pos < bytes.length) {
    while (bytes[pos] === 10 || bytes[pos] === 13) pos++;
    if (pos >= bytes.length) break;
    const separador = bytes.indexOf(58, pos);
    if (separador < 0) break;
    const id = bytes.subarray(pos, separador).toString("utf8");
    if (!/^[0-9a-f]+$/.test(id)) throw new Error("Registro Flight inválido.");
    const inicio = separador + 1;
    if (bytes[inicio] === 84) {
      const virgula = bytes.indexOf(44, inicio + 1);
      if (virgula < 0) throw new Error("Texto Flight incompleto.");
      const tamanho = Number.parseInt(bytes.subarray(inicio + 1, virgula).toString("utf8"), 16);
      if (!Number.isSafeInteger(tamanho) || tamanho < 0 || virgula + 1 + tamanho > bytes.length) throw new Error("Tamanho de texto Flight inválido.");
      registros.set(id, bytes.subarray(virgula + 1, virgula + 1 + tamanho).toString("utf8"));
      pos = virgula + 1 + tamanho;
    } else {
      const fim = bytes.indexOf(10, inicio);
      const limite = fim < 0 ? bytes.length : fim;
      const linha = bytes.subarray(inicio, limite).toString("utf8");
      if (linha.startsWith("{")) {
        let registro;
        try { registro = JSON.parse(linha); } catch { registro = null; }
        if (registro) {
          registros.set(id, registro);
          if (typeof registro.ok === "boolean") {
            if (typeof registro.payloadJson === "string" && /^\$[0-9a-f]+$/.test(registro.payloadJson)) {
              const payload = registros.get(registro.payloadJson.slice(1));
              if (typeof payload !== "string") throw new Error("Payload fiscal segmentado não encontrado.");
              registro.payloadJson = payload;
            }
            return registro;
          }
        }
      }
      pos = fim < 0 ? bytes.length : fim + 1;
    }
  }
  const resultado = [...registros.values()].find((r) => r && typeof r === "object" && typeof r.ok === "boolean");
  if (!resultado) throw new Error("Resposta estruturada não encontrada.");
  if (typeof resultado.payloadJson === "string" && /^\$[0-9a-f]+$/.test(resultado.payloadJson)) {
    const payload = registros.get(resultado.payloadJson.slice(1));
    if (typeof payload !== "string") throw new Error("Payload fiscal segmentado não encontrado.");
    resultado.payloadJson = payload;
  }
  return resultado;
}
async function acao(nome, entrada, ck = ckA) {
  const rota = nome === "salvarProduto" || nome === "excluirProduto" ? "/produtos" : nome === "inspecionarDocumentoFiscal" ? "/emissor" : "/config/fiscal/produtos";
  const r = await fetch(`${base}${rota}`, { method: "POST", headers: { "Next-Action": ids.get(nome), "Content-Type": "text/plain;charset=UTF-8", Origin: base, Cookie: ck }, body: JSON.stringify([entrada]), signal: AbortSignal.timeout(30_000) });
  const conteudo = await r.text(); assert.equal(r.status, 200, `${nome}: HTTP ${r.status}`);
  const simples = conteudo.match(/(?:^|\n)[0-9a-f]+:(\{"ok":(?:true|false)[^\n]*\})\s*(?:\n|$)/);
  if (simples) return JSON.parse(simples[1]);
  return lerResultadoFlight(conteudo);
}
async function rota(rota, ck) { return fetch(`${base}${rota}`, { headers: ck ? { Cookie: ck } : {}, redirect: "manual" }); }
const vazio = { ncm: "", cest: "", cfop: "", cfopInterestadual: "", origem: "", tipoIcms: "", csosn: "", cstIcms: "", cstPis: "", cstCofins: "", cstIpi: "", cstIbsCbs: "", classTrib: "", beneficioFiscal: "", icmsAliq: "", pisAliq: "", cofinsAliq: "", ipiAliq: "", icmsStAliq: "", fcpAliq: "", ibsAliq: "", cbsAliq: "" };
const dadosA = { ...vazio, ncm: "1006.30.21", cest: "1200100", cfop: "5.102", cfopInterestadual: "6.102", origem: "1", tipoIcms: "csosn", csosn: "102", cstPis: "01", cstCofins: "01", cstIpi: "50", cstIbsCbs: "000", classTrib: "000001", beneficioFiscal: "RO123456", icmsAliq: "0", pisAliq: "1,65", cofinsAliq: "7,60", ipiAliq: "5", icmsStAliq: "12", fcpAliq: "2", ibsAliq: "0,10", cbsAliq: "0,90" };
const dadosB = { ...vazio, ncm: "10063021", cfop: "5102", origem: "2", tipoIcms: "cst", cstIcms: "00", csosn: "00", icmsAliq: "18", pisAliq: "1,65", cofinsAliq: "7,60" };

await client.connect();
try {
  await client.query("insert into nk_empresa(id,nome,cnpj,uf,regime,fiscal) values($1,'Fiscal teste A','00000000000000','RO','simples',$3::jsonb),($2,'Fiscal teste B','00000000000001','SP','real',$4::jsonb)", [empresaA, empresaB, JSON.stringify({ crt: 1, ambiente: 2 }), JSON.stringify({ crt: 3, ambiente: 2 })]);
  for (const [id, empresa, nome, papel] of [[adminA,empresaA,"Administrador A","administrador"],[adminB,empresaB,"Administrador B","administrador"],[operador,empresaA,"Operador A","operador"],[gerente,empresaA,"Gerente A","gerente"]]) await client.query("insert into nk_usuario(id,empresa_id,nome,email,senha_hash,papel,ativo) values($1,$2,$3,$4,'teste',$5,true)",[id,empresa,nome,`${id}@teste.invalid`,papel]);
  for (const [id, empresa, nome, csosn] of [[produtoA,empresaA,"Produto fiscal A","102"],[produtoA2,empresaA,"Produto fiscal A2","102"],[produtoB,empresaB,"Produto fiscal B","00"],[produtoLegadoB,empresaB,"Produto legado B","102"]]) await client.query("insert into nk_produto(id,empresa_id,nome,sku,gtin,categoria,unidade,custo,preco,estoque,estoque_min,ncm,cest,cfop,csosn,icms_aliq) values($1,$2,$3,$4,'SEM GTIN','Teste','UN',5,20,10,1,'00000000','1111111','5102',$5,0)",[id,empresa,nome,`SKU-${id.slice(0,8)}`,csosn]);
  await client.query("insert into nk_movimento(empresa_id,produto_id,produto_nome,tipo,qtd,saldo_apos,custo_unit,custo_medio_apos) values($1,$2,'Produto fiscal B','inventario',1,10,5,5)",[empresaB,produtoB]);
  await client.query("insert into nk_cliente(id,empresa_id,nome,documento,uf) values($1,$2,'Cliente teste','','SP')",[clienteA,empresaA]);
  ok((await rota("/config/fiscal/produtos")).status === 307, "central fiscal exige sessão");
  ok((await rota("/config/fiscal/produtos",ckOp)).status === 307 && (await rota("/config/fiscal/produtos",ckGerente)).status === 307, "central fiscal restrita ao administrador");
  const pagina = await rota(`/config/fiscal/produtos?produto=${produtoA}`,ckA); const html = await pagina.text();
  ok(pagina.status === 200 && html.includes("Parametrização fiscal de produtos") && html.includes("Produto fiscal A"), "central abre produto da empresa para parametrização");
  ok(html.includes("Pontos para revisão") && html.includes("CST IBS/CBS e cClassTrib não informados"), "ficha informa quando a classificação da reforma não foi preenchida");
  const catalogo = await rota("/produtos",ckA); ok((await catalogo.text()).includes("Tributação fiscal"), "cadastro de produtos oferece acesso fiscal");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "cfop", codigo: "5102", nome: "Venda" }, ckOp)).ok, "operador não cadastra códigos fiscais");
  ok(!(await acao("salvarPerfilFiscal", { nome: "Perfil negado", regime: "todos", dados: {} }, ckGerente)).ok, "gerente sem permissão não altera perfis");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: dadosA }, ckOp)).ok, "operador não altera tributação de produto");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA })).ok, "formulário incompleto não apaga dados do produto");
  ok((await client.query("select cest from nk_produto where id=$1 and empresa_id=$2", [produtoA, empresaA])).rows[0].cest === "1111111", "formulário incompleto preserva o CEST existente");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "ncm", codigo: "123", nome: "Inválido" })).ok, "NCM fora do formato é rejeitado");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "ncm", codigo: "00000000", nome: "Genérico" })).ok, "NCM genérico não é cadastrado como código válido");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "cfop", codigo: "4102", nome: "Inválido" })).ok, "CFOP com grupo inválido é rejeitado");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "csosn", codigo: "999", nome: "Inválido" })).ok, "CSOSN desconhecido é rejeitado");
  const codigo = await acao("salvarCodigoFiscal", { tipo: "cfop", codigo: "5.102", nome: "Venda interna" });
  ok(codigo.ok && (await client.query("select codigo from nk_fiscal_parametro where id=$1 and empresa_id=$2",[codigo.id,empresaA])).rows[0].codigo === "5102", "CFOP é cadastrado e normalizado por empresa");
  ok(!(await acao("salvarCodigoFiscal", { tipo: "cfop", codigo: "5102", nome: "Duplicado" })).ok, "código duplicado é recusado");
  const edicao = await acao("salvarCodigoFiscal", { id: codigo.id, tipo: "cfop", codigo: "5405", nome: "Descrição revisada" });
  ok(edicao.ok && (await client.query("select cfop from nk_produto where id=$1",[produtoA])).rows[0].cfop === "5102", "editar catálogo não altera produtos automaticamente");
  ok((await acao("alterarStatusParametroFiscal", { id: codigo.id, ativo: false })).ok && (await acao("alterarStatusParametroFiscal", { id: codigo.id, ativo: true })).ok, "código pode ser desativado e reativado");
  ok(!(await acao("alterarStatusParametroFiscal", { id: codigo.id })).ok, "status incompleto não desativa registros");
  const [conc1,conc2] = await Promise.all([acao("salvarCodigoFiscal", { tipo: "ncm", codigo: "10063021", nome: "NCM teste" }), acao("salvarCodigoFiscal", { tipo: "ncm", codigo: "10063021", nome: "NCM teste" })]);
  ok([conc1,conc2].filter((x)=>x.ok).length === 1, "cadastros simultâneos não duplicam o código");
  const externo = await acao("salvarCodigoFiscal", { tipo: "cst_icms", codigo: "00", nome: "Código externo" }, ckB);
  ok(externo.ok && !(await acao("salvarCodigoFiscal", { id: externo.id, tipo: "cst_icms", codigo: "40", nome: "Tentativa externa" })).ok, "código de outra empresa não pode ser editado");
  const perfil = await acao("salvarPerfilFiscal", { nome: "Perfil revenda", regime: "simples", dados: dadosA });
  ok(perfil.ok, "perfil fiscal por regime é cadastrado");
  ok(!(await acao("salvarPerfilFiscal", { nome: "perfil revenda", regime: "simples", dados: dadosA })).ok, "perfil com nome repetido é recusado");
  const [perfilConc1, perfilConc2] = await Promise.all([acao("salvarPerfilFiscal", { nome: "Perfil simultâneo", regime: "todos", dados: {} }), acao("salvarPerfilFiscal", { nome: "Perfil simultâneo", regime: "todos", dados: {} })]);
  ok([perfilConc1, perfilConc2].filter((r) => r.ok).length === 1, "perfis simultâneos não duplicam nomes na empresa");
  ok(!(await acao("salvarPerfilFiscal", { nome: "Perfil inválido", regime: "mei", dados: dadosB })).ok, "perfil MEI rejeita CST comum incompatível");
  const normal = await acao("salvarPerfilFiscal", { nome: "Perfil normal", regime: "real", dados: dadosB }, ckB);
  ok(normal.ok, "perfil com CST é aceito para regime normal");
  ok((await acao("salvarPerfilFiscal", { nome: "Perfil MEI", regime: "mei", dados: dadosA })).ok, "perfil MEI aceita CSOSN adequado ao CRT 4");
  const excesso = await acao("salvarPerfilFiscal", { nome: "Perfil excesso", regime: "simples_excedente", dados: dadosB });
  const presumido = await acao("salvarPerfilFiscal", { nome: "Perfil presumido", regime: "presumido", dados: dadosB });
  ok(excesso.ok && presumido.ok, "perfis de excesso e presumido aceitam CST");
  ok(!(await acao("salvarPerfilFiscal", { id: normal.id, nome: "Tentativa externa", regime: "real", dados: dadosB })).ok, "perfil de outra empresa não pode ser editado");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoB, dados: dadosA })).ok, "produto de outra empresa não pode ser parametrizado");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: normal.id, dados: dadosA })).ok, "perfil de outra empresa não pode ser vinculado");
  const salvo = await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: perfil.id, dados: dadosA, sobrescreverNcmCest: true });
  const a = (await client.query("select ncm,cest,cfop,csosn,pis_aliq,cofins_aliq,ibs_aliq,cbs_aliq from nk_produto where id=$1 and empresa_id=$2",[produtoA,empresaA])).rows[0];
  const complemento = (await client.query("select perfil_id,dados from nk_produto_tributacao where produto_id=$1 and empresa_id=$2",[produtoA,empresaA])).rows[0];
  ok(salvo.ok && a.ncm === "10063021" && a.cfop === "5102" && a.cest === "1200100" && Number(a.pis_aliq) === 1.65 && Number(a.cofins_aliq) === 7.6, "produto recebe códigos e alíquotas sem perda de precisão (sobrescrita explícita de NCM/CEST)");
  const semFlag = await acao("salvarTributacaoProduto", { produtoId: produtoA2, dados: dadosA });
  const a2 = (await client.query("select ncm,cest,cfop,pis_aliq from nk_produto where id=$1 and empresa_id=$2", [produtoA2, empresaA])).rows[0];
  ok(semFlag.ok && a2.ncm === "00000000" && a2.cest === "1111111" && a2.cfop === "5102" && Number(a2.pis_aliq) === 1.65, "etapa 3: sem flag explícita, a central preserva NCM/CEST do produto e aplica só o resto");
  const logPreservou = (await client.query("select alteracoes from nk_auditoria where acao='fiscal.produto_parametrizar' and registro_id=$1 order by created_at desc limit 1", [produtoA2])).rows[0];
  ok(logPreservou?.alteracoes?.ncmCestPreservados === true && logPreservou?.alteracoes?.sobrescreverNcmCest === false, "auditoria registra que NCM/CEST foram preservados");
  ok(complemento.perfil_id === perfil.id && complemento.dados.origem === "1" && complemento.dados.classTrib === "000001", "complementos e vínculo de perfil são persistidos");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, pisAliq: "101" } })).ok && !(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, fcpAliq: "1,234" } })).ok, "alíquotas fora do intervalo ou precisão são rejeitadas");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, icmsAliq: "-1" } })).ok, "alíquota negativa é rejeitada");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, origem: "9" } })).ok, "origem fora da tabela é rejeitada");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, cest: "123" } })).ok, "CEST fora do formato é rejeitado");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, cfopInterestadual: "5102" } })).ok, "CFOP interestadual incompatível é rejeitado");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, cstIbsCbs: "00" } })).ok && !(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, classTrib: "123" } })).ok, "CST IBS/CBS e cClassTrib exigem tamanhos corretos");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, cstIbsCbs: "200", classTrib: "000001" } })).ok, "produto rejeita CST IBS/CBS e cClassTrib com prefixos diferentes");
  ok(!(await acao("salvarPerfilFiscal", { nome: "Perfil IBS inconsistente", regime: "todos", dados: { ...dadosA, cstIbsCbs: "200", classTrib: "000001" } })).ok, "perfil rejeita classificação incompatível com o CST");
  const revisaoPerfil = await acao("salvarPerfilFiscal", { id: perfil.id, nome: "Perfil revenda", regime: "simples", dados: { ...dadosA, cfop: "5405" } });
  ok(revisaoPerfil.ok && (await client.query("select cfop from nk_produto where id=$1",[produtoA])).rows[0].cfop === "5102", "alteração do perfil não muda o produto já salvo");
  ok((await acao("alterarStatusParametroFiscal", { id: perfil.id, ativo: false })).ok, "perfil pode ser desativado sem apagar vínculo");
  ok((await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: perfil.id, dados: dadosA })).ok, "produto mantém vínculo histórico com perfil inativo ao editar");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA2, perfilId: perfil.id, dados: dadosA })).ok, "perfil inativo não pode ser aplicado a outro produto");
  ok((await acao("alterarStatusParametroFiscal", { id: perfil.id, ativo: true })).ok, "perfil pode ser reativado");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, tipoIcms: "cst", cstIcms: "00" } })).ok, "CRT Simples rejeita CST comum incompatível");
  ok((await acao("salvarTributacaoProduto", { produtoId: produtoA, dados: { ...dadosA, tipoIcms: "cst", cstIcms: "61" } })).ok, "CRT Simples aceita CST monofásico aplicável");
  ok((await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: perfil.id, dados: dadosA })).ok, "produto pode retornar ao CSOSN válido");
  const produtoNormal = await acao("salvarTributacaoProduto", { produtoId: produtoB, perfilId: normal.id, dados: dadosB }, ckB);
  ok(produtoNormal.ok && (await client.query("select csosn from nk_produto where id=$1",[produtoB])).rows[0].csosn === "00", "CRT normal aceita CST e preserva valor legado inativo");
  ok(!(await acao("salvarTributacaoProduto", { produtoId: produtoB, dados: { ...dadosB, tipoIcms: "csosn", csosn: "102" } }, ckB)).ok, "CRT normal não aceita CSOSN como classificação ativa");

  const vendaA = randomUUID(), vendaNfce = randomUUID(), vendaB = randomUUID(), vendaLegada = randomUUID();
  for (const [id,empresa,prod,cli,modelo,n] of [[vendaA,empresaA,produtoA,clienteA,"NF-e",1],[vendaNfce,empresaA,produtoA,clienteA,"NFC-e",2],[vendaB,empresaB,produtoB,null,"NF-e",1],[vendaLegada,empresaB,produtoLegadoB,null,"NF-e",2]]) {
    await client.query("insert into nk_venda(id,empresa_id,numero,cliente_id,cliente_nome,subtotal,total,forma_pagamento,pagamentos,tipo,status,modelo,serie,numero_nota,ambiente) values($1,$2,$3,$4,'CONSUMIDOR',20,20,'pix',$5::jsonb,'fiscal','faturado',$6,'1',$3,'2')",[id,empresa,n,cli,JSON.stringify([{forma:"pix",valor:20}]),modelo]);
    await client.query("insert into nk_venda_item(venda_id,produto_id,nome,qtd,preco_unit,total,unidade,gtin) values($1,$2,'Produto teste',1,20,20,'UN','SEM GTIN')",[id,prod]);
  }
  const inspeA = await acao("inspecionarDocumentoFiscal", { vendaId: vendaA }); assert.ok(inspeA.ok); const payA = JSON.parse(inspeA.payloadJson);
  ok(payA.itens[0].cfop === "6102" && payA.itens[0].ncm === "10063021" && payA.itens[0].cest === "1200100", "NF-e interestadual usa CFOP configurado e dados do produto");
  ok(payA.itens[0].impostos.origem === 1 && payA.itens[0].impostos.csosn === "102" && payA.itens[0].impostos.cstPis === "01" && payA.itens[0].impostos.pisAliquota === 1.65, "payload incorpora origem, CSOSN, PIS e alíquota configurados");
  ok(payA.itens[0].impostos.reformaTributaria2026.cst === "000" && payA.itens[0].impostos.reformaTributaria2026.cClassTrib === "000001", "payload inclui CST e cClassTrib informados para IBS/CBS");
  await client.query("update nk_produto_tributacao set dados=jsonb_set(dados,'{classTrib}',to_jsonb($2::text)) where produto_id=$1", [produtoA, "200001"]);
  const divergente = await acao("inspecionarDocumentoFiscal", { vendaId: vendaA }); assert.ok(divergente.ok);
  ok(divergente.bloqueios.some((a) => a.codigoSefaz === "NKWAY-PARAM"), "emissor bloqueia classificação previamente gravada com CST divergente");
  await client.query("update nk_produto_tributacao set dados=jsonb_set(dados,'{classTrib}',to_jsonb($2::text)) where produto_id=$1", [produtoA, "000001"]);
  assert.ok((await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: perfil.id, dados: { ...dadosA, classTrib: "" } })).ok);
  const reformaIncompleta = await acao("inspecionarDocumentoFiscal", { vendaId: vendaA }); assert.ok(reformaIncompleta.ok);
  ok(reformaIncompleta.alertas.some((a) => a.codigoSefaz === "NKWAY-IBSCBS"), "IBS/CBS incompleto gera alerta em homologação");
  await client.query("update nk_empresa set fiscal=jsonb_set(fiscal,'{ambiente}','1'::jsonb) where id=$1", [empresaA]);
  const reformaProducao = await acao("inspecionarDocumentoFiscal", { vendaId: vendaA }); assert.ok(reformaProducao.ok);
  ok(reformaProducao.bloqueios.some((a) => a.codigoSefaz === "NKWAY-IBSCBS"), "IBS/CBS incompleto bloqueia operação em produção");
  await client.query("update nk_empresa set fiscal=jsonb_set(fiscal,'{ambiente}','2'::jsonb) where id=$1", [empresaA]);
  assert.ok((await acao("salvarTributacaoProduto", { produtoId: produtoA, perfilId: perfil.id, dados: dadosA })).ok);
  const inspeNfce = await acao("inspecionarDocumentoFiscal", { vendaId: vendaNfce }); assert.ok(inspeNfce.ok); ok(JSON.parse(inspeNfce.payloadJson).itens[0].cfop === "5102", "NFC-e mantém CFOP padrão interno");
  const inspeB = await acao("inspecionarDocumentoFiscal", { vendaId: vendaB }, ckB); assert.ok(inspeB.ok); const impB = JSON.parse(inspeB.payloadJson).itens[0].impostos;
  ok(impB.cstIcms === "00" && !("csosn" in impB) && impB.origem === 2, "payload do regime normal usa CST em vez de CSOSN");
  const legado = await acao("inspecionarDocumentoFiscal", { vendaId: vendaLegada }, ckB); assert.ok(legado.ok);
  ok(legado.alertas.some((a) => a.codigoSefaz === "NKWAY-CST") && JSON.parse(legado.payloadJson).itens[0].impostos.csosn === "102", "cadastro legado sem CST mantém payload anterior e gera alerta em homologação");
  ok(legado.alertas.some((a) => a.codigoSefaz === "NKWAY-IBSCBS-AUSENTE"), "regime normal sem classificação IBS/CBS recebe aviso de revisão");
  await client.query("update nk_empresa set fiscal=jsonb_set(fiscal,'{ambiente}','1'::jsonb) where id=$1", [empresaB]);
  const legadoProducao = await acao("inspecionarDocumentoFiscal", { vendaId: vendaLegada }, ckB); assert.ok(legadoProducao.ok);
  ok(legadoProducao.bloqueios.some((a) => a.codigoSefaz === "NKWAY-CST"), "operação de produção em CRT normal é bloqueada sem CST configurado");
  await client.query("update nk_empresa set fiscal=jsonb_set(fiscal,'{ambiente}','2'::jsonb) where id=$1", [empresaB]);
  ok(!(await acao("inspecionarDocumentoFiscal", { vendaId: vendaB })).ok, "inspeção fiscal não cruza empresas");
  const inputProduto = { id: produtoB, nome: "Alteração indevida", sku: "B", gtin: "SEM GTIN", categoria: "Teste", marca: "", unidade: "UN", custo: 5, preco: 20, estoque: 10, estoqueMin: 1, pesavel: false, ativo: true, ncm: "10063021", cfop: "5102", csosn: "102", icmsAliq: 0 };
  ok(!(await acao("salvarProduto", inputProduto)).ok, "cadastro legado não altera produto de outra empresa");
  ok(!(await acao("excluirProduto", produtoB)).ok && Number((await client.query("select count(*)::int n from nk_movimento where produto_id=$1 and empresa_id=$2",[produtoB,empresaB])).rows[0].n) === 1, "exclusão de outra empresa não apaga seu kardex");
  const auditoria = (await client.query("select acao,empresa_id from nk_auditoria where empresa_id = any($1::uuid[]) and acao like 'fiscal.%'",[[empresaA,empresaB]])).rows;
  ok(auditoria.some((x)=>x.acao === "fiscal.produto_parametrizar" && x.empresa_id === empresaA) && auditoria.some((x)=>x.acao === "fiscal.perfil_criar" && x.empresa_id === empresaB), "alterações ficam auditadas no tenant correto");
  console.log(`Tributação de produtos: ${passou} verificações aprovadas.`);
} catch (e) { console.error("Tributação de produtos: falha:", e instanceof Error ? e.message : e); process.exitCode = 1; }
finally {
  const empresas = [empresaA,empresaB];
  for (const sql of [
    "delete from nk_produto_tributacao where empresa_id = any($1::uuid[])",
    "delete from nk_fiscal_parametro where empresa_id = any($1::uuid[])",
    "delete from nk_auditoria where empresa_id = any($1::uuid[])",
    "delete from nk_movimento where empresa_id = any($1::uuid[])",
    "delete from nk_venda_item where venda_id in (select id from nk_venda where empresa_id = any($1::uuid[]))",
    "delete from nk_venda where empresa_id = any($1::uuid[])",
    "delete from nk_cliente where empresa_id = any($1::uuid[])",
    "delete from nk_produto where empresa_id = any($1::uuid[])",
    "delete from nk_usuario where empresa_id = any($1::uuid[])",
    "delete from nk_empresa where id = any($1::uuid[])",
  ]) { try { await client.query(sql,[empresas]); } catch (e) { console.error("Falha ao limpar dados temporários:",e.message);process.exitCode=1; } }
  await client.end();
}
