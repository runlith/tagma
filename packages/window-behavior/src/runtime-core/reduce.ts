import type { WindowBehaviorCommand } from '../contract/commands.js';
import { applyWindowBehaviorPatch, type WindowBehaviorState } from '../contract/state.js';

export function reduceWindowBehaviorCommand(state: WindowBehaviorState, command: WindowBehaviorCommand): WindowBehaviorState {
  switch (command.type) {
    case 'set-always-on-top':
      return applyWindowBehaviorPatch(state, { alwaysOnTop: command.value });
    case 'set-transparent':
      return applyWindowBehaviorPatch(state, { transparent: command.value });
    case 'set-window-opacity':
      return applyWindowBehaviorPatch(state, { windowOpacity: command.value });
    case 'set-overlay-background-visible':
      return applyWindowBehaviorPatch(state, { overlayBackgroundVisible: command.value });
    case 'set-overlay-background-opacity':
      return applyWindowBehaviorPatch(state, { overlayBackgroundOpacity: command.value });
    case 'set-pass-through':
      return applyWindowBehaviorPatch(state, { passThrough: command.value });
    case 'set-focus-policy':
      return applyWindowBehaviorPatch(state, { focusPolicy: command.value });
    case 'set-capture-protection':
      return applyWindowBehaviorPatch(state, { captureProtection: command.value });
    case 'apply-patch':
      return applyWindowBehaviorPatch(state, command.patch);
    case 'set-pointer-interactive':
    case 'request-interactive-focus':
    case 'release-interactive-focus':
      return state;
  }
}
