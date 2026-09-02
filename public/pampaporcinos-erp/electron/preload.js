const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppSettings: () => ipcRenderer.invoke('porcinos:get-app-settings'),
});