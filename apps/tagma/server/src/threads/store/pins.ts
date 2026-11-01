import { and, eq } from 'drizzle-orm';
import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect, Exit } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ThreadPins } from '../contract/service/pins.js';
import { ThreadInputRefused, type HarnessFailure } from '../contract/service/failure.js';
import type { PinnedView } from '../contract/wire/pins.js';

export const threadViewPin = sqliteTable(
  'thread_view_pin',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threadRecord.id, { onDelete: 'cascade' }),
    app: text('app').notNull(),
    view: text('view').notNull(),
    key: text('key').notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.app, table.view, table.key] })],
);

const empty: readonly PinnedView[] = [];
const pinOrder = (left: PinnedView, right: PinnedView): number => {
  for (const field of ['app', 'view', 'key'] as const) {
    if (left[field] < right[field]) return -1;
    if (left[field] > right[field]) return 1;
  }
  return 0;
};

export const makeThreadPins = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const held = new Map<string, readonly PinnedView[]>();
  const subscribers = new Set<(threadId: string) => Effect.Effect<void, HarnessFailure>>();
  const remember = (threadId: string, pins: readonly PinnedView[]) => {
    if (pins.length === 0) held.delete(threadId);
    else held.set(threadId, pins);
  };
  const rows = yield* units.read((unit) =>
    unit.run(
      db
        .select({
          threadId: threadViewPin.threadId,
          app: threadViewPin.app,
          view: threadViewPin.view,
          key: threadViewPin.key,
        })
        .from(threadViewPin)
        .orderBy(threadViewPin.threadId, threadViewPin.app, threadViewPin.view, threadViewPin.key),
    ),
  );
  const grouped = new Map<string, PinnedView[]>();
  for (const { threadId, ...pin } of rows) {
    let pins = grouped.get(threadId);
    if (pins === undefined) grouped.set(threadId, (pins = []));
    pins.push(pin);
  }
  for (const [threadId, pins] of grouped) remember(threadId, pins.sort(pinOrder));
  yield* Effect.acquireRelease(
    Effect.sync(() => records.removalRecorded(({ threadId }) => Effect.sync(() => remember(threadId, empty)))),
    (dispose) =>
      Effect.sync(() => {
        dispose();
        held.clear();
        subscribers.clear();
      }),
  );
  const address = (threadId: string, pin: PinnedView) =>
    and(
      eq(threadViewPin.threadId, threadId),
      eq(threadViewPin.app, pin.app),
      eq(threadViewPin.view, pin.view),
      eq(threadViewPin.key, pin.key),
    );
  const change = (threadId: string, projectId: number, pin: PinnedView, pinned: boolean) =>
    Effect.suspend(() => {
      let publication: Exit.Exit<void, HarnessFailure> = Exit.void;
      return units
        .write(writes(pinned ? 'threads.pin_view' : 'threads.unpin_view', [threadViewPin]), (unit) =>
          Effect.gen(function* () {
            const row = yield* unit.run(
              db.select({ projectId: threadRecord.projectId }).from(threadRecord).where(eq(threadRecord.id, threadId)).get(),
            );
            if (row === undefined)
              return yield* Effect.fail(
                new ThreadInputRefused('not-found', `Thread ${threadId} does not exist.`, ['read the thread list']),
              );
            if (row.projectId !== projectId)
              return yield* Effect.fail(
                new ThreadInputRefused('foreign-project', `Thread ${threadId} belongs to another project.`, [
                  'call in the project that holds the thread',
                ]),
              );
            const changed = pinned
              ? yield* unit.run(
                  db
                    .insert(threadViewPin)
                    .values({ threadId, ...pin })
                    .onConflictDoNothing()
                    .returning({ id: threadViewPin.threadId }),
                )
              : yield* unit.run(db.delete(threadViewPin).where(address(threadId, pin)).returning({ id: threadViewPin.threadId }));
            yield* unit.afterCommit(
              Effect.gen(function* () {
                if (changed.length > 0) {
                  const prior = held.get(threadId) ?? empty;
                  const next = pinned ? [...prior, pin].sort(pinOrder) : prior.filter((one) => pinOrder(one, pin) !== 0);
                  remember(threadId, next);
                }
                publication = yield* Effect.exit(Effect.forEach(subscribers, (subscriber) => subscriber(threadId), { discard: true }));
              }),
            );
            return changed.length > 0;
          }),
        )
        .pipe(Effect.flatMap((changed) => (Exit.isFailure(publication) ? Effect.failCause(publication.cause) : Effect.succeed(changed))));
    });
  return ThreadPins.of({
    read: (threadId, unit) =>
      unit === undefined
        ? Effect.sync(() => held.get(threadId) ?? empty)
        : Effect.map(
            unit.run(
              db
                .select({ app: threadViewPin.app, view: threadViewPin.view, key: threadViewPin.key })
                .from(threadViewPin)
                .where(eq(threadViewPin.threadId, threadId)),
            ),
            (pins) => pins.sort(pinOrder),
          ),
    pin: (threadId, projectId, pin) => change(threadId, projectId, pin, true),
    unpin: (threadId, projectId, pin) => change(threadId, projectId, pin, false),
    changed: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  });
});
