const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppRole: () => ipcRenderer.sendSync('app-role:get'),
  getAppSettings: () => ipcRenderer.sendSync('app-settings:get'),
  setAppRole: async (role) => ipcRenderer.invoke('app-role:set', role),
  syncFiles: async (payload) => ipcRenderer.invoke('sync-files', payload),
  getSyncFolder: async () => ipcRenderer.invoke('sync-folder:get'),
  chooseSyncFolder: async () => ipcRenderer.invoke('sync-folder:choose'),
  saveExportToSyncFolder: async (payload) => ipcRenderer.invoke('export:save-sync-json', payload),
  checkUpdates: async () => ipcRenderer.invoke('updates:check'),
  installUpdate: async () => ipcRenderer.invoke('updates:install'),
  // Nuevo: Acceso al servidor dinámico
  getServerPort: async () => ipcRenderer.invoke('server:get-port'),
  getServerUrl: async () => ipcRenderer.invoke('server:get-url'),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  }
});
