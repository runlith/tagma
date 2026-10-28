import { type BaseWindow, BrowserWindow, type Rectangle, type WebContentsView } from 'electron';

export const VIEWPORT = { width: 1280, height: 800 } as const;

export const UNOCCLUDED = 'disable-backgrounding-occluded-windows';

const FRAME_ASK_MS = 50;

export type Home = { readonly window: BaseWindow; readonly bounds: () => Rectangle };

export type Placed = {
  readonly view: WebContentsView;
  home: Home | null;
  parking: BaseWindow | null;
  shown: { readonly window: BrowserWindow; readonly panel: string; rect: Rectangle; frozen: boolean } | null;
  size: { width: number; height: number };
  readonly holds: Set<number>;
  shownAt: number;
};

export type Elsewhere = (window: BrowserWindow, panel: string, placed: Placed) => void;

const visible = (window: BrowserWindow): boolean => !window.isDestroyed() && window.isVisible() && !window.isMinimized();

export class Placement {
  private readonly where = new Map<WebContentsView, BaseWindow | BrowserWindow>();
  private readonly watched = new WeakSet<BrowserWindow>();
  private readonly placed = new Set<Placed>();

  constructor(private readonly elsewhere: Elsewhere) {}

  add(placed: Placed): void {
    this.placed.add(placed);
    this.settle(placed);
  }

  remove(placed: Placed): void {
    this.placed.delete(placed);
    this.detach(placed.view);
    placed.parking?.destroy();
    placed.parking = null;
  }

  show(placed: Placed, window: BrowserWindow, panel: string, rect: Rectangle): void {
    const before = placed.shown;
    const same = before !== null && before.window === window && before.panel === panel;
    if (before !== null && !same && !before.window.isDestroyed()) {
      this.elsewhere(before.window, before.panel, placed);
    }
    placed.shown = { window, panel, rect, frozen: same && before.frozen };
    placed.size = { width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) };
    placed.shownAt = Date.now();
    this.watch(window);
    this.settle(placed);
  }

  hide(placed: Placed, window: BrowserWindow, panel: string): void {
    if (placed.shown?.window !== window || placed.shown.panel !== panel) return;
    placed.shown = null;
    this.settle(placed);
  }

  freeze(placed: Placed, window: BrowserWindow, panel: string, frozen: boolean): void {
    if (placed.shown?.window !== window || placed.shown.panel !== panel || placed.shown.frozen === frozen) return;
    placed.shown.frozen = frozen;
    this.settle(placed);
  }

  hold(placed: Placed, hold: number, ready: () => void, stale: () => boolean): void {
    placed.holds.add(hold);
    placed.view.webContents.setBackgroundThrottling(false);
    this.settle(placed);
    const ask = () => {
      if (stale() || !placed.holds.has(hold) || placed.view.webContents.isDestroyed()) return;
      placed.view.webContents.capturePage().then(
        (image) => (image.isEmpty() ? setTimeout(ask, FRAME_ASK_MS) : ready()),
        () => setTimeout(ask, FRAME_ASK_MS),
      );
    };
    ask();
  }

  release(placed: Placed, hold: number): void {
    if (!placed.holds.delete(hold) || placed.holds.size > 0) return;
    if (!placed.view.webContents.isDestroyed()) placed.view.webContents.setBackgroundThrottling(true);
    this.settle(placed);
  }

  settle(placed: Placed): void {
    if (placed.view.webContents.isDestroyed()) return;
    const shown = placed.shown;
    if (shown !== null && shown.window.isDestroyed()) placed.shown = null;
    const window =
      placed.shown === null || placed.shown.frozen || (placed.holds.size > 0 && !visible(placed.shown.window)) ? null : placed.shown.window;
    if (window === null) {
      this.park(placed);
      return;
    }
    this.move(placed.view, window);
    const zoom = window.webContents.getZoomFactor();
    const rect = placed.shown!.rect;
    placed.view.setBounds({
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    });
  }

  private park(placed: Placed): void {
    const home = placed.home;
    if (home !== null && !home.window.isDestroyed()) {
      this.move(placed.view, home.window);
      placed.view.setBounds(home.bounds());
      return;
    }
    if (placed.parking === null || placed.parking.isDestroyed()) {
      placed.parking = new BrowserWindow({
        show: false,
        width: placed.size.width,
        height: placed.size.height,
        focusable: false,
        skipTaskbar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
    } else {
      placed.parking.setContentSize(placed.size.width, placed.size.height);
    }
    this.move(placed.view, placed.parking);
    placed.view.setBounds({ x: 0, y: 0, width: placed.size.width, height: placed.size.height });
  }

  private move(view: WebContentsView, window: BaseWindow | BrowserWindow): void {
    const held = this.where.get(view);
    if (held === window) return;
    const focused = !view.webContents.isDestroyed() && view.webContents.isFocused();
    this.detach(view);
    window.contentView.addChildView(view);
    this.where.set(view, window);
    if (focused && held !== undefined && !held.isDestroyed() && 'webContents' in held) (held as BrowserWindow).webContents.focus();
  }

  private detach(view: WebContentsView): void {
    const held = this.where.get(view);
    this.where.delete(view);
    if (held !== undefined && !held.isDestroyed()) held.contentView.removeChildView(view);
  }

  private watch(window: BrowserWindow): void {
    if (this.watched.has(window)) return;
    this.watched.add(window);
    const resettle = () => {
      for (const placed of this.placed) if (placed.shown?.window === window) this.settle(placed);
    };
    const leave = () => {
      for (const placed of this.placed) {
        if (placed.shown?.window !== window) continue;
        placed.shown = null;
        this.settle(placed);
      }
    };
    for (const name of ['minimize', 'restore', 'hide', 'show'] as const) window.on(name as 'show', resettle);
    window.on('closed', () => {
      for (const [view, held] of this.where) if (held === window) this.where.delete(view);
      leave();
    });
    window.webContents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) leave();
    });
    window.webContents.on('render-process-gone', leave);
  }
}
