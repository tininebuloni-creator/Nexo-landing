@echo off
REM Setup rápido para Pampa Precision ERP en Windows

echo 🌾 Pampa Precision ERP - Setup Script
echo =====================================
echo.

REM Verificar Node.js
echo ✓ Verificando Node.js...
node -v
npm -v

REM Instalar dependencias
echo.
echo 📦 Instalando dependencias Node.js...
call npm install

REM Copiar .env
echo.
echo ⚙️  Configurando variables de entorno...
if not exist .env (
    copy .env.example .env
    echo ✓ Archivo .env creado. Edítalo con tus credenciales PostgreSQL
) else (
    echo ✓ .env ya existe
)

echo.
echo ✨ Setup completado!
echo.
echo 📝 Próximos pasos:
echo   1. Edita .env con tus credenciales PostgreSQL
echo   2. Asegúrate de que PostgreSQL está corriendo
echo   3. Ejecuta: npm run init-db
echo   4. Ejecuta: npm start
echo.

pause
