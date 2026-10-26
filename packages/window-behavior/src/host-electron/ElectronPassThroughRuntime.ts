import type { BrowserWindow } from 'electron';
import { DEFAULT_PASS_THROUGH_REGION, defaultClock, defaultCursorProvider } from './electron-defaults.js';
import type { ElectronClock, ElectronCursorPoint, ElectronPassThroughRegion } from './types.js';

type CursorProvider = () => ElectronCursorPoint;

export interface ElectronPassThroughRuntimeOptions {
  region?: ElectronPassThroughRegion;
  clock?: ElectronClock;
  cursorProvider?: CursorProvider;
  pollingIntervalMs?: number;
}

export class ElectronPassThroughRuntime {
  readonly #window: BrowserWindow;
  readonly #region: ElectronPassThroughRegion;
  readonly #clock: ElectronClock;
  readonly #cursorProvider: CursorProvider;
  readonly #pollingIntervalMs: number;
  #interval: ReturnType<typeof setInterval> | undefined;
  #lastInteractive = false;

  constructor(window: BrowserWindow, options?: ElectronPassThroughRuntimeOptions) {
    this.#window = window;
    this.#region = options?.region ?? DEFAULT_PASS_THROUGH_REGION;
    this.#clock = options?.clock ?? defaultClock;
    this.#cursorProvider = options?.cursorProvider ?? defaultCursorProvider;
    this.#pollingIntervalMs = options?.pollingIntervalMs ?? 16;
  }

  setEnabled(enabled: boolean): void {
    if (!enabled) {
      this.#stop();
      this.#window.setIgnoreMouseEvents(false);
      return;
    }

    this.#window.setIgnoreMouseEvents(true, { forward: this.#forwardEvents() });
    this.#start();
  }

  destroy(): void {
    this.#stop();
  }

  setInteractiveOverride(interactive: boolean, options?: { forward?: boolean }): void {
    if (interactive) {
      this.#window.setIgnoreMouseEvents(false);
      return;
    }

    this.#window.setIgnoreMouseEvents(true, {
      forward: options?.forward ?? this.#forwardEvents(),
    });
  }

  #forwardEvents(): boolean {
    return this.#region.type === 'none' ? true : (this.#region.forward ?? true);
  }

  #start(): void {
    this.#stop();
    const region = this.#region;
    if (region.type === 'none') return;

    this.#interval = this.#clock.setInterval(() => {
      if (this.#window.isDestroyed()) {
        this.#stop();
        return;
      }

      const cursor = this.#cursorProvider();
      const bounds = this.#window.getBounds();
      const withinWindow =
        cursor.x >= bounds.x && cursor.x <= bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y <= bounds.y + bounds.height;

      if (!withinWindow) {
        this.#setInteractive(false);
        return;
      }

      const relativeY = cursor.y - bounds.y;
      this.#setInteractive(isInteractiveRegion(region, bounds.height, relativeY));
    }, this.#pollingIntervalMs);
  }

  #stop(): void {
    if (!this.#interval) return;
    this.#clock.clearInterval(this.#interval);
    this.#interval = undefined;
    this.#lastInteractive = false;
  }

  #setInteractive(interactive: boolean): void {
    if (this.#lastInteractive === interactive) return;
    this.#lastInteractive = interactive;

    if (interactive) {
      this.#window.setIgnoreMouseEvents(false);
      return;
    }

    this.#window.setIgnoreMouseEvents(true, { forward: this.#forwardEvents() });
  }
}

function isInteractiveRegion(region: ElectronPassThroughRegion, windowHeight: number, relativeY: number): boolean {
  switch (region.type) {
    case 'none':
      return false;
    case 'top-strip':
      return relativeY < region.height;
    case 'bottom-strip':
      return relativeY >= windowHeight - region.height;
  }
}
