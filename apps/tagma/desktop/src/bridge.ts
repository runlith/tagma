export type OperatingSystemKind = 'macos' | 'windows' | 'linux' | 'unknown';

export type HeldKey = {
  readonly code: string;
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
};

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
  arm(key: HeldKey | null): void;
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

export type TabCommand = 'close' | 'reopen';

export interface DesktopTabs {
  onCommand(listener: (command: TabCommand) => void): () => void;
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

export type BrowserIdentity = 'cleaned' | 'native';

export type PageRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export type Chord = {
  readonly code: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
};

export type FramedChord = { readonly chord: Chord; readonly frame: string };

export type PageKey = { readonly page: string | null; readonly chord: Chord; readonly frame: string | null };

export type PageShown = { readonly page: string; readonly panel: string };

export type PageFound = { readonly page: string; readonly matches: number; readonly active: number };

export type Identities = { readonly applied: BrowserIdentity; readonly chosen: BrowserIdentity };

export interface DesktopBrowser {
  host(): Promise<string | null>;
  show(shown: PageShown, rect: PageRect): void;
  hide(shown: PageShown): void;
  freeze(shown: PageShown, frozen: boolean): void;
  onElsewhere(listener: (lost: PageShown) => void): () => void;
  keys(chords: readonly Chord[], framed: readonly FramedChord[]): void;
  onKey(listener: (key: PageKey) => void): () => void;
  find(page: string, text: string, forward: boolean): void;
  stopFind(page: string): void;
  onFound(listener: (found: PageFound) => void): () => void;
  zoom(page: string, factor: number): void;
  devtools(page: string): void;
  capture(page: string): Promise<string | null>;
  identity(): Promise<Identities | null>;
  chooseIdentity(identity: BrowserIdentity): void;
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
  readonly files?: DesktopFiles;
  //! A desktop shell built before this member serves the newer app the server sends, and lacks it.
  readonly updates?: DesktopUpdates;
  //! Only a project window of a build from a checkout, opened on no named address, carries it.
  readonly surface?: DesktopSurface;
}

declare global {
  interface Window {
    tagmaDesktop?: DesktopApi;
  }
}
