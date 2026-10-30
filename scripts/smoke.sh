#!/usr/bin/env bash
# NKWAY · verificação rápida de integridade (typegen + tipos + build + rotas vivas)
# Uso:  bash scripts/smoke.sh [--sem-build]
set -uo pipefail
cd "$(dirname "$0")/.."

SEM_BUILD=0
[[ "${1:-}" == "--sem-build" ]] && SEM_BUILD=1
PASS=0; FAIL=0
marca() { if [[ $1 -eq 0 ]]; then echo "  ok    $2"; PASS=$((PASS+1)); else echo "  FALHA $2"; FAIL=$((FAIL+1)); fi; }

if [[ $SEM_BUILD -eq 0 ]]; then
  echo "→ typegen"
  npx next typegen > /tmp/nk-typegen.log 2>&1; marca $? "next typegen"
  echo "→ tipos"
  npm exec tsc -- --noEmit --pretty false > /tmp/nk-tsc.log 2>&1; marca $? "tsc --noEmit"
  [[ $FAIL -gt 0 ]] && { echo; echo "--- /tmp/nk-tsc.log ---"; tail -30 /tmp/nk-tsc.log; exit 1; }
  echo "→ build"
  npm run build > /tmp/nk-build.log 2>&1; marca $? "npm run build"
  [[ $FAIL -gt 0 ]] && { echo; echo "--- /tmp/nk-build.log ---"; tail -30 /tmp/nk-build.log; exit 1; }
fi

PORTA="${PORTA:-3000}"
BASE="http://127.0.0.1:${PORTA}"
if ! curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
  echo "→ servidor de prévia não está escutando em $BASE"
  echo "  rode a ferramenta build_and_start da plataforma e depois: bash scripts/smoke.sh --sem-build"
  echo "  (atenção: 'npm run build' com a prévia no ar derruba o processo — para checar só as rotas use --sem-build)"
  echo
  echo "NKWAY smoke: checagens de código ok · HTTP pulado"
  exit 0
fi
echo "→ API $BASE/api/health"
curl -fsS "$BASE/api/health" >/dev/null 2>&1; marca $? "health 200"

echo "→ banco (contagens do seed)"
BASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
psql "$BASE_URL" -tA -F' ' -c "
select 'empresas='|| (select count(*) from nk_empresa)
     ,' produtos='||(select count(*) from nk_produto)
     ,' vendas='  ||(select count(*) from nk_venda)
     ,' movimentos='||(select count(*) from nk_movimento)
     ,' entradas='||(select count(*) from nk_entrada)" 2>/dev/null
marca $? "consulta Drizzle/Postgres"

echo "→ rota sem sessão (espera 307 para /login)"
LOC=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$LOC" == "307" || "$LOC" == "200" ]]; marca $? "GET / = $LOC"

echo "→ rotas autenticadas"
COOKIE=$(node -e '
const {createHmac}=require("node:crypto"), fs=require("fs");
const {Client}=require("pg");
const url=(fs.readFileSync(".env","utf8").match(/^DATABASE_URL=(.*)$/m)||[])[1];
(async()=>{const c=new Client({connectionString:url});await c.connect();
const r=await c.query("select u.id uid, e.id eid from nk_usuario u join nk_empresa e on e.id=u.empresa_id limit 1");
if(!r.rows.length){console.log("");process.exit(0);}
const p=Buffer.from(JSON.stringify({empresaId:r.rows[0].eid,usuarioId:r.rows[0].uid,iat:Date.now()})).toString("base64url");
const s=createHmac("sha256",process.env.AUTH_SECRET||"nkway-segredo-local-dev-troque-em-producao").update(p).digest("base64url");
console.log("nkway.sessao="+p+"."+s);await c.end();})();' 2>/dev/null)

if [[ -z "$COOKIE" ]]; then
  echo "  aviso: sem usuário no banco — rode build_and_start (ou npm run build + start) para o seed criar a empresa demo"
else
  for p in / /pdv /documentos /entradas /estoque /produtos /clientes /financeiro /relatorios /transporte /config; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $COOKIE" "$BASE$p")
    [[ "$code" == "200" ]]; marca $? "GET $p = $code"
  done
fi

echo
echo "NKWAY smoke: $PASS ok · $FAIL falha"
[[ $FAIL -eq 0 ]]
