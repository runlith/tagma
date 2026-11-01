import { Context, Deferred, Effect, Layer, type Scope } from 'effect';
import type { ThreadEventRecord } from '../events';
import type { ThreadStore, ThreadTransitions, ThreadWriteTx } from '../ThreadPorts';
import { ThreadChangeCollector } from '../transition/port';
import type { ThreadChangePart, ThreadChangeRevision, ThreadMetadataChange, ThreadRunChange, ThreadStateChange } from '../state';

export class ThreadChanges extends Context.Service<
  ThreadChanges,
  {
    watch(threadIds: readonly string[]): Effect.Effect<Effect.Effect<readonly string[]>, never, Scope.Scope>;
    publish(threadId: string): Effect.Effect<void>;
    deliver(change: ThreadStateChange): Effect.Effect<void>;
    project(projector: (change: ThreadStateChange) => Effect.Effect<void>): void;
    claim(threadId: string, unit: object): void;
    claimed(threadId: string, unit: object): boolean;
    note(threadId: string, unit: object, part: ThreadChangePart): void;
    settle(threadId: string, unit: object, revision: ThreadChangeRevision | undefined): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadChanges') {}

type ChangeOwners = {
  readonly store: ThreadStore['Service'];
  readonly transitions: ThreadTransitions['Service'];
  readonly changes: ThreadChanges['Service'];
};

export const changeUnit = Effect.fnUntraced(function* <A, E>(
  { store, transitions, changes }: ChangeOwners,
  threadIds: readonly string[],
  identity: string,
  work: (unit: ThreadWriteTx) => Effect.Effect<A, E>,
) {
  const write = Effect.fnUntraced(function* (unit: ThreadWriteTx) {
    yield* transitions.opened(threadIds, unit);
    for (const threadId of threadIds) changes.claim(threadId, unit);
    const result = yield* work(unit);
    yield* transitions.revised(threadIds, unit, (revisions) =>
      Effect.forEach(
        threadIds,
        (threadId) => {
          const revision = revisions.get(threadId);
          return revision === undefined ? Effect.void : changes.settle(threadId, unit, revision);
        },
        { discard: true },
      ),
    );
    return result;
  });
  if (store.program !== undefined) {
    const result = yield* store.program(identity, write);
    if (result !== null) return result;
  }
  return yield* store.transaction(write);
});

type Subscription = { readonly moved: Set<string>; wake: Deferred.Deferred<void> | null };

type Collected = {
  from: number | null;
  readonly records: ThreadEventRecord[];
  thread: ThreadMetadataChange;
  readonly runs: Map<string, ThreadRunChange>;
  unseen: boolean;
};

export const threadChangesLayer = Layer.effectContext(
  Effect.sync(() => {
    const changes = makeThreadChanges();
    return Context.make(ThreadChanges, changes).pipe(Context.add(ThreadChangeCollector, changes));
  }),
);

const makeThreadChanges = (): ThreadChanges['Service'] => {
  const subscribed = new Map<string, Set<Subscription>>();
  let projector: ((change: ThreadStateChange) => Effect.Effect<void>) | null = null;
  const units = new WeakMap<object, Map<string, Collected>>();
  const collected = (threadId: string, unit: object): Collected | undefined => units.get(unit)?.get(threadId);
  const deliver = (change: ThreadStateChange): Effect.Effect<void> =>
    Effect.suspend(() => (projector === null ? Effect.void : projector(change)));

  const drain = Effect.fnUntraced(function* (subscription: Subscription): Effect.fn.Return<readonly string[]> {
    const wake = yield* Deferred.make<void>();
    if (subscription.moved.size === 0) {
      subscription.wake = wake;
      yield* Deferred.await(wake);
    }
    const moved = [...subscription.moved];
    subscription.moved.clear();
    return moved;
  });

  return ThreadChanges.of({
    watch: (threadIds) =>
      Effect.map(
        Effect.acquireRelease(
          Effect.sync(() => {
            const subscription: Subscription = { moved: new Set(), wake: null };
            for (const id of new Set(threadIds)) {
              const standing = subscribed.get(id);
              if (standing) standing.add(subscription);
              else subscribed.set(id, new Set([subscription]));
            }
            return subscription;
          }),
          (subscription) =>
            Effect.sync(() => {
              for (const id of new Set(threadIds)) {
                const standing = subscribed.get(id);
                standing?.delete(subscription);
                if (standing?.size === 0) subscribed.delete(id);
              }
            }),
        ),
        drain,
      ),
    publish: (threadId) =>
      Effect.suspend(() =>
        Effect.forEach(
          [...(subscribed.get(threadId) ?? [])],
          (subscription) => {
            subscription.moved.add(threadId);
            const wake = subscription.wake;
            subscription.wake = null;
            return wake === null ? Effect.void : Deferred.succeed(wake, undefined);
          },
          { discard: true },
        ),
      ),
    deliver,
    project: (next) => {
      projector = next;
    },
    claim: (threadId, unit) => {
      const held = units.get(unit) ?? new Map<string, Collected>();
      units.set(unit, held);
      if (!held.has(threadId)) held.set(threadId, { from: null, records: [], thread: {}, runs: new Map(), unseen: false });
    },
    claimed: (threadId, unit) => collected(threadId, unit) !== undefined,
    note: (threadId, unit, part) => {
      const held = collected(threadId, unit);
      if (held === undefined) return;
      if (part.kind === 'unseen') held.unseen = true;
      else if (part.kind === 'run') held.runs.set(part.run.id, { ...held.runs.get(part.run.id), ...part.run });
      else {
        if (held.from === null) held.from = part.from;
        else if (part.from !== held.from + held.records.length) held.unseen = true;
        held.records.push(...part.records);
        held.thread = { ...held.thread, ...part.thread };
      }
    },
    settle: (threadId, unit, revision) =>
      Effect.suspend(() => {
        const held = collected(threadId, unit);
        units.get(unit)?.delete(threadId);
        if (held === undefined) return Effect.void;
        if (revision === undefined || held.unseen) return deliver({ kind: 'moved', threadId });
        const runs = [...held.runs.values()];
        return deliver(
          held.from === null
            ? { kind: 'ran', threadId, revision, runs }
            : { kind: 'appended', threadId, revision, from: held.from, records: held.records, thread: held.thread, runs },
        );
      }),
  });
};
