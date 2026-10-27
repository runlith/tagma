import { installExternalLinks } from '@runlith/desktop-host/ExternalLinks';
import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';
import type { ViewWindowRequest } from './bridge.js';
import { WINDOWS } from './channels.js';
import type { Fronts } from './fronts.js';
import type { ProjectWindows } from './projectWindows.js';
import { revealedUrl, surfacePage, viewWindowUrl } from './viewWindowUrl.js';

const SIZE = { width: 960, height: 640 };
const MINIMUM = { width: 360, height: 240 };

export class ViewWindows {
  private readonly opened = new Map<string, BrowserWindow>();

  constructor(
    private readonly fronts: Fronts,
    private readonly preload: string,
    private readonly projects: ProjectWindows,
  ) {}

  install(): void {
    ipcMain.on(WINDOWS.open, (event, request: ViewWindowRequest) => {
      if (this.ours(event)) this.open(request);
    });
    ipcMain.on(WINDOWS.reveal, (event, path: unknown) => {
      if (this.ours(event)) this.reveal(path);
    });
  }

  private ours(event: IpcMainEvent): boolean {
    return this.fronts.trusts(event.senderFrame?.url);
  }

  private open(request: ViewWindowRequest): void {
    const url = viewWindowUrl(this.fronts.built, request?.path);
    if (url === null || typeof request.key !== 'string' || typeof request.title !== 'string') return;
    const standing = this.opened.get(request.key);
    if (standing !== undefined && !standing.isDestroyed()) {
      if (standing.isMinimized()) standing.restore();
      standing.show();
      standing.focus();
      return;
    }
    const window = new BrowserWindow({
      ...SIZE,
      minWidth: MINIMUM.width,
      minHeight: MINIMUM.height,
      show: false,
      title: request.title,
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, zoomMode: 'isolated' },
    });
    this.opened.set(request.key, window);
    installExternalLinks({ appOrigins: () => [this.fronts.built.origin], page: surfacePage, webContents: window.webContents });
    window.once('ready-to-show', () => window.show());
    window.webContents.on('did-fail-load', (_event, _code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      console.warn(`[tagma-desktop] the view window ${failedUrl} did not load: ${description}`);
      window.destroy();
    });
    window.on('closed', () => {
      if (this.opened.get(request.key) === window) this.opened.delete(request.key);
    });
    window.loadURL(url.toString()).catch(() => undefined);
  }

  private reveal(path: unknown): void {
    const url = revealedUrl(this.fronts.built, path);
    if (url === null) return;
    const main = this.projects.focused();
    if (main === undefined) {
      this.projects.create(url);
      return;
    }
    main.webContents.send(WINDOWS.revealed, `${url.pathname}${url.search}`);
    this.projects.reveal();
  }
}
