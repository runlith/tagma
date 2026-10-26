import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { TerminalInput } from '@runlith/executions/TerminalInput';
import { BindingId, Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, InstallationId, type ExecutionRef } from '@runlith/executions/protocol/execution';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import { TargetKey } from '../../../executions/contract/wire/targets.js';
import { ViewId } from '../../../executions/contract/wire/viewLeases.js';
import { grantBook, LANE_GRACE_MS, terminalLanes } from '../../../executions/testing/doubles.js';

const execution: ExecutionRef = {
  installation: InstallationId.make('view-lanes'),
  execution: ExecutionId.make('terminal'),
  incarnation: 1,
};
const operator = Principal.make('operator');
const targetKey = TargetKey.make('view-target');

const makeLanes = Effect.fnUntraced(function* () {
  const grants = grantBook({
    executions: TerminalInput.of({
      input: () => Effect.die('this fixture does not send input to a host'),
      openBinding: () => Effect.die('this fixture mints its view grants in memory'),
      closeBinding: (binding) => Effect.succeed({ _tag: 'Unbound', binding }),
    }),
  });
  let next = 0;
  const writing = TerminalWriting.of({
    openBinding: Effect.fnUntraced(function* (principal, open) {
      const binding = BindingId.make(`view-${++next}`);
      yield* grants.mint(
        {
          projectId: open.projectId,
          execution: open.execution,
          actor: principal,
          targetKey,
          binding,
          permissionRevision: open.decisionRevision,
        },
        'view',
      );
      return { binding, epoch: 0 };
    }),
    input: () => Effect.die('this fixture checks the live grant before input'),
    agentInput: () => Effect.die('this fixture opens no agent lane'),
    pipeInput: () => Effect.die('this fixture opens no pipe'),
    openHeldLane: () => Effect.die('this fixture opens no held lane'),
    openAgentBinding: () => Effect.die('this fixture opens no agent lane'),
    closeBinding: () => Effect.die('the grant owner closes revoked bindings'),
    closeAgentBinding: () => Effect.die('this fixture opens no agent lane'),
    agentGrant: () => undefined,
    grantCounts: grants.counts,
    lanesOver: () => [],
    typedBy: () => Effect.die('this fixture reads no writer attribution'),
  });
  const lanes = yield* terminalLanes({ writing, grants });
  const evidence = (binding: BindingId) =>
    grants.evidence({ projectId: 1, execution, actor: operator, binding, targetKey, permissionRevision: 0 });
  return { lanes, grants, evidence };
});

it.effect('unsubscribed and disconnected view lanes expire, while a subscribed view keeps its right to type', () =>
  Effect.gen(function* () {
    const { lanes, grants, evidence } = yield* makeLanes();
    const standing = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('standing'));
    const never = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('never-subscribed'));
    const dropped = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('disconnected'));
    const standingPage = yield* Scope.fork(yield* Effect.scope);
    const droppedPage = yield* Scope.fork(yield* Effect.scope);
    yield* lanes.listen(execution, standing.binding, () => undefined).pipe(Scope.provide(standingPage));
    yield* lanes.listen(execution, dropped.binding, () => undefined).pipe(Scope.provide(droppedPage));
    yield* Scope.close(droppedPage, Exit.void);
    expect(grants.counts().view).toBe(3);

    yield* TestClock.adjust(LANE_GRACE_MS());

    expect(yield* Effect.flip(evidence(never.binding))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect(yield* Effect.flip(evidence(dropped.binding))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect(yield* evidence(standing.binding)).toMatchObject({ binding: standing.binding });
    expect(grants.counts().view).toBe(1);
    expect(grants.unclosedCount()).toBe(0);

    yield* Scope.close(standingPage, Exit.void);
    yield* TestClock.adjust(LANE_GRACE_MS());

    expect(yield* Effect.flip(evidence(standing.binding))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect(grants.counts().view).toBe(0);
  }),
);

it.effect('reopening one view revokes its old grant, leaves another view live, and an explicit close revokes the new grant', () =>
  Effect.gen(function* () {
    const { lanes, grants, evidence } = yield* makeLanes();
    const other = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('other'));
    const first = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('reloaded'));
    const last = yield* lanes.open({ _tag: 'Operator' }, 1, execution, ViewId.make('reloaded'));

    expect(yield* Effect.flip(evidence(first.binding))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect(yield* evidence(last.binding)).toMatchObject({ binding: last.binding });
    expect(yield* evidence(other.binding)).toMatchObject({ binding: other.binding });
    expect(grants.counts().view).toBe(2);
    expect(yield* lanes.close(1, execution, last.binding)).toBe(true);
    expect(yield* Effect.flip(evidence(last.binding))).toMatchObject({ _tag: 'TerminalRefused', reason: 'no-grant' });
    expect(yield* evidence(other.binding)).toMatchObject({ binding: other.binding });
    expect(grants.counts().view).toBe(1);
  }),
);
