#!/usr/bin/env node
/** Teste de integração isolado: somente PostgreSQL e prévia locais, com limpeza ao final. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";
import Papa from "papaparse";

const env = dotenv.parse(readFileSync(".env"));
const dbUrl = env.DATABASE_URL;
const base = process.env.BASE || "http://127.0.0.1:3000";
const hostsLocais = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!dbUrl || !hostsLocais.includes(new URL(dbUrl).hostname) || !hostsLocais.includes(new URL(base).hostname)) {
  throw new Error("Este teste só pode operar em banco e servidor locais.");
}
const client = new pg.Client({ connectionString: dbUrl });
const a = randomUUID(), b = randomUUID(), gerente = randomUUID(), operador = randomUUID(), adminB = randomUUID();
const sessaoFechada = randomUUID(), sessaoAberta = randomUUID(), sessaoB = randomUUID();
const produtosA = Array.from({ length: 11 }, () => randomUUID());
const s1 = randomUUID(), s2 = randomUUID(), davAberto = randomUUID(), filha = randomUUID(), davConcreto = randomUUID(), notaDuplicada = randomUUID(), historica = randomUUID(), cancelada = randomUUID(), vendaB = randomUUID();
let testes = 0;
function ok(condicao, mensagem) { assert.ok(condicao, mensagem); testes++; console.log(`  ok    ${mensagem}`); }
function cookie(empresaId, usuarioId) {
  const payload = Buffer.from(JSON.stringify({ empresaId, usuarioId, iat: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", process.env.AUTH_SECRET || env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao").update(payload).digest("base64url");
  return `nkway.sessao=${payload}.${sig}`;
}
const ckGerente = cookie(a, gerente), ckOperador = cookie(a, operador), ckAdminB = cookie(b, adminB);
async function chamar(path, ck) { return fetch(`${base}${path}`, { headers: ck ? { Cookie: ck } : {}, redirect: "manual" }); }
async function json(path, ck = ckGerente) { const r = await chamar(path, ck); const j = await r.json(); assert.equal(r.status, 200, `${path}: ${j.erro || r.status}`); return j; }
function indicador(j, rotulo) { return j.indicadores.find((x) => x.rotulo === rotulo)?.valor; }
async function venda({ id, empresa = a, numero, subtotal, desconto = 0, total, pagamentos, forma = null, tipo = "fiscal", status = "faturado", sessao = sessaoFechada, dav = null, nome = "Operador teste", usuario = operador, terminal = "ALFA" }) {
  await client.query(`insert into nk_venda (id,empresa_id,numero,subtotal,desconto,total,forma_pagamento,pagamentos,tipo,status,operador,operador_id,caixa_sessao_id,caixa,dav_origem_id,data) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,now())`,
    [id, empresa, numero, subtotal, desconto, total, forma || pagamentos[0]?.forma || "dinheiro", JSON.stringify(pagamentos), tipo, status, nome, usuario, sessao, terminal, dav]);
}
async function item(vendaId, produtoId, nome, qtd, total) {
  await client.query("insert into nk_venda_item (venda_id,produto_id,nome,qtd,preco_unit,total) values ($1,$2,$3,$4,$5,$6)", [vendaId, produtoId, nome, qtd, total / qtd, total]);
}

await client.connect();
try {
  await client.query("insert into nk_empresa (id,nome,cnpj,uf) values ($1,'Relatórios teste A','00000000000000','RO'),($2,'Relatórios teste B','00000000000001','RO')", [a, b]);
  await client.query("insert into nk_usuario (id,empresa_id,nome,email,senha_hash,papel,ativo) values ($1,$2,'Gerente teste',$3,'teste','gerente',true),($4,$2,'Usuário compartilhado',$5,'teste','operador',true),($6,$7,'Admin teste B',$8,'teste','administrador',true)", [gerente, a, `${gerente}@teste.invalid`, operador, `${operador}@teste.invalid`, adminB, b, `${adminB}@teste.invalid`]);
  const esperados = { dinheiro: 100, pix: 80, credito: 50, debito: 20 };
  const informados = { dinheiro: 90, pix: 90, credito: 50, debito: 20 };
  const diferencas = { dinheiro: -10, pix: 10, credito: 0, debito: 0 };
  await client.query(`insert into nk_caixa_sessao (id,empresa_id,numero,terminal,operador_id,operador_nome,status,aberto_em,fechado_em,valores_esperados,valores_informados,diferencas,diferenca_total) values
    ($1,$2,1,'ALFA',$3,'Operador teste','fechado',now() - interval '1 hour',now(),$4::jsonb,$5::jsonb,$6::jsonb,0),
    ($7,$2,2,'ALFA',$8,'Gerente teste','aberto',now(),null,$4::jsonb,$5::jsonb,$6::jsonb,0),
    ($9,$10,1,'BETA',$11,'Operador B','aberto',now(),null,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,0)`,
    [sessaoFechada, a, operador, JSON.stringify(esperados), JSON.stringify(informados), JSON.stringify(diferencas), sessaoAberta, gerente, sessaoB, b, adminB]);
  await client.query("insert into nk_caixa_movimento (empresa_id,sessao_id,tipo,forma,valor,motivo,usuario_id,usuario_nome,created_at) values ($1,$2,'sangria','dinheiro',15,'Recolhimento de teste',$3,'Operador teste',now())", [a, sessaoFechada, operador]);
  await client.query("insert into nk_caixa_quebra_log (empresa_id,sessao_id,usuario_id,valor_diferenca,tipo,justificativa,homologado_por_usuario_id,homologado_em) values ($1,$2,$3,10,'FALTA','Conferência de teste',$4,now())", [a, sessaoFechada, operador, gerente]);
  for (let i = 0; i < produtosA.length; i++) {
    await client.query("insert into nk_produto (id,empresa_id,nome,sku,categoria,custo,preco,estoque,estoque_min) values ($1,$2,$3,$4,'Categoria teste',3,10,$5,5)", [produtosA[i], a, `Produto teste ${i}`, i === 0 ? "=1+1" : `SKU-${i}`, i === 0 ? 3 : 100]);
  }
  await venda({ id: s1, numero: 1, subtotal: 110, desconto: 10, total: 100, pagamentos: [{ forma: "dinheiro", valor: 120 }] });
  await venda({ id: s2, numero: 2, subtotal: 100, total: 100, pagamentos: [{ forma: "dinheiro", valor: 40 }, { forma: "pix", valor: 80 }] });
  await venda({ id: davAberto, numero: 3, subtotal: 30, total: 30, pagamentos: [], tipo: "dav", status: "aberto" });
  await venda({ id: filha, numero: 4, subtotal: 30, total: 30, pagamentos: [{ forma: "pix", valor: 30 }], dav: davAberto });
  await venda({ id: davConcreto, numero: 5, subtotal: 50, total: 50, pagamentos: [{ forma: "credito", valor: 50 }], tipo: "dav" });
  await venda({ id: notaDuplicada, numero: 6, subtotal: 50, total: 50, pagamentos: [{ forma: "credito", valor: 50 }], dav: davConcreto });
  await venda({ id: historica, numero: 7, subtotal: 20, total: 20, pagamentos: [{ forma: "dinheiro", valor: 20 }], sessao: null, nome: "Histórico", usuario: null, terminal: "HISTÓRICO" });
  await venda({ id: cancelada, numero: 8, subtotal: 40, total: 40, pagamentos: [{ forma: "dinheiro", valor: 40 }], status: "cancelado" });
  await venda({ id: vendaB, empresa: b, numero: 1, subtotal: 999999, total: 999999, pagamentos: [{ forma: "pix", valor: 999999 }], sessao: sessaoB, nome: "Operador B", usuario: adminB, terminal: "BETA" });
  for (let i = 0; i < produtosA.length; i++) await item(s1, produtosA[i], `Produto teste ${i}`, 1, 10);
  await item(s2, produtosA[0], "Produto teste 0", 2, 100);
  await item(filha, produtosA[0], "Produto teste 0", 1, 30);
  await item(davConcreto, produtosA[0], "Produto teste 0", 1, 50);
  await item(notaDuplicada, produtosA[0], "Produto teste 0", 1, 50);
  await item(historica, produtosA[0], "Produto teste 0", 1, 20);
  await item(cancelada, produtosA[0], "Produto teste 0", 1, 40);
  await client.query("insert into nk_auditoria (empresa_id,usuario_id,usuario_nome,usuario_papel,acao,entidade,registro_id,resumo,alteracoes,created_at) values ($1,$2,'Operador teste','operador','venda.cancelar','venda',$3,'Cancelamento de teste',$4::jsonb,now())", [a, operador, cancelada, JSON.stringify({ motivo: " =1+1" })]);

  ok((await chamar("/api/relatorios/pdv")).status === 401, "API anônima bloqueada");
  ok((await chamar("/api/relatorios/pdv?exportar=csv")).status === 401, "CSV anônimo bloqueado");
  ok((await chamar("/api/relatorios/pdv", ckOperador)).status === 403, "operador não acessa a API");
  ok((await chamar("/api/relatorios/pdv?exportar=csv", ckOperador)).status === 403, "operador não exporta CSV");
  ok((await chamar("/dashboard/relatorios/pdv", ckOperador)).status === 307, "operador não acessa a página");
  ok((await chamar("/dashboard/relatorios/pdv", ckGerente)).status === 200, "gerente acessa a página");

  const visao = await json(`/api/relatorios/pdv?aba=visao&empresaId=${b}`);
  ok(indicador(visao, "Faturamento bruto") === 310 && indicador(visao, "Faturamento líquido") === 300, "empresa isolada, DAV deduplicado e histórico identificado");
  ok(indicador(visao, "Ticket médio") === 60 && indicador(visao, "Descontos") === 10, "ticket e descontos corretos");
  const forma = (nome) => visao.linhas.find((x) => x.forma === nome)?.valor;
  ok(forma("Dinheiro") === 140 && forma("PIX") === 110 && forma("Crédito") === 50, "divisão e troco descontado apenas do dinheiro");
  ok(visao.avisos.some((x) => x.includes("sem sessão")), "venda sem sessão é identificada");
  const outro = await json("/api/relatorios/pdv?aba=visao", ckAdminB);
  ok(indicador(outro, "Faturamento líquido") === 999999, "administrador da outra empresa não recebe dados cruzados");
  const filtrado = await json("/api/relatorios/pdv?aba=visao&terminal=ALFA");
  ok(indicador(filtrado, "Faturamento líquido") === 280, "filtro de terminal considera a sessão correta");

  const p1 = await json("/api/relatorios/pdv?aba=produtos&top=50&pagina=1");
  const p2 = await json("/api/relatorios/pdv?aba=produtos&top=50&pagina=2");
  ok(p1.total === 11 && p1.linhas.length === 10 && p2.linhas.length === 1, "ranking paginado no servidor sem perder linhas");
  ok(p1.linhas[0].alertaEstoque === "No mínimo" && p1.linhas[0].classe === "A", "curva ABC e estoque mínimo sinalizados");
  const semCategoria = await json("/api/relatorios/pdv?aba=produtos&categoria=Inexistente");
  ok(semCategoria.total === 0, "categoria filtra produtos no banco");
  const csvResp = await chamar("/api/relatorios/pdv?aba=produtos&top=50&exportar=csv", ckGerente);
  const csv = Papa.parse(await csvResp.text(), { header: true, delimiter: ";", skipEmptyLines: true });
  ok(csvResp.status === 200 && csv.data.length === 11, "CSV exporta todas as páginas do ranking filtrado");
  ok(csv.data.some((r) => String(r["Código / SKU"]).startsWith("'=")), "CSV protege células contra fórmulas de planilha");

  const caixa = await json("/api/relatorios/pdv?aba=caixa");
  const fechado = caixa.linhas.find((x) => x.status === "Fechado"), aberto = caixa.linhas.find((x) => x.status === "Aberto");
  ok(indicador(caixa, "Turnos com quebra") === 1, "faltas e sobras por forma não se anulam no relatório");
  ok(fechado?.dinheiroDiferenca === -10 && fechado?.pixDiferenca === 10, "esperado e declarado preservam sinal por modalidade");
  ok(aberto?.dinheiroEsperado === null && aberto?.dinheiroDeclarado === null, "turno aberto não expõe saldos do fechamento cego");
  ok(indicador(caixa, "Homologações registradas") === 1, "homologação é contada como evento registrado");
  const sangrias = await json("/api/relatorios/pdv?aba=caixa&detalhe=sangrias");
  ok(sangrias.total === 1 && sangrias.linhas[0].valor === 15, "histórico de sangrias do tenant está disponível");
  const desempenho = await json("/api/relatorios/pdv?aba=operadores&operador=Operador%20teste");
  ok(desempenho.total === 1 && desempenho.linhas[0].faturamento === 280 && desempenho.linhas[0].quebra === 20 && desempenho.linhas[0].acuracia === 92.86, "produtividade usa nome do turno e quebras absolutas por forma");
  ok(desempenho.linhas[0].tempo === "Não registrado", "tempo de atendimento não é inventado");
  const canc = await json("/api/relatorios/pdv?aba=cancelamentos");
  ok(canc.total === 1 && canc.linhas[0].valor === 40 && canc.linhas[0].autorizador === "Não registrado", "cancelamento auditado exibe motivo sem inventar autorizador");
  const csvCanc = await chamar("/api/relatorios/pdv?aba=cancelamentos&exportar=csv", ckGerente);
  const canceladosCsv = Papa.parse(await csvCanc.text(), { header: true, delimiter: ";", skipEmptyLines: true });
  ok(String(canceladosCsv.data[0]?.Motivo).startsWith("' ="), "CSV protege fórmulas com espaços iniciais");
  await venda({ id: randomUUID(), numero: 9, subtotal: 1, total: 1, pagamentos: [], forma: "vale_refeicao" });
  const formaLegada = await json("/api/relatorios/pdv?aba=visao");
  ok(formaLegada.avisos.some((x) => x.includes("forma desconhecida ou ausente")), "forma legada desconhecida produz aviso explícito");
  ok((await chamar("/api/relatorios/pdv?inicio=0000-01-01&fim=0000-01-02", ckGerente)).status === 400, "ano incompatível com PostgreSQL é rejeitado");
  ok((await chamar("/api/relatorios/pdv?inicio=2026-02-30", ckGerente)).status === 400, "datas inválidas são rejeitadas");
  ok((await chamar("/api/relatorios/pdv?inicio=2020-01-01&fim=2025-01-01", ckGerente)).status === 400, "períodos excessivos são rejeitados");
  ok((await chamar("/api/relatorios/pdv?autorizador=teste", ckGerente)).status === 400, "filtro de autorizador inexistente não é ignorado");
  console.log(`Relatórios PDV: ${testes} verificações aprovadas.`);
} catch (e) {
  console.error("Relatórios PDV: falha:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  const ids = [a, b];
  for (const comando of [
    "delete from nk_caixa_quebra_log where empresa_id = any($1::uuid[])",
    "delete from nk_caixa_movimento where empresa_id = any($1::uuid[])",
    "delete from nk_auditoria where empresa_id = any($1::uuid[])",
    "delete from nk_venda_item where venda_id in (select id from nk_venda where empresa_id = any($1::uuid[]))",
    "delete from nk_venda where empresa_id = any($1::uuid[])",
    "delete from nk_caixa_sessao where empresa_id = any($1::uuid[])",
    "delete from nk_produto where empresa_id = any($1::uuid[])",
    "delete from nk_usuario where empresa_id = any($1::uuid[])",
    "delete from nk_empresa where id = any($1::uuid[])",
  ]) { try { await client.query(comando, [ids]); } catch (e) { console.error("Falha ao limpar dados temporários:", e.message); process.exitCode = 1; } }
  await client.end();
}
