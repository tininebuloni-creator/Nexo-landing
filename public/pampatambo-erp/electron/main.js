const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const packageJson = require('../package.json');

function requireProtected(modulePath) {
  const basePath = path.resolve(__dirname, modulePath);
  const jscPath = `${basePath}.jsc`;
  if (fs.existsSync(jscPath)) {
    return require(jscPath);
  }
  const jscIndexPath = path.join(basePath, 'index.jsc');
  if (fs.existsSync(jscIndexPath)) {
    return require(jscIndexPath);
  }
  return require(modulePath);
}

const { startServer } = requireProtected('../server');

let mainWindow = null;
let httpServer = null;

const DEFAULT_PORT = Number(process.env.TAMBO_PORT || 3000);
const SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

function getPackName() {
  const raw = `${packageJson.tamboPack || process.env.TAMBO_PACK || 'premium'}`.trim().toLowerCase();
  if (raw === 'basica' || raw === 'basico' || raw === 'basic') return 'Basica';
  if (raw === 'profesional' || raw === 'pro') return 'Profesional';
  return 'Premium';
}

function createWindow() {
  const preloadJsPath = path.join(__dirname, 'preload.js');
  const preloadJscPath = path.join(__dirname, 'preload.jsc');
  const preloadPath = fs.existsSync(preloadJscPath) ? preloadJscPath : preloadJsPath;

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0f1419',
    show: false,
    title: `Tambo ${getPackName()}`,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  httpServer = startServer(DEFAULT_PORT).server;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (httpServer) httpServer.close();
    app.quit();
  }
});

ipcMain.handle('tambo:getAppSettings', () => ({
  pack: getPackName(),
  port: DEFAULT_PORT,
  serverUrl: SERVER_URL,
}));

ipcMain.handle('tambo:getServerUrl', () => SERVER_URL);
ipcMain.handle('tambo:getAppRole', () => 'propietario');

ipcMain.handle('tambo:openExternal', (_event, url) => shell.openExternal(url));