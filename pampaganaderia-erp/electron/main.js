const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

let PORT = Number(process.env.PORT || 3000);
let PLAN = process.env.NEXO_AGRO_PLAN || null;
let PACK_NAME = process.env.NEXO_AGRO_PACK || null;
const TRIAL_PUBLIC_URL = process.env.NEXO_AGRO_TRIAL_URL || '';
let serverProcess;
let mainWindow;

function getServerUrl() {
  return `http://127.0.0.1:${PORT}`;
}

function findFreePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code !== 'EADDRINUSE') return reject(error);
      const fallback = net.createServer();
      fallback.once('error', reject);
      fallback.listen(0, '127.0.0.1', () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    probe.listen(preferredPort, '127.0.0.1', () => {
      probe.close(() => resolve(preferredPort));
    });
  });
}

function resolveEdition() {
  const productName = app.getName().toLowerCase();
  PLAN = PLAN || (productName.includes('basica') ? 'basica' : productName.includes('profesional') ? 'profesional' : 'premium');
  PACK_NAME = PACK_NAME || `Nexo-Agro-${PLAN[0].toUpperCase()}${PLAN.slice(1)}`;
}

function waitForServer(url, attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        retry(remaining);
      });
      request.on('error', () => retry(remaining));
      request.setTimeout(500, () => { request.destroy(); retry(remaining); });
    };
    const retry = (remaining) => {
      if (remaining <= 0) return reject(new Error('El servidor local no inició a tiempo.'));
      setTimeout(() => check(remaining - 1), 100);
    };
    check(attempts);
  });
}

function startLocalServer() {
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server-local.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit'
  });
  serverProcess.on('error', (error) => console.error('No se pudo iniciar el servidor local:', error));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(getServerUrl());
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('get-app-settings', () => ({
  defaultLicensePlan: PLAN,
  packName: PACK_NAME,
  licenseBrand: 'Nexo Agro',
  trialDays: 10,
  trialPublicUrl: TRIAL_PUBLIC_URL
}));
ipcMain.handle('get-server-url', () => ({ url: getServerUrl(), lanUrl: getServerUrl() }));

app.whenReady().then(async () => {
  resolveEdition();
  PORT = await findFreePort(PORT);
  startLocalServer();
  try {
    await waitForServer(getServerUrl());
    createWindow();
  } catch (error) {
    dialog.showErrorBox('PampaGanaderia ERP', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
