const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const net = require('net');
const path = require('path');
const packageJson = require('../package.json');
const { startServer } = require('../server');

let mainWindow = null;
let localServer = null;

function getPackName() {
  const raw = `${packageJson.porcinosPack || process.env.PORCINOS_PACK || 'premium'}`.trim().toLowerCase();
  if (raw === 'basica' || raw === 'basico' || raw === 'basic') return 'Basica';
  if (raw === 'profesional' || raw === 'pro') return 'Profesional';
  return 'Premium';
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
    probe.listen(preferredPort, '127.0.0.1', () => probe.close(() => resolve(preferredPort)));
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f1419',
    show: false,
    title: `PampaPorcinos ${getPackName()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('porcinos:get-app-settings', () => ({ pack: getPackName() }));

app.whenReady().then(async () => {
  try {
    const port = await findFreePort(Number(process.env.PORCINOS_PORT || 3121));
    localServer = startServer(port).server;
    createWindow(port);
  } catch (error) {
    dialog.showErrorBox('PampaPorcinos ERP', `No se pudo iniciar el servidor local.\n${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (localServer) localServer.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { if (localServer) localServer.close(); });

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});