import { globalShortcut } from 'electron';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { type ConcealableWindow, QuickHideShortcut } from './QuickHideShortcut';

const ACCELERATOR = 'CommandOrControl+\\';

vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalShortcut.register).mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QuickHideShortcut', () => {
  test('registers and unregisters its global accelerator', () => {
    const shortcut = createShortcut();

    shortcut.shortcut.register();
    shortcut.shortcut.dispose();
    shortcut.shortcut.dispose();

    expect(globalShortcut.register).toHaveBeenCalledWith(ACCELERATOR, expect.any(Function));
    expect(globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(globalShortcut.unregister).toHaveBeenCalledWith(ACCELERATOR);
  });

  test('reports a registration failure without unregistering an accelerator it does not own', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(globalShortcut.register).mockReturnValue(false);
    const shortcut = createShortcut();

    shortcut.shortcut.register();
    shortcut.shortcut.dispose();

    expect(warn).toHaveBeenCalledWith(`[quick-hide] The accelerator is unavailable: ${ACCELERATOR}`);
    expect(globalShortcut.unregister).not.toHaveBeenCalled();
  });

  test('conceals through the window behavior host when the window is shown', () => {
    const shortcut = createShortcut();
    shortcut.windowBehavior.shown = true;

    shortcut.shortcut.register();
    fireShortcut();

    expect(shortcut.windowBehavior.conceal).toHaveBeenCalledTimes(1);
    expect(shortcut.windowBehavior.reveal).not.toHaveBeenCalled();
  });

  test('reveals through the window behavior host when the window is concealed', () => {
    const shortcut = createShortcut();
    shortcut.windowBehavior.shown = false;

    shortcut.shortcut.register();
    fireShortcut();

    expect(shortcut.windowBehavior.reveal).toHaveBeenCalledTimes(1);
    expect(shortcut.windowBehavior.conceal).not.toHaveBeenCalled();
  });

  test('ignores shortcut callbacks after dispose', () => {
    const disposed = createShortcut();
    disposed.shortcut.register();
    disposed.shortcut.dispose();

    fireShortcut();

    expect(disposed.windowBehavior.conceal).not.toHaveBeenCalled();
    expect(disposed.windowBehavior.reveal).not.toHaveBeenCalled();
  });
});

class FakeWindowBehavior implements ConcealableWindow {
  shown = true;
  conceal = vi.fn(() => {
    this.shown = false;
  });
  reveal = vi.fn(() => {
    this.shown = true;
  });

  isShown(): boolean {
    return this.shown;
  }
}

function createShortcut(): { windowBehavior: FakeWindowBehavior; shortcut: QuickHideShortcut } {
  const windowBehavior = new FakeWindowBehavior();
  const shortcut = new QuickHideShortcut({ accelerator: ACCELERATOR, windowBehavior });

  return { windowBehavior, shortcut };
}

function fireShortcut(): void {
  const callback = vi.mocked(globalShortcut.register).mock.calls.at(-1)?.[1];
  if (!callback) throw new Error('The quick-hide accelerator was not registered.');
  callback();
}
