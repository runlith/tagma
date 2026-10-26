import type { Input } from 'electron';
import type { Chord } from '../bridge.js';

export const chordOf = (input: Input): Chord => ({
  code: input.code,
  meta: input.meta,
  ctrl: input.control,
  alt: input.alt,
  shift: input.shift,
});

export const sameChord = (one: Chord, other: Chord): boolean =>
  one.code === other.code && one.meta === other.meta && one.ctrl === other.ctrl && one.alt === other.alt && one.shift === other.shift;
