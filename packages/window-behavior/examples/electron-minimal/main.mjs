import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain } from 'electron';
import { DEFAULT_WINDOW_BEHAVIOR_STATE } from '../../dist/contract/state.js';
import { behaviorWindowOptions } from '../../dist/host-electron/bootstrap.js';
import { createTransportFromElectronHost } from '../../dist/host-electron/createTransport.js';
import { ElectronWindowBehaviorHost } from '../../dist/host-electron/ElectronWindowBehaviorHost.js';
import { resolveNoFocusStealSupport } from '../../dist/native/no-focus-steal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let host;

async function createMainWindow() {
  const nativeSupport = resolveNoFocusStealSupport({
    mode: 'auto',
  });
  const window = new BrowserWindow({
    ...behaviorWindowOptions(),
    width: 720,
    height: 520,
    title: 'Window Behavior Example',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  host = new ElectronWindowBehaviorHost(window, {
    initialState: DEFAULT_WINDOW_BEHAVIOR_STATE,
    noFocusStealNativeAdapter: nativeSupport.adapter,
  });

  if (nativeSupport.status === 'enabled') {
    console.log('[window-behavior] Native no-focus-steal support enabled.');
  } else {
    console.warn(`[window-behavior] Native no-focus-steal support unavailable: ${nativeSupport.reasonCode} (${nativeSupport.reason})`);
  }
  const transport = createTransportFromElectronHost(host);

  ipcMain.handle('example:minimal:get-state', async () => transport.getState());
  ipcMain.handle('example:minimal:get-meta', async () => ({
    noFocusStealSupport: {
      status: nativeSupport.status,
      reasonCode: nativeSupport.status === 'disabled' ? nativeSupport.reasonCode : undefined,
    },
  }));
  ipcMain.handle('example:minimal:hide-window', async () => {
    window.hide();
    return true;
  });
  ipcMain.handle('example:minimal:reveal-window', async (_event, options) => {
    host?.reveal(options);
    return true;
  });
  ipcMain.handle('example:minimal:dispatch', async (_event, command) => transport.dispatch(command));
  ipcMain.handle('example:minimal:request-focus', async () => transport.dispatch({ type: 'request-interactive-focus' }));
  ipcMain.handle('example:minimal:release-focus', async () => transport.dispatch({ type: 'release-interactive-focus' }));

  const unsubscribe = host.subscribe((state) => {
    if (!window.isDestroyed()) {
      window.webContents.send('example:minimal:state', state);
    }
  });
  window.on('closed', () => {
    unsubscribe();
    host?.destroy();
    host = undefined;
  });

  await window.loadFile(path.join(__dirname, 'index.html'));
  host.reveal();
}

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
