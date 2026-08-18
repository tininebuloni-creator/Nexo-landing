const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppSettings: () => ipcRenderer.sendSync('get-app-settings'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url')
});
