const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const log = require('electron-log/main');
const { autoUpdater } = require('electron-updater');
const { startDynamicServer, stopDynamicServer, getDynamicPort, getDynamicServerUrls } = require('./server');

let mainWindowRef = null;
const APP_SETTINGS_FILE = 'settings.json';
const DEFAULT_APP_ROLE = 'propietario';
const VALID_ROLES = new Set(['propietario', 'administracion', 'ingeniero', 'oficina']);
const JSON_ENCRYPTION_PREFIX = 'NEXO_ENC_V1:';
const JSON_MIGRATION_MARKER_FILE = '.json-migration-v1.done';

function getMainHtmlPath() {
  const candidates = [
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', 'nexo-agro-erp.html')
  ];

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[candidates.length - 1];
}

function buildKeyFromSecret(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

function getPrimaryJsonSecret() {
  if (process.env.NEXO_JSON_SECRET) return process.env.NEXO_JSON_SECRET;
  return `${os.hostname()}|com.nexoagro.erp|json`;
}

function getLegacyJsonSecret() {
  return `${app.getPath('userData')}|${os.hostname()}|com.nexoagro.erp|json`;
}

function getJsonEncryptionKey() {
  return buildKeyFromSecret(getPrimaryJsonSecret());
}

function getJsonDecryptionKeys() {
  const keys = [getJsonEncryptionKey(), buildKeyFromSecret(getLegacyJsonSecret())];
  const unique = new Map();

  keys.forEach((key) => {
    unique.set(key.toString('hex'), key);
  });

  return Array.from(unique.values());
}

function encryptText(plainText) {
  const key = getJsonEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
  return JSON_ENCRYPTION_PREFIX + payload;
}

function decryptText(cipherText) {
  if (!String(cipherText || '').startsWith(JSON_ENCRYPTION_PREFIX)) {
    return String(cipherText || '');
  }

  const raw = String(cipherText).slice(JSON_ENCRYPTION_PREFIX.length);
  const [ivB64, authTagB64, encryptedB64] = raw.split('.');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Formato de cifrado JSON invalido');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const encrypted = Buffer.from(encryptedB64, 'base64');

  let lastError = null;
  for (const key of getJsonDecryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return plain.toString('utf8');
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No se pudo descifrar el contenido JSON');
}

function serializeEncryptedJson(data) {
  const json = JSON.stringify(data || {}, null, 2);
  return encryptText(json);
}

function parsePossiblyEncryptedJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return {};

  const decrypted = decryptText(text);
  return JSON.parse(decrypted || '{}');
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), APP_SETTINGS_FILE);
}

function getPackSettingsPath() {
  if (!app.isPackaged) return null;
  return path.join(path.dirname(process.execPath), APP_SETTINGS_FILE);
}

function readJsonFileSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!String(raw || '').trim()) return {};
    return parsePossiblyEncryptedJson(raw);
  } catch {
    return {};
  }
}

function writeEncryptedJsonFile(filePath, data) {
  const folder = path.dirname(filePath);
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  fs.writeFileSync(filePath, serializeEncryptedJson(data), 'utf8');
}

function getMigrationMarkerPath() {
  return path.join(app.getPath('userData'), JSON_MIGRATION_MARKER_FILE);
}

function getCandidateSettingsPathsForMigration() {
  const appData = app.getPath('appData');
  const canonical = getSettingsPath();
  const legacyCandidates = [
    path.join(appData, 'PampaAgro ERP', APP_SETTINGS_FILE),
    path.join(appData, 'nexo-agro-erp', APP_SETTINGS_FILE)
  ];

  const seen = new Set([canonical]);
  const ordered = [canonical];

  legacyCandidates.forEach((candidate) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    ordered.push(candidate);
  });

  return ordered;
}

