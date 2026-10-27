import { beforeEach, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

class Contents extends EventEmitter {
  loaded: string[] = [];
  loadURL(url: string): Promise<void> {
    this.loaded.push(url);
    return Promise.resolve();
  }
  setWindowOpenHandler(): void {}
  send(): void {}
}

class Window extends EventEmitter {
  static made: Window[] = [];
  readonly webContents = new Contents();
  destroyed = false;
  visible = false;

  constructor(readonly options: { readonly x?: number; readonly y?: number; readonly width: number; readonly height: number }) {
    super();
    Window.made.push(this);
  }

  loadURL(url: string): Promise<void> {
    return this.webContents.loadURL(url);
  }
  isDestroyed = (): boolean => this.destroyed;
  isVisible = (): boolean => this.visible;
  show(): void {
    this.visible = true;
  }
  showInactive(): void {
    this.visible = true;
  }
  hide(): void {
    this.visible = false;
  }
  focus(): void {
    this.emit('focus');
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('closed');
  }
  getNormalBounds() {
    return { x: this.options.x ?? 0, y: this.options.y ?? 0, width: this.options.width, height: this.options.height };
  }
  setAlwaysOnTop(): void {}
  setOpacity(): void {}
  setIgnoreMouseEvents(): void {}
  setContentProtection(): void {}
}

const chords = new Map<string, () => void>();
const handlers = new Map<string, (event: unknown, value: unknown) => void>();
const dialogs: (Window | null)[] = [];
const desktop = { hidden: false };

mock.module('electron', () => ({
  BrowserWindow: Window,
  app: {
    hide: () => void (desktop.hidden = true),
    show: () => void (desktop.hidden = false),
    isHidden: () => desktop.hidden,
    focus: () => undefined,
    on: () => undefined,
  },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      dialogs.push(args.length === 2 ? (args[0] as Window) : null);
      return { response: 0 };
    },
  },
  globalShortcut: {
    register: (accelerator: string, toggle: () => void) => !chords.has(accelerator) && chords.set(accelerator, toggle) !== undefined,
    unregister: (accelerator: string) => chords.delete(accelerator),
  },
  ipcMain: { on: (channel: string, handler: (event: unknown, value: unknown) => void) => handlers.set(channel, handler) },
  screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  shell: { openExternal: async () => undefined },
}));

const { ProjectWindows } = await import('./projectWindows.js');
const { SurfaceLoader } = await import('./SurfaceLoader.js');
const { WINDOWS } = await import('./channels.js');
const { Fronts } = await import('./fronts.js');

const surface = new URL('http://127.0.0.1:5173/');
const vite = new URL('http://localhost:5641/');

const devPort = () => {
  const seen = { badges: 0, fell: [] as string[] };
  return {
    seen,
    start: async () => vite,
    badge: () => {
      seen.badges += 1;
      return () => void (seen.badges -= 1);
    },
    fell: (_window: unknown, reason: string) => void seen.fell.push(reason),
    leave: () => true,
    moved: () => undefined,
  };
};

const compose = (dev: ReturnType<typeof devPort> | null = null) => {
  let windows: InstanceType<typeof ProjectWindows> | undefined;
  const loader = new SurfaceLoader(
    surface,
    { executable: '/nowhere/electron', env: {}, named: true },
    {
      open: () => windows?.open(),
      show: (standing) => windows?.show(standing),
      offer: async () => false,
      ask: async () => false,
      told: () => undefined,
      reopen: () => undefined,
      settled: () => undefined,
      fell: async () => 'left',
    },
  );
  windows = new ProjectWindows(new Fronts(surface), '/preload.cjs', '/nowhere/placement.json', loader, null, () => undefined, dev);
  windows.install();
  return windows;
};

const open = (): Window[] => Window.made.filter((window) => !window.destroyed);
const last = (window: Window): string | undefined => window.webContents.loaded.at(-1);
const settled = (): Promise<void> => Bun.sleep(0);
const asked = (from: string, path: unknown): void => handlers.get(WINDOWS.openProject)?.({ senderFrame: { url: from } }, path);

beforeEach(() => {
  Window.made = [];
  chords.clear();
  handlers.clear();
  dialogs.length = 0;
  desktop.hidden = false;
});

test('a project opens in a window of its own on its address, and only an app route of the surface opens one', async () => {
  const windows = compose();
  windows.create(surface);
  await settled();
  const [first] = open();

  asked(`${surface.origin}/tagma/chat`, '/runlith/chat/abc?branch=main');
  asked('https://evil.example/', '/runlith/chat');
  asked(`${surface.origin}/tagma/chat`, '/_desktop/dictation');
  asked(`${surface.origin}/tagma/chat`, '//evil.example/runlith');

  expect(open()).toHaveLength(2);
  expect(last(first!)).toBe(surface.toString());
  expect(last(open()[1]!)).toBe(`${surface.origin}/runlith/chat/abc?branch=main`);
});

