import { createHash, type Hash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { Clock, Data, Effect, Result } from 'effect';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes, type WriteSet } from '../../platform/contract/service/writes.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { threadRolloutCursor, threadRolloutForm, threadRolloutRefusal, type RolloutPublishing } from '../store/journal.js';
import { ThreadFormRefused, type ThreadEntryReader, type ThreadFormBase, type ThreadFormStep } from '@runlith/agent/transcript/kinds';
import { thread, threadRun } from '../store/kernel.js';
import { RolloutUnreadable, rolloutStream } from './rolloutFile.js';
import { isMetaRecord } from './rolloutMeta.js';
import { RolloutReads, type ReadRollout } from '../contract/service/rolloutReads.js';
import { compressedRollout, rolloutStateOf } from './rolloutForms.js';

type Formed = {
  readonly changed: boolean;
  readonly moved: ReadonlyMap<number, number>;
  readonly sha256: string;
};

class LineUnformable extends Data.TaggedError('LineUnformable')<{ readonly message: string }> {
  constructor(message: string) {
    super({ message });
  }
}

type Line = { readonly current: string | null };

const KEPT: Line = { current: null };

type RecordForm = {
  readonly events: boolean;
  readonly form: (kind: 'event' | 'meta', held: unknown) => { readonly value: unknown; readonly changed: boolean };
};

export const eventless = (steps: readonly ThreadFormStep[]): boolean =>
  steps.every((step) => step.payload === undefined && step.entry === undefined && step.message === undefined);

const recordForm = (kinds: ThreadEntryReader, steps: readonly ThreadFormStep[]): RecordForm => ({
  events: !eventless(steps),
  form: (kind, held) => {
    const value = kind === 'meta' ? kinds.formed('meta', held, steps) : kinds.formedEvent(held, steps);
    return { value, changed: value !== held };
  },
});

const EVENT_LINE = Buffer.from('{"kind":"event",', 'utf8');

const keptEvent = (line: Buffer, form: RecordForm): boolean =>
  !form.events && line.length > EVENT_LINE.length && line.subarray(0, EVENT_LINE.length).equals(EVENT_LINE);

function currentLine(line: string, at: number, { form }: RecordForm): Line {
  let record: { kind?: unknown; meta?: unknown; row?: { kind?: unknown; payload?: unknown } };
  try {
    record = JSON.parse(line) as typeof record;
  } catch {
    throw new LineUnformable(`the line ending at byte ${at} is not JSON`);
  }
  const header = record.kind === undefined && isMetaRecord(record);
  const kind = header || record.kind === 'meta' ? 'meta' : record.kind === 'event' ? 'event' : null;
  const held = header ? record : kind === 'meta' ? record.meta : record.row?.payload;
  if (kind === null || held === undefined) return KEPT;
  let formed: ReturnType<RecordForm['form']>;
  try {
    formed = form(kind, held);
  } catch (failure) {
    if (failure instanceof ThreadFormRefused) throw new LineUnformable(`the line ending at byte ${at}: ${failure.message}`);
    throw failure;
  }
  if (!formed.changed) return KEPT;
  return {
    current: JSON.stringify(
      header
        ? formed.value
        : kind === 'meta'
          ? { ...record, meta: formed.value }
          : { ...record, row: { ...record.row, payload: formed.value } },
    ),
  };
}

async function written(sink: Writable, bytes: Buffer): Promise<void> {
  if (!sink.write(bytes)) await once(sink, 'drain');
}

async function formLines(source: AsyncIterable<Buffer>, sink: Writable, wanted: ReadonlySet<number>, form: RecordForm): Promise<Formed> {
  let broken: Error | null = null;
  sink.on('error', (error) => {
    broken = error;
  });
  try {
    return await formInto(source, sink, wanted, form, () => broken);
  } finally {
    sink.destroy();
  }
}

async function formInto(
  source: AsyncIterable<Buffer>,
  sink: Writable,
  wanted: ReadonlySet<number>,
  form: RecordForm,
  broken: () => Error | null,
): Promise<Formed> {
  const moved = new Map<number, number>();
  const hash = createHash('sha256');
  let changed = false;
  let parts: Buffer[] = [];
  let read = 0;
  let wrote = 0;
  const emit = async (line: Buffer, newline: boolean): Promise<void> => {
    const failure = broken();
    if (failure !== null) throw failure;
    read += line.length + (newline ? 1 : 0);
    const formed = newline && !keptEvent(line, form) ? currentLine(line.toString('utf8'), read, form) : KEPT;
    const current = formed.current;
    const out = current === null ? line : Buffer.from(current, 'utf8');
    if (current !== null) changed = true;
    const bytes = newline ? Buffer.concat([out, Buffer.from('\n')]) : out;
    hash.update(bytes);
    await written(sink, bytes);
    wrote += bytes.length;
    if (newline && wanted.has(read)) moved.set(read, wrote);
  };
  for await (const chunk of source) {
    let from = 0;
    for (let newline = chunk.indexOf(0x0a); newline !== -1; newline = chunk.indexOf(0x0a, from)) {
      parts.push(chunk.subarray(from, newline));
      await emit(parts.length === 1 ? parts[0]! : Buffer.concat(parts), true);
      parts = [];
      from = newline + 1;
    }
    if (from < chunk.length) parts.push(chunk.subarray(from));
  }
  if (parts.length > 0) await emit(Buffer.concat(parts), false);
  const failure = broken();
  if (failure !== null) throw failure;
  sink.end();
  await once(sink, 'finish');
  return { changed, moved, sha256: hash.digest('hex') };
}

