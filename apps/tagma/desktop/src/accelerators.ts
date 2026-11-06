import type { HostChord } from '@tagma/server/platform/contract/wire/chord';

const NAMES: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const KEYS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [name, key])),
  Return: 'Enter',
  Esc: 'Escape',
};

export const acceleratorOf = (chord: HostChord, mac: boolean): string =>
  [
    chord.ctrl && 'Control',
    chord.alt && 'Alt',
    chord.shift && 'Shift',
    chord.meta && (mac ? 'Command' : 'Super'),
    NAMES[chord.key] ?? chord.key,
  ]
    .filter((part) => part !== false)
    .join('+');

export function chordsOfAccelerator(text: string, mac: boolean): readonly HostChord[] {
  const parts = text.split('+');
  const named = parts.pop();
  if (named === undefined) return [];
  const held = new Set(parts.map((part) => part.toLowerCase()));
  const plus = named === 'Plus';
  const key = plus ? 'Equal' : (KEYS[named] ?? (named.length === 1 ? named.toUpperCase() : named));
  const either = held.has('commandorcontrol') || held.has('cmdorctrl');
  const chord: HostChord = {
    meta: held.has('command') || held.has('cmd') || (either && mac) || held.has('super') || held.has('meta'),
    ctrl: held.has('control') || held.has('ctrl') || (either && !mac),
    alt: held.has('alt') || held.has('option'),
    shift: held.has('shift'),
    key,
  };
  return plus ? [{ ...chord, shift: true }, chord] : [chord];
}
