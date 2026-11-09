#!/usr/bin/env node
/**
 * NKWAY — Tabelas de domínio oficiais para a parametrização fiscal (campos selecionáveis).
 * Trabalha POR ETAPA (idempotente; upsert por tipo+codigo+uf):
 *   --etapa 1  Tabelas de lei estáveis: CST PIS, CST COFINS, CST ICMS, CSOSN, CST IPI, origem 0-8
 *   --etapa 2  Reforma IBS/CBS: CST IBS/CBS (18 códigos), alíquotas padrão 2026-2028 + metadados IT 2025.002
 *   --etapa 3  CFOP: metadados IT 2023.002 v2.10; importa planilha oficial se --arquivo <csv> for dado
 *   --etapa 4  cBenef por UF: metadados das 27 SEFAZ; importa se --arquivo <csv> --uf XX
 *   --todas     roda as 4 etapas na ordem
 * Uso: node scripts/inserir-tabelas-fiscais.mjs --etapa 1 [--etapa 2 ...] [--todas] [--arquivo caminho.csv] [--uf RS]
 * CSV oficial (planilha do portal convertida): codigo;descricao;vigIni;vigFim  (vigIni/vigFim AAAA-MM-DD ou DD/MM/AAAA)
 * Só roda contra banco LOCAL (localhost/127.0.0.1). Nunca altera produtos, notas ou parâmetros por empresa.
 */
import fs from "node:fs";
import dotenv from "dotenv";
import pg from "pg";
import Papa from "papaparse";

const args = process.argv.slice(2);
const etapas = new Set();
if (args.includes("--todas")) [1, 2, 3, 4].forEach((n) => etapas.add(n));
for (let i = 0; i < args.length; i++) if (args[i] === "--etapa") etapas.add(Number(args[i + 1]));
const arquivoIdx = args.indexOf("--arquivo");
const arquivo = arquivoIdx >= 0 ? args[arquivoIdx + 1] : null;
const ufIdx = args.indexOf("--uf");
const ufArg = ufIdx >= 0 ? String(args[ufIdx + 1]).toUpperCase() : "";
if (!etapas.size) { console.error("Informe --etapa 1..4 ou --todas."); process.exit(1); }

const env = dotenv.parse(fs.readFileSync(".env", "utf8"));
const dbUrl = process.env.DATABASE_URL || env.DATABASE_URL;
if (!dbUrl) { console.error("DATABASE_URL ausente no .env"); process.exit(1); }
const host = new URL(dbUrl).hostname;
if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) { console.error("Bloqueado: este script só roda contra banco LOCAL."); process.exit(1); }

const FONTE_PIS_COFINS = "Tabelas II/III — IN RFB (Leis 10.637/2002 e 10.833/2003) · Manual da NF-e/SPED";
const FONTE_CST_ICMS = "Tabela de CST do ICMS — Convênio SINIEF s/n (Anexo) · Manual da NF-e vigente";
const FONTE_CSOSN = "CSOSN — Anexos da LC 123/2006 · Manual da NF-e vigente";
const FONTE_CST_IPI = "Tabela de CST do IPI — TIPI (Decreto 11.158/2022) · Manual da NF-e vigente";
const FONTE_ORIGEM = "Tabela de origem da mercadoria — MOC/Siscomex · Manual da NF-e vigente";
const FONTE_IBS_CBS = "Portal Nacional da NF-e / SVRS — Informe Técnico 2025.002";
const URL_IBS_CBS = "https://dfe-portal.svrs.rs.gov.br/DFE/TabelaClassificacaoTributaria";
const REF_IBS_CBS = "IT 2025.002 v1.71 (publicado em 30/10/2026)";
const FONTE_CFOP = "Portal Nacional da NF-e — Informe Técnico 2023.002";
const URL_CFOP = "https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=hXzemuyNHW4=";
const REF_CFOP = "IT 2023.002 v2.10 (04/09/2026) — 619 códigos vigentes";

