@echo off
setlocal
cd /d "%~dp0"
title CHEFE TELLES - LOJA + PAINEL DO DONO
color 0C

echo ========================================
echo       CHEFE TELLES - INICIADOR
echo ========================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado.
  echo Instale o Node.js LTS e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

echo Iniciando servidor e abrindo os dois paineis...
echo.
node launcher.js

echo.
echo O iniciador foi encerrado.
pause
