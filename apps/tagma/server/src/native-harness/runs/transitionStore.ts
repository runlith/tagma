import { Cause, Clock, Effect } from 'effect';
import { and, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { among } from '../../platform/store/rows.js';
import { bindQuery } from '../../platform/store/queries.js';
import {
  callParts,
  mintedBefore,
  REPORT_OPERATION,
  REPORT_WINDOW,
  type CallKey,
  type CallParts,
  type Evidence,
} from '@runlith/agent/thread/keyed';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { SequenceUnavailable, ThreadVersionStaleError } from '@runlith/agent/thread/transition/port';
import type {
  RecordReading,
  RecordWrite,
  ThreadAt,
  ThreadHold,
  ThreadTransitionStorage,
  ThreadVersion,
} from '@runlith/agent/thread/transition/port';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type ProgramUnit, type Unit, type WriteUnit } from '../../platform/contract/service/units.js';
import { threadRev, threadRunReceipt } from '../store/thread.js';
import { threadRun } from '../../threads/store/kernel.js';
import { metadataColumns, threadRow } from '../row.js';
import { threadRowOf } from '../rows/threadUnits.js';
import type { ThreadStore } from '../rows/threadRow.js';
import { journalHead } from '../../threads/journal/base.js';
import { threadInbox } from '../../threads/store/tables.js';
import { spentCallKey, spentEpoch, threadCall } from '../../threads/store/calls.js';
import { inProgram, inUnit, stored, type StoredFailure } from '../../platform/store/crossing.js';
import { fellBack, programOf, programWriteUnit, unplannable } from '../../platform/store/programs.js';
import { planHead, plannedFacts } from '../../threads/journal/log.js';
import type { ThreadMetadataRow, ThreadRow } from '@runlith/agent/thread/rows';
import { failedAs } from '../../threads/contract/service/failure.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';
import { kernelStorageWrites } from '../rows/storageWrites.js';
import { makeChangeRevisions } from './changeRevision.js';

export type TransitionsInput = {
  readonly threads: ThreadStore;
  readonly writes?: () => WriteSet;
};

