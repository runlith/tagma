import type { HostOs } from '@runlith/layer/Host';

export type StripCommand = { readonly kind: 'step'; readonly direction: 1 | -1 } | { readonly kind: 'go' } | { readonly kind: 'cancel' };

export type Press = {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
};

export const FIRST_PLACES = 8;

const CYCLE_KEYS: ReadonlySet<string> = new Set(['Backquote', 'IntlBackslash']);

export function stripCommandOf(press: Press, os: HostOs, cycling: boolean): StripCommand | null {
  if (os !== 'macos') return null;
  if (press.type === 'keyup') return cycling && press.key === 'Control' ? { kind: 'go' } : null;
  if (press.type !== 'keydown') return null;
  if (cycling && press.key === 'Escape') return { kind: 'cancel' };
  if (press.altKey || !press.ctrlKey || press.metaKey || !CYCLE_KEYS.has(press.code)) return null;
  return { kind: 'step', direction: press.shiftKey ? -1 : 1 };
}
