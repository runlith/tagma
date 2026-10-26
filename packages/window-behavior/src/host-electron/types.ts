import type { BrowserWindow, Rectangle } from 'electron';

export type BrowserWindowBounds = Rectangle;

export interface ElectronCursorPoint {
  x: number;
  y: number;
}

export interface ElectronClock {
  setInterval(handler: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

export interface NoFocusStealAdapter {
  setPreventsActivation(window: BrowserWindow, enabled: boolean): boolean;
}

export interface ElectronAppBridge {
  hide(): void;
  show(): void;
  isHidden(): boolean;
  focus(steal: boolean): void;
  listVisibleWindows(): BrowserWindow[];
}

export type ElectronPassThroughRegion =
  | { type: 'none' }
  | { type: 'top-strip'; height: number; forward?: boolean }
  | { type: 'bottom-strip'; height: number; forward?: boolean };

export interface ElectronWindowBehaviorHostOptions {
  initialState?: unknown;
  passThroughRegion?: ElectronPassThroughRegion;
  pollingIntervalMs?: number;
  cursorProvider?: () => ElectronCursorPoint;
  clock?: ElectronClock;
  noFocusStealNativeAdapter?: NoFocusStealAdapter;
  appBridge?: ElectronAppBridge;
  platform?: NodeJS.Platform;
}
