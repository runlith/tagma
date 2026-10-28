import { app, BrowserWindow } from 'electron';

if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(
    'data:text/html,<main><button onclick="document.querySelector(\'output\').textContent=6*7">Calculate</button><output>0</output></main>',
  );
});
