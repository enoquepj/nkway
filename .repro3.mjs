import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
const BASE = "http://127.0.0.1:3000";
const url = fs.readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)[1];
const c = new pg.Client({ connectionString: url }); await c.connect();
const r = await c.query("select u.id uid, e.id eid from nk_usuario u join nk_empresa e on e.id=u.empresa_id limit 1");
const p = Buffer.from(JSON.stringify({ empresaId: r.rows[0].eid, usuarioId: r.rows[0].uid, iat: Date.now() })).toString("base64url");
const COOKIE = "nkway.sessao=" + p + "." + createHmac("sha256", "nkway-segredo-local-dev-troque-em-producao").update(p).digest("base64url");
const h = { Cookie: COOKIE };
const html = await (await fetch(BASE + "/pdv", { headers: h })).text();
const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[a-z0-9_~.-]*\.js/g)].map(m => m[0]))];
let alvo = null, achou = [];
for (const ch of chunks) {
  const js = await (await fetch(BASE + ch)).text();
  for (const chave of ["requerHomologacao", "TurnoCego", "gerenteSenha"]) {
    const i = js.indexOf(chave);
    if (i >= 0) achou.push(chave + "@" + ch);
  }
  if (js.includes("requerHomologacao")) {
    const seg = js.slice(Math.max(0, js.indexOf("requerHomologacao") - 800), js.indexOf("requerHomologacao") + 200);
    const ids = [...seg.matchAll(/"([0-9a-f]{64})"/g)].map(m => m[1]);
    if (ids.length) alvo = ids[ids.length - 1];
  }
}
console.log("encontrado:", [...new Set(achou)].join(", "));
console.log("id ação:", alvo ? alvo.slice(0, 12) + "…" : "NENHUM");
if (alvo) {
  const c2 = new pg.Client({ connectionString: url }); await c2.connect();
  const sess = await c2.query("select id from nk_caixa_sessao where status='aberto' order by aberto_em desc limit 1");
  const sessaoId = sess.rows[0]?.id ?? "00000000-0000-4000-8000-000000000000";
  await c2.end();
  const resp = await fetch(BASE + "/pdv", { method: "POST", headers: { ...h, "Next-Action": alvo, "Content-Type": "text/plain;charset=UTF-8", Origin: BASE }, body: JSON.stringify([{ sessaoId, valoresInformados: { dinheiro: 99999 }, justificativa: "", gerenteEmail: "", gerenteSenha: "" }]) });
  console.log("HTTP", resp.status, (await resp.text()).slice(0, 400));
}
