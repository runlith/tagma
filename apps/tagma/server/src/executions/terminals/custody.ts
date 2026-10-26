import { TerminalReconciliation } from './reconciliation.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { RequestKeys } from '../store/requestKeys.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { TerminalRows } from '../store/terminalRows.js';
import { InputWitness } from './gridControl.js';
import { TerminalGrants } from '../contract/service/grants.js';
import { Executions } from '@runlith/executions/Executions';
import { Commands } from '@runlith/executions/Commands';
import { ExecutionFeed } from '@runlith/executions/ExecutionFeed';
import { ExecutionCustody } from '@runlith/executions/ExecutionCustody';
import { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { HostRefused } from '@runlith/executions/Executions';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { isReplacedGeneration } from '../host/generationEnded.js';
import { inExecution } from './acts.js';
import type { Held } from '@runlith/held/Held';
import type { TerminalDisplaced } from '../contract/service/custody.js';
import { Clock, Duration, Effect, PubSub, Queue, Stream } from 'effect';
import { Principal, type CustodyRevision } from '@runlith/executions/protocol/custody';
import { HostRequestKey, type ExecutionRef, type ExecutionState } from '@runlith/executions/protocol/execution';
import type { CustodyAnswer, CustodyTransfer } from '@runlith/executions/protocol/control';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { writes } from '../../platform/contract/service/writes.js';
import { custodyNotice, openTerminal, terminal, terminalIntent, terminalRequestKey, terminalRequestKeyTally } from '../store/terminal.js';
import { TerminalRefused, TerminalUnavailable, hostRefusalReason, hostSentence } from '../contract/wire/refusals.js';
import { principalOf } from './principals.js';
import { type TerminalWaitAnswer, type TerminalRecord } from '../contract/wire/terminals.js';
import type { TargetKey } from '../contract/wire/targets.js';
import type { TerminalTakeOverAnswer } from '../contract/wire/viewLeases.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { executionWireLimits } from '../host/policy.js';
import { RETAINED_DETAIL_MS } from '../contract/wire/requestKeys.js';
import type { CustodyNotice } from '../contract/service/custody.js';
import type { CustodyNoticeCursor } from '../contract/service/custody.js';
import { UNATTRIBUTED_MOVE, type TerminalTakeOver, type NoticeDecision } from '../contract/service/custody.js';
import { type TerminalFailure } from '../contract/service/terminals.js';
import { threadOf, retaken } from './refs.js';

const operationIntentNotices = writes('custody.transfer', [terminalRequestKey, terminalRequestKeyTally, terminalIntent, custodyNotice]);

const operationIntents = writes('custody.transfer', [terminalRequestKey, terminalRequestKeyTally, terminalIntent]);

export const makeTerminalCustody = Effect.fnUntraced(function* ({
  installation,
  gate,
  displaced: displacements,
}: {
  readonly installation: InstallationId;
  readonly gate: Held<ExecutionRef>;
  readonly displaced: Queue.Queue<TerminalDisplaced>;
}) {
  const reconciliation = yield* TerminalReconciliation;
  const units = yield* MachineUnits;
  const requestKeys = yield* RequestKeys;
  const intents = yield* TerminalIntents;
  const terminalRows = yield* TerminalRows;
  const witness = yield* InputWitness;
  const grants = yield* TerminalGrants;
  const host = yield* Executions;
  const commands = yield* Commands;
  const executionFeed = yield* ExecutionFeed;
  const executionCustody = yield* ExecutionCustody;
  const hostLifecycle = yield* HostLifecycle;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const moves = yield* Effect.acquireRelease(PubSub.unbounded<number>(), PubSub.shutdown);

  const custody = Effect.fn('Terminals.custody')(function* (
    projectId: number,
    key: TerminalOperationKey,
    execution: ExecutionRef,
    expected: CustodyRevision,
    act: CustodyTransfer,
    principal: Principal,
  ): Effect.fn.Return<CustodyAnswer, TerminalFailure> {
    const reconciled = yield* reconciliation.projection(projectId, execution);
    const standing = reconciled !== null && reconciled.execution.incarnation === execution.incarnation ? reconciled : null;
    if (standing === null) {
      return yield* new TerminalUnavailable({
        owner: 'store',
        message: `This installation holds no projection of ${execution.execution}; reconcile it before moving its custody.`,
      });
    }
    if (standing.quarantine !== undefined) {
      return yield* new TerminalRefused({
        reason: 'stale',
        message: `The projection of ${execution.execution} is quarantined (${standing.quarantine}); its provenance must be resolved before its custody moves.`,
      });
    }
    if (standing.projectId !== projectId) {
      return yield* new TerminalRefused({
        reason: 'foreign-project',
        message: `Execution ${execution.execution} belongs to project ${standing.projectId}; a custody act never reaches across projects.`,
      });
    }
    return yield* inExecution(gate, execution, transfer(projectId, key, execution, expected, act, principal, standing));
  });

  const transfer = Effect.fn('Terminals.transfer')(function* (
    projectId: number,
    key: TerminalOperationKey,
    execution: ExecutionRef,
    expected: CustodyRevision,
    act: CustodyTransfer,
    principal: Principal,
    standing: TerminalRecord,
  ): Effect.fn.Return<CustodyAnswer, TerminalFailure> {
    const taken = yield* units.read((unit) => requestKeys.operation(unit, projectId, key.operationId));
    if (taken._tag !== 'Unknown') return yield* retaken(key, taken);
    const outgoing = standing.heldBy;
    const incoming = threadOf(act.holder);
    const displaced = threadOf(standing.holder);
    const tells = displaced !== null && displaced !== threadOf(key.requester);
    yield* units.write(operationIntentNotices, (unit) =>
      Effect.gen(function* () {
        yield* requestKeys.register(unit, key);
        yield* intents.fence(unit, {
          key,
          phase: 'reserved',
          holdings: {},
          outgoing: outgoing,
          incoming: incoming === null ? undefined : ThreadId.make(incoming),
          openedAt: yield* Clock.currentTimeMillis,
        });
        if (!tells) return;
        yield* terminalRows.openNotice(unit, {
          projectId,
          operationId: key.operationId,
          thread: displaced,
          requester: key.requester,
          execution,
          expected,
          name: standing.label ?? standing.program ?? execution.execution,
          state: 'intent',
          openedAt: yield* Clock.currentTimeMillis,
        });
      }),
    );
    const noticeGone = tells
      ? units.write(writes('custody.noticeGone', [custodyNotice]), (unit) =>
          terminalRows.markNotice(unit, projectId, key.operationId, 'gone'),
        )
      : Effect.void;
    yield* units.write(operationIntents, (unit) => intents.advance(unit, projectId, key.operationId, 'dispatched'));
    const sent = yield* Effect.result(executionCustody.custody({ operation: ref(key.operationId), execution, expected, act }, principal));
    if (sent._tag === 'Failure') {
      const unsent = sent.failure._tag === 'WireUnavailable' && sent.failure.sent === false;
      yield* units.write(operationIntents, (unit) =>
        unsent
          ? intents.settle(unit, projectId, key.operationId, { _tag: 'Settled' })
          : intents.settle(unit, projectId, key.operationId, {
              _tag: 'Uncertain',
              effect: { _tag: 'InFlight', operation: ref(key.operationId) },
            }),
      );
      if (unsent) yield* noticeGone;
      return yield* sent.failure;
    }
    const outcome = sent.success;
    if (outcome._tag === 'Uncertain') {
      yield* units.write(writes('custody.transfer', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
        intents.settle(unit, projectId, key.operationId, { _tag: 'Uncertain', effect: outcome.effect }),
      );
      return outcome;
    }
    const moved = outcome._tag === 'Accepted' || outcome._tag === 'Standing';
    yield* units.write(operationIntentNotices, (unit) =>
      Effect.gen(function* () {
        yield* intents.settle(unit, projectId, key.operationId, {
          _tag: 'Settled',
          executionId: execution.execution,
          incarnation: execution.incarnation,
        });
        if (!tells) return;
        yield* terminalRows.markNotice(unit, projectId, key.operationId, moved ? 'owed' : 'gone');
      }),
    );
    if (outcome._tag === 'Accepted' || outcome._tag === 'Standing') {
      yield* reproject(projectId, outcome.receipt.custody.holder, outcome.receipt);
      yield* witness.transferred(execution);
      PubSub.publishUnsafe(moves, projectId);
      if (tells) yield* Queue.offer(displacements, { projectId, operationId: key.operationId });
      yield* grants.endOver(projectId, execution, 'custody-transferred');
    }
    return outcome;
  });

  const takeOver = Effect.fn('Terminals.takeOver')(function* (
    request: TerminalTakeOver,
  ): Effect.fn.Return<TerminalTakeOverAnswer, TerminalFailure> {
    const destination = principalOf({ _tag: 'Operator' });
    const reconciled = yield* reconciliation.projection(request.projectId, request.execution);
    const standing = reconciled !== null && reconciled.execution.incarnation === request.execution.incarnation ? reconciled : null;
    if (standing === null) {
      return yield* new TerminalUnavailable({
        owner: 'store',
        message: `This installation holds no projection of ${request.execution.execution}; reconcile it before taking it over.`,
      });
    }
    if (standing.holder === destination) return { _tag: 'Moved', revision: standing.revision };
    const moved = yield* custody(
      request.projectId,
      takeOverKey(request, standing.targetKey),
      request.execution,
      standing.revision,
      { _tag: 'Transfer', holder: destination },
      standing.holder,
    );
    if (moved._tag === 'Uncertain') return { _tag: 'Uncertain', effect: moved.effect };
    if (moved._tag !== 'Accepted' && moved._tag !== 'Standing') return yield* takeOverRefusal(moved);
    return { _tag: 'Moved', revision: moved.receipt.custody.revision };
  });

  const takeOverKey = (request: TerminalTakeOver, targetKey: TargetKey): TerminalOperationKey => ({
    projectId: request.projectId,
    operationId: request.operationId,
    requester: principalOf(request.actor),
    mutation: 'transfer',
    targetKey,
    execution: request.execution,
  });

  const reproject = Effect.fn('Terminals.reproject')(function* (
    projectId: number,
    holder: Principal,
    receipt: { readonly execution: ExecutionRef; readonly custody: { readonly revision: CustodyRevision } },
  ): Effect.fn.Return<void, TerminalFailure> {
    const standing = yield* units.read((unit) => terminalRows.record(unit, receipt.execution.execution));
    if (standing === null) return;
    if (standing.projectId !== projectId) {
      return yield* new TerminalRefused({
        reason: 'foreign-project',
        message: `Execution ${receipt.execution.execution} belongs to project ${standing.projectId}; a custody act never moves it into ${projectId}.`,
      });
    }
    const thread = threadOf(holder);
    const { heldBy: _previous, ...carried } = standing;
    const moved: TerminalRecord = {
      ...carried,
      holder,
      revision: receipt.custody.revision,
      heldBy: thread === null ? undefined : ThreadId.make(thread),
    };
    yield* units.write(writes('custody.reproject', [terminal, openTerminal]), (unit) => terminalRows.project(unit, moved));
  });

  const live = (execution: ExecutionRef): Effect.Effect<ExecutionSummary | undefined, TerminalFailure> =>
    host.state(execution).pipe(Effect.catchTag('HostRefused', (refused) => unlessReplaced(execution, refused)));

  const unlessReplaced = Effect.fnUntraced(function* (execution: ExecutionRef, refused: HostRefused) {
    if (isReplacedGeneration(execution.incarnation, yield* hostLifecycle.generation())) return undefined;
    return yield* refused;
  });

  const state = Effect.fn('Terminals.state')(function* (execution: ExecutionRef) {
    return yield* live(execution);
  });

  const wait = Effect.fn('Terminals.wait')(function* (
    execution: ExecutionRef,
    waitMs: number,
  ): Effect.fn.Return<TerminalWaitAnswer, TerminalFailure> {
    let latest: ExecutionSummary | undefined;
    const undecided = (): TerminalWaitAnswer => (latest === undefined ? { _tag: 'Undecided' } : { _tag: 'Undecided', summary: latest });
    const watched: Effect.Effect<TerminalWaitAnswer, TerminalFailure> = Effect.gen(function* () {
      const opening = yield* live(execution);
      if (opening === undefined) {
        const admitted = yield* commands.command(execution);
        if (admitted === undefined) return { _tag: 'Unwatchable' };
        if (admitted.state.phase === 'ended') {
          const answered = yield* endedPlace(execution);
          if (answered !== undefined) return answered;
        }
      } else {
        if (settled(opening.state)) return { _tag: 'Decided', summary: opening };
        latest = opening;
      }
      const ended = yield* Stream.runHead(
        executionFeed.subscribe({ _tag: 'State', execution }, executionWireLimits.credits).pipe(
          Stream.tap((delivery) =>
            Effect.sync(() => {
              if (delivery._tag === 'State') latest = delivery.summary;
            }),
          ),
          Stream.filter((delivery) => delivery._tag === 'Ended' || (delivery._tag === 'State' && settled(delivery.summary.state))),
        ),
      );
      if (ended._tag === 'Some' && ended.value._tag === 'State') return { _tag: 'Decided', summary: ended.value.summary };
      const standing = yield* live(execution);
      if (standing !== undefined) {
        latest = standing;
        return settled(standing.state) ? { _tag: 'Decided', summary: standing } : undecided();
      }
      const admitted = yield* commands.command(execution);
      if (admitted === undefined) return { _tag: 'Unwatchable' };
      if (admitted.state.phase === 'ended') return (yield* endedPlace(execution)) ?? undecided();
      return undecided();
    });
    return yield* watched.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(waitMs),
        orElse: () => Effect.sync(undecided),
      }),
    );
  });

  const endedPlace = Effect.fn('Terminals.endedPlace')(function* (
    execution: ExecutionRef,
  ): Effect.fn.Return<TerminalWaitAnswer | undefined, TerminalFailure> {
    const standing = yield* live(execution);
    if (standing === undefined) return { _tag: 'Unwatchable' };
    return settled(standing.state) ? { _tag: 'Decided', summary: standing } : undefined;
  });

  //! the exit is observed apart from the output pipelines, so an ending is decided only once every stream it read has closed
  const settled = (state: ExecutionState): boolean =>
    state.phase === 'ended' && state.streams.stdout !== 'open' && state.streams.stderr !== 'open' && state.streams.pty !== 'open';

  const pendingNotices = Effect.fn('Terminals.pendingNotices')(function* (limit: number, after?: CustodyNoticeCursor) {
    return yield* units.read((unit) => terminalRows.notices(unit, limit, after));
  });

  const noticeDecided = Effect.fn('Terminals.noticeDecided')(function* (
    notice: CustodyNotice,
  ): Effect.fn.Return<NoticeDecision, TerminalFailure> {
    if (notice.state === 'owed') return { _tag: 'Owed', notice };
    const standingNotice = Effect.gen(function* () {
      const row = yield* units.read((unit) => terminalRows.notice(unit, notice.projectId, notice.operationId));
      return row === null
        ? ({ _tag: 'Gone' } as const)
        : row.state === 'owed'
          ? ({ _tag: 'Owed', notice: row } as const)
          : ({ _tag: 'Undecided' } as const);
    });
    const mark = (state: 'owed' | 'gone', requester?: string) =>
      Effect.andThen(
        units.write(writes('custody.mark', [custodyNotice]), (unit) =>
          terminalRows.markNotice(unit, notice.projectId, notice.operationId, state, requester, 'intent'),
        ),
        standingNotice,
      );
    const operationId = HostRequestKey.make(notice.operationId);
    const local = yield* units.read((unit) => requestKeys.operation(unit, notice.projectId, operationId));
    if (local._tag === 'Settled' || local._tag === 'Unknown' || local._tag === 'Expired') return yield* mark('gone');
    const held = yield* Effect.result(live(notice.execution));
    if (held._tag === 'Failure') return { _tag: 'Undecided' };
    const custody = held.success?.custody;
    if (custody === undefined) {
      yield* Effect.logInfo('a custody notice whose execution the host no longer holds is given up', {
        thread: notice.thread,
        execution: notice.execution.execution,
      });
      return yield* mark('gone');
    }
    const displacedFrom = Principal.make(`thread:${notice.thread}`);
    if (custody.revision > notice.expected) {
      if (custody.holder === displacedFrom) return yield* mark('gone');
      yield* movedAfterDoubt(notice.projectId, notice.execution, displacedFrom);
      return yield* mark('owed', UNATTRIBUTED_MOVE);
    }
    if ((yield* Clock.currentTimeMillis) - notice.openedAt < RETAINED_DETAIL_MS) return { _tag: 'Undecided' };
    return yield* mark('gone');
  });

  const movedAfterDoubt = Effect.fn('Terminals.movedAfterDoubt')(function* (
    projectId: number,
    execution: ExecutionRef,
    displacedFrom: Principal,
  ): Effect.fn.Return<void, TerminalFailure> {
    const summary = yield* live(execution);
    const standing = yield* units.read((unit) => terminalRows.record(unit, execution.execution));
    if (summary === undefined || standing === null || standing.execution.incarnation !== execution.incarnation) return;
    if (summary.custody.revision <= standing.revision) return;
    yield* reproject(projectId, summary.custody.holder, {
      execution,
      custody: { revision: summary.custody.revision },
    });
    for (const grant of grants.over(projectId, execution)) {
      if (grant.actor !== displacedFrom) continue;
      yield* grants.revoke({ projectId, execution, actor: grant.actor, binding: grant.binding, runId: grant.runId }, 'custody-transferred');
    }
    PubSub.publishUnsafe(moves, projectId);
  });

  const stillDisplaced = Effect.fn('Terminals.stillDisplaced')(function* (notice: CustodyNotice) {
    const held = yield* Effect.result(live(notice.execution));
    if (held._tag === 'Failure') {
      yield* Effect.logDebug('a custody notice is kept: the terminal holder is unread on the host', {
        execution: notice.execution.execution,
        reason: held.failure._tag,
      });
      return null;
    }
    return held.success?.custody.holder !== Principal.make(`thread:${notice.thread}`);
  });

  const noticeDelivered = Effect.fn('Terminals.noticeDelivered')(function* (notice: {
    readonly projectId: number;
    readonly operationId: string;
  }) {
    yield* units.write(writes('custody.noticeDelivered', [custodyNotice]), (unit) =>
      terminalRows.markNotice(unit, notice.projectId, notice.operationId, 'gone'),
    );
  });

  const custodyMoves = (projectId: number): Stream.Stream<void> =>
    Stream.fromPubSub(moves).pipe(
      Stream.filter((moved) => moved === projectId),
      Stream.map(() => undefined),
    );

  const takeOverRefusal = (
    outcome: Extract<CustodyAnswer, { readonly _tag: 'RevisionStale' | 'Refused' }>,
  ): Effect.Effect<never, TerminalRefused> =>
    outcome._tag === 'RevisionStale'
      ? new TerminalRefused({
          reason: 'stale',
          message: `Custody moved while this take over ran: it was decided over revision ${outcome.expected} and stands at ${outcome.custody.revision}.`,
        })
      : new TerminalRefused({
          reason: hostRefusalReason[outcome.refusal._tag],
          message: `The host would not let this take over move custody of the execution: ${outcome.refusal._tag} — ${hostSentence(outcome.refusal)}`,
        });

  return {
    move: custody,
    takeOver,
    state,
    wait,
    pendingNotices,
    noticeDecided,
    stillDisplaced,
    noticeDelivered,
    moves: custodyMoves,
    fencesOf: intents.fencesOf,
    heldBy: terminalRows.heldBy,
    holdingUses: terminalRows.holdingUses,
  };
});
