import { type CostCause, CurrentCost } from '@runlith/performance/CostLedger';
import { CurrentWriter, type WriterFrame } from '@runlith/performance/WriterMetrics';
import { HeldFor } from '@runlith/held/holding';
import * as Cause from 'effect/Cause';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Latch from 'effect/Latch';
import type * as Scope from 'effect/Scope';
import { classifySqliteError, SqlError } from 'effect/sql/SqlError';
import type { ProgramOutcome, SqliteProgram, Synchronous } from './channel.js';
import type { ProcessConnection } from './connection.js';
import { parameterBytes } from './payload.js';

type ProgramSubmission = {
  readonly operation: string;
  readonly program: SqliteProgram;
  readonly synchronous: Synchronous | null;
};

type ProgramAnswer = { readonly outcome: ProgramOutcome; readonly writerPid: number; readonly commitReturnedAt: number };

export class Programs extends Context.Service<
  Programs,
  { readonly submit: (submission: ProgramSubmission) => Effect.Effect<ProgramAnswer, SqlError> }
>()('@runlith/sqlite-process/Programs') {}

const BATCH_PROGRAMS = 64;
const BATCH_BYTES = 1_048_576;

const STRICTNESS: Record<Synchronous, number> = { off: 0, normal: 1, full: 2 };

type Pending = {
  readonly submission: ProgramSubmission;
  readonly bytes: number;
  readonly answer: Deferred.Deferred<ProgramAnswer, SqlError>;
  readonly askedAt: number;
  readonly cost: CostCause | null;
  readonly frame: WriterFrame | null;
};

type ProgramWriter = {
  readonly writer: ProcessConnection;
  readonly exclusive: Effect.Effect<() => void, SqlError, Scope.Scope>;
  readonly admission: Effect.Effect<void, SqlError>;
  readonly level: () => Synchronous | undefined;
  readonly settled: (level: Synchronous | undefined) => void;
};

const broken = (message: string) => new SqlError({ reason: classifySqliteError(new Error(message), { message, operation: 'programs' }) });

const strictest = (batch: readonly Pending[]): Synchronous | null => {
  let wanted: Synchronous | null = null;
  for (const { submission } of batch) {
    const level = submission.synchronous;
    if (level !== null && (wanted === null || STRICTNESS[level] > STRICTNESS[wanted])) wanted = level;
  }
  return wanted;
};

const failed = (batch: readonly Pending[], error: SqlError): void => {
  for (const member of batch) {
    if (member.frame !== null) member.frame.repliesComplete = false;
    Deferred.doneUnsafe(member.answer, Effect.fail(error));
  }
};

export const makePrograms = Effect.fnUntraced(function* (input: ProgramWriter) {
  const physical = Context.get(Context.empty(), Clock.Clock);
  const now = () => Number(physical.monotonicTimeNanosUnsafe()) / 1_000_000;
  const queue: Pending[] = [];
  const arrived = Latch.makeUnsafe();

  const take = (): Pending[] => {
    const batch: Pending[] = [];
    let bytes = 0;
    while (queue.length > 0 && batch.length < BATCH_PROGRAMS) {
      const next = queue[0]!;
      if (batch.length > 0 && bytes + next.bytes > BATCH_BYTES) break;
      queue.shift();
      bytes += next.bytes;
      batch.push(next);
    }
    return batch;
  };

  const settle = (batch: readonly Pending[], outcomes: readonly ProgramOutcome[], execMs: number, heldMs: number, at: number) => {
    const own = outcomes.reduce((sum, outcome) => sum + outcome.execMs, 0);
    const shared = Math.max(0, execMs - own);
    for (const [index, member] of batch.entries()) {
      const outcome = outcomes[index]!;
      const weight = own > 0 ? outcome.execMs / own : 1 / batch.length;
      const holdMs = heldMs * weight;
      if (member.cost !== null) member.cost.counts.writerHoldMs += holdMs;
      if (member.frame !== null) {
        member.frame.holdMs += holdMs;
        member.frame.childMs += outcome.execMs + shared * weight;
        member.frame.writerPid = input.writer.pid;
        member.frame.commitReturnedAt = at;
      }
      Deferred.doneUnsafe(member.answer, Effect.succeed({ outcome, writerPid: input.writer.pid, commitReturnedAt: at }));
    }
  };

  const run = (batch: readonly Pending[]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const admitted = yield* Effect.result(input.admission);
        if (admitted._tag === 'Failure') return failed(batch, admitted.failure);
        const label = [...new Set(batch.map((member) => member.submission.operation))].join(', ');
        const leased = yield* Effect.result(Effect.provideService(input.exclusive, HeldFor, label));
        if (leased._tag === 'Failure') return failed(batch, leased.failure);
        const grantedAt = now();
        for (const member of batch) {
          const waitedMs = grantedAt - member.askedAt;
          if (member.cost !== null) member.cost.counts.writerWaitMs += waitedMs;
          if (member.frame !== null) {
            member.frame.waitMs += waitedMs;
            member.frame.acquired = true;
          }
        }
        const wanted = strictest(batch);
        const synchronous = wanted !== null && wanted !== input.level() ? wanted : null;
        const committed = yield* Effect.result(
          input.writer.programs({ programs: batch.map((member) => member.submission.program), synchronous }),
        );
        leased.success();
        const heldMs = now() - grantedAt;
        if (committed._tag === 'Failure') {
          if (synchronous !== null) input.settled(undefined);
          for (const member of batch) {
            if (member.cost !== null) member.cost.counts.writerHoldMs += heldMs / batch.length;
            if (member.frame !== null) member.frame.holdMs += heldMs / batch.length;
          }
          return failed(batch, committed.failure);
        }
        if (synchronous !== null) input.settled(synchronous);
        const said = committed.success;
        if (said.outcomes.length !== batch.length)
          return failed(batch, broken(`the sqlite process answered ${said.outcomes.length} of ${batch.length} programs`));
        settle(batch, said.outcomes, said.execMs, heldMs, said.commitReturnedAt);
      }),
    );

  yield* Effect.addFinalizer(() => Effect.sync(() => failed(queue.splice(0), broken('the sqlite writer closed with programs queued'))));

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        arrived.closeUnsafe();
        if (queue.length === 0) return yield* arrived.await;
        const batch = take();
        const ran = yield* Effect.exit(run(batch));
        if (Exit.isFailure(ran)) failed(batch, broken(`a program batch died: ${Cause.pretty(ran.cause)}`));
      }),
    ),
  );

  const submit = (submission: ProgramSubmission): Effect.Effect<ProgramAnswer, SqlError> =>
    Effect.uninterruptible(
      Effect.withFiber((fiber) => {
        const cost = Context.get(fiber.context, CurrentCost);
        const observed = Context.get(fiber.context, CurrentWriter);
        const frame = observed !== null && (observed.owner === null || observed.owner === input.writer) ? observed : null;
        if (frame !== null) frame.owner = input.writer;
        let bytes = 0;
        for (const statement of submission.program.statements)
          bytes += Buffer.byteLength(statement.sql, 'utf8') + parameterBytes(statement.params);
        if (cost !== null) {
          cost.counts.programs += 1;
          cost.counts.requestBytes += bytes;
        }
        const pending: Pending = { submission, bytes, answer: Deferred.makeUnsafe(), askedAt: now(), cost, frame };
        queue.push(pending);
        arrived.openUnsafe();
        return Deferred.await(pending.answer);
      }),
    );

  return Programs.of({ submit });
});