const CST_PIS_COFINS = [
  ["01", "Operação tributável com alíquota básica"], ["02", "Operação tributável com alíquota diferenciada"],
  ["03", "Operação tributável com alíquota por unidade de medida de produto"], ["04", "Operação tributável monofásica — revenda a alíquota zero"],
  ["05", "Operação tributável por substituição tributária"], ["06", "Operação tributável a alíquota zero"],
  ["07", "Operação isenta da contribuição"], ["08", "Operação sem incidência da contribuição"], ["09", "Operação com suspensão da contribuição"],
  ["49", "Outras operações de saída"],
  ["50", "Operação com direito a crédito — vinculada exclusivamente a receita tributada no mercado interno"],
  ["51", "Operação com direito a crédito — vinculada exclusivamente a receita não tributada no mercado interno"],
  ["52", "Operação com direito a crédito — vinculada exclusivamente a receita de exportação"],
  ["53", "Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno"],
  ["54", "Operação com direito a crédito — vinculada a receitas tributadas no mercado interno e de exportação"],
  ["55", "Operação com direito a crédito — vinculada a receitas não tributadas no mercado interno e de exportação"],
  ["56", "Operação com direito a crédito — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação"],
  ["60", "Crédito presumido — vinculada exclusivamente a receita tributada no mercado interno"],
  ["61", "Crédito presumido — vinculada exclusivamente a receita não tributada no mercado interno"],
  ["62", "Crédito presumido — vinculada exclusivamente a receita de exportação"],
  ["63", "Crédito presumido — vinculada a receitas tributadas e não tributadas no mercado interno"],
  ["64", "Crédito presumido — vinculada a receitas tributadas no mercado interno e de exportação"],
  ["65", "Crédito presumido — vinculada a receitas não tributadas no mercado interno e de exportação"],
  ["66", "Crédito presumido — vinculada a receitas tributadas e não tributadas no mercado interno e de exportação"],
  ["67", "Crédito presumido — outras operações"],
  ["70", "Operação de aquisição sem direito a crédito"], ["71", "Operação de aquisição com isenção"], ["72", "Operação de aquisição com suspensão"],
  ["73", "Operação de aquisição a alíquota zero"], ["74", "Operação de aquisição sem incidência da contribuição"],
  ["75", "Operação de aquisição por substituição tributária"], ["98", "Outras operações de entrada"], ["99", "Outras operações"],
];
const CST_ICMS = [
  ["00", "Tributada integralmente"], ["10", "Tributada e com cobrança do ICMS por substituição tributária"],
  ["20", "Com redução de base de cálculo"], ["30", "Isenta ou não tributada e com cobrança do ICMS por substituição tributária"],
  ["40", "Isenta"], ["41", "Não tributada"], ["50", "Suspensão"], ["51", "Diferimento"],
  ["60", "ICMS cobrado anteriormente por substituição tributária"], ["70", "Com redução de base de cálculo e cobrança do ICMS por ST"], ["90", "Outras"],
  ["02", "Código de tabela histórica — confirme a vigência no Manual da NF-e"], ["15", "Código de tabela histórica — confirme a vigência no Manual da NF-e"],
  ["53", "Código de tabela histórica — confirme a vigência no Manual da NF-e"], ["61", "Código de tabela histórica — confirme a vigência no Manual da NF-e"],
];
const CSOSN = [
  ["101", "Tributada pelo Simples Nacional com permissão de crédito"], ["102", "Tributada pelo Simples Nacional sem permissão de crédito"],
  ["103", "Isenção do ICMS no Simples Nacional para faixa de receita bruta"], ["201", "Tributada pelo Simples Nacional com permissão de crédito e com cobrança do ICMS por ST"],
  ["202", "Tributada pelo Simples Nacional sem permissão de crédito e com cobrança do ICMS por ST"], ["203", "Isenção do ICMS no Simples Nacional para faixa de receita bruta e com cobrança do ICMS por ST"],
  ["300", "Imune"], ["400", "Não tributada pelo Simples Nacional"], ["500", "ICMS cobrado anteriormente por ST ou por antecipação"], ["900", "Outros"],
];
const CST_IPI = [
  ["00", "Entrada com recuperação de crédito"], ["01", "Entrada tributável com alíquota zero"], ["02", "Entrada isenta"], ["03", "Entrada não tributada"],
  ["04", "Entrada imune"], ["05", "Entrada com suspensão"], ["49", "Outras entradas"], ["50", "Saída tributada"], ["51", "Saída tributável com alíquota zero"],
  ["52", "Saída isenta"], ["53", "Saída não tributada"], ["54", "Saída imune"], ["55", "Saída com suspensão"], ["99", "Outras saídas"],
];
const ORIGEM = [
  ["0", "Nacional"], ["1", "Estrangeira — importação direta"], ["2", "Estrangeira — adquirida no mercado interno"],
  ["3", "Nacional, conteúdo de importação superior a 40% e até 70%"], ["4", "Nacional, processos produtivos básicos"],
  ["5", "Nacional, conteúdo de importação até 40%"], ["6", "Estrangeira — importação direta, sem similar nacional"],
  ["7", "Estrangeira — mercado interno, sem similar nacional"], ["8", "Nacional, conteúdo de importação superior a 70%"],
];
const CST_IBS_CBS = [
  ["000", "Tributação integral"], ["010", "Tributação com alíquotas uniformes"], ["011", "Tributação com alíquotas uniformes reduzidas"],
  ["200", "Alíquota reduzida"], ["220", "Alíquota fixa"], ["221", "Alíquota fixa proporcional"], ["222", "Redução de base de cálculo"],
  ["400", "Isenção"], ["410", "Imunidade e não incidência"], ["510", "Diferimento"], ["515", "Diferimento com redução de alíquota"],
  ["550", "Suspensão"], ["620", "Tributação monofásica"], ["800", "Transferência de crédito"], ["810", "Ajuste de IBS na ZFM"],
  ["811", "Ajustes"], ["820", "Tributação em documento específico"], ["830", "Exclusão de base de cálculo"],
];
const ALIQUOTAS_PADRAO_IBS_CBS = [
  ["2026", "IBS estadual 0,10% · IBS municipal 0% · CBS 0,90%", "2026-01-01", "2026-12-31"],
  ["2027", "IBS estadual 0,05% · IBS municipal 0,05% · CBS a definir pela LC", "2027-01-01", "2027-12-31"],
  ["2028", "IBS estadual 0,05% · IBS municipal 0,05% · CBS a definir pela LC", "2028-01-01", "2028-12-31"],
];
const UFS = ["AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

function dataBR(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function lerArquivoCsv(tipo, uf) {
  if (!arquivo) return [];
  const csv = Papa.parse(fs.readFileSync(arquivo, "utf8"), { delimiter: ";", skipEmptyLines: true }).data;
  return csv.slice(1).map((l) => [String(l[0] ?? "").trim().replace(/\D/g, ""), String(l[1] ?? "").trim(), dataBR(l[2]), dataBR(l[3])])
    .filter((r) => r[0] && r[1]);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
// Aplica a migração aditiva das tabelas de domínio (idempotente) antes de inserir.
const ddl = fs.readFileSync(new URL("../supabase/migrations/20261109_tabelas_dominio_fiscal.sql", import.meta.url), "utf8");
await client.query(ddl);
let totalInseridas = 0;

async function upsertLinhas(tipo, linhas, fonte, versao, uf = "") {
  let n = 0;
  for (const [codigo, descricao, vigIni, vigFim] of linhas) {
    await client.query(
      `insert into nk_tabela_dominio (tipo, codigo, descricao, uf, vig_ini, vig_fim, fonte, versao, ativo, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,true,now())
       on conflict (tipo, codigo, uf) do update set descricao = excluded.descricao, vig_ini = excluded.vig_ini,
         vig_fim = excluded.vig_fim, fonte = excluded.fonte, versao = excluded.versao, ativo = true, atualizado_em = now()`,
      [tipo, codigo, descricao, uf, vigIni ?? null, vigFim ?? null, fonte, versao],
    );
    n++;
  }
  await client.query(
    `insert into nk_tabela_dominio_meta (tipo, fonte, referencia, url, versao, total, atualizado_em)
     values ($1,$2,$3,$4,$5,$6,now())
     on conflict (tipo) do update set fonte = excluded.fonte, referencia = excluded.referencia, url = excluded.url,
       versao = excluded.versao, total = excluded.total, atualizado_em = now()`,
    [tipo, fonte, versao || fonte, "", versao, n],
  );
  return n;
}
async function meta(tipo, fonte, referencia, url, versao) {
  const r = await client.query(`select count(*)::int as n from nk_tabela_dominio where tipo=$1 and ativo`, [tipo]);
  await client.query(
    `insert into nk_tabela_dominio_meta (tipo, fonte, referencia, url, versao, total, atualizado_em) values ($1,$2,$3,$4,$5,$6,now())
     on conflict (tipo) do update set fonte=excluded.fonte, referencia=excluded.referencia, url=excluded.url, versao=excluded.versao, total=excluded.total, atualizado_em=now()`,
    [tipo, fonte, referencia, url, versao, r.rows[0].n],
  );
  console.log(`  meta ${tipo}: ${r.rows[0].n} códigos ativos · ${referencia}`);
}

try {
  await client.query("begin");
  if (etapas.has(1)) {
    console.log("Etapa 1 — tabelas de lei estáveis (embutidas no script, fonte legal por linha):");
    totalInseridas += await upsertLinhas("cst_pis", CST_PIS_COFINS, FONTE_PIS_COFINS, "vigente em 2026");
    totalInseridas += await upsertLinhas("cst_cofins", CST_PIS_COFINS, FONTE_PIS_COFINS, "vigente em 2026");
    totalInseridas += await upsertLinhas("cst_icms", CST_ICMS, FONTE_CST_ICMS, "vigente em 2026");
    totalInseridas += await upsertLinhas("csosn", CSOSN, FONTE_CSOSN, "vigente em 2026");
    totalInseridas += await upsertLinhas("cst_ipi", CST_IPI, FONTE_CST_IPI, "vigente em 2026");
    totalInseridas += await upsertLinhas("origem", ORIGEM, FONTE_ORIGEM, "vigente em 2026");
    console.log(`  etapa 1: ${"ok"} (cst_pis, cst_cofins, cst_icms, csosn, cst_ipi, origem)`);
  }
  if (etapas.has(2)) {
    console.log("Etapa 2 — Reforma IBS/CBS (IT 2025.002, Portal NF-e/SVRS):");
    let n = await upsertLinhas("cst_ibs_cbs", CST_IBS_CBS.map(([c, d]) => [c, d]), FONTE_IBS_CBS, REF_IBS_CBS);
    n += await upsertLinhas("aliquota_padrao_ibs_cbs", ALIQUOTAS_PADRAO_IBS_CBS, FONTE_IBS_CBS, REF_IBS_CBS);
    totalInseridas += n;
    await meta("cst_ibs_cbs", FONTE_IBS_CBS, REF_IBS_CBS, URL_IBS_CBS, REF_IBS_CBS);
    await meta("aliquota_padrao_ibs_cbs", FONTE_IBS_CBS, REF_IBS_CBS, URL_IBS_CBS, REF_IBS_CBS);
    // cClassTrib (173 códigos) e cCredPres: importados da planilha oficial quando --arquivo for informado.
    const cclass = lerArquivoCsv("cclass_trib");
    if (cclass.length) { totalInseridas += await upsertLinhas("cclass_trib", cclass, FONTE_IBS_CBS, REF_IBS_CBS); await meta("cclass_trib", FONTE_IBS_CBS, REF_IBS_CBS, URL_IBS_CBS, REF_IBS_CBS); }
    else await meta("cclass_trib", FONTE_IBS_CBS, REF_IBS_CBS + " · importe com --arquivo <planilha oficial em CSV>", URL_IBS_CBS, REF_IBS_CBS);
    const cred = lerArquivoCsv("ccred_pres");
    if (cred.length) { totalInseridas += await upsertLinhas("ccred_pres", cred, FONTE_IBS_CBS, REF_IBS_CBS); await meta("ccred_pres", FONTE_IBS_CBS, REF_IBS_CBS, URL_IBS_CBS, REF_IBS_CBS); }
    else await meta("ccred_pres", FONTE_IBS_CBS, REF_IBS_CBS + " · importe com --arquivo <planilha oficial em CSV>", URL_IBS_CBS, REF_IBS_CBS);
    console.log(`  etapa 2: ok (cst_ibs_cbs ${CST_IBS_CBS.length}, alíquotas padrão 2026-2028, meta cclass_trib/ccred_pres)`);
  }
  if (etapas.has(3)) {
    console.log("Etapa 3 — CFOP (IT 2023.002, Portal NF-e):");
    const cfop = lerArquivoCsv("cfop");
    if (cfop.length) totalInseridas += await upsertLinhas("cfop", cfop, FONTE_CFOP, REF_CFOP);
    await meta("cfop", FONTE_CFOP, REF_CFOP + (cfop.length ? "" : " · importe a planilha oficial com --arquivo <csv>"), URL_CFOP, REF_CFOP);
    console.log(`  etapa 3: ok (cfop ${cfop.length} códigos do arquivo ou meta apenas)`);
  }
  if (etapas.has(4)) {
    console.log("Etapa 4 — cBenef por UF (publicado por cada SEFAZ):");
    for (const uf of UFS) {
      const linhas = ufArg && ufArg === uf ? lerArquivoCsv("cbenef", uf) : [];
      if (linhas.length) totalInseridas += await upsertLinhas("cbenef", linhas, `SEFAZ ${uf} — Tabela de Código de Benefício Fiscal (cBenef)`, "vigente conforme publicação da UF", uf);
      await meta("cbenef", `SEFAZ da UF do emitente — tabela cBenef por UF${ufArg ? ` (importada: ${ufArg})` : ""}`, "Tabela cBenef da SEFAZ estadual", `https://www.nfe.fazenda.gov.br/portal/`, "por UF");
    }
    console.log(`  etapa 4: ok (meta cbenef para ${UFS.length} UFs${ufArg ? `, importação ${ufArg}` : ""})`);
  }
  await client.query("commit");
  const r = await client.query("select tipo, count(*)::int as n from nk_tabela_dominio group by tipo order by tipo");
  console.log("\nResumo por tipo:");
  for (const row of r.rows) console.log(`  ${row.tipo}: ${row.n}`);
  console.log(`\nTotal de linhas inseridas/atualizadas nesta execução: ${totalInseridas}. Idempotente: rodar de novo não duplica.`);
} catch (e) {
  await client.query("rollback");
  console.error("Falha:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
