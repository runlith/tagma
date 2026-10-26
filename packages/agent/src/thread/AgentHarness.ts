import { Context, Duration, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { WorkflowEngine, workflowEngineLayer } from '../workflow/engine';
import type { WorkflowPlan } from '../workflow/plan';
import type { WorkflowArgumentsError, WorkflowRun } from '../workflow/run';
import type { ThreadOpenView, ThreadResumeOf, ThreadSnapshotOf } from '../transcript/live';
import type { ThreadState } from './state';
import type { ThreadBindings } from '../agent/contracts';
import type { ThreadHostBinding, ThreadRow } from './rows';
import type { ThreadBornOf } from '../protocol/birth';
import { ThreadCacheCurve, type ThreadCacheCurveReading, threadCacheCurveLayer } from './cache/ThreadCacheCurve';
import type { ThreadTranscriptPage } from '../transcript/rows';
import { ThreadAggregate, threadAggregateLayer, type ThreadCreateInput } from './run/ThreadAggregate';
import { threadAdmissionLayer } from './run/ThreadAdmission';
import type { StatusRow } from '../transcript/live';
import { ThreadBranch, threadBranchLayer, type ThreadDuplicateInput } from './run/ThreadBranch';
import { threadAgentDoorsLayer } from './agents/ThreadAgentDoors';
import { threadCompactionRunsLayer } from './run/ThreadCompactionRunsLayer';
import { threadDirectoryLayer } from '../collaboration/ThreadDirectory';
import { DeclaredCollaboration } from '../collaboration/CollaborationConfig';
import { endingRunnerLayer } from '../collaboration/collaborationReports';
import { collaborationResidencyLayer, spawnSeatsLayer } from '../collaboration/collaborationResidency';
import { collaborationToolSourcesLayer } from '../collaboration/collaborationToolSources';
import { userQuestionToolSourceLayer } from './agents/userQuestionToolSource';
import { collaborationWorkflowMembersLayer } from '../collaboration/collaborationWorkflowMembers';
import { registerCollaborationRules } from '../collaboration/ThreadObligations';
import { AgentRuleRegistry } from '../agent/policy/AgentRuntimePolicy';
import type { ThreadView } from './agents/ThreadAgent';
import { threadSpawnAccessLayer } from '../collaboration/ThreadSpawnAccess';
import {
  ThreadEnvelopes,
  threadEnvelopesLayer,
  type ThreadEnvelopeInput,
  type ThreadEnvelopeReceipt,
} from '../collaboration/ThreadEnvelopes';
import { ThreadHosting, threadHostingLayer } from './run/ThreadHosting';
import { threadModesLayer } from './run/ThreadModes';
import type { ThreadLiveFeed } from './run/ThreadLiveFeed';
import type { ThreadStateShape } from './state';
import {
  ThreadStore,
  type ThreadFeed,
  type ThreadWriteTx,
  emptyThreadWorkflowMembersLayer,
  ThreadRunRules,
  unboundedThreadBudgetLayer,
  unboundedThreadResidencyLayer,
  emptyThreadResourceLedgerLayer,
} from './ThreadPorts';
import { threadFeedLayer } from './run/ThreadLiveFeed';
import { ThreadActReusedError, ThreadActSpentError } from './transition/port';
import { threadRunSequencesLayer } from './transition/sequence';
import { bordered, ThreadCallBroke, type ThreadBorderFailed, ThreadMissing } from './ThreadBorder';
import { ThreadHandle } from './ThreadHandle';
import { threadRewindLayer } from './run/ThreadRewind';
import { ThreadAttributions, threadAttributionsLayer } from './run/ThreadAttributions';
import { ThreadStepObserver, threadStepObserverLayer, type ThreadStepFinished } from './ThreadStepObserver';
import { accountedThreadBudgetLayer, threadRunAccountingLayer } from './run/ThreadRunAccounting';
import { type RequestLanded, RunRequests, runRequestsLayer } from './run/requests';
import { runProgressLayer } from './run/RunProgress';
import { threadRunInboxLayer } from './run/ThreadRunInbox';
import { type ThreadRunSettled, ThreadRunLedger, threadRunLedgerLayer } from './run/ThreadRunLedger';
import { runExecutionLayer } from './run/RunExecution';
import { runLifecycleLayer } from './run/lifecycle/RunLifecycle';
import { RunReports, runReportsLayer } from './run/lifecycle/RunReports';
import { runBeaterLayer } from './run/RunBeater';
import { RunControl, runControlLayer } from './run/RunControl';
import { LaunchGate, launchGate, launchGateLayer } from './run/LaunchGate';
import { RunGuidance, runGuidanceLayer } from './run/RunGuidance';
import { wordsInFlightLayer } from './run/WordsInFlight';
import type { JournalRuns } from './transport/contract';
import { Transports, transportsLayer } from './transport/Transports';
import { nativeTransportLayer } from './transport/native/NativeRuns';
import { nativeLaunchesLayer } from './transport/native/launches';
import {
  type Redelivery,
  type RunEnding,
  RunEndings,
  type RunEndingsPage,
  runEndingsLayer,
  type ThreadCursorRefused,
} from './run/lifecycle/endings';
import type { Cursor } from '@runlith/paging';
import { ApprovalParking, approvalParkingLayer } from './run/ApprovalParking';
import { approvalAnswersLayer } from './run/ApprovalAnswers';
import { Questions, questionsLayer } from './run/Questions';
import { modeLawLayer } from '../modes/ModeLaw';
import { senderWakesLayer } from './run/SenderWakes';
import { threadSettlementOutboxLayer } from './run/ThreadSettlementOutbox';
import { ThreadRunReaper, threadRunReaperLayer } from './run/ThreadRunReaper';
import { type ThreadRunSettledSubscriber, ThreadRunSettlements, threadRunSettlementsLayer } from './run/ThreadRunSettlements';
import { threadChangesLayer } from './run/ThreadChanges';
import { threadRunContextsClosingLayer, threadRunContextsLayer } from './run/ThreadRunContexts';
import { runAssemblyLayer } from './run/assembly/RunAssembly';
import { runSchedulerLayer } from './run/scheduler/RunScheduler';
import { threadModelsLayer } from './run/ThreadModels';
import {
  ThreadIntrospection,
  threadIntrospectionLayer,
  type ThreadLogWindow,
  type ThreadLogWindowInput,
  type ThreadQueryAnswer,
  type ThreadQueryInput,
  type ThreadQueryTarget,
  type ThreadSessionShape,
} from './run/ThreadIntrospection';
import { ThreadComposition, threadCompositionLayer } from './run/ThreadComposition';
import type { ThreadRequestComposition } from './composition/requestComposition';
import type { ThreadEventRecord } from './events';
import { ThreadSnapshots, threadSnapshotsLayer } from './run/ThreadSnapshots';
import { ThreadPlanes, threadPlanesLayer } from '../collaboration/ThreadPlanes';
import { ThreadSpawnTree, threadSpawnTreeLayer } from '../collaboration/ThreadSpawnTree';
import { DeclaredResources } from '../resources/ResourcesConfig';
import { resourceLedgerLayer } from '../resources/threadResourceLedger';
import { resourcesToolSourcesLayer } from '../resources/resourcesToolSources';
import type { ThreadSpawnResult, ThreadVerbs } from '../collaboration/ThreadPlaneAccess';
import { Threads } from '../collaboration/threads';
import { ThreadRuns } from '../collaboration/runs';
import { ContextCompaction } from '../collaboration/compaction';
import { ThreadModel } from '../collaboration/model';
import { runOwnership } from './run/ownership';
import type { RunOwnership } from './run/ThreadRunLedger';
import { nativeContextCompactionLayer } from '../collaboration/native/compaction';
import { nativeThreadModelLayer } from '../collaboration/native/model';
import { nativeThreadRunsLayer } from '../collaboration/native/runs';
import { nativeThreadsLayer } from '../collaboration/native/threads';
import { endingDriveLayer } from './run/endingDrive';
import { threadKernelPorts, type ThreadDefaultedPorts, type ThreadGivenPorts } from './kernelPorts';
import { ThreadDeletion, threadDeletionLayer } from './run/ThreadDeletion';
import { ThreadStopping, threadStoppingLayer } from './run/ThreadStopping';
import type { ThreadStop, ThreadStopOptions } from './ending';
import { threadToolSettlementsLayer } from './ToolSettlements';

export type AgentHarnessOptions<TState extends ThreadState> = {
  readonly toState?: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>;
  readonly settled?: (event: ThreadRunSettled) => Effect.Effect<void, ThreadBorderFailed>;
  readonly subscribers?: readonly ThreadRunSettledSubscriber[];
  readonly fillers?: ThreadPortFillers;
  readonly gate?: Context.Service.Shape<typeof LaunchGate>;
};

export type HarnessLaunchGate = Context.Service.Shape<typeof LaunchGate>;

export const newLaunchGate = (): HarnessLaunchGate => launchGate();

export type EngineHandles = {
  handle(
    threadId: string,
    ownerId: string,
  ): {
    stop(expectedRunId: string | undefined, options: ThreadStopOptions): Effect.Effect<ThreadStop, ThreadBorderFailed>;
    delete(within?: Duration.Duration): Effect.Effect<boolean, ThreadBorderFailed>;
  };
};

export type ThreadPortFillers = {
  readonly threads?: (native: Context.Service.Shape<typeof Threads>, engine: EngineHandles) => Context.Service.Shape<typeof Threads>;
  readonly runs?: (native: Context.Service.Shape<typeof ThreadRuns>) => Context.Service.Shape<typeof ThreadRuns>;
  readonly compaction?: (native: Context.Service.Shape<typeof ContextCompaction>) => Context.Service.Shape<typeof ContextCompaction>;
  readonly model?: (native: Context.Service.Shape<typeof ThreadModel>) => Context.Service.Shape<typeof ThreadModel>;
};

export type ThreadKernelInputs = ThreadGivenPorts | ThreadDefaultedPorts | ThreadFeed;

function whenDeclared<D, F, A, E1, R1, E2, R2>(
  feature: Context.Service<D, F | null>,
  on: Layer.Layer<A, E1, R1>,
  off: Layer.Layer<A, E2, R2>,
): Layer.Layer<A, E1 | E2, R1 | R2 | D> {
  return Layer.unwrap(Effect.map(feature, (declared): Layer.Layer<A, E1 | E2, R1 | R2> => (declared === null ? off : on)));
}

function collaborating<A, E1, R1, E2, R2>(
  on: Layer.Layer<A, E1, R1>,
  off: Layer.Layer<A, E2, R2>,
): Layer.Layer<A, E1 | E2, R1 | R2 | DeclaredCollaboration> {
  return whenDeclared(DeclaredCollaboration, on, off);
}

const runRulesLayer = Layer.effect(
  ThreadRunRules,
  Effect.gen(function* () {
    const rules = new AgentRuleRegistry<unknown, ThreadView>();
    if ((yield* DeclaredCollaboration) !== null) yield* Effect.orDie(registerCollaborationRules(rules));
    return rules;
  }),
);

const toolSourceRegistrations = Layer.mergeAll(userQuestionToolSourceLayer, collaborationToolSourcesLayer, resourcesToolSourcesLayer);

const engineHandlesOf = Effect.gen(function* () {
  const store = yield* ThreadStore;
  const stopping = yield* ThreadStopping;
  const deletion = yield* ThreadDeletion;
  return {
    handle: (threadId, ownerId) => ({
      stop: (expectedRunId, options) =>
        Effect.flatMap(store.metadata(threadId), (thread) =>
          thread !== undefined && thread.ownerId === ownerId
            ? stopping.byReader(thread, expectedRunId, options)
            : Effect.fail(new ThreadCallBroke({ cause: new Error(`Thread not found: ${threadId}.`) })),
        ),
      delete: (within) => deletion.remove(ownerId, threadId, within),
    }),
  } satisfies EngineHandles;
});

function filledPort<I, S, E, R, RF>(
  tag: Context.Service<I, S>,
  native: Layer.Layer<I, E, R>,
  fill: ((native: S) => Effect.Effect<S, never, RF>) | undefined,
): Layer.Layer<I, E, R | Exclude<RF, I>> {
  return fill === undefined ? native : Layer.effect(tag, Effect.flatMap(tag, fill)).pipe(Layer.provide(native));
}

export function threadKernelLayer(
  ports: Layer.Layer<ThreadKernelInputs>,
  fillers: ThreadPortFillers = {},
  gate?: Context.Service.Shape<typeof LaunchGate>,
) {
  const { threads, runs, compaction, model } = fillers;
  const threadsLayer = filledPort(
    Threads,
    nativeThreadsLayer,
    threads && ((native) => Effect.map(engineHandlesOf, (engine) => threads(native, engine))),
  );
  const runsLayer = filledPort(ThreadRuns, nativeThreadRunsLayer, runs && ((native) => Effect.succeed(runs(native))));
  const compactionLayer = filledPort(
    ContextCompaction,
    nativeContextCompactionLayer,
    compaction && ((native) => Effect.succeed(compaction(native))),
  );
  const modelLayer = filledPort(ThreadModel, nativeThreadModelLayer, model && ((native) => Effect.succeed(model(native))));
  const floors = Layer.merge(runAssemblyLayer, threadModelsLayer).pipe(
    Layer.provideMerge(Layer.merge(threadCompactionRunsLayer, runRulesLayer)),
    Layer.provideMerge(threadAgentDoorsLayer),
    Layer.provideMerge(threadDirectoryLayer),
    Layer.provideMerge(threadsLayer),
    Layer.provideMerge(threadDeletionLayer.pipe(Layer.provideMerge(threadStoppingLayer))),
    Layer.provideMerge(Layer.merge(collaborating(accountedThreadBudgetLayer, unboundedThreadBudgetLayer), threadSnapshotsLayer)),
    Layer.provideMerge(Layer.merge(threadIntrospectionLayer, threadCacheCurveLayer)),
    Layer.provideMerge(threadCompositionLayer),
    Layer.provideMerge(threadBranchLayer),
    Layer.provideMerge(Layer.mergeAll(threadAttributionsLayer, runExecutionLayer, runBeaterLayer, threadRunContextsClosingLayer)),
    Layer.provideMerge(
      Layer.mergeAll(
        threadRunContextsLayer,
        approvalParkingLayer,
        gate === undefined ? launchGateLayer : Layer.succeed(LaunchGate, gate),
        runGuidanceLayer,
        wordsInFlightLayer,
      ),
    ),
    Layer.provideMerge(threadRunInboxLayer),
    Layer.provideMerge(Layer.mergeAll(threadRunLedgerLayer, runLifecycleLayer, runEndingsLayer, modeLawLayer)),
    Layer.provideMerge(Layer.merge(threadSettlementOutboxLayer, runRequestsLayer)),
    Layer.provideMerge(Layer.merge(threadRunAccountingLayer, runProgressLayer)),
    Layer.provideMerge(threadRunSettlementsLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        threadChangesLayer,
        threadStepObserverLayer,
        threadRunSequencesLayer,
        runControlLayer.pipe(Layer.provideMerge(transportsLayer)),
      ),
    ),
    Layer.provideMerge(whenDeclared(DeclaredResources, resourceLedgerLayer, emptyThreadResourceLedgerLayer)),
    Layer.provideMerge(collaborating(collaborationResidencyLayer, unboundedThreadResidencyLayer).pipe(Layer.provideMerge(spawnSeatsLayer))),
    Layer.provideMerge(threadToolSettlementsLayer.pipe(Layer.provideMerge(ports))),
  );
  return threadAdmissionLayer.pipe(
    Layer.provideMerge(threadAggregateLayer),
    Layer.provideMerge(threadModesLayer),
    Layer.provideMerge(threadHostingLayer),
    Layer.provideMerge(threadRunReaperLayer),
    Layer.provideMerge(workflowEngineLayer),
    Layer.provideMerge(endingDriveLayer),
    Layer.provideMerge(endingRunnerLayer),
    Layer.provideMerge(
      Layer.merge(toolSourceRegistrations, collaborating(collaborationWorkflowMembersLayer, emptyThreadWorkflowMembersLayer)),
    ),
    Layer.provideMerge(threadPlanesLayer),
    Layer.provideMerge(threadSpawnTreeLayer),
    Layer.provideMerge(threadRewindLayer),
    Layer.provideMerge(threadSpawnAccessLayer),
    Layer.provideMerge(threadEnvelopesLayer),
    Layer.provideMerge(Layer.mergeAll(runsLayer, compactionLayer, modelLayer)),
    Layer.provideMerge(approvalAnswersLayer),
    Layer.provideMerge(
      runReportsLayer.pipe(
        Layer.provideMerge(senderWakesLayer),
        Layer.provideMerge(Layer.merge(nativeTransportLayer, runBeaterLayer)),
        Layer.provideMerge(questionsLayer),
        Layer.provideMerge(runSchedulerLayer),
        Layer.provideMerge(nativeLaunchesLayer),
      ),
    ),
    Layer.provideMerge(floors),
  );
}

