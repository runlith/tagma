import type { KeyPress, WindowKeys } from './bridge.js';

export type Table = {
  readonly chords: ReadonlySet<string>;
  readonly claimed: ReadonlySet<string>;
  readonly framed: WindowKeys['framed'];
};

export const tableOf = (keys: WindowKeys): Table => ({
  chords: new Set(keys.chords),
  claimed: new Set(keys.claimed),
  framed: keys.framed,
});

export function intercepted(chord: string, frame: string | null, table: Table, menu: ReadonlySet<string>): KeyPress | null {
  if (frame === null) {
    return table.claimed.has(chord) && menu.has(chord) ? { chord, page: null, frame: null, global: false } : null;
  }
  return table.framed.some((held) => held.chord === chord && frame.startsWith(held.frame))
    ? { chord, page: null, frame, global: false }
    : null;
}
