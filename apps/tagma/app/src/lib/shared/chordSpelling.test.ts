import { describe, expect, test } from 'vitest';
import { chordKeys, spellChord } from './chordSpelling.js';

describe('a spelled chord splits into one badge per key on every platform', () => {
  test.each([
    [{ key: 'e', meta: true, ctrl: false, alt: false, shift: true }, true, ['⇧', '⌘', 'E']],
    [{ key: 'e', meta: false, ctrl: true, alt: false, shift: true }, false, ['Ctrl', 'Shift', 'E']],
    [{ key: 'Enter', meta: true, ctrl: false, alt: false, shift: false }, true, ['⌘', '↩']],
    [{ key: 'Escape', meta: false, ctrl: false, alt: false, shift: false }, false, ['Esc']],
    [{ key: 'ArrowLeft', meta: false, ctrl: false, alt: true, shift: false }, false, ['Alt', '←']],
  ])('%o on mac=%s', (chord, mac, keys) => {
    expect(chordKeys(spellChord(chord, mac))).toEqual(keys);
  });

  test('a key word after a modifier stays one key', () => {
    expect(chordKeys('⌥click')).toEqual(['⌥', 'click']);
    expect(chordKeys('Alt+click')).toEqual(['Alt', 'click']);
  });
});
