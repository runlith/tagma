import { createHash } from 'node:crypto';
import { rename, rm, stat } from 'node:fs/promises';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { Clock, Data, Effect, Result } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadRolloutCursor, threadRolloutForm, threadRolloutRefusal, type RolloutPublishing } from '../store/journal.js';
import {
  ThreadEntryKinds,
  ThreadFormRefused,
  type ThreadEntryReader,
  type ThreadFormBase,
  type ThreadFormStep,
} from '@runlith/agent/transcript/kinds';
import { thread, threadRun } from '../store/kernel.js';
import { RolloutUnreadable, rolloutStream } from './rolloutFile.js';
import type { NativeFolds } from './rolloutMeta.js';
import { eventless } from './rolloutStaging.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';
import { compressedRollout, rolloutFiles, rolloutStateOf, transcriptOf } from './rolloutForms.js';
import type { RolloutFiles, TranscriptKey } from '../contract/service/rested.js';

export type StageRollout = NativeFolds['stage'];

async function sha256Of(path: string, read: ReadRollout): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of rolloutStream(path, read)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function cleared(path: string, suffix: string): Promise<void> {
  await rm(`${path}${suffix}`, { force: true });
  await rm(`${compressedRollout(path)}${suffix}`, { force: true });
  await rm(`${transcriptOf(path)}${suffix}`, { force: true });
}

type Basis = {
  readonly form: string | null;
  readonly cursor: number | undefined;
  readonly position: number | undefined;
  readonly refused: number | undefined;
  readonly restedAt: number | null;
  readonly file: string | null;
};

const basisOf = Effect.fnUntraced(function* (db: StoreDb<'machine'>, threadId: string, path: string) {
  const done = yield* rolloutFormOf(db, threadId);
  const cursor = yield* db
    .select({
      bytes: threadRolloutCursor.nextByteOffset,
      position: threadRolloutCursor.nextPosition,
      restedAt: threadRolloutCursor.restedAt,
    })
    .from(threadRolloutCursor)
    .where(eq(threadRolloutCursor.threadId, threadId))
    .get();
  const refused = yield* db
    .select({ bytes: threadRolloutRefusal.nextByteOffset })
    .from(threadRolloutRefusal)
    .where(eq(threadRolloutRefusal.threadId, threadId))
    .get();
  const state = yield* rolloutStateOf(path);
  const file =
    state === null
      ? null
      : yield* Effect.promise(() =>
          stat(state.path).then(
            (standing) => `${state.form}:${standing.size}:${standing.mtimeMs}`,
            () => null,
          ),
        );
  return {
    form: done === undefined ? null : JSON.stringify([done.step, done.refusal, done.publishing?.sha256 ?? null]),
    cursor: cursor?.bytes,
    position: cursor?.position,
    refused: refused?.bytes,
    restedAt: cursor?.restedAt == null ? null : cursor.restedAt.getTime(),
    file,
  } satisfies Basis;
});

const sameBasis = (one: Basis, other: Basis): boolean =>
  one.form === other.form &&
  one.cursor === other.cursor &&
  one.position === other.position &&
  one.refused === other.refused &&
  one.restedAt === other.restedAt &&
  one.file === other.file;

