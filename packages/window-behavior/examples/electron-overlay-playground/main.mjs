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

async function createOverlayWindow() {
  const nativeSupport = resolveNoFocusStealSupport({
    mode: 'auto',
  });
  const window = new BrowserWindow({
    ...behaviorWindowOptions(),
    width: 900,
    height: 360,
    frame: false,
    alwaysOnTop: true,
    title: 'Overlay Playground',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  host = new ElectronWindowBehaviorHost(window, {
    initialState: {
      ...DEFAULT_WINDOW_BEHAVIOR_STATE,
      transparent: true,
      alwaysOnTop: true,
    },
    noFocusStealNativeAdapter: nativeSupport.adapter,
  });

  if (nativeSupport.status === 'enabled') {
    console.log('[window-behavior] Native no-focus-steal support enabled.');
  } else {
    console.warn(`[window-behavior] Native no-focus-steal support unavailable: ${nativeSupport.reasonCode} (${nativeSupport.reason})`);
  }

  const transport = createTransportFromElectronHost(host);

  ipcMain.handle('example:overlay:get-state', async () => transport.getState());
  ipcMain.handle('example:overlay:dispatch', async (_event, command) => transport.dispatch(command));
  ipcMain.handle('example:overlay:request-focus', async () => transport.dispatch({ type: 'request-interactive-focus' }));
  ipcMain.handle('example:overlay:release-focus', async () => transport.dispatch({ type: 'release-interactive-focus' }));

  const unsubscribe = host.subscribe((state) => {
    if (!window.isDestroyed()) {
      window.webContents.send('example:overlay:state', state);
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

app.whenReady().then(createOverlayWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
