import { TerminalWriters } from './writers.js';
import { TerminalGrants } from '../contract/service/grants.js';
import { InputWitness } from './gridControl.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { TerminalReconciliation } from './reconciliation.js';
import { Executions } from '@runlith/executions/Executions';
import { TerminalInput } from '@runlith/executions/TerminalInput';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { HostRequestKey } from '@runlith/executions/protocol/execution';
import { makeTerminalRecord } from './reads.js';
import { TerminalWriting } from '../contract/service/writing.js';
import { inExecution } from './acts.js';
import type { Held } from '@runlith/held/Held';
import { Clock, Effect, Result } from 'effect';
import { HostRefused } from '@runlith/executions/Executions';
import { Principal, type BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputRequest, InputAnswer, InputInstruction } from '@runlith/executions/protocol/input';
import { TerminalRefused, TerminalUnavailable, hostSentence } from '../contract/wire/refusals.js';
import type { TargetKey } from '../contract/wire/targets.js';
import type { InteractiveGrant } from '../contract/wire/terminals.js';
import type { TerminalLaneRow } from '../contract/wire/viewLeases.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { TERMINAL_PERMISSION_REVISION } from '../contract/service/subjectPolicy.js';
import { typedInto } from './writers.js';
import { refusesLane } from './refusal.js';
import type { GrantRoad } from '../contract/service/grants.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import type { BindingOpen, OpenedBinding, PipeHandle, TypedBy } from '../contract/service/writing.js';
import { writes } from '../../platform/contract/service/writes.js';
import { terminalIntent, terminalRequestKey, terminalRequestKeyTally } from '../store/terminal.js';
import { threadOf, agentLaneKey } from './refs.js';

const settleActs = writes('input.settleAct', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]);

export type AgentLane = {
  readonly binding: BindingId;
  next: number;
};

type LaneTarget = {
  readonly projectId: number;
  readonly targetKey: TargetKey;
  readonly execution: ExecutionRef;
  readonly decisionRevision: number;
  readonly road: GrantRoad;
  readonly runId?: string;
};

