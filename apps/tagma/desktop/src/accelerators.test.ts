import { chordId, hostChordOf } from '@tagma/server/platform/contract/wire/chord';
import { expect, test } from 'bun:test';
import { acceleratorOf, chordsOfAccelerator } from './accelerators.js';

const NAMED = ['Mod+Backslash', 'Ctrl+F5', 'Mod+Alt+ArrowUp', 'Mod+Shift+Backquote', 'Alt+Space', 'Mod+Enter', 'Mod+Escape'];

test('every chord key reaches Electron by the accelerator name it reads, and that name reads back as the same chord', () => {
  for (const mac of [true, false]) {
    for (const text of NAMED) {
      const chord = hostChordOf(text, mac)!;
      expect(chordsOfAccelerator(acceleratorOf(chord, mac), mac).map(chordId)).toEqual([chordId(chord)]);
    }
  }
  expect(NAMED.map((text) => acceleratorOf(hostChordOf(text, true)!, true)).slice(0, 3)).toEqual([
    'Command+\\',
    'Control+F5',
    'Alt+Command+Up',
  ]);
  expect(acceleratorOf(hostChordOf('Cmd+Alt+ArrowUp', false)!, false)).toBe('Alt+Super+Up');
});
