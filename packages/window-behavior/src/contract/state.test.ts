import { describe, expect, test } from 'bun:test';
import {
  applyWindowBehaviorPatch,
  DEFAULT_WINDOW_BEHAVIOR_STATE,
  parseWindowBehaviorPatch,
  parseWindowBehaviorState,
  resolveWindowBehaviorInitialState,
} from './state.js';

describe('window behavior state', () => {
  test('parses and clamps a full state at the boundary', () => {
    const parsed = parseWindowBehaviorState({
      alwaysOnTop: true,
      transparent: true,
      windowOpacity: 9,
      overlayBackgroundVisible: false,
      overlayBackgroundOpacity: -10,
      passThrough: true,
      focusPolicy: 'no-focus-steal',
      captureProtection: true,
    });

    expect(parsed.windowOpacity).toBe(1);
    expect(parsed.overlayBackgroundOpacity).toBe(0);
    expect(parsed.focusPolicy).toBe('no-focus-steal');
  });

  test('parses and clamps a patch without inventing unrelated fields', () => {
    const patch = parseWindowBehaviorPatch({
      windowOpacity: 0.1,
      overlayBackgroundOpacity: 5,
    });

    expect(patch).toEqual({
      windowOpacity: 0.25,
      overlayBackgroundOpacity: 1,
    });
  });

  test('applies patches against the canonical default state', () => {
    const next = applyWindowBehaviorPatch(DEFAULT_WINDOW_BEHAVIOR_STATE, {
      transparent: true,
      passThrough: true,
    });

    expect(next.transparent).toBe(true);
    expect(next.passThrough).toBe(true);
    expect(next.focusPolicy).toBe('standard');
  });

  test('resolves an omitted initial state to the canonical defaults', () => {
    const next = resolveWindowBehaviorInitialState(undefined);

    expect(next).toEqual(DEFAULT_WINDOW_BEHAVIOR_STATE);
  });

  test('resolves a partial initial state against the canonical defaults', () => {
    const next = resolveWindowBehaviorInitialState({
      alwaysOnTop: true,
      windowOpacity: 0.1,
    });

    expect(next).toEqual({
      ...DEFAULT_WINDOW_BEHAVIOR_STATE,
      alwaysOnTop: true,
      windowOpacity: 0.25,
    });
  });
});
