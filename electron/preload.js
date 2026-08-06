const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photobooth', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  printStrip: (payload) => ipcRenderer.invoke('print:strip', payload),
  testPrint: (payload) => ipcRenderer.invoke('print:test', payload),
  savePng: (payload) => ipcRenderer.invoke('fs:save-png', payload),
  readFileDataUrl: (absPath) => ipcRenderer.invoke('fs:read-file-dataurl', absPath),
  resolveTemplate: (templateId) => ipcRenderer.invoke('template:resolve', templateId),
  toggleFullscreen: () => ipcRenderer.invoke('app:toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('app:set-fullscreen', on),
  log: (message) => ipcRenderer.invoke('log:write', message),
});
