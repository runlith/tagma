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
import type { Committed, ProgramOutcome, SqliteProgram, Synchronous } from './channel.js';
import type { ProcessConnection, Unapplied } from './connection.js';
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
const DEPTH = 2;

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

type Flying = { readonly batch: readonly Pending[]; said: Committed | Unapplied | SqlError | undefined };

const broken = (message: string) => new SqlError({ reason: classifySqliteError(new Error(message), { message, operation: 'programs' }) });

const errorOf = (cause: Cause.Cause<SqlError>): SqlError => {
  for (const reason of cause.reasons) if (Cause.isFailReason(reason)) return reason.error;
  return broken(`a program batch died: ${Cause.pretty(cause)}`);
};

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

  const settle = (batch: readonly Pending[], said: Committed) => {
    const { outcomes, execMs, queueMs, commitReturnedAt: at } = said;
    const own = outcomes.reduce((sum, outcome) => sum + outcome.execMs, 0);
    const shared = Math.max(0, execMs - own);
    for (const [index, member] of batch.entries()) {
      const outcome = outcomes[index]!;
      const weight = own > 0 ? outcome.execMs / own : 1 / batch.length;
      const heldMs = outcome.execMs + shared * weight;
      if (member.cost !== null) {
        member.cost.counts.writerWaitMs += queueMs;
        member.cost.counts.writerHoldMs += heldMs;
      }
      if (member.frame !== null) {
        member.frame.waitMs += queueMs;
        member.frame.holdMs += heldMs;
        member.frame.childMs += heldMs;
        member.frame.writerPid = input.writer.pid;
        member.frame.commitReturnedAt = at;
      }
      Deferred.doneUnsafe(member.answer, Effect.succeed({ outcome, writerPid: input.writer.pid, commitReturnedAt: at }));
    }
  };

  const flying: Flying[] = [];
  let sending: readonly Pending[] = [];
  const quiet = Latch.makeUnsafe(true);

  const landed = (batch: readonly Pending[], said: Committed | Unapplied | SqlError): void => {
    if (said instanceof SqlError) {
      input.settled(undefined);
      return failed(batch, said);
    }
    if (said._tag === 'Unapplied') {
      input.settled(undefined);
      for (const member of batch) {
        if (member.cost !== null) {
          member.cost.counts.writerWaitMs += said.queueMs;
          member.cost.counts.writerHoldMs += said.execMs / batch.length;
        }
        if (member.frame !== null) {
          member.frame.waitMs += said.queueMs;
          member.frame.holdMs += said.execMs / batch.length;
          member.frame.childMs += said.execMs / batch.length;
        }
      }
      return failed(batch, said.failure);
    }
    if (said.outcomes.length !== batch.length)
      return failed(batch, broken(`the sqlite process answered ${said.outcomes.length} of ${batch.length} programs`));
    settle(batch, said);
  };

  const orphaned = (error: SqlError): void => {
    failed(sending, error);
    sending = [];
    for (const { batch, said } of flying.splice(0)) landed(batch, said ?? error);
    quiet.openUnsafe();
  };

  const send = Effect.fnUntraced(function* (batch: readonly Pending[], scope: Scope.Scope) {
    sending = batch;
    quiet.closeUnsafe();
    const label = [...new Set(batch.map((member) => member.submission.operation))].join(', ');
    const sent = yield* Effect.result(
      Effect.scoped(
        Effect.gen(function* () {
          const release = yield* Effect.provideService(input.exclusive, HeldFor, label);
          const sentAt = now();
          for (const member of batch) {
            const waitedMs = sentAt - member.askedAt;
            if (member.cost !== null) member.cost.counts.writerWaitMs += waitedMs;
            if (member.frame !== null) {
              member.frame.waitMs += waitedMs;
              member.frame.acquired = true;
            }
          }
          const wanted = strictest(batch);
          const synchronous = wanted !== null && wanted !== input.level() ? wanted : null;
          const answer = yield* input.writer.programs({ programs: batch.map((member) => member.submission.program), synchronous });
          if (synchronous !== null) input.settled(synchronous);
          release();
          return answer;
        }),
      ),
    );
    sending = [];
    if (sent._tag === 'Failure') return failed(batch, sent.failure);
    const flight: Flying = { batch, said: undefined };
    flying.push(flight);
    yield* Effect.forkIn(
      Effect.flatMap(Effect.exit(sent.success), (exit) =>
        Effect.sync(() => {
          flight.said = Exit.isSuccess(exit) ? exit.value : errorOf(exit.cause);
          arrived.openUnsafe();
        }),
      ),
      scope,
    );
  });

  const scope = yield* Effect.scope;

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      const closed = broken('the sqlite writer closed with programs queued');
      failed(queue.splice(0), closed);
      orphaned(closed);
    }),
  );

  yield* Effect.forkScoped(
    Effect.forever(
      Effect.gen(function* () {
        arrived.closeUnsafe();
        for (let head = flying[0]; head?.said !== undefined; head = flying[0]) {
          flying.shift();
          landed(head.batch, head.said);
        }
        if (flying.length === 0) quiet.openUnsafe();
        if (queue.length === 0 || flying.length >= DEPTH) return yield* arrived.await;
        const admitted = yield* Effect.result(input.admission);
        const batch = take();
        if (admitted._tag === 'Failure') return failed(batch, admitted.failure);
        const ran = yield* Effect.exit(send(batch, scope));
        if (Exit.isFailure(ran)) orphaned(broken(`a program batch died: ${Cause.pretty(ran.cause)}`));
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

  return { programs: Programs.of({ submit }), drained: quiet.await };
});
