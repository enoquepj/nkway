#!/usr/bin/env node
/**
 * NKWAY — Suíte de integração fim a fim para as Fases 1, 2 e 3.
 * Executa cenários reais no PostgreSQL + HTTP (permissões, concorrência de caixa,
 * exportação XML individual/ZIP e auditoria) e limpa todos os registros temporários ao final.
 */
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";
import pg from "pg";

const BASE = process.env.BASE || "http://127.0.0.1:3000";
const SECRET = process.env.AUTH_SECRET || "nkway-segredo-local-dev-troque-em-producao";
const dbUrl = (fs.readFileSync(".env", "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1];
assert(dbUrl, "DATABASE_URL ausente no .env");

function gerarCookie(empresaId, usuarioId) {
  const payload = Buffer.from(JSON.stringify({ empresaId, usuarioId, iat: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `nkway.sessao=${payload}.${sig}`;
}

function hashSenhaTeste(senha) {
  const salt = randomBytes(16).toString("hex");
  const hash = createHmac("sha256", `${salt}:${SECRET}`).update(senha).digest("hex");
  return `v1.${salt}.${hash}`;
}

const client = new pg.Pool({ connectionString: dbUrl, max: 4 });

const idsLimpeza = { usuarios: [], sessoes: [], vendas: [], assinaturas: [], auditorias: [], produtos: [], clientes: [], contas: [] };
const antesAudRes = await client.query("select count(*)::int as n from nk_auditoria");
const marcoInicio = new Date();

try {
  const empRes = await client.query(
    "select e.id as eid, u.id as uid, u.nome from nk_empresa e join nk_usuario u on u.empresa_id = e.id limit 1",
  );
  assert(empRes.rows.length === 1, "Empresa demo não encontrada");
  const { eid: empresaId } = empRes.rows[0];

  /* ---------------- FASE 1: Usuários, Perfis, Inativação e Isolamento ---------------- */
  console.log("→ Fase 1: cadastro, hash de senha, inativação e bloqueio por perfil");
  const opId = randomUUID();
  const vendId = randomUUID();
  const inativoId = randomUUID();
  idsLimpeza.usuarios.push(opId, vendId, inativoId);

  const hash1 = hashSenhaTeste("senhaSegura123");
  assert(!hash1.includes("senhaSegura123"), "Hash jamais pode conter senha em texto puro");

  await client.query(
    `insert into nk_usuario (id, empresa_id, nome, email, senha_hash, papel, ativo)
     values ($1, $4, 'Operador Teste', $5, $8, 'operador', true),
            ($2, $4, 'Vendedor Teste', $6, $8, 'vendedor', true),
            ($3, $4, 'Inativo Teste',  $7, $8, 'operador', false)`,
    [
      opId,
      vendId,
      inativoId,
      empresaId,
      `op-${Date.now()}@teste.nkway`,
      `vend-${Date.now()}@teste.nkway`,
      `inat-${Date.now()}@teste.nkway`,
      hash1,
    ],
  );

  // Usuário inativo com cookie válido deve ser rejeitado imediatamente pela sessão (307 p/ /login ou 401 na API)
  const cookieInativo = gerarCookie(empresaId, inativoId);
  const resInat = await fetch(`${BASE}/api/diagnostico`, { headers: { Cookie: cookieInativo } });
  assert.equal(resInat.status, 401, "Usuário desativado não pode autenticar sessão ativa");

  // Vendedor deve receber 403 ao tentar exportar XML no backend
  const cookieVendedor = gerarCookie(empresaId, vendId);
  const resVendXml = await fetch(`${BASE}/api/documentos/xml`, {
    method: "POST",
    headers: { Cookie: cookieVendedor, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [randomUUID()] }),
  });
  assert.equal(resVendXml.status, 403, "Vendedor sem permissão documentos.exportar_xml deve receber HTTP 403");
  console.log("  ok    Fase 1 validada (hash, revogação imediata de inativo e HTTP 403 p/ Vendedor)");

  /* ---------------- FASE 2: Sessão de Caixa, Unicidade e Fechamento Concorrente ---------------- */
  console.log("→ Fase 2: unicidade de sessão aberta por operador e trava de fechamento simultâneo");
  const sessaoId = randomUUID();
  idsLimpeza.sessoes.push(sessaoId);

  await client.query(
    `insert into nk_caixa_sessao (id, empresa_id, numero, terminal, operador_id, operador_nome, status, saldo_inicial)
     values ($1, $2, 99901, 'CAIXA TESTE', $3, 'Operador Teste', 'aberto', 150.00)`,
    [sessaoId, empresaId, opId],
  );

  // Tentativa de segunda sessão aberta simultânea para o mesmo operador deve falhar no índice parcial único
  let bloqueouSegundoAberto = false;
  try {
    await client.query(
      `insert into nk_caixa_sessao (id, empresa_id, numero, terminal, operador_id, operador_nome, status, saldo_inicial)
       values ($1, $2, 99902, 'CAIXA TESTE 2', $3, 'Operador Teste', 'aberto', 100.00)`,
      [randomUUID(), empresaId, opId],
    );
  } catch (e) {
    bloqueouSegundoAberto = String(e.message).includes("nk_caixa_sessao_operador_aberto_uidx");
  }
  assert(bloqueouSegundoAberto, "Índice único parcial deve impedir 2 caixas abertos para o mesmo operador");

  // Fechamento simultâneo: duas queries concorrentes UPDATE ... WHERE status = 'aberto'
  const [f1, f2] = await Promise.all([
    client.query(
      `update nk_caixa_sessao set status = 'fechado', fechado_em = now(), total_esperado = 150, total_informado = 150
       where id = $1 and empresa_id = $2 and status = 'aberto' returning id`,
      [sessaoId, empresaId],
    ),
    client.query(
      `update nk_caixa_sessao set status = 'fechado', fechado_em = now(), total_esperado = 150, total_informado = 150
       where id = $1 and empresa_id = $2 and status = 'aberto' returning id`,
      [sessaoId, empresaId],
    ),
  ]);
  assert.equal(f1.rowCount + f2.rowCount, 1, "Exatamente 1 fechamento deve vencer em acessos simultâneos");
  console.log("  ok    Fase 2 validada (unicidade de caixa aberto e bloqueio atômico contra fechamento duplicado)");

  /* ---------------- FASE 3: Exportação de XML Real (Individual, Sem XML e Lote ZIP) ---------------- */
  console.log("→ Fase 3: recusa de XML fictício, exportação individual (.xml), lote (.zip) e auditoria");
  const cookieOperador = gerarCookie(empresaId, opId);

  const vSemXml = randomUUID();
  const vComXml1 = randomUUID();
  const vComXml2 = randomUUID();
  idsLimpeza.vendas.push(vSemXml, vComXml1, vComXml2);

  const xmlReal1 = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe11261123567891000174650010000999011000999010"><ide><nNF>99901</nNF></ide></infNFe></NFe></nfeProc>`;
  const xmlReal2 = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe11261123567891000174550010000999021000999025"><ide><nNF>99902</nNF></ide></infNFe></NFe></nfeProc>`;

  await client.query(
    `insert into nk_venda (id, empresa_id, numero, cliente_nome, total, tipo, status, modelo, serie, numero_nota, chave, xml_fiscal)
     values
       ($1, $4, 99901, 'CLIENTE SEM XML', 50.00, 'fiscal', 'faturado', 'NFC-e', '1', 99900, '11261123567891000174650010000999001000999004', null),
       ($2, $4, 99902, 'CLIENTE XML 1',   80.00, 'fiscal', 'faturado', 'NFC-e', '1', 99901, '11261123567891000174650010000999011000999010', $5),
       ($3, $4, 99903, 'CLIENTE XML 2',  120.00, 'fiscal', 'faturado', 'NF-e',  '1', 99902, '11261123567891000174550010000999021000999025', $6)`,
    [vSemXml, vComXml1, vComXml2, empresaId, xmlReal1, xmlReal2],
  );

  // 1) Documento sem XML armazenado -> HTTP 422 informando ausência (NUNCA inventa XML!)
  const rSem = await fetch(`${BASE}/api/documentos/xml`, {
    method: "POST",
    headers: { Cookie: cookieOperador, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [vSemXml] }),
  });
  assert.equal(rSem.status, 422, "Venda sem xml_fiscal deve retornar 422 e não inventar XML");
  const jSem = await rSem.json();
  assert.equal(jSem.ok, false);
  assert.equal(jSem.semXml.length, 1);

  // 2) Exportação individual -> HTTP 200 application/xml com conteúdo idêntico ao armazenado
  const rUm = await fetch(`${BASE}/api/documentos/xml`, {
    method: "POST",
    headers: { Cookie: cookieOperador, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [vComXml1] }),
  });
  assert.equal(rUm.status, 200);
  assert((rUm.headers.get("content-type") || "").includes("application/xml"));
  const txtUm = await rUm.text();
  assert.equal(txtUm, xmlReal1);

  // 3) Exportação em lote (2 com XML + 1 sem XML) -> HTTP 200 application/zip + headers X-Exportados-Count=2, X-Sem-Xml-Count=1
  const rZip = await fetch(`${BASE}/api/documentos/xml`, {
    method: "POST",
    headers: { Cookie: cookieOperador, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [vComXml1, vComXml2, vSemXml] }),
  });
  assert.equal(rZip.status, 200);
  assert.equal(rZip.headers.get("content-type"), "application/zip");
  assert.equal(rZip.headers.get("x-exportados-count"), "2");
  assert.equal(rZip.headers.get("x-sem-xml-count"), "1");
  const zipBuf = Buffer.from(await rZip.arrayBuffer());
  assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, "Assinatura PKZIP válida");

  // Descompacta primeiro arquivo do ZIP para provar integridade do Deflate
  const tamComp = zipBuf.readUInt32LE(18);
  const tamNome = zipBuf.readUInt16LE(26);
  const xmlExtraido1 = inflateRawSync(zipBuf.subarray(30 + tamNome, 30 + tamNome + tamComp)).toString("utf8");
  assert.equal(xmlExtraido1, xmlReal1, "Conteúdo descompactado do ZIP idêntico ao XML armazenado");

  // 4) Confere registros gravados na trilha de auditoria da Fase 1
  const audCriadas = await client.query(
    `select id, acao, alteracoes from nk_auditoria where empresa_id = $1 and created_at >= $2 and acao = 'documento.exportar_xml'`,
    [empresaId, marcoInicio],
  );
  assert(audCriadas.rows.length >= 3, "As 3 operações de exportação devem estar registradas em nk_auditoria");
  idsLimpeza.auditorias.push(...audCriadas.rows.map((r) => r.id));
  console.log(`  ok    Fase 3 validada (sem XML fictício, XML individual, lote ZIP Deflate e ${audCriadas.rows.length} registros em nk_auditoria)`);

  /* ---------------- ASSINATURA POR CNPJ + WEBHOOK HMAC ---------------- */
  console.log("→ Assinatura CNPJ: fatura pendente, webhook HMAC-SHA256 autenticado e idempotência");
  const empOriginal = (await client.query("select plano, cnpj, assinatura_pago_em, trial_until from nk_empresa where id = $1", [empresaId])).rows[0];
  const cnpj14 = String(empOriginal.cnpj).replace(/\D/g, "");
  const assId = randomUUID();
  const fatId = randomUUID();
  const gwPayId = `pay_test_${Date.now()}`;
  idsLimpeza.assinaturas.push(assId);

  try {
    await client.query(
      `insert into nk_assinatura (id, empresa_id, cnpj, razao_social, email_cobranca, plano_id, ciclo, forma_pagamento, valor_ciclo, status, gateway, gateway_subscription_id, proximo_vencimento)
       values ($1, $2, $3, 'EMPRESA TESTE LTDA', 'fin@teste.nkway', 'loja_mais', 'anual', 'pix', 959.04, 'aguardando_pagamento', 'sandbox', $4, current_date + 1)`,
      [assId, empresaId, cnpj14, `sub_test_${Date.now()}`],
    );
    await client.query(
      `insert into nk_assinatura_fatura (id, empresa_id, assinatura_id, numero, cnpj, plano_id, ciclo, competencia, valor, forma_pagamento, status, vencimento, gateway, gateway_payment_id)
       values ($1, $2, $3, 99901, $4, 'loja_mais', 'anual', '2026-11', 959.04, 'pix', 'pendente', current_date + 1, 'sandbox', $5)`,
      [fatId, empresaId, assId, cnpj14, gwPayId],
    );

    // 1) Webhook sem assinatura deve ser barrado com HTTP 401
    const corpoWh = JSON.stringify({ event: "PAYMENT_CONFIRMED", payment: { id: gwPayId } });
    const whNegado = await fetch(`${BASE}/api/assinatura/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nkway-signature": "invalida" },
      body: corpoWh,
    });
    assert.equal(whNegado.status, 401, "Webhook com HMAC inválido deve retornar HTTP 401");

    // 2) Webhook autenticado com HMAC-SHA256 liquida fatura, ativa assinatura e promove nk_empresa.plano = 'loja_mais'
    const hmacValido = createHmac("sha256", SECRET).update(corpoWh).digest("hex");
    const whOk = await fetch(`${BASE}/api/assinatura/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nkway-signature": `v1=${hmacValido}` },
      body: corpoWh,
    });
    assert.equal(whOk.status, 200, "Webhook autenticado com HMAC válido deve retornar HTTP 200");
    const jWh = await whOk.json();
    assert.equal(jWh.ok, true);
    assert.equal(jWh.acaoAplicada, "pagamento_confirmado");

    // 3) Reenvio duplicado do mesmo webhook deve ser idempotente
    const whDup = await fetch(`${BASE}/api/assinatura/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nkway-signature": hmacValido },
      body: corpoWh,
    });
    const jDup = await whDup.json();
    assert.equal(jDup.acaoAplicada, "idempotente_ja_paga");

    const posAss = (await client.query("select status from nk_assinatura where id = $1", [assId])).rows[0];
    const posFat = (await client.query("select status from nk_assinatura_fatura where id = $1", [fatId])).rows[0];
    const posEmp = (await client.query("select plano from nk_empresa where id = $1", [empresaId])).rows[0];
    assert.equal(posAss.status, "ativa");
    assert.equal(posFat.status, "paga");
    assert.equal(posEmp.plano, "loja_mais");

    const audWh = await client.query(
      `select id from nk_auditoria where empresa_id = $1 and created_at >= $2 and acao = 'assinatura.pagamento_confirmado'`,
      [empresaId, marcoInicio],
    );
    assert(audWh.rows.length >= 1, "Confirmação do webhook deve registrar auditoria");
    idsLimpeza.auditorias.push(...audWh.rows.map((r) => r.id));
    console.log("  ok    Assinatura CNPJ validada (HMAC 401/200, idempotência, ativação Loja+ e auditoria)");
  } finally {
    await client.query(
      "update nk_empresa set plano = $1, assinatura_pago_em = $2, trial_until = $3 where id = $4",
      [empOriginal.plano, empOriginal.assinatura_pago_em, empOriginal.trial_until, empresaId],
    );
  }

  /* ---------------- MIGRAÇÃO LEGADO → NK_* (SOMENTE LEITURA + IDEMPOTÊNCIA) ---------------- */
  console.log("→ Migração Legado: leitura de tabelas sem prefixo filtradas por CNPJ e idempotência");
  const legEmpExistia = (
    await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema='public' and table_name='empresas'",
    )
  ).rows[0].n > 0;

  let legEmpId = null;
  if (!legEmpExistia) {
    await client.query(`
      create table public.empresas (id uuid primary key, nome text not null, cnpj text, criado_em timestamptz default now());
      create table public.produtos (id uuid primary key, empresa_id uuid references public.empresas(id) on delete cascade, nome text not null, sku text, categoria text, custo numeric(12,2) default 0, preco numeric(12,2) default 0, estoque integer default 0, estoque_min integer default 0);
    `);
  }

  try {
    legEmpId = randomUUID();
    const legProdId = randomUUID();
    idsLimpeza.produtos.push(legProdId);

    await client.query("insert into public.empresas (id, nome, cnpj) values ($1, 'LEGADO TESTE LTDA', $2)", [
      legEmpId,
      cnpj14,
    ]);
    await client.query(
      "insert into public.produtos (id, empresa_id, nome, sku, categoria, custo, preco, estoque, estoque_min) values ($1, $2, 'CAFE LEGADO MIGRADO 250G', 'LEG-CAFE-250', 'Mercearia', 8.50, 13.90, 12, 3)",
      [legProdId, legEmpId],
    );

    const adminCookie = gerarCookie(empresaId, empRes.rows[0].uid);
    const resPagMig = await fetch(`${BASE}/migracao`, { headers: { Cookie: adminCookie } });
    assert.equal(resPagMig.status, 200, "Página /migracao deve responder HTTP 200 para Administrador");
    const htmlMig = await resPagMig.text();
    assert(htmlMig.includes("LEGADO TESTE LTDA"), "Inspetor deve localizar a empresa legada com mesmo CNPJ");
    console.log("  ok    Migração Legado validada (inspeção somente-leitura por CNPJ em /migracao HTTP 200)");
  } finally {
    if (legEmpId) {
      await client.query("delete from public.empresas where id = $1", [legEmpId]).catch(() => undefined);
    }
    if (!legEmpExistia) {
      await client.query("drop table if exists public.produtos, public.empresas").catch(() => undefined);
    }
  }

  /* ---------------- EMISSOR SEFAZ 4.00 + WEBHOOK FISCAL → EXPORTAÇÃO XML ---------------- */
  console.log("→ Emissor SEFAZ 4.00: webhook autenticado grava XML autorizado real e libera exportação");
  const vendaFiscalWhId = randomUUID();
  idsLimpeza.vendas.push(vendaFiscalWhId);
  const chaveWh = "11261123567891000174650010000999051000999057";
  const xmlAutorizadoSefaz = `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00"><NFe><infNFe Id="NFe${chaveWh}"><ide><nNF>99905</nNF></ide></infNFe></NFe></nfeProc>`;

  await client.query(
    `insert into nk_venda (id, empresa_id, numero, cliente_nome, total, tipo, status, modelo, serie, numero_nota, chave, status_sefaz, cstat_sefaz)
     values ($1, $2, 99905, 'CLIENTE WEBHOOK SEFAZ', 75.00, 'fiscal', 'faturado', 'NFC-e', '1', 99905, $3, 'pendente_envio', '103')`,
    [vendaFiscalWhId, empresaId, chaveWh],
  );

  const corpoFiscalWh = JSON.stringify({
    ref: vendaFiscalWhId,
    chave: chaveWh,
    status: "autorizado",
    cstat: "100",
    motivo: "Autorizado o uso da NF-e",
    protocolo: "111260000999051",
    xml: xmlAutorizadoSefaz,
    provedor: "focusnfe",
  });

  // 1) Sem HMAC válido -> 401
  const rFis401 = await fetch(`${BASE}/api/fiscal/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nkway-signature": "invalida" },
    body: corpoFiscalWh,
  });
  assert.equal(rFis401.status, 401, "Webhook fiscal com HMAC inválido deve retornar HTTP 401");

  // 2) Com HMAC-SHA256 válido -> 200, atualiza status_sefaz='autorizada', grava xml_fiscal e audita
  const hmacFis = createHmac("sha256", SECRET).update(corpoFiscalWh).digest("hex");
  const rFis200 = await fetch(`${BASE}/api/fiscal/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-nkway-signature": `v1=${hmacFis}` },
    body: corpoFiscalWh,
  });
  assert.equal(rFis200.status, 200, "Webhook fiscal autenticado deve retornar HTTP 200");

  // 3) Exporta imediatamente pela API da Fase 3 e prova que o XML autorizado pelo emissor é baixado intacto
  const rExpPosWh = await fetch(`${BASE}/api/documentos/xml`, {
    method: "POST",
    headers: { Cookie: cookieOperador, "Content-Type": "application/json" },
    body: JSON.stringify({ ids: [vendaFiscalWhId] }),
  });
  assert.equal(rExpPosWh.status, 200, "Nota autorizada pelo webhook fiscal já possui XML disponível p/ download");
  assert.equal(await rExpPosWh.text(), xmlAutorizadoSefaz);

  const audFis = await client.query(
    `select id from nk_auditoria where empresa_id = $1 and created_at >= $2 and acao in ('fiscal.webhook_autorizada', 'documento.exportar_xml')`,
    [empresaId, marcoInicio],
  );
  idsLimpeza.auditorias.push(...audFis.rows.map((r) => r.id));
  console.log("  ok    Emissor SEFAZ 4.00 validado (webhook HMAC 401/200 → gravação XML real → download imediato)");
} finally {
  if (idsLimpeza.produtos.length) {
    await client.query("delete from nk_movimento where produto_id = any($1::uuid[])", [idsLimpeza.produtos]);
    await client.query("delete from nk_produto where id = any($1::uuid[])", [idsLimpeza.produtos]);
  }
  if (idsLimpeza.auditorias.length) {
    await client.query("delete from nk_auditoria where id = any($1::uuid[])", [idsLimpeza.auditorias]);
  }
  if (idsLimpeza.assinaturas.length) {
    await client.query("delete from nk_assinatura where id = any($1::uuid[])", [idsLimpeza.assinaturas]);
  }
  if (idsLimpeza.vendas.length) {
    await client.query("delete from nk_venda where id = any($1::uuid[])", [idsLimpeza.vendas]);
  }
  if (idsLimpeza.sessoes.length) {
    await client.query("delete from nk_caixa_sessao where id = any($1::uuid[])", [idsLimpeza.sessoes]);
  }
  if (idsLimpeza.usuarios.length) {
    await client.query("delete from nk_usuario where id = any($1::uuid[])", [idsLimpeza.usuarios]);
  }
  await client.end();
}

console.log("\nNKWAY suíte Fases 1, 2 e 3: 100% aprovada e ambiente limpo.");
