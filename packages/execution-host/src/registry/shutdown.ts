import { Clock, Deferred, Duration, Effect, Exit, Fiber, Ref, Context } from 'effect';
import { shutdownMsOf } from '@runlith/executions/protocol/capacity';
import { ExecutionId, type ExecutionRef, type HostRequestRef } from '@runlith/executions/protocol/execution';
import { type ShutdownAnswer, type StopReceipt, type UnverifiableResource } from '@runlith/executions/protocol/stop';
import {
  type PendingWork,
  type PrepareAnswer,
  type QuiescenceAnswer,
  type QuiescenceTicket,
  type ResumeAnswer,
  type RuntimeStatus,
  type YieldAnswer,
} from '@runlith/executions/protocol/runtime';
import { type ShutdownKeys, type HostClaim, type RegistryState, commanding } from './state';
import { departure } from './departure';
import { endOrphan, sweepAfter } from './endings';
import { endAccepted } from './commands';
import { registryStatus } from './inventory';
import { workAim } from '../nativeLaunch';

type ShutdownEntry =
  | { readonly _tag: 'Stood'; readonly outcome: ShutdownAnswer }
  | { readonly _tag: 'Join'; readonly standing: Deferred.Deferred<ShutdownAnswer> }
  | { readonly _tag: 'Run' };

const shutdownKeyOf = (operation: HostRequestRef): string => `${operation.installation}/${operation.operation}`;

type StillMoving = {
  readonly receipts: ReadonlyArray<StopReceipt>;
  readonly starts: number;
  readonly attempts: number;
  readonly queued: ReadonlyArray<{ readonly ref: ExecutionRef; readonly kind: 'pty' | 'process' }>;
  readonly acquiring: ReadonlyArray<{ readonly ref: ExecutionRef; readonly kind: 'pty' | 'process' }>;
  readonly held: ReadonlyArray<{
    readonly ref: ExecutionRef;
    readonly kind: 'pty' | 'process';
    readonly stopping: boolean;
    readonly releasing: boolean;
  }>;
  readonly orphans: ReadonlyArray<ExecutionRef>;
  readonly holder: number | undefined;
};

const kindOf = (transport: string): 'pty' | 'process' => (transport === 'pty' ? 'pty' : 'process');

const stillMoving = Effect.fnUntraced(function* (
  registry: RegistryState,
  receipts: ReadonlyArray<StopReceipt>,
  unvisited: ReadonlySet<ExecutionId>,
  stopping: ReadonlySet<ExecutionId>,
  unorphaned: ReadonlySet<ExecutionId>,
  releasing: ReadonlySet<ExecutionId> = new Set(),
) {
  const { admission, held, orphans, queued } = registry;
  const populations = yield* admission.populations();
  const waiting = [...(yield* Ref.get(queued)).values()];
  const queuedRows: Array<StillMoving['queued'][number]> = [];
  const acquiringRows: Array<StillMoving['acquiring'][number]> = [];
  for (const entry of waiting) {
    const gate = yield* Ref.get(entry.gate);
    const row = { ref: entry.ref, kind: kindOf(entry.launch.transport._tag) };
    if (gate === 'queued') queuedRows.push(row);
    else if (gate === 'acquiring') acquiringRows.push(row);
  }
  const heldRows: Array<StillMoving['held'][number]> = [];
  const moving = new Set([...unvisited, ...stopping, ...releasing]);
  for (const id of moving) {
    const found = held.get(id);
    if (found === undefined) continue;
    const state = yield* Ref.get(found.state);
    heldRows.push({ ref: found.ref, kind: kindOf(state.transport), stopping: stopping.has(id), releasing: releasing.has(id) });
  }
  const strayed = yield* Ref.get(orphans);
  const orphaned: ExecutionRef[] = [];
  for (const id of unorphaned) {
    const orphan = strayed.get(id);
    if (orphan !== undefined) orphaned.push(orphan.ref);
  }
  return {
    receipts,
    starts: populations.starts,
    attempts: populations.attempts,
    queued: queuedRows,
    acquiring: acquiringRows,
    held: heldRows,
    orphans: orphaned,
    holder: undefined,
  };
});

