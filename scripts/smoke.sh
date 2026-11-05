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

echo "→ lock de pacotes e isolamento dos espelhos"
node scripts/testar-tsconfig-entrega.mjs > /tmp/nk-tsconfig-entrega.log 2>&1
ESPELHO=$?
marca $ESPELHO "lock sincronizado e arquivos reais verificados sem espelhos"
if [[ $ESPELHO -ne 0 ]]; then cat /tmp/nk-tsconfig-entrega.log; exit 1; fi

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

echo "→ rota sem sessão (espera 307 para /login)"

echo "→ banco (contagens do seed)"
BASE_URL=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)
psql "$BASE_URL" -tA -F' ' -c "
select 'empresas='|| (select count(*) from nk_empresa)
     ,' produtos='||(select count(*) from nk_produto)
     ,' vendas='  ||(select count(*) from nk_venda)
     ,' movimentos='||(select count(*) from nk_movimento)
     ,' entradas='||(select count(*) from nk_entrada)
     ,' inutilizacoes='||(select count(*) from nk_inutilizacao)
     ,' eventos='||(select count(*) from nk_evento_fiscal)" 2>/dev/null
marca $? "consulta Drizzle/Postgres"

echo "→ rota sem sessão (espera 307 para /login)"
LOC=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
[[ "$LOC" == "307" || "$LOC" == "200" ]]; marca $? "GET / = $LOC"
PDV_ANON=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/pdv")
[[ "$PDV_ANON" == "307" ]]; marca $? "GET /pdv sem sessão = $PDV_ANON"

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
  for p in / /pdv /caixa /documentos /emissor /dfe /entradas /devolucoes /estoque /produtos /clientes /financeiro /relatorios /transporte /usuarios /assinatura /migracao /prontidao /dashboard/auditoria-caixa /dashboard/relatorios/pdv /config; do
    code=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: $COOKIE" "$BASE$p")
    [[ "$code" == "200" ]]; marca $? "GET $p = $code"
  done

  PDV_HTML=$(curl -s -H "Cookie: $COOKIE" "$BASE/pdv")
  if echo "$PDV_HTML" | grep -qE "ERP · PDV · Fiscal|Abrir PDV|Monitor Emissor SEFAZ"; then
    marca 1 "/pdv sem Shell (sidebar/topbar/footer ausentes)"
  else
    marca 0 "/pdv sem Shell (sidebar/topbar/footer ausentes)"
  fi

  DOC_HTML=$(curl -s -H "Cookie: $COOKIE" "$BASE/documentos")
  if echo "$DOC_HTML" | grep -q "ERP · PDV · Fiscal" && echo "$DOC_HTML" | grep -q "Abrir PDV"; then
    marca 0 "/documentos continua com Shell"
  else
    marca 1 "/documentos continua com Shell"
  fi

  ROOT_HTML=$(curl -s -H "Cookie: $COOKIE" "$BASE/")
  if echo "$ROOT_HTML" | grep -q "Starter template"; then
    marca 1 "/ mostra o Dashboard (não o template inicial)"
  else
    marca 0 "/ mostra o Dashboard (não o template inicial)"
  fi

  CRON_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/dfe/dist")
  [[ "$CRON_CODE" == "401" ]]; marca $? "GET /api/dfe/dist sem segredo = $CRON_CODE"
  CRON_ERRADO=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/dfe/dist" -H "x-dfe-cron-secret: segredo-errado" -H "Authorization: Bearer segredo-errado" -H "Content-Type: application/json" --data '{"origem":"smoke"}')
  [[ "$CRON_ERRADO" == "401" ]]; marca $? "POST /api/dfe/dist com segredo errado = $CRON_ERRADO"

  REL_PDV_ANON=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/relatorios/pdv")
  [[ "$REL_PDV_ANON" == "401" ]]; marca $? "GET /api/relatorios/pdv sem sessão = $REL_PDV_ANON"

  PRON_ANON=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/prontidao")
  [[ "$PRON_ANON" == "401" ]]; marca $? "GET /api/prontidao sem sessão = $PRON_ANON"

  PRON_JSON=$(curl -s -H "Cookie: $COOKIE" "$BASE/api/prontidao" 2>/dev/null)
  PRON_OK=$(node -e '
    const j=JSON.parse(process.argv[1]||"{}");
    const blocos=Array.isArray(j.blocos)?j.blocos.length:0;
    const chavesProibidas=/DATABASE_URL|ASAAS_API_KEY|STRIPE_SECRET_KEY|pfx|senha|token/i.test(JSON.stringify(j));
    console.log(j.ok===true && blocos>=5 && j.resumo?.total>0 && !chavesProibidas ? "ok" : "falha");
  ' "$PRON_JSON" 2>/dev/null)
  [[ "$PRON_OK" == "ok" ]]; marca $? "GET /api/prontidao com sessão (blocos + sem segredos)"

  XML_ANON=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/documentos/xml" -H "Content-Type: application/json" --data '{"ids":[]}')
  [[ "$XML_ANON" == "401" ]]; marca $? "POST /api/documentos/xml sem sessão = $XML_ANON"

  WH_ANON=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/assinatura/webhook" -H "Content-Type: application/json" --data '{"event":"PAYMENT_CONFIRMED"}')
  [[ "$WH_ANON" == "401" ]]; marca $? "POST /api/assinatura/webhook sem token = $WH_ANON"

  FIS_ANON=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/fiscal/webhook" -H "Content-Type: application/json" --data '{"status":"autorizado"}')
  [[ "$FIS_ANON" == "401" ]]; marca $? "POST /api/fiscal/webhook sem token = $FIS_ANON"

  echo "→ console do dev (/api/diagnostico)"
  DIAG=$(curl -s -H "Cookie: $COOKIE" "$BASE/api/diagnostico" 2>/dev/null)
  if [[ -z "$DIAG" ]]; then
    marca 1 "diagnostico respondeu"
  else
    TOTAL=$(node -e 'const j=JSON.parse(process.argv[1]);console.log(j.resumo?.total??0)' "$DIAG")
    if [[ "$TOTAL" -gt 0 ]]; then marca 0 "bateria devolvida ($TOTAL verificações)"; else marca 1 "bateria vazia"; fi
    node -e '
      const j=JSON.parse(process.argv[1]);
      const r=j.resumo??{};
      console.log(`         resumo: ${r.passou}/${r.total} ok · ${r.falhou} reprovado(s) · ${r.criticos} crítico(s) · ${(j.modulos??[]).length} módulos · ${j.duracaoMs} ms`);
      for(const t of (j.testes??[]).filter(x=>!x.passou))
        console.log(`         ${t.critico?"FALHA":"atenção"} ${t.id} ${t.nome} — ${t.detalhe}`);
    ' "$DIAG"
  fi

  echo "→ motor de caixa unificado (16 cenários)"
  node scripts/testar-caixa-motor.mjs > /tmp/nk-caixa-motor.log 2>&1
  MOTOR=$?
  marca $MOTOR "motor de caixa unificado (16 cenários)"
  if [[ $MOTOR -ne 0 ]]; then tail -25 /tmp/nk-caixa-motor.log; fi

  echo "→ relatórios de PDV (isolamento, caixa e exportação)"
  BASE="$BASE" node scripts/testar-relatorios-pdv.mjs > /tmp/nk-relatorios-pdv.log 2>&1
  RELATORIOS=$?
  marca $RELATORIOS "relatórios de PDV (31 cenários locais)"
  if [[ $RELATORIOS -ne 0 ]]; then tail -35 /tmp/nk-relatorios-pdv.log; fi

  echo "→ fechamento cego (homologação e concorrência)"
  BASE="$BASE" node scripts/testar-fechamento-cego.mjs > /tmp/nk-fechamento-cego.log 2>&1
  FECHAMENTO=$?
  marca $FECHAMENTO "fechamento cego (48 cenários locais)"
  if [[ $FECHAMENTO -ne 0 ]]; then tail -40 /tmp/nk-fechamento-cego.log; fi
fi

echo
echo "NKWAY smoke: $PASS ok · $FAIL falha"
[[ $FAIL -eq 0 ]]
