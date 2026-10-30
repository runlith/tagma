import type { HarnessAdapter } from '../contract/service/adapter.js';
import type { HarnessWidgetKey, ScreenAsk } from '@runlith/tagma/adapter/harness';

export const unmeasuredScreen = (_lines: readonly string[]): ScreenAsk | null => null;

export const oneValue =
  (keys: (ask: ScreenAsk, value: string) => readonly HarnessWidgetKey[] | null) =>
  (ask: ScreenAsk, values: readonly string[]): readonly HarnessWidgetKey[] | null =>
    values.length === 1 ? keys(ask, values[0]!) : null;

export const unmeasuredKeys = (): null => null;

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
