import { Effect } from 'effect';
import { attempt } from './attempt';
import type { ThreadResourceRow, ThreadResourceStorage } from '../resources';
import type { MemoryStorageInput } from './state';
import type { MemoryTx } from './units';

export function makeMemoryResources({ memory }: MemoryStorageInput): ThreadResourceStorage<MemoryTx> {
  const ordered = (tx: MemoryTx | undefined, keep: (row: ThreadResourceRow) => boolean): readonly ThreadResourceRow[] =>
    memory.read(tx, () =>
      [...memory.resources.values()].filter(keep).sort((left, right) => compare(left.kind, right.kind) || compare(left.id, right.id)),
    );
  return {
    hold: (values, tx) =>
      memory.units
        .commit(
          (unit) =>
            attempt('hold', () => {
              const key = keyOf(values.kind, values.id);
              const standing = memory.resources.get(key);
              const row: ThreadResourceRow = standing
                ? { ...standing, threadId: values.threadId }
                : { id: values.id, kind: values.kind, threadId: values.threadId, heldAt: unit.now() };
              unit.put(memory.resources, key, row);
              return row;
            }),
          tx,
        )
        .pipe(Effect.withSpan('MemoryResources.hold')),
    release: (kind, ids, tx) =>
      memory.units
        .commit(
          (unit) =>
            attempt('release', () => {
              let released = 0;
              for (const id of ids) {
                const key = keyOf(kind, id);
                if (!memory.resources.has(key)) continue;
                unit.remove(memory.resources, key);
                released += 1;
              }
              return released;
            }),
          tx,
        )
        .pipe(Effect.withSpan('MemoryResources.release')),
    held: (threadIds, tx) =>
      attempt('held', () => ordered(tx, (row) => row.threadId !== null && threadIds.includes(row.threadId))).pipe(
        Effect.withSpan('MemoryResources.held'),
      ),
    detached: (tx) =>
      attempt('detached', () => ordered(tx, (row) => row.threadId === null)).pipe(Effect.withSpan('MemoryResources.detached')),
  };
}

function keyOf(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
