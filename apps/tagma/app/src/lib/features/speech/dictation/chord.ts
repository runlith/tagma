import { keyOfCode, spellChord } from '$lib/shared/chordSpelling.js';

export type Chord = {
  readonly alt: boolean;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly code: string;
};

export const DEFAULT_CHORD = 'Alt+Space';

const MODIFIERS = ['Alt', 'Control', 'Meta', 'Shift'] as const;

export function chordOf(written: string): Chord | null {
  const parts = written
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const code = parts.at(-1);
  if (code === undefined || (MODIFIERS as readonly string[]).includes(code)) return null;
  const mods = parts.slice(0, -1);
  if (mods.some((mod) => !(MODIFIERS as readonly string[]).includes(mod) || mod === 'Shift')) return null;
  return { alt: mods.includes('Alt'), ctrl: mods.includes('Control'), meta: mods.includes('Meta'), code };
}

export function written(event: KeyboardEvent): string | null {
  if ((MODIFIERS as readonly string[]).some((mod) => event.code.startsWith(mod)) || event.code === '') return null;
  const mods = [event.altKey && 'Alt', event.ctrlKey && 'Control', event.metaKey && 'Meta'].filter((mod) => mod !== false);
  return [...mods, event.code].join('+');
}

export const pressed = (chord: Chord, event: KeyboardEvent): boolean =>
  event.code === chord.code && event.altKey === chord.alt && event.ctrlKey === chord.ctrl && event.metaKey === chord.meta;

export const chordLabel = (chord: Chord, isMac: boolean): string =>
  spellChord({ key: keyOfCode(chord.code), meta: chord.meta, ctrl: chord.ctrl, alt: chord.alt, shift: false }, isMac);
