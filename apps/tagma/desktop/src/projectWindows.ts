import { installExternalLinks } from '@runlith/desktop-host/ExternalLinks';
import { type ConcealableWindow, QuickHideShortcut } from '@runlith/desktop-host/QuickHideShortcut';
import { WindowPlacement } from '@runlith/desktop-host/WindowPlacement';
import { DEFAULT_WINDOW_BEHAVIOR_STATE, type WindowBehaviorState } from '@runlith/window-behavior/contract/state';
import { ElectronWindowBehaviorHost } from '@runlith/window-behavior/host-electron/ElectronWindowBehaviorHost';
import { behaviorWindowOptions } from '@runlith/window-behavior/host-electron/bootstrap';
import { CHANNEL } from './channel.js';
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Input,
  type MessageBoxOptions,
  app,
  dialog,
  ipcMain,
  screen,
} from 'electron';
import type { SurfaceKind, SurfaceRefusal } from './bridge.js';
import { DEV_SURFACE_ARGUMENT, WINDOWS } from './channels.js';
import { type DevPort, type Fronts, rebased } from './fronts.js';
import type { SurfaceLoader } from './SurfaceLoader.js';
import type { Swipes } from './swipe.js';
import { installTabKeys } from './tabKeys.js';
import { revealedUrl, surfacePage } from './viewWindowUrl.js';
import { type LoaderState, waitingPageUrl, windowAct } from './waitingPage.js';

const DEFAULT_SIZE = { width: 1280, height: 860 };
const MINIMUM_SIZE = { width: 960, height: 640 };
const CASCADE = 24;
const QUICK_HIDE = 'CommandOrControl+Shift+L';
const TABBING = 'projects';
const INITIAL_STATE: WindowBehaviorState = { ...DEFAULT_WINDOW_BEHAVIOR_STATE, windowOpacity: 1, overlayBackgroundVisible: false };
const ABORTED = -3;

type Held = {
  readonly window: BrowserWindow;
  readonly behavior: ElectronWindowBehaviorHost;
  address: URL;
  onSurface: boolean;
  front: SurfaceKind;
  attempt: number;
  starting: Promise<SurfaceRefusal | null> | null;
  entering: boolean;
  leaving: { readonly reason: string | null } | null;
  unbadge: (() => void) | null;
};

const CLOSED: SurfaceRefusal = {
  code: 'surface-closed',
  reason: 'the window stands on no surface',
  said: 'Tagma is not open in this window yet.',
};

export const newWindowChord = (input: Input, mac: boolean): boolean =>
  input.type === 'keyDown' &&
  !input.isAutoRepeat &&
  !input.alt &&
  !input.shift &&
  (mac ? input.meta && !input.control : input.control && !input.meta) &&
  input.key.toLowerCase() === 'n';

export class ProjectWindows {
  private readonly held: Held[] = [];
  private said: LoaderState | 'open' | null = null;
  private readonly quickHide: QuickHideShortcut;

  constructor(
    private readonly fronts: Fronts,
    private readonly preload: string,
    private readonly placementFile: string,
    private readonly loader: SurfaceLoader,
    private readonly swipes: Swipes | null,
    private readonly report: () => void,
    private readonly dev: DevPort | null,
  ) {
    const every: ConcealableWindow = {
      isShown: () => this.shown(),
      conceal: () => {
        for (const { behavior } of this.held) behavior.conceal();
      },
      reveal: () => this.revealAll(),
    };
    this.quickHide = new QuickHideShortcut({ accelerator: QUICK_HIDE, windowBehavior: every });
  }

  install(): void {
    ipcMain.on(WINDOWS.openProject, (event, path: unknown) => {
      const url = this.fronts.trusts(event.senderFrame?.url) ? revealedUrl(this.fronts.built, path) : null;
      if (url !== null) this.create(url);
    });
    app.on('new-window-for-tab', () => {
      const from = this.focused();
      const made = this.create(this.held.at(-1)?.address ?? this.fronts.built);
      from?.addTabbedWindow(made);
    });
    this.quickHide.register();
  }

  dispose(): void {
    this.quickHide.dispose();
  }

  focused(): BrowserWindow | undefined {
    return this.held.at(-1)?.window;
  }

  async asked(options: MessageBoxOptions): Promise<number> {
    const window = this.focused();
    return (window === undefined ? await dialog.showMessageBox(options) : await dialog.showMessageBox(window, options)).response;
  }

  reveal(): void {
    const last = this.held.at(-1);
    if (last === undefined || !this.shown()) this.revealAll();
    else last.behavior.reveal();
  }