export const makeTransitions = Effect.fnUntraced(function* ({
  threads,
  writes = () => kernelStorageWrites,
}: TransitionsInput): Effect.fn.Return<ThreadTransitionStorage<Unit<'machine'>, WriteUnit<'machine'>>, never, MachineStore | MachineUnits> {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  let epoch: Date | null | undefined;
  const versionById = db
    .select(versionColumns(sql`${sql.placeholder('threadId')}`))
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('threadId')))
    .prepare();
  const heldById = db
    .select({ ...metadataColumns, ...versionColumns(sql`${sql.placeholder('threadId')}`) })
    .from(threadRow)
    .where(eq(threadRow.id, sql.placeholder('threadId')))
    .prepare();

  const absentCall = db
    .select({ key: threadCall.key })
    .from(threadCall)
    .where(
      and(
        eq(threadCall.actor, sql.placeholder('actor')),
        eq(threadCall.operation, sql.placeholder('operation')),
        eq(threadCall.key, sql.placeholder('key')),
      ),
    )
    .prepare();
  const absentSpent = db
    .select({ key: spentCallKey.key })
    .from(spentCallKey)
    .where(
      and(
        eq(spentCallKey.actor, sql.placeholder('actor')),
        eq(spentCallKey.operation, sql.placeholder('operation')),
        eq(spentCallKey.key, sql.placeholder('key')),
      ),
    )
    .prepare();
  const guardVersion = versionColumns(sql`${sql.placeholder('threadId')}`);
  const unchangedThread = db
    .select({ id: threadRow.id })
    .from(threadRow)
    .where(
      and(
        eq(threadRow.id, sql.placeholder('threadId')),
        sql`${guardVersion.foldRev} = ${sql.placeholder('foldRev')}`,
        sql`${guardVersion.inheritRev} = ${sql.placeholder('inheritRev')}`,
        sql`${guardVersion.head} = ${sql.placeholder('head')}`,
        eq(threadRow.updatedAt, sql.param(sql.placeholder('updatedAt'), threadRow.updatedAt)),
      ),
    )
    .prepare();
  const recordCall = db
    .insert(threadCall)
    .values({
      actor: sql.placeholder('actor'),
      operation: sql.placeholder('operation'),
      key: sql.placeholder('key'),
      threadId: sql.placeholder('threadId'),
      digest: sql.placeholder('digest'),
      result: sql.placeholder('result'),
      at: sql.placeholder('at'),
    })
    .prepare();

  const version = (unit: Unit<'machine'>, threadId: string): Effect.Effect<ThreadVersion | undefined, StoredFailure> =>
    unit.run(versionById.get({ threadId }));

  const snapshot = Effect.fnUntraced(function* <T, E>(
    unit: Unit<'machine'>,
    threadId: string,
    work: (at: ThreadAt<Unit<'machine'>>) => Effect.Effect<T, E>,
    guarded = false,
  ) {
    for (let attempt = 1; ; attempt += 1) {
      const before = yield* stored('version')(version(unit, threadId));
      if (before === undefined) return undefined;
      const row = yield* threads.find(threadId, unit);
      if (row === undefined) return undefined;
      const made = yield* work({ row, version: before, tx: unit });
      if (guarded) return made;
      const after = yield* stored('version')(version(unit, threadId));
      if (after !== undefined && sameVersion(before, after)) return made;
      if (attempt === SNAPSHOT_ATTEMPTS) return yield* new ThreadVersionStaleError({ threadId });
    }
  });

  const hold = Effect.fnUntraced(function* <T, E>(
    unit: WriteUnit<'machine'>,
    threadId: string,
    work: (at: ThreadHold<WriteUnit<'machine'>>) => Effect.Effect<T, E>,
  ) {
    const held = yield* stored('writeAt')(unit.run(heldById.get({ threadId })));
    if (held === undefined) return undefined;
    const { foldRev, inheritRev, head, ...metadata } = held;
    const row = yield* threadRowOf(threads.kinds, metadata);
    return yield* work({ row, version: { foldRev, inheritRev, head }, tx: unit });
  });

  const forgotten = Effect.fnUntraced(function* (unit: Unit<'machine'>, call: CallParts) {
    const spent = yield* unit.run(
      db
        .select({ digest: spentCallKey.digest, at: spentCallKey.spentAt })
        .from(spentCallKey)
        .where(and(eq(spentCallKey.actor, call.actor), eq(spentCallKey.operation, call.operation), eq(spentCallKey.key, call.key)))
        .get(),
    );
    if (spent) return { kind: 'spent' as const, digest: spent.digest, at: spent.at };
    if (epoch === undefined) {
      const stamped = yield* unit.run(db.select({ at: spentEpoch.at }).from(spentEpoch).where(eq(spentEpoch.id, 1)).get());
      epoch = stamped?.at ?? null;
    }
    return mintedBefore(call.key, epoch) ? { kind: 'before-epoch' as const } : { kind: 'absent' as const };
  });

  const assumed = new WeakMap<ProgramUnit<'machine'>, CallKey[]>();

  const unrecorded = Effect.fnUntraced(function* (
    program: ProgramUnit<'machine'>,
    key: CallKey,
  ): Effect.fn.Return<RecordReading, StoredFailure> {
    const call = callParts(key);
    const standing = assumed.get(program);
    if (standing === undefined) assumed.set(program, [key]);
    else standing.push(key);
    yield* program.guard(bindQuery(absentCall, call), 0);
    yield* program.guard(bindQuery(absentSpent, call), 0);
    if (epoch === undefined) {
      const stamped = yield* units.read((unit) =>
        unit.run(db.select({ at: spentEpoch.at }).from(spentEpoch).where(eq(spentEpoch.id, 1)).get()),
      );
      epoch = stamped?.at ?? null;
    }
    return mintedBefore(call.key, epoch) ? { kind: 'before-epoch' as const } : { kind: 'absent' as const };
  });

  const lookup = Effect.fnUntraced(function* (
    unit: Unit<'machine'>,
    threadId: string,
    evidence: Evidence,
  ): Effect.fn.Return<RecordReading, StoredFailure | SequenceUnavailable> {
    if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return { kind: 'decided' };
    if ('seq' in evidence) {
      const run = yield* unit.run(
        db
          .select({ applied: threadRun.appliedSeq, status: threadRun.status })
          .from(threadRun)
          .where(and(eq(threadRun.id, evidence.run), eq(threadRun.threadId, threadId)))
          .get(),
      );
      if (run === undefined) return yield* Effect.fail(new SequenceUnavailable(evidence.run, evidence.seq, 'absent'));
      const applied = run.applied;
      if (run.status !== 'running') return yield* Effect.fail(new SequenceUnavailable(evidence.run, evidence.seq, 'ended'));
      if (evidence.seq < applied) return yield* Effect.fail(new SequenceUnavailable(evidence.run, evidence.seq, 'advanced'));
      if (evidence.seq > applied + 1)
        return yield* invariant(`Run ${evidence.run} stands at sequence ${applied}, so sequence ${evidence.seq} would leave a gap.`);
      const standing = yield* unit.run(
        db
          .select({ digest: threadRunReceipt.requestDigest, result: threadRunReceipt.result })
          .from(threadRunReceipt)
          .where(and(eq(threadRunReceipt.runId, evidence.run), eq(threadRunReceipt.seq, evidence.seq)))
          .get(),
      );
      if (standing) return { kind: 'present', digest: standing.digest, result: answerIn(standing.result) };
      if (evidence.seq <= applied)
        return yield* invariant(`Run ${evidence.run} applied sequence ${applied} but holds no record of sequence ${evidence.seq}.`);
      return { kind: 'absent' };
    }
    if ('started' in evidence) {
      const parts = callParts(evidence.started);
      const run = yield* unit.run(
        db
          .select({ id: threadRun.id, digest: threadRun.startDigest })
          .from(threadRun)
          .where(and(eq(threadRun.threadId, parts.actor), eq(threadRun.startKey, parts.key)))
          .get(),
      );
      if (run === undefined) return yield* forgotten(unit, parts);
      return run.digest === null ? { kind: 'decided' } : { kind: 'present', digest: run.digest, result: run.id };
    }
    if ('runEnd' in evidence) {
      const run = yield* unit.run(
        db
          .select({ status: threadRun.status, digest: threadRun.endDigest, result: threadRun.endResult })
          .from(threadRun)
          .where(eq(threadRun.id, evidence.runEnd))
          .get(),
      );
      if (run === undefined || run.status === 'running') return { kind: 'absent' };
      if (run.digest === null || run.status !== evidence.status) return { kind: 'decided' };
      return { kind: 'present', digest: run.digest, result: answerIn(run.result) };
    }
    if ('envelope' in evidence) {
      const item = yield* unit.run(
        db
          .select({ digest: threadInbox.requestDigest })
          .from(threadInbox)
          .where(eq(threadInbox.id, envelopeId(evidence.envelope)))
          .get(),
      );
      if (item !== undefined) return item.digest === null ? { kind: 'decided' } : { kind: 'standing', digest: item.digest };
      return yield* forgotten(unit, callParts(evidence.envelope));
    }
    const call = callParts(evidence.call);
    const standing = yield* unit.run(
      db
        .select({ digest: threadCall.digest, result: threadCall.result })
        .from(threadCall)
        .where(and(eq(threadCall.actor, call.actor), eq(threadCall.operation, call.operation), eq(threadCall.key, call.key)))
        .get(),
    );
    if (standing) return { kind: 'present', digest: standing.digest, result: answerIn(standing.result) };
    return yield* forgotten(unit, call);
  });

  const record = Effect.fnUntraced(function* (unit: Unit<'machine'>, threadId: string, evidence: Evidence, write: RecordWrite) {
    if ('inboxItem' in evidence || 'decidedBy' in evidence || 'settlement' in evidence || 'owned' in evidence) return;
    if ('seq' in evidence) {
      yield* unit.run(
        db
          .insert(threadRunReceipt)
          .values({
            runId: evidence.run,
            seq: evidence.seq,
            requestDigest: write.digest,
            result: { answer: write.result ?? null },
          })
          .onConflictDoUpdate({
            target: threadRunReceipt.runId,
            set: { seq: sql`excluded.seq`, requestDigest: sql`excluded.request_digest`, result: sql`excluded.result` },
          }),
      );
      yield* unit.run(db.update(threadRun).set({ appliedSeq: evidence.seq }).where(eq(threadRun.id, evidence.run)));
      return;
    }
    if ('runEnd' in evidence) {
      yield* unit.run(
        db
          .update(threadRun)
          .set({ endDigest: write.digest, endResult: { answer: write.result ?? null } })
          .where(eq(threadRun.id, evidence.runEnd)),
      );
      yield* unit.run(db.delete(threadCall).where(and(eq(threadCall.actor, evidence.runEnd), eq(threadCall.operation, REPORT_OPERATION))));
      return;
    }
    if ('started' in evidence)
      return yield* invariant(`Start ${evidence.started.id} is keyed on the run row its creation wrote, never recorded after it.`);
    if ('envelope' in evidence) {
      yield* unit.run(
        db
          .update(threadInbox)
          .set({ requestDigest: write.digest })
          .where(eq(threadInbox.id, envelopeId(evidence.envelope))),
      );
      return;
    }
    const call = callParts(evidence.call);
    const program = programOf(unit);
    const recorded = {
      ...call,
      threadId,
      digest: write.digest,
      result: { answer: write.result ?? null },
      at: new Date(yield* Clock.currentTimeMillis),
    };
    if (program !== null) {
      yield* program.write(bindQuery(recordCall, recorded), 1);
      if (call.operation !== REPORT_OPERATION) return;
      const marks = and(eq(threadCall.actor, call.actor), eq(threadCall.operation, REPORT_OPERATION));
      return yield* program.write(
        db
          .delete(threadCall)
          .where(
            and(
              marks,
              sql`${threadCall.key} not in (select ${threadCall.key} from ${threadCall} where ${marks} order by rowid desc limit ${REPORT_WINDOW})`,
            ),
          ),
      );
    }
    yield* unit.run(recordCall.run(recorded));
    if (call.operation !== REPORT_OPERATION) return;
    const marks = yield* unit.run(
      db
        .select({ key: threadCall.key })
        .from(threadCall)
        .where(and(eq(threadCall.actor, call.actor), eq(threadCall.operation, REPORT_OPERATION)))
        .orderBy(desc(sql`rowid`)),
    );
    const stale = marks.slice(REPORT_WINDOW).map((row) => row.key);
    if (stale.length === 0) return;
    yield* unit.run(
      db
        .delete(threadCall)
        .where(and(eq(threadCall.actor, call.actor), eq(threadCall.operation, REPORT_OPERATION), inArray(threadCall.key, stale))),
    );
  });

  const settled = new WeakMap<
    ProgramUnit<'machine'>,
    { readonly threadId: string; readonly row: ThreadRow; readonly version: ThreadVersion }
  >();

  const planned = Effect.fnUntraced(function* <T, E>(
    program: ProgramUnit<'machine'>,
    threadId: string,
    row: ThreadMetadataRow,
    version: ThreadVersion,
    work: (at: ThreadHold<WriteUnit<'machine'>>) => Effect.Effect<T, E>,
    tx: WriteUnit<'machine'>,
  ) {
    yield* stored('programAt')(program.guard(bindQuery(unchangedThread, { threadId, ...version, updatedAt: row.updatedAt }), 1));
    planHead(program, threadId, version.head);
    return yield* Effect.catchCause(work({ row, version, tx }), (cause) => standingFirst(program, threadId, cause));
  });

  const standingFirst = Effect.fnUntraced(function* <E>(program: ProgramUnit<'machine'>, threadId: string, cause: Cause.Cause<E>) {
    if (!Cause.hasInterrupts(cause) && !fellBack(cause))
      for (const key of assumed.get(program) ?? []) {
        const reading = yield* failedAs(
          'readRecord',
          units.read((unit) => lookup(unit, threadId, { call: key })),
        );
        if (reading.kind !== 'absent') return yield* unplannable(program, 'a call key that already stands');
      }
    return yield* Effect.failCause(cause);
  });

  return {
    ...(yield* makeChangeRevisions),
    readAt: (threadId, work, tx) => {
      const program = tx === undefined ? null : programOf(tx);
      if (program !== null) {
        if (plannedFacts(program, threadId) !== null) return unplannable(program, 'a second transition of one thread in one program');
        return Effect.flatMap(
          stored('readAt')(
            units.read((unit) =>
              Effect.exit(
                snapshot(
                  unit,
                  threadId,
                  (at) => Effect.tap(work(at), () => Effect.sync(() => settled.set(program, { threadId, ...at }))),
                  true,
                ),
              ),
            ),
          ),
          (exit) => exit,
        );
      }
      return tx !== undefined
        ? snapshot(tx, threadId, work)
        : Effect.flatMap(stored('readAt')(units.read((unit) => Effect.exit(snapshot(unit, threadId, work)))), (exit) => exit);
    },
    writeAt: (threadId, work) => inUnit(units, writes(), 'writeAt', (unit) => hold(unit, threadId, work)),
    writeAtIn: (threadId, work, tx) => {
      const program = programOf(tx);
      if (program === null) return hold(tx, threadId, work);
      const read = settled.get(program);
      if (read === undefined || read.threadId !== threadId || plannedFacts(program, threadId) !== null)
        return unplannable(program, 'a transition without its planned snapshot');
      return planned(program, threadId, read.row, read.version, work, tx);
    },
    programAt: (threadId, prepared, identity, work) =>
      inProgram(units, writes(), identity, 'programAt', (program) =>
        planned(program, threadId, prepared.row, prepared.version, work, programWriteUnit(program)),
      ),
    writeFold: (threadId, write, unit) =>
      Object.keys(write.fold).length === 0
        ? Effect.void
        : programOf(unit) !== null
          ? failedAs('writeFold', threads.folds.plan(programOf(unit)!, threadId, write.fold, write.standing, write.at))
          : failedAs(
              'writeFold',
              Effect.gen(function* () {
                const row = yield* unit.run(db.select({ id: threadRow.id }).from(threadRow).where(eq(threadRow.id, threadId)).get());
                if (row === undefined) return;
                yield* threads.folds.write('transition', unit, threadId, write.fold, write.standing, new Set(), write.at);
              }),
            ),
    readRecord: (threadId, evidence, tx) => {
      const program = tx === undefined ? null : programOf(tx);
      if (program !== null && 'call' in evidence) return failedAs('readRecord', unrecorded(program, evidence.call));
      return failedAs(
        'readRecord',
        tx === undefined ? units.read((unit) => lookup(unit, threadId, evidence)) : lookup(tx, threadId, evidence),
      );
    },
    writeRecord: (threadId, evidence, write, tx) => failedAs('writeRecord', record(tx, threadId, evidence, write)),
    appliedSeq: (runId) =>
      stored('appliedSeq')(
        Effect.map(
          units.read((unit) => unit.run(db.select({ applied: threadRun.appliedSeq }).from(threadRun).where(eq(threadRun.id, runId)).get())),
          (row) => row?.applied ?? 0,
        ),
      ),
    spend: (threadIds, at, tx) => {
      const ending = among(threadIds);
      return failedAs(
        'spend',
        Effect.gen(function* () {
          const calls = yield* tx.run(
            db
              .select({ actor: threadCall.actor, operation: threadCall.operation, key: threadCall.key, digest: threadCall.digest })
              .from(threadCall)
              .where(inArray(threadCall.threadId, ending)),
          );
          const envelopes = yield* tx.run(
            db
              .select({ id: threadInbox.id, digest: threadInbox.requestDigest })
              .from(threadInbox)
              .where(and(inArray(threadInbox.threadId, ending), isNotNull(threadInbox.requestDigest))),
          );
          const starts = yield* tx.run(
            db
              .select({ threadId: threadRun.threadId, key: threadRun.startKey, digest: threadRun.startDigest })
              .from(threadRun)
              .where(and(inArray(threadRun.threadId, ending), isNotNull(threadRun.startKey), isNotNull(threadRun.startDigest))),
          );
          const spent = [
            ...calls.map((call) => ({ ...call, spentAt: at })),
            ...starts.flatMap((run) =>
              run.key === null || run.digest === null
                ? []
                : [{ operation: 'start', actor: run.threadId, key: run.key, digest: run.digest, spentAt: at }],
            ),
            ...envelopes.flatMap((item) => {
              const parts = envelopeParts(item.id);
              return parts === null || item.digest === null ? [] : [{ ...parts, digest: item.digest, spentAt: at }];
            }),
          ];
          for (let from = 0; from < spent.length; from += SPENT_PER_STATEMENT) {
            yield* tx.run(
              db
                .insert(spentCallKey)
                .values(spent.slice(from, from + SPENT_PER_STATEMENT))
                .onConflictDoNothing(),
            );
          }
        }),
      );
    },
  };
});

