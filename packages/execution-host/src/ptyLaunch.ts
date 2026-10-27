import { Effect, Result, type Scope } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { NativeExit, ProcessCost } from '@runlith/executions/protocol/execution';
import type { EndedAt, ResidualResource, StopAction, UnverifiableResource } from '@runlith/executions/protocol/stop';
import { climb, type LadderAim } from '@runlith/executions/stopLadder';
import { InputActUnsupported, InputWriteFailed, type InputSink } from './ExecutionInput';
import { terminalSink } from './TerminalInputs';
import type { EndingReason, NativeEnding, StopTarget } from './ExecutionStop';
import type { HeldExecution, Terminal } from './holder/Holder';
import { type ProvenSet, type Descendant, type ProcessTables, makeProvenSet } from './ProvenSet';
import {
  witnessOf,
  exitOf,
  ladderOver,
  leaderAim,
  leaderSend,
  leaderSignal,
  workAim,
  LEADER,
  LEADER_AND_ANCESTRY,
  reapedCost,
  sourceOf,
  stepOf,
  unmeasured,
  withAncestry,
  type NativeExecution,
} from './nativeLaunch';

type Stopped = { readonly exit: NativeExit; readonly steps: ReadonlyArray<StopStep>; readonly step: EndedAt };
type StopFailed = { readonly reason: 'unreaped' | 'unmeasured' | 'os'; readonly detail: string; readonly steps: ReadonlyArray<StopStep> };

const closedTerminal = () => new InputWriteFailed({ reason: 'closed', detail: 'the terminal of this execution was closed' });

const hangUp = (held: HeldExecution): Effect.Effect<boolean> =>
  Effect.map(Effect.result(held.closeInput), (closed) => Result.isSuccess(closed) || closed.failure.reason === 'lost');

const costing = (held: HeldExecution) => {
  let measured: ProcessCost | undefined;
  return Effect.suspend(() =>
    measured !== undefined
      ? Effect.succeed(measured)
      : held.reaped !== undefined
        ? Effect.succeed(held.reaped.cost)
        : Effect.gen(function* () {
            const exit = yield* held.observed;
            if (exit === undefined || (yield* held.workState) !== 'ended')
              return {
                _tag: 'Unmeasured',
                reason: 'unknown',
                detail: 'the work is retained until its processes are settled',
              } satisfies ProcessCost;
            const cost = yield* reapedCost(held);
            if (cost._tag === 'Measured') measured = cost;
            return cost;
          }),
  );
};

const destroy = Effect.fnUntraced(function* (held: HeldExecution, extra: ReadonlyArray<LadderAim>, tables: ProcessTables | undefined) {
  let closed = true;
  const climbed = yield* climb(
    (yield* held.observed) === undefined ? 'hang-up' : 'terminate',
    [leaderAim(held, tables), ...extra],
    Effect.map(hangUp(held), (done) => {
      closed = done;
    }),
  );
  const observed = yield* Effect.result(held.observe);
  if (!climbed.opened || !closed) {
    return Result.fail<StopFailed>({
      reason: 'os',
      detail: 'the terminal did not close by the end of the stop ladder',
      steps: climbed.steps,
    });
  }
  if (Result.isFailure(observed)) {
    return Result.fail<StopFailed>({
      reason: observed.failure.reason === 'lost' && (yield* leaderAim(held, tables).gone) ? 'unmeasured' : 'os',
      detail: `the exit of pid ${held.pid} could not be read: ${observed.failure.detail}`,
      steps: climbed.steps,
    });
  }
  const exit = observed.success;
  if (exit === undefined) {
    return Result.fail<StopFailed>({
      reason: (yield* leaderAim(held, tables).gone) ? 'unmeasured' : 'unreaped',
      detail: `pid ${held.pid} reported no exit by the end of the stop ladder, after ${climbed.steps.join(' then ')}`,
      steps: climbed.steps,
    });
  }
  return Result.succeed<Stopped>({ exit, steps: climbed.steps, step: climbed.endedAt[0] ?? climbed.steps.at(-1) ?? 'unsignalled' });
});

