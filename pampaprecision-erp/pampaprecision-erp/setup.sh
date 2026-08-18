#!/bin/bash
# Setup rápido para Pampa Precision ERP en Windows

echo "🌾 Pampa Precision ERP - Setup Script"
echo "====================================="
echo ""

# Verificar Node.js
echo "✓ Verificando Node.js..."
node -v
npm -v

# Instalar dependencias
echo ""
echo "📦 Instalando dependencias Node.js..."
npm install

# Copiar .env
echo ""
echo "⚙️  Configurando variables de entorno..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ Archivo .env creado. Edítalo con tus credenciales PostgreSQL"
else
    echo "✓ .env ya existe"
fi

echo ""
echo "✨ Setup completado!"
echo ""
echo "📝 Próximos pasos:"
echo "  1. Edita .env con tus credenciales PostgreSQL"
echo "  2. Asegúrate de que PostgreSQL está corriendo"
echo "  3. Ejecuta: npm run init-db"
echo "  4. Ejecuta: npm start"
echo ""