function productSettledLayer(
  settled: AgentHarnessOptions<ThreadState>['settled'],
  joined: readonly ThreadRunSettledSubscriber[] = [],
): Layer.Layer<never, never, ThreadRunSettlements> {
  const subscribers = [...(settled === undefined ? [] : [{ name: 'product onSettled', handle: settled }]), ...joined];
  if (subscribers.length === 0) return Layer.empty;
  return Layer.effectDiscard(
    Effect.flatMap(ThreadRunSettlements, (settlements) =>
      Effect.forEach(subscribers, (subscriber) => settlements.subscribe(subscriber), { discard: true }),
    ),
  );
}

type HarnessServices = Layer.Success<ReturnType<typeof threadKernelLayer>>;

type HarnessRun = <A, E>(work: Effect.Effect<A, E, HarnessServices>) => Effect.Effect<A, E>;

const recordOf = Effect.fnUntraced(function* (threadId: string, ownerId: string) {
  const record = yield* (yield* Threads).find(threadId, ownerId);
  if (record === null) return yield* new ThreadMissing({ threadId });
  return record;
});

type ThreadSpawnInput = {
  readonly parentThreadId: string;
  readonly ownerId: string;
  readonly requestId: string;
  readonly bornOf?: ThreadBornOf;
  readonly agentId: string;
  readonly task: string;
  readonly name?: string;
  readonly host?: ThreadHostBinding;
  readonly bindings?: ThreadBindings;
  readonly model?: { provider?: string; model?: string; reasoning?: string | null };
  readonly project?: number;
  readonly plain?: boolean;
};

