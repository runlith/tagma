import { Deferred, Effect } from 'effect';
import type { ThreadInboxItem } from '../../storage/inbox';
import { ThreadInbox, type ThreadWriteTx } from '../../ThreadPorts';
import { MemoryTx } from '../../storage/memory/units';
import { ThreadStorageFailed } from '../../persisted';

export function inboxFixture() {
  const items = new Map<string, ThreadInboxItem>();
  const gates = new Map<string, { entered: Deferred.Deferred<void>; release: Deferred.Deferred<void> }>();
  const faults: { put: Error | null } = { put: null };
  const unread = () => Effect.die(new Error('This test does not use this inbox operation.'));
  const putIn = (item: ThreadInboxItem, tx: ThreadWriteTx | undefined) =>
    Effect.suspend(() => {
      if (tx === undefined)
        return Effect.sync(() => {
          items.set(item.id, item);
        });
      if (tx instanceof MemoryTx) return Effect.sync(() => tx.put(items, item.id, item));
      return Effect.fail(new ThreadStorageFailed({ call: 'put', cause: new Error('This inbox uses memory write units.') }));
    });
  const inbox = ThreadInbox.of({
    put: Effect.fnUntraced(function* (values, tx) {
      const gate = gates.get(values.id);
      if (gate) {
        yield* Deferred.succeed(gate.entered, undefined);
        yield* Deferred.await(gate.release);
      }
      if (faults.put) return yield* new ThreadStorageFailed({ call: 'put', cause: faults.put });
      const standing = items.get(values.id);
      if (standing) return { item: standing, fresh: false };
      const item: ThreadInboxItem = { ...values, state: 'queued', deliveredToRunId: null };
      yield* putIn(item, tx);
      return { item, fresh: true };
    }),
    pending: (id) =>
      Effect.sync(() =>
        [...items.values()]
          .filter((item) => item.threadId === id && item.state !== 'acknowledged')
          .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
      ),
    receipt: (id) => Effect.sync(() => items.get(id)),
    deliver: Effect.fnUntraced(function* (ids, runId, tx) {
      for (const id of ids) {
        const item = items.get(id);
        if (item) yield* putIn({ ...item, state: 'delivered', deliveredToRunId: runId }, tx);
      }
    }),
    returnTo: Effect.fnUntraced(function* (runId, tx) {
      const returned: string[] = [];
      for (const [id, item] of items) {
        if (item.state !== 'delivered' || item.deliveredToRunId !== runId) continue;
        yield* putIn({ ...item, state: 'queued', deliveredToRunId: null }, tx);
        returned.push(id);
      }
      return returned;
    }),
    acknowledge: Effect.fnUntraced(function* (ids, runId, tx) {
      for (const id of ids) {
        const item = items.get(id);
        if (item) yield* putIn({ ...item, state: 'acknowledged', deliveredToRunId: runId ?? item.deliveredToRunId }, tx);
      }
    }),
    fated: unread,
    pendingOf: unread,
    arrivals: unread,
    delivered: unread,
    unconfirmed: unread,
    intendWake: unread,
    pendingWakes: unread,
    woke: unread,
    openRequests: unread,
    openRequestsUnder: unread,
    closeRequests: unread,
    control: unread,
  });
  const hold = Effect.fnUntraced(function* (id: string) {
    const gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
    gates.set(id, gate);
    return gate;
  });
  return { inbox, faults, hold };
}
