import { BrowserWindow, ipcMain, type Input } from 'electron';
import { TABS } from './channels.js';
import type { TabCommand } from './bridge.js';

export function tabCommandOf(input: Input, mac: boolean): TabCommand | null {
  if (input.type !== 'keyDown' || input.alt || !(mac ? input.meta && !input.control : input.control && !input.meta)) return null;
  const key = input.key.toLowerCase();
  if (key === 'w' && !input.shift) return 'close';
  if (key === 't' && input.shift) return 'reopen';
  return null;
}

export function installTabKeys(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    const command = tabCommandOf(input, process.platform === 'darwin');
    if (command === null) return;
    event.preventDefault();
    window.webContents.send(TABS.command, command);
  });
}

export function serveTabKeys(): void {
  ipcMain.on(TABS.closeWindow, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}
