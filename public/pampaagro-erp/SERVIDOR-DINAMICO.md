# Servidor Dinámico en Node.js

## ✓ Configurado

Tu aplicación Electron ahora tiene un servidor Express que:
- Inicia **automáticamente** al abrir la app
- Usa **puerto dinámico** (asignado por el SO)
- Se detiene al cerrar la app
- Es accesible desde `http://localhost:PUERTO`

## Archivos creados/modificados

### Nuevos:
- `electron/server.js` - Lógica del servidor Express
- `electron/server-usage-example.js` - Ejemplos de uso

### Modificados:
- `electron/main.js` - Inicia/detiene el servidor
- `electron/preload.js` - Expone acceso al puerto a la app

## Cómo usar desde tu HTML/JavaScript

```javascript
// Obtener URL del servidor
const result = await window.electronAPI.getServerUrl();
console.log(result.url); // http://localhost:PORT
console.log(result.port); // PORT

// Usar fetch para comunicarse
fetch(`${result.url}/api/health`)
  .then(r => r.json())
  .then(data => console.log(data));
```

## Rutas disponibles

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/api/health` | GET | Verificar salud del servidor |
| `/api/server-info` | GET | Obtener info del servidor |
| `/api/data` | GET/POST | Endpoint de ejemplo |

## Agregar nuevas rutas

Edita `electron/server.js` en la sección `// Rutas de prueba`:

```javascript
app.get('/api/custom', (req, res) => {
  res.json({ message: 'Tu lógica aquí' });
});
```

## Notas

- El servidor está en `localhost` (solo accesible desde la app)
- Puerto cambia cada vez que inicias la app
- El servidor es totalmente sincrónico con Electron