const expired = (operation: HostRequestRef, bound: number, phase: string, moving: StillMoving): ShutdownAnswer => {
  const count = (n: number, one: string, many: string): string | undefined => (n === 0 ? undefined : n === 1 ? `1 ${one}` : `${n} ${many}`);
  const parts = [
    count(moving.starts, 'start still registering', 'starts still registering'),
    count(moving.attempts, 'attempt mid-spawn', 'attempts mid-spawn'),
    count(moving.queued.length, 'execution still queued', 'executions still queued'),
    count(moving.held.filter((row) => row.stopping).length, 'stop unfinished', 'stops unfinished'),
    count(moving.held.filter((row) => row.releasing).length, 'execution still releasing', 'executions still releasing'),
    count(moving.held.filter((row) => !row.stopping && !row.releasing).length, 'execution unreached', 'executions unreached'),
    count(moving.orphans.length, 'orphaned child unreached', 'orphaned children unreached'),
    moving.holder === undefined ? undefined : 'holder still vacating',
  ].filter((part): part is string => part !== undefined);
  const reason =
    parts.length === 0
      ? `the shutdown did not finish within ${bound}ms while ${phase}: nothing was still moving`
      : `the shutdown did not finish within ${bound}ms while ${phase}: ${parts.join(', ')}`;
  return {
    _tag: 'ShutdownIncomplete',
    operation,
    executions: [...moving.receipts],
    residual: moving.receipts.flatMap((receipt) => receipt.residual),
    unverifiable: [
      ...moving.receipts.flatMap((receipt) => receipt.unverifiable),
      ...moving.queued.map((row) => ({
        kind: row.kind,
        detail: row.ref.execution,
        reason: 'queued: it waited for its attempt while the shutdown expired',
      })),
      ...moving.acquiring.map((row) => ({
        kind: row.kind,
        detail: row.ref.execution,
        reason: 'attempts: its native attempt was mid-spawn while the shutdown expired',
      })),
      ...moving.held.map((row) => ({
        kind: row.kind,
        detail: row.ref.execution,
        reason: row.releasing
          ? 'held: its finalization did not finish within the shutdown budget'
          : row.stopping
            ? 'held: its stop did not finish within the shutdown budget'
            : 'held: the shutdown expired before its stop began',
      })),
      ...moving.orphans.map((ref) => ({
        kind: 'process' as const,
        detail: ref.execution,
        reason: 'orphans: the shutdown expired before it was reached',
      })),
      ...(moving.holder === undefined
        ? []
        : [
            {
              kind: 'process' as const,
              detail: `holder (pid ${moving.holder})`,
              reason: 'its vacate did not finish within the shutdown budget',
            },
          ]),
    ],
    reason,
  } satisfies ShutdownAnswer;
};

type Spent<A> = { readonly _tag: 'Done'; readonly value: A } | { readonly _tag: 'Expired' };

