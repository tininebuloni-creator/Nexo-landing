@echo off
title Nexo-landing - Servidor local de pruebas
echo.
echo ============================================
echo   Levantando servidor local de pruebas...
echo ============================================
echo.
echo Se va a abrir el navegador en unos segundos.
echo Para cortar el servidor, cerra esta ventana.
echo.

cd /d "%~dp0"

REM Abre el navegador despues de 2 segundos (le da tiempo al servidor a arrancar)
start "" /b cmd /c "timeout /t 2 >nul && start http://localhost:5500"

REM Levanta el servidor. Si el puerto 5500 esta ocupado, "serve" elige otro solo
REM (fijate en esta misma ventana que puerto uso si el navegador no pega justo).
npx serve -l 5500 .

pause
