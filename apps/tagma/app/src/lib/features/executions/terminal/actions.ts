import type { Action, DefaultKeys } from '$lib/features/workspace/action.js';
import type { TerminalAct } from './Keymap.js';

type Row = {
  readonly act: TerminalAct;
  readonly id: string;
  readonly title: string;
  readonly keys: DefaultKeys;
  readonly tabKeys?: DefaultKeys;
};

const os = (mac: readonly string[], other: readonly string[]): DefaultKeys => ({ mac, other });

const row = (tag: Exclude<TerminalAct['_tag'], 'select-index'>, title: string, keys: DefaultKeys, tabKeys?: DefaultKeys): Row => ({
  act: { _tag: tag } as TerminalAct,
  id: `terminal.${tag}`,
  title,
  keys,
  ...(tabKeys === undefined ? {} : { tabKeys }),
});

const tab = (place: number): Row => ({
  act: { _tag: 'select-index', index: place - 1 },
  id: `terminal.tab-${place}`,
  title: `Go to terminal tab ${place}`,
  keys: os([`Ctrl+${place}`], [`Alt+${place}`]),
  tabKeys: os([`Ctrl+${place}`], [`Alt+Shift+${place}`]),
});

const ROWS: readonly Row[] = [
  row('copy', 'Copy the terminal selection', os(['Mod+C'], ['Ctrl+Shift+C', 'Ctrl+C'])),
  row('select-all', 'Select the whole terminal', os(['Mod+A'], ['Ctrl+Shift+A'])),
  row('paste', 'Paste into the terminal', os(['Mod+V'], ['Ctrl+V', 'Ctrl+Shift+V', 'Shift+Insert'])),
  row('search', 'Find in the terminal', ['Mod+F']),
  row('clear', 'Clear the terminal', ['Mod+K']),
  row('focus-next', 'Focus the next terminal pane', ['Mod+BracketRight']),
  row('focus-previous', 'Focus the previous terminal pane', ['Mod+BracketLeft']),
  row('equalize', 'Make terminal panes equal', []),
  row('expand-pane', 'Expand the terminal pane', ['Mod+Shift+Enter']),
  row('set-title', 'Name the terminal pane', []),
  row('clear-title', 'Clear the terminal pane name', []),
  row('close-pane', 'Close the terminal pane', ['Mod+W'], ['Alt+W']),
  row('split-right', 'Split the terminal right', os(['Mod+D'], ['Mod+Shift+D'])),
  row('split-down', 'Split the terminal down', os(['Mod+Shift+D'], ['Alt+Shift+D'])),
  row('zoom-in', 'Make terminal text bigger', ['Mod+Equal', 'Mod+Shift+Equal']),
  row('zoom-out', 'Make terminal text smaller', ['Mod+Minus']),
  row('zoom-reset', 'Reset the terminal text size', ['Mod+0']),
  row('new-tab', 'New terminal tab', ['Mod+T'], ['Alt+T']),
  row('reopen-tab', 'Reopen the closed terminal tab', ['Mod+Shift+T'], ['Alt+Shift+W']),
  row('rename-tab', 'Rename the terminal tab', os(['Mod+R'], []), os(['Alt+R'], [])),
  row('close-all-tabs', 'Close every terminal tab', ['Mod+Alt+W']),
  row('next-tab', 'Next terminal tab', ['Ctrl+PageDown', 'Mod+Alt+BracketRight'], ['Alt+PageDown', 'Mod+Alt+BracketRight']),
  row('previous-tab', 'Previous terminal tab', ['Ctrl+PageUp', 'Mod+Alt+BracketLeft'], ['Alt+PageUp', 'Mod+Alt+BracketLeft']),
  row('previous-recent-tab', 'Last used terminal tab', ['Ctrl+Tab'], ['Alt+Q']),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(tab),
  row('scroll-top', 'Scroll the terminal to the top', os(['Mod+ArrowUp'], [])),
  row('scroll-bottom', 'Scroll the terminal to the bottom', os(['Mod+ArrowDown'], [])),
];

const ACTS: ReadonlyMap<string, TerminalAct> = new Map(ROWS.map((one) => [one.id, one.act]));

export const actOf = (action: string): TerminalAct | null => ACTS.get(action) ?? null;

export const TOGGLE = 'terminal.toggle-terminals';

export const TERMINAL = 'terminal';

export const actionOf = (act: TerminalAct): string =>
  act._tag === 'select-index' ? `terminal.tab-${act.index + 1}` : act._tag === 'toggle-terminals' ? TOGGLE : `terminal.${act._tag}`;

export const terminalActions: readonly Action[] = ROWS.map((one): Action => ({
  id: one.id,
  title: one.title,
  region: TERMINAL,
  where: 'In a terminal',
  keys: one.keys,
  ...(one.tabKeys === undefined ? {} : { tabKeys: one.tabKeys }),
}));