const runSweep = Effect.fn('HostLifecycle.sweep')(function* (
  registry: RegistryState,
  operation: HostRequestRef,
  bound: number,
  deadline: number,
) {
  const { store, admission, calls, registryScope, held, orphans, queued } = registry;
  const clock = yield* Clock.Clock;
  const remaining = (): number => deadline - clock.currentTimeMillisUnsafe();
  const budget = (): Duration.Duration => Duration.millis(Math.max(0, remaining()));
  const raced = <A>(wait: Effect.Effect<A>): Effect.Effect<Spent<A>> =>
    remaining() <= 0
      ? Effect.succeed({ _tag: 'Expired' } as const)
      : Effect.timeoutOrElse(
          Effect.map(wait, (value): Spent<A> => ({ _tag: 'Done', value })),
          {
            duration: budget(),
            orElse: () => Effect.succeed({ _tag: 'Expired' } as const),
          },
        );
  const forked = Effect.fnUntraced(function* <A>(unit: Effect.Effect<A>) {
    if (remaining() <= 0) return { _tag: 'Expired' } as const;
    const fiber = yield* Effect.forkIn(unit, registryScope);
    return yield* Effect.timeoutOrElse(
      Effect.map(Fiber.join(fiber), (value): Spent<A> => ({ _tag: 'Done', value })),
      {
        duration: budget(),
        orElse: () => Effect.succeed({ _tag: 'Expired' } as const),
      },
    );
  });
  const unreached = Effect.fnUntraced(function* (phase: string) {
    const holding = new Set(held.all().map((found) => found.ref.execution));
    const strayed = new Set((yield* Ref.get(orphans)).keys());
    return expired(operation, bound, phase, yield* stillMoving(registry, [], holding, new Set(), strayed));
  });
  yield* admission.stopping();
  const entered = yield* forked(Effect.result(store.enterPhase('stopping')));
  if (entered._tag === 'Expired') return yield* unreached('recording stopping');
  const unrecorded: UnverifiableResource[] =
    entered.value._tag === 'Failure' ? [{ kind: 'record', detail: 'stopping phase', reason: String(entered.value.failure._tag) }] : [];
  const drained = yield* raced(admission.awaitStarts());
  if (drained._tag === 'Expired') return yield* unreached('draining starts');
  for (const waiting of [...(yield* Ref.get(queued)).values()]) {
    const ended = yield* forked(
      endAccepted(registry, waiting, 'shutdown', `shutdown:${operation.operation}`, { operation, action: 'destroy' }),
    );
    if (ended._tag === 'Expired') return yield* unreached('ending queued work');
  }
  const spawned = yield* raced(admission.awaitAttempts());
  if (spawned._tag === 'Expired') return yield* unreached('waiting for attempts');
  const executions = held.all();
  const receipts: StopReceipt[] = [];
  const unvisited = new Set(executions.map((found) => found.ref.execution));
  if (executions.length > 0 && remaining() <= 0) return yield* unreached('stopping executions');
  const stopping = yield* Effect.forEach(executions, (found) =>
    Effect.map(
      Effect.forkIn(
        Effect.gen(function* () {
          yield* calls
            .settle(found.operation, { _tag: 'Cancel', cause: 'shutdown', trigger: `shutdown:${operation.operation}` })
            .pipe(Effect.catchTag('CallMissing', () => Effect.void));
          const receipt = yield* found.execution.stop.stop(operation, 'shutdown', 'destroy');
          yield* sweepAfter(registry, found.ref.execution, receipt);
          return receipt;
        }),
        registryScope,
      ),
      (fiber) => [found, fiber] as const,
    ),
  );
  for (const [found, fiber] of stopping) {
    const receipt = yield* raced(Fiber.join(fiber));
    if (receipt._tag === 'Expired') {
      return expired(operation, bound, 'stopping executions', yield* stillMoving(registry, receipts, unvisited, unvisited, new Set()));
    }
    receipts.push(receipt.value);
    unvisited.delete(found.ref.execution);
  }
  const stranded: UnverifiableResource[] = [];
  const unorphaned = new Set([...(yield* Ref.get(orphans)).keys()]);
  if (unorphaned.size > 0 && remaining() <= 0) {
    return expired(operation, bound, 'ending orphaned children', yield* stillMoving(registry, receipts, new Set(), new Set(), unorphaned));
  }
  const ending = yield* Effect.forEach([...unorphaned], (execution) =>
    Effect.map(Effect.forkIn(endOrphan(registry, execution, 'shutdown'), registryScope), (fiber) => [execution, fiber] as const),
  );
  for (const [execution, fiber] of ending) {
    const ended = yield* raced(Fiber.join(fiber));
    if (ended._tag === 'Expired') {
      return expired(
        operation,
        bound,
        'ending orphaned children',
        yield* stillMoving(registry, receipts, new Set(), new Set(), unorphaned),
      );
    }
    unorphaned.delete(execution);
    if (ended.value === undefined) continue;
    stranded.push({
      kind: 'process',
      detail: `${ended.value.orphan.ref.execution} (pid ${ended.value.orphan.native.identity.pid ?? 'unknown'})`,
      reason:
        ended.value.ending.exit === undefined
          ? `a start whose owners never assembled (${ended.value.orphan.reason}); no exit was observed`
          : `a start whose owners never assembled (${ended.value.orphan.reason}); it ended, but no record or cleanup was ever measured`,
    });
  }
  const residual = receipts.flatMap((receipt) => receipt.residual);
  const unverifiable = [...receipts.flatMap((receipt) => receipt.unverifiable), ...stranded, ...unrecorded];
  const unsettled = new Set(
    receipts.filter((receipt) => receipt.residual.length > 0 || receipt.unverifiable.length > 0).map((receipt) => receipt.execution.execution),
  );
  for (const found of executions.filter((found) => !unsettled.has(found.ref.execution))) {
    const released = yield* raced(Effect.andThen(Deferred.await(found.worked), found.close));
    if (released._tag === 'Expired') {
      return expired(
        operation,
        bound,
        `releasing execution ${found.ref.execution}`,
        yield* stillMoving(registry, receipts, new Set(), new Set(), new Set(), new Set([found.ref.execution])),
      );
    }
  }
  const vacated = yield* forked(Effect.result(registry.holder.vacate));
  if (vacated._tag === 'Expired') {
    return expired(operation, bound, 'vacating holder', {
      ...(yield* stillMoving(registry, receipts, new Set(), new Set(), new Set())),
      holder: registry.holder.pid,
    });
  }
  if (vacated.value._tag === 'Failure' && vacated.value.failure.reason !== 'lost') {
    return {
      _tag: 'ShutdownIncomplete',
      operation,
      executions: receipts,
      residual,
      unverifiable: [...unverifiable, { kind: 'process', detail: `holder (pid ${registry.holder.pid})`, reason: vacated.value.failure.detail }],
      reason: 'the holder would not vacate',
    } satisfies ShutdownAnswer;
  }
  const closed = yield* forked(Effect.result(store.enterPhase('closed')));
  if (closed._tag === 'Expired') {
    return expired(operation, bound, 'recording closed', yield* stillMoving(registry, receipts, new Set(), new Set(), new Set()));
  }
  if (closed.value._tag === 'Failure') {
    return {
      _tag: 'ShutdownIncomplete',
      operation,
      executions: receipts,
      residual,
      unverifiable: [...unverifiable, { kind: 'record', detail: 'closed phase', reason: String(closed.value.failure._tag) }],
      reason: 'the closed phase could not be recorded',
    } satisfies ShutdownAnswer;
  }
  yield* admission.close();
  if (residual.length > 0 || unverifiable.length > 0) {
    return {
      _tag: 'ShutdownIncomplete',
      operation,
      executions: receipts,
      residual,
      unverifiable,
      reason: 'the host closed, and its holder ends what it still holds as it leaves: resources survive or could not be measured',
    } satisfies ShutdownAnswer;
  }
  return { _tag: 'ShutdownComplete', operation, executions: receipts } satisfies ShutdownAnswer;
});

