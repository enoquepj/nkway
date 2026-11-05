@echo off
rem ============================================================================
rem  NKWAY - VERIFICAR: mostra se os 5 arquivos da entrega chegbaram na pasta
rem  nkway E o que o Git enxerga (pendente / ja commitado / limpo).
rem  Uso: dois cliques. So leitura - nao altera nada.
rem ============================================================================
title NKWAY - Verificacao (operador na abertura)
setlocal EnableExtensions

set "ORIGEM=%~dp0"
set "ORIGEM=%ORIGEM:~0,-1%"

rem ---------- 1) localizar a pasta nkway ----------
set "NKWAY="
if defined NKWAY_DIR set "NKWAY=%NKWAY_DIR%"
if not defined NKWAY if exist "%ORIGEM%\..\nkway\package.json" set "NKWAY=%ORIGEM%\..\nkway"
if not defined NKWAY if exist "%ORIGEM%\..\..\nkway\package.json" set "NKWAY=%ORIGEM%\..\..\nkway"
if not defined NKWAY if exist "%USERPROFILE%\Documents\Sistema way\nkway\package.json" set "NKWAY=%USERPROFILE%\Documents\Sistema way\nkway"
if not defined NKWAY if exist "%USERPROFILE%\Documents\GitHub\nkway\package.json" set "NKWAY=%USERPROFILE%\Documents\GitHub\nkway"
if not defined NKWAY if exist "%USERPROFILE%\nkway\package.json" set "NKWAY=%USERPROFILE%\nkway"
if not defined NKWAY (
  echo Tema: perguntar o OPERADOR na abertura do caixa.
  echo Arraste a pasta nkway para esta janela e tecle Enter:
  set /p "NKWAY=> "
)
set "NKWAY=%NKWAY:"=%"
if not exist "%NKWAY%\package.json" (
  echo [ERRO] "%NKWAY%" nao e a pasta do nkway (sem package.json).
  pause
  exit /b 1
)

echo.
echo  Pasta verificada: %NKWAY%
echo.

rem ---------- 2) conferencia dos 5 arquivos (ENTREGA x NKWAY) ----------
echo  ============ ARQUIVOS DA ENTREGA x PASTA NKWAY ============
call :checar "src\app\(painel)\caixa\page.tsx"
call :checar "src\app\(pdv)\pdv\page.tsx"
call :checar "src\server\acoes\caixa.ts"
call :checar "src\views\Caixa.tsx"
call :checar "src\views\Pdv.tsx"
echo.

rem ---------- 3) o que o git enxerga ----------
echo  ============ O QUE O GIT ENXERGA ============
set "GIT="
where git >nul 2>&1 && set "GIT=git"
if not defined GIT for /d %%V in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do set "GIT=%%V\resources\app\lib\git\bin\git.exe"
if not defined GIT if exist "%LOCALAPPDATA%\Programs\Git\cmd\git.exe" set "GIT=%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
if not defined GIT (
  echo [AVISO] git nao encontrado no PATH. Abra o GitHub Desktop e olhe a aba Changes.
) else (
  "%GIT%" -C "%NKWAY%" status --short --branch
  echo.
  echo  Commits locais ainda nao publicados (vazios = nenhum):
  "%GIT%" -C "%NKWAY%" log --oneline origin/main..HEAD 2>nul
)
echo.

rem ---------- 4) como interpretar ----------
echo  ============ COMO INTERPRETAR ============
echo  1) Todos [IGUAL] e o git lista os arquivos (abaixo "## main"):
echo       - tudo certo: no GitHub Desktop, Commit to main e Push origin.
echo  2) Todos [IGUAL] e o git esta LIMPO com "ahead N" (N maior que 0):
echo       - voce JÁ fez o commit local; so clique em "Push origin".
echo  3) Todos [IGUAL] e o git esta LIMPO com "ahead 0":
echo       - os arquivos ja estavam assim antes (entrega ja aplicada/commitada).
echo  4) Algum [DIFEREN] ou [AUSENTE]:
echo       - a copia nao chegou certa: rode ATUALIZAR_NKWAY.cmd de novo
echo         (com o download mais novo) e verifique de novo.
echo.
echo  Observacao: ModalFechamentoCego.tsx NAO faz parte desta entrega
echo  (arquivo ja existe no repositorio, sem mudancas) - por isso o git
echo  nunca o lista como alterado. Isso e normal.
echo.
pause
exit /b 0

:checar
set "rel=%~1"
set "alvo=%NKWAY%/%rel%"
if not exist "%alvo%" (echo  [AUSENTE ] %rel%) & goto :eof
if exist "%ORIGEM%\%rel%" (
  fc /b "%ORIGEM%\%rel%" "%alvo%" >nul 2>&1
  if errorlevel 1 (echo  [DIFEREN ] %rel%) else (echo  [IGUAL   ] %rel%)
) else (
  echo  [SEMREF  ] %rel%
)
goto :eof
