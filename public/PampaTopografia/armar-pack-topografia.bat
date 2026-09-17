@echo off
cd /d "C:\Users\usuario\Documents\Proyectos\pampatopo-app"
echo === Iniciando armar-pack de Topografia (exe + PWA) === > armar-pack-log.txt
call npm run armar-pack >> armar-pack-log.txt 2>&1
echo TERMINADO_OK >> armar-pack-log.txt
pause
