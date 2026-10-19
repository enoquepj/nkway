#!/usr/bin/env bash
# ---------------------------------------------------------------
# NKWAY — enviar o projeto para o GitHub
#
# Uso:
#   chmod +x publicar.sh
#   ./publicar.sh SEU_USUARIO_GITHUB
#
# Pré-requisito: crie o repositório vazio e PRIVADO em
# https://github.com/new  com o nome "nkway"
# ---------------------------------------------------------------
set -e

USUARIO="$1"

if [ -z "$USUARIO" ]; then
  echo "❌ Informe seu usuário do GitHub."
  echo "   Exemplo: ./publicar.sh joaosilva"
  exit 1
fi

REPO="nkway"
URL="https://github.com/$USUARIO/$REPO.git"

# Garante repositório git válido
if [ ! -d .git ]; then
  echo "🔧 Inicializando repositório..."
  git init -q
fi

# Garante identidade (evita erro de commit)
git config user.email >/dev/null 2>&1 || git config user.email "dev@nkway.app"
git config user.name  >/dev/null 2>&1 || git config user.name  "NKWAY"

echo "📦 Preparando arquivos..."
git add -A
git commit -q -m "NKWAY: atualização" 2>/dev/null || echo "   (nada novo para commitar)"
git branch -M main

if git remote | grep -q origin; then
  git remote set-url origin "$URL"
else
  git remote add origin "$URL"
fi

echo ""
echo "⬆️  Enviando para: $URL"
echo ""
echo "   Username: $USUARIO"
echo "   Password: cole o TOKEN (a digitação fica invisível — é normal)"
echo ""

git push -u origin main

echo ""
echo "✅ Publicado com sucesso!"
echo "   Repositório: https://github.com/$USUARIO/$REPO"
echo ""
echo "➡️  Agora coloque o site no ar:"
echo "    1. Acesse https://vercel.com/new"
echo "    2. Continue with GitHub"
echo "    3. Importe o repositório 'nkway' e clique em Deploy"