const SNAPSHOT_ATTEMPTS = 8;

//! SQLite binds at most 32766 parameters to one statement, and a spent key takes five.
const SPENT_PER_STATEMENT = Math.floor(32_766 / 5);

function versionColumns(threadId: string | SQL) {
  return {
    foldRev: sql<number>`coalesce((select ${threadRev.foldRev} from ${threadRev} where ${threadRev.threadId} = ${threadId}), 0)`,
    inheritRev: sql<number>`coalesce((select ${threadRev.inheritRev} from ${threadRev} where ${threadRev.threadId} = ${threadId}), 0)`,
    head: sql<number>`${journalHead(sql`${threadId}`)}`,
  };
}

function sameVersion(left: ThreadVersion, right: ThreadVersion): boolean {
  return left.foldRev === right.foldRev && left.head === right.head && left.inheritRev === right.inheritRev;
}

function envelopeParts(id: string): CallParts | null {
  if (!id.startsWith('envelope:')) return null;
  const rest = id.slice('envelope:'.length);
  const first = rest.indexOf(':');
  const second = first < 0 ? -1 : rest.indexOf(':', first + 1);
  if (second < 0) return null;
  return { operation: rest.slice(0, first), actor: rest.slice(first + 1, second), key: rest.slice(second + 1) };
}

function envelopeId(key: CallKey): string {
  return `envelope:${key.namespace}:${key.id}`;
}

function invariant(message: string): Effect.Effect<never, ThreadStorageFailed> {
  return Effect.fail(new ThreadStorageFailed({ call: 'readRecord', cause: new Error(message) }));
}

function answerIn(stored: unknown): unknown {
  return typeof stored === 'object' && stored !== null && 'answer' in stored ? (stored as { answer: unknown }).answer : null;
}