const shutdownOnce = Effect.fnUntraced(function* (registry: RegistryState, operation: HostRequestRef) {
  const { admission, capacity, shutdowns } = registry;
  const key = shutdownKeyOf(operation);
  const mine = Deferred.makeUnsafe<ShutdownAnswer>();
  const closed = (yield* admission.phase()) === 'closed';
  const entry = yield* Ref.modify(shutdowns, (keys): readonly [ShutdownEntry, ShutdownKeys] => {
    const stood = keys.done.get(key);
    if (stood !== undefined) return [{ _tag: 'Stood', outcome: stood }, keys];
    const racing = keys.live.get(key);
    if (racing !== undefined) return [{ _tag: 'Join', standing: racing }, keys];
    if (closed) return [{ _tag: 'Stood', outcome: { _tag: 'ShutdownComplete', operation, executions: [] } }, keys];
    return [{ _tag: 'Run' }, { done: keys.done, live: new Map(keys.live).set(key, mine) }];
  });
  if (entry._tag === 'Stood') return entry.outcome;
  if (entry._tag === 'Join') return yield* Deferred.await(entry.standing);
  const bound = shutdownMsOf(capacity.profile.shutdownMs);
  const outcome = yield* Effect.exit(runSweep(registry, operation, bound, (yield* Clock.currentTimeMillis) + bound));
  const answered: ShutdownAnswer =
    outcome._tag === 'Success' ? outcome.value : { _tag: 'Uncertain', effect: { _tag: 'InFlight', operation } };
  if (outcome._tag === 'Failure') yield* Effect.logError('a host shutdown died instead of answering', outcome.cause);
  const stands = answered._tag === 'ShutdownComplete' || (yield* admission.phase()) === 'closed';
  yield* Ref.update(shutdowns, (keys) => {
    const live = new Map(keys.live);
    live.delete(key);
    return { done: stands ? new Map(keys.done).set(key, answered) : keys.done, live };
  });
  yield* Deferred.done(mine, Exit.succeed(answered));
  return answered;
});

