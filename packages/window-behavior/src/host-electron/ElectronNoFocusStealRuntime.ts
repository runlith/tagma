import type { BrowserWindow } from 'electron';
import { defaultAppBridge, defaultClock } from './electron-defaults.js';
import type { ElectronAppBridge, ElectronClock, NoFocusStealAdapter } from './types.js';

export interface NoFocusStealOptions {
  nativeAdapter?: NoFocusStealAdapter;
  appBridge?: ElectronAppBridge;
  clock?: ElectronClock;
}

export class ElectronNoFocusStealRuntime {
  readonly #window: BrowserWindow;
  readonly #nativeAdapter: NoFocusStealAdapter | undefined;
  readonly #appBridge: ElectronAppBridge;
  readonly #clock: ElectronClock;
  #temporaryInteractiveFocus = false;
  #movingOrResizing = false;
  #focusListener: (() => void) | undefined;
  #willMoveListener: (() => void) | undefined;
  #willResizeListener: (() => void) | undefined;
  #movedListener: (() => void) | undefined;
  #resizedListener: (() => void) | undefined;
  #rearmOnBlurListener: (() => void) | undefined;
  #nativeActive = false;

  constructor(window: BrowserWindow, options?: NoFocusStealOptions) {
    this.#window = window;
    this.#nativeAdapter = options?.nativeAdapter;
    this.#appBridge = options?.appBridge ?? defaultAppBridge;
    this.#clock = options?.clock ?? defaultClock;
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.#enable();
      return;
    }

    this.#temporaryInteractiveFocus = false;
    this.#disable();
  }

  requestInteractiveFocus(): void {
    if (this.#window.isDestroyed()) return;
    if (!this.#temporaryInteractiveFocus) {
      this.#disable();
      this.#temporaryInteractiveFocus = true;
      this.#installRearmOnBlurListener();
    }
    this.#activateWindow();
  }

  releaseInteractiveFocus(): void {
    if (!this.#temporaryInteractiveFocus) return;
    this.#temporaryInteractiveFocus = false;
    this.#enable();
  }

  destroy(): void {
    this.#temporaryInteractiveFocus = false;
    this.#disable();
  }

  #enable(): void {
    this.#disable();
    this.#installRearmOnBlurListener();

    if (this.#enableNativeMode()) {
      return;
    }

    this.#enableFallbackMode();
    this.#restoreExternalFocusIfWindowIsFocused();
  }

  #enableNativeMode(): boolean {
    if (!this.#nativeAdapter) return false;

    try {
      if (!this.#nativeAdapter.setPreventsActivation(this.#window, true)) {
        return false;
      }

      this.#nativeActive = true;
      return true;
    } catch {
      return false;
    }
  }

  #enableFallbackMode(): void {
    const onFocus = () => this.#onFallbackFocus();
    const onWillMove = () => {
      this.#movingOrResizing = true;
    };
    const onWillResize = () => {
      this.#movingOrResizing = true;
    };
    const onMoved = () => {
      this.#scheduleStopMovingOrResizing();
    };
    const onResized = () => {
      this.#scheduleStopMovingOrResizing();
    };

    this.#focusListener = onFocus;
    this.#willMoveListener = onWillMove;
    this.#willResizeListener = onWillResize;
    this.#movedListener = onMoved;
    this.#resizedListener = onResized;

    this.#window.on('focus', onFocus);
    this.#window.on('will-move', onWillMove);
    this.#window.on('will-resize', onWillResize);
    this.#window.on('moved', onMoved);
    this.#window.on('resized', onResized);
  }

  #disable(): void {
    if (this.#nativeActive) {
      this.#disableNativeMode();
    } else {
      this.#disableFallbackMode();
    }

    this.#removeRearmOnBlurListener();
  }

  #disableNativeMode(): void {
    if (!this.#nativeAdapter) {
      this.#nativeActive = false;
      return;
    }

    try {
      this.#nativeAdapter.setPreventsActivation(this.#window, false);
    } catch {}

    this.#nativeActive = false;
  }

  #disableFallbackMode(): void {
    if (this.#focusListener) this.#window.off('focus', this.#focusListener);
    if (this.#willMoveListener) this.#window.off('will-move', this.#willMoveListener);
    if (this.#willResizeListener) this.#window.off('will-resize', this.#willResizeListener);
    if (this.#movedListener) this.#window.off('moved', this.#movedListener);
    if (this.#resizedListener) this.#window.off('resized', this.#resizedListener);

    this.#focusListener = undefined;
    this.#willMoveListener = undefined;
    this.#willResizeListener = undefined;
    this.#movedListener = undefined;
    this.#resizedListener = undefined;
    this.#movingOrResizing = false;
  }

  #installRearmOnBlurListener(): void {
    this.#removeRearmOnBlurListener();

    const onBlur = () => {
      if (!this.#temporaryInteractiveFocus) return;
      this.#temporaryInteractiveFocus = false;
      this.#enable();
    };

    this.#rearmOnBlurListener = onBlur;
    this.#window.on('blur', onBlur);
  }

  #removeRearmOnBlurListener(): void {
    if (!this.#rearmOnBlurListener) return;
    this.#window.off('blur', this.#rearmOnBlurListener);
    this.#rearmOnBlurListener = undefined;
  }

  #scheduleStopMovingOrResizing(): void {
    this.#clock.setTimeout(() => {
      this.#movingOrResizing = false;
    }, 100);
  }

  #onFallbackFocus(): void {
    this.#clock.setTimeout(() => {
      if (this.#window.isDestroyed()) return;
      if (this.#movingOrResizing) return;
      if (this.#temporaryInteractiveFocus) return;

      if (process.platform === 'darwin') {
        this.#restorePreviousAppFocus();
        return;
      }

      this.#window.blur();
    }, 50);
  }

  #restoreExternalFocusIfWindowIsFocused(): void {
    if (!this.#window.isFocused()) return;

    if (process.platform === 'darwin') {
      this.#restorePreviousAppFocus();
      return;
    }

    this.#window.blur();
  }

  #restorePreviousAppFocus(): void {
    const visibleWindows = this.#appBridge.listVisibleWindows();
    this.#appBridge.hide();
    this.#clock.setTimeout(() => {
      for (const visibleWindow of visibleWindows) {
        if (visibleWindow.isDestroyed()) continue;
        if (typeof visibleWindow.showInactive === 'function') {
          visibleWindow.showInactive();
        }
      }
    }, 10);
  }

  #activateWindow(): void {
    if (this.#window.isDestroyed() || !this.#window.isVisible()) return;
    this.#appBridge.focus(true);
    this.#window.focus();
  }
}