type ThreadWorkflowStart = {
  readonly id: string;
  readonly workflow: string;
  readonly plan: WorkflowPlan;
  readonly thread: string;
  readonly input: Record<string, unknown>;
};

export type HarnessThreads<TState extends ThreadState, TTx, TWrite extends TTx> = {
  handle(threadId: string, ownerId: string): ThreadHandle<TState, TTx, TWrite>;
  create(input: ThreadCreateInput): Effect.Effect<ThreadRow, ThreadBorderFailed>;
  create<T>(
    input: ThreadCreateInput,
    commit: (thread: ThreadRow, tx: TWrite) => Effect.Effect<T, ThreadBorderFailed>,
  ): Effect.Effect<T, ThreadBorderFailed>;
  duplicate(input: ThreadDuplicateInput): Effect.Effect<ThreadRow, ThreadBorderFailed>;
  deleteByHost(ownerId: string, hostKind: string, hostId: string): Effect.Effect<void, ThreadBorderFailed>;
  publish(threadId: string): Effect.Effect<void, ThreadBorderFailed>;
};

export type HarnessRuns = {
  recover(): Effect.Effect<void, ThreadBorderFailed>;
  recoverNow(): Effect.Effect<number, ThreadBorderFailed>;
  ownership(): Effect.Effect<RunOwnership>;
  hosting(): ThreadHosting['Service'];
  questions(): Questions['Service'];
  onDriving(hook: (count: number) => void): void;
  redeliver(threadId: string, runId: string): Effect.Effect<Redelivery, ThreadBorderFailed>;
  parked(): readonly string[];
  transports(): Transports['Service'];
  reports(): RunReports['Service'];
  ledger(): ThreadRunLedger['Service'];
  settlements(): ThreadRunSettlements['Service'];
  guidance(): RunGuidance['Service'];
  history(): JournalRuns;
};

