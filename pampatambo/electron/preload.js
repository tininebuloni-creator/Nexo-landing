const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppSettings: () => ipcRenderer.invoke('tambo:getAppSettings'),
  getServerUrl: () => ipcRenderer.invoke('tambo:getServerUrl'),
  getAppRole: () => ipcRenderer.invoke('tambo:getAppRole'),
  openExternal: (url) => ipcRenderer.invoke('tambo:openExternal', url),
});