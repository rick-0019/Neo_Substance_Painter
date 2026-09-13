@echo off
title Neo Substance Painter
cd /d "%~dp0"

echo ========================================================
echo        Neo Substance Painter - Pepakura Edition
echo ========================================================
echo.
echo Abriendo aplicacion en el navegador predeterminado...
start http://localhost:8000

echo Iniciando servidor local...
python server.py

