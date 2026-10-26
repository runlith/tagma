import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Data, Effect, Layer, type Scope } from 'effect';
import { ThreadStore, type ThreadTx, type ThreadWriteTx } from '../ThreadPorts';
import type { ThreadAggregateStorage } from '../storage/aggregate';
import { DeclaredResources, type ResourcesConfig } from '../../resources/ResourcesConfig';
import { resourceLedgerLayer } from '../../resources/threadResourceLedger';
import type { ThreadResourceStorage } from '../storage/resources';
import type { ThreadStorageHarness } from './storagePort';
export type ThreadResourceLedgerHarness<TTx, TWrite extends TTx = TTx> = ThreadStorageHarness<TTx, TWrite> & {
  readonly resources: ThreadResourceStorage<TTx, TWrite>;
};
export type ThreadResourceLedgerFactory<TTx, TWrite extends TTx = TTx, R = never> = () => Effect.Effect<
  ThreadResourceLedgerHarness<TTx, TWrite>,
  unknown,
  Scope.Scope | R
>;
const OWNER = 'owner';
const SCOPE = 'scope-a';
class UnitRefused extends Data.TaggedError('ThreadResourceLedgerUnitRefused')<Record<string, never>> {}
export function resourceLedgerPorts<TTx, TWrite extends TTx>(
  storage: ThreadAggregateStorage<TTx, TWrite>,
  resources: ResourcesConfig<TTx, TWrite>,
) {
  const kernel = { storage, resources } as unknown as {
    readonly storage: ThreadAggregateStorage<ThreadTx, ThreadWriteTx>;
    readonly resources: ResourcesConfig<ThreadTx, ThreadWriteTx>;
  };
  return Layer.merge(
    Layer.succeed(ThreadStore, kernel.storage),
    resourceLedgerLayer.pipe(Layer.provide(Layer.succeed(DeclaredResources, kernel.resources))),
  );
}
export function describeThreadResourceLedgerPort<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadResourceLedgerFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: thread resource ledger port`, () => {
    test(
      'a thing held twice is one row, and its holder is the thread that holds it now',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const first = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const second = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const races = yield* Effect.all(
          Array.from({ length: 2 }, () => harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: first.id })),
          { concurrency: 'unbounded' },
        );
        for (const row of races) expect(row).toEqual(expect.objectContaining({ kind: 'scratch', id: 'dir-1', threadId: first.id }));
        expect(yield* ids(harness, first.id)).toEqual([['scratch', 'dir-1']]);
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: second.id });
        expect(yield* ids(harness, first.id)).toEqual([]);
        expect(yield* ids(harness, second.id)).toEqual([['scratch', 'dir-1']]);
      }),
    );
    test(
      'held answers this thread`s rows in a stable order, and no other thread`s',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: thread.id });
        yield* harness.resources.hold({ kind: 'rollout', id: 'file-1', threadId: thread.id });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-2', threadId: other.id });
        yield* harness.resources.hold({ kind: 'toolOutputs', id: 'dir-1', threadId: thread.id });
        expect(yield* ids(harness, thread.id)).toEqual([
          ['rollout', 'file-1'],
          ['scratch', 'dir-1'],
          ['toolOutputs', 'dir-1'],
        ]);
        expect(yield* ids(harness, other.id)).toEqual([['scratch', 'dir-2']]);
        expect(yield* ids(harness, 'no-such-thread')).toEqual([]);
      }),
    );
    test(
      'a release answers how many of its rows were there, and releasing what is gone changes nothing',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: thread.id });
        yield* harness.resources.hold({ kind: 'rollout', id: 'file-1', threadId: thread.id });
        expect(yield* harness.resources.release('scratch', ['dir-1', 'file-1'])).toBe(1);
        expect(yield* harness.resources.release('scratch', ['dir-1'])).toBe(0);
        expect(yield* ids(harness, thread.id)).toEqual([['rollout', 'file-1']]);
      }),
    );
    test(
      'a release written inside a unit that rolls back leaves the row standing',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: thread.id });
        const failed = yield* Effect.flip(
          harness.aggregate.transaction((tx) =>
            Effect.andThen(harness.resources.release('scratch', ['dir-1'], tx), Effect.fail(new UnitRefused({}))),
          ),
        );
        expect(failed).toBeInstanceOf(UnitRefused);
        expect(yield* ids(harness, thread.id)).toEqual([['scratch', 'dir-1']]);
        yield* harness.aggregate.transaction((tx) => harness.resources.release('scratch', ['dir-1'], tx));
        expect(yield* ids(harness, thread.id)).toEqual([]);
      }),
    );
    test(
      'a hold written inside a unit is visible to the walk that reads in the same unit',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const walked = yield* harness.aggregate.transaction((tx) =>
          Effect.andThen(
            harness.resources.hold({ kind: 'rollout', id: 'file-1', threadId: thread.id }, tx),
            harness.resources.held([thread.id], tx),
          ),
        );
        expect(walked.map((row) => row.id)).toEqual(['file-1']);
      }),
    );
    test(
      'a deleted thread leaves its rows detached until they are released',
      Effect.fnUntraced(function* () {
        const harness = yield* open();
        const thread = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        const other = yield* harness.createThread({ ownerId: OWNER, scope: SCOPE });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-1', threadId: thread.id });
        yield* harness.resources.hold({ kind: 'rollout', id: 'file-1', threadId: thread.id });
        yield* harness.resources.hold({ kind: 'scratch', id: 'dir-2', threadId: other.id });
        yield* harness.aggregate.transaction((tx) => harness.aggregate.delete([thread.id], tx));
        const detached = yield* harness.resources.detached();
        expect(detached.map((row) => [row.kind, row.id, row.threadId])).toEqual([
          ['rollout', 'file-1', null],
          ['scratch', 'dir-1', null],
        ]);
        yield* harness.resources.release('scratch', ['dir-1']);
        expect((yield* harness.resources.detached()).map((row) => row.id)).toEqual(['file-1']);
        expect(yield* ids(harness, other.id)).toEqual([['scratch', 'dir-2']]);
      }),
    );
  });
}
const ids = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  harness: ThreadResourceLedgerHarness<TTx, TWrite>,
  threadId: string,
) {
  const rows = yield* harness.resources.held([threadId]);
  return rows.map((row) => [row.kind, row.id] as const);
});
