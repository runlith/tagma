import { type BaseWindow, BrowserWindow, type Rectangle, screen, type WebContents, type WebContentsView } from 'electron';

export const VIEWPORT = { width: 1280, height: 800 } as const;

export const UNOCCLUDED = 'disable-backgrounding-occluded-windows';

const FRAME_ASK_MS = 50;

export type Home = { readonly window: BaseWindow; readonly bounds: () => Rectangle };

export type Placed = {
  readonly view: WebContentsView;
  readonly contents: WebContents;
  home: Home | null;
  parking: BaseWindow | null;
  shown: { readonly window: BrowserWindow; readonly panel: string; rect: Rectangle; frozen: boolean } | null;
  size: { width: number; height: number };
  readonly holds: Set<number>;
  shownAt: number;
  driven: boolean;
  awake: boolean | null;
};

export type Elsewhere = (window: BrowserWindow, panel: string, placed: Placed) => void;

const HIDDEN_PAINTS = process.platform === 'darwin';

const DISPLAY_CHANGES = ['display-added', 'display-removed', 'display-metrics-changed'] as const;

const beyondScreens = (): { readonly x: number; readonly y: number } => {
  const displays = screen.getAllDisplays().map((display) => display.bounds);
  return {
    x: Math.max(...displays.map((bounds) => bounds.x + bounds.width)),
    y: Math.max(...displays.map((bounds) => bounds.y + bounds.height)),
  };
};

const visible = (window: BaseWindow): boolean => !window.isDestroyed() && window.isVisible() && !window.isMinimized();

const awake = (placed: Placed): boolean =>
  placed.holds.size > 0 ||
  placed.driven ||
  (placed.shown !== null && visible(placed.shown.window)) ||
  (placed.home !== null && visible(placed.home.window));

export class Placement {
  private readonly where = new Map<WebContentsView, BaseWindow | BrowserWindow>();
  private readonly watched = new WeakSet<BrowserWindow>();
  private readonly placed = new Set<Placed>();
  private displaysWatched = false;

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
    this.settle(placed);
    this.painted(placed, ready, () => stale() || !placed.holds.has(hold));
  }

  wake(placed: Placed, ready: () => void, stale: () => boolean): void {
    if (this.settle(placed)) this.painted(placed, ready, stale);
    else ready();
  }

  private painted(placed: Placed, ready: () => void, stale: () => boolean): void {
    const ask = () => {
      if (stale() || placed.contents.isDestroyed()) return;
      placed.contents.capturePage().then(
        (image) => (image.isEmpty() ? setTimeout(ask, FRAME_ASK_MS) : ready()),
        () => setTimeout(ask, FRAME_ASK_MS),
      );
    };
    ask();
  }

  release(placed: Placed, hold: number): void {
    if (!placed.holds.delete(hold) || placed.holds.size > 0) return;
    this.settle(placed);
  }

  settle(placed: Placed): boolean {
    if (placed.contents.isDestroyed()) return false;
    const shown = placed.shown;
    if (shown !== null && shown.window.isDestroyed()) placed.shown = null;
    if (placed.home !== null && placed.home.window.isDestroyed()) return false;
    const wanted = awake(placed);
    const window =
      placed.shown === null || placed.shown.frozen || (placed.holds.size > 0 && !visible(placed.shown.window)) ? null : placed.shown.window;
    if (window === null) this.park(placed);
    else {
      this.move(placed, window);
      const zoom = window.webContents.getZoomFactor();
      const rect = placed.shown!.rect;
      placed.view.setBounds({
        x: Math.round(rect.x * zoom),
        y: Math.round(rect.y * zoom),
        width: Math.round(rect.width * zoom),
        height: Math.round(rect.height * zoom),
      });
    }
    const mapped = !HIDDEN_PAINTS && this.map(placed, wanted);
    if (placed.awake === wanted) return mapped;
    placed.awake = wanted;
    placed.contents.setBackgroundThrottling(!wanted);
    placed.view.setVisible(wanted);
    return mapped;
  }

  private park(placed: Placed): void {
    const home = placed.home;
    if (home !== null) {
      this.move(placed, home.window);
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
    this.move(placed, placed.parking);
    placed.view.setBounds({ x: 0, y: 0, width: placed.size.width, height: placed.size.height });
  }

  private map(placed: Placed, awake: boolean): boolean {
    const stand = placed.parking;
    if (stand === null || stand.isDestroyed()) return false;
    const mapped = awake && this.where.get(placed.view) === stand;
    if (mapped && !stand.isVisible()) {
      this.watchDisplays();
      const away = beyondScreens();
      stand.setPosition(away.x, away.y);
      stand.showInactive();
      return true;
    }
    if (!mapped && stand.isVisible()) stand.hide();
    return false;
  }

  private watchDisplays(): void {
    if (this.displaysWatched) return;
    this.displaysWatched = true;
    const away = () => {
      const { x, y } = beyondScreens();
      for (const { parking } of this.placed)
        if (parking !== null && !parking.isDestroyed() && parking.isVisible()) parking.setPosition(x, y);
    };
    for (const name of DISPLAY_CHANGES) screen.on(name as 'display-added', away);
  }

  private move({ view, contents }: Placed, window: BaseWindow | BrowserWindow): void {
    const held = this.where.get(view);
    if (held === window) return;
    const focused = !contents.isDestroyed() && contents.isFocused();
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
