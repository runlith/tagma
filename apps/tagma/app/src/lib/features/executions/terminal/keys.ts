import { editable } from './PaneHost.svelte';
import type { TerminalAct, TerminalKeymap } from './Keymap.js';
import type { TerminalTab } from './Tab.svelte.js';

export function ownsKey(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest('.xterm') !== null) return false;
  return !editable(target);
}

export function closeFocused(within: Element | null, tab: TerminalTab | null): boolean {
  const focused = document.activeElement;
  if (within === null || tab === null || focused === null || !within.contains(focused) || focused.closest('.xterm') === null) return false;
  const pane = tab.panes.get(focused.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? '');
  return pane !== undefined && tab.perform({ _tag: 'close-pane' }, pane);
}

export function routeKey(
  event: KeyboardEvent,
  keymap: TerminalKeymap,
  tab: TerminalTab | null,
  empty: (act: TerminalAct) => boolean,
): void {
  if (!ownsKey(event.target)) return;
  const resolution = keymap.resolve(event, { hasSelection: window.getSelection()?.toString() !== '' });
  if (resolution.kind !== 'act' || resolution.act._tag === 'toggle-terminals') return;
  const pane = tab?.current ?? null;
  const done = tab !== null && pane !== null ? tab.perform(resolution.act, pane) : empty(resolution.act);
  if (done) event.preventDefault();
}
