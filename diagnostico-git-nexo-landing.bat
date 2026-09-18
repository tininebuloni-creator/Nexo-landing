@echo off
cd /d "C:\Users\usuario\Documents\Proyectos\Nexo-landing"
echo === DIAGNOSTICO GIT (no cambia nada) === > diagnostico-git-log.txt
echo. >> diagnostico-git-log.txt
echo --- git status --- >> diagnostico-git-log.txt
git status >> diagnostico-git-log.txt 2>&1
echo. >> diagnostico-git-log.txt
echo --- archivos en conflicto (unmerged) --- >> diagnostico-git-log.txt
git diff --name-status --diff-filter=U >> diagnostico-git-log.txt 2>&1
echo. >> diagnostico-git-log.txt
echo --- ultimos commits locales (HEAD) --- >> diagnostico-git-log.txt
git log --oneline -10 >> diagnostico-git-log.txt 2>&1
echo. >> diagnostico-git-log.txt
echo --- ultimos commits del remoto (origin/main) --- >> diagnostico-git-log.txt
git fetch origin main >> diagnostico-git-log.txt 2>&1
git log --oneline -10 origin/main >> diagnostico-git-log.txt 2>&1
echo. >> diagnostico-git-log.txt
echo --- diferencia entre HEAD y origin/main (resumen) --- >> diagnostico-git-log.txt
git log --oneline HEAD..origin/main >> diagnostico-git-log.txt 2>&1
echo. >> diagnostico-git-log.txt
echo TERMINADO_OK >> diagnostico-git-log.txt
pause
