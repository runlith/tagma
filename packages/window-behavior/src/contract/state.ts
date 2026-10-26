import { z } from 'zod';

export const MIN_WINDOW_OPACITY = 0.25;
export const MAX_WINDOW_OPACITY = 1;
export const MIN_OVERLAY_BACKGROUND_OPACITY = 0;
export const MAX_OVERLAY_BACKGROUND_OPACITY = 1;

export const windowFocusPolicySchema = z.enum(['standard', 'no-focus-steal']);

export type WindowFocusPolicy = z.infer<typeof windowFocusPolicySchema>;

export const windowBehaviorStateSchema = z.object({
  alwaysOnTop: z.boolean(),
  transparent: z.boolean(),
  windowOpacity: z.number(),
  overlayBackgroundVisible: z.boolean(),
  overlayBackgroundOpacity: z.number(),
  passThrough: z.boolean(),
  focusPolicy: windowFocusPolicySchema,
  captureProtection: z.boolean(),
});

export type WindowBehaviorState = z.infer<typeof windowBehaviorStateSchema>;

export const windowBehaviorPatchSchema = windowBehaviorStateSchema.partial();

export type WindowBehaviorPatch = z.infer<typeof windowBehaviorPatchSchema>;

export const DEFAULT_WINDOW_BEHAVIOR_STATE: WindowBehaviorState = {
  alwaysOnTop: false,
  transparent: false,
  windowOpacity: 0.5,
  overlayBackgroundVisible: true,
  overlayBackgroundOpacity: 0.7,
  passThrough: false,
  focusPolicy: 'standard',
  captureProtection: false,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeWindowBehaviorState(input: WindowBehaviorState): WindowBehaviorState {
  return {
    alwaysOnTop: input.alwaysOnTop,
    transparent: input.transparent,
    windowOpacity: clamp(input.windowOpacity, MIN_WINDOW_OPACITY, MAX_WINDOW_OPACITY),
    overlayBackgroundVisible: input.overlayBackgroundVisible,
    overlayBackgroundOpacity: clamp(input.overlayBackgroundOpacity, MIN_OVERLAY_BACKGROUND_OPACITY, MAX_OVERLAY_BACKGROUND_OPACITY),
    passThrough: input.passThrough,
    focusPolicy: input.focusPolicy,
    captureProtection: input.captureProtection,
  };
}

export function normalizeWindowBehaviorPatch(input: WindowBehaviorPatch): WindowBehaviorPatch {
  const output: WindowBehaviorPatch = {};

  if (input.alwaysOnTop !== undefined) output.alwaysOnTop = input.alwaysOnTop;
  if (input.transparent !== undefined) output.transparent = input.transparent;
  if (input.windowOpacity !== undefined) {
    output.windowOpacity = clamp(input.windowOpacity, MIN_WINDOW_OPACITY, MAX_WINDOW_OPACITY);
  }
  if (input.overlayBackgroundVisible !== undefined) {
    output.overlayBackgroundVisible = input.overlayBackgroundVisible;
  }
  if (input.overlayBackgroundOpacity !== undefined) {
    output.overlayBackgroundOpacity = clamp(input.overlayBackgroundOpacity, MIN_OVERLAY_BACKGROUND_OPACITY, MAX_OVERLAY_BACKGROUND_OPACITY);
  }
  if (input.passThrough !== undefined) output.passThrough = input.passThrough;
  if (input.focusPolicy !== undefined) output.focusPolicy = input.focusPolicy;
  if (input.captureProtection !== undefined) output.captureProtection = input.captureProtection;

  return output;
}

export function parseWindowBehaviorState(input: unknown): WindowBehaviorState {
  return normalizeWindowBehaviorState(windowBehaviorStateSchema.parse(input));
}

export function parseWindowBehaviorPatch(input: unknown): WindowBehaviorPatch {
  return normalizeWindowBehaviorPatch(windowBehaviorPatchSchema.parse(input));
}

export function resolveWindowBehaviorInitialState(input: unknown): WindowBehaviorState {
  if (input === undefined) {
    return DEFAULT_WINDOW_BEHAVIOR_STATE;
  }

  return applyWindowBehaviorPatch(DEFAULT_WINDOW_BEHAVIOR_STATE, parseWindowBehaviorPatch(input));
}

export function applyWindowBehaviorPatch(state: WindowBehaviorState, patch: WindowBehaviorPatch): WindowBehaviorState {
  const normalizedPatch = normalizeWindowBehaviorPatch(patch);

  return normalizeWindowBehaviorState({
    alwaysOnTop: normalizedPatch.alwaysOnTop ?? state.alwaysOnTop,
    transparent: normalizedPatch.transparent ?? state.transparent,
    windowOpacity: normalizedPatch.windowOpacity ?? state.windowOpacity,
    overlayBackgroundVisible: normalizedPatch.overlayBackgroundVisible ?? state.overlayBackgroundVisible,
    overlayBackgroundOpacity: normalizedPatch.overlayBackgroundOpacity ?? state.overlayBackgroundOpacity,
    passThrough: normalizedPatch.passThrough ?? state.passThrough,
    focusPolicy: normalizedPatch.focusPolicy ?? state.focusPolicy,
    captureProtection: normalizedPatch.captureProtection ?? state.captureProtection,
  });
}
