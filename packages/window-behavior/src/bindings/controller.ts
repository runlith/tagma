import type { WindowBehaviorCommand } from '../contract/commands.js';
import { DEFAULT_WINDOW_BEHAVIOR_STATE, parseWindowBehaviorState, type WindowBehaviorState } from '../contract/state.js';
import { reduceWindowBehaviorCommand } from '../runtime-core/reduce.js';

export type WindowBehaviorUnsubscribe = () => void;

export interface WindowBehaviorTransport {
  getState(): Promise<WindowBehaviorState>;
  dispatch(command: WindowBehaviorCommand): Promise<WindowBehaviorState | undefined>;
  subscribe?(listener: (state: WindowBehaviorState) => void): WindowBehaviorUnsubscribe;
}

export class WindowBehaviorController {
  readonly #transport: WindowBehaviorTransport;
  readonly #listeners = new Set<(state: WindowBehaviorState) => void>();
  #state: WindowBehaviorState = DEFAULT_WINDOW_BEHAVIOR_STATE;
  #transportUnsubscribe: WindowBehaviorUnsubscribe | undefined;

  constructor(transport: WindowBehaviorTransport) {
    this.#transport = transport;
  }

  async initialize(): Promise<WindowBehaviorState> {
    const state = parseWindowBehaviorState(await this.#transport.getState());
    this.#setState(state);

    if (!this.#transportUnsubscribe && this.#transport.subscribe) {
      this.#transportUnsubscribe = this.#transport.subscribe((nextState) => {
        this.#setState(parseWindowBehaviorState(nextState));
      });
    }

    return this.#state;
  }

  destroy(): void {
    this.#transportUnsubscribe?.();
    this.#transportUnsubscribe = undefined;
    this.#listeners.clear();
  }

  getSnapshot(): WindowBehaviorState {
    return this.#state;
  }

  subscribe(listener: (state: WindowBehaviorState) => void): WindowBehaviorUnsubscribe {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async refresh(): Promise<WindowBehaviorState> {
    const state = parseWindowBehaviorState(await this.#transport.getState());
    this.#setState(state);
    return this.#state;
  }

  async dispatch(command: WindowBehaviorCommand): Promise<WindowBehaviorState> {
    this.#setState(reduceWindowBehaviorCommand(this.#state, command));
    const nextState = await this.#transport.dispatch(command);
    if (nextState !== undefined) {
      this.#setState(parseWindowBehaviorState(nextState));
    }
    return this.#state;
  }

  async setAlwaysOnTop(value: boolean): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-always-on-top', value });
  }

  async setTransparent(value: boolean): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-transparent', value });
  }

  async setWindowOpacity(value: number): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-window-opacity', value });
  }

  async setOverlayBackgroundVisible(value: boolean): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-overlay-background-visible', value });
  }

  async setOverlayBackgroundOpacity(value: number): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-overlay-background-opacity', value });
  }

  async setPassThrough(value: boolean): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-pass-through', value });
  }

  async setFocusPolicy(value: WindowBehaviorState['focusPolicy']): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-focus-policy', value });
  }

  async setCaptureProtection(value: boolean): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'set-capture-protection', value });
  }

  async setPointerInteractive(interactive: boolean, options?: { forward?: boolean }): Promise<WindowBehaviorState> {
    const command: {
      type: 'set-pointer-interactive';
      interactive: boolean;
      forward?: boolean;
    } = {
      type: 'set-pointer-interactive',
      interactive,
    };

    if (options?.forward !== undefined) {
      command.forward = options.forward;
    }

    return this.dispatch(command);
  }

  async requestInteractiveFocus(): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'request-interactive-focus' });
  }

  async releaseInteractiveFocus(): Promise<WindowBehaviorState> {
    return this.dispatch({ type: 'release-interactive-focus' });
  }

  #setState(state: WindowBehaviorState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