const quiesce = Effect.fn('HostLifecycle.quiesce')(function* (registry: RegistryState, claim: HostClaim, operation: HostRequestRef) {
  const { calls, held, quiescence } = registry;
  const allowed = yield* Effect.result(commanding(registry, claim, 'start'));
  if (allowed._tag === 'Failure') {
    return {
      _tag: 'Refused',
      operation,
      refusal: { _tag: 'Unauthorized', reason: `the presented custody is not the one that stands: ${allowed.failure._tag}` },
    } satisfies QuiescenceAnswer;
  }
  const ticket = `quiesce:${operation.operation}` as QuiescenceTicket;
  yield* Ref.set(quiescence, { ticket, operation });
  const pending: PendingWork[] = [];
  for (const found of held.all()) {
    const callOpen = yield* calls.decision(found.operation).pipe(
      Effect.map((decided) => decided === undefined),
      Effect.catchTag('CallMissing', () => Effect.succeed(false)),
    );
    if (callOpen) pending.push({ execution: found.ref, reason: 'call-open' });
    else if ((yield* found.execution.input.pendingActs) > 0) pending.push({ execution: found.ref, reason: 'input-admitted' });
    else if (yield* found.execution.stop.stopping) pending.push({ execution: found.ref, reason: 'stop-running' });
  }
  return pending.length === 0
    ? ({ _tag: 'Quiesced', operation, ticket } satisfies QuiescenceAnswer)
    : ({ _tag: 'RestartDeferred', operation, ticket, pending } satisfies QuiescenceAnswer);
});

const resume = Effect.fnUntraced(function* (registry: RegistryState, claim: HostClaim, ticket: QuiescenceTicket) {
  const { admission, quiescence } = registry;
  const open = yield* Ref.get(quiescence);
  const phase = yield* admission.phase();
  const allowed = yield* Effect.result(commanding(registry, claim, 'start'));
  if (allowed._tag === 'Failure') return { _tag: 'TicketUnknown', ticket, phase } satisfies ResumeAnswer;
  if (open === undefined || open.ticket !== ticket || phase === 'closed') {
    return { _tag: 'TicketUnknown', ticket, phase } satisfies ResumeAnswer;
  }
  yield* Ref.set(quiescence, undefined);
  return { _tag: 'Resumed', ticket, phase } satisfies ResumeAnswer;
});