function migrateUserSettingsJsonEncryption() {
  const markerPath = getMigrationMarkerPath();
  if (fs.existsSync(markerPath)) return;

  const canonicalPath = getSettingsPath();
  const candidates = getCandidateSettingsPathsForMigration();
  let sourcePath = null;
  let sourceRaw = '';
  let sourceData = null;

  for (const settingsPath of candidates) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, 'utf8');
      if (!String(raw || '').trim()) continue;

      const parsed = parsePossiblyEncryptedJson(raw);
      sourcePath = settingsPath;
      sourceRaw = raw;
      sourceData = parsed;
      break;
    } catch (error) {
      console.error('[json-migration] Error leyendo candidato', settingsPath, error?.message || error);
    }
  }

  let migratedCount = 0;

  if (sourcePath && sourceData) {
    try {
      if (!String(sourceRaw).startsWith(JSON_ENCRYPTION_PREFIX)) {
        const backupPath = sourcePath + '.plain.bak';
        if (!fs.existsSync(backupPath)) {
          fs.copyFileSync(sourcePath, backupPath);
        }
      }

      writeEncryptedJsonFile(canonicalPath, sourceData);
      migratedCount = 1;

      if (sourcePath !== canonicalPath) {
        console.log('[json-migration] Fuente legacy detectada:', sourcePath);
        console.log('[json-migration] Destino canónico:', canonicalPath);
      }
    } catch (error) {
      console.error('[json-migration] Error migrando hacia ruta canónica', error?.message || error);
    }
  }

  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify(
        {
          migratedAt: new Date().toISOString(),
          migratedCount,
          canonicalPath,
          sourcePath: sourcePath || null
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // No bloquear la app por fallo al persistir el marcador.
  }

  if (migratedCount > 0) {
    console.log(`[json-migration] Archivos settings.json migrados: ${migratedCount}`);
  }
}

function loadAppSettings() {
  try {
    const defaults = readJsonFileSafe(getPackSettingsPath());
    const file = getSettingsPath();
    if (!fs.existsSync(file)) return defaults;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = parsePossiblyEncryptedJson(raw);

    // Migra silenciosamente settings legados en texto plano.
    if (!String(raw || '').startsWith(JSON_ENCRYPTION_PREFIX)) {
      saveAppSettings(parsed);
    }

    return { ...defaults, ...parsed };
  } catch {
    return {};
  }
}

function getConfiguredAppRole() {
  try {
    const settings = loadAppSettings();
    const role = settings?.appRole || process.env.NEXO_APP_ROLE || DEFAULT_APP_ROLE;
    return VALID_ROLES.has(role) ? role : DEFAULT_APP_ROLE;
  } catch {
    return DEFAULT_APP_ROLE;
  }
}

function setConfiguredAppRole(role) {
  if (!VALID_ROLES.has(role)) {
    return { ok: false, message: 'Rol invalido' };
  }

  try {
    const settings = loadAppSettings();
    saveAppSettings({ ...settings, appRole: role });
    return { ok: true, role };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo guardar el rol de instalacion' };
  }
}

function saveAppSettings(nextSettings) {
  const file = getSettingsPath();
  writeEncryptedJsonFile(file, nextSettings);
}