const gone = (
  pid: number,
  exit: NativeExit,
  abandonedOutput: boolean,
  cost: ProcessCost,
  step: EndedAt,
  steps: ReadonlyArray<StopStep>,
): NativeEnding => ({
  exit,
  measured: LEADER,
  confirmed: [{ pid, relation: 'leader' as const, exit, step }],
  residual: [],
  unverifiable: [],
  abandonedOutput,
  cost,
  steps,
});

const failedEnding = (held: HeldExecution, failure: StopFailed, exit: NativeExit | undefined, cost: ProcessCost): NativeEnding => {
  const residual: ResidualResource[] =
    failure.reason === 'unreaped' ? [{ kind: 'process', detail: failure.detail, pid: held.pid, relation: 'leader' as const }] : [];
  const unverifiable: UnverifiableResource[] =
    failure.reason === 'unreaped'
      ? []
      : [{ kind: failure.reason === 'unmeasured' ? 'process' : 'pty', detail: failure.detail, reason: failure.reason }];
  return {
    exit,
    measured: failure.reason === 'unreaped' || exit !== undefined ? LEADER : [],
    confirmed: exit === undefined ? [] : [{ pid: held.pid, relation: 'leader' as const, exit, step: 'unsignalled' as const }],
    residual,
    unverifiable,
    abandonedOutput: true,
    cost,
    steps: failure.steps,
  };
};

const signalled = Effect.fnUntraced(function* (
  held: HeldExecution,
  extra: ReadonlyArray<LadderAim>,
  tables: ProcessTables | undefined,
  cost: Effect.Effect<ProcessCost>,
) {
  let refused: string | undefined;
  const leader: LadderAim = {
    send: (signal) =>
      Effect.map(leaderSend(held, tables)(signal), (sent) => {
        if (sent === 'refused') refused ??= `${signal} was not delivered to pid ${held.pid}`;
      }),
    gone: leaderAim(held, tables).gone,
  };
  const climbed = yield* climb('hang-up', [leader, ...extra]);
  const settled = yield* Effect.result(held.observe);
  if (Result.isFailure(settled)) return unmeasured(held.pid, `its exit could not be read: ${settled.failure.detail}`, climbed.steps);
  const exit = settled.success;
  if (exit === undefined && refused !== undefined) {
    return {
      exit: undefined,
      measured: LEADER,
      confirmed: [],
      residual: [{ kind: 'process', detail: refused, pid: held.pid, relation: 'leader' }],
      unverifiable: [],
      abandonedOutput: false,
      cost: yield* cost,
      steps: climbed.steps,
    } satisfies NativeEnding;
  }
  return exit !== undefined
    ? gone(held.pid, exit, false, yield* cost, stepOf(climbed.endedAt[0], climbed.steps), climbed.steps)
    : unmeasured(
        held.pid,
        climbed.steps.length === 0
          ? 'its exit could not be read, so nothing was signalled; the terminal was left open'
          : `${climbed.steps.join(' then ')} were sent and no exit was observed by the end of the ladder; the terminal was left open`,
        climbed.steps,
      );
});

const ending = Effect.fnUntraced(function* (
  held: HeldExecution,
  action: StopAction,
  observed: NativeExit | undefined,
  extra: ReadonlyArray<LadderAim>,
  tables: ProcessTables | undefined,
  cost: Effect.Effect<ProcessCost>,
): Effect.fn.Return<NativeEnding> {
  if (action === 'signal') {
    if (observed === undefined) return yield* signalled(held, extra, tables, cost);
    const climbed = extra.length === 0 ? undefined : yield* climb('terminate', extra);
    return gone(held.pid, observed, false, yield* cost, 'unsignalled', climbed?.steps ?? []);
  }
  const stopped = yield* destroy(held, extra, tables);
  if (Result.isFailure(stopped)) return failedEnding(held, stopped.failure, observed, yield* cost);
  return gone(
    held.pid,
    stopped.success.exit,
    true,
    yield* cost,
    observed === undefined ? stopped.success.step : 'unsignalled',
    stopped.success.steps,
  );
});

const closeInput = (held: HeldExecution) => () =>
  held.closeInput.pipe(Effect.mapError((failure) => new InputWriteFailed({ reason: 'closed', detail: failure.detail })));

