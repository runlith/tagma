import { Context, Deferred, Effect, Exit, FiberSet, Layer, PubSub, Scope, Stream } from 'effect';
import { EndingStages } from '../ending';
import type { ThreadRow } from '../rows';
import type { ThreadState } from '../state';
import { LaunchGate, launchGateLayer } from '../run/LaunchGate';
import { RunReports, runReportsLayer } from '../run/lifecycle/RunReports';
import { runBoundariesLayer } from '../run/RunBoundaries';
import { RunLifecycle, runLifecycleLayer } from '../run/lifecycle/RunLifecycle';
import { ThreadRunLedger, threadRunLedgerLayer } from '../run/ThreadRunLedger';
import { RunGuidance, runGuidanceLayer } from '../run/RunGuidance';
import { runBeaterLayer } from '../run/RunBeater';
import { RunControl, runControlLayer } from '../run/RunControl';
import { makeLandingHolds, RunAdmission } from '../run/runAdmission';
import { type Handover, makeHandover } from '../run/scheduler/handover';
import { SenderWakes } from '../run/SenderWakes';
import { ThreadChanges, threadChangesLayer } from '../run/ThreadChanges';
import { makeThreadLiveFeed, threadFeedLayer, type ThreadLiveFeed } from '../run/ThreadLiveFeed';
import { ThreadRunSettlements, threadRunSettlementsLayer } from '../run/ThreadRunSettlements';
import { threadSettlementOutboxLayer } from '../run/ThreadSettlementOutbox';
import { inMemoryEndingStages } from '../storage/InMemoryEndingStages';
import { threadCompactorLayer, threadStorageLayer } from '../kernelPorts';
import type { ThreadRunStartFrom } from '../storage/runs';
import { makeThreadDigestStrategy } from '../compaction/digestStrategy';
import { makeThreadSummaryStrategy } from '../compaction/summaryStrategy';
import { runRequestsLayer } from '../run/requests';
import { runProgressLayer } from '../run/RunProgress';
import { makeThreadCompaction } from '../run/ThreadCompaction';
import { threadRunAccountingLayer } from '../run/ThreadRunAccounting';
import { COMPACTION_POLICY, COMPACTION_PROMPT, COMPACTION_TEXT, inertAttachments, neverModels } from './runLog/world';
import { threadHostLayer, unboundedThreadResidencyLayer } from '../ThreadPorts';
import { threadRunSequencesLayer } from '../transition/sequence';
import { ThreadEntryKinds } from '../../transcript/kinds';
import { wordsInFlightLayer } from '../run/WordsInFlight';
import { fakeAdapter, type FakeAdapter, silentGuidance, transportsOver } from './fakeTransport';
import type { ThreadStorageFactory, ThreadStorageHarness } from './storagePort';

export const OWNER = 'owner';
export const SCOPE = 'scope-a';
export const INSTANCE = 'instance-1';
export const APPROVAL = { mode: 'trust', interactive: false } as const;

export type LifecycleWorld<TTx, TWrite extends TTx> = {
  readonly storage: ThreadStorageHarness<TTx, TWrite>;
  readonly lifecycle: RunLifecycle['Service'];
  readonly reports: RunReports['Service'];
  readonly guidance: RunGuidance['Service'];
  readonly ledger: ThreadRunLedger['Service'];
  readonly settlements: ThreadRunSettlements['Service'];
  readonly handover: Handover;
  readonly control: RunControl['Service'];
  readonly changes: ThreadChanges['Service'];
  readonly gate: LaunchGate['Service'];
  readonly adapter: FakeAdapter;
  readonly feed: ThreadLiveFeed<ThreadState>;
  readonly runs: ReturnType<ThreadStorageHarness<TTx, TWrite>['runs']>;
  readonly endings: EndingStages['Service'];
  readonly admission: RunAdmission['Service'];
  readonly startFrom: ThreadRunStartFrom;
  readonly published: string[];
  settled(count: number): Effect.Effect<void>;
  holdSettlement(): () => void;
  dispose(): Effect.Effect<void>;
};

export const lifecycleWorld = Effect.fnUntraced(function* <TTx, TWrite extends TTx, R = never>(
  open: ThreadStorageFactory<TTx, TWrite, R>,
  beatEveryMs = 30_000,
) {
  const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  return yield* lifecycleWorldOver(storage, thread, beatEveryMs);
});

export const lifecycleWorldOver = Effect.fnUntraced(function* <TTx, TWrite extends TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  thread: ThreadRow,
  beatEveryMs = 30_000,
  adapter: FakeAdapter = fakeAdapter(),
) {
  const scope = yield* Scope.fork(yield* Effect.scope);
  return yield* makeWorld(storage, thread, beatEveryMs, scope, adapter).pipe(Scope.provide(scope));
});