export const makeTerminalWriting = Effect.fnUntraced(function* ({
  installation,
  gate,
}: {
  readonly installation: InstallationId;
  readonly gate: Held<ExecutionRef>;
}) {
  const writers = yield* TerminalWriters;
  const grants = yield* TerminalGrants;
  const witness = yield* InputWitness;
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const intents = yield* TerminalIntents;
  const reconciliation = yield* TerminalReconciliation;
  const host = yield* Executions;
  const terminalInput = yield* TerminalInput;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const readRecord = yield* makeTerminalRecord;
  const agentLanes = new Map<string, AgentLane>();
  const forgetEndedLanes = () => {
    for (const [slot, lane] of agentLanes) if (!grants.holds(lane.binding)) agentLanes.delete(slot);
  };
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      grants.watch((ended) => {
        for (const [slot, lane] of agentLanes) if (lane.binding === ended.binding) agentLanes.delete(slot);
      }),
    ),
    (unwatch) => Effect.sync(unwatch),
  );

  const typedBy = (execution: ExecutionRef, reader: Principal | null): Effect.Effect<readonly TypedBy[], TerminalFailure> =>
    writers === null ? Effect.succeed([]) : writers.others(execution, reader);

  const input = Effect.fn('Terminals.input')(function* (
    execution: ExecutionRef,
    scope: { readonly binding: BindingId; readonly principal: Principal; readonly runId?: string; readonly decisionRevision?: number },
    request: InputRequest,
    permissionRevision: number,
  ) {
    const road = yield* Effect.withSpan(
      Effect.gen(function* () {
        const placed = yield* readRecord(execution.execution, execution.incarnation);
        if (placed === null) {
          return yield* new TerminalUnavailable({
            owner: 'store',
            message: `This installation holds no projection of ${execution.execution}; nothing types into an execution it cannot place.`,
          });
        }
        const grant = yield* grants.evidence({
          projectId: placed.projectId,
          execution,
          actor: scope.principal,
          binding: scope.binding,
          targetKey: placed.targetKey,
          permissionRevision,
          runId: scope.runId,
        });
        const road = grants.roadOf(grant);
        if (road === 'agent' && threadOf(scope.principal) !== null && placed.holder !== scope.principal) {
          return yield* new TerminalRefused({ reason: 'not-holder', message: 'This writer types only into an execution it still holds.' });
        }
        return road;
      }),
      'Terminals.input.gate',
    );
    const outcome = yield* terminalInput.input(execution, scope, request);
    yield* witness.admitted(execution, scope, request, outcome);
    if (outcome._tag === 'InputAdmitted' && writers !== null && typedInto(scope.principal, road, request.cause, request.act._tag)) {
      yield* writers.admitted(execution, scope.principal, outcome.receipt);
    }
    return outcome;
  });

  const agentInput = Effect.fn('Terminals.agentInput')(function* (
    key: TerminalOperationKey,
    runId: string | undefined,
    act: InputInstruction,
    cause: InputRequest['cause'],
    profile?: number,
  ): Effect.fn.Return<InputAnswer, TerminalFailure> {
    const execution = key.execution;
    if (execution === undefined) return yield* new TerminalRefused({ reason: 'ineligible', message: 'Input names no execution.' });
    const record = yield* readRecord(execution.execution, execution.incarnation);
    if (record === null || record.projectId !== key.projectId) {
      return yield* new TerminalRefused({ reason: 'foreign-project', message: 'This project holds no such execution.' });
    }
    if (threadOf(key.requester) !== null && record.holder !== key.requester) {
      return yield* new TerminalRefused({ reason: 'not-holder', message: 'This run types only into an execution its thread holds.' });
    }
    return yield* inExecution(
      gate,
      execution,
      Effect.gen(function* () {
        yield* units.write(writes('input.agentInput', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
          requestKeys.register(unit, key),
        );
        return yield* typeRegistered(key, execution, runId, act, cause, profile).pipe(
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              const lane = agentLanes.get(agentLaneKey(key.projectId, execution, key.requester, runId));
              if (lane !== undefined) yield* forgetAgentLane(key.projectId, execution, key.requester, runId, lane);
              forgetEndedLanes();
              yield* units
                .write(writes('input.agentInput', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]), (unit) =>
                  intents.advance(unit, key.projectId, key.operationId, 'uncertain'),
                )
                .pipe(
                  Effect.catch((failure) =>
                    Effect.logWarning('an interrupted input kept its durable intent for recovery', {
                      operation: key.operationId,
                      reason: failure._tag,
                    }),
                  ),
                );
            }),
          ),
        );
      }),
    );
  });

  const typeRegistered = Effect.fn('Terminals.typeRegistered')(function* (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    runId: string | undefined,
    act: InputInstruction,
    cause: InputRequest['cause'],
    profile?: number,
  ): Effect.fn.Return<InputAnswer, TerminalFailure> {
    const lane = yield* Effect.result(agentLane(key, execution, runId));
    if (lane._tag === 'Failure') return yield* settleAct(key, execution, Result.fail(lane.failure), false);
    const first = yield* Effect.result(laneSend(key, execution, runId, lane.success, act, cause, profile));
    if (first._tag === 'Success' || !laneRefused(first.failure)) {
      return yield* settleSent(key, execution, runId, lane.success, first);
    }
    yield* forgetAgentLane(key.projectId, execution, key.requester, runId, lane.success);
    const fresh = yield* Effect.result(agentLane(key, execution, runId));
    if (fresh._tag === 'Failure') return yield* settleAct(key, execution, Result.fail(fresh.failure), false);
    const again = yield* Effect.result(laneSend(key, execution, runId, fresh.success, act, cause, profile));
    return yield* settleSent(key, execution, runId, fresh.success, again._tag === 'Failure' && laneRefused(again.failure) ? first : again);
  });

  const settleSent = Effect.fn('Terminals.settleSent')(function* (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    runId: string | undefined,
    lane: AgentLane,
    sent: Result.Result<InputAnswer, TerminalFailure>,
  ): Effect.fn.Return<InputAnswer, TerminalFailure> {
    const doubt = sent._tag === 'Failure' && mayHaveLeft(sent.failure);
    if (doubt || runId === undefined) yield* forgetAgentLane(key.projectId, execution, key.requester, runId, lane);
    return yield* settleAct(key, execution, sent, doubt);
  });

  const agentLane = Effect.fn('Terminals.agentLane')(function* (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    runId: string | undefined,
  ): Effect.fn.Return<AgentLane, TerminalFailure> {
    const slot = agentLaneKey(key.projectId, execution, key.requester, runId);
    const standing = agentLanes.get(slot);
    if (standing !== undefined && agentGrant(key.requester, standing.binding, runId) !== undefined) return standing;
    if (threadOf(key.requester) !== null) yield* hostHolds(key.requester, execution);
    const opened = yield* openBinding(key.requester, {
      road: 'agent',
      projectId: key.projectId,
      execution,
      decisionRevision: TERMINAL_PERMISSION_REVISION,
      runId: runId,
    });
    const lane: AgentLane = { binding: opened.binding, next: 0 };
    forgetEndedLanes();
    agentLanes.set(slot, lane);
    return lane;
  });

  const hostHolds = Effect.fn('Terminals.hostHolds')(function* (
    requester: Principal,
    execution: ExecutionRef,
  ): Effect.fn.Return<void, TerminalFailure> {
    const held = yield* host.state(execution);
    if (held === undefined) {
      return yield* new HostRefused({
        refusal: {
          _tag: 'UnknownExecution',
          reason: `The host holds no execution ${execution.execution}:${execution.incarnation} any more; it ended or its generation was replaced, so nothing types into it.`,
        },
      });
    }
    if (held.custody.holder !== requester) {
      return yield* new TerminalRefused({ reason: 'not-holder', message: 'This run types only into an execution its thread holds.' });
    }
  });

  const openHeldLane = (
    principal: Principal,
    projectId: number,
    execution: ExecutionRef,
    runId: string | undefined,
  ): Effect.Effect<OpenedBinding, TerminalFailure> =>
    inExecution(
      gate,
      execution,
      Effect.gen(function* () {
        yield* hostHolds(principal, execution);
        return yield* openBinding(principal, {
          road: 'agent',
          projectId,
          execution,
          decisionRevision: TERMINAL_PERMISSION_REVISION,
          runId: runId,
        });
      }),
    );

  const laneSend = (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    runId: string | undefined,
    lane: AgentLane,
    act: InputInstruction,
    cause: InputRequest['cause'],
    profile?: number,
  ): Effect.Effect<InputAnswer, TerminalFailure> =>
    Effect.tap(
      input(
        execution,
        { binding: lane.binding, principal: key.requester, runId: runId },
        {
          sequence: lane.next,
          cause,
          profile: profile,
          act,
        },
        TERMINAL_PERMISSION_REVISION,
      ),
      (outcome) =>
        Effect.sync(() => {
          if (outcome._tag === 'InputAdmitted') lane.next += 1;
        }),
    );

  const settleAct = Effect.fn('Terminals.settleAct')(function* (
    key: TerminalOperationKey,
    execution: ExecutionRef,
    sent: Result.Result<InputAnswer, TerminalFailure>,
    doubt: boolean,
  ): Effect.fn.Return<InputAnswer, TerminalFailure> {
    if (sent._tag === 'Failure') {
      yield* units.write(settleActs, (unit) =>
        intents.settle(
          unit,
          key.projectId,
          key.operationId,
          doubt
            ? { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation: ref(key.operationId) } }
            : { _tag: 'Settled', executionId: execution.execution, incarnation: execution.incarnation },
        ),
      );
      return yield* Effect.fail(sent.failure);
    }
    yield* units.write(settleActs, (unit) =>
      intents.settle(unit, key.projectId, key.operationId, {
        _tag: 'Settled',
        executionId: execution.execution,
        incarnation: execution.incarnation,
        input: sent.success,
      }),
    );
    return sent.success;
  });

  const forgetAgentLane = (
    projectId: number,
    execution: ExecutionRef,
    principal: Principal,
    runId: string | undefined,
    lane: AgentLane,
  ): Effect.Effect<void> => Effect.asVoid(closeAgentBinding(projectId, execution, principal, lane.binding, runId));

  const pipeInput = Effect.fn('Terminals.pipeInput')(function* (pipe: PipeHandle, act: InputInstruction, sequence: number) {
    return yield* terminalInput.input(
      pipe.execution,
      { binding: pipe.binding, principal: pipe.principal },
      {
        sequence,
        cause: act._tag === 'End' ? 'end' : 'raw',
        act,
      },
    );
  });

  const openBinding = Effect.fn('Terminals.openBinding')(function* (principal: Principal, open: BindingOpen) {
    const into = yield* laneTarget(open);
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const opened = yield* terminalInput.openBinding(principal, into.execution);
        if (opened._tag !== 'Bound') {
          const full = opened._tag === 'Refused' && opened.refusal._tag === 'CapacityExceeded';
          return yield* new TerminalRefused({
            reason: full ? 'capacity' : 'no-binding',
            message:
              opened._tag === 'Refused'
                ? `The host would not open a lane for this caller: ${opened.refusal._tag} — ${hostSentence(opened.refusal)}. Nothing was opened.`
                : `The host answered ${opened._tag} to opening a lane for this caller; nothing was opened.`,
          });
        }
        yield* grants
          .settle(
            into.projectId,
            into.targetKey,
            { execution: into.execution, road: into.road },
            {
              binding: opened.binding,
              principal,
              decisionRevision: into.decisionRevision,
              runId: into.runId,
            },
          )
          .pipe(Effect.onError(() => grants.closeOrKeep(opened.binding, principal)));
        return { binding: opened.binding, epoch: opened.epoch } satisfies OpenedBinding;
      }),
    );
  });

  const laneTarget = Effect.fn('Terminals.laneTarget')(function* (open: BindingOpen): Effect.fn.Return<LaneTarget, TerminalFailure> {
    const reconciled = yield* reconciliation.projection(open.projectId, open.execution);
    const standing = reconciled !== null && reconciled.execution.incarnation === open.execution.incarnation ? reconciled : null;
    if (standing === null) {
      return yield* new TerminalUnavailable({
        owner: 'store',
        message: `This installation holds no projection of ${open.execution.execution}; reconcile it before opening a lane that types into it.`,
      });
    }
    if (standing.projectId !== open.projectId) {
      return yield* new TerminalRefused({
        reason: 'foreign-project',
        message: `Execution ${open.execution.execution} belongs to project ${standing.projectId}; a lane that types into it is never opened from another.`,
      });
    }
    return {
      projectId: open.projectId,
      targetKey: standing.targetKey,
      execution: standing.execution,
      decisionRevision: open.decisionRevision,
      road: open.road,
      runId: open.runId,
    };
  });

  const lanesOver = (projectId: number, execution: ExecutionRef): readonly TerminalLaneRow[] => [
    ...grants.over(projectId, execution).flatMap((grant): TerminalLaneRow[] => {
      const road = grants.roadOf(grant);
      return road === 'view' || road === 'harness' || road === 'agent' ? [{ writer: grant.actor, kind: road }] : [];
    }),
    ...(witness.holdsLane(execution) ? [{ writer: Principal.make('operator'), kind: 'grid' as const }] : []),
  ];

  const grantCounts = () => grants.counts();

  const agentGrant = (principal: Principal, binding: BindingId, runId?: string): InteractiveGrant | undefined =>
    grants.of(principal).find((grant) => grant.binding === binding && grant.runId === runId && grants.roadOf(grant) === 'agent');

  const closeAgentBinding = (projectId: number, execution: ExecutionRef, principal: Principal, binding: BindingId, runId?: string) =>
    grants.revoke({ projectId, execution, actor: principal, binding, runId: runId }, 'binding-closed');

  const closeBinding = (binding: BindingId, principal: Principal) => grants.closeOrKeep(binding, principal);

  const laneRefused = (failure: TerminalFailure): boolean =>
    failure._tag === 'TerminalRefused'
      ? failure.reason === 'no-grant' || failure.reason === 'stale'
      : failure._tag === 'HostRefused' && refusesLane(failure.refusal);

  const mayHaveLeft = (failure: TerminalFailure): boolean =>
    failure._tag === 'WireLost' || failure._tag === 'WireUnavailable'
      ? failure.sent
      : failure._tag === 'WireUnreadable' || failure._tag === 'WireInvalid';

  const openAgentBinding = Effect.fnUntraced(function* (principal: Principal, open: BindingOpen) {
    const opened = yield* openBinding(principal, open);
    agentLanes.set(agentLaneKey(open.projectId, open.execution, principal, open.runId), { binding: opened.binding, next: 0 });
    return opened;
  });

  return TerminalWriting.of({
    typedBy,
    input,
    agentInput,
    openHeldLane,
    pipeInput,
    openBinding,
    openAgentBinding,
    lanesOver,
    grantCounts,
    agentGrant,
    closeAgentBinding,
    closeBinding,
  });
});
