import { coreKind, makeThreadEntryReader, type ThreadEntryKind, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { Point } from '@runlith/layer/Point';
import { Data } from 'effect';

class CoreEntryKindRefused extends Data.TaggedError('CoreEntryKindRefused')<{
  readonly message: string;
  readonly type: string;
}> {}

export const WireEntryKinds = Point.define<ThreadEntryKind>()('WireEntryKinds', {
  tier: 'app',
  key: (kind) => kind.type,
  claims: (kind) => {
    if (coreKind(kind.type)) {
      throw new CoreEntryKindRefused({
        message: `Wire entry kind "${kind.type}" is read by the agent core and cannot be contributed.`,
        type: kind.type,
      });
    }
    return [];
  },
});

export type EntryReading = () => ThreadEntryReader;

const NONE: readonly ThreadEntryKind[] = [];

export function readingOf(kinds: Point<ThreadEntryKind> | undefined): EntryReading {
  let standing: readonly ThreadEntryKind[] | undefined;
  let reader = makeThreadEntryReader({ products: NONE });
  return () => {
    const items = kinds?.items ?? NONE;
    if (items !== standing) {
      standing = items;
      reader = makeThreadEntryReader({ products: items });
    }
    return reader;
  };
}
