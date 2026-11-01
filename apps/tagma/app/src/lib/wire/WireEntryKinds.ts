import { coreKind, makeThreadEntryReader, type ThreadEntryKind, type ThreadEntryReader } from '@runlith/agent/transcript/kinds';
import { Point } from '@runlith/layer/Point';

export const WireEntryKinds = Point.define<ThreadEntryKind>()('WireEntryKinds', {
  tier: 'app',
  key: (kind) => kind.type,
  admits: (kind) => (coreKind(kind.type) ? 'the agent core reads this kind itself' : null),
});

export const wireEntries = (kinds: Point<ThreadEntryKind> | undefined): ThreadEntryReader =>
  makeThreadEntryReader({ products: kinds === undefined ? [] : () => kinds.items });
