const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('irisBridge', {
  ask: (text) => ipcRenderer.invoke('iris:ask', text),
  tts: (text) => ipcRenderer.invoke('iris:tts', text),
  transcribe: (data, mime) => ipcRenderer.invoke('iris:stt', data, mime),
  quit: () => ipcRenderer.send('iris:quit'),
  onEsc: (cb) => ipcRenderer.on('iris:esc', () => cb()),
});