const makeWorld = Effect.fnUntraced(function* <TTx, TWrite extends TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  thread: ThreadRow,
  beatEveryMs: number,
  scope: Scope.Closeable,
  adapter: FakeAdapter,
): Effect.fn.Return<LifecycleWorld<TTx, TWrite>, never, Scope.Scope> {
  const admission = makeLandingHolds();
  const feed = yield* makeThreadLiveFeed<ThreadState>();
  const published: string[] = [];
  const moves = yield* Effect.acquireRelease(PubSub.sliding<number>({ capacity: 1, replay: 1 }), PubSub.shutdown);
  yield* PubSub.publish(moves, 0);
  let held: Effect.Effect<void> = Effect.void;
  const endings = inMemoryEndingStages();
  const layer = runLifecycleLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        threadRunSequencesLayer,
        runControlLayer.pipe(Layer.provideMerge(transportsOver(adapter))),
        Layer.succeed(RunAdmission, admission),
      ),
    ),
    Layer.provideMerge(threadSettlementOutboxLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        threadStorageLayer<TTx, TWrite>({
          storage: storage.aggregate,
          transitions: storage.transitions,
          eventLog: storage.eventLog,
          inbox: storage.inbox,
          createRuns: (ownerId) => storage.runs({ ownerId, scope: SCOPE }),
          attachments: inertAttachments<TTx, TWrite>(),
          ownerSettings: storage.ownerSettings,
          toolOutputs: {
            scope: () => {
              throw new Error('These runs hold no tool outputs.');
            },
            settleOpen: () => Effect.void,
          },
        }),
        Layer.succeed(EndingStages, endings),
        threadCompactorLayer(
          makeThreadCompaction({
            models: neverModels,
            checkpoints: storage.compaction,
            policy: () => Effect.succeed(COMPACTION_POLICY),
            strategy: makeThreadSummaryStrategy({ models: neverModels, prompt: COMPACTION_PROMPT }),
            recovery: makeThreadDigestStrategy(),
            text: COMPACTION_TEXT,
          }),
        ),
        unboundedThreadResidencyLayer,
        threadHostLayer({
          rhythms: {
            lease: { heartbeatIntervalMs: beatEveryMs, staleRunningAfterMs: 30_000, takeoverAfterMs: 0 },
            reaper: { staleSweepIntervalMs: 30_000, recoveryBatch: 1, resumeWithinMs: 60_000, resumeAttemptLimit: 1 },
            settlement: {
              settledClaimAfterMs: 30_000,
              settledHeartbeatIntervalMs: 30_000,
              settledNotificationBatch: 1,
              settledNotifyAttemptLimit: 1,
            },
            streamFlushIntervalMs: 0,
          },
          ownerId: INSTANCE,
        }),
        Layer.effectDiscard(
          Effect.flatMap(ThreadRunSettlements, (settlements) =>
            settlements.subscribe({
              name: 'suite',
              handle: Effect.fnUntraced(function* (event) {
                yield* held;
                published.push(event.runId);
                yield* PubSub.publish(moves, published.length);
              }),
            }),
          ),
        ).pipe(Layer.provideMerge(threadRunSettlementsLayer)),
      ),
    ),
  );
  const services = yield* Layer.buildWithScope(
    runReportsLayer.pipe(
      Layer.provideMerge(runBeaterLayer),
      Layer.provideMerge(Layer.mergeAll(launchGateLayer, wordsInFlightLayer, runBoundariesLayer)),
      Layer.provideMerge(Layer.succeed(SenderWakes, { kick: () => Effect.void, drain: () => Effect.succeed(0) })),
      Layer.provideMerge(runProgressLayer),
      Layer.provideMerge(threadFeedLayer(feed, (state) => Effect.succeed(state))),
      Layer.provideMerge(runRequestsLayer.pipe(Layer.provideMerge(threadRunAccountingLayer))),
      Layer.provideMerge(threadRunLedgerLayer),
      Layer.provideMerge(runGuidanceLayer),
      Layer.provideMerge(layer),
      Layer.provideMerge(threadChangesLayer),
      Layer.provideMerge(Layer.succeed(ThreadEntryKinds, storage.kinds)),
    ),
    scope,
  );
  const starting = yield* FiberSet.make<void, never>();
  const handover = yield* makeHandover({ guidance: silentGuidance, spawn: yield* FiberSet.runtime(starting)() }).pipe(
    Effect.provide(services),
  );
  return {
    storage,
    lifecycle: Context.get(services, RunLifecycle),
    reports: Context.get(services, RunReports),
    guidance: Context.get(services, RunGuidance),
    ledger: Context.get(services, ThreadRunLedger),
    settlements: Context.get(services, ThreadRunSettlements),
    control: Context.get(services, RunControl),
    changes: Context.get(services, ThreadChanges),
    handover,
    gate: Context.get(services, LaunchGate),
    adapter,
    feed,
    runs: storage.runs({ ownerId: INSTANCE, scope: SCOPE }),
    endings,
    admission,
    startFrom: startFromOf(thread),
    published,
    settled: (count: number) =>
      Stream.fromPubSub(moves).pipe(
        Stream.filter((seen) => seen >= count),
        Stream.runHead,
        Effect.asVoid,
      ),
    holdSettlement: () => {
      const released = Deferred.makeUnsafe<void>();
      held = Deferred.await(released);
      return () => {
        Deferred.doneUnsafe(released, Effect.void);
      };
    },
    dispose: () => Scope.close(scope, Exit.void),
  } satisfies LifecycleWorld<TTx, TWrite>;
});

function startFromOf(thread: ThreadRow): ThreadRunStartFrom {
  return {
    id: thread.id,
    ownerId: thread.ownerId,
    account: thread.account,
    provider: thread.provider,
    model: thread.model,
    reasoning: thread.reasoning,
    switches: {},
  };
}

export function started<T extends { readonly _tag: 'Started' | 'Replayed' }>(start: T): Extract<T, { readonly _tag: 'Started' }> {
  if (start._tag !== 'Started') throw new Error('The start replayed a run instead of starting one.');
  return start as Extract<T, { readonly _tag: 'Started' }>;
}
