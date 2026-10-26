import { expect, test } from 'vitest';
import { type Press, stripCommandOf } from './keys.js';

const down = (key: string, code: string, mods: Partial<Press> = {}): Press => ({
  type: 'keydown',
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test.each([
  ['⌘1 takes the first place', down('1', 'Digit1', { metaKey: true }), false, { kind: 'nth', place: 1 }],
  ['⌘8 takes the eighth place', down('8', 'Digit8', { metaKey: true }), false, { kind: 'nth', place: 8 }],
  ['⌘9 takes the last place', down('9', 'Digit9', { metaKey: true }), false, { kind: 'last' }],
  ['⌘1 on a layout whose digit row types symbols', down('&', 'Digit1', { metaKey: true }), false, { kind: 'nth', place: 1 }],
  ['⌃` steps forward', down('`', 'Backquote', { ctrlKey: true }), false, { kind: 'step', direction: 1 }],
  ['⌃ and the key left of 1 on an ISO keyboard', down('§', 'IntlBackslash', { ctrlKey: true }), false, { kind: 'step', direction: 1 }],
  ['⌃` under a Russian layout', down(']', 'Backquote', { ctrlKey: true }), false, { kind: 'step', direction: 1 }],
  ['⌃⇧` steps back', down('~', 'Backquote', { ctrlKey: true, shiftKey: true }), true, { kind: 'step', direction: -1 }],
  ['Esc cancels a held cycle', down('Escape', 'Escape', { ctrlKey: true }), true, { kind: 'cancel' }],
  ['Esc outside a cycle is not the strip’s', down('Escape', 'Escape'), false, null],
  ['⌘⇧1 is not a place', down('!', 'Digit1', { metaKey: true, shiftKey: true }), false, null],
  ['⌃1 stays with the file tabs', down('1', 'Digit1', { ctrlKey: true }), false, null],
  ['⌘0 is not a place', down('0', 'Digit0', { metaKey: true }), false, null],
] as const)('on macOS %s', (_name, press, cycling, command) => {
  expect(stripCommandOf(press, 'macos', cycling)).toEqual(command);
});

test('the move happens when ⌃ is released, and only while a cycle is held', () => {
  const release = { ...down('Control', 'ControlLeft'), type: 'keyup' } as const;

  expect(stripCommandOf(release, 'macos', true)).toEqual({ kind: 'go' });
  expect(stripCommandOf(release, 'macos', false)).toBeNull();
  expect(stripCommandOf({ ...down('`', 'Backquote', { ctrlKey: true }), type: 'keyup' }, 'macos', true)).toBeNull();
});

test.each(['windows', 'linux'] as const)('%s has no project chords', (os) => {
  for (const press of [
    down('1', 'Digit1', { metaKey: true }),
    down('1', 'Digit1', { ctrlKey: true }),
    down('`', 'Backquote', { ctrlKey: true }),
  ]) {
    expect(stripCommandOf(press, os, false)).toBeNull();
  }
});
