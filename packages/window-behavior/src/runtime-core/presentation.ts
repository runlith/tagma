import { DEFAULT_WINDOW_BEHAVIOR_STATE, type WindowBehaviorState } from '../contract/state.js';

export type WindowBehaviorPresentation = {
  alwaysOnTop: boolean;
  effectiveWindowOpacity: number;
  transparent: boolean;
  overlayBackgroundVisible: boolean;
  overlayBackgroundOpacity: number;
  passThrough: boolean;
  focusPolicy: WindowBehaviorState['focusPolicy'];
  captureProtection: boolean;
};

export function resolveWindowBehaviorPresentation(state: WindowBehaviorState): WindowBehaviorPresentation {
  return {
    alwaysOnTop: state.alwaysOnTop,
    effectiveWindowOpacity: state.transparent ? state.windowOpacity : 1,
    transparent: state.transparent,
    overlayBackgroundVisible: state.overlayBackgroundVisible,
    overlayBackgroundOpacity: state.overlayBackgroundOpacity,
    passThrough: state.passThrough,
    focusPolicy: state.focusPolicy,
    captureProtection: state.captureProtection,
  };
}

export function createDefaultWindowBehaviorPresentation(): WindowBehaviorPresentation {
  return resolveWindowBehaviorPresentation(DEFAULT_WINDOW_BEHAVIOR_STATE);
}
