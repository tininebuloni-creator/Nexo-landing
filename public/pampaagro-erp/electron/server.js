const express = require('express');
const path = require('path');
const os = require('os');

let serverInstance = null;
let dynamicPort = null;

function getPrimaryLanIPv4() {
  const interfaces = os.networkInterfaces();
  for (const records of Object.values(interfaces)) {
    for (const item of records || []) {
      if (!item || item.family !== 'IPv4' || item.internal) continue;
      return item.address;
    }
  }
  return null;
}

/**
 * Inicia un servidor Express en un puerto dinámico
 * @returns {Promise<number>} Puerto asignado por el SO
 */
async function startDynamicServer() {
  return new Promise((resolve, reject) => {
    try {
      const app = express();

      // Middlewares básicos
      app.use(express.json());
      app.use(express.urlencoded({ extended: true }));

      // Rutas de prueba
      app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
      });

      app.get('/api/server-info', (req, res) => {
        res.json({
          port: dynamicPort,
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        });
      });

      // API de ejemplo para datos
      app.post('/api/data', (req, res) => {
        res.json({ ok: true, received: req.body, timestamp: new Date().toISOString() });
      });

      app.get('/api/data', (req, res) => {
        res.json({ ok: true, message: 'GET /api/data' });
      });

      // Manejo de errores
      app.use((err, req, res, next) => {
        console.error('[Express Error]', err);
        res.status(500).json({ error: err.message || 'Error interno' });
      });

      // Inicia el servidor en puerto 0 (dinámico) y en todas las interfaces
      serverInstance = app.listen(0, '0.0.0.0', () => {
        dynamicPort = serverInstance.address().port;
        const urls = getDynamicServerUrls();
        console.log(`✓ Servidor Express iniciado en puerto dinámico: ${dynamicPort}`);
        console.log(`✓ URL local: ${urls.url}`);
        if (urls.lanUrl) {
          console.log(`✓ URL LAN: ${urls.lanUrl}`);
        }
        resolve(dynamicPort);
      });

      serverInstance.on('error', (error) => {
        console.error('[Server Error]', error);
        reject(error);
      });
    } catch (error) {
      console.error('[Start Server Error]', error);
      reject(error);
    }
  });
}

/**
 * Detiene el servidor Express
 */
function stopDynamicServer() {
  return new Promise((resolve) => {
    if (!serverInstance) {
      resolve();
      return;
    }

    serverInstance.close(() => {
      console.log(`✓ Servidor Express detenido (puerto era: ${dynamicPort})`);
      serverInstance = null;
      dynamicPort = null;
      resolve();
    });
  });
}

/**
 * Obtiene el puerto dinámico asignado
 */
function getDynamicPort() {
  return dynamicPort;
}

function getDynamicServerUrls() {
  if (!dynamicPort) {
    return { port: null, url: null, lanUrl: null, httpsUrl: null };
  }

  const lanIp = getPrimaryLanIPv4();
  const url = `http://localhost:${dynamicPort}`;
  const lanUrl = lanIp ? `http://${lanIp}:${dynamicPort}` : null;
  const httpsUrl = lanIp ? `https://${lanIp}:${dynamicPort}` : null;
  return { port: dynamicPort, url, lanUrl, httpsUrl };
}

/**
 * Verifica si el servidor está corriendo
 */
function isServerRunning() {
  return serverInstance !== null && dynamicPort !== null;
}

module.exports = {
  startDynamicServer,
  stopDynamicServer,
  getDynamicPort,
  getDynamicServerUrls,
  isServerRunning
};