export class HostLifecycle extends Context.Service<
  HostLifecycle,
  {
    readonly shutdown: (claim: HostClaim, operation: HostRequestRef) => Effect.Effect<ShutdownAnswer>;
    readonly vacate: (operation: HostRequestRef) => Effect.Effect<ShutdownAnswer>;
    readonly quiesce: (claim: HostClaim, operation: HostRequestRef) => Effect.Effect<QuiescenceAnswer>;
    readonly resume: (claim: HostClaim, ticket: QuiescenceTicket) => Effect.Effect<ResumeAnswer>;
    readonly prepare: (claim: HostClaim, operation: HostRequestRef) => Effect.Effect<PrepareAnswer>;
    readonly yield: (ticket: QuiescenceTicket) => Effect.Effect<YieldAnswer>;
    readonly askedToYield: Effect.Effect<void>;
    readonly leaving: Effect.Effect<void>;
    readonly departed: Effect.Effect<boolean>;
    readonly status: () => Effect.Effect<RuntimeStatus>;
    readonly orphaned: Effect.Effect<void>;
  }
>()('@runlith/execution-host/HostLifecycle') {}

export const hostLifecycleOf = (registry: RegistryState) => {
  const leaving = departure(registry);
  const unlessYielding = (operation: HostRequestRef, shutdown: Effect.Effect<ShutdownAnswer>): Effect.Effect<ShutdownAnswer> =>
    Effect.flatMap(leaving.shuttingDown, (allowed) =>
      allowed
        ? shutdown
        : Effect.succeed({
            _tag: 'Refused',
            operation,
            refusal: { _tag: 'AdmissionClosed', reason: 'this host is yielding its place to the next logic' },
          } satisfies ShutdownAnswer),
    );
  return HostLifecycle.of({
    prepare: leaving.prepare,
    yield: leaving.yield,
    askedToYield: leaving.askedToYield,
    leaving: leaving.leaving,
    departed: leaving.departed,
    shutdown: Effect.fn('HostLifecycle.shutdown')(function* (claim, operation) {
      const allowed = yield* Effect.result(commanding(registry, claim, 'end'));
      if (allowed._tag === 'Failure') {
        return {
          _tag: 'Refused',
          operation,
          refusal: { _tag: 'Unauthorized', reason: `the presented custody is not the one that stands: ${allowed.failure._tag}` },
        } satisfies ShutdownAnswer;
      }
      return yield* unlessYielding(operation, shutdownOnce(registry, operation));
    }),
    vacate: (operation) => unlessYielding(operation, shutdownOnce(registry, operation)),
    quiesce: (claim, operation) => quiesce(registry, claim, operation),
    resume: (claim, ticket) =>
      Effect.flatMap(leaving.yielded, (yielded) =>
        yielded
          ? Effect.map(registry.admission.phase(), (phase) => ({ _tag: 'TicketUnknown', ticket, phase }) satisfies ResumeAnswer)
          : resume(registry, claim, ticket),
      ),
    status: () => registryStatus(registry),
    orphaned: Effect.gen(function* () {
      const loss = yield* registry.holder.lost;
      if (loss.reason === 'broken') return yield* Effect.andThen(leaving.channelLost, Effect.never);
      for (;;) {
        const woken = yield* Ref.get(registry.inventoryWake);
        if (yield* drained(registry)) return;
        yield* Deferred.await(woken);
      }
    }),
  });
};

const drained = Effect.fnUntraced(function* (registry: RegistryState) {
  if ((yield* Ref.get(registry.orphans)).size > 0 || (yield* Ref.get(registry.queued)).size > 0) return false;
  for (const live of registry.held.all()) {
    if ((yield* Ref.get(live.state)).phase !== 'ended' || !(yield* Deferred.isDone(live.worked))) return false;
    const ending = yield* live.execution.stop.measured;
    if (
      ending === undefined ||
      ending.residual.some((row) => row.kind !== 'record') ||
      !(yield* workAim(live.native.held, live.native.proven).gone)
    )
      return false;
  }
  return true;
});
