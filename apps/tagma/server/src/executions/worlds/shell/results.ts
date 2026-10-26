import { Effect, Fiber, type Result, Stream } from 'effect';
import {
  CommandRefused,
  CommandUnreadable,
  type CommandPhase,
  type CommandRunDeadline,
  type RuledAnswer,
} from '@runlith/agent-tools/CommandWork';
import type { Commands } from '@runlith/executions/Commands';
import type { Executions, ExecutionsFailure } from '@runlith/executions/Executions';
import type { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import type { CallDecisionAnswer } from '@runlith/executions/protocol/call';
import type { CommandDeadline, CommandSnapshot } from '@runlith/executions/protocol/command';
import type { StopReceipt } from '@runlith/executions/protocol/stop';
import type { ExecutionPhase, ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { type ByteOffset, byteOffset, offsetValue } from '@runlith/executions/protocol/record';
import type { Refusal } from '@runlith/executions/protocol/host';
import type { StartAnswer } from '@runlith/executions/protocol/launch';
import type { CommandPolicyReceipt } from '../../contract/wire/commands.js';
import { TerminalRefused, hostRefusalReason } from '../../contract/wire/refusals.js';
import type { WorldLease } from '../../contract/service/worlds.js';
import { terminalRefusal } from '../../terminals/refusal.js';
import { copyHead } from '../../commands/ruleResolution.js';

export const runDeadlineOf = (deadline: CommandDeadline): CommandRunDeadline =>
  deadline.executionMs === undefined
    ? { state: 'none' }
    : { state: deadline.armed === undefined ? 'unarmed' : 'armed', timeoutMs: deadline.executionMs, origin: deadline.origin };

export const withEnding = (result: Extract<RuledAnswer, { readonly _tag: 'Decided' }>, receipt: StopReceipt): RuledAnswer => ({
  ...result,
  cleanup: receipt.cleanup,
  retention: receipt.retention,
  cost: receipt.cost,
});

export const refusalText = (failure: { readonly _tag: string }): string => {
  const spoken = failure as { readonly message?: unknown; readonly reason?: unknown };
  if (typeof spoken.message === 'string' && spoken.message !== '') return spoken.message;
  if (typeof spoken.reason === 'string' && spoken.reason !== '') return spoken.reason;
  return failure._tag;
};

const refusalOf = (refusal: { readonly _tag: string }): string => {
  const spoken = refusal as { readonly reason?: unknown };
  return typeof spoken.reason === 'string' && spoken.reason !== '' ? spoken.reason : 'no reason was given';
};

const refusedWithWayOut = (refusal: Refusal): string => {
  const gate = terminalRefusal(new TerminalRefused({ reason: hostRefusalReason[refusal._tag], message: refusalOf(refusal) }));
  return `the execution host refused this command — ${gate.code}: ${gate.reason}\n${gate.unblock
    .map((way) => `unblock: ${way}`)
    .join('\n')}`;
};

export const wireRefusal = (operation: HostRequestRef, failure: ExecutionsFailure): CommandRefused =>
  failure._tag === 'HostRefused'
    ? new CommandRefused({
        reason: refusedWithWayOut(failure.refusal),
        certainty: 'unsubmitted',
        operation,
      })
    : (failure._tag === 'WireLost' || failure._tag === 'WireUnavailable') && failure.sent === false
      ? new CommandRefused({
          reason: `this command never left this process: ${failure.reason}`,
          certainty: 'unsubmitted',
          operation,
        })
      : new CommandRefused({
          reason: `the execution host could not be reached: ${failure._tag}`,
          certainty: 'uncertain',
          operation,
        });

export const accepted = (operation: HostRequestRef, outcome: StartAnswer): Effect.Effect<ExecutionRef, CommandRefused> => {
  if (outcome._tag === 'Accepted' || outcome._tag === 'Started') return Effect.succeed(outcome.execution);
  if (outcome._tag === 'Refused') {
    return Effect.fail(
      new CommandRefused({
        reason: refusedWithWayOut(outcome.refusal),
        certainty: 'unsubmitted',
        operation,
      }),
    );
  }
  if (outcome._tag === 'Cancelled') {
    return Effect.fail(
      new CommandRefused({
        reason: 'a cancellation of this key won before the command started',
        certainty: 'unsubmitted',
        operation,
      }),
    );
  }
  const effect = outcome.effect;
  const said = effect._tag === 'NativeFailed' || effect._tag === 'StoreFailed' ? `${effect._tag}: ${effect.reason}` : effect._tag;
  return Effect.fail(
    new CommandRefused({
      reason: `whether this command started could not be established — ${said}`,
      certainty: 'uncertain',
      operation,
      execution: outcome.effect._tag !== 'InFlight' && outcome.effect.execution !== undefined ? outcome.effect.execution : undefined,
    }),
  );
};

export const commandPhase = Effect.fnUntraced(function* (
  executions: Executions['Service'] & Commands['Service'],
  execution: ExecutionRef,
): Effect.fn.Return<CommandPhase, CommandUnreadable> {
  const live = yield* executions
    .state(execution)
    .pipe(Effect.mapError((failure) => new CommandUnreadable({ reason: `the host could not be read: ${failure._tag}` })));
  if (live !== undefined) return phaseOf(live.state.phase);
  const admitted = yield* executions
    .command(execution)
    .pipe(Effect.mapError((failure) => new CommandUnreadable({ reason: `the host could not be read: ${failure._tag}` })));
  if (admitted === undefined) {
    return yield* new CommandUnreadable({ reason: 'the host holds nothing under this reference' });
  }
  return phaseOf(admitted.state.phase);
});

const phaseOf = (phase: ExecutionPhase): CommandPhase =>
  phase === 'ended' ? 'ended' : phase === 'queued' || phase === 'reserved' ? 'queued' : 'running';

export const decidingRule = (receipt: CommandPolicyReceipt): string | undefined => {
  const copy = receipt.time.rules[0];
  return copy === undefined || receipt.limits.origin !== 'rule' ? undefined : copyHead(copy, 'life');
};

export const deadlineOf = (snapshot: Result.Result<CommandSnapshot | undefined, unknown>): CommandRunDeadline => {
  if (snapshot._tag === 'Failure' || snapshot.success === undefined) return { state: 'unreadable' };
  return runDeadlineOf(snapshot.success.deadline);
};

export const decided = (
  executions: ExecutionFeed['Service'],
  operation: HostRequestRef,
  execution: ExecutionRef,
  credits: number,
): Effect.Effect<RuledAnswer, CommandUnreadable> => {
  let ending: string | undefined;
  let last: ExecutionSummary | undefined;
  return executions.subscribe({ _tag: 'State', execution }, credits).pipe(
    Stream.tap((delivery) =>
      Effect.sync(() => {
        if (delivery._tag === 'Ended') ending = delivery.ending;
        if (delivery._tag === 'State') last = delivery.summary;
      }),
    ),
    Stream.filter(
      (delivery): delivery is Extract<typeof delivery, { readonly _tag: 'State' }> => delivery._tag === 'State' && ended(delivery.summary),
    ),
    Stream.map((delivery) => commandResult(operation, execution, delivery.summary)),
    Stream.runHead,
    Effect.mapError((failure) => new CommandUnreadable({ reason: `the host stopped answering: ${failure._tag}` })),
    Effect.map((found) =>
      found._tag === 'Some'
        ? found.value
        : ending === 'completed' && last?.state.phase === 'ended'
          ? commandResult(operation, execution, last)
          : ({
              _tag: 'Unavailable',
              operation,
              execution,
              reason: `the state of this command stopped arriving before it was decided: its subscription ended ${ending ?? 'without saying why'}`,
            } satisfies CallDecisionAnswer),
    ),
  );
};

const ended = (summary: ExecutionSummary): boolean => summary.decision !== undefined || summary.state.unacquired !== undefined;

export const commandResult = (operation: HostRequestRef, execution: ExecutionRef, summary: ExecutionSummary): RuledAnswer => {
  const result = callResultOf(operation, execution, summary);
  const processes = summary.processes;
  return processes === undefined || (processes.rulings.length === 0 && processes.omitted === 0)
    ? result
    : { ...result, ruled: { rulings: processes.rulings, omitted: processes.omitted } };
};

const callResultOf = (operation: HostRequestRef, execution: ExecutionRef, summary: ExecutionSummary): CallDecisionAnswer => {
  const decision = summary.decision;
  const at = (stream: 'stdout' | 'stderr') => {
    const found = summary.streams.find((position) => position.stream === stream);
    return {
      completed: summary.state.streams[stream] !== 'open',
      offset: found?.durableThrough ?? ('0' as never),
    };
  };
  const measured = {
    sources: { stdout: at('stdout'), stderr: at('stderr') },
    cleanup: summary.state.cleanup,
    retention: summary.state.record === 'available' ? 'retained' : summary.state.record === 'gapped' ? 'partial' : 'lost',
    cost: summary.cost ?? { _tag: 'Unmeasured', reason: 'unknown', detail: 'the host has not measured this ending' },
  } as const;
  if (decision === undefined) {
    const exit = summary.state.nativeExit;
    return exit === undefined
      ? {
          _tag: 'Unavailable',
          operation,
          execution,
          reason:
            summary.state.unacquired === undefined
              ? 'this command ended, and the host reported neither a decision nor an exit for it'
              : `this command never started: ${summary.state.unacquired}`,
        }
      : { _tag: 'Undecided', operation, execution, nativeExit: exit, ...measured };
  }
  return {
    _tag: 'Decided',
    decision,
    nativeExit: summary.state.nativeExit,
    ...measured,
  };
};

export const bytes = (
  executions: ExecutionFeed['Service'] & Executions['Service'],
  execution: ExecutionRef,
  stream: 'stdout' | 'stderr',
  credits: number,
): Stream.Stream<Uint8Array, CommandUnreadable> => following(executions, execution, stream, credits, byteOffset(0n));

const following = (
  executions: ExecutionFeed['Service'] & Executions['Service'],
  execution: ExecutionRef,
  stream: 'stdout' | 'stderr',
  credits: number,
  from: ByteOffset,
): Stream.Stream<Uint8Array, CommandUnreadable> => {
  let gapped = false;
  const read = executions.subscribe({ _tag: 'Bytes', cursor: { ref: execution, stream, offset: from } }, credits).pipe(
    Stream.mapError((failure) => new CommandUnreadable({ reason: `${stream} stopped answering: ${failure._tag}` })),
    Stream.mapEffect((delivery) => {
      if (delivery._tag === 'Bytes') return Effect.succeed(delivery.bytes);
      if (delivery._tag !== 'Ended' || delivery.ending === 'completed' || delivery.ending === 'cancelled') return Effect.succeed(undefined);
      if (delivery.ending !== 'gap')
        return Effect.fail(new CommandUnreadable({ reason: `the record stopped answering: ${delivery.ending}` }));
      gapped = true;
      return Effect.succeed(undefined);
    }),
    Stream.filter((chunk): chunk is Uint8Array => chunk !== undefined),
  );
  return Stream.concat(
    read,
    Stream.suspend(() =>
      gapped
        ? Stream.unwrap(
            Effect.map(retainedFrom(executions, execution, stream, from), (next) =>
              following(executions, execution, stream, credits, next),
            ),
          )
        : Stream.empty,
    ),
  );
};

const retainedFrom = (
  executions: Executions['Service'],
  execution: ExecutionRef,
  stream: 'stdout' | 'stderr',
  from: ByteOffset,
): Effect.Effect<ByteOffset, CommandUnreadable> =>
  executions.state(execution).pipe(
    Effect.mapError(
      (failure) => new CommandUnreadable({ reason: `${stream} outran its record and its state could not be read: ${failure._tag}` }),
    ),
    Effect.flatMap((summary) => {
      const positions = summary?.streams.find((position) => position.stream === stream);
      if (positions === undefined) {
        return Effect.fail(new CommandUnreadable({ reason: `${stream} outran its record, and the host no longer names where it resumes` }));
      }
      return offsetValue(positions.retainedFrom) > offsetValue(from)
        ? Effect.succeed(positions.retainedFrom)
        : Effect.fail(new CommandUnreadable({ reason: `${stream} outran its record, and the host names no later byte to resume at` }));
    }),
  );

export const watching = <A>(observation: Effect.Effect<A>, lease: WorldLease): Effect.Effect<Effect.Effect<A, CommandUnreadable>> =>
  Effect.map(Effect.forkIn(observation.pipe(Effect.ensuring(lease.release)), lease.scope), (fiber) =>
    Fiber.await(fiber).pipe(
      Effect.flatMap((exit) =>
        exit._tag === 'Success'
          ? Effect.succeed(exit.value)
          : Effect.fail(new CommandUnreadable({ reason: 'the observation of this command was released with its world' })),
      ),
    ),
  );
