import type { ChordModifier, HoldBinding } from '@runlith/desktop-input/contract/types';
import type { HeldKey } from './bridge.js';

const LETTERS: Readonly<Record<string, number>> = {
  A: 0,
  S: 1,
  D: 2,
  F: 3,
  H: 4,
  G: 5,
  Z: 6,
  X: 7,
  C: 8,
  V: 9,
  B: 11,
  Q: 12,
  W: 13,
  E: 14,
  R: 15,
  Y: 16,
  T: 17,
  O: 31,
  U: 32,
  I: 34,
  P: 35,
  L: 37,
  J: 38,
  K: 40,
  N: 45,
  M: 46,
};

const DIGITS: readonly number[] = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25];

const FUNCTIONS: readonly number[] = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90];

const NAMED: Readonly<Record<string, number>> = {
  Space: 49,
  Enter: 36,
  Tab: 48,
  Backspace: 51,
  Delete: 117,
  Backquote: 50,
  Minus: 27,
  Equal: 24,
  BracketLeft: 33,
  BracketRight: 30,
  Backslash: 42,
  IntlBackslash: 10,
  Semicolon: 41,
  Quote: 39,
  Comma: 43,
  Period: 47,
  Slash: 44,
  Home: 115,
  End: 119,
  PageUp: 116,
  PageDown: 121,
  ArrowLeft: 123,
  ArrowRight: 124,
  ArrowDown: 125,
  ArrowUp: 126,
};

function keyCodeOf(code: string): number | undefined {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return LETTERS[letter];
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return DIGITS[Number(digit)];
  const fn = /^F([0-9]{1,2})$/.exec(code)?.[1];
  if (fn !== undefined) return FUNCTIONS[Number(fn) - 1];
  return NAMED[code];
}

export function bindingOf(key: HeldKey): HoldBinding | null {
  const keyCode = keyCodeOf(key.code);
  if (keyCode === undefined) return null;
  const modifiers: ChordModifier[] = [];
  if (key.meta) modifiers.push('command');
  if (key.alt) modifiers.push('option');
  if (key.ctrl) modifiers.push('control');
  return { kind: 'key', keyCode, modifiers };
}
