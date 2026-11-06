import './noAsar.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINDOW_PLACEMENT_FILE } from '@runlith/desktop-host/WindowPlacement';
import { DEFAULT_WINDOW_BEHAVIOR_STATE } from '@runlith/window-behavior/contract/state';
import { ElectronWindowBehaviorHost } from '@runlith/window-behavior/host-electron/ElectronWindowBehaviorHost';
import { behaviorWindowOptions } from '@runlith/window-behavior/host-electron/bootstrap';
import { BrowserWindow, type MessageBoxOptions, type WebContents, app, dialog, ipcMain, screen, session } from 'electron';
import { PILL_PATH, type Stroke } from './bridge.js';
import { DICTATION, UPDATES } from './channels.js';
import { Declaring } from './declaring.js';
import { Dictation, type Pill } from './Dictation.js';
import { type LoaderWindow, SurfaceLoader } from './SurfaceLoader.js';
import { namedSurfaceUrl, resolveSurfaceUrl } from './config.js';
import { inputHelperIn } from './helper.js';
import { GlobalShortcuts } from '@runlith/desktop-host/GlobalShortcuts';
import { Globals } from './globals.js';
import { Keys } from './keys.js';
import { keptChords } from './kept.js';
import { Swipes } from './swipe.js';
import { Appearance } from './appearance.js';
import { Folders } from './folders.js';
import { ProjectWindows } from './projectWindows.js';
import { ViewWindows } from './viewWindows.js';
import { DevSurface } from './devSurface.js';
import { FreshWorld } from './freshWorld.js';
import { Fronts } from './fronts.js';
import { MediaGrants } from './mediaGrants.js';
import { carriedBy, carriedIn, keptApplication, leaseRelease, numbered, standingIn } from './release.js';
import { bundleOf } from '@tagma/server/mac-applications/placement';
import { DESKTOP_DATA, dataDirectory, installationsRoot, serveLogPath } from '@tagma/server/installation/contract/wire/layout';
import { isRelease } from '@tagma/server/installation/contract/wire/feed';
import { CHANNEL } from './channel.js';
import { Quitting } from './quitting.js';
import { composed, writeReport } from './report.js';
import { applicationFolders, inApplications, moveToApplications } from './placing.js';
import { tell } from './telling.js';
import { Effect, Fiber } from 'effect';
import { serveHost } from './browser/connection.js';
import { BrowserHost } from './browser/host.js';
import { chosenIdentity, cleanedAgent, hostIdIn } from './browser/identity.js';
import { Panels } from './browser/panels.js';
import { UNOCCLUDED } from './browser/placement.js';
import { Profiles } from './browser/profiles.js';
import { reach } from './server.js';
import { holdInstance } from './instance.js';

let dictation: Dictation | undefined;
let globals: Globals | undefined;
let windows: ProjectWindows | undefined;
let checkAsked = false;
let browserServing: Fiber.Fiber<never> | undefined;
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));

app.setName(CHANNEL.name);
const data = dataDirectory(CHANNEL, process.env);
app.setPath('userData', data === null ? join(app.getPath('appData'), CHANNEL.name) : join(data, DESKTOP_DATA));
const identity = chosenIdentity(app.getPath('userData'));
if (identity === 'cleaned') app.userAgentFallback = cleanedAgent(app.userAgentFallback);
if (data !== null) app.commandLine.appendSwitch(UNOCCLUDED);

type Arrival = { readonly bundle: string | null };

const bundle = bundleOf(app.getPath('exe'));
const first = holdInstance(app.getPath('userData'), app.requestSingleInstanceLock({ bundle } satisfies Arrival));
if (!first) app.exit(0);

const installRoot = installationsRoot(CHANNEL, process.env);
const serveLog = serveLogPath(CHANNEL, process.env);
const home = process.env.HOME?.trim() || null;
const OFFERED_FILE = 'applications-offered';
const TOLD_FILE = 'attempt-told';
const leased = new Map<string, ReturnType<typeof leaseRelease>>();
let loader: SurfaceLoader | undefined;
let quitting: Quitting | undefined;

function reopenIn(target: string): void {
  quitting?.leave();
  if (app.isReady()) session.defaultSession.flushStorageData();
  app.relaunch({ execPath: join(target, 'Contents', 'MacOS', basename(app.getPath('exe'))), args: process.argv.slice(1) });
  app.exit(0);
}

const shownWindow = (): BrowserWindow | undefined => windows?.focused();

