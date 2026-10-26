import { Effect, Queue, Stream } from 'effect';
import { GuestsUnread, type LiveGuest, type LiveGuests } from '../../executions/contract/service/guests.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { SandboxRecord } from '../contract/wire/sandbox.js';
import type { SandboxStore } from '../store/sandboxes.js';

const guestOf = (record: SandboxRecord, projectId: number): LiveGuest | undefined =>
  record.projectId !== projectId || record.boundThreadId === null || (record.state !== 'preparing' && record.state !== 'prepared')
    ? undefined
    : { guest: record.id, thread: ThreadId.make(record.boundThreadId), startedAt: record.createdAt.getTime() };

const unread = (failure: { readonly message: string }) => new GuestsUnread({ reason: failure.message });

export const liveGuests = (store: SandboxStore): LiveGuests['Service'] => ({
  follow: (projectId) =>
    Stream.callback<readonly LiveGuest[], GuestsUnread>(
      (out) =>
        Effect.gen(function* () {
          const moved = yield* Queue.unbounded<string>();
          yield* Effect.acquireRelease(
            Effect.sync(() => store.watch((id) => void Queue.offerUnsafe(moved, id))),
            (stop) => Effect.sync(stop),
          );
          const held = new Map<string, LiveGuest>();
          const follow = Effect.gen(function* () {
            for (const record of yield* Effect.mapError(store.live(projectId), unread)) {
              const guest = guestOf(record, projectId);
              if (guest !== undefined) held.set(record.id, guest);
            }
            Queue.offerUnsafe(out, [...held.values()]);
            return yield* Effect.forever(
              Effect.gen(function* () {
                const id = yield* Queue.take(moved);
                const record = yield* Effect.mapError(store.byId(id), unread);
                const guest = record === null ? undefined : guestOf(record, projectId);
                if (guest === undefined && !held.delete(id)) return;
                if (guest !== undefined) held.set(id, guest);
                Queue.offerUnsafe(out, [...held.values()]);
              }),
            );
          });
          yield* Effect.forkScoped(follow.pipe(Effect.tapCause((cause) => Queue.failCause(out, cause))));
        }),
      { bufferSize: 1, strategy: 'sliding' },
    ),
});
