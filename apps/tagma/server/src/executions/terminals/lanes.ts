import { Context, Deferred, Effect, type Fiber, References, Schedule, Stream, Tracer } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { TerminalLanes as HostLanes } from '@runlith/executions/TerminalLanes';
import type { ViewLanes } from '../contract/service/views.js';
import { Principal, type BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaneInput } from '@runlith/executions/protocol/lane';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { ViewId } from '../contract/wire/viewLeases.js';
import type { TerminalGrants } from '../contract/service/grants.js';
import type { TerminalWriting } from '../contract/service/writing.js';
import { TERMINAL_PERMISSION_REVISION } from '../contract/service/subjectPolicy.js';
import type { InputWitness } from './gridControl.js';
import { type TerminalWriters, typedInto } from './writers.js';

const PAGE_CONNECT_DEADLINE_MS = 10_000;
export const LANE_GRACE_MS = 3 * PAGE_CONNECT_DEADLINE_MS;

const FOLLOW_RETRY = Schedule.min([Schedule.exponential('200 millis'), Schedule.spaced('10 seconds')]);

const OPERATOR = Principal.make('operator');

type DoorLane = {
  readonly binding: BindingId;
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly view: ViewId;
  readonly device: string | null;
  holders: number;
  armed: number;
};

type Follower = {
  fiber: Fiber.Fiber<void, ExecutionsFailure> | null;
  stopped: boolean;
  readonly subscribed: Deferred.Deferred<void, ExecutionsFailure>;
};

export const refuseThreadView = (act: 'a lane' | 'a Take over'): GateRefusal<'terminal-view-operator'> =>
  new GateRefusal('terminal-view-operator', `${act} is an act of one of the operator’s views, never a thread’s`, [
    'type into a terminal this thread holds with write_terminal, interrupt_terminal or resize_terminal',
    'move custody with transfer_terminal',
  ]);

const sameRef = (one: ExecutionRef, other: ExecutionRef): boolean =>
  one.installation === other.installation && one.execution === other.execution && one.incarnation === other.incarnation;

const keyOf = (execution: ExecutionRef): string => `${execution.installation}/${execution.execution}/${execution.incarnation}`;

export type TerminalLanes = ViewLanes['Service'] & {
  readonly viewOf: (binding: BindingId) => ViewId | undefined;
  readonly count: () => number;
};

