import { coreKind, makeThreadEntryReader, type ThreadEntryKind, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { Point } from '@runlith/layer/Point';

export const WireEntryKinds = Point.define<ThreadEntryKind>()('WireEntryKinds', {
  tier: 'app',
  key: (kind) => kind.type,
  admits: (kind) => (coreKind(kind.type) ? 'the agent core reads this kind itself' : null),
});

const NONE: readonly ThreadEntryKind[] = [];

export function readingOf(kinds: Point<ThreadEntryKind> | undefined): ThreadEntryReader {
  const fixed = makeThreadEntryReader({ products: NONE });
  let standing: readonly ThreadEntryKind[] = NONE;
  let reader = fixed;
  const current = (): ThreadEntryReader => {
    const items = kinds?.items ?? NONE;
    if (items !== standing) {
      standing = items;
      reader = makeThreadEntryReader({ products: items });
    }
    return reader;
  };
  return {
    ...fixed,
    decode: (value) => current().decode(value),
    read: (formed) => current().read(formed),
    readWire: (value) => current().readWire(value),
    writeWire: (entry) => current().writeWire(entry),
  };
}