export type HarnessInputs = {
  deliver(threadId: string, ownerId: string, envelope: ThreadEnvelopeInput): Effect.Effect<ThreadEnvelopeReceipt, ThreadBorderFailed>;
};

export type HarnessReads<TState extends ThreadState> = {
  snapshot(threadId: string): Effect.Effect<ThreadSnapshotOf<TState>, ThreadBorderFailed>;
  statuses(ownerId: string, threadIds: readonly string[]): Effect.Effect<readonly StatusRow[], ThreadBorderFailed>;
  endings(input: {
    readonly threadIds: readonly string[];
    readonly limit: number;
    readonly cursor?: Cursor;
  }): Effect.Effect<RunEndingsPage, ThreadBorderFailed | ThreadCursorRefused>;
  newestEndings(threadIds: readonly string[], depth: number): Effect.Effect<readonly RunEnding[], ThreadBorderFailed>;
  page(threadId: string, before: number): Effect.Effect<ThreadTranscriptPage, ThreadBorderFailed>;
  attachFrom(threadId: string, sincePosition: number): Effect.Effect<ThreadResumeOf<TState> | null, ThreadBorderFailed>;
  shape(threadId: string): Effect.Effect<ThreadSessionShape, ThreadBorderFailed>;
  composition(threadId: string): Effect.Effect<ThreadRequestComposition, ThreadBorderFailed>;
  window(threadId: string, input: ThreadLogWindowInput): Effect.Effect<ThreadLogWindow, ThreadBorderFailed>;
  cacheCurves(providers: readonly string[]): Effect.Effect<readonly ThreadCacheCurveReading[], ThreadBorderFailed>;
  pin(threadId: string): Effect.Effect<ThreadQueryTarget, ThreadBorderFailed>;
  query(input: ThreadQueryInput): Effect.Effect<ThreadQueryAnswer, ThreadBorderFailed>;
  entryAt(threadId: string, position: number): Effect.Effect<ThreadEventRecord | null, ThreadBorderFailed>;
  entryNamed(threadId: string, recordId: string): Effect.Effect<ThreadEventRecord | null, ThreadBorderFailed>;
  steps(threadId?: string): Stream.Stream<ThreadStepFinished>;
  requests(): Stream.Stream<RequestLanded>;
  subscribe(threadId: string, listener: Parameters<ThreadLiveFeed<TState>['subscribe']>[1]): () => void;
  openView(threadId: string): ThreadOpenView;
  subscribeStates(listener: (state: TState) => void): () => void;
};