const megabytes = (bytes: number): string => (bytes < 1024 * 1024 ? 'under 1 MB' : `about ${Math.round(bytes / (1024 * 1024))} MB`);

async function reportProblem(): Promise<void> {
  const build = bundle === null ? null : (carriedBy(bundle)?.build ?? null);
  try {
    const composition = await composed({ name: CHANNEL.name, build, data, log: serveLog });
    const held = [
      `${CHANNEL.name}'s log and its start and restart records`,
      composition.segment.length === 0 ? null : 'its last performance record',
    ].filter((part) => part !== null);
    const agreed = await asked({
      type: 'info',
      message: 'Report a Problem',
      detail: `The report holds ${held.join(' and ')} — ${megabytes(composition.bytes)}. They name projects and threads by id. Nothing is sent: you save the file and pass it on yourself.`,
      buttons: ['Save Report…', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (agreed !== 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
    const chosen = await dialog.showSaveDialog({
      title: 'Report a Problem',
      defaultPath: join(app.getPath('downloads'), `${CHANNEL.name} report ${stamp}.zip`),
    });
    if (chosen.canceled || chosen.filePath === undefined) return;
    await writeReport(chosen.filePath, composition);
  } catch (error) {
    await tell(
      shownWindow(),
      { type: 'error', message: 'The report was not saved', words: 'Try again in a moment.', details: String(error) },
      () => undefined,
    );
  }
}

async function offerApplications(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  const own = bundle === null ? null : carriedBy(bundle);
  const offered = join(app.getPath('userData'), OFFERED_FILE);
  if (bundle === null || own === null || installRoot === null || !isRelease(own.build) || inApplications(bundle, home)) return;
  const standing = standingIn(installRoot);
  const kept = standing === null ? null : keptApplication(installRoot, standing);
  if (existsSync(offered) || standing === null || kept === null) return;
  const answer = await asked({
    type: 'question',
    message: `Move ${CHANNEL.name} to Applications?`,
    detail: `${CHANNEL.name} is open from outside the Applications folder. Moved there, it is easy to find and keeps opening after the download or disk image is gone. This copy stays where it is.`,
    buttons: ['Move to Applications', 'Not Now'],
    defaultId: 0,
    cancelId: 1,
  });
  if (signal.aborted) return;
  mkdirSync(dirname(offered), { recursive: true });
  writeFileSync(offered, `${new Date().toISOString()}\n`);
  if (answer !== 0) return;
  const placed = await moveToApplications(kept, standing.build, applicationFolders(home)).catch((error: unknown) => ({
    refused: String(error),
  }));
  if (signal.aborted) return;
  if ('placed' in placed) {
    reopenIn(placed.placed);
    return;
  }
  await tell(
    shownWindow(),
    {
      type: 'error',
      message: `${CHANNEL.name} was not moved to Applications`,
      words: `${CHANNEL.name} keeps opening from where it is. You can drag it to the Applications folder yourself.`,
      details: placed.refused,
    },
    () => void reportProblem(),
  );
}

async function settled(version: string, signal: AbortSignal): Promise<void> {
  if (installRoot === null || signal.aborted) return;
  let ready = leased.get(version);
  if (ready === undefined) {
    ready = leaseRelease(join(installRoot, version), process.env);
    leased.set(version, ready);
  }
  try {
    await ready;
  } catch (error) {
    if (leased.get(version) === ready) leased.delete(version);
    throw error;
  }
  if (!signal.aborted) void offerApplications(signal);
}

const asked = async (options: MessageBoxOptions): Promise<number> =>
  windows === undefined ? (await dialog.showMessageBox(options)).response : windows.asked(options);

function surfaceLoader(surfaceUrl: URL): SurfaceLoader {
  const window: LoaderWindow = {
    open: () => windows?.open(),
    show: (standing) => windows?.show(standing),
    offer: async (from) =>
      (await asked({
        type: 'question',
        message: `Bring your data over from ${from.name}?`,
        detail: `${CHANNEL.name} starts with an empty world. Its threads, projects and graphs can be copied from ${from.name}; ${from.name} keeps its own.`,
        buttons: [`Transfer data from ${from.name}`, 'Start empty'],
        defaultId: 0,
        cancelId: 1,
      })) === 0,
    ask: async (said, reason) => {
      const buttons = reason === 'failed' ? ['Try Again', 'Not Now', 'Report a Problem…'] : ['Yes', 'Not Now'];
      const chosen = await asked({ type: 'question', message: said, buttons, defaultId: 0, cancelId: 1 });
      if (chosen === 2) void reportProblem();
      return chosen === 0;
    },
    told: (title, refusal) =>
      void tell(
        shownWindow(),
        {
          type: 'warning',
          message: title,
          words: refusal.said ?? 'Try again later. If it keeps failing, report the problem.',
          details: `${refusal.code}: ${refusal.reason}`,
        },
        () => void reportProblem(),
      ),
    reopen: reopenIn,
    settled,
    fell: async (fallen) => {
      const told = join(app.getPath('userData'), TOLD_FILE);
      if (existsSync(told) && readFileSync(told, 'utf8') === fallen.key) return 'left';
      mkdirSync(dirname(told), { recursive: true });
      writeFileSync(told, fallen.key);
      const buttons = fallen.to === null ? ['OK', 'Report a Problem…'] : ['Try Again', 'OK', 'Report a Problem…'];
      const chosen = await asked({
        type: 'warning',
        message: `${CHANNEL.name} ${fallen.build} didn't start${fallen.back === null ? '' : `, so you are still on ${fallen.back}`}`,
        detail: fallen.said ?? 'Your threads, projects and settings are as they were before the update.',
        buttons,
        defaultId: fallen.to === null ? 0 : 1,
        cancelId: fallen.to === null ? 0 : 1,
      });
      if (buttons[chosen] === 'Report a Problem…') void reportProblem();
      return buttons[chosen] === 'Try Again' ? 'retry' : 'left';
    },
  };
  return new SurfaceLoader(
    surfaceUrl,
    { executable: app.getPath('exe'), env: process.env, named: namedSurfaceUrl(process.argv, process.env) !== undefined },
    window,
  );
}

const PILL_WIDTH = 480;
const PILL_HEIGHT = 64;
const PILL_MARGIN_BOTTOM = 72;
const PILL_RETRY_MS = 2_000;
const PILL_RETRY_CAP_MS = 60_000;

class PillWindow implements Pill {
  private readonly window: BrowserWindow;
  private readonly behavior: ElectronWindowBehaviorHost;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: URL,
    private readonly down: (reason: string | null) => void,
  ) {
    this.window = new BrowserWindow({
      ...behaviorWindowOptions(),
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
      frame: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      title: 'Dictation',
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, zoomMode: 'isolated' },
    });
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.behavior = new ElectronWindowBehaviorHost(this.window, {
      initialState: {
        ...DEFAULT_WINDOW_BEHAVIOR_STATE,
        alwaysOnTop: true,
        transparent: true,
        windowOpacity: 1,
        overlayBackgroundVisible: false,
        passThrough: true,
        focusPolicy: 'no-focus-steal',
      },
      passThroughRegion: { type: 'none' },
    });
    const contents = this.window.webContents;
    contents.on('did-start-loading', () => this.down(null));
    contents.on('did-finish-load', () => {
      this.failures = 0;
    });
    contents.on('did-fail-load', (_event, _code, description, _url, isMainFrame) => {
      if (isMainFrame) this.fail(`the dictation pill did not load: ${description}`);
    });
    contents.on('render-process-gone', (_event, details) => this.fail(`the dictation pill stopped: ${details.reason}`));
    this.load();
  }

  get contents(): WebContents {
    return this.window.webContents;
  }

  stroke(stroke: Stroke): boolean {
    if (this.window.isDestroyed()) return false;
    this.window.webContents.send(DICTATION.stroke, stroke);
    return true;
  }

  lost(reason: string): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(DICTATION.lost, reason);
  }

  show(shown: boolean): void {
    if (this.window.isDestroyed()) return;
    if (!shown) {
      this.behavior.conceal();
      return;
    }
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.window.setBounds({
      x: Math.round(workArea.x + (workArea.width - PILL_WIDTH) / 2),
      y: Math.round(workArea.y + workArea.height - PILL_HEIGHT - PILL_MARGIN_BOTTOM),
      width: PILL_WIDTH,
      height: PILL_HEIGHT,
    });
    this.behavior.reveal({ focus: false });
  }

  close(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.behavior.destroy();
    if (!this.window.isDestroyed()) this.window.destroy();
  }

  private fail(reason: string): void {
    console.warn(`[tagma-desktop] ${reason}`);
    this.down(reason);
    if (this.retry !== null) return;
    const delay = Math.min(PILL_RETRY_CAP_MS, PILL_RETRY_MS * 2 ** this.failures);
    this.failures += 1;
    this.retry = setTimeout(() => {
      this.retry = null;
      this.load();
    }, delay);
  }

  private load(): void {
    if (this.window.isDestroyed()) return;
    this.window.loadURL(new URL(PILL_PATH, this.url).toString(), { extraHeaders: 'Cache-Control: no-cache\n' }).catch(() => undefined);
  }
}

function serveBrowser(fronts: Fronts, data: string, projects: ProjectWindows, keys: Keys): void {
  const surfaceUrl = fronts.built;
  const userData = app.getPath('userData');
  const hostId = hostIdIn(userData);
  let host: BrowserHost | undefined;
  const profiles = new Profiles(identity, {
    downloaded: (contents, download) => host?.downloaded(contents, download),
    window: (contents) => host?.window(contents) ?? null,
  });
  host = new BrowserHost(profiles, identity, {
    newWindow: (from) => projects.create(fronts.placed(from.webContents.getURL()) ?? surfaceUrl),
    reveal: (popup) => popup.show(),
    pressed: (window, page, input) => keys.page(window.webContents, page, input),
  });
  new Panels(fronts, host, hostId, userData, identity).install();
  const declarer = new Declaring(host, (url) => fronts.trusts(url));
  declarer.install();
  const ours = async () => (await reach(surfaceUrl, data)).at === 'ours';
  browserServing = Effect.runFork(serveHost({ surface: surfaceUrl, ours, host: hostId, executor: host, declarer }));
}

app.on('second-instance', (_event, _argv, _directory, additional) => {
  windows?.reveal();
  const copy = (additional as Partial<Arrival> | null)?.bundle;
  if (typeof copy === 'string') loader?.arrived(copy);
});

app.whenReady().then(() => {
  if (!first) return;
  const surfaceUrl = resolveSurfaceUrl(process.argv, process.env);
  const named = namedSurfaceUrl(process.argv, process.env) !== undefined;
  const own = bundle === null ? null : carriedBy(bundle);
  const fronts = new Fronts(surfaceUrl);
  const dev = named || own === null || numbered(own) ? null : new DevSurface(surfaceUrl, fronts, () => void reportProblem());
  const fresh = dev === null ? null : new FreshWorld(surfaceUrl, shownWindow, () => void reportProblem());
  quitting = new Quitting(
    surfaceUrl,
    named || installRoot === null || serveLog === null || data === null
      ? null
      : { installRoot, data, log: serveLog, env: process.env, carried: bundle === null ? null : carriedIn(bundle) },
    () => BrowserWindow.getAllWindows(),
    shownWindow,
    () => void reportProblem(),
    () => {
      checkAsked = true;
      windows?.reveal();
      windows?.focused()?.webContents.send(UPDATES.check);
    },
    () => loader?.leave(),
    dev === null || fresh === null ? [] : [...dev.menu(), { type: 'separator' }, ...fresh.menu()],
  );
  quitting.install();
  ipcMain.handle(UPDATES.take, () => {
    const asked = checkAsked;
    checkAsked = false;
    return asked;
  });
  dictation = new Dictation((down) => new PillWindow(surfaceUrl, down), inputHelperIn(app.getPath('exe')), fronts);
  dictation.install();
  const mac = process.platform === 'darwin';
  globals = new Globals(new GlobalShortcuts(), dictation, mac);
  const keys = new Keys(
    fronts,
    globals,
    () => quitting?.menuKeys() ?? new Set(),
    () => keptChords(process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'),
    (contents) => windows?.published(contents),
  );
  keys.install();
  loader = surfaceLoader(surfaceUrl);
  const projects = new ProjectWindows(
    fronts,
    PRELOAD,
    join(app.getPath('userData'), WINDOW_PLACEMENT_FILE),
    loader,
    Swipes.start(),
    () => void reportProblem(),
    dev,
    keys,
  );
  windows = projects;
  globals.attach(projects);
  projects.install();
  dev?.install(projects);
  new ViewWindows(fronts, PRELOAD, projects).install();
  new Folders(fronts).install();
  new Appearance(fronts).install();
  new MediaGrants((contents) => BrowserWindow.fromWebContents(contents)).guardFrames(session.defaultSession);
  if (data !== null) serveBrowser(fronts, data, projects, keys);
  projects.create(surfaceUrl);

  app.on('activate', () => {
    if (bundle !== null) loader?.arrived(bundle);
    projects.reveal();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (browserServing !== undefined) Effect.runFork(Fiber.interrupt(browserServing));
  if (app.isReady()) session.defaultSession.flushStorageData();
  globals?.dispose();
  void dictation?.dispose();
  dictation = undefined;
});
