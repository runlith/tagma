import type { BrowserWindow } from 'electron';
import { parseWindowBehaviorCommand } from '../contract/commands.js';
import { resolveWindowBehaviorInitialState, type WindowBehaviorState } from '../contract/state.js';
import { reduceWindowBehaviorCommand } from '../runtime-core/reduce.js';
import { resolveWindowBehaviorPresentation } from '../runtime-core/presentation.js';
import { defaultAppBridge } from './electron-defaults.js';
import { ElectronNoFocusStealRuntime, type NoFocusStealOptions } from './ElectronNoFocusStealRuntime.js';
import { ElectronPassThroughRuntime, type ElectronPassThroughRuntimeOptions } from './ElectronPassThroughRuntime.js';
import type { ElectronAppBridge, ElectronWindowBehaviorHostOptions } from './types.js';

export class ElectronWindowBehaviorHost {
  readonly #window: BrowserWindow;
  readonly #appBridge: ElectronAppBridge;
  readonly #platform: NodeJS.Platform;
  readonly #listeners = new Set<(state: WindowBehaviorState) => void>();
  readonly #passThroughRuntime: ElectronPassThroughRuntime;
  readonly #noFocusStealRuntime: ElectronNoFocusStealRuntime;
  #state: WindowBehaviorState;
  #concealed = false;

  constructor(window: BrowserWindow, options?: ElectronWindowBehaviorHostOptions) {
    this.#window = window;
    this.#appBridge = options?.appBridge ?? defaultAppBridge;
    this.#platform = options?.platform ?? process.platform;
    this.#state = resolveWindowBehaviorInitialState(options?.initialState);
    const passThroughOptions: ElectronPassThroughRuntimeOptions = {};
    if (options?.passThroughRegion !== undefined) {
      passThroughOptions.region = options.passThroughRegion;
    }
    if (options?.clock !== undefined) {
      passThroughOptions.clock = options.clock;
    }
    if (options?.cursorProvider !== undefined) {
      passThroughOptions.cursorProvider = options.cursorProvider;
    }
    if (options?.pollingIntervalMs !== undefined) {
      passThroughOptions.pollingIntervalMs = options.pollingIntervalMs;
    }
    this.#passThroughRuntime = new ElectronPassThroughRuntime(window, passThroughOptions);

    const noFocusStealOptions: NoFocusStealOptions = {};
    if (options?.noFocusStealNativeAdapter !== undefined) {
      noFocusStealOptions.nativeAdapter = options.noFocusStealNativeAdapter;
    }
    noFocusStealOptions.appBridge = this.#appBridge;
    if (options?.clock !== undefined) {
      noFocusStealOptions.clock = options.clock;
    }
    this.#noFocusStealRuntime = new ElectronNoFocusStealRuntime(window, noFocusStealOptions);

    this.#applyState(undefined, this.#state);
  }

  getState(): WindowBehaviorState {
    return this.#state;
  }

  subscribe(listener: (state: WindowBehaviorState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  destroy(): void {
    this.#passThroughRuntime.destroy();
    this.#noFocusStealRuntime.destroy();
    this.#listeners.clear();
  }

  reveal(options?: { focus?: boolean }): void {
    if (this.#window.isDestroyed()) return;
    this.#concealed = false;
    const shouldFocus = options?.focus !== false;

    if (this.#platform === 'darwin' && this.#appBridge.isHidden()) {
      this.#appBridge.show();
    }

    if ((!shouldFocus || this.#state.focusPolicy === 'no-focus-steal') && typeof this.#window.showInactive === 'function') {
      this.#window.showInactive();
    } else {
      this.#window.show();
    }

    if (!shouldFocus) return;

    if (this.#state.focusPolicy === 'standard') {
      try {
        this.#window.focus();
      } catch {}
      return;
    }

    try {
      this.#window.moveTop?.();
    } catch {}
  }

  conceal(): void {
    if (this.#window.isDestroyed()) return;
    this.#concealed = true;

    if (this.#platform === 'darwin' && this.#state.focusPolicy === 'standard') {
      this.#appBridge.hide();
      return;
    }

    this.#window.hide();
  }

  isShown(): boolean {
    if (this.#window.isDestroyed()) return false;
    if (this.#concealed) return false;
    return this.#window.isVisible();
  }

  dispatch(input: unknown): WindowBehaviorState {
    const command = parseWindowBehaviorCommand(input);

    if (command.type === 'set-pointer-interactive') {
      if (!this.#state.passThrough) {
        return this.#state;
      }

      if (command.forward !== undefined) {
        this.#passThroughRuntime.setInteractiveOverride(command.interactive, {
          forward: command.forward,
        });
      } else {
        this.#passThroughRuntime.setInteractiveOverride(command.interactive);
      }
      return this.#state;
    }

    if (command.type === 'request-interactive-focus') {
      this.#noFocusStealRuntime.requestInteractiveFocus();
      return this.#state;
    }

    if (command.type === 'release-interactive-focus') {
      this.#noFocusStealRuntime.releaseInteractiveFocus();
      return this.#state;
    }

    const previous = this.#state;
    const next = reduceWindowBehaviorCommand(previous, command);
    this.#applyState(previous, next);
    return this.#state;
  }

  #applyState(previous: WindowBehaviorState | undefined, next: WindowBehaviorState): void {
    this.#state = next;
    const presentation = resolveWindowBehaviorPresentation(next);

    const nextFloating = next.alwaysOnTop || next.focusPolicy === 'no-focus-steal';
    const previousFloating = previous ? previous.alwaysOnTop || previous.focusPolicy === 'no-focus-steal' : undefined;
    if (previousFloating === undefined || previousFloating !== nextFloating) {
      this.#window.setAlwaysOnTop(nextFloating);
    }

    if (!previous || previous.transparent !== next.transparent || previous.windowOpacity !== next.windowOpacity) {
      this.#window.setOpacity(presentation.effectiveWindowOpacity);
    }

    if (!previous || previous.passThrough !== next.passThrough) {
      this.#passThroughRuntime.setEnabled(next.passThrough);
    }

    if (!previous || previous.focusPolicy !== next.focusPolicy) {
      this.#noFocusStealRuntime.setEnabled(next.focusPolicy === 'no-focus-steal');
    }

    if (!previous || previous.captureProtection !== next.captureProtection) {
      this.#window.setContentProtection(next.captureProtection);
    }

    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
