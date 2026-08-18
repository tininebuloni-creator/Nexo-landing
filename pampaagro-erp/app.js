const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

function getLanIPv4List() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  Object.values(interfaces).forEach((records) => {
    (records || []).forEach((item) => {
      if (!item || item.family !== 'IPv4' || item.internal) return;
      ips.push(item.address);
    });
  });

  return Array.from(new Set(ips));
}

function getMainHtmlPath() {
  const candidates = [path.join(__dirname, 'index.html'), path.join(__dirname, 'nexo-agro-erp.html')];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[0];
}

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

app.get('/trial', (req, res) => {
  res.redirect('/?trial=auto');
});

// Servir el HTML principal
app.get('/', (req, res) => {
  res.sendFile(getMainHtmlPath());
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('[Express Error]', err);
  res.status(500).json({ error: err.message || 'Error interno' });
});

// Fallback para cualquier ruta
app.get(/.*/, (req, res) => {
  res.sendFile(getMainHtmlPath());
});



// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  const lanIps = getLanIPv4List();
  console.log(`✓ Servidor web iniciado en puerto: ${PORT}`);
  console.log(`✓ URL: http://localhost:${PORT}`);
  lanIps.forEach((ip) => {
    console.log(`✓ URL LAN: http://${ip}:${PORT}`);
    console.log(`✓ Trial LAN: http://${ip}:${PORT}/trial`);
    console.log(`✓ Trial HTTPS (si hay proxy TLS): https://${ip}:${PORT}/trial`);
  });
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