export type HarnessCollaboration = {
  spawn(input: ThreadSpawnInput): Effect.Effect<ThreadSpawnResult, ThreadBorderFailed>;
  collaborate<A, E>(
    threadId: string,
    ownerId: string,
    work: (verbs: ThreadVerbs) => Effect.Effect<A, E>,
  ): Effect.Effect<A, ThreadBorderFailed>;
};

export type HarnessWorkflows = {
  start(input: ThreadWorkflowStart): Effect.Effect<WorkflowRun | WorkflowArgumentsError, ThreadBorderFailed>;
  advance(runId: string): Effect.Effect<WorkflowRun | undefined, ThreadBorderFailed>;
};

export class AgentHarness<TState extends ThreadState = ThreadState, TTx = unknown, TWrite extends TTx = TTx> {
  readonly threads: HarnessThreads<TState, TTx, TWrite>;
  readonly runs: HarnessRuns;
  readonly inputs: HarnessInputs;
  readonly reads: HarnessReads<TState>;
  readonly collaboration: HarnessCollaboration;
  readonly workflows: HarnessWorkflows;
  static make = Effect.fnUntraced(function* <TState extends ThreadState = ThreadState, TTx = unknown, TWrite extends TTx = TTx>(
    ports: Layer.Layer<ThreadGivenPorts>,
    live: ThreadLiveFeed<TState>,
    options: AgentHarnessOptions<TState> = {},
  ): Effect.fn.Return<AgentHarness<TState, TTx, TWrite>> {
    const toState = options.toState ?? ((state) => Effect.succeed(state as TState));
    const kernel = threadKernelLayer(Layer.merge(threadKernelPorts(ports), threadFeedLayer(live, toState)), options.fillers, options.gate);
    const scope = yield* Scope.make();
    const services = yield* Layer.buildWithScope(
      productSettledLayer(options.settled, options.subscribers).pipe(Layer.provideMerge(kernel)),
      scope,
    );
    return new AgentHarness<TState, TTx, TWrite>(services, scope, live, toState);
  });

