#!/usr/bin/env bash
# NKWAY · prova de robustez das server actions
# Chama toda ação encontrada nas telas com corpo [null] e [{}] — nenhuma pode devolver 500.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-http://127.0.0.1:3000}"

COOKIE=$(node -e '
const {createHmac}=require("node:crypto"), fs=require("fs");
const {Client}=require("pg");
const url=(fs.readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1];
(async()=>{const c=new Client({connectionString:url});await c.connect();
const r=await c.query("select u.id uid, e.id eid from nk_usuario u join nk_empresa e on e.id=u.empresa_id limit 1");
if(!r.rows.length){console.log("");return;}
const p=Buffer.from(JSON.stringify({empresaId:r.rows[0].eid,usuarioId:r.rows[0].uid,iat:Date.now()})).toString("base64url");
console.log("nkway.sessao="+p+"."+createHmac("sha256",process.env.AUTH_SECRET||"nkway-segredo-local-dev-troque-em-producao").update(p).digest("base64url"));await c.end();})();' 2>/dev/null)

if [[ -z "$COOKIE" ]]; then echo "sem usuário no banco — rode build_and_start antes"; exit 1; fi

# junta os ids de ação de todas as telas
declare -A VISTOS=()
for pagina in / /pdv /clientes /config /entradas /estoque /financeiro /documentos /transporte /devolucoes /produtos /relatorios; do
  curl -s -H "Cookie: $COOKIE" "$BASE$pagina" -o /tmp/nk-pg.html
  for c in $(grep -o '/_next/static/chunks/[a-z0-9_~.-]*\.js' /tmp/nk-pg.html | sort -u); do
    curl -s "$BASE$c" -o /tmp/nk-c.js
    for id in $(node -e 'const s=require("fs").readFileSync("/tmp/nk-c.js","utf8");const m=[...s.matchAll(/[0-9a-f]{40,64}/g)].map(x=>x[0]);process.stdout.write(m.join("\n"));' 2>/dev/null); do
      VISTOS["$pagina|$id"]=1
    done
  done
done

T=0; Q=0
for chave in "${!VISTOS[@]}"; do
  pagina="${chave%%|*}"; id="${chave#*|}"
  for corpo in '[null]' '[{}]'; do
    ST=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE$pagina" \
      -H "Next-Action: $id" -H "Content-Type: text/plain;charset=UTF-8" \
      -H "Origin: $BASE" --data "$corpo")
    T=$((T+1))
    # 404 = id de build antigo (Next avisa "Failed to find Server Action") — não é bug
    if [[ "$ST" == "500" ]]; then Q=$((Q+1)); echo "  500 em $pagina (${id:0:12}…) corpo=$corpo"; fi
  done
done
echo "NKWAY ações: $T chamadas · $Q com erro 500"
[[ $Q -eq 0 ]]
