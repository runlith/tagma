import { describe, expect, test } from 'bun:test';
import type { BrowserWindow } from 'electron';
import { behaviorWindowOptions } from './bootstrap.js';
import { ElectronWindowBehaviorHost } from './ElectronWindowBehaviorHost.js';
import type { ElectronAppBridge, ElectronCursorPoint } from './types.js';

class FakeWindow {
  alwaysOnTop = false;
  opacity = 1;
  ignoreMouse = false;
  ignoreMouseForward: boolean | undefined;
  contentProtection = false;
  bounds = { x: 0, y: 0, width: 200, height: 200 };
  visible = true;
  focused = false;
  focusCalls = 0;
  showCalls = 0;
  showInactiveCalls = 0;
  hideCalls = 0;
  moveTopCalls = 0;
  #listeners = new Map<string, Set<() => void>>();

  setAlwaysOnTop(value: boolean): void {
    this.alwaysOnTop = value;
  }

  setOpacity(value: number): void {
    this.opacity = value;
  }

  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void {
    this.ignoreMouse = ignore;
    this.ignoreMouseForward = options?.forward;
  }

  setContentProtection(value: boolean): void {
    this.contentProtection = value;
  }

  getBounds() {
    return this.bounds;
  }

  getNativeWindowHandle(): Buffer {
    return Buffer.from('handle');
  }

  isDestroyed(): boolean {
    return false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isFocused(): boolean {
    return this.focused;
  }

  blur(): void {
    this.focused = false;
  }

  focus(): void {
    this.focused = true;
    this.focusCalls += 1;
  }

  show(): void {
    this.visible = true;
    this.showCalls += 1;
  }

  showInactive(): void {
    this.visible = true;
    this.showInactiveCalls += 1;
  }

  hide(): void {
    this.visible = false;
    this.hideCalls += 1;
  }

  moveTop(): void {
    this.moveTopCalls += 1;
  }

  on(event: string, listener: () => void): this {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    listeners.add(listener);
    return this;
  }

  off(event: string, listener: () => void): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  emit(event: string): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener();
    }
  }
}

function toBrowserWindow(window: FakeWindow): BrowserWindow {
  return window as unknown as BrowserWindow;
}

function stubAppBridge(overrides: Partial<ElectronAppBridge> = {}): ElectronAppBridge {
  return {
    hide() {},
    show() {},
    isHidden() {
      return false;
    },
    focus() {},
    listVisibleWindows() {
      return [];
    },
    ...overrides,
  };
}

