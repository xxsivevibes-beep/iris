const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const brain = require('./brain'); // loads .env first
const tts = require('./tts');
const stt = require('./stt');

function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    backgroundColor: '#02040a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
    // Show the page's IRIS log lines in this terminal too
  win.webContents.on('console-message', (...args) => {
    const msg = args[0] && typeof args[0].message === 'string' ? args[0].message : String(args[2] || '');
    if (msg.startsWith('IRIS')) console.log(msg);
  });
  // Esc is handled by the page: it closes the text bar, stops speech, or quits
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      e.preventDefault();
      win.webContents.send('iris:esc');
    }
  });
}

ipcMain.handle('iris:ask', (e, text) => brain.ask(String(text).slice(0, 2000)));
ipcMain.handle('iris:tts', (e, text) => tts.speak(String(text).slice(0, 1000)));
ipcMain.handle('iris:stt', (e, data, mime) => stt.transcribe(data, mime));
ipcMain.on('iris:quit', () => app.quit());

app.whenReady().then(() => {
  // Only the microphone is allowed; everything else is denied
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'media');
  createWindow();
});
app.on('window-all-closed', () => app.quit());