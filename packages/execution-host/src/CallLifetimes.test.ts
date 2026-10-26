import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Duration, Effect, Option, Ref, Schema } from 'effect';
import { CallBudget } from '@runlith/executions/protocol/call';
import { ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { byteOffset } from '@runlith/executions/protocol/record';
import { type CallLifetimes, makeCallLifetimes } from './CallLifetimes';
import { ExecutionStore } from './store/ExecutionStore';
import { unreadStore } from './testing/store';
import type { CommandRevisionRecord } from './db/persisted';
import { HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';

const keyOf = (name: string): HostRequestRef => ({
  installation: InstallationId.make('installation-1'),
  operation: HostRequestKey.make(name),
});

const BUDGET_MS = 50;
const BUDGET_NS = BigInt(BUDGET_MS) * 1_000_000n;

const stubStore = ExecutionStore.of({
  ...unreadStore,
  decide: (decision) => Effect.succeed({ _tag: 'Recorded', decision } as const),
  recordCall: () => Effect.void,
});

type Sleeper = { readonly target: bigint; readonly wake: Deferred.Deferred<void> };

type Time = {
  readonly clock: Clock.Clock;
  readonly stepWall: (ms: number) => Effect.Effect<void>;
  readonly stepMono: (ns: bigint) => Effect.Effect<void>;
  readonly fireEarly: (ns: bigint) => Effect.Effect<void>;
};

const manualClock: Effect.Effect<Time> = Effect.gen(function* () {
  let wallMs = 0;
  let monoNs = 0n;
  const sleepers = yield* Ref.make<ReadonlyArray<Sleeper>>([]);
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => wallMs,
    currentTimeMillis: Effect.sync(() => wallMs),
    currentTimeNanosUnsafe: () => BigInt(wallMs) * 1_000_000n,
    currentTimeNanos: Effect.sync(() => BigInt(wallMs) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => monoNs,
    monotonicTimeNanos: Effect.sync(() => monoNs),
    sleep: Effect.fnUntraced(function* (duration) {
      const nanos = Duration.toNanos(duration);
      if (Option.isNone(nanos)) return yield* Effect.never;
      const target = monoNs + nanos.value;
      if (target <= monoNs) return;
      const wake = yield* Deferred.make<void>();
      yield* Ref.update(sleepers, (held) => [...held, { target, wake }]);
      yield* Deferred.await(wake);
    }),
  };
  return {
    clock,
    stepWall: (ms: number) =>
      Effect.sync(() => {
        wallMs += ms;
      }),
    stepMono: Effect.fnUntraced(function* (ns: bigint) {
      monoNs += ns;
      const due = (yield* Ref.get(sleepers)).filter((sleeper) => sleeper.target <= monoNs);
      yield* Ref.update(sleepers, (held) => held.filter((sleeper) => sleeper.target > monoNs));
      for (const sleeper of due) yield* Deferred.succeed(sleeper.wake, undefined);
    }),
    fireEarly: Effect.fnUntraced(function* (ns: bigint) {
      monoNs += ns;
      const woken = yield* Ref.getAndSet(sleepers, []);
      for (const sleeper of woken) yield* Deferred.succeed(sleeper.wake, undefined);
    }),
  };
});

const withCalls = Effect.fnUntraced(function* <A, E, R>(body: (calls: CallLifetimes, time: Time) => Effect.Effect<A, E, R>) {
  const time = yield* manualClock;
  return yield* Effect.flatMap(makeCallLifetimes.pipe(Effect.provideService(ExecutionStore, stubStore)), (calls) => body(calls, time)).pipe(
    Effect.provideService(Clock.Clock, time.clock),
  );
}, Effect.scoped);

const decodeExecution = (name: string) =>
  Schema.decodeUnknownEffect(ExecutionRef)({ installation: 'installation-1', execution: name, incarnation: 0 });

const decodeBudget = (timeoutMs: number | undefined) =>
  Schema.decodeUnknownEffect(CallBudget)(timeoutMs === undefined ? {} : { timeoutMs });

const openArmed = Effect.fnUntraced(function* (calls: CallLifetimes, name: string, timeoutMs: number | undefined) {
  const operation = keyOf(name);
  yield* calls.open(operation, yield* decodeExecution(`execution-${name}`), yield* decodeBudget(timeoutMs));
  return { operation, armed: yield* calls.arm(operation) };
});

const timerDecision = Effect.fnUntraced(function* (calls: CallLifetimes, operation: HostRequestRef) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const decision = yield* calls.decision(operation);
    if (decision !== undefined) return decision;
    yield* Effect.yieldNow;
  }
  return yield* calls.decision(operation);
});