describe('ElectronWindowBehaviorHost', () => {
  test('starts from the canonical default state when no initial state is provided', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window));

    expect(host.getState().alwaysOnTop).toBe(false);
    expect(host.getState().windowOpacity).toBe(0.5);
    expect(window.opacity).toBe(1);

    host.destroy();
  });

  test('maps basic commands to the host window', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window));

    host.dispatch({ type: 'set-always-on-top', value: true });
    host.dispatch({ type: 'set-transparent', value: true });
    host.dispatch({ type: 'set-window-opacity', value: 0.4 });
    host.dispatch({ type: 'set-capture-protection', value: true });

    expect(window.alwaysOnTop).toBe(true);
    expect(window.opacity).toBe(0.4);
    expect(window.contentProtection).toBe(true);

    host.destroy();
  });

  test('uses top-strip pass-through interactivity when configured', () => {
    const window = new FakeWindow();
    let cursor: ElectronCursorPoint = { x: 50, y: 10 };
    let intervalHandler: (() => void) | undefined;

    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      cursorProvider: () => cursor,
      clock: {
        setInterval(handler) {
          intervalHandler = handler;
          return setInterval(() => {}, 60_000);
        },
        clearInterval(handle) {
          clearInterval(handle);
          intervalHandler = undefined;
        },
        setTimeout(handler) {
          handler();
          const handle = setTimeout(() => {}, 60_000);
          clearTimeout(handle);
          return handle;
        },
      },
    });

    host.dispatch({ type: 'set-pass-through', value: true });
    expect(window.ignoreMouse).toBe(true);

    intervalHandler?.();
    expect(window.ignoreMouse).toBe(false);

    cursor = { x: 50, y: 100 };
    intervalHandler?.();
    expect(window.ignoreMouse).toBe(true);

    host.destroy();
  });

  test('uses bottom-strip pass-through interactivity when configured', () => {
    const window = new FakeWindow();
    let cursor: ElectronCursorPoint = { x: 50, y: 190 };
    let intervalHandler: (() => void) | undefined;

    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      passThroughRegion: {
        type: 'bottom-strip',
        height: 28,
        forward: true,
      },
      cursorProvider: () => cursor,
      clock: {
        setInterval(handler) {
          intervalHandler = handler;
          return setInterval(() => {}, 60_000);
        },
        clearInterval(handle) {
          clearInterval(handle);
          intervalHandler = undefined;
        },
        setTimeout(handler) {
          handler();
          const handle = setTimeout(() => {}, 60_000);
          clearTimeout(handle);
          return handle;
        },
      },
    });

    host.dispatch({ type: 'set-pass-through', value: true });
    expect(window.ignoreMouse).toBe(true);

    intervalHandler?.();
    expect(window.ignoreMouse).toBe(false);

    cursor = { x: 50, y: 100 };
    intervalHandler?.();
    expect(window.ignoreMouse).toBe(true);

    host.destroy();
  });

  test('exposes BrowserWindow bootstrap options for transparency-capable windows', () => {
    expect(behaviorWindowOptions()).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      acceptFirstMouse: true,
    });
  });

  test('supports temporary pointer interactivity while pass-through is enabled', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window));

    host.dispatch({ type: 'set-pass-through', value: true });
    host.dispatch({ type: 'set-pointer-interactive', interactive: true });
    expect(window.ignoreMouse).toBe(false);

    host.dispatch({
      type: 'set-pointer-interactive',
      interactive: false,
      forward: false,
    });
    expect(window.ignoreMouse).toBe(true);
    expect(window.ignoreMouseForward).toBe(false);

    host.destroy();
  });

  test('ignores pointer-interactivity overrides when pass-through is disabled', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window));

    host.dispatch({ type: 'set-pointer-interactive', interactive: true });
    expect(window.ignoreMouse).toBe(false);
    expect(window.ignoreMouseForward).toBeUndefined();

    host.destroy();
  });

  test('uses the native no-focus-steal adapter without installing fallback listeners', () => {
    const window = new FakeWindow();
    const nativeCalls: boolean[] = [];
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      appBridge: {
        hide() {},
        show() {},
        isHidden() {
          return false;
        },
        focus() {},
        listVisibleWindows() {
          return [];
        },
      },
      noFocusStealNativeAdapter: {
        setPreventsActivation(_window, enabled) {
          nativeCalls.push(enabled);
          return true;
        },
      },
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });

    expect(nativeCalls).toEqual([true]);
    expect(window.listenerCount('focus')).toBe(0);
    expect(window.listenerCount('blur')).toBe(1);

    host.dispatch({ type: 'request-interactive-focus' });
    expect(nativeCalls).toEqual([true, false]);

    window.emit('blur');
    expect(nativeCalls).toEqual([true, false, true]);

    host.destroy();

    expect(nativeCalls).toEqual([true, false, true, false]);
  });

  test('enables native no-focus-steal without hiding the app to yield focus', () => {
    const window = new FakeWindow();
    window.focused = true;
    const nativeCalls: boolean[] = [];
    let hideCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        hide() {
          hideCalls += 1;
        },
      }),
      noFocusStealNativeAdapter: {
        setPreventsActivation(_window, enabled) {
          nativeCalls.push(enabled);
          return true;
        },
      },
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });

    expect(nativeCalls).toEqual([true]);
    expect(hideCalls).toBe(0);
    expect(window.showInactiveCalls).toBe(0);
    expect(host.isShown()).toBe(true);

    host.destroy();
  });

  test('sheds focus by hiding the app when no-focus-steal falls back without native support', () => {
    const window = new FakeWindow();
    window.focused = true;
    let hideCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        hide() {
          hideCalls += 1;
          window.focused = false;
        },
        listVisibleWindows() {
          return [toBrowserWindow(window)];
        },
      }),
      clock: {
        setInterval(handler) {
          return setInterval(handler, 60_000);
        },
        clearInterval(handle) {
          clearInterval(handle);
        },
        setTimeout(handler) {
          handler();
          const handle = setTimeout(() => {}, 60_000);
          clearTimeout(handle);
          return handle;
        },
      },
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });

    expect(hideCalls).toBe(1);
    expect(window.showInactiveCalls).toBe(1);
    expect(window.focused).toBe(false);

    host.destroy();
  });

  test('falls back to listener mode when the native adapter throws', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      noFocusStealNativeAdapter: {
        setPreventsActivation() {
          throw new Error('native failure');
        },
      },
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });

    expect(window.listenerCount('focus')).toBe(1);
    expect(window.listenerCount('blur')).toBe(1);

    host.destroy();
  });

  test('reveals a standard-focus window with show and focus', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge(),
    });

    host.reveal();

    expect(window.showCalls).toBe(1);
    expect(window.showInactiveCalls).toBe(0);
    expect(window.focusCalls).toBe(1);

    host.destroy();
  });

  test('reveals a no-focus-steal window with showInactive and moveTop', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge(),
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });
    host.reveal();

    expect(window.showCalls).toBe(0);
    expect(window.showInactiveCalls).toBe(1);
    expect(window.focusCalls).toBe(0);
    expect(window.moveTopCalls).toBe(1);

    host.destroy();
  });

  test('reveals without focus using showInactive and clears concealed state', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge(),
    });

    host.conceal();
    expect(host.isShown()).toBe(false);

    host.reveal({ focus: false });

    expect(window.showInactiveCalls).toBe(1);
    expect(window.showCalls).toBe(0);
    expect(window.focusCalls).toBe(0);
    expect(window.moveTopCalls).toBe(0);
    expect(host.isShown()).toBe(true);

    host.destroy();
  });

  test('reveals by un-hiding the app when it was concealed on macOS', () => {
    const window = new FakeWindow();
    let hidden = true;
    let showCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        isHidden() {
          return hidden;
        },
        show() {
          showCalls += 1;
          hidden = false;
        },
      }),
    });

    host.reveal();

    expect(showCalls).toBe(1);
    expect(window.showCalls).toBe(1);
    expect(window.focusCalls).toBe(1);

    host.destroy();
  });

  test('conceals by hiding the whole app on macOS so focus returns to the previous app', () => {
    const window = new FakeWindow();
    let hideCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        hide() {
          hideCalls += 1;
        },
      }),
    });

    host.conceal();

    expect(hideCalls).toBe(1);
    expect(window.hideCalls).toBe(0);

    host.destroy();
  });

  test('conceals a no-focus-steal overlay by ordering its window out on macOS', () => {
    const window = new FakeWindow();
    let hideCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        hide() {
          hideCalls += 1;
        },
      }),
    });

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });
    host.conceal();

    expect(window.hideCalls).toBe(1);
    expect(hideCalls).toBe(0);

    host.destroy();
  });

  test('conceals by ordering the window out on non-macOS hosts', () => {
    const window = new FakeWindow();
    let hideCalls = 0;
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'win32',
      appBridge: stubAppBridge({
        hide() {
          hideCalls += 1;
        },
      }),
    });

    host.conceal();

    expect(window.hideCalls).toBe(1);
    expect(hideCalls).toBe(0);

    host.destroy();
  });

  test('reports shown state from conceal/reveal intent, not the app-hidden flag', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge({
        isHidden() {
          return true;
        },
      }),
    });

    expect(host.isShown()).toBe(true);

    host.conceal();
    expect(host.isShown()).toBe(false);

    host.reveal();
    expect(host.isShown()).toBe(true);

    window.visible = false;
    expect(host.isShown()).toBe(false);

    host.destroy();
  });

  test('keeps a no-focus-steal overlay on the always-on-top level so it can surface above the active app', () => {
    const window = new FakeWindow();
    const host = new ElectronWindowBehaviorHost(toBrowserWindow(window), {
      platform: 'darwin',
      appBridge: stubAppBridge(),
    });

    expect(window.alwaysOnTop).toBe(false);

    host.dispatch({ type: 'set-focus-policy', value: 'no-focus-steal' });
    expect(window.alwaysOnTop).toBe(true);

    host.dispatch({ type: 'set-focus-policy', value: 'standard' });
    expect(window.alwaysOnTop).toBe(false);

    host.destroy();
  });
});
