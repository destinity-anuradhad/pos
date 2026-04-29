const { contextBridge, ipcRenderer } = require('electron');

// Restore terminal registration from persistent file before Angular boots.
// Main process reads the file (sandboxed preload can't use fs directly).
try {
  const data = ipcRenderer.sendSync('terminal:restore');
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      localStorage.setItem(k, String(v));
    }
  }
} catch (_) {}

contextBridge.exposeInMainWorld('electronAPI', {
  platform:      process.platform,
  isElectron:    true,
  openWindow:    (url)  => ipcRenderer.send('open-window', url),
  saveTerminal:  (data) => ipcRenderer.invoke('terminal:save', data),
  clearTerminal: ()     => ipcRenderer.invoke('terminal:clear'),
});
