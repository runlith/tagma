import { contextBridge, ipcRenderer, type IpcRendererEvent, webUtils } from 'electron';
import type {
  DesktopApi,
  DesktopAppearance,
  DesktopBrowser,
  DesktopDictation,
  DesktopFiles,
  DesktopFolders,
  DesktopKeys,
  DesktopSurface,
  DesktopSwipe,
  DesktopTabs,
  DesktopUpdates,
  DesktopWindows,
  GlobalAnswer,
  GlobalState,
  Identities,
  KeyPress,
  OperatingSystemKind,
  PageFound,
  PageShown,
  Stroke,
  SurfaceKind,
  SurfaceRefusal,
  SwipeDirection,
  SwipePhase,
  OwnedAction,
  WindowKeys,
} from './bridge.js';
import { APPEARANCE, BROWSER, DEV_SURFACE_ARGUMENT, DICTATION, FOLDERS, KEYS, SURFACE, SWIPE, TABS, UPDATES, WINDOWS } from './channels.js';

function isMainFrame(): boolean {
  try {
    return process.isMainFrame !== false;
  } catch {
    return true;
  }
}

function resolveOperatingSystem(platform: NodeJS.Platform): OperatingSystemKind {
  switch (platform) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const heard = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, heard);
  return () => {
    ipcRenderer.off(channel, heard);
  };
}

const dictation: DesktopDictation = {
  state: () => ipcRenderer.invoke(DICTATION.state) as Promise<GlobalState>,
  onState: (listener) => listen<GlobalState>(DICTATION.changed, listener),
  prompt: () => ipcRenderer.send(DICTATION.prompt),
  onStroke: (listener) => listen<Stroke>(DICTATION.stroke, listener),
  onLost: (listener) => listen<string>(DICTATION.lost, listener),
  keep: (text) => ipcRenderer.send(DICTATION.keep, text),
  ready: () => ipcRenderer.send(DICTATION.ready),
  paste: (text) => ipcRenderer.invoke(DICTATION.paste, text) as Promise<boolean>,
  show: (shown) => ipcRenderer.send(DICTATION.show, shown),
};

const tabs: DesktopTabs = {
  closeWindow: () => ipcRenderer.send(TABS.closeWindow),
};

const updates: DesktopUpdates = {
  onCheck: (listener) => {
    const take = () =>
      void (ipcRenderer.invoke(UPDATES.take) as Promise<boolean>).then((asked) => {
        if (asked) listener();
      });
    take();
    return listen<void>(UPDATES.check, take);
  },
};

const swipe: DesktopSwipe = {
  onPhase: (listener) => listen<SwipePhase>(SWIPE.phase, listener),
  onSwiped: (listener) => listen<SwipeDirection>(SWIPE.swiped, listener),
};

const windows: DesktopWindows = {
  open: (request) => ipcRenderer.send(WINDOWS.open, request),
  openProject: (path) => ipcRenderer.send(WINDOWS.openProject, path),
  reveal: (path) => ipcRenderer.send(WINDOWS.reveal, path),
  onReveal: (listener) => listen<string>(WINDOWS.revealed, listener),
};

const folders: DesktopFolders = {
  choose: () => ipcRenderer.invoke(FOLDERS.choose) as Promise<string | null>,
};

const appearance: DesktopAppearance = {
  follow: (look) => ipcRenderer.send(APPEARANCE.follow, look),
};

const browser: DesktopBrowser = {
  host: () => ipcRenderer.invoke(BROWSER.host) as Promise<string | null>,
  show: (shown, rect) => ipcRenderer.send(BROWSER.show, shown, rect),
  hide: (shown) => ipcRenderer.send(BROWSER.hide, shown),
  freeze: (shown, frozen) => ipcRenderer.send(BROWSER.freeze, shown, frozen),
  onElsewhere: (listener) => listen<PageShown>(BROWSER.elsewhere, listener),
  find: (page, text, forward) => ipcRenderer.send(BROWSER.find, page, text, forward),
  stopFind: (page) => ipcRenderer.send(BROWSER.stopFind, page),
  onFound: (listener) => listen<PageFound>(BROWSER.found, listener),
  zoom: (page, factor) => ipcRenderer.send(BROWSER.zoom, page, factor),
  devtools: (page) => ipcRenderer.send(BROWSER.devtools, page),
  capture: (page) => ipcRenderer.invoke(BROWSER.capture, page) as Promise<string | null>,
  identity: () => ipcRenderer.invoke(BROWSER.identity) as Promise<Identities | null>,
  chooseIdentity: (identity) => ipcRenderer.send(BROWSER.chooseIdentity, identity),
};

const keys: DesktopKeys = {
  publish: (published) => ipcRenderer.send(KEYS.publish, published satisfies WindowKeys),
  onPress: (listener) => listen<KeyPress>(KEYS.press, listener),
  kept: () => ipcRenderer.invoke(KEYS.kept) as Promise<readonly string[]>,
  answers: () => ipcRenderer.invoke(KEYS.answers) as Promise<readonly GlobalAnswer[]>,
  onAnswers: (listener) => listen<readonly GlobalAnswer[]>(KEYS.answered, listener),
  owned: () => ipcRenderer.invoke(KEYS.owned) as Promise<readonly OwnedAction[]>,
  perform: (action) => ipcRenderer.send(KEYS.perform, action),
};

const RECEIVER_ONLY = /\/TemporaryItems\/NSIRD_[^/]*\//;

const files: DesktopFiles = {
  pathOf: (file) => {
    const path = webUtils.getPathForFile(file);
    return RECEIVER_ONLY.test(path) ? '' : path;
  },
};

const surface: DesktopSurface = {
  current: () => ipcRenderer.invoke(SURFACE.current) as Promise<SurfaceKind>,
  use: (kind) => ipcRenderer.invoke(SURFACE.use, kind) as Promise<SurfaceRefusal | null>,
};

const api: DesktopApi = {
  operatingSystem: resolveOperatingSystem(process.platform),
  dictation,
  tabs,
  swipe,
  windows,
  folders,
  browser,
  keys,
  files,
  updates,
  appearance,
  ...(process.argv.includes(DEV_SURFACE_ARGUMENT) ? { surface } : {}),
};

if (isMainFrame()) {
  contextBridge.exposeInMainWorld('tagmaDesktop', api);
}