  open(): void {
    this.said = 'open';
    console.log(`[tagma-desktop] opening ${this.fronts.built.origin}`);
    for (const held of this.held) if (!held.onSurface) this.enter(held);
  }

  show(standing: LoaderState): void {
    this.said = standing;
    const page = waitingPageUrl(standing);
    for (const held of this.held) {
      this.cancel(held);
      if (held.front === 'dev') held.leaving = { reason: null };
      this.wait(held, page);
    }
    this.dev?.moved();
  }

  frontOf(window: BrowserWindow): SurfaceKind | null {
    return this.heldBy(window)?.front ?? null;
  }

  starting(window: BrowserWindow): boolean {
    return this.heldBy(window)?.starting != null;
  }

  use(window: BrowserWindow, kind: SurfaceKind): Promise<SurfaceRefusal | null> {
    const held = this.heldBy(window);
    if (held === undefined) return Promise.resolve(null);
    if (kind === 'built') {
      this.back(held, null);
      return Promise.resolve(null);
    }
    if (held.front === 'dev') return Promise.resolve(null);
    if (held.starting === null) {
      held.starting = this.toDev(held);
      this.dev?.moved();
    }
    return held.starting;
  }

  leaveEveryDev(reason: string): void {
    for (const held of this.held) if (held.front === 'dev') this.back(held, reason);
  }

  create(address: URL): BrowserWindow {
    const first = this.held.length === 0;
    const placement = first
      ? new WindowPlacement({ defaultSize: DEFAULT_SIZE, filePath: this.placementFile, minimumSize: MINIMUM_SIZE, screen })
      : null;
    const window = new BrowserWindow({
      ...behaviorWindowOptions(),
      ...(placement?.browserWindowOptions() ?? this.cascaded()),
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', titleBarOverlay: { height: 36 } } : {}),
      minWidth: MINIMUM_SIZE.width,
      minHeight: MINIMUM_SIZE.height,
      show: false,
      title: CHANNEL.name,
      tabbingIdentifier: TABBING,
      webPreferences: {
        preload: this.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        zoomMode: 'isolated',
        additionalArguments: this.dev === null ? [] : [DEV_SURFACE_ARGUMENT],
      },
    });
    const behavior = new ElectronWindowBehaviorHost(window, { initialState: INITIAL_STATE });
    const held: Held = {
      window,
      behavior,
      address,
      onSurface: false,
      front: 'built',
      attempt: 0,
      starting: null,
      entering: false,
      leaving: null,
      unbadge: null,
    };
    this.held.unshift(held);
    const untrack = placement?.track(window);
    installExternalLinks({ appOrigins: () => this.fronts.origins(), page: surfacePage, webContents: window.webContents });
    installDevTools(window);
    installTabKeys(window);
    this.swipes?.follow(window);
    this.follow(held);
    window.once('ready-to-show', () => {
      placement?.restoreWindowState(window);
      behavior.reveal();
    });
    window.on('closed', () => {
      untrack?.();
      behavior.destroy();
      this.drop(held);
      this.cancel(held);
      this.left(held);
    });
    if (this.said === 'open') this.enter(held);
    else if (this.said !== null) this.wait(held, waitingPageUrl(this.said));
    if (first) this.loader.start();
    return window;
  }

  private shown(): boolean {
    return this.held.some(({ behavior }) => behavior.isShown());
  }

  private revealAll(): void {
    const last = this.held.at(-1);
    if (last === undefined) {
      this.create(this.fronts.built);
      return;
    }
    for (const { behavior } of this.held) if (behavior !== last.behavior) behavior.reveal({ focus: false });
    last.behavior.reveal();
  }

  private cascaded(): BrowserWindowConstructorOptions {
    const from = this.focused()?.getNormalBounds();
    if (from === undefined) return DEFAULT_SIZE;
    const area = screen.getDisplayMatching(from).workArea;
    const next = { ...from, x: from.x + CASCADE, y: from.y + CASCADE };
    const fits = next.x + next.width <= area.x + area.width && next.y + next.height <= area.y + area.height;
    return fits ? next : { ...next, x: area.x, y: area.y };
  }

  private drop(held: Held): boolean {
    const at = this.held.indexOf(held);
    if (at !== -1) this.held.splice(at, 1);
    return at !== -1;
  }

  private enter(held: Held): void {
    held.onSurface = true;
    held.window.loadURL(held.address.toString(), { extraHeaders: 'Cache-Control: no-cache\n' }).catch(() => undefined);
  }

  private wait(held: Held, page: string): void {
    held.onSurface = false;
    held.window.loadURL(page).catch(() => undefined);
  }

  private heldBy(window: BrowserWindow): Held | undefined {
    return this.held.find((held) => held.window === window);
  }

