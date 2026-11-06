import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { HeldChordText, chordId, parseChord, pressed, writeChord } from './chord.js';

const press = (key: string, code: string, held: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>> = {}) => ({
  key,
  code,
  meta: held.meta ?? false,
  ctrl: held.ctrl ?? false,
  alt: held.alt ?? false,
  shift: held.shift ?? false,
});

describe('chord', () => {
  test('the text form reads back as written and refuses what is no chord', () => {
    const chord = parseChord('Mod+Alt+G');
    expect(chord === null ? null : writeChord(chord)).toBe('Mod+Alt+G');
    expect(parseChord('Mod+g')).toBeNull();
    expect(parseChord('Mod+Mod+G')).toBeNull();
    expect(Schema.decodeUnknownResult(HeldChordText)('Shift+G')._tag).toBe('Failure');
    expect(Schema.decodeUnknownResult(HeldChordText)('F5')._tag).toBe('Success');
  });

  test('a press is named by its Latin key, and by its physical key where the layout gives none', () => {
    const named = (key: string, code: string, held: Parameters<typeof press>[2], mac: boolean) => {
      const chord = pressed(press(key, code, held), mac);
      return chord === null ? null : chordId(chord);
    };
    expect(named('k', 'KeyK', { meta: true }, true)).toBe('Cmd+K');
    expect(named('л', 'KeyK', { meta: true }, true)).toBe('Cmd+K');
    expect(named('a', 'KeyQ', { ctrl: true }, false)).toBe('Ctrl+A');
    expect(named('!', 'Digit1', { meta: true, shift: true }, true)).toBe('Shift+Cmd+1');
    expect(named('ą', 'KeyA', { ctrl: true, alt: true }, false)).toBeNull();
    expect(named('л', 'KeyK', {}, true)).toBeNull();
  });
});
