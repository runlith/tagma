import { chordId, pressed } from '@tagma/server/platform/contract/wire/chord';
import type { Input } from 'electron';

export const chordOfInput = (input: Input, mac: boolean): string | null => {
  const held = pressed(
    { key: input.key, code: input.code, meta: input.meta, ctrl: input.control, alt: input.alt, shift: input.shift },
    mac,
  );
  return held === null ? null : chordId(held);
};
