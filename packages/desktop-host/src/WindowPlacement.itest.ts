import type { BrowserWindow, Rectangle, Screen } from 'electron';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { WindowPlacement } from './WindowPlacement';

const DEFAULT_SIZE = { width: 1240, height: 820 };
const MINIMUM_SIZE = { width: 960, height: 640 };
const WORK_AREA = { x: 0, y: 25, width: 1440, height: 875 };

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

describe('WindowPlacement', () => {
  test('uses default size when no placement has been stored', async () => {
    const placement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath: join(await temporaryDirectory(), 'missing.json'),
      minimumSize: MINIMUM_SIZE,
      screen: screenFor(WORK_AREA),
    });

    expect(placement.browserWindowOptions()).toEqual({
      height: DEFAULT_SIZE.height,
      width: DEFAULT_SIZE.width,
    });
  });

  test('restores stored bounds inside the current display work area', async () => {
    const filePath = await placementFile({
      bounds: { x: -3000, y: -2000, width: 3200, height: 1800 },
      fullScreen: false,
      maximized: false,
      version: 1,
    });
    const placement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath,
      minimumSize: MINIMUM_SIZE,
      screen: screenFor(WORK_AREA),
    });

    expect(placement.browserWindowOptions()).toEqual({
      height: WORK_AREA.height,
      width: WORK_AREA.width,
      x: WORK_AREA.x,
      y: WORK_AREA.y,
    });
  });

  test('restores maximized and fullscreen state after the window is created', async () => {
    const maximizedPlacement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath: await placementFile({
        bounds: { x: 100, y: 120, width: 1240, height: 820 },
        fullScreen: false,
        maximized: true,
        version: 1,
      }),
      minimumSize: MINIMUM_SIZE,
      screen: screenFor(WORK_AREA),
    });
    const maximizedWindow = new FakeWindow();

    maximizedPlacement.restoreWindowState(maximizedWindow.asBrowserWindow());

    expect(maximizedWindow.maximize).toHaveBeenCalledTimes(1);
    expect(maximizedWindow.setFullScreen).not.toHaveBeenCalled();

    const fullScreenPlacement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath: await placementFile({
        bounds: { x: 100, y: 120, width: 1240, height: 820 },
        fullScreen: true,
        maximized: true,
        version: 1,
      }),
      minimumSize: MINIMUM_SIZE,
      screen: screenFor(WORK_AREA),
    });
    const fullScreenWindow = new FakeWindow();

    fullScreenPlacement.restoreWindowState(fullScreenWindow.asBrowserWindow());

    expect(fullScreenWindow.setFullScreen).toHaveBeenCalledWith(true);
    expect(fullScreenWindow.maximize).not.toHaveBeenCalled();
  });

  test('persists the normal bounds and native state when the tracked window changes', async () => {
    const filePath = join(await temporaryDirectory(), 'window-placement.json');
    const placement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath,
      minimumSize: MINIMUM_SIZE,
      saveDelayMs: 0,
      screen: screenFor(WORK_AREA),
    });
    const window = new FakeWindow();
    window.normalBounds = { x: 80, y: 90, width: 1280, height: 860 };
    window.maximizedState = true;

    placement.track(window.asBrowserWindow());
    window.emit('resize');

    await expect(readJson(filePath)).resolves.toEqual({
      bounds: { x: 80, y: 90, width: 1280, height: 860 },
      fullScreen: false,
      maximized: true,
      version: 1,
    });
  });

  test('flushes pending placement before the native window closes', async () => {
    const filePath = join(await temporaryDirectory(), 'window-placement.json');
    const placement = new WindowPlacement({
      defaultSize: DEFAULT_SIZE,
      filePath,
      minimumSize: MINIMUM_SIZE,
      saveDelayMs: 10_000,
      screen: screenFor(WORK_AREA),
    });
    const window = new FakeWindow();
    window.normalBounds = { x: 180, y: 190, width: 1180, height: 760 };

    placement.track(window.asBrowserWindow());
    window.emit('move');
    window.emit('close');

    await expect(readJson(filePath)).resolves.toMatchObject({
      bounds: { x: 180, y: 190, width: 1180, height: 760 },
      fullScreen: false,
      maximized: false,
      version: 1,
    });
  });
});

class FakeWindow {
  private readonly listeners = new Map<string, Set<() => void>>();
  destroyed = false;
  fullScreenState = false;
  maximizedState = false;
  normalBounds: Rectangle = { x: 20, y: 40, width: 1240, height: 820 };
  maximize = vi.fn(() => {
    this.maximizedState = true;
  });
  setFullScreen = vi.fn((value: boolean) => {
    this.fullScreenState = value;
  });

  asBrowserWindow(): BrowserWindow {
    return this as unknown as BrowserWindow;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  getNormalBounds(): Rectangle {
    return this.normalBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreenState;
  }

  isMaximized(): boolean {
    return this.maximizedState;
  }

  on(event: string, listener: () => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: () => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
}

function screenFor(workArea: Rectangle): Screen {
  return {
    getDisplayMatching() {
      return { workArea };
    },
  } as unknown as Screen;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'window-placement-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  return directory;
}

async function placementFile(snapshot: unknown): Promise<string> {
  const filePath = join(await temporaryDirectory(), 'desktop-window-placement.json');
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
