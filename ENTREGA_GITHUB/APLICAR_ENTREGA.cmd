@echo off
rem ============================================================================
rem  NKWAY - APLICAR ENTREGA (ferramenta unica, dois cliques)
rem  TEMA: perguntar o OPERADOR na abertura do caixa (PDV e /caixa)
rem  Copia os 5 arquivos da entrega para a pasta nkway, confere cada um,
rem  mostra o que o git enxerga e diz o proximo passo.
rem  So copia arquivos desta pasta - nunca mexe em package.json, .env etc.
rem  Uso: coloque esta pasta ENTREGA_GITHUB ao lado de nkway e de dois cliques.
rem ============================================================================
setlocal EnableExtensions
title NKWAY - Aplicar entrega (operador na abertura do caixa)

set "ORIGEM=%~dp0"
set "ORIGEM=%ORIGEM:~0,-1%"

rem ---------------- 1) localizar a pasta nkway ----------------
set "NKWAY="
if defined NKWAY_DIR set "NKWAY=%NKWAY_DIR%"
if not defined NKWAY if exist "%ORIGEM%\..\nkway\package.json" set "NKWAY=%ORIGEM%\..\nkway"
if not defined NKWAY if exist "%ORIGEM%\..\..\nkway\package.json" set "NKWAY=%ORIGEM%\..\..\nkway"
if not defined NKWAY if exist "%USERPROFILE%\Documents\Sistema way\nkway\package.json" set "NKWAY=%USERPROFILE%\Documents\Sistema way\nkway"
if not defined NKWAY if exist "%USERPROFILE%\Documents\GitHub\nkway\package.json" set "NKWAY=%USERPROFILE%\Documents\GitHub\nkway"
if not defined NKWAY if exist "%USERPROFILE%\nkway\package.json" set "NKWAY=%USERPROFILE%\nkway"
if not defined NKWAY (
  echo.
  echo Nao encontrei a pasta nkway automaticamente.
  echo Arraste a pasta nkway para esta janela e tecle Enter:
  set /p "NKWAY=> "
)
set "NKWAY=%NKWAY:"=%"
if not exist "%NKWAY%\package.json" (
  echo.
  echo [ERRO] "%NKWAY%" nao e a pasta do nkway (sem package.json). Nada foi copiado.
  pause
  exit /b 1
)
if not exist "%NKWAY%\.git" (
  echo.
  echo [ERRO] "%NKWAY%" nao e um repositorio Git (pasta .git ausente). Nada foi copiado.
  pause
  exit /b 1
)

echo.
echo  TEMA: perguntar o OPERADOR na abertura do caixa (PDV e /caixa)
echo  Origem da entrega : %ORIGEM%
echo  Pasta do repos.   : %NKWAY%
echo.
echo  Serão copiados 5 arquivos para a pasta nkway (substituindo os existentes).
echo  (package.json, package-lock.json e .env NUNCA sao tocados.)
echo.
set /p "CONF=Confirmar a copia? (S/N) "
if /i not "%CONF%"=="S" (
  echo Cancelado. Nada foi copiado.
  pause
  exit /b 0
)

echo.
echo  ============ COPIANDO ============
rem Garante que as pastas de destino existem
mkdir "%NKWAY%\src\app\(painel)\caixa" >nul 2>&1
mkdir "%NKWAY%\src\app\(pdv)\pdv" >nul 2>&1
mkdir "%NKWAY%\src\server\acoes" >nul 2>&1
mkdir "%NKWAY%\src\views" >nul 2>&1

call :um "src\app\(painel)\caixa\page.tsx"
call :um "src\app\(pdv)\pdv\page.tsx"
call :um "src\server\acoes\caixa.ts"
call :um "src\views\Caixa.tsx"
call :um "src\views\Pdv.tsx"

echo.
echo  ============ O QUE O GIT ENXERGA ============
set "GIT="
where git >nul 2>&1 && set "GIT=git"
if not defined GIT for /d %%V in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do set "GIT=%%V\resources\app\lib\git\bin\git.exe"
if not defined GIT if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if defined GIT (
  "%GIT%" -C "%NKWAY%" status --short --branch
  echo.
  echo  Commits locais ainda nao publicados (vazio = nenhum):
  "%GIT%" -C "%NKWAY%" log --oneline origin/main..HEAD 2>nul
) else (
  echo  [AVISO] git nao encontrado no PATH. Abra o GitHub Desktop e veja a aba Changes.
)

echo.
echo  ================= PROXIMO PASSO =================
echo  Abra o GitHub Desktop:
echo   - Se a aba "Changes" mostrar os 5 arquivos:
echo       cole o Summary e clique em "Commit to main" e depois em "Push origin".
echo   - Se o git acima mostrar "ahead N" (commits guardados):
echo       so clique em "Push origin".
echo   - O Vercel publica sozinho em 2-3 min apos o push.
echo.
pause
exit /b 0

rem ---------------- copia e confere um arquivo ----------------
:um
set "rel=%~1"
set "alvo=%NKWAY%/%rel%"
copy /y "%ORIGEM%\%rel%" "%alvo%" >nul 2>&1
if errorlevel 1 (
  echo  [FALHOU  ] %rel%   - confira se o arquivo existe na entrega
  goto :eof
)
fc /b "%ORIGEM%\%rel%" "%alvo%" >nul 2>&1
if errorlevel 1 (echo  [DIFEREN ] %rel%   - a copia nao conferiu) else (echo  [OK    ] %rel%)
goto :eof
