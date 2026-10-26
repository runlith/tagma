import { open } from 'node:fs/promises';
import { Clock, Data, Effect } from 'effect';
import { and, eq } from 'drizzle-orm';
import { decodeThreadEventPayload } from '@runlith/agent/thread/events';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { conversationWrites, threadEvent, threadRolloutCursor, threadRolloutRefusal } from '../store/journal.js';
import { eachLineAfter, fileSize, readRolloutLine, rolloutEventOf } from './rolloutFile.js';
import type { ThreadProjectionRefusalReason } from '../contract/wire/projection.js';
import { conversationCarried, speaks, type IndexedEvent } from './conversationIndex.js';
import { layersOf } from './base.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';

export class ThreadProjectionRefused extends Data.TaggedError('ThreadProjectionRefused')<{
  readonly reason: ThreadProjectionRefusalReason;
  readonly threadId: string;
  readonly message: string;
}> {}

export type RolloutRefusalRow = typeof threadRolloutRefusal.$inferSelect;

export type ProjectionRun = {
  readonly projected: number;
  readonly byteOffset: number;
  readonly position: number;
};

async function endsARecord(path: string, offset: number, size: number, observe: ReadRollout): Promise<boolean> {
  if (offset === 0) return true;
  if (offset > size) return false;
  const handle = await open(path, 'r');
  try {
    const byte = Buffer.alloc(1);
    const { bytesRead } = await handle.read(byte, 0, 1, offset - 1);
    observe({ path, bytes: bytesRead });
    return bytesRead === 1 && byte[0] === 0x0a;
  } finally {
    await handle.close();
  }
}

const PORTION_MS = 25;

export type ThreadProjection = Effect.Success<typeof makeThreadProjection>;