const exitZeroSources = Effect.fnUntraced(function* (calls: CallLifetimes, operation: HostRequestRef) {
  yield* calls.settle(operation, { _tag: 'Exit', exit: { _tag: 'Code', code: 0 } });
  yield* calls.settle(operation, { _tag: 'Source', stream: 'stdout', offset: byteOffset(5n), completed: true });
  return yield* calls.settle(operation, { _tag: 'Source', stream: 'stderr', offset: byteOffset(7n), completed: true });
});

describe('CallLifetimes over injected time', () => {
  it.effect('grades nothing on a wall step past the deadline while monotonic time stands still', () =>
    Effect.gen(function* () {
      const decision = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'wall-forward', BUDGET_MS);
          yield* time.stepWall(10_000);
          yield* exitZeroSources(calls, operation);
          return yield* calls.decision(operation);
        }),
      );
      expect(decision?._tag).toBe('Completed');
    }),
  );

  it.effect('expires on monotonic time the wall never saw, even stepped backwards', () =>
    Effect.gen(function* () {
      const decision = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          yield* time.stepWall(100_000);
          const { operation } = yield* openArmed(calls, 'wall-back', BUDGET_MS);
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          yield* time.stepWall(-99_990);
          yield* exitZeroSources(calls, operation);
          return yield* calls.decision(operation);
        }),
      );
      expect(decision?._tag).toBe('Cancelled');
      if (decision?._tag === 'Cancelled') expect(decision.cause).toBe('timeout');
    }),
  );

  it.effect('ends the call on the deadline timer alone, with no event settled by hand', () =>
    Effect.gen(function* () {
      const decision = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'timer-alone', BUDGET_MS);
          yield* Effect.yieldNow;
          yield* time.stepMono(BUDGET_NS);
          return yield* timerDecision(calls, operation);
        }),
      );
      expect(decision?._tag).toBe('Cancelled');
      if (decision?._tag === 'Cancelled') expect(decision.cause).toBe('timeout');
    }),
  );

  it.effect('waits out an instant its timer woke short of, instead of retiring with the call undecided', () =>
    Effect.gen(function* () {
      const SHORT_NS = 300_000n;
      const answer = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'woke-short', BUDGET_MS);
          yield* Effect.yieldNow;
          yield* time.fireEarly(BUDGET_NS - SHORT_NS);
          const early = yield* timerDecision(calls, operation);
          yield* time.stepMono(SHORT_NS);
          return { early, reached: yield* timerDecision(calls, operation) };
        }),
      );
      expect(answer.early).toBeUndefined();
      expect(answer.reached?._tag).toBe('Cancelled');
      if (answer.reached?._tag === 'Cancelled') expect(answer.reached.cause).toBe('timeout');
    }),
  );

  it.effect('reports elapsed time from the host monotonic clock rather than its wall stamp', () =>
    Effect.gen(function* () {
      const reading = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'elapsed-reading', BUDGET_MS);
          yield* time.stepMono(10_000_000n);
          yield* time.stepWall(100_000);
          return yield* calls.deadline(operation);
        }),
      );
      expect(reading.armed).toBe(true);
      expect(reading.elapsedMs).toBe(10);
    }),
  );

  it.effect('stops the elapsed reading at the decision, however long the call is read after it', () =>
    Effect.gen(function* () {
      const reading = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'elapsed-ended', BUDGET_MS);
          yield* time.stepMono(30_000_000n);
          const ended = yield* exitZeroSources(calls, operation);
          yield* time.stepMono(240_000_000_000n);
          return { decision: ended?.decision._tag, deadline: yield* calls.deadline(operation) };
        }),
      );
      expect(reading.decision).toBe('Completed');
      expect(reading.deadline.elapsedMs).toBe(30);
    }),
  );

  it.effect('leaves the standing deadline untouched when arming again', () =>
    Effect.gen(function* () {
      const armed = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation, armed: first } = yield* openArmed(calls, 'no-reset', BUDGET_MS);
          yield* time.stepMono(10_000_000n);
          const second = yield* calls.arm(operation);
          return { first, second, readBack: (yield* calls.deadline(operation)).wallExpiresAt };
        }),
      );
      expect(armed.second).toBe(armed.first);
      expect(armed.readBack).toBe(armed.first);
    }),
  );

  it.effect('gives the equality boundary at the armed instant to the deadline', () =>
    Effect.gen(function* () {
      const answer = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'equality', BUDGET_MS);
          yield* time.stepMono(BUDGET_NS);
          return yield* calls.settle(operation, { _tag: 'Cancel', cause: 'run-abort', trigger: 'producer' });
        }),
      );
      expect(answer?.made).toBe(true);
      expect(answer?.decision._tag).toBe('Cancelled');
      if (answer?.decision._tag === 'Cancelled') expect(answer.decision.cause).toBe('timeout');
    }),
  );

  it.effect('lets one decision win between timeout and run-abort, in both orders', () =>
    Effect.gen(function* () {
      const abortFirst = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'abort-first', BUDGET_MS);
          const first = yield* calls.settle(operation, { _tag: 'Cancel', cause: 'run-abort', trigger: 'producer' });
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const second = yield* calls.settle(operation, { _tag: 'Deadline' });
          return { first, second };
        }),
      );
      expect(abortFirst.first?.made).toBe(true);
      expect(abortFirst.second?.made).toBe(false);
      expect(abortFirst.second?.decision.sequence).toBe(abortFirst.first?.decision.sequence);
      if (abortFirst.second?.decision._tag === 'Cancelled') expect(abortFirst.second.decision.cause).toBe('run-abort');

      const deadlineFirst = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'deadline-first', BUDGET_MS);
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const first = yield* calls.settle(operation, { _tag: 'Deadline' });
          const second = yield* calls.settle(operation, { _tag: 'Cancel', cause: 'run-abort', trigger: 'producer' });
          return { first, second };
        }),
      );
      expect(deadlineFirst.first?.made).toBe(true);
      expect(deadlineFirst.second?.made).toBe(false);
      expect(deadlineFirst.second?.decision.sequence).toBe(deadlineFirst.first?.decision.sequence);
      if (deadlineFirst.second?.decision._tag === 'Cancelled') expect(deadlineFirst.second.decision.cause).toBe('timeout');
    }),
  );

  it.effect('lets one decision win between timeout and completion, in both orders', () =>
    Effect.gen(function* () {
      const completedFirst = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'completed-first', BUDGET_MS);
          const made = yield* exitZeroSources(calls, operation);
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const late = yield* calls.settle(operation, { _tag: 'Deadline' });
          return { made, late };
        }),
      );
      expect(completedFirst.made?.made).toBe(true);
      expect(completedFirst.made?.decision._tag).toBe('Completed');
      expect(completedFirst.late?.made).toBe(false);
      expect(completedFirst.late?.decision.sequence).toBe(completedFirst.made?.decision.sequence);

      const expiredFirst = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'expired-first', BUDGET_MS);
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const first = yield* calls.settle(operation, { _tag: 'Deadline' });
          const late = yield* exitZeroSources(calls, operation);
          return { first, late };
        }),
      );
      expect(expiredFirst.first?.decision._tag).toBe('Cancelled');
      expect(expiredFirst.late?.made).toBe(false);
      expect(expiredFirst.late?.decision.sequence).toBe(expiredFirst.first?.decision.sequence);
    }),
  );

  it.effect('keeps a timeout a native zero arrives under, with the exit still observable', () =>
    Effect.gen(function* () {
      const outcome = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'zero-after-timeout', BUDGET_MS);
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const first = yield* calls.settle(operation, { _tag: 'Deadline' });
          const late = yield* exitZeroSources(calls, operation);
          const result = yield* calls.result(operation, 'complete', 'retained', {
            _tag: 'Measured',
            cpuMicros: 67_825,
            peakRssBytes: 2_015_232,
          });
          return { first, late, result };
        }),
      );
      expect(outcome.first?.decision._tag).toBe('Cancelled');
      expect(outcome.late?.made).toBe(false);
      expect(outcome.late?.decision.sequence).toBe(outcome.first?.decision.sequence);
      expect(outcome.result._tag).toBe('Decided');
      if (outcome.result._tag === 'Decided') {
        expect(outcome.result.decision._tag).toBe('Cancelled');
        expect(outcome.result.nativeExit).toEqual({ _tag: 'Code', code: 0 });
      }
    }),
  );

  it.effect('decides nothing while only the exit is in and a source stays open', () =>
    Effect.gen(function* () {
      const outcome = yield* withCalls((calls, time) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'exit-alone', BUDGET_MS);
          const open = yield* calls.settle(operation, { _tag: 'Exit', exit: { _tag: 'Code', code: 0 } });
          yield* time.stepMono(BUDGET_NS + 10_000_000n);
          const expired = yield* calls.settle(operation, { _tag: 'Deadline' });
          return { open, expired };
        }),
      );
      expect(outcome.open).toBeUndefined();
      expect(outcome.expired?.made).toBe(true);
      expect(outcome.expired?.decision._tag).toBe('Cancelled');
      if (outcome.expired?.decision._tag === 'Cancelled') expect(outcome.expired.decision.cause).toBe('timeout');
    }),
  );

  it.effect('reads a pre-deadline foreign signal with completed sources as a native outcome', () =>
    Effect.gen(function* () {
      const decision = yield* withCalls((calls) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'foreign-signal', BUDGET_MS);
          yield* calls.settle(operation, { _tag: 'Exit', exit: { _tag: 'Signal', signal: 'SIGTERM' } });
          yield* calls.settle(operation, { _tag: 'Source', stream: 'stdout', offset: byteOffset(5n), completed: true });
          yield* calls.settle(operation, { _tag: 'Source', stream: 'stderr', offset: byteOffset(7n), completed: true });
          return yield* calls.decision(operation);
        }),
      );
      expect(decision?._tag).toBe('Completed');
    }),
  );

  it.effect('decides custodian loss as caller-lost, not user intent', () =>
    Effect.gen(function* () {
      const answer = yield* withCalls((calls) =>
        Effect.gen(function* () {
          const { operation } = yield* openArmed(calls, 'caller-lost', BUDGET_MS);
          return yield* calls.settle(operation, { _tag: 'Cancel', cause: 'caller-lost', trigger: 'custodian-gone' });
        }),
      );
      expect(answer?.made).toBe(true);
      expect(answer?.decision._tag).toBe('Cancelled');
      if (answer?.decision._tag === 'Cancelled') {
        expect(answer.decision.cause).toBe('caller-lost');
        expect(answer.decision.trigger).toBe('custodian-gone');
      }
    }),
  );
});