function packedSource(packed: string, read: ReadRollout): Readable {
  const source = rolloutStream(packed, read);
  const opened = createZstdDecompress();
  source.on('error', (error) => opened.destroy(error));
  return source.pipe(opened);
}

const hashing = (hash: Hash) =>
  new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });

async function sha256Of(path: string, read: ReadRollout): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of rolloutStream(path, read)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

type Staged = { readonly formed: Formed; readonly staged: string; readonly published: string };

async function staged(
  path: string,
  form: 'plain' | 'compressed',
  wanted: ReadonlySet<number>,
  lines: RecordForm,
  read: ReadRollout,
  suffix: string,
): Promise<Staged> {
  const forming = `${path}${suffix}`;
  const source = form === 'plain' ? rolloutStream(path, read) : packedSource(compressedRollout(path), read);
  const formed = await formLines(source, createWriteStream(forming), wanted, lines);
  if (form === 'plain' || !formed.changed) return { formed, staged: forming, published: path };
  const packed = compressedRollout(path);
  const hash = createHash('sha256');
  await pipeline(rolloutStream(forming, read), createZstdCompress(), hashing(hash), createWriteStream(`${packed}${suffix}`));
  await rm(forming, { force: true });
  return { formed: { ...formed, sha256: hash.digest('hex') }, staged: `${packed}${suffix}`, published: packed };
}

async function cleared(path: string, suffix: string): Promise<void> {
  await rm(`${path}${suffix}`, { force: true });
  await rm(`${compressedRollout(path)}${suffix}`, { force: true });
}

type Basis = {
  readonly form: string | null;
  readonly cursor: number | undefined;
  readonly refused: number | undefined;
  readonly restedAt: number | null;
  readonly file: string | null;
};

const basisOf = Effect.fnUntraced(function* (db: StoreDb<'machine'>, threadId: string, path: string) {
  const done = yield* rolloutFormOf(db, threadId);
  const cursor = yield* db
    .select({ bytes: threadRolloutCursor.nextByteOffset, restedAt: threadRolloutCursor.restedAt })
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
    refused: refused?.bytes,
    restedAt: cursor?.restedAt == null ? null : cursor.restedAt.getTime(),
    file,
  } satisfies Basis;
});

const sameBasis = (one: Basis, other: Basis): boolean =>
  one.form === other.form &&
  one.cursor === other.cursor &&
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
  readonly commit: Effect.Effect<RolloutForm | { readonly kind: 'moved' }, RolloutUnreadable | StoreFailure>;
  readonly discard: Effect.Effect<void, RolloutUnreadable>;
};

const MOVED = { kind: 'moved' } as const;

//! Writes nothing but a settle guarded inside its own unit, so it may stage beside the lane; `commit` runs inside the journal lane.
export const stagedRollout = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  write: RolloutFormWrite,
  threadId: string,
  path: string,
  kinds: ThreadEntryReader,
  aside: boolean,
): Effect.fn.Return<RolloutForm | RolloutStaged, RolloutUnreadable | StoreFailure> {
  const suffix = aside ? '.staging' : '.forming';
  const read = yield* RolloutReads;
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
  const form = recordForm(kinds, pending);

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
    Effect.tryPromise({
      try: () => staged(path, state.form, wanted, form, read, suffix),
      catch: (error) =>
        error instanceof LineUnformable ? new RolloutUnformable({ threadId, path, reason: error.message }) : io(path)(error),
    }),
  );
  if (Result.isFailure(attempt)) {
    yield* clear;
    const failure = attempt.failure;
    if (failure._tag === 'RolloutUnreadable') return yield* failure;
    return { kind: 'staged', commit: unmoved(refuse(failure)), discard: Effect.void } satisfies RolloutStaged;
  }
  const { formed, staged: from, published } = attempt.success;
  const moved = (bytes: number | undefined) => (bytes === undefined ? null : (formed.moved.get(bytes) ?? bytes));
  const publishing: RolloutPublishing | null = formed.changed
    ? { sha256: formed.sha256, cursorBytes: moved(basis.cursor), refusalBytes: moved(basis.refused) }
    : null;
  const commit = Effect.gen(function* () {
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
    const renamed = yield* Effect.result(Effect.tryPromise({ try: () => rename(from, published), catch: io(path) }));
    yield* clear;
    if (Result.isFailure(renamed)) return yield* renamed.failure;
    if (recorded) yield* settledWith(db, write, threadId, publishing);
    return FORMED;
  });
  return { kind: 'staged', commit: unmoved(commit), discard: clear } satisfies RolloutStaged;
});

//! Runs inside the thread's journal lane: nothing else moves the file, its cursor or its refusal while it works.
export const formRollout = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  write: RolloutFormWrite,
  threadId: string,
  path: string,
  kinds: ThreadEntryReader,
): Effect.fn.Return<RolloutForm, RolloutUnreadable | StoreFailure> {
  for (;;) {
    const staging = yield* stagedRollout(db, write, threadId, path, kinds, false);
    if (staging.kind !== 'staged') return staging;
    const outcome = yield* staging.commit;
    if (outcome.kind !== 'moved') return outcome;
  }
});