export const makeThreadProjection = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const kinds = yield* ThreadEntryKinds;

  const pass = Effect.fnUntraced(function* (threadId: string, path: string, unit: WriteUnit<'machine'>) {
    const observe = yield* RolloutReads;
    const held = yield* unit.run(db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, threadId)).get());
    const size = (yield* Effect.tryPromise({ try: () => fileSize(path), catch: (error) => error })) ?? 0;
    const standing =
      held !== undefined &&
      (yield* Effect.tryPromise({ try: () => endsARecord(path, held.nextByteOffset, size, observe), catch: (error) => error }));
    const from = standing ? held.nextByteOffset : 0;
    let position = standing ? held.nextPosition : 1;
    let projected = 0;
    let byteOffset = from;
    const firstPosition = position;
    const spoken: IndexedEvent[] = [];
    const layers = (yield* layersOf(db, unit, threadId)).filter((layer) => layer.afterPosition < layer.throughPosition);
    const past = (expected: number, filed: number): number => {
      let at = expected;
      for (let layer = layers.find((one) => one.afterPosition < at && at <= one.throughPosition); layer !== undefined && at < filed;) {
        at = layer.throughPosition + 1;
        layer = layers.find((one) => one.afterPosition < at && at <= one.throughPosition);
      }
      return at;
    };
    const covered = (at: number): boolean => layers.some((layer) => layer.afterPosition < at && at <= layer.throughPosition);
    const started = performance.now();
    let cut = false;
    let handled = 0;
    yield* eachLineAfter(path, from, ({ line: row, end }) =>
      Effect.gen(function* () {
        if (handled > 0 && performance.now() - started >= PORTION_MS) {
          cut = true;
          return true;
        }
        handled += 1;
        byteOffset = end;
        if (row === '') return;
        const read = readRolloutLine(row);
        if ('failure' in read) {
          return yield* Effect.fail(
            new ThreadProjectionRefused({ reason: 'corrupt', threadId, message: `a whole line after byte ${from} ${read.failure}` }),
          );
        }
        if (read.record.kind !== 'event') return;
        const fact = rolloutEventOf(read.record);
        if (fact === null) {
          return yield* Effect.fail(
            new ThreadProjectionRefused({
              reason: 'corrupt',
              threadId,
              message: `an event record after byte ${from} carries no position, id, kind and payload`,
            }),
          );
        }
        if (fact.position !== position) position = past(position, fact.position);
        if (fact.position !== position) {
          return yield* Effect.fail(
            new ThreadProjectionRefused({
              reason: 'out-of-order',
              threadId,
              message: `the rollout carries position ${fact.position} where ${position} was expected`,
            }),
          );
        }
        if (fact.payload.bodyInFold === true) {
          return yield* Effect.fail(
            new ThreadProjectionRefused({
              reason: 'corrupt',
              threadId,
              message: `the event at position ${fact.position} carries a folded body instead of a whole rollout fact`,
            }),
          );
        }
        if (covered(fact.position)) {
          position += 1;
          return;
        }
        const standing = yield* unit.run(
          db
            .select({ id: threadEvent.id })
            .from(threadEvent)
            .where(and(eq(threadEvent.threadId, threadId), eq(threadEvent.position, fact.position)))
            .get(),
        );
        if (standing !== undefined) {
          if (standing.id !== fact.id) {
            return yield* Effect.fail(
              new ThreadProjectionRefused({
                reason: 'conflict',
                threadId,
                message: `position ${fact.position} holds ${standing.id} in the rows and ${fact.id} in the file`,
              }),
            );
          }
        } else {
          const payload = yield* Effect.try({
            try: () => decodeThreadEventPayload(kinds, fact.payload),
            catch: (error) =>
              new ThreadProjectionRefused({
                reason: 'corrupt',
                threadId,
                message: `the event at position ${fact.position} carries a payload this log cannot read: ${error instanceof Error ? error.message : String(error)}`,
              }),
          });
          yield* unit.run(
            db.insert(threadEvent).values({
              threadId,
              position: fact.position,
              id: fact.id,
              kind: fact.kind,
              payload,
            }),
          );
          projected += 1;
        }
        if (speaks(fact.payload)) spoken.push({ position: fact.position, payload: fact.payload });
        position += 1;
      }),
    );

    if (position > firstPosition) yield* conversationCarried(db, unit, threadId, firstPosition - 1, position - 1, spoken);

    yield* unit.run(db.delete(threadRolloutRefusal).where(eq(threadRolloutRefusal.threadId, threadId)));

    if (standing && byteOffset === from) return { projected: 0, byteOffset: from, position, cut };

    yield* unit.run(
      db
        .insert(threadRolloutCursor)
        .values({ threadId, nextByteOffset: byteOffset, nextPosition: position })
        .onConflictDoUpdate({
          target: threadRolloutCursor.threadId,
          set: { nextByteOffset: byteOffset, nextPosition: position },
        }),
    );
    return { projected, byteOffset, position, cut };
  });

  return {
    run: Effect.fnUntraced(function* (
      input: { readonly threadId: string; readonly path: string },
      held?: typeof threadRolloutCursor.$inferSelect,
    ) {
      const failed = (cause: unknown): ThreadProjectionRefused =>
        cause instanceof ThreadProjectionRefused
          ? cause
          : new ThreadProjectionRefused({
              reason: 'io',
              threadId: input.threadId,
              message: cause instanceof Error ? cause.message : String(cause),
            });
      const observe = yield* RolloutReads;
      const size = yield* Effect.tryPromise({ try: () => fileSize(input.path), catch: failed });
      if (size === null) return { projected: 0, byteOffset: 0, position: 1 };
      const cursor =
        held ??
        (yield* units
          .read((unit) => unit.run(db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, input.threadId)).get()))
          .pipe(Effect.mapError(failed)));
      if (
        cursor !== undefined &&
        cursor.nextByteOffset === size &&
        (yield* Effect.tryPromise({ try: () => endsARecord(input.path, size, size, observe), catch: failed }))
      ) {
        return { projected: 0, byteOffset: size, position: cursor.nextPosition };
      }
      let projected = 0;
      while (true) {
        const portion = yield* units
          .write(writes('ThreadProjection.run', [threadEvent, threadRolloutCursor, threadRolloutRefusal], conversationWrites), (unit) =>
            pass(input.threadId, input.path, unit),
          )
          .pipe(Effect.mapError(failed));
        projected += portion.projected;
        if (!portion.cut) return { projected, byteOffset: portion.byteOffset, position: portion.position };
      }
    }),
    record: Effect.fnUntraced(function* (failure: ThreadProjectionRefused) {
      const seenAt = new Date(yield* Clock.currentTimeMillis);
      yield* units.write(writes('ThreadProjection.record', [threadRolloutRefusal]), (unit) =>
        Effect.gen(function* () {
          const held = yield* unit.run(
            db.select().from(threadRolloutCursor).where(eq(threadRolloutCursor.threadId, failure.threadId)).get(),
          );
          const stood = {
            reason: failure.reason,
            message: failure.message,
            nextByteOffset: held?.nextByteOffset ?? 0,
            nextPosition: held?.nextPosition ?? 1,
            seenAt,
          };
          yield* unit.run(
            db
              .insert(threadRolloutRefusal)
              .values({ threadId: failure.threadId, ...stood })
              .onConflictDoUpdate({ target: threadRolloutRefusal.threadId, set: stood }),
          );
        }),
      );
    }),
    refusal: (threadId: string) =>
      units.read((unit) => unit.run(db.select().from(threadRolloutRefusal).where(eq(threadRolloutRefusal.threadId, threadId)).get())),
  };
});