  private constructor(
    services: Context.Context<HarnessServices>,
    private readonly scope: Scope.Closeable,
    live: ThreadLiveFeed<TState>,
    toState: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>,
  ) {
    const run: HarnessRun = (work) => Effect.provide(work, services);
    this.threads = harnessThreads<TState, TTx, TWrite>(run, toState);
    this.runs = {
      recover: () => run(Effect.flatMap(ThreadRunReaper, (reaper) => reaper.triggerRecovery())),
      recoverNow: () => run(Effect.flatMap(ThreadRunReaper, (reaper) => reaper.recover())),
      ownership: () => run(runOwnership),
      hosting: () => Context.get(services, ThreadHosting),
      questions: () => Context.get(services, Questions),
      onDriving: (hook) => Context.get(services, RunControl).onChange(hook),
      redeliver: (threadId, runId) => run(Effect.flatMap(RunEndings, (endings) => endings.redeliver(threadId, runId))),
      parked: () => Context.get(services, ApprovalParking).parked(),
      transports: () => Context.get(services, Transports),
      reports: () => Context.get(services, RunReports),
      ledger: () => Context.get(services, ThreadRunLedger),
      settlements: () => Context.get(services, ThreadRunSettlements),
      guidance: () => Context.get(services, RunGuidance),
      history: () => Context.get(services, ThreadAttributions),
    };
    this.inputs = {
      deliver: (threadId, ownerId, envelope) =>
        run(
          bordered(
            Effect.gen(function* () {
              const recipient = yield* recordOf(threadId, ownerId);
              return yield* (yield* ThreadEnvelopes).deliver(recipient, envelope);
            }),
          ),
        ),
    };
    this.reads = harnessReads<TState>(run, toState, services, live);
    this.collaboration = {
      spawn: ({ parentThreadId, ownerId, ...request }) =>
        run(
          bordered(
            Effect.gen(function* () {
              const parent = yield* recordOf(parentThreadId, ownerId);
              return yield* (yield* ThreadSpawnTree).spawn({ ...request, parent });
            }),
          ),
        ),
      collaborate: (threadId, ownerId, work) =>
        run(
          bordered(
            Effect.gen(function* () {
              const verbs = (yield* ThreadPlanes).verbs(yield* recordOf(threadId, ownerId));
              if (verbs === null) {
                return yield* new ThreadCallBroke({
                  cause: new Error('This host declared no collaboration, so no thread here speaks to another agent.'),
                });
              }
              return yield* work(verbs);
            }),
          ),
        ),
    };
    this.workflows = {
      start: (input) => run(Effect.flatMap(WorkflowEngine, (engine) => engine.start(input))),
      advance: (runId) => run(Effect.flatMap(WorkflowEngine, (engine) => engine.advance(runId))),
    };
  }

