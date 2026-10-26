import { describe, expect, test } from 'bun:test';
import { DEFAULT_WINDOW_BEHAVIOR_STATE } from '../contract/state.js';
import { reduceWindowBehaviorCommand } from './reduce.js';

describe('reduceWindowBehaviorCommand', () => {
  test('changes state for ordinary set commands', () => {
    const next = reduceWindowBehaviorCommand(DEFAULT_WINDOW_BEHAVIOR_STATE, {
      type: 'set-focus-policy',
      value: 'no-focus-steal',
    });

    expect(next.focusPolicy).toBe('no-focus-steal');
  });

  test('keeps state stable for interactive focus commands', () => {
    const next = reduceWindowBehaviorCommand(DEFAULT_WINDOW_BEHAVIOR_STATE, {
      type: 'request-interactive-focus',
    });

    expect(next).toBe(DEFAULT_WINDOW_BEHAVIOR_STATE);
  });

  test('keeps state stable for transient pointer-interactivity commands', () => {
    const next = reduceWindowBehaviorCommand(DEFAULT_WINDOW_BEHAVIOR_STATE, {
      type: 'set-pointer-interactive',
      interactive: true,
    });

    expect(next).toBe(DEFAULT_WINDOW_BEHAVIOR_STATE);
  });

  test('supports apply-patch as a first-class command', () => {
    const next = reduceWindowBehaviorCommand(DEFAULT_WINDOW_BEHAVIOR_STATE, {
      type: 'apply-patch',
      patch: { captureProtection: true },
    });

    expect(next.captureProtection).toBe(true);
  });
});
