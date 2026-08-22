# Deploy a Render

## Configuración rápida

1. **Conecta tu repositorio a Render:**
   - Ve a [render.com](https://render.com)
   - Crea nuevo "Web Service"
   - Conecta tu repositorio GitHub

2. **Configuración automática:**
   - Render detectará `render.yaml` automáticamente
   - Runtime: Node.js
   - Build: `npm install`
   - Start: `npm start`

3. **Variables de entorno (opcional):**
   - `NODE_ENV=production`
   - `PORT=3000` (Render lo asigna automáticamente)

## Scripts disponibles

```bash
# Para desarrollo local (Electron)
npm run start:electron

# Para web app (Render)
npm start
```

## Notas

- `npm start` → Inicia servidor web Express (Puerto 3000)
- `npm run start:electron` → Inicia app Electron (escritorio)
- El servidor web sirve `pampa-agro-erp.html` en la raíz
- API en `/api/*` para backend

## Endpoints disponibles

- `GET /` → Carga la página principal
- `GET /api/health` → Status del servidor
- `GET /api/server-info` → Info del servidor
- `POST /api/data` → Recibe datos JSON
- `GET /api/data` → Retorna datos

## Troubleshooting

**Error: "missing script: start"**
- Verifica que package.json tiene `"start": "node app.js"`

**Error: "Cannot find module 'express'"**
- Ejecuta: `npm install`

**Puerto no disponible**
- Render asigna el puerto en `process.env.PORT`
- La app lo detecta automáticamente
