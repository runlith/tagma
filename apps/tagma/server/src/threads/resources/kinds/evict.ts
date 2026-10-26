import { Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { ThreadPortFailure } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadResourceRow, ThreadResourceStorage } from '@runlith/agent/thread/storage/resources';
import type { Unit } from '../../../platform/contract/service/units.js';

export type EvictingResourceKind = ThreadResourceKind<Unit<'machine'>> & {
  evict(row: ThreadResourceRow): Effect.Effect<void>;
};

export const evictThreadResources = Effect.fnUntraced(function* (
  ledger: ThreadResourceStorage<Unit<'machine'>>,
  kinds: readonly ThreadResourceKind<Unit<'machine'>>[],
  threadId: string,
): Effect.fn.Return<void, ThreadPortFailure> {
  const evicting = new Map(kinds.filter(evicts).map((kind) => [kind.kind, kind] as const));
  for (const row of yield* ledger.held([threadId])) {
    const kind = evicting.get(row.kind);
    if (kind !== undefined) yield* kind.evict(row);
  }
});

function evicts(kind: ThreadResourceKind<Unit<'machine'>>): kind is EvictingResourceKind {
  return typeof (kind as Partial<EvictingResourceKind>).evict === 'function';
}