const revisingStore = () => {
  const revisions = new Map<string, CommandRevisionRecord>();
  return ExecutionStore.of({
    ...stubStore,
    recordRevision: (request) =>
      Effect.sync(() => {
        revisions.set(request.operation.operation, { ...request, outcome: 'pending' });
        return { _tag: 'Recorded' } as const;
      }),
    resolveRevision: (operation, outcome) =>
      Effect.suspend(() => {
        const standing = revisions.get(operation.operation);
        if (standing === undefined) return Effect.die('the revision must be recorded before resolution');
        const resolved: CommandRevisionRecord = { ...standing, outcome };
        revisions.set(operation.operation, resolved);
        return Effect.succeed(resolved);
      }),
  });
};

describe('a default deadline moved by program rules', () => {
  it.effect('keeps the default origin across the watcher revision, and a caller revising over it turns it into the caller', () =>
    Effect.gen(function* () {
      const [extended, stale, taken] = yield* Effect.gen(function* () {
        const calls = yield* makeCallLifetimes.pipe(Effect.provideService(ExecutionStore, revisingStore()));
        const operation = keyOf('default-extended');
        const execution = yield* decodeExecution('execution-default-extended');
        yield* calls.open(operation, execution, yield* decodeBudget(600_000), { origin: 'default' });
        yield* calls.arm(operation);
        const ask = (name: string, expected: number, executionMs: number) => ({
          operation: keyOf(name),
          execution,
          expected,
          change: { _tag: 'Total' as const, executionMs },
          actor: 'host',
          cause: 'rule',
        });
        const extended = yield* calls.revise(operation, ask('extend', 0, 1_200_000), 'default');
        const stale = yield* calls.revise(operation, ask('caller-stale', 0, 900_000));
        const taken = yield* calls.revise(operation, ask('caller-over', 1, 900_000));
        return [extended, stale, taken] as const;
      });
      expect(extended._tag === 'Revised' ? [extended.deadline.origin, extended.deadline.executionMs] : extended._tag).toEqual([
        'default',
        1_200_000,
      ]);
      expect(stale._tag).toBe('Stale');
      expect(taken._tag === 'Revised' ? taken.deadline.origin : taken._tag).toBe('caller');
    }),
  );
});
