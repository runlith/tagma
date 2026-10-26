import { createRequire } from 'node:module';
import type { ElectronAppBridge, ElectronClock, ElectronCursorPoint, ElectronPassThroughRegion } from './types.js';

const require = createRequire(import.meta.url);

function getElectronModule(): typeof import('electron') {
  return require('electron');
}

export const DEFAULT_PASS_THROUGH_REGION: ElectronPassThroughRegion = {
  type: 'top-strip',
  height: 40,
  forward: true,
};

export const defaultCursorProvider = (): ElectronCursorPoint => {
  return getElectronModule().screen.getCursorScreenPoint();
};

export const defaultClock: ElectronClock = {
  setInterval(handler, intervalMs) {
    return setInterval(handler, intervalMs);
  },
  clearInterval(handle) {
    clearInterval(handle);
  },
  setTimeout(handler, delayMs) {
    return setTimeout(handler, delayMs);
  },
};

export const defaultAppBridge: ElectronAppBridge = {
  hide() {
    getElectronModule().app.hide();
  },
  show() {
    if (process.platform !== 'darwin') return;
    getElectronModule().app.show();
  },
  isHidden() {
    if (process.platform !== 'darwin') return false;
    return getElectronModule().app.isHidden();
  },
  focus(steal) {
    const { app } = getElectronModule();

    try {
      if (steal) {
        app.focus({ steal: true });
        return;
      }
      app.focus();
    } catch {
      app.focus();
    }
  },
  listVisibleWindows() {
    const { BrowserWindow } = getElectronModule();

    return BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed() && window.isVisible());
  },
};
