@echo off
cd /d "C:\Users\usuario\Documents\Proyectos\Nexo-landing"
echo === Publicando trial actualizado de PampaGanaderia ===
call node scripts\publish-web-trials.js pampaganaderia-erp
echo.
echo === Resolviendo un merge sin terminar de antes (afecta varios archivos, no solo Ganaderia) ===
git add -A
git commit -m "Actualizar trial web de PampaGanaderia y resolver merge pendiente"
echo.
echo === Subiendo a producción (git push) ===
git push
echo.
echo TERMINADO. Revisa arriba si dice algo en rojo/error.
pause
