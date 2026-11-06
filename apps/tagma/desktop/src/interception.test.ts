import { expect, test } from 'bun:test';
import type { Input } from 'electron';
import { chordOfInput } from './inputChord.js';
import { intercepted, tableOf } from './interception.js';
import { keptChords } from './kept.js';
import { keptMenuChords, menuChords } from './menuKeys.js';

const input = (held: Partial<Input>): Input =>
  ({
    type: 'keyDown',
    key: '',
    code: '',
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...held,
  }) as Input;

const MENU = menuChords(
  [
    { submenu: { items: [{ role: 'close' }, { role: 'undo' }, { role: 'reload' }] } },
    { role: 'appMenu', submenu: { items: [{ role: 'quit' }, { role: 'hide' }, { label: 'Check for Updates…' }] } },
  ] as never,
  true,
);

const WINDOW = tableOf({
  chords: ['Cmd+W', 'Cmd+Z', 'Cmd+K', 'Cmd+R', 'Shift+Cmd+T', 'Escape', 'Shift+A', 'Alt+Space'],
  claimed: ['Cmd+W', 'Cmd+Z', 'Cmd+K', 'Shift+Cmd+T'],
  framed: [{ chord: 'Cmd+Equal', frame: 'http://127.0.0.1:5634/a/0123456789ab/v/1' }],
  global: [],
});

const press = (held: Partial<Input>, frame: string | null = null) => {
  const chord = chordOfInput(input(held), true);
  return chord === null ? null : intercepted(chord, frame, WINDOW, MENU);
};

test('a claimed chord that the menu holds is cancelled for the page, and a published one nobody claims or the menu leaves alone is not', () => {
  expect(press({ key: 'w', code: 'KeyW', meta: true })).toEqual({ chord: 'Cmd+W', page: null, frame: null, global: false });
  expect(press({ key: 't', code: 'KeyT', meta: true, shift: true })).toEqual({
    chord: 'Shift+Cmd+T',
    page: null,
    frame: null,
    global: false,
  });
  expect(press({ key: 'r', code: 'KeyR', meta: true })).toBeNull();
  expect(press({ key: 'k', code: 'KeyK', meta: true })).toBeNull();
  expect(press({ key: 'q', code: 'KeyQ', meta: true })).toBeNull();
  expect(press({ key: 'Escape', code: 'Escape' })).toBeNull();
});

test('a press is read by the layout the way the platform matcher reads it, including a non-Latin layout under ⌘', () => {
  const reads: [Partial<Input>, string | null][] = [
    [{ key: 'я', code: 'KeyZ', meta: true }, 'Cmd+Z'],
    [{ key: 'z', code: 'KeyW', meta: true }, 'Cmd+Z'],
    [{ key: 'Dead', code: 'KeyI', meta: true, alt: true }, 'Alt+Cmd+I'],
    [{ key: 'Meta', code: 'MetaLeft', meta: true }, null],
  ];
  expect(reads.map(([held]) => chordOfInput(input(held), true))).toEqual(reads.map(([, chord]) => chord));
  expect(press({ key: 'я', code: 'KeyZ', meta: true })).toMatchObject({ chord: 'Cmd+Z' });
});

test('a frame forwards only the chords declared for its address', () => {
  const page = 'http://127.0.0.1:5634/a/0123456789ab/v/1#totals';
  expect(press({ key: '=', code: 'Equal', meta: true }, page)).toEqual({ chord: 'Cmd+Equal', page: null, frame: page, global: false });
  expect(press({ key: 'k', code: 'KeyK', meta: true }, page)).toBeNull();
  expect(press({ key: '=', code: 'Equal', meta: true }, 'http://127.0.0.1:5635/views/board/')).toBeNull();
});

test('the menu holds its role chords per platform, and the shell keeps only those that act on the application', () => {
  expect(MENU.has('Cmd+W') && MENU.has('Cmd+Q') && MENU.has('Cmd+Z') && MENU.has('Shift+Cmd+T')).toBe(true);
  expect(menuChords([{ role: 'close' }, { role: 'hide' }] as never, false)).toEqual(new Set(['Ctrl+W']));

  const kept = keptMenuChords(true);
  expect(kept).toEqual(expect.arrayContaining(['Cmd+Q', 'Cmd+H', 'Alt+Cmd+H', 'Cmd+M']));
  expect(kept).not.toContain('Cmd+W');
  expect(kept).not.toContain('Cmd+R');
  expect(kept).not.toContain('Cmd+C');
  expect(keptMenuChords(false)).not.toContain('Cmd+H');

  expect(keptChords('darwin')).toEqual(expect.arrayContaining(['Cmd+Q', 'Cmd+N', 'F12', 'Alt+Cmd+I']));
  expect(keptChords('linux')).toEqual(expect.arrayContaining(['Ctrl+N', 'Ctrl+Shift+I', 'F11']));
  expect(keptChords('win32')).not.toContain('Cmd+N');
});