  dispose(): Effect.Effect<void> {
    return Scope.close(this.scope, Exit.void);
  }
}

function harnessThreads<TState extends ThreadState, TTx, TWrite extends TTx>(
  run: HarnessRun,
  toState: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>,
): HarnessThreads<TState, TTx, TWrite> {
  function create(input: ThreadCreateInput): Effect.Effect<ThreadRow, ThreadBorderFailed>;
  function create<T>(
    input: ThreadCreateInput,
    commit: (thread: ThreadRow, tx: TWrite) => Effect.Effect<T, ThreadBorderFailed>,
  ): Effect.Effect<T, ThreadBorderFailed>;
  function create<T>(
    input: ThreadCreateInput,
    commit?: (thread: ThreadRow, tx: TWrite) => Effect.Effect<T, ThreadBorderFailed>,
  ): Effect.Effect<T | ThreadRow, ThreadBorderFailed> {
    return run(
      Effect.flatMap(ThreadAggregate, (aggregate) =>
        aggregate.create(input, commit as ((thread: ThreadRow, tx: ThreadWriteTx) => Effect.Effect<T, ThreadBorderFailed>) | undefined),
      ),
    );
  }
  return {
    handle: (threadId, ownerId) => new ThreadHandle(run, toState, threadId, ownerId),
    create,
    duplicate: (input) =>
      run(
        Effect.gen(function* () {
          const answer = yield* (yield* ThreadBranch).fork(input);
          if ('born' in answer) return answer.born;
          const settled = answer.settled;
          if ('spent' in settled) return yield* Effect.fail(new ThreadActSpentError({ threadId: input.sourceThreadId, at: settled.spent }));
          if ('reused' in settled && input.birth)
            return yield* Effect.fail(new ThreadActReusedError({ threadId: input.sourceThreadId, evidence: input.birth.evidence }));
          const standing =
            'standing' in settled && settled.standing !== null ? yield* (yield* ThreadStore).find(settled.standing) : undefined;
          if (standing !== undefined) return standing;
          return yield* new ThreadCallBroke({
            cause: new Error(`The branch of ${input.sourceThreadId} was settled before it was born: ${JSON.stringify(settled)}.`),
          });
        }),
      ),
    deleteByHost: (ownerId, hostKind, hostId) =>
      run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.deleteByHost(ownerId, hostKind, hostId))),
    publish: (threadId) => run(Effect.flatMap(ThreadSnapshots, (snapshots) => snapshots.publish(threadId))),
  };
}

