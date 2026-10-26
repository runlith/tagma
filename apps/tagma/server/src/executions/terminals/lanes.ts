import { Effect } from 'effect';
import { declare } from '@runlith/held/Held';
import { HoldCut, HoldStalled } from '@runlith/held/failures';
import { refusing } from '../../platform/contract/service/body.js';
import type { ViewLanes } from '../contract/service/views.js';
import { Principal, type BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { TerminalInputReceipt, ViewId } from '../contract/wire/viewLeases.js';
import type { TerminalGrants } from '../contract/service/grants.js';
import type { OpenedBinding, TerminalWriting } from '../contract/service/writing.js';
import { TERMINAL_PERMISSION_REVISION } from '../contract/service/subjectPolicy.js';

const PAGE_CONNECT_DEADLINE_MS = 10_000;
export const LANE_GRACE_MS = 3 * PAGE_CONNECT_DEADLINE_MS;

const OPERATOR = Principal.make('operator');

type DoorLane = {
  readonly binding: BindingId;
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly view: ViewId;
  subscribers: number;
  armed: number;
};

export const refuseThreadView = (act: 'a lane' | 'a Take over'): GateRefusal<'terminal-view-operator'> =>
  new GateRefusal('terminal-view-operator', `${act} is an act of one of the operator’s views, never a thread’s`, [
    'type into a terminal this thread holds with write_terminal, interrupt_terminal or resize_terminal',
    'move custody with transfer_terminal',
  ]);

const sameRef = (one: ExecutionRef, other: ExecutionRef): boolean =>
  one.installation === other.installation && one.execution === other.execution && one.incarnation === other.incarnation;

const laneKey = (execution: string, incarnation: number, binding: BindingId): string => `${execution}\u001f${incarnation}\u001f${binding}`;

export type TerminalLanes = ViewLanes['Service'] & {
  readonly viewOf: (binding: BindingId) => ViewId | undefined;
  readonly count: () => number;
};

export const makeTerminalLanes = Effect.fn('TerminalLanes.make')(function* ({
  writing,
  grants,
  graceMs = LANE_GRACE_MS,
}: {
  readonly writing: TerminalWriting['Service'];
  readonly grants: TerminalGrants['Service'];
  readonly graceMs?: number;
}) {
  const scope = yield* Effect.scope;
  const lanes = new Map<BindingId, DoorLane>();
  const listeners = new Map<string, Set<(receipt: TerminalInputReceipt) => void>>();
  const turns = declare<string>({
    name: 'executions/terminal-input-turn',
    owner: 'executions',
    rank: 480,
    key: (key) => key,
    concurrency: 1,
    threshold: '1 second',
    ceilings: { hold: '2 minutes', wait: '2 minutes', leaves: 'the input receipt may be uncertain; read the lane before sending again' },
    external: { named: 'execution host', callsBack: false },
  });
  let armings = 0;

  const arm = (lane: DoorLane): Effect.Effect<void> => {
    const armed = ++armings;
    lane.armed = armed;
    return Effect.asVoid(
      Effect.forkIn(
        Effect.sleep(graceMs).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (lanes.get(lane.binding) !== lane || lane.armed !== armed || lane.subscribers > 0) return Effect.void;
              lanes.delete(lane.binding);
              return Effect.asVoid(
                grants.revoke(
                  { projectId: lane.projectId, execution: lane.execution, actor: OPERATOR, binding: lane.binding },
                  'view-closed',
                ),
              );
            }),
          ),
        ),
        scope,
      ),
    );
  };

  const unwatch = grants.watch((ended) => {
    const lane = lanes.get(ended.binding);
    if (lane !== undefined && sameRef(lane.execution, ended.execution)) lanes.delete(ended.binding);
  });
  yield* Effect.addFinalizer(() => Effect.sync(unwatch));

  const terminalLanes: TerminalLanes = {
    open: Effect.fn('TerminalLanes.open')(function* (actor, projectId, execution, view) {
      yield* Effect.annotateCurrentSpan({ execution: execution.execution, view });
      if (actor._tag !== 'Operator') return yield* refuseThreadView('a lane');
      const lane = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const opened: OpenedBinding = yield* writing.openBinding(OPERATOR, {
            road: 'view',
            projectId,
            execution,
            decisionRevision: TERMINAL_PERMISSION_REVISION,
          });
          const fresh: DoorLane = { binding: opened.binding, projectId, execution, view, subscribers: 0, armed: 0 };
          const replaced = [...lanes.values()].filter(
            (held) => held.view === view && held.projectId === projectId && sameRef(held.execution, execution),
          );
          lanes.set(fresh.binding, fresh);
          yield* arm(fresh);
          for (const held of replaced) {
            lanes.delete(held.binding);
            yield* grants.revoke({ projectId, execution: held.execution, actor: OPERATOR, binding: held.binding }, 'binding-closed');
          }
          return fresh;
        }),
      );
      yield* Effect.annotateCurrentSpan({ binding: lane.binding });
      return { binding: lane.binding };
    }),
    close: Effect.fn('TerminalLanes.close')(function* (projectId, execution, binding) {
      yield* Effect.annotateCurrentSpan({ execution: execution.execution, binding, cause: 'binding-closed' });
      const lane = lanes.get(binding);
      if (lane === undefined || lane.projectId !== projectId || !sameRef(lane.execution, execution)) return false;
      yield* Effect.uninterruptible(
        Effect.suspend(() => {
          lanes.delete(binding);
          return grants.revoke({ projectId, execution: lane.execution, actor: OPERATOR, binding }, 'binding-closed');
        }),
      );
      return true;
    }),
    listen: (execution, binding, emit) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => {
            const key = laneKey(execution.execution, execution.incarnation, binding);
            const held = listeners.get(key) ?? new Set<(receipt: TerminalInputReceipt) => void>();
            held.add(emit);
            listeners.set(key, held);
            const lane = lanes.get(binding);
            if (lane === undefined || !sameRef(lane.execution, execution)) return { key, lane: null };
            lane.subscribers += 1;
            return { key, lane };
          }),
          ({ key, lane }) => {
            const held = listeners.get(key);
            held?.delete(emit);
            if (held?.size === 0) listeners.delete(key);
            if (lane === null) return Effect.void;
            lane.subscribers -= 1;
            return lane.subscribers === 0 && lanes.get(lane.binding) === lane ? arm(lane) : Effect.void;
          },
        ),
      ),
    publish: (execution, binding, receipt) => {
      for (const listener of listeners.get(laneKey(execution.execution, execution.incarnation, binding)) ?? []) listener(receipt);
    },
    turn: (execution, incarnation, binding, work) =>
      refusing(
        turns
          .hold(laneKey(execution, incarnation, binding), work)
          .pipe(
            Effect.mapError((failure) =>
              failure instanceof HoldCut || failure instanceof HoldStalled
                ? new GateRefusal('terminal-input-turn-unavailable', `the input turn could not be completed (${failure._tag})`, [
                    'read the lane receipt before sending another write',
                  ])
                : failure,
            ),
          ),
      ),
    viewOf: (binding) => lanes.get(binding)?.view,
    count: () => lanes.size,
  };
  return terminalLanes;
});