test('once the surface opens again each window returns to its own place, and ⌘N opens the place of the window it was pressed in', async () => {
  const windows = compose();
  windows.create(surface);
  await settled();
  windows.create(new URL('/runlith/chat', surface));
  const [first, second] = open();
  first!.webContents.emit('did-navigate-in-page', {}, `${surface.origin}/tagma/graph/x1?branch=dev`, true);

  windows.show({ why: 'starting' });
  expect(open().every((window) => last(window)?.startsWith('data:text/html'))).toBe(true);
  windows.open();

  expect(last(first!)).toBe(`${surface.origin}/tagma/graph/x1?branch=dev`);
  expect(last(second!)).toBe(`${surface.origin}/runlith/chat`);

  first!.webContents.emit(
    'before-input-event',
    { preventDefault: () => undefined },
    {
      type: 'keyDown',
      key: 'n',
      meta: process.platform === 'darwin',
      control: process.platform !== 'darwin',
      alt: false,
      shift: false,
    },
  );
  expect(open().map(last)).toEqual([
    `${surface.origin}/tagma/graph/x1?branch=dev`,
    `${surface.origin}/runlith/chat`,
    `${surface.origin}/tagma/graph/x1?branch=dev`,
  ]);
});

test('one window moves to the dev surface on its own path, the dev origin is trusted only while it stands there, and a failed dev load brings it back on that path with the reason', async () => {
  const dev = devPort();
  const windows = compose(dev);
  windows.create(surface);
  await settled();
  windows.create(new URL('/runlith/chat', surface));
  const [first, second] = open();
  first!.webContents.emit('did-navigate-in-page', {}, `${surface.origin}/tagma/graph/x1?branch=dev`, true);

  asked(`${vite.origin}/tagma/chat`, '/runlith/chat/one');
  expect(await windows.use(first as never, 'dev')).toBeNull();
  asked(`${vite.origin}/tagma/chat`, '/runlith/chat/two');

  expect(open().map(last)).toEqual([
    `${vite.origin}/tagma/graph/x1?branch=dev`,
    `${surface.origin}/runlith/chat`,
    `${surface.origin}/runlith/chat/two`,
  ]);
  expect(dev.seen.badges).toBe(1);

  first!.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', `${vite.origin}/tagma/graph/x1?branch=dev`, true);
  expect(last(first!)).toBe(`${vite.origin}/tagma/graph/x1?branch=dev`);
  first!.webContents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', `${vite.origin}/tagma/graph/x1?branch=dev`, true);
  expect(last(first!)).toBe(`${surface.origin}/tagma/graph/x1?branch=dev`);
  expect(dev.seen.badges).toBe(1);
  first!.webContents.emit('did-start-navigation', { url: last(first!), isMainFrame: true, isSameDocument: false });

  expect(dev.seen.badges).toBe(0);
  expect(dev.seen.fell).toEqual(['The dev surface did not load: ERR_CONNECTION_REFUSED.']);
  const opened = open().length;
  asked(`${vite.origin}/tagma/chat`, '/runlith/chat/three');
  expect(open()).toHaveLength(opened);

  await windows.use(first as never, 'dev');
  first!.destroy();
  expect(dev.seen.badges).toBe(0);
});

test('a question is asked once, over the window in focus, never over one not yet focused, and over the one focused before once it closes', async () => {
  const windows = compose();
  windows.create(surface);
  const [first] = open();
  first!.focus();
  windows.create(new URL('/runlith/chat', surface));
  const second = open()[1]!;

  await windows.asked({ message: 'Update?' });
  second.focus();
  await windows.asked({ message: 'Update?' });
  second.destroy();
  await windows.asked({ message: 'Update?' });

  expect(dialogs).toEqual([first!, second, first!]);
});

test('activating the app makes a window only when none is open', async () => {
  const windows = compose();
  windows.create(surface);
  windows.reveal();
  expect(open()).toHaveLength(1);

  open()[0]!.destroy();
  windows.reveal();
  await settled();

  expect(open()).toHaveLength(1);
  expect(last(open()[0]!)).toBe(surface.toString());
});

test('the quick hide chord is held once by the app and hides and shows every window, and activation after it shows them all', () => {
  const windows = compose();
  windows.create(surface);
  windows.create(new URL('/runlith/chat', surface));
  for (const window of open()) window.emit('ready-to-show');
  const chord = chords.get('CommandOrControl+Shift+L')!;
  const some = (): boolean => !desktop.hidden && open().some((window) => window.visible);
  const every = (): boolean => !desktop.hidden && open().every((window) => window.visible);

  expect([...chords.keys()]).toEqual(['CommandOrControl+Shift+L']);
  chord();
  expect(some()).toBe(false);
  chord();
  expect(every()).toBe(true);

  chord();
  windows.reveal();
  expect(every()).toBe(true);
  chord();
  expect(some()).toBe(false);
});
