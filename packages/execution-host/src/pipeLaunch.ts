import { Effect, Result, type Scope } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { Capability } from '@runlith/executions/protocol/capability';
import type { NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import type { StdinPolicy } from '@runlith/executions/protocol/launch';
import type { EndedAt } from '@runlith/executions/protocol/stop';
import { climb, type LadderAim, type Opening } from '@runlith/executions/stopLadder';
import { InputActUnsupported, InputWriteFailed, type InputSink } from './ExecutionInput';
import type { EndingReason, NativeEnding, StopTarget } from './ExecutionStop';
import type { WorkState, HeldExecution } from './holder/Holder';
import { type ProvenSet, type Descendant, type ProcessTables, makeProvenSet } from './ProvenSet';
import {
  witnessOf,
  exitOf,
  ladderOver,
  leaderAim,
  leaderSignal,
  workAim,
  LEADER,
  LEADER_AND_WORK,
  reapedCost,
  sourceOf,
  stepOf,
  unmeasured,
  withAncestry,
  writeOnce,
  type NativeExecution,
} from './nativeLaunch';

type PipeOpening = Extract<Opening, 'interrupt' | 'terminate' | 'kill'>;

type Climbed = {
  readonly steps: ReadonlyArray<StopStep>;
  readonly leader: EndedAt | undefined;
  readonly group: EndedAt | undefined;
};

const costing = (held: HeldExecution) => {
  let measured: ProcessCost | undefined;
  return Effect.suspend(() => {
    if (measured !== undefined) return Effect.succeed(measured);
    if (held.reaped !== undefined) return Effect.succeed(held.reaped.cost);
    return Effect.gen(function* () {
      const exit = yield* held.observed;
      const group = exit === undefined ? 'standing' : yield* held.workState;
      if (exit === undefined || group !== 'ended') {
        return {
          _tag: 'Unmeasured',
          reason: 'unknown',
          detail: 'the child is retained until its process group is settled',
        } satisfies ProcessCost;
      }
      const cost = yield* reapedCost(held);
      if (cost._tag === 'Measured') measured = cost;
      return cost;
    });
  });
};

const climbOver = (
  held: HeldExecution,
  extra: ReadonlyArray<LadderAim>,
  first: PipeOpening,
  tables: ProcessTables | undefined,
  proven?: ProvenSet,
) =>
  Effect.map(
    climb(first, [{ send: () => Effect.void, gone: leaderAim(held, tables).gone }, workAim(held, proven, tables?.control), ...extra]),
    (climbed): Climbed => ({
      steps: climbed.steps,
      leader: climbed.endedAt[0],
      group: climbed.endedAt[1],
    }),
  );

const groupEnding = (held: HeldExecution, exit: NativeExit, climbed: Climbed, cost: ProcessCost, group: WorkState): NativeEnding => {
  const steps = climbed.steps;
  const leader = { pid: held.pid, relation: 'leader' as const, exit, step: stepOf(climbed.leader, steps) };
  if (group === 'unmeasured') {
    return {
      exit,
      measured: LEADER,
      confirmed: [leader],
      residual: [],
      abandonedOutput: false,
      cost,
      steps,
      unverifiable: [{ kind: 'process', detail: `process group ${held.work}`, reason: 'the retained group could not be measured' }],
    };
  }
  return group === 'ended'
    ? {
        exit,
        measured: LEADER_AND_WORK,
        confirmed: [leader, { pid: held.work, relation: 'work' as const, exit, step: stepOf(climbed.group, steps) }],
        residual: [],
        unverifiable: [],
        abandonedOutput: false,
        cost,
        steps,
      }
    : {
        exit,
        measured: LEADER_AND_WORK,
        confirmed: [leader],
        residual: [
          {
            kind: 'process',
            detail:
              steps.length === 0
                ? `the retained process group ${held.work} still contains work`
                : `the retained process group ${held.work} still contains work after ${steps.join(' then ')}`,
            pid: held.work,
            relation: 'work',
          },
        ],
        unverifiable: [],
        abandonedOutput: false,
        cost,
        steps,
      };
};

const stopPipes = Effect.fnUntraced(function* (
  held: HeldExecution,
  proven: ProvenSet | undefined,
  reason: EndingReason,
  tables: ProcessTables | undefined,
  cost: Effect.Effect<ProcessCost>,
  graceful: boolean,
): Effect.fn.Return<NativeEnding> {
  const ladder = yield* ladderOver(proven, reason);
  const climbed = yield* climbOver(
    held,
    ladder === undefined ? [] : [ladder.aim],
    !graceful ? 'kill' : reason === 'ended' || (yield* held.observed) !== undefined ? 'terminate' : 'interrupt',
    tables,
    proven,
  );
  const settled = yield* Effect.result(held.observe);
  const group = yield* held.workState;
  const ending = Result.isFailure(settled)
    ? unmeasured(held.pid, `the stop could not read an exit: ${settled.failure.detail}`, climbed.steps)
    : settled.success === undefined
      ? unmeasured(held.pid, 'the stop could not read an exit: the child reported no exit by the end of the stop ladder', climbed.steps)
      : groupEnding(held, settled.success, climbed, yield* cost, group);
  const standing = ending.exit === undefined && !(yield* workAim(held, proven, tables?.control).gone);
  return yield* withAncestry(
    standing
      ? {
          ...ending,
          residual: [
            {
              kind: 'process',
              pid: held.work,
              relation: 'work',
              detail: 'the execution work did not settle by the end of its stop ladder',
            },
          ],
        }
      : ending,
    ladder,
  );
});

const unsupported = (act: 'interrupt' | 'resize') =>
  new InputActUnsupported({ act, reason: 'transport', detail: 'this execution runs over pipes, which have no terminal line discipline' });

export const retirePipes = Effect.fnUntraced(function* (
  held: HeldExecution,
  tables: ProcessTables | undefined,
  capabilities: ReadonlySet<Capability>,
): Effect.fn.Return<void> {
  const first: PipeOpening = !capabilities.has('pipe-graceful-stop')
    ? 'kill'
    : (yield* held.observed) === undefined
      ? 'interrupt'
      : 'terminate';
  if (held.reaped === undefined) {
    yield* climbOver(held, [], first, tables);
    const checked = yield* Effect.result(held.observe);
    if ((yield* held.workState) !== 'ended' && (Result.isSuccess(checked) || checked.failure.reason !== 'lost')) {
      yield* Effect.logWarning(`the holder retains ${held.id} (pid ${held.pid}): its work did not settle`);
      return;
    }
    const reaped = yield* Effect.result(held.reap);
    if (Result.isFailure(reaped) && reaped.failure.reason !== 'lost') {
      yield* Effect.logWarning(`the holder retains ${held.id} (pid ${held.pid}): ${reaped.failure.detail}`);
      return;
    }
  }
  const released = yield* Effect.result(held.release);
  if (Result.isFailure(released) && released.failure.reason !== 'lost') {
    yield* Effect.logWarning(`the holder did not release ${held.id}: ${released.failure.detail}`);
  }
});

export const pipeExecution = Effect.fnUntraced(function* (
  held: HeldExecution,
  policy: StdinPolicy,
  tables: ProcessTables | undefined,
  capabilities: ReadonlySet<Capability>,
  remembered: ReadonlyArray<Descendant> = [],
): Effect.fn.Return<NativeExecution, never, Scope.Scope> {
  const channels = held.channels._tag === 'pipes' ? held.channels : undefined;
  const stdin = policy;
  const witness = witnessOf(held);
  const proven =
    tables === undefined ? undefined : yield* makeProvenSet({ tables, leader: held.pid, birth: held.birth, work: held.work, remembered });
  const cost = costing(held);
  const input = channels?.stdin;
  const sink: InputSink = {
    initiallyClosed: input === undefined,
    write:
      input === undefined
        ? () =>
            Effect.fail(new InputWriteFailed({ reason: 'closed', detail: `stdin policy is ${stdin}; the child has no pipe to write to` }))
        : writeOnce(input),
    stop: input === undefined ? Effect.void : input.stopWriting,
    interrupt: () => Effect.fail(unsupported('interrupt')),
    resize: () => Effect.fail(unsupported('resize')),
    end:
      stdin === 'pipe'
        ? {
            _tag: 'Closes',
            close: () =>
              held.closeInput.pipe(Effect.mapError((failure) => new InputWriteFailed({ reason: 'closed', detail: failure.detail }))),
          }
        : {
            _tag: 'Unsupported',
            refusal: new InputActUnsupported({
              act: 'end',
              reason: 'transport',
              detail: `this execution was given stdin ${stdin}, so it holds no input pipe of this host's to close`,
            }),
          },
  };
  const attempts: ReadonlyArray<NativeRelation> = ['leader', 'work', ...(tables === undefined ? [] : (['ancestry'] as const))];
  const target: StopTarget = {
    relations: attempts,
    identity: () => Effect.succeed({ pid: held.pid }),
    signal: (name) =>
      Effect.map(leaderSignal(held, tables, name), (sent) =>
        sent === 'delivered'
          ? { delivered: true, pid: held.pid, reason: undefined, detail: '' }
          : {
              delivered: false,
              pid: held.pid,
              reason: sent === 'unsupported' ? ('unsupported' as const) : sent === 'reaped' ? ('exited' as const) : ('os' as const),
              detail: `${name} was not delivered to pid ${held.pid}`,
            },
      ),
    end: (_action, _observed, reason) => stopPipes(held, proven, reason, tables, cost, capabilities.has('pipe-graceful-stop')),
  };
  return {
    transport: 'pipes',
    held,
    identity: { pid: held.pid },
    witness,
    proven,
    pace: held.pace,
    sink,
    target,
    releaseOutput: Effect.gen(function* () {
      const output = yield* Effect.result(held.closeOutput);
      const closed = channels?.stdin === undefined ? undefined : yield* Effect.result(held.closeInput);
      return (
        (Result.isSuccess(output) || output.failure.reason === 'lost') &&
        (closed === undefined || Result.isSuccess(closed) || closed.failure.reason === 'lost')
      );
    }),
    sources: channels === undefined ? [] : [sourceOf('pipes', 'stdout', channels.stdout), sourceOf('pipes', 'stderr', channels.stderr)],
    pendingEchoes: Effect.succeed([]),
    owe: () => Effect.void,
    exit: exitOf(held, 'pipes', tables),
    cost,
  } satisfies NativeExecution;
});