  private async toDev(held: Held): Promise<SurfaceRefusal | null> {
    const attempt = held.attempt;
    const answer = this.dev === null ? CLOSED : await this.dev.start();
    if (attempt !== held.attempt || !this.held.includes(held)) return null;
    held.starting = null;
    try {
      if (!(answer instanceof URL)) return answer;
      if (this.said !== 'open' || held.window.isDestroyed()) return CLOSED;
      this.fronts.adopt(answer);
      held.front = 'dev';
      this.fronts.stand(held, 'dev');
      held.unbadge = this.dev?.badge(held.window, () => this.back(held, null)) ?? null;
      held.onSurface = true;
      held.entering = true;
      held.window.loadURL(rebased(held.address, answer).toString()).catch(() => undefined);
      return null;
    } finally {
      this.dev?.moved();
    }
  }

  private cancel(held: Held): void {
    held.attempt += 1;
    held.starting = null;
  }

  private back(held: Held, reason: string | null): void {
    this.cancel(held);
    this.dev?.moved();
    if (held.front !== 'dev' || held.window.isDestroyed()) return;
    held.leaving = { reason };
    if (this.said === 'open') this.enter(held);
    else if (this.said !== null) this.wait(held, waitingPageUrl(this.said));
  }

  private left(held: Held): void {
    const reason = held.leaving?.reason ?? null;
    held.leaving = null;
    held.entering = false;
    held.unbadge?.();
    held.unbadge = null;
    if (held.front === 'dev') {
      held.front = 'built';
      this.fronts.stand(held, 'built');
    }
    this.dev?.moved();
    if (reason === null || held.window.isDestroyed()) return;
    console.warn(`[tagma-desktop] a window left the dev surface: ${reason}`);
    this.dev?.fell(held.window, reason);
  }

  private follow(held: Held): void {
    const { window } = held;
    const contents = window.webContents;
    const origin = this.fronts.built.origin;
    const moved = (url: string): void => {
      const at = this.fronts.placed(url);
      if (at !== null) held.address = revealedUrl(this.fronts.built, `${at.pathname}${at.search}`) ?? held.address;
    };
    contents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      if (held.front === 'dev') {
        if (code !== ABORTED && this.fronts.fromDev(failedUrl)) this.back(held, `The dev surface did not load: ${description}.`);
        else if (code === ABORTED && !this.fronts.fromDev(failedUrl)) held.leaving = null;
        return;
      }
      if (!failedUrl.startsWith(origin)) return;
      console.warn(`[tagma-desktop] ${origin} did not answer: ${description}`);
      held.onSurface = false;
      this.loader.loadFailed();
    });
    contents.on('render-process-gone', (_event, details) => {
      if (held.front === 'dev') this.back(held, `The page of the dev surface stopped: ${details.reason}.`);
    });
    contents.on('will-prevent-unload', (event) => {
      if (held.front !== 'dev' || (held.leaving === null && !held.entering)) return;
      if (this.dev?.leave(window) === true) {
        event.preventDefault();
        return;
      }
      held.leaving = null;
      if (!held.entering) return;
      held.entering = false;
      this.left(held);
    });
    window.on('focus', () => {
      if (this.drop(held)) this.held.push(held);
      this.loader.focused();
    });
    contents.on('will-navigate', (event, url) => {
      const act = windowAct(url);
      if (act === null) return;
      event.preventDefault();
      if (act === 'retry') this.loader.retry();
      else if (act === 'switch') this.loader.switchOver();
      else this.report();
    });
    contents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      if (this.fronts.fromDev(details.url)) held.entering = false;
      else if (held.front === 'dev') this.left(held);
      if (!this.fronts.trusts(details.url)) return;
      held.onSurface = true;
      if (this.held.every((one) => one.onSurface)) this.loader.navigated();
    });
    contents.on('did-navigate', (_event, url) => moved(url));
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) moved(url);
    });
    contents.on('before-input-event', (event, input) => {
      if (!newWindowChord(input, process.platform === 'darwin')) return;
      event.preventDefault();
      this.create(held.address);
    });
  }
}

export const devToolsChord = (input: Input): boolean => {
  if (input.type !== 'keyDown') return false;
  const key = input.key.toLowerCase();
  return input.key === 'F12' || (key === 'i' && input.shift && (input.control || input.meta)) || (key === 'i' && input.alt && input.meta);
};

export const toggleDevTools = (window: BrowserWindow): void => {
  if (window.webContents.isDevToolsOpened()) window.webContents.closeDevTools();
  else window.webContents.openDevTools({ mode: 'detach' });
};

function installDevTools(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (!devToolsChord(input)) return;
    event.preventDefault();
    toggleDevTools(window);
  });
}
