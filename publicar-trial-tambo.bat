@echo off
cd /d "C:\Users\usuario\Documents\Proyectos\Nexo-landing"
echo === Publicando trial actualizado de PampaTambo ===
call node scripts\publish-web-trials.js pampatambo-erp
echo.
echo === Subiendo a produccion (git push, dispara el deploy de Cloudflare Pages) ===
git add -A
git commit -m "Actualizar trial web de PampaTambo"
git push
echo.
echo TERMINADO. Revisa arriba si dice algo en rojo/error.
pause
