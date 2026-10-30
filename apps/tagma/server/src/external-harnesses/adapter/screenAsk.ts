import type { HarnessAdapter } from '../contract/service/adapter.js';
import { unmeasuredScreen, type ScreenAsk } from '@runlith/tagma/adapter/harness';

export const readsScreen = (adapter: HarnessAdapter): boolean => adapter.screenAskOf !== unmeasuredScreen;

export const widgetStands = (ask: ScreenAsk | null): ask is ScreenAsk => ask !== null && ask.options.length > 0;

export const sameScreenAsk = (left: ScreenAsk, right: ScreenAsk): boolean => {
  if (left.kind !== right.kind || left.prompt !== right.prompt || left.header !== right.header) return false;
  if (left.options.length !== right.options.length) return false;
  for (let i = 0; i < left.options.length; i++) {
    const a = left.options[i]!;
    const b = right.options[i]!;
    if (a.value !== b.value || a.label !== b.label) return false;
  }
  return true;
};
