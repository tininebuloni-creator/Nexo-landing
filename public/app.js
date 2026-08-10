const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname)));

// Rutas API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/server-info', (req, res) => {
  res.json({
    port: PORT,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform
  });
});

app.post('/api/data', (req, res) => {
  res.json({ 
    ok: true, 
    received: req.body, 
    timestamp: new Date().toISOString() 
  });
});

app.get('/api/data', (req, res) => {
  res.json({ ok: true, message: 'GET /api/data' });
});

// Servir el HTML principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'nexo-agro-erp.html'));
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('[Express Error]', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

// Reemplaza tus 3 líneas del 404 por estas:
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'nexo-agro-erp.html')); 
  // NOTA: Si los archivos de tu frontend unificado están en una carpeta llamada 
  // 'dist' o 'build' en vez de 'public', cambia esa palabra aquí arriba.
});



// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Servidor web iniciado en puerto: ${PORT}`);
  console.log(`✓ URL: http://localhost:${PORT}`);
  console.log(`✓ API Health: http://localhost:${PORT}/api/health`);
});

// Manejo de señales
process.on('SIGTERM', () => {
  console.log('✓ Señal SIGTERM recibida. Cerrando servidor...');
  server.close(() => {
    console.log('✓ Servidor cerrado');
    process.exit(0);
  });
});

module.exports = app;
