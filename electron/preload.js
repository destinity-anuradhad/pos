const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform:   process.platform,
  isElectron: true,
  openWindow: (url) => ipcRenderer.send('open-window', url),
});
