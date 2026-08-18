# 🌾 Pampa Precision ERP

**ERP agrícola moderno para pequeños y medianos productores** con capas de precisión geoespacial, telemetría de maquinaria y análisis de rendimiento.

## 📋 Requisitos

- **Node.js** >= 16.0.0
- **PostgreSQL** >= 12.0 (con extensiones PostGIS y pgcrypto)
- **npm** >= 8.0.0

## 🚀 Instalación Rápida

### 1. Instalar PostgreSQL
Si aún no tienes PostgreSQL:
- **Windows**: Descarga desde https://www.postgresql.org/download/windows/
- Durante la instalación, recuerda la contraseña del usuario `postgres`

### 2. Crear la base de datos
```bash
# Abre pgAdmin o usa la línea de comandos
psql -U postgres

# En la consola PostgreSQL:
CREATE DATABASE pampaprecision;
\c pampaprecision
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
```

### 3. Configurar el proyecto

```bash
# Clona o descarga el proyecto
cd pampaprecision-erp

# Instala dependencias
npm install

# Copia el archivo de ejemplo y configura
copy .env.example .env

# Edita .env con tus credenciales PostgreSQL
# DB_USER=postgres
# DB_PASSWORD=tu_contraseña
```

### 4. Inicializar la base de datos
```bash
npm run init-db
```

Este comando ejecutará en orden:
- ✅ 001_schema.sql - Crea esquemas
- ✅ 002_tables_core_erp.sql - Tablas principales
- ✅ 003_tables_precision_timeseries.sql - Tablas de series de tiempo
- ✅ 004_seed_demo.sql - Datos de demostración
- ✅ 005_KPI_views.sql - Vistas para reportes
- ✅ SCRIPT 8 - Autorización por scope
- ✅ SCRIPT 9 - Auditoría automática

### 5. Iniciar el servidor
```bash
npm start
```

Deberías ver:
```
🌾 Pampa Precision ERP Server running on http://localhost:3000
📊 Frontend: http://localhost:3000
🔌 API: http://localhost:3000/api
```

## 🎯 Acceso

- **Frontend Web**: http://localhost:3000
- **API REST**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/api/health

## 🏗️ Estructura del Proyecto

```
pampaprecision-erp/
├── server.js              # Express server principal
├── database.js            # Conexión a PostgreSQL
├── init-db.js             # Script de inicialización
├── package.json           # Dependencias Node.js
├── .env                   # Variables de entorno (crear desde .env.example)
│
├── Nueva carpeta/         # Frontend estático
│   ├── index.html         # Aplicación web
│   ├── manifest.webmanifest
│   ├── sw.js              # Service Worker (offline)
│   └── leaflet/           # Mapas geoespaciales
│
├── 001_schema.sql.txt     # Esquemas PostgreSQL
├── 002_tables_core_erp.sql.txt
├── 003_tables_precision_timeseries.txt
├── 004_seed_demo.sql.txt
└── ... (scripts SQL adicionales)
```

## 🔗 API Endpoints

### Empresas (Tenants)
- `GET /api/tenants` - Listar empresas
- `POST /api/tenants` - Crear empresa

### Establecimientos
- `GET /api/tenants/:tenantId/establishments`
- `POST /api/tenants/:tenantId/establishments`

### Campañas
- `GET /api/tenants/:tenantId/campaigns`
- `POST /api/tenants/:tenantId/campaigns`

### Lotes
- `GET /api/establishments/:estabId/plots`
- `POST /api/establishments/:estabId/plots`

### Órdenes de Trabajo
- `GET /api/campaigns/:campaignId/work-orders`
- `POST /api/campaigns/:campaignId/work-orders`
- `PUT /api/work-orders/:workOrderId` - Actualizar estado
- `POST /api/work-orders/:workOrderId/executions` - Registrar ejecución

### Inventario
- `GET /api/establishments/:estabId/inventory`
- `POST /api/inventory/movements` - Registrar movimiento

### Prescripciones de Precisión
- `GET /api/plots/:plotId/prescriptions`
- `POST /api/plots/:plotId/prescriptions`

### Auditoría
- `GET /api/audit-log` - Registro de actividades

## 🛠️ Desarrollo

### Modo desarrollo con auto-reload
```bash
npm run dev
```

### Verificar esquema en PostgreSQL
```bash
psql -U postgres -d pampaprecision -c "\dt *.*"
```

### Limpiar datos de demostración
```bash
# En PostgreSQL:
TRUNCATE TABLE ops.work_order CASCADE;
TRUNCATE TABLE core.plot CASCADE;
-- etc.
```

## 🔐 Seguridad

El proyecto incluye:
- ✅ Autorización por scope (SCRIPT 8)
- ✅ Auditoría automática (SCRIPT 9)
- ✅ Encriptación de sensibles (pgcrypto)
- ✅ CORS configurado
- ✅ Validación de entrada en servidor

## 📊 Módulos Funcionales

1. **Centro Operativo** - Dashboard principal con KPIs
2. **Operaciones** - Gestión de órdenes de trabajo
3. **Campos y Lotes** - Georreferenciación (mapas Leaflet)
4. **Conectividad** - Sincronización offline-first
5. **Inventario** - Stock de insumos y movimientos
6. **Precisión** - Mapas de rinde y prescripciones variables
7. **Analítica** - Reportes y KPIs
8. **Telemetría** - Datos de maquinaria
9. **Usuarios y Roles** - Control de acceso
10. **Auditoría** - Trazabilidad completa

## 🐛 Troubleshooting

**Error: "ENOENT: no such file or directory"**
- Verifica que los archivos .sql.txt estén en el directorio raíz

**Error: "could not connect to database"**
- Asegúrate de que PostgreSQL está corriendo
- Verifica las credenciales en `.env`
- Intenta: `psql -U postgres` desde terminal

**Error: "tablename already exists"**
- Las tablas ya fueron creadas
- Para reiniciar: `DROP SCHEMA IF EXISTS core, ops, inv, geo CASCADE;`

## 📚 Documentación Adicional

- OpenAPI 3.0.3 spec: `openapi 3.0.3.YAML`
- Epics & user stories: `EPICAS.csv`, `historias_tareas.csv`
- Diagramas conceptuales: `apampaprecision-erp.txt`

## 📝 Licencia

MIT - Libre para uso comercial

---

**Desarrollado con ❤️ para productores de precisión agrícola**
