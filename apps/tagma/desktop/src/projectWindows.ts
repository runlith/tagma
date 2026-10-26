import { installExternalLinks } from '@runlith/desktop-host/ExternalLinks';
import { type ConcealableWindow, QuickHideShortcut } from '@runlith/desktop-host/QuickHideShortcut';
import { WindowPlacement } from '@runlith/desktop-host/WindowPlacement';
import { DEFAULT_WINDOW_BEHAVIOR_STATE, type WindowBehaviorState } from '@runlith/window-behavior/contract/state';
import { ElectronWindowBehaviorHost } from '@runlith/window-behavior/host-electron/ElectronWindowBehaviorHost';
import { behaviorWindowOptions } from '@runlith/window-behavior/host-electron/bootstrap';
import { CHANNEL } from '@tagma/server/composition/channel';
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
import { WINDOWS } from './channels.js';
import type { SurfaceLoader } from './SurfaceLoader.js';
import type { Swipes } from './swipe.js';
import { installTabKeys } from './tabKeys.js';
import { fromSurface, revealedUrl, surfacePage } from './viewWindowUrl.js';
import { type LoaderState, waitingPageUrl, windowAct } from './waitingPage.js';

const DEFAULT_SIZE = { width: 1280, height: 860 };
const MINIMUM_SIZE = { width: 960, height: 640 };
const CASCADE = 24;
const QUICK_HIDE = 'CommandOrControl+Shift+L';
const TABBING = 'projects';
const INITIAL_STATE: WindowBehaviorState = { ...DEFAULT_WINDOW_BEHAVIOR_STATE, windowOpacity: 1, overlayBackgroundVisible: false };

type Held = {
  readonly window: BrowserWindow;
  readonly behavior: ElectronWindowBehaviorHost;
  address: URL;
  onSurface: boolean;
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
    private readonly surface: URL,
    private readonly preload: string,
    private readonly placementFile: string,
    private readonly loader: SurfaceLoader,
    private readonly swipes: Swipes | null,
    private readonly report: () => void,
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
      const url = fromSurface(this.surface, event.senderFrame?.url) ? revealedUrl(this.surface, path) : null;
      if (url !== null) this.create(url);
    });
    app.on('new-window-for-tab', () => {
      const from = this.focused();
      const made = this.create(this.held.at(-1)?.address ?? this.surface);
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
    console.log(`[tagma-desktop] opening ${this.surface.origin}`);
    for (const held of this.held) if (!held.onSurface) this.enter(held);
  }

  show(standing: LoaderState): void {
    this.said = standing;
    const page = waitingPageUrl(standing);
    for (const held of this.held) this.wait(held, page);
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
      webPreferences: { preload: this.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, zoomMode: 'isolated' },
    });
    const behavior = new ElectronWindowBehaviorHost(window, { initialState: INITIAL_STATE });
    const held: Held = { window, behavior, address, onSurface: false };
    this.held.unshift(held);
    const untrack = placement?.track(window);
    installExternalLinks({ appOrigins: [this.surface.origin], page: surfacePage, webContents: window.webContents });
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
      this.create(this.surface);
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
    held.window.loadURL(held.address.toString()).catch(() => undefined);
  }

  private wait(held: Held, page: string): void {
    held.onSurface = false;
    held.window.loadURL(page).catch(() => undefined);
  }

  private follow(held: Held): void {
    const { window } = held;
    const contents = window.webContents;
    const origin = this.surface.origin;
    const moved = (url: string): void => {
      const at = URL.canParse(url) ? new URL(url) : null;
      if (at?.origin === origin) held.address = revealedUrl(this.surface, `${at.pathname}${at.search}`) ?? held.address;
    };
    contents.on('did-fail-load', (_event, _code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame || !failedUrl.startsWith(origin)) return;
      console.warn(`[tagma-desktop] ${origin} did not answer: ${description}`);
      held.onSurface = false;
      this.loader.loadFailed();
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
      if (!details.isMainFrame || details.isSameDocument || !details.url.startsWith(origin)) return;
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