const sinkOf = (terminal: Terminal | undefined, held: HeldExecution): InputSink =>
  terminal !== undefined
    ? terminalSink(terminal, closeInput(held), () => Effect.void)
    : {
        initiallyClosed: true,
        write: () => Effect.fail(closedTerminal()),
        stop: Effect.void,
        interrupt: () =>
          Effect.fail(
            new InputActUnsupported({ act: 'interrupt', reason: 'unreadable', detail: 'the terminal of this execution was closed' }),
          ),
        resize: () =>
          Effect.fail(
            new InputActUnsupported({ act: 'resize', reason: 'unreadable', detail: 'the terminal of this execution was closed' }),
          ),
        end: { _tag: 'Closes', close: closeInput(held) },
      };

export const retirePty = Effect.fnUntraced(function* (held: HeldExecution, tables: ProcessTables | undefined): Effect.fn.Return<void> {
  if (held.reaped === undefined) {
    const stopped = yield* destroy(held, [workAim(held, undefined, tables?.control)], tables);
    if (Result.isFailure(stopped)) {
      yield* Effect.logWarning(`the holder retains ${held.id} (pid ${held.pid}): ${stopped.failure.detail}`);
    }
    if ((yield* held.workState) !== 'ended') {
      const checked = yield* Effect.result(held.observe);
      if (Result.isSuccess(checked) || checked.failure.reason !== 'lost') {
        yield* Effect.logWarning(`the holder retains ${held.id} (pid ${held.pid}): its work did not settle`);
        return;
      }
    }
    const reaped = yield* Effect.result(held.reap);
    if (Result.isFailure(reaped) && reaped.failure.reason !== 'lost') {
      yield* Effect.logWarning(`the holder retains ${held.id} (pid ${held.pid}): ${reaped.failure.detail}`);
      return;
    }
  }
  yield* hangUp(held);
  const released = yield* Effect.result(held.release);
  if (Result.isFailure(released) && released.failure.reason !== 'lost') {
    yield* Effect.logWarning(`the holder did not release ${held.id}: ${released.failure.detail}`);
  }
});

export const ptyExecution = Effect.fnUntraced(function* (
  held: HeldExecution,
  tables: ProcessTables | undefined,
  remembered: ReadonlyArray<Descendant> = [],
): Effect.fn.Return<NativeExecution, never, Scope.Scope> {
  const terminal = held.channels._tag === 'pty' ? held.channels.terminal : undefined;
  const witness = witnessOf(held);
  const proven =
    tables === undefined ? undefined : yield* makeProvenSet({ tables, leader: held.pid, birth: held.birth, work: undefined, remembered });
  const cost = costing(held);
  const attempts: ReadonlyArray<NativeRelation> = tables === undefined ? LEADER : LEADER_AND_ANCESTRY;
  const identity = { pid: held.pid, terminal: held.terminal };
  const target: StopTarget = {
    relations: attempts,
    identity: () => Effect.succeed(identity),
    end: Effect.fnUntraced(function* (action, observed, reason: EndingReason) {
      const ladder = yield* ladderOver(proven, reason);
      const extra = [workAim(held, proven, tables?.control), ...(ladder === undefined ? [] : [ladder.aim])];
      const ended = yield* ending(held, action, observed, extra, tables, cost);
      return yield* withAncestry(ended, ladder);
    }),
    signal: (name) =>
      Effect.map(leaderSignal(held, tables, name), (sent) =>
        sent === 'delivered'
          ? { delivered: true, pid: held.pid, reason: undefined, detail: '' }
          : {
              delivered: false,
              pid: held.pid,
              reason: sent === 'reaped' ? ('exited' as const) : sent === 'unsupported' ? ('unsupported' as const) : ('os' as const),
              detail: `${name} was not delivered`,
            },
      ),
  };
  return {
    transport: 'pty',
    held,
    identity,
    witness,
    proven,
    pace: held.pace,
    sink: sinkOf(terminal, held),
    target,
    releaseOutput: hangUp(held),
    sources: terminal === undefined ? [] : [sourceOf('pty', 'pty', terminal)],
    pendingEchoes: terminal === undefined ? Effect.succeed([]) : terminal.pendingEchoes,
    owe: (echoes) => (terminal === undefined ? Effect.void : terminal.owe(echoes)),
    exit: exitOf(held, 'pty', tables),
    cost,
  } satisfies NativeExecution;
});