export type RolloutFormWrite = <A, E>(
  operation: WriteSet,
  body: (unit: WriteUnit<'machine'>) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | StoreFailure>;

const FORMING = writes('ThreadRollout.form', [threadRolloutCursor, threadRolloutRefusal, threadRolloutForm, threadRun, thread]);

const steppedWith = (kinds: ThreadEntryReader, steps: readonly ThreadFormStep[]) => (record: 'entry' | 'reading', value: unknown) =>
  Effect.try({
    try: () => kinds.formed(record, value, steps),
    catch: (failure) =>
      failure instanceof ThreadFormRefused ? failure : new ThreadFormRefused({ step: 'unknown', issue: String(failure) }),
  });

export const formStoredIn = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  unit: WriteUnit<'machine'>,
  threadId: string,
  kinds: ThreadEntryReader,
  steps: readonly ThreadFormStep[],
) {
  if (steps.length === 0) return;
  const formed = steppedWith(kinds, steps);
  const runs = yield* unit.run(
    db
      .select({ id: threadRun.id, tail: threadRun.streamTail })
      .from(threadRun)
      .where(and(eq(threadRun.threadId, threadId), isNotNull(threadRun.streamTail))),
  );
  for (const run of runs) {
    const tail: readonly unknown[] = Array.isArray(run.tail) ? run.tail : [];
    const next = yield* Effect.forEach(tail, (entry) => formed('entry', entry));
    if (next.every((entry, at) => entry === tail[at])) continue;
    yield* unit.run(
      db
        .update(threadRun)
        .set({ streamTail: next as typeof threadRun.$inferInsert.streamTail })
        .where(eq(threadRun.id, run.id)),
    );
  }
  const held = yield* unit.run(
    db.select({ reading: thread.contextReading, asking: thread.pendingInteraction }).from(thread).where(eq(thread.id, threadId)).get(),
  );
  if (held === undefined) return;
  const reading = held.reading == null ? held.reading : yield* formed('reading', held.reading);
  const asking = held.asking == null ? held.asking : yield* formed('entry', held.asking);
  if (reading === held.reading && asking === held.asking) return;
  yield* unit.run(
    db
      .update(thread)
      .set({
        contextReading: reading as typeof thread.$inferInsert.contextReading,
        pendingInteraction: asking as typeof thread.$inferInsert.pendingInteraction,
      })
      .where(eq(thread.id, threadId)),
  );
});

export class RolloutUnformable extends Data.TaggedError('RolloutUnformable')<{
  readonly threadId: string;
  readonly path: string;
  readonly reason: string;
  readonly older?: ThreadFormBase;
}> {
  override get message(): string {
    return `The rollout ${this.path} of thread ${this.threadId} cannot be brought to the current entry form: ${this.reason}`;
  }
}

export const olderRollout = (threadId: string, path: string, reached: string | null, base: ThreadFormBase): RolloutUnformable =>
  new RolloutUnformable({
    threadId,
    path,
    reason: `its journal stands at form ${reached ?? '(none)'}, older than ${base.step}, the oldest form this release brings forward`,
    older: base,
  });

export type RolloutForm = { readonly kind: 'formed' } | { readonly kind: 'refused'; readonly refusal: RolloutUnformable };

const FORMED: RolloutForm = { kind: 'formed' };

const heldThread = (db: StoreDb<'machine'>, unit: WriteUnit<'machine'>, threadId: string) =>
  unit.run(db.select({ id: threadRecord.id }).from(threadRecord).where(eq(threadRecord.id, threadId)).get());

export const rolloutFormOf = (db: StoreDb<'machine'>, threadId: string) =>
  db
    .select({ refusal: threadRolloutForm.refusal, publishing: threadRolloutForm.publishing, step: threadRolloutForm.step })
    .from(threadRolloutForm)
    .where(eq(threadRolloutForm.threadId, threadId))
    .get();

const io = (path: string) => (error: unknown) =>
  new RolloutUnreadable({ reason: 'io', path, message: error instanceof Error ? error.message : String(error) });

const settledWith = (db: StoreDb<'machine'>, write: RolloutFormWrite, threadId: string, publishing: RolloutPublishing) =>
  write(
    FORMING,
    Effect.fnUntraced(function* (unit) {
      const standing = yield* unit.run(
        db
          .select({ publishing: threadRolloutForm.publishing })
          .from(threadRolloutForm)
          .where(eq(threadRolloutForm.threadId, threadId))
          .get(),
      );
      if (standing?.publishing?.sha256 !== publishing.sha256) return;
      if (publishing.cursorBytes !== null) {
        yield* unit.run(
          db
            .update(threadRolloutCursor)
            .set({ nextByteOffset: publishing.cursorBytes, generation: sql`${threadRolloutCursor.generation} + 1` })
            .where(eq(threadRolloutCursor.threadId, threadId)),
        );
      }
      if (publishing.refusalBytes !== null) {
        yield* unit.run(
          db
            .update(threadRolloutRefusal)
            .set({ nextByteOffset: publishing.refusalBytes })
            .where(eq(threadRolloutRefusal.threadId, threadId)),
        );
      }
      yield* unit.run(db.update(threadRolloutForm).set({ publishing: null }).where(eq(threadRolloutForm.threadId, threadId)));
    }),
  );

const publishedHere = Effect.fnUntraced(function* (path: string, publishing: RolloutPublishing) {
  const state = yield* rolloutStateOf(path);
  if (state === null) return false;
  const read = yield* RolloutReads;
  return (yield* Effect.tryPromise({ try: () => sha256Of(state.path, read), catch: io(path) })) === publishing.sha256;
});

