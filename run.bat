@echo off
title Neo Substance Painter
echo Iniciando servidor web local...
echo.
echo Presiona Ctrl+C en esta ventana para detener el servidor.
echo.

:: Abre el navegador predeterminado
start http://localhost:8000

:: Inicia el servidor usando Python arreglando el bug de Windows con los modulos JS
python server.py
