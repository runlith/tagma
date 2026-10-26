import { describe, expect, test } from 'bun:test';
import { DEFAULT_WINDOW_BEHAVIOR_STATE, type WindowBehaviorState } from '../contract/state.js';
import type { WindowBehaviorCommand } from '../contract/commands.js';
import { reduceWindowBehaviorCommand } from '../runtime-core/reduce.js';
import { WindowBehaviorController, type WindowBehaviorTransport } from './controller.js';

class FakeTransport implements WindowBehaviorTransport {
  #state: WindowBehaviorState = DEFAULT_WINDOW_BEHAVIOR_STATE;
  #listeners = new Set<(state: WindowBehaviorState) => void>();

  async getState(): Promise<WindowBehaviorState> {
    return this.#state;
  }

  async dispatch(command: WindowBehaviorCommand): Promise<WindowBehaviorState> {
    this.#state = reduceWindowBehaviorCommand(this.#state, command);
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
    return this.#state;
  }

  subscribe(listener: (state: WindowBehaviorState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  push(state: WindowBehaviorState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}

describe('WindowBehaviorController', () => {
  test('loads initial state and tracks updates from transport', async () => {
    const transport = new FakeTransport();
    const controller = new WindowBehaviorController(transport);

    await controller.initialize();
    expect(controller.getSnapshot()).toEqual(DEFAULT_WINDOW_BEHAVIOR_STATE);

    transport.push({
      ...DEFAULT_WINDOW_BEHAVIOR_STATE,
      alwaysOnTop: true,
    });

    expect(controller.getSnapshot().alwaysOnTop).toBe(true);
    controller.destroy();
  });

  test('exposes headless command helpers without UI assumptions', async () => {
    const controller = new WindowBehaviorController(new FakeTransport());
    await controller.initialize();

    const next = await controller.setWindowOpacity(0.1);
    expect(next.windowOpacity).toBe(0.25);

    controller.destroy();
  });
});