export const settledRollout = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  write: RolloutFormWrite,
  threadId: string,
  path: string,
  kinds: ThreadEntryReader,
): Effect.fn.Return<void, RolloutUnformable | RolloutUnreadable | StoreFailure> {
  const standing = yield* rolloutFormOf(db, threadId);
  const publishing = standing?.publishing;
  if (publishing == null) return;
  if (yield* publishedHere(path, publishing)) return yield* settledWith(db, write, threadId, publishing);
  if (kinds.base !== null && standing?.step === kinds.base.step) return yield* olderRollout(threadId, path, null, kinds.base);
});

export type RolloutStaged = {
  readonly kind: 'staged';
  readonly commit: (transcribed: boolean) => Effect.Effect<RolloutForm | { readonly kind: 'moved' }, RolloutUnreadable | StoreFailure>;
  readonly discard: Effect.Effect<void, RolloutUnreadable>;
  readonly transcript: { readonly files: RolloutFiles; readonly key: TranscriptKey } | null;
};

const MOVED = { kind: 'moved' } as const;

//! Writes nothing but a settle guarded inside its own unit, so it may stage beside the lane; `commit` runs inside the journal lane.
export const stagedRollout = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  write: RolloutFormWrite,
  threadId: string,
  path: string,
  kinds: ThreadEntryReader,
  stage: StageRollout,
  aside: boolean,
): Effect.fn.Return<RolloutForm | RolloutStaged, RolloutUnreadable | StoreFailure> {
  const suffix = aside ? '.staging' : '.forming';
  const done = yield* rolloutFormOf(db, threadId);
  if (done === undefined && kinds.last === null) return FORMED;
  const state = yield* rolloutStateOf(path);
  const rested =
    (yield* db
      .select({ at: threadRolloutCursor.restedAt })
      .from(threadRolloutCursor)
      .where(eq(threadRolloutCursor.threadId, threadId))
      .get())?.at != null;
  if (aside && !rested) return FORMED;
  const reached = done?.step ?? null;
  if (kinds.base !== null && kinds.below(reached) && state !== null && done?.refusal == null && (rested || done?.publishing != null)) {
    return { kind: 'refused', refusal: olderRollout(threadId, path, reached, kinds.base) };
  }
  let mark: string | null = null;
  if (done?.publishing != null) {
    if (yield* publishedHere(path, done.publishing)) {
      yield* settledWith(db, write, threadId, done.publishing);
      if (!kinds.lags(done.step)) return FORMED;
    } else if (kinds.base !== null && done.step === kinds.base.step) {
      return { kind: 'refused', refusal: olderRollout(threadId, path, null, kinds.base) };
    }
  } else if (done !== undefined && done.refusal !== null) {
    return { kind: 'refused', refusal: new RolloutUnformable({ threadId, path, reason: done.refusal }) };
  } else if (done !== undefined) {
    if (!kinds.lags(done.step) || state === null || (!rested && (done.step === null || !eventless(kinds.after(done.step))))) return FORMED;
    mark = done.step;
  }
  if (state === null) return FORMED;
  const hasRow = (yield* db.select({ id: threadRecord.id }).from(threadRecord).where(eq(threadRecord.id, threadId)).get()) !== undefined;
  const stepping = rested || !hasRow || mark !== null;
  const pending = stepping ? kinds.after(mark) : [];
  const step = stepping ? kinds.last : null;

  const basis = yield* basisOf(db, threadId, path);
  const wanted = new Set([basis.cursor, basis.refused].filter((bytes): bytes is number => bytes !== undefined && bytes > 0));
  const clear = Effect.tryPromise({ try: () => cleared(path, suffix), catch: io(path) });
  const unmarked = (unit: WriteUnit<'machine'>) => unit.run(db.delete(threadRolloutForm).where(eq(threadRolloutForm.threadId, threadId)));
  const refuse = (failure: RolloutUnformable) =>
    Effect.as(
      write(
        FORMING,
        Effect.fnUntraced(function* (unit) {
          yield* unmarked(unit);
          if ((yield* heldThread(db, unit, threadId)) === undefined) return;
          yield* unit.run(
            db.insert(threadRolloutForm).values({ threadId, formedAt: new Date(yield* Clock.currentTimeMillis), refusal: failure.reason }),
          );
        }),
      ),
      { kind: 'refused', refusal: failure } as const,
    );
  const unmoved = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A | typeof MOVED, E | RolloutUnreadable | StoreFailure> =>
    Effect.flatMap(basisOf(db, threadId, path), (now): Effect.Effect<A | typeof MOVED, E | RolloutUnreadable> =>
      sameBasis(basis, now) ? work : Effect.as(clear, MOVED),
    );

  const attempt = yield* Effect.result(
    stage(rolloutFiles(path), { form: state.form, wanted: [...wanted], steps: pending.map((one) => one.name), suffix }).pipe(
      Effect.provideService(ThreadEntryKinds, kinds),
      Effect.mapError((failure) => (failure._tag === 'WorkerUnavailable' ? io(path)(failure) : failure)),
      Effect.flatMap((file) =>
        file.kind === 'staged' ? Effect.succeed(file) : Effect.fail(new RolloutUnformable({ threadId, path, reason: file.reason })),
      ),
    ),
  );
  if (Result.isFailure(attempt)) {
    yield* clear;
    const failure = attempt.failure;
    if (failure._tag === 'RolloutUnreadable') return yield* failure;
    return { kind: 'staged', commit: () => unmoved(refuse(failure)), discard: Effect.void, transcript: null } satisfies RolloutStaged;
  }
  const formed = attempt.success;
  const { staged: from, published } = formed;
  const shifted = new Map(formed.moved);
  const moved = (bytes: number | undefined) => (bytes === undefined ? null : (shifted.get(bytes) ?? bytes));
  const publishing: RolloutPublishing | null = formed.changed
    ? { sha256: formed.sha256, cursorBytes: moved(basis.cursor), refusalBytes: moved(basis.refused) }
    : null;
  const transcript =
    aside && publishing !== null
      ? {
          files: { path: `${path}${suffix}`, packed: `${compressedRollout(path)}${suffix}`, transcript: `${transcriptOf(path)}${suffix}` },
          key: { bytes: publishing.cursorBytes ?? 0, position: basis.position ?? 0 },
        }
      : null;
  const commit = Effect.fnUntraced(function* (transcribed: boolean) {
    const recording = yield* Effect.result(
      write(
        FORMING,
        Effect.fnUntraced(function* (unit) {
          yield* unmarked(unit);
          if ((yield* heldThread(db, unit, threadId)) === undefined) return false;
          yield* unit.run(
            db.insert(threadRolloutForm).values({ threadId, formedAt: new Date(yield* Clock.currentTimeMillis), publishing, step }),
          );
          yield* formStoredIn(db, unit, threadId, kinds, pending);
          return true;
        }),
      ),
    );
    if (Result.isFailure(recording)) {
      yield* clear;
      const failure = recording.failure;
      if (failure._tag !== 'ThreadFormRefused') return yield* failure;
      return yield* refuse(new RolloutUnformable({ threadId, path, reason: failure.message }));
    }
    const recorded = recording.success;
    if (publishing === null) {
      yield* clear;
      return FORMED;
    }
    const renamed = yield* Effect.result(
      Effect.tryPromise({
        try: async () => {
          await rename(from, published);
          if (transcribed && transcript !== null) await rename(transcript.files.transcript, transcriptOf(path));
        },
        catch: io(path),
      }),
    );
    yield* clear;
    if (Result.isFailure(renamed)) return yield* renamed.failure;
    if (recorded) yield* settledWith(db, write, threadId, publishing);
    return FORMED;
  });
  return { kind: 'staged', commit: (transcribed) => unmoved(commit(transcribed)), discard: clear, transcript } satisfies RolloutStaged;
});

//! Runs inside the thread's journal lane: nothing else moves the file, its cursor or its refusal while it works.
export const formRollout = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  write: RolloutFormWrite,
  threadId: string,
  path: string,
  kinds: ThreadEntryReader,
  stage: StageRollout,
): Effect.fn.Return<RolloutForm, RolloutUnreadable | StoreFailure> {
  for (;;) {
    const staging = yield* stagedRollout(db, write, threadId, path, kinds, stage, false);
    if (staging.kind !== 'staged') return staging;
    const outcome = yield* staging.commit(false);
    if (outcome.kind !== 'moved') return outcome;
  }
});