export const makeTerminalLanes = Effect.fn('TerminalLanes.make')(function* ({
  writing,
  grants,
  host,
  witness,
  writers,
  graceMs = LANE_GRACE_MS,
}: {
  readonly writing: TerminalWriting['Service'];
  readonly grants: TerminalGrants['Service'];
  readonly host: HostLanes['Service'];
  readonly witness: InputWitness;
  readonly writers: TerminalWriters | null;
  readonly graceMs?: number;
}) {
  const scope = yield* Effect.scope;
  const lanes = new Map<BindingId, DoorLane>();
  const followers = new Map<string, Follower>();
  let armings = 0;

  const holding = (execution: ExecutionRef): boolean => [...lanes.values()].some((held) => sameRef(held.execution, execution));

  const heard = (execution: ExecutionRef, input: LaneInput): Effect.Effect<void> => {
    const cause = input.receipt.cause;
    const typed = writers !== null && typedInto(input.principal, 'view', cause, cause === 'interrupt' ? 'Interrupt' : 'Write');
    return Effect.andThen(
      witness.reported(execution, input.binding, cause),
      typed ? writers.admitted(execution, input.principal, input.receipt) : Effect.void,
    );
  };

  const following = (
    execution: ExecutionRef,
    subscribed: Deferred.Deferred<void, ExecutionsFailure>,
  ): Effect.Effect<void, ExecutionsFailure> =>
    Effect.updateContext(
      Effect.scoped(
        Effect.gen(function* () {
          const inputs = yield* host.inputs(execution).pipe(Effect.tapError((failure) => Deferred.fail(subscribed, failure)));
          yield* Deferred.succeed(subscribed, undefined);
          yield* Stream.runForEach(inputs, (input) => heard(execution, input));
        }),
      ).pipe(
        Effect.retry({ schedule: FOLLOW_RETRY, while: () => holding(execution) }),
        Effect.tapError((failure) =>
          Effect.logWarning('the input admitted on the lanes of a terminal is no longer followed', {
            execution: execution.execution,
            reason: failure._tag,
          }),
        ),
      ),
      (context: Context.Context<never>) => Context.omit(Tracer.ParentSpan, References.CurrentStackFrame)(context),
    );

  const follow = (execution: ExecutionRef): Effect.Effect<void, ExecutionsFailure> =>
    Effect.suspend(() => {
      const key = keyOf(execution);
      const standing = followers.get(key);
      if (standing !== undefined) return Deferred.await(standing.subscribed);
      const follower: Follower = { fiber: null, stopped: false, subscribed: Deferred.makeUnsafe<void, ExecutionsFailure>() };
      followers.set(key, follower);
      const ended = Effect.sync(() => {
        if (followers.get(key) === follower) followers.delete(key);
      });
      return Effect.flatMap(Effect.forkIn(Effect.ensuring(following(execution, follower.subscribed), ended), scope), (fiber) =>
        Effect.andThen(
          Effect.sync(() => {
            follower.fiber = fiber;
            if (follower.stopped) fiber.interruptUnsafe();
          }),
          Effect.withSpan(Deferred.await(follower.subscribed), 'TerminalLanes.subscribe'),
        ),
      );
    });

  const unfollow = (execution: ExecutionRef): void => {
    if (holding(execution)) return;
    const key = keyOf(execution);
    const follower = followers.get(key);
    if (follower === undefined) return;
    followers.delete(key);
    follower.stopped = true;
    follower.fiber?.interruptUnsafe();
  };

  const forget = (lane: DoorLane): void => {
    if (lanes.get(lane.binding) !== lane) return;
    lanes.delete(lane.binding);
    unfollow(lane.execution);
  };

  const revoke = (lane: DoorLane, cause: 'view-closed' | 'binding-closed') =>
    Effect.suspend(() => {
      forget(lane);
      return grants.revoke({ projectId: lane.projectId, execution: lane.execution, actor: OPERATOR, binding: lane.binding }, cause);
    });

  const arm = (lane: DoorLane): Effect.Effect<void> => {
    const armed = ++armings;
    lane.armed = armed;
    return Effect.asVoid(
      Effect.forkIn(
        Effect.sleep(graceMs).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              lanes.get(lane.binding) !== lane || lane.armed !== armed || lane.holders > 0
                ? Effect.void
                : Effect.asVoid(revoke(lane, 'view-closed')),
            ),
          ),
        ),
        scope,
      ),
    );
  };

  const unwatch = grants.watch((ended) => {
    const lane = lanes.get(ended.binding);
    if (lane !== undefined && sameRef(lane.execution, ended.execution)) forget(lane);
  });
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));

  const terminalLanes: TerminalLanes = {
    open: Effect.fn('TerminalLanes.open')(function* (actor, projectId, execution, view, device) {
      yield* Effect.annotateCurrentSpan({ execution: execution.execution, view });
      if (actor._tag !== 'Operator') return yield* refuseThreadView('a lane');
      const opened = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const bound = yield* writing.openBinding(OPERATOR, {
            road: 'view',
            projectId,
            execution,
            decisionRevision: TERMINAL_PERMISSION_REVISION,
          });
          const lane = yield* Effect.andThen(follow(execution), host.open(execution, { binding: bound.binding, principal: OPERATOR })).pipe(
            Effect.onError(() =>
              Effect.andThen(
                grants.revoke({ projectId, execution, actor: OPERATOR, binding: bound.binding }, 'binding-closed'),
                Effect.sync(() => unfollow(execution)),
              ),
            ),
          );
          const fresh: DoorLane = { binding: bound.binding, projectId, execution, view, device, holders: 0, armed: 0 };
          const replaced = [...lanes.values()].filter(
            (held) => held.view === view && held.projectId === projectId && sameRef(held.execution, execution),
          );
          lanes.set(fresh.binding, fresh);
          yield* arm(fresh);
          for (const held of replaced) yield* revoke(held, 'binding-closed');
          return { binding: fresh.binding, lane };
        }),
      );
      yield* Effect.annotateCurrentSpan({ binding: opened.binding });
      return opened;
    }),
    close: Effect.fn('TerminalLanes.close')(function* (projectId, execution, binding) {
      yield* Effect.annotateCurrentSpan({ execution: execution.execution, binding, cause: 'binding-closed' });
      const lane = lanes.get(binding);
      if (lane === undefined || lane.projectId !== projectId || !sameRef(lane.execution, execution)) return false;
      yield* Effect.uninterruptible(revoke(lane, 'binding-closed'));
      return true;
    }),
    revoked: Effect.fn('TerminalLanes.revoked')(function* (device) {
      const opened = [...lanes.values()].filter((lane) => lane.device === device);
      yield* Effect.annotateCurrentSpan({ device, lanes: opened.length });
      yield* Effect.uninterruptible(Effect.forEach(opened, (lane) => revoke(lane, 'binding-closed'), { discard: true }));
    }),
    hold: (execution, binding) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => {
            const lane = lanes.get(binding);
            if (lane === undefined || !sameRef(lane.execution, execution)) return null;
            lane.holders += 1;
            return lane;
          }),
          (lane) => {
            if (lane === null) return Effect.void;
            lane.holders -= 1;
            return lane.holders === 0 && lanes.get(lane.binding) === lane ? arm(lane) : Effect.void;
          },
        ),
      ),
    viewOf: (binding) => lanes.get(binding)?.view,
    count: () => lanes.size,
  };
  return terminalLanes;
});
