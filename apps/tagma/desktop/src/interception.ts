import type { KeyPress, WindowKeys } from './bridge.js';

export type Table = {
  readonly chords: ReadonlySet<string>;
  readonly claimed: ReadonlySet<string>;
  readonly framed: WindowKeys['framed'];
  readonly served: ReadonlySet<string>;
};

export const tableOf = (keys: WindowKeys): Table => ({
  chords: new Set(keys.chords),
  claimed: new Set(keys.claimed),
  framed: keys.framed,
  served: new Set(keys.served),
});

const carries = (chord: string): boolean =>
  chord
    .split('+')
    .slice(0, -1)
    .some((part) => part === 'Cmd' || part === 'Ctrl' || part === 'Alt');

const originOf = (url: string): string | null => (URL.canParse(url) ? new URL(url).origin : null);

export function intercepted(chord: string, frame: string | null, table: Table, menu: ReadonlySet<string>): KeyPress | null {
  if (frame === null) {
    return table.claimed.has(chord) && menu.has(chord) ? { chord, page: null, frame: null, global: false } : null;
  }
  const origin = originOf(frame);
  const forwarded =
    (origin !== null && table.served.has(origin) && table.chords.has(chord) && carries(chord)) ||
    table.framed.some((held) => held.chord === chord && frame.startsWith(held.frame));
  return forwarded ? { chord, page: null, frame, global: false } : null;
}
