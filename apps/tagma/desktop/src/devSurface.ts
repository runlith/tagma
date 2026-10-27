import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  Menu,
  type MenuItemConstructorOptions,
  WebContentsView,
  app,
  dialog,
  ipcMain,
} from 'electron';
import type { SurfaceKind, SurfaceRefusal } from './bridge.js';
import { SURFACE } from './channels.js';
import type { DevPort, Fronts } from './fronts.js';
import type { ProjectWindows } from './projectWindows.js';
import { startDevSurface } from './server.js';
import { tell } from './telling.js';

const DEV_ITEM = 'dev-surface';
const STARTING_ITEM = 'dev-surface-starting';
const BUILT_ITEM = 'built-surface';
const BADGE_PARTITION = 'tagma-dev-surface-badge';
const BADGE = { width: 216, height: 20, bottom: 2 } as const;
const BUILT_ACT = 'tagma-window://built';
const DEV_WATCH_MS = 2_000;

const UNTRUSTED: SurfaceRefusal = { code: 'untrusted', reason: 'the asking page is not a surface of this window', said: null };

const escaped = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const badgePage = (dev: URL): string => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: light dark; }
      html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
      body { font: 500 11px/1 ui-sans-serif, system-ui, sans-serif; user-select: none; cursor: default; }
      main {
        box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 100%; padding: 0 2px 0 8px;
        border: 1px solid light-dark(oklch(0.22 0.015 260 / 0.12), oklch(1 0 0 / 0.1)); border-radius: 6px;
        background: light-dark(oklch(1 0 0), oklch(0.16 0 0));
        color: light-dark(oklch(0.515 0.018 258), oklch(0.63 0 0));
      }
      b { font-weight: 600; color: light-dark(oklch(0.22 0.015 260), oklch(0.94 0 0)); white-space: nowrap; }
      span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10px;
        mask-image: linear-gradient(to right, black calc(100% - 12px), transparent); }
      a {
        padding: 2px 8px; border-radius: 4px; text-decoration: none; white-space: nowrap;
        color: light-dark(oklch(0.985 0.002 252), oklch(0.16 0 0)); background: light-dark(oklch(0.28 0.018 260), oklch(0.94 0 0));
      }
      a:hover { opacity: .9; }
    </style>
  </head>
  <body>
    <main><b>Dev surface</b><span>${escaped(dev.host)}</span><a href="${BUILT_ACT}" title="Back to the built surface">Built</a></main>
  </body>
</html>
`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

export class DevSurface implements DevPort {
  private projects: ProjectWindows | null = null;
  private watching: ReturnType<typeof setTimeout> | null = null;
  private stay = 0;
  private refusedIn = -1;

  constructor(
    private readonly surface: URL,
    private readonly fronts: Fronts,
    private readonly report: () => void,
  ) {}

  menu(): MenuItemConstructorOptions[] {
    return [
      { id: DEV_ITEM, label: 'Dev Surface', click: () => this.chosen('dev') },
      { id: STARTING_ITEM, label: 'Starting the Dev Surface…', enabled: false, visible: false },
      { id: BUILT_ITEM, label: 'Built Surface', enabled: false, click: () => this.chosen('built') },
    ];
  }

  install(projects: ProjectWindows): void {
    this.projects = projects;
    ipcMain.handle(SURFACE.current, (event): SurfaceKind => {
      const window = this.windowOf(event);
      return window === null ? 'built' : (projects.frontOf(window) ?? 'built');
    });
    ipcMain.handle(SURFACE.use, (event, kind: unknown): Promise<SurfaceRefusal | null> => {
      const window = this.windowOf(event);
      if (window === null || (kind !== 'built' && kind !== 'dev')) return Promise.resolve(UNTRUSTED);
      return projects.use(window, kind);
    });
    app.on('browser-window-focus', () => this.moved());
  }

  start(): Promise<URL | SurfaceRefusal> {
    return startDevSurface(this.surface);
  }

  badge(window: BrowserWindow, built: () => void): () => void {
    const view = new WebContentsView({
      webPreferences: { partition: BADGE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    const contents = view.webContents;
    const page = badgePage(this.fronts.devAddress ?? this.surface);
    const place = (): void => {
      const { width, height } = window.getContentBounds();
      view.setBounds({
        x: Math.round((width - BADGE.width) / 2),
        y: height - BADGE.height - BADGE.bottom,
        width: BADGE.width,
        height: BADGE.height,
      });
    };
    view.setBackgroundColor('#00000000');
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      event.preventDefault();
      if (url.startsWith(BUILT_ACT)) built();
    });
    contents.on('render-process-gone', () => void contents.loadURL(page).catch(() => undefined));
    window.contentView.addChildView(view);
    place();
    window.on('resize', place);
    void contents.loadURL(page).catch(() => undefined);
    return () => {
      window.off('resize', place);
      if (!window.isDestroyed()) window.contentView.removeChildView(view);
      if (!contents.isDestroyed()) contents.close();
    };
  }

  fell(window: BrowserWindow, reason: string): void {
    void tell(window, { type: 'warning', message: 'This window is back on the built surface', words: reason, details: null }, this.report);
  }

  leave(window: BrowserWindow): boolean {
    const answer = dialog.showMessageBoxSync(window, {
      type: 'question',
      message: 'Leave this page?',
      detail: 'A document in this window has changes that are not saved. Leaving drops them.',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
    });
    return answer === 0;
  }

  moved(): void {
    this.refreshMenu();
    if (this.fronts.onDev) this.watch();
    else this.stay += 1;
  }

  private windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
    return this.fronts.trusts(event.senderFrame?.url) ? BrowserWindow.fromWebContents(event.sender) : null;
  }

  private chosen(kind: SurfaceKind): void {
    const window = this.projects?.focused();
    if (this.projects === null || window === undefined) return;
    void this.projects.use(window, kind).then((refused) => {
      if (refused === null || window.isDestroyed()) return;
      void tell(
        window,
        {
          type: 'warning',
          message: "The dev surface didn't start",
          words: refused.said ?? 'Tagma could not bring up Vite of its checkout.',
          details: `${refused.code}: ${refused.reason}`,
        },
        this.report,
      );
    });
  }

  private refreshMenu(): void {
    const menu = Menu.getApplicationMenu();
    const window = this.projects?.focused();
    const front = window === undefined ? null : (this.projects?.frontOf(window) ?? null);
    const starting = window !== undefined && this.projects?.starting(window) === true;
    const item = (id: string) => menu?.getMenuItemById(id) ?? null;
    const dev = item(DEV_ITEM);
    const shown = item(STARTING_ITEM);
    const built = item(BUILT_ITEM);
    if (dev !== null) {
      dev.visible = !starting;
      dev.enabled = front === 'built';
    }
    if (shown !== null) shown.visible = starting;
    if (built !== null) built.enabled = front === 'dev' || starting;
  }

  private watch(): void {
    const dev = this.fronts.devAddress;
    if (this.watching !== null || dev === null || this.refusedIn === this.stay) return;
    const stay = this.stay;
    this.watching = setTimeout(() => {
      void fetch(dev, { method: 'HEAD' })
        .then(
          async (answer) => {
            await answer.body?.cancel();
            return true;
          },
          () => false,
        )
        .then((answered) => {
          this.watching = null;
          if (stay !== this.stay || this.fronts.devAddress?.origin !== dev.origin) return this.moved();
          if (answered) return this.watch();
          this.refusedIn = stay;
          this.projects?.leaveEveryDev(`Vite stopped accepting connections at ${dev.host}.`);
        });
    }, DEV_WATCH_MS);
  }
}