async function ensureSyncFolder() {
  const settings = loadAppSettings();
  if (settings.syncFolderPath && fs.existsSync(settings.syncFolderPath)) {
    return settings.syncFolderPath;
  }

  const result = await dialog.showOpenDialog(mainWindowRef, {
    title: 'Seleccionar carpeta sincronizada para exportaciones',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  saveAppSettings({ ...settings, syncFolderPath: selectedPath });
  return selectedPath;
}

function sendUpdateStatus(payload) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.webContents.send('update-status', payload);
}

function setupAutoUpdater() {
  log.initialize();
  log.transports.file.level = 'info';
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // Proveedor de updates: GitHub Releases por defecto.
  // Permite sobreescribir con NEXO_AUTO_UPDATE_URL sin recompilar.
  autoUpdater.setFeedURL({ provider: 'github', owner: 'tininebuloni-creator', repo: 'NEXO-AGRO-ERP' });
  if (process.env.NEXO_AUTO_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.NEXO_AUTO_UPDATE_URL });
  }

  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus({ type: 'checking', message: 'Buscando actualizaciones...' });
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus({
      type: 'available',
      version: info?.version,
      message: `Nueva version disponible: ${info?.version || 'N/D'}`
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus({ type: 'none', message: 'No hay actualizaciones disponibles' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      type: 'downloading',
      percent: Math.round(progress?.percent || 0),
      message: `Descargando actualizacion: ${Math.round(progress?.percent || 0)}%`
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus({
      type: 'downloaded',
      version: info?.version,
      message: 'Actualizacion lista para instalar. Se aplicara al reiniciar.'
    });
  });

  autoUpdater.on('error', (error) => {
    sendUpdateStatus({ type: 'error', message: `Error de actualizacion: ${error?.message || 'desconocido'}` });
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindowRef = mainWindow;

  mainWindow.loadFile(getMainHtmlPath());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }

    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocalFile = url.startsWith('file://');
    if (!isLocalFile) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  return mainWindow;
}

ipcMain.handle('sync-files', async (_event, _payload) => {
  return {
    ok: false,
    message: 'Integrar aqui tu logica de sincronizacion local (OneDrive/Drive/Dropbox/etc).'
  };
});

ipcMain.on('app-role:get', (event) => {
  event.returnValue = getConfiguredAppRole();
});

ipcMain.on('app-settings:get', (event) => {
  event.returnValue = loadAppSettings();
});

ipcMain.handle('app-role:set', async (_event, role) => {
  return setConfiguredAppRole(role);
});

ipcMain.handle('sync-folder:get', async () => {
  const settings = loadAppSettings();
  const folder = settings.syncFolderPath;
  return {
    ok: true,
    path: folder && fs.existsSync(folder) ? folder : null
  };
});

ipcMain.handle('sync-folder:choose', async () => {
  const selected = await ensureSyncFolder();
  if (!selected) {
    return { ok: false, canceled: true, message: 'No se seleccionó carpeta' };
  }
  return { ok: true, path: selected };
});

ipcMain.handle('export:save-sync-json', async (_event, payload) => {
  try {
    const folderPath = await ensureSyncFolder();
    if (!folderPath) {
      return { ok: false, canceled: true, message: 'No se seleccionó carpeta sincronizada' };
    }

    const safeFileName = (payload?.fileName || 'nexo-agro-datos.json').replace(/[\\/:*?"<>|]/g, '-');
    const filePath = path.join(folderPath, safeFileName);
    fs.writeFileSync(filePath, payload?.content || '{}', 'utf8');

    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, message: error?.message || 'No se pudo guardar en carpeta sincronizada' };
  }
});

ipcMain.handle('updates:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Actualizaciones disponibles solo en build instalado' };
  }

  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'Error buscando actualizaciones' };
  }
});

ipcMain.handle('updates:install', async () => {
  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'Error instalando actualizacion' };
  }
});

ipcMain.handle('server:get-port', async () => {
  const port = getDynamicPort();
  return { ok: true, port };
});

ipcMain.handle('server:get-url', async () => {
  const info = getDynamicServerUrls();
  return { ok: true, ...info };
});

app.whenReady().then(async () => {
  migrateUserSettingsJsonEncryption();
  app.setAppUserModelId('com.nexoagro.erp');
  setupAutoUpdater();

  // Inicia el servidor dinámico antes de crear la ventana
  try {
    await startDynamicServer();
  } catch (error) {
    console.error('[Startup] Error iniciando servidor:', error?.message || error);
  }

  createWindow();

  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // Los errores ya se notifican por evento "error".
      });
    }, 10000);

    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // Reintento silencioso.
      });
    }, 6 * 60 * 60 * 1000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // Detiene el servidor dinámico antes de cerrar la app
  await stopDynamicServer();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
