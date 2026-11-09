#!/usr/bin/env node
/** Integração do fechamento cego: somente servidor e PostgreSQL locais; dados temporários são removidos. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import pg from "pg";

const env = dotenv.parse(readFileSync(".env"));
const url = env.DATABASE_URL;
const base = process.env.BASE || "http://127.0.0.1:3000";
const locais = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!url || !locais.includes(new URL(url).hostname) || !locais.includes(new URL(base).hostname)) throw new Error("Teste permitido somente em banco e servidor locais.");
const segredo = process.env.AUTH_SECRET || env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao";
const cliente = new pg.Client({ connectionString: url });
const trava = new pg.Client({ connectionString: url });
const empresa = randomUUID(), outraEmpresa = randomUUID();
const operador = randomUUID(), outroOperador = randomUUID(), gerente = randomUUID(), gerenteInativo = randomUUID(), gerenteExterno = randomUUID();
const senhaGerente = randomBytes(24).toString("base64url"), senhaOperador = randomBytes(24).toString("base64url"), senhaExterna = randomBytes(24).toString("base64url");
const emailGerente = `${gerente}@teste.invalid`, emailOperador = `${operador}@teste.invalid`, emailInativo = `${gerenteInativo}@teste.invalid`, emailExterno = `${gerenteExterno}@teste.invalid`;
const idsAcoes = new Map();
const nomes = new Set(["fecharTurnoCego", "fecharCaixa", "registrarMovimentoCaixa", "registrarVendaSemNota", "registrarDav", "faturarDav", "cancelarVenda", "ajustarCaixaFechado"]);
function procurarAcoes(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) procurarAcoes(p);
    else if (p.endsWith(".js")) {
      const texto = readFileSync(p, "utf8");
      const re = /createServerReference\)\("([0-9a-f]{40,64})",[^\n]{0,250}?"([A-Za-z][A-Za-z0-9]*)"\)/g;
      for (const m of texto.matchAll(re)) if (nomes.has(m[2])) idsAcoes.set(m[2], m[1]);
    }
  }
}
procurarAcoes(".next/static/chunks");
for (const nome of nomes) if (!idsAcoes.has(nome)) throw new Error(`Ação ${nome} não encontrada no build atual.`);
function hash(senha) { const salt = randomBytes(16).toString("hex"); return `v1.${salt}.${createHmac("sha256", `${salt}:${segredo}`).update(senha).digest("hex")}`; }
function cookie(empresaId, usuarioId) {
  const payload = Buffer.from(JSON.stringify({ empresaId, usuarioId, iat: Date.now() })).toString("base64url");
  return `nkway.sessao=${payload}.${createHmac("sha256", segredo).update(payload).digest("base64url")}`;
}
const ckOperador = cookie(empresa, operador), ckOutro = cookie(empresa, outroOperador), ckGerente = cookie(empresa, gerente);
let passou = 0, numeroSessao = 100, numeroVenda = 100;
function ok(cond, nome) { assert.ok(cond, nome); passou++; console.log(`  ok    ${nome}`); }
async function acao(nome, input, ck = ckOperador, rota = nome === "fecharCaixa" || nome === "registrarMovimentoCaixa" || nome === "ajustarCaixaFechado" ? "/caixa" : "/pdv") {
  const resposta = await fetch(`${base}${rota}`, {
    method: "POST", headers: { "Next-Action": idsAcoes.get(nome), "Content-Type": "text/plain;charset=UTF-8", Origin: base, Cookie: ck },
    body: JSON.stringify([input]), signal: AbortSignal.timeout(30_000),
  });
  const texto = await resposta.text();
  assert.equal(resposta.status, 200, `${nome}: resposta HTTP ${resposta.status}`);
  for (const linha of texto.split("\n")) {
    const m = linha.match(/^[0-9a-f]+:(\{"ok":(?:true|false).*\})\s*$/);
    if (m) return JSON.parse(m[1]);
  }
  throw new Error(`${nome}: resposta estruturada não encontrada.`);
}
async function usuario(id, empresaId, nome, email, papel, senha, ativo = true) {
  await cliente.query("insert into nk_usuario(id,empresa_id,nome,email,senha_hash,papel,ativo) values($1,$2,$3,$4,$5,$6,$7)", [id, empresaId, nome, email, hash(senha), papel, ativo]);
}
async function sessao(saldo = 100, empresaId = empresa, usuarioId = operador) {
  const id = randomUUID();
  await cliente.query("insert into nk_caixa_sessao(id,empresa_id,numero,terminal,operador_id,operador_nome,status,saldo_inicial) values($1,$2,$3,'TESTE',$4,'Operador escolhido','aberto',$5)", [id, empresaId, ++numeroSessao, usuarioId, saldo]);
  return id;
}
async function venda(sid, total = 100, forma = "pix", recebido = total) {
  const id = randomUUID();
  await cliente.query("insert into nk_venda(id,empresa_id,numero,subtotal,total,forma_pagamento,pagamentos,tipo,status,operador_id,caixa_sessao_id,origem) values($1,$2,$3,$4,$4,$5,$6::jsonb,'sem_nota','faturado',$7,$8,'pdv')", [id, empresa, ++numeroVenda, total, forma, JSON.stringify([{ forma, valor: recebido }]), operador, sid]);
  return id;
}
const valores = (dinheiro, pix = 0) => ({ dinheiro, pix, credito: 0, debito: 0, boleto: 0, prazo: 0 });
const just = "Conferência local devidamente justificada";
const credenciais = { gerenteEmail: emailGerente, gerenteSenha: senhaGerente };
async function lerSessao(id) { return (await cliente.query("select * from nk_caixa_sessao where id=$1 and empresa_id=$2", [id, empresa])).rows[0]; }
async function aguardarBloqueios(quantidade) {
  const limite = Date.now() + 10_000;
  while (Date.now() < limite) {
    const r = await cliente.query("select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and lower(query) like '%nk_caixa_sessao%' and lower(query) like '%for update%'");
    if (r.rows[0].n >= quantidade) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("As ações não alcançaram a trava do turno no tempo esperado.");
}
async function disputar(id, primeira, segunda) {
  await trava.query("begin");
  let a, b;
  try {
    await trava.query("select id from nk_caixa_sessao where id=$1 and empresa_id=$2 for update", [id, empresa]);
    a = primeira(); await aguardarBloqueios(1);
    b = segunda(); await aguardarBloqueios(2);
    await trava.query("commit");
    return await Promise.all([a, b]);
  } catch (e) {
    try { await trava.query("rollback"); } catch {}
    await Promise.allSettled([a, b].filter(Boolean));
    throw e;
  }
}

await cliente.connect(); await trava.connect();
try {
  await cliente.query("insert into nk_empresa(id,nome,cnpj,uf) values($1,'Teste fechamento A','00000000000000','RO'),($2,'Teste fechamento B','00000000000001','RO')", [empresa, outraEmpresa]);
  await usuario(operador, empresa, "Usuário compartilhado", emailOperador, "operador", senhaOperador);
  await usuario(outroOperador, empresa, "Outro operador", `${outroOperador}@teste.invalid`, "operador", randomBytes(24).toString("base64url"));
  await usuario(gerente, empresa, "Gerente teste", emailGerente, "gerente", senhaGerente);
  await usuario(gerenteInativo, empresa, "Gerente inativo", emailInativo, "gerente", senhaGerente, false);
  await usuario(gerenteExterno, outraEmpresa, "Gerente externo", emailExterno, "gerente", senhaExterna);
  const externo = await sessao(100, outraEmpresa, gerenteExterno);
  const mista = await sessao(); await venda(mista);
  // Simula uma sessão reaberta com snapshot antigo; ele não pode chegar ao cliente enquanto aberta.
  await cliente.query("update nk_caixa_sessao set valores_esperados=$1::jsonb,total_esperado=9876543.21 where id=$2", [JSON.stringify({ dinheiro: 9876543.21 }), mista]);
  const paginaOperador = await fetch(`${base}/caixa`, { headers: { Cookie: ckOperador } });
  const htmlOperador = await paginaOperador.text();
  ok(paginaOperador.status === 200 && !htmlOperador.includes("esperadosMap") && !htmlOperador.includes("valoresEsperados") && !htmlOperador.includes("totalEsperado") && !htmlOperador.includes("9876543.21"), "/caixa não envia esperados de turno aberto ao operador");
  const paginaGerente = await fetch(`${base}/caixa`, { headers: { Cookie: ckGerente } });
  const htmlGerente = await paginaGerente.text();
  ok(paginaGerente.status === 200 && !htmlGerente.includes("esperadosMap") && !htmlGerente.includes("valoresEsperados") && !htmlGerente.includes("9876543.21"), "/caixa também protege turnos abertos no histórico gerencial");
  const paginaPdv = await fetch(`${base}/pdv`, { headers: { Cookie: ckOperador } });
  const htmlPdv = await paginaPdv.text();
  ok(paginaPdv.status === 200 && !htmlPdv.includes("esperadosMap") && !htmlPdv.includes("saldoDinheiroGaveta"), "/pdv mantém o saldo esperado fora do cliente");
  const entradaMista = { sessaoId: mista, valoresInformados: valores(90, 110), justificativa: just };
  const semJustificativa = await acao("fecharTurnoCego", { ...entradaMista, justificativa: "" });
  ok(!semJustificativa.ok && semJustificativa.requerHomologacao === true, "diferenças compensadas exigem justificativa e gerente");
  ok(!("apuracao" in semJustificativa) && !("conferencia" in semJustificativa) && !("valoresEsperados" in semJustificativa), "resposta cega não revela os valores esperados");
  const semSenha = await acao("fecharTurnoCego", entradaMista);
  ok(!semSenha.ok && semSenha.requerHomologacao === true, "justificativa isolada não substitui homologação");
  const porCaixa = await acao("fecharCaixa", { ...entradaMista, confirmado: true });
  ok(!porCaixa.ok && porCaixa.requerHomologacao === true, "caminho /caixa não contorna a homologação");
  const semConfirmar = await acao("fecharCaixa", { ...entradaMista, confirmado: false });
  ok(!semConfirmar.ok, "tela /caixa continua exigindo confirmação");
  for (const tentativa of [
    { gerenteEmail: emailGerente, gerenteSenha: randomBytes(24).toString("base64url") },
    { gerenteEmail: emailOperador, gerenteSenha: senhaOperador },
    { gerenteEmail: emailInativo, gerenteSenha: senhaGerente },
    { gerenteEmail: emailExterno, gerenteSenha: senhaExterna },
  ]) {
    const r = await acao("fecharTurnoCego", { ...entradaMista, ...tentativa });
    ok(!r.ok && r.requerHomologacao === true, "credencial inválida, inativa, sem perfil ou de outra empresa é recusada");
  }
  const outro = await acao("fecharTurnoCego", entradaMista, ckOutro);
  ok(!outro.ok, "outro operador não encerra a sessão alheia");
  const tenant = await acao("fecharTurnoCego", { sessaoId: externo, valoresInformados: valores(100) });
  ok(!tenant.ok, "sessão de outra empresa não pode ser encerrada");
  const invalido = await acao("fecharTurnoCego", { sessaoId: mista, valoresInformados: { dinheiro: "inválido" } });
  ok(!invalido.ok, "valor informado inválido é rejeitado sem erro 500");
  const neg = await acao("fecharTurnoCego", { sessaoId: mista, valoresInformados: { dinheiro: -1 } });
  ok(!neg.ok, "valor negativo é rejeitado");
  const anterior = await lerSessao(mista);
  const antesLogs = await cliente.query("select count(*)::int n from nk_caixa_quebra_log where sessao_id=$1", [mista]);
  ok(anterior.status === "aberto" && antesLogs.rows[0].n === 0, "tentativas recusadas não fecham nem geram logs de quebra");
  const aprovado = await acao("fecharTurnoCego", { ...entradaMista, ...credenciais });
  const fechada = await lerSessao(mista);
  const logs = (await cliente.query("select tipo,valor_diferenca,homologado_por_usuario_id from nk_caixa_quebra_log where sessao_id=$1 order by tipo", [mista])).rows;
  ok(aprovado.ok && fechada.status === "fechado" && fechada.status_aprovacao === "homologado" && fechada.homologado_por_usuario_id === gerente, "gerente da empresa homologa o fechamento");
  ok(Number(fechada.diferenca_total) === 0 && fechada.diferencas.dinheiro === -10 && fechada.diferencas.pix === 10, "snapshot conserva divergências compensadas por forma");
  ok(logs.length === 2 && logs[0].tipo === "FALTA" && Number(logs[0].valor_diferenca) === 10 && logs[1].tipo === "SOBRA" && Number(logs[1].valor_diferenca) === 10 && logs.every((x) => x.homologado_por_usuario_id === gerente), "faltas e sobras são auditadas separadamente");
  const htmlFechado = await (await fetch(`${base}/caixa`, { headers: { Cookie: ckGerente } })).text();
  ok(htmlFechado.includes("esperadosMap"), "histórico de turnos fechados preserva a conferência");
  const audit = (await cliente.query("select alteracoes from nk_auditoria where empresa_id=$1 and registro_id=$2 and acao='caixa.fechamento_cego'", [empresa, mista])).rows;
  ok(audit.length === 1 && audit[0].alteracoes.tipoQuebra === "MISTA" && !JSON.stringify(audit).includes(senhaGerente), "auditoria transacional registra situação mista sem credencial");
  const respostaRelatorio = await fetch(`${base}/api/relatorios/pdv?aba=caixa`, { headers: { Cookie: ckGerente } });
  const relatorio = await respostaRelatorio.json();
  ok(respostaRelatorio.status === 200 && relatorio.indicadores.find((x) => x.rotulo === "Homologações registradas")?.valor === 1, "relatório conta uma homologação mista apenas uma vez");

  const caixa = await sessao();
  const pedidoCaixa = { sessaoId: caixa, valoresInformados: valores(90), confirmado: true, justificativa: just };
  const negadoCaixa = await acao("fecharCaixa", pedidoCaixa);
  const aprovadoCaixa = await acao("fecharCaixa", { ...pedidoCaixa, ...credenciais });
  ok(!negadoCaixa.ok && negadoCaixa.requerHomologacao && aprovadoCaixa.ok, "/caixa solicita e aceita homologação de gerente");
  const antesAjuste = await lerSessao(caixa);
  const ajuste = await acao("ajustarCaixaFechado", { sessaoId: caixa, valoresInformados: valores(95), justificativa: just }, ckGerente);
  const depoisAjuste = await lerSessao(caixa);
  ok(ajuste.ok && JSON.stringify(antesAjuste.valores_esperados) === JSON.stringify(depoisAjuste.valores_esperados) && String(antesAjuste.total_esperado) === String(depoisAjuste.total_esperado), "ajuste não sobrescreve o snapshot esperado");

  const duplo = await sessao(150);
  const pedidoDuplo = { sessaoId: duplo, valoresInformados: valores(150) };
  const [d1, d2] = await Promise.all([acao("fecharTurnoCego", pedidoDuplo), acao("fecharTurnoCego", pedidoDuplo)]);
  const cofres = (await cliente.query("select count(*)::int n,coalesce(sum(valor),0)::numeric valor from nk_caixa_movimento where sessao_id=$1 and tipo='cofre'", [duplo])).rows[0];
  const auditorias = (await cliente.query("select count(*)::int n from nk_auditoria where empresa_id=$1 and registro_id=$2 and acao='caixa.fechamento_cego'", [empresa, duplo])).rows[0];
  ok([d1, d2].filter((x) => x.ok).length === 1 && cofres.n === 1 && Number(cofres.valor) === 50 && auditorias.n === 1, "fechamentos simultâneos geram um único snapshot, cofre e auditoria");
  const duploSessao = await lerSessao(duplo);
  ok(duploSessao.status_aprovacao == null && duploSessao.homologado_por_usuario_id == null, "turno sem divergência não inventa homologação");

  const movSessao = await sessao();
  const [closeMov, mov] = await disputar(movSessao,
    () => acao("fecharTurnoCego", { sessaoId: movSessao, valoresInformados: valores(100) }),
    () => acao("registrarMovimentoCaixa", { sessaoId: movSessao, tipo: "suprimento", forma: "dinheiro", valor: 20, motivo: "Teste de concorrência" }));
  ok(closeMov.ok ? !mov.ok : Boolean(mov.ok && closeMov.requerHomologacao), "movimentação concorrente não entra após um snapshot desatualizado");
  if (!closeMov.ok) ok((await acao("fecharTurnoCego", { sessaoId: movSessao, valoresInformados: valores(120) })).ok, "turno considera suprimento antes do fechamento");
  else ok(Number((await lerSessao(movSessao)).total_esperado) === 100, "turno encerrado exclui movimentação recusada");

  const produto = randomUUID();
  await cliente.query("insert into nk_produto(id,empresa_id,nome,sku,custo,preco,estoque,estoque_min) values($1,$2,'Produto concorrência','TESTE',5,20,100,1)", [produto, empresa]);
  const item = { produtoId: produto, qtd: 1, preco: 20 };
  const vendaSessao = await sessao();
  const [closeVenda, vendaConcorrente] = await disputar(vendaSessao,
    () => acao("fecharTurnoCego", { sessaoId: vendaSessao, valoresInformados: valores(100) }),
    () => acao("registrarVendaSemNota", { itens: [item], pagamentos: [{ forma: "dinheiro", valor: 20 }] }));
  ok(closeVenda.ok ? !vendaConcorrente.ok : Boolean(vendaConcorrente.ok && closeVenda.requerHomologacao), "venda concorrente não é gravada depois do fechamento");
  if (!closeVenda.ok) ok((await acao("fecharTurnoCego", { sessaoId: vendaSessao, valoresInformados: valores(120) })).ok, "snapshot inclui venda que venceu a disputa");
  else ok(Number((await lerSessao(vendaSessao)).total_esperado) === 100, "snapshot não inclui venda recusada após o fechamento");

  const cancelSessao = await sessao(); const vendaCancelar = await venda(cancelSessao);
  const [closeCancel, cancel] = await disputar(cancelSessao,
    () => acao("fecharTurnoCego", { sessaoId: cancelSessao, valoresInformados: valores(100, 100) }),
    () => acao("cancelarVenda", { vendaId: vendaCancelar, motivo: "Cancelamento local justificado" }));
  ok(closeCancel.ok ? !cancel.ok : Boolean(cancel.ok && closeCancel.requerHomologacao), "cancelamento concorrente não altera operação após o snapshot");
  if (!closeCancel.ok) ok((await acao("fecharTurnoCego", { sessaoId: cancelSessao, valoresInformados: valores(100) })).ok, "snapshot considera o estorno que venceu a disputa");
  else ok((await cliente.query("select status from nk_venda where id=$1", [vendaCancelar])).rows[0].status === "faturado", "venda permanece válida quando o fechamento vence");

  const davSessao = await sessao();
  const dav = await acao("registrarDav", { itens: [item] });
  assert.ok(dav.ok, "DAV de teste deve ser criado");
  const antesEstoque = Number((await cliente.query("select estoque from nk_produto where id=$1", [produto])).rows[0].estoque);
  const faturamento = await acao("faturarDav", { davId: dav.id, emitirNota: false, pagamentos: [{ forma: "dinheiro", valor: 20 }] });
  const repetido = await acao("faturarDav", { davId: dav.id, emitirNota: false, pagamentos: [{ forma: "dinheiro", valor: 20 }] });
  const depoisEstoque = Number((await cliente.query("select estoque from nk_produto where id=$1", [produto])).rows[0].estoque);
  ok(faturamento.ok && !repetido.ok && depoisEstoque === antesEstoque - 1, "DAV faturado uma vez e estoque baixado uma vez");
  ok((await acao("fecharTurnoCego", { sessaoId: davSessao, valoresInformados: valores(120) })).ok, "fechamento considera DAV faturado uma vez");

  const davConcSessao = await sessao(); const davConc = await acao("registrarDav", { itens: [item] }); assert.ok(davConc.ok);
  const [closeDav, faturarConc] = await disputar(davConcSessao,
    () => acao("fecharTurnoCego", { sessaoId: davConcSessao, valoresInformados: valores(100) }),
    () => acao("faturarDav", { davId: davConc.id, emitirNota: false, pagamentos: [{ forma: "dinheiro", valor: 20 }] }));
  ok(closeDav.ok ? !faturarConc.ok : Boolean(faturarConc.ok && closeDav.requerHomologacao), "DAV e fechamento concorrentes respeitam a mesma trava");
  const davEstado = (await cliente.query("select status from nk_venda where id=$1", [davConc.id])).rows[0].status;
  if (closeDav.ok) ok(davEstado === "aberto", "DAV recusado não é marcado como faturado");
  else ok(davEstado === "faturado" && (await acao("fecharTurnoCego", { sessaoId: davConcSessao, valoresInformados: valores(120) })).ok, "DAV aprovado é incluído no fechamento");

  const movPrimeiro = await sessao();
  const [mPrimeiro, fechaDepoisMov] = await disputar(movPrimeiro,
    () => acao("registrarMovimentoCaixa", { sessaoId: movPrimeiro, tipo: "suprimento", forma: "dinheiro", valor: 20, motivo: "Teste de concorrência" }),
    () => acao("fecharTurnoCego", { sessaoId: movPrimeiro, valoresInformados: valores(100) }));
  ok(mPrimeiro.ok && !fechaDepoisMov.ok && fechaDepoisMov.requerHomologacao, "suprimento anterior obriga nova conferência");
  ok((await acao("fecharTurnoCego", { sessaoId: movPrimeiro, valoresInformados: valores(120) })).ok && Number((await lerSessao(movPrimeiro)).total_esperado) === 120, "snapshot inclui suprimento concluído antes da trava");

  const vendaPrimeiro = await sessao();
  const [vPrimeiro, fechaDepoisVenda] = await disputar(vendaPrimeiro,
    () => acao("registrarVendaSemNota", { itens: [item], pagamentos: [{ forma: "dinheiro", valor: 20 }] }),
    () => acao("fecharTurnoCego", { sessaoId: vendaPrimeiro, valoresInformados: valores(100) }));
  ok(vPrimeiro.ok && !fechaDepoisVenda.ok && fechaDepoisVenda.requerHomologacao, "venda anterior obriga nova conferência");
  ok((await acao("fecharTurnoCego", { sessaoId: vendaPrimeiro, valoresInformados: valores(120) })).ok && Number((await lerSessao(vendaPrimeiro)).total_esperado) === 120, "snapshot inclui venda concluída antes da trava");

  const cancelPrimeiro = await sessao(); const vendaAntesCancelamento = await venda(cancelPrimeiro);
  const [cPrimeiro, fechaDepoisCancel] = await disputar(cancelPrimeiro,
    () => acao("cancelarVenda", { vendaId: vendaAntesCancelamento, motivo: "Cancelamento local justificado" }),
    () => acao("fecharTurnoCego", { sessaoId: cancelPrimeiro, valoresInformados: valores(100, 100) }));
  ok(cPrimeiro.ok && !fechaDepoisCancel.ok && fechaDepoisCancel.requerHomologacao, "estorno anterior obriga nova conferência");
  ok((await acao("fecharTurnoCego", { sessaoId: cancelPrimeiro, valoresInformados: valores(100) })).ok && Number((await lerSessao(cancelPrimeiro)).total_esperado) === 100, "snapshot inclui estorno concluído antes da trava");

  const davPrimeiro = await sessao(); const davAnterior = await acao("registrarDav", { itens: [item] }); assert.ok(davAnterior.ok);
  const [fPrimeiro, fechaDepoisDav] = await disputar(davPrimeiro,
    () => acao("faturarDav", { davId: davAnterior.id, emitirNota: false, pagamentos: [{ forma: "dinheiro", valor: 20 }] }),
    () => acao("fecharTurnoCego", { sessaoId: davPrimeiro, valoresInformados: valores(100) }));
  ok(fPrimeiro.ok && !fechaDepoisDav.ok && fechaDepoisDav.requerHomologacao, "faturamento de DAV anterior obriga nova conferência");
  ok((await acao("fecharTurnoCego", { sessaoId: davPrimeiro, valoresInformados: valores(120) })).ok && Number((await lerSessao(davPrimeiro)).total_esperado) === 120, "snapshot inclui DAV faturado antes da trava uma única vez");

  const inconsistente = await sessao(0); await venda(inconsistente, 100, "pix", 120);
  const tentativa = await acao("fecharTurnoCego", { sessaoId: inconsistente, valoresInformados: valores(0, 120) });
  const revisada = await acao("fecharTurnoCego", { sessaoId: inconsistente, valoresInformados: valores(0, 120), justificativa: just, ...credenciais });
  ok(!tentativa.ok && tentativa.requerHomologacao && revisada.ok, "recebimento inconsistente exige justificativa e gerente");

  // Ultrapassa deliberadamente a precisão do snapshot, sem alterar schema nem dados reais.
  const falhaTransacao = await sessao(9_999_999_999.99); await venda(falhaTransacao, 1, "dinheiro", 1);
  const falha = await acao("fecharTurnoCego", { sessaoId: falhaTransacao, valoresInformados: valores(0), justificativa: just, ...credenciais });
  const aposFalha = await lerSessao(falhaTransacao);
  const efeitos = (await cliente.query("select (select count(*) from nk_caixa_quebra_log where sessao_id=$1)::int logs,(select count(*) from nk_caixa_movimento where sessao_id=$1)::int movimentos,(select count(*) from nk_auditoria where empresa_id=$2 and registro_id=$1::text)::int auditorias", [falhaTransacao, empresa])).rows[0];
  ok(!falha.ok && !JSON.stringify(falha).includes("valoresEsperados"), "erro de gravação devolve mensagem cega e segura");
  ok(aposFalha.status === "aberto" && efeitos.logs === 0 && efeitos.movimentos === 0 && efeitos.auditorias === 0, "falha de gravação deixa turno, logs e cofre sem alterações parciais");
  // UI: o modal do PDV deve revelar a tela de autorização do gerente ao receber requerHomologacao.
  const srcModal = readFileSync("src/components/ModalFechamentoCego.tsx", "utf8");
  ok(/r\.requerHomologacao\)\s*setRequerHomologacao\(true\)/.test(srcModal), "modal do PDV marca requerHomologacao ao receber a flag do servidor");
  ok(srcModal.includes('requerHomologacao && (') && srcModal.includes("E-mail do gerente") && srcModal.includes("PIN / senha do gerente") && srcModal.includes('role="alert"'), "modal do PDV abre o bloco de autorização (banner + e-mail + PIN do gerente) dentro da própria tela de fermeture");
  const srcCaixa = readFileSync("src/views/Caixa.tsx", "utf8");
  ok(srcCaixa.includes("requerHomologacaoFechar && (") && srcCaixa.includes("gerenteEmailFechar") && srcCaixa.includes('role="alert"'), "tela /caixa também revela a autorização do gerente com banner visível");
  console.log(`Fechamento cego: ${passou} verificações aprovadas.`);
} catch (e) {
  console.error("Fechamento cego: falha:", e instanceof Error ? e.message : e); process.exitCode = 1;
} finally {
  try { await trava.query("rollback"); } catch {}
  const ids = [empresa, outraEmpresa];
  for (const sql of [
    "delete from nk_caixa_quebra_log where empresa_id = any($1::uuid[])",
    "delete from nk_caixa_movimento where empresa_id = any($1::uuid[])",
    "delete from nk_auditoria where empresa_id = any($1::uuid[])",
    "delete from nk_conta where empresa_id = any($1::uuid[])",
    "delete from nk_movimento where empresa_id = any($1::uuid[])",
    "delete from nk_venda_item where venda_id in (select id from nk_venda where empresa_id = any($1::uuid[]))",
    "delete from nk_venda where empresa_id = any($1::uuid[])",
    "delete from nk_caixa_sessao where empresa_id = any($1::uuid[])",
    "delete from nk_produto where empresa_id = any($1::uuid[])",
    "delete from nk_usuario where empresa_id = any($1::uuid[])",
    "delete from nk_empresa where id = any($1::uuid[])",
  ]) { try { await cliente.query(sql, [ids]); } catch (e) { console.error("Falha ao limpar dados temporários:", e.message); process.exitCode = 1; } }
  await trava.end(); await cliente.end();
}
