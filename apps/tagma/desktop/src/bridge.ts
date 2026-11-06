export type OperatingSystemKind = 'macos' | 'windows' | 'linux' | 'unknown';

export type GlobalState =
  | { readonly kind: 'off' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'untrusted' }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type Stroke = 'press' | 'lift' | 'cancel';

export const PILL_PATH = '/_desktop/dictation';

export const VIEW_WINDOW_PATH = '/_desktop/view/';

export interface DesktopDictation {
  state(): Promise<GlobalState>;
  onState(listener: (state: GlobalState) => void): () => void;
  prompt(): void;
  onStroke(listener: (stroke: Stroke) => void): () => void;
  onLost(listener: (reason: string) => void): () => void;
  keep(text: string): void;
  ready(): void;
  paste(text: string): Promise<boolean>;
  show(shown: boolean): void;
}

export interface DesktopTabs {
  closeWindow(): void;
}

export interface DesktopUpdates {
  onCheck(listener: () => void): () => void;
}

export type SwipePhase = 'began' | 'ended' | 'cancelled';

export type SwipeDirection = 'back' | 'forward';

export interface DesktopSwipe {
  onPhase(listener: (phase: SwipePhase) => void): () => void;
  onSwiped(listener: (direction: SwipeDirection) => void): () => void;
}

export type ViewWindowRequest = {
  readonly key: string;
  readonly path: string;
  readonly title: string;
};

export interface ProjectWindows {
  openProject(path: string): void;
}

export interface MainWindow {
  reveal(path: string): void;
  onReveal(listener: (path: string) => void): () => void;
}

export interface DesktopWindows extends ProjectWindows, MainWindow {
  open(request: ViewWindowRequest): void;
}

export interface DesktopFolders {
  choose(): Promise<string | null>;
}

export type NativeLook = 'system' | 'light' | 'dark';

export interface DesktopAppearance {
  follow(look: NativeLook): void;
}

export type BrowserIdentity = 'cleaned' | 'native';

export type PageRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type PageShown = { readonly page: string; readonly panel: string };

export type PageFound = { readonly page: string; readonly matches: number; readonly active: number };

export type Identities = { readonly applied: BrowserIdentity; readonly chosen: BrowserIdentity };

export interface DesktopBrowser {
  host(): Promise<string | null>;
  show(shown: PageShown, rect: PageRect): void;
  hide(shown: PageShown): void;
  freeze(shown: PageShown, frozen: boolean): void;
  onElsewhere(listener: (lost: PageShown) => void): () => void;
  find(page: string, text: string, forward: boolean): void;
  stopFind(page: string): void;
  onFound(listener: (found: PageFound) => void): () => void;
  zoom(page: string, factor: number): void;
  devtools(page: string): void;
  capture(page: string): Promise<string | null>;
  identity(): Promise<Identities | null>;
  chooseIdentity(identity: BrowserIdentity): void;
}

export type FramedKey = { readonly chord: string; readonly frame: string };

export type GlobalKey = { readonly chord: string; readonly action: string; readonly hold: boolean };

export type WindowKeys = {
  readonly chords: readonly string[];
  readonly claimed: readonly string[];
  readonly framed: readonly FramedKey[];
  readonly global: readonly GlobalKey[];
};

export type KeyPress = { readonly chord: string; readonly page: string | null; readonly frame: string | null; readonly global: boolean };

export type KeyGrant = 'held' | 'taken' | 'needs-accessibility' | 'unavailable';

export type GlobalAnswer = { readonly chord: string; readonly grant: KeyGrant; readonly reason: string | null };

export type OwnedAction = {
  readonly id: string;
  readonly title: string;
  readonly keys: readonly (string | { readonly keys: string; readonly global: true })[];
};

export interface DesktopKeys {
  publish(keys: WindowKeys): void;
  onPress(listener: (press: KeyPress) => void): () => void;
  kept(): Promise<readonly string[]>;
  answers(): Promise<readonly GlobalAnswer[]>;
  onAnswers(listener: (answers: readonly GlobalAnswer[]) => void): () => void;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly owned?: () => Promise<readonly OwnedAction[]>;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly perform?: (action: string) => void;
}

export interface DesktopFiles {
  pathOf(file: File): string;
}

export type SurfaceKind = 'built' | 'dev';

export type SurfaceRefusal = { readonly code: string; readonly reason: string; readonly said: string | null };

export interface DesktopSurface {
  current(): Promise<SurfaceKind>;
  use(surface: SurfaceKind): Promise<SurfaceRefusal | null>;
}

export interface DesktopApi {
  readonly operatingSystem: OperatingSystemKind;
  readonly dictation: DesktopDictation;
  readonly tabs: DesktopTabs;
  readonly swipe: DesktopSwipe;
  readonly windows: DesktopWindows;
  readonly folders: DesktopFolders;
  readonly browser: DesktopBrowser;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly keys?: DesktopKeys;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly files?: DesktopFiles;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly updates?: DesktopUpdates;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly appearance?: DesktopAppearance;
  //! Only a project window of a build from a checkout, opened on no named address, carries it.
  readonly surface?: DesktopSurface;
}

declare global {
  interface Window {
    tagmaDesktop?: DesktopApi;
  }
}