function harnessReads<TState extends ThreadState>(
  run: HarnessRun,
  toState: (state: ThreadState) => Effect.Effect<TState, ThreadBorderFailed>,
  services: Context.Context<HarnessServices>,
  live: ThreadLiveFeed<TState>,
): HarnessReads<TState> {
  return {
    snapshot: (threadId) =>
      run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.snapshot(threadId))).pipe(
        Effect.flatMap((base) => {
          const { transcript, before, live: open, ...state } = base;
          return Effect.map(toState(state), (projected) => ({ ...projected, transcript, before, live: open }));
        }),
      ),
    statuses: (ownerId, threadIds) => run(Effect.flatMap(ThreadSnapshots, (snapshots) => snapshots.statuses(ownerId, threadIds))),
    endings: (input) => run(Effect.flatMap(RunEndings, (endings) => endings.page(input))),
    newestEndings: (threadIds, depth) => run(Effect.flatMap(RunEndings, (endings) => endings.newest(threadIds, depth))),
    page: (threadId, before) => run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.page(threadId, before))),
    attachFrom: (threadId, sincePosition) =>
      run(Effect.flatMap(ThreadAggregate, (aggregate) => aggregate.attachFrom(threadId, sincePosition))).pipe(
        Effect.flatMap((attached) =>
          attached === null
            ? Effect.succeed(null)
            : toState(attached.state).pipe(Effect.map((state) => ({ state, deltas: attached.deltas, live: attached.live }))),
        ),
      ),
    shape: (threadId) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.shape(threadId))),
    composition: (threadId) => run(Effect.flatMap(ThreadComposition, (reads) => reads.of(threadId))),
    window: (threadId, input) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.window(threadId, input))),
    cacheCurves: (providers) => run(Effect.flatMap(ThreadCacheCurve, (curve) => curve.of(providers))),
    pin: (threadId) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.pin(threadId))),
    query: (input) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.query(input))),
    entryAt: (threadId, position) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.entryAt(threadId, position))),
    entryNamed: (threadId, recordId) => run(Effect.flatMap(ThreadIntrospection, (reads) => reads.entryNamed(threadId, recordId))),
    steps: (threadId) => {
      const finished = Stream.fromPubSub(Context.get(services, ThreadStepObserver));
      return threadId === undefined ? finished : Stream.filter(finished, (step) => step.run.threadId === threadId);
    },
    requests: () => Context.get(services, RunRequests).landed,
    subscribe: (threadId, listener) => live.subscribe(threadId, listener),
    openView: (threadId) => live.view(threadId),
    subscribeStates: (listener) => live.subscribeStates(listener),
  };
}
