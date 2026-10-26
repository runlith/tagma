import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle, Screen } from 'electron';
import { booleanValue, finiteNumber, isRecord } from '@runlith/utils/object';
import { clamp } from '@runlith/utils/number';

export const WINDOW_PLACEMENT_FILE = 'desktop-window-placement.json';

type WindowSize = {
  readonly width: number;
  readonly height: number;
};

type PlacementSnapshot = {
  readonly version: 1;
  readonly bounds: Rectangle;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
};

export type WindowPlacementOptions = {
  readonly defaultSize: WindowSize;
  readonly filePath: string;
  readonly minimumSize: WindowSize;
  readonly saveDelayMs?: number;
  readonly screen: Screen;
};

const SNAPSHOT_VERSION = 1;
const DEFAULT_SAVE_DELAY_MS = 250;

export class WindowPlacement {
  private readonly defaultSize: WindowSize;
  private readonly filePath: string;
  private readonly minimumSize: WindowSize;
  private readonly saveDelayMs: number;
  private readonly screen: Screen;
  private readonly snapshot: PlacementSnapshot | null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: WindowPlacementOptions) {
    this.defaultSize = options.defaultSize;
    this.filePath = options.filePath;
    this.minimumSize = options.minimumSize;
    this.saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS;
    this.screen = options.screen;
    this.snapshot = this.readSnapshot();
  }

  browserWindowOptions(): BrowserWindowConstructorOptions {
    const snapshot = this.snapshot;
    if (!snapshot) {
      return {
        height: this.defaultSize.height,
        width: this.defaultSize.width,
      };
    }

    return this.toWindowOptions(snapshot.bounds);
  }

  restoreWindowState(window: BrowserWindow): void {
    const snapshot = this.snapshot;
    if (!snapshot || window.isDestroyed()) return;

    if (snapshot.fullScreen) {
      window.setFullScreen(true);
      return;
    }

    if (snapshot.maximized) {
      window.maximize();
    }
  }

  track(window: BrowserWindow): () => void {
    const saveSoon = () => this.scheduleSave(window);
    const saveNow = () => this.saveWindowPlacement(window);

    window.on('move', saveSoon);
    window.on('moved', saveSoon);
    window.on('resize', saveSoon);
    window.on('resized', saveSoon);
    window.on('maximize', saveSoon);
    window.on('unmaximize', saveSoon);
    window.on('enter-full-screen', saveSoon);
    window.on('leave-full-screen', saveSoon);
    window.on('close', saveNow);

    return () => {
      window.off('move', saveSoon);
      window.off('moved', saveSoon);
      window.off('resize', saveSoon);
      window.off('resized', saveSoon);
      window.off('maximize', saveSoon);
      window.off('unmaximize', saveSoon);
      window.off('enter-full-screen', saveSoon);
      window.off('leave-full-screen', saveSoon);
      window.off('close', saveNow);
      this.clearSaveTimer();
    };
  }

  private readSnapshot(): PlacementSnapshot | null {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if (!isNotFoundError(error)) {
        console.warn('[window-placement] The stored placement could not be read:', error);
      }
      return null;
    }

    try {
      const snapshot = parsePlacementSnapshot(JSON.parse(raw));
      if (!snapshot) {
        console.warn('[window-placement] The stored placement is invalid: expected version 1 bounds snapshot.');
      }
      return snapshot;
    } catch (error) {
      console.warn('[window-placement] The stored placement is invalid:', error);
      return null;
    }
  }

  private toWindowOptions(bounds: Rectangle): BrowserWindowConstructorOptions {
    const normalized = this.normalizeBounds(bounds);
    return {
      height: normalized.height,
      width: normalized.width,
      x: normalized.x,
      y: normalized.y,
    };
  }

  private normalizeBounds(bounds: Rectangle): Rectangle {
    const display = this.screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const width = clamp(Math.round(bounds.width), this.minimumSize.width, Math.max(this.minimumSize.width, Math.round(area.width)));
    const height = clamp(Math.round(bounds.height), this.minimumSize.height, Math.max(this.minimumSize.height, Math.round(area.height)));
    const maxX = Math.max(Math.round(area.x), Math.round(area.x + area.width - width));
    const maxY = Math.max(Math.round(area.y), Math.round(area.y + area.height - height));

    return {
      height,
      width,
      x: clamp(Math.round(bounds.x), Math.round(area.x), maxX),
      y: clamp(Math.round(bounds.y), Math.round(area.y), maxY),
    };
  }

  private scheduleSave(window: BrowserWindow): void {
    if (this.saveDelayMs <= 0) {
      this.saveWindowPlacement(window);
      return;
    }

    this.clearSaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveWindowPlacement(window);
    }, this.saveDelayMs);
  }

  private clearSaveTimer(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
  }

  private saveWindowPlacement(window: BrowserWindow): void {
    this.clearSaveTimer();
    if (window.isDestroyed()) return;

    const snapshot: PlacementSnapshot = {
      bounds: window.getNormalBounds(),
      fullScreen: window.isFullScreen(),
      maximized: window.isMaximized(),
      version: SNAPSHOT_VERSION,
    };

    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
      renameSync(temporaryPath, this.filePath);
    } catch (error) {
      console.warn('[window-placement] The placement could not be saved:', error);
    }
  }
}

function parsePlacementSnapshot(value: unknown): PlacementSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== SNAPSHOT_VERSION) return null;

  const bounds = parseRectangle(value.bounds);
  const maximized = booleanValue(value.maximized);
  const fullScreen = booleanValue(value.fullScreen);
  if (!bounds || maximized === undefined || fullScreen === undefined) return null;

  return {
    bounds,
    fullScreen,
    maximized,
    version: SNAPSHOT_VERSION,
  };
}

function parseRectangle(value: unknown): Rectangle | null {
  if (!isRecord(value)) return null;

  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return null;
  if (width <= 0 || height <= 0) return null;

  return { height, width, x, y };
}

function isNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}
