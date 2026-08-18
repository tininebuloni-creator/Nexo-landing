const { spawn } = require('child_process');

const { startServer } = require('../server');

const port = Number(process.env.TAMBO_PORT || process.env.PORT || 3000);
const openGenerator = `${process.env.TAMBO_OPEN_GENERATOR || ''}`.trim() === '1';
const appUrl = `http://127.0.0.1:${port}/`;
const generatorUrl = `http://127.0.0.1:${port}/generador-licencias.html`;

function openUrl(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

const { server } = startServer(port);

setTimeout(() => {
  openUrl(appUrl);
  if (openGenerator) {
    openUrl(generatorUrl);
  }

  console.log(`[start:auto] App abierta en ${appUrl}`);
  if (openGenerator) {
    console.log(`[start:auto] Generador abierto en ${generatorUrl}`);
  }
}, 400);

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
