import { resolveCatalog, type ToolGrant } from '../../../catalog/resolveCatalog';
import { approvalModesLayer } from '../../../modes/ApprovalModes';
import { playRun, type ScriptedRun } from '../scriptedRun';
import { unthreadedCaller } from '../../../agent/testing/caller';
import { Clock, type Context, Deferred, Effect, Layer } from 'effect';
import type { ThreadRuns } from '../../../collaboration/runs';
import { openToolDoor } from '../../../agent/door/openToolDoor';
import { ToolJudge } from '../../../agent/door/openToolDoor';
import { AgentRunState } from '../../../agent/AgentRunState';
import { modelCatalog, type ModelCatalog } from '@runlith/llm/models/catalog';
import { Message } from '@runlith/llm/schema/messages';
import { type ToolCatalog } from '../../../agent/ToolCatalog';
import type { ThreadSnapshot, ThreadState } from '../../state';
import type { ThreadRow } from '../../rows';
import type { ThreadStorageFactory, ThreadStorageHarness } from '../storagePort';
import type { ThreadAttachmentRef } from '../../../transcript/attachments';
import type { ThreadQueuedTurn } from '../../../transcript/live';
import type { ThreadAttachmentStorage } from '../../attachmentStorage';
import { AgentHarness } from '../../AgentHarness';
import type { ThreadHandle } from '../../ThreadHandle';
import { makeThreadCompaction } from '../../run/ThreadCompaction';
import { threadAgentsLayer, threadCompactorLayer, threadFeaturesLayer, threadStorageLayer } from '../../kernelPorts';
import type { ThreadCompactionPolicy } from '../../compaction/policy';
import { makeThreadSummaryStrategy, type ThreadCompactionPrompt } from '../../compaction/summaryStrategy';
import { makeThreadDigestStrategy } from '../../compaction/digestStrategy';
import type { ThreadCompactionText } from '../../compaction/text';
import { makeThreadLiveFeed } from '../../run/ThreadLiveFeed';
import type { ThreadRunSettled } from '../../run/ThreadRunLedger';
import type { ThreadRunLeaseRhythm } from '../../ThreadPorts';
import type { ThreadRunReaperRhythm } from '../../ThreadPorts';
import type { ThreadSettlementOutboxRhythm } from '../../ThreadPorts';
import type { ThreadTranscriptEntry } from '../../../transcript/rows';
import type { ThreadLiveEvent } from '../../run/ThreadLiveFeed';
import { threadHostLayer, type ThreadRhythms } from '../../ThreadPorts';
import type { ApproversPort } from '../../Approvers';
import type { TransportBinding } from '../../record';
import { bordered, ThreadCallBroke, type ThreadBorderFailed } from '../../ThreadBorder';
import type { ResourcesConfig } from '../../../resources/ResourcesConfig';
import type { ThreadResourceRow, ThreadResourceStorage } from '../../storage/resources';
import { type ThreadRunInput, type ThreadAgent, type ThreadPrepareInput, type ThreadPreparedRun } from '../../agents/ThreadAgent';
import { registeredAgents } from '../agents';
import { composedInstructions, supplied } from '../../agents/supply';
import type { CompactionModels } from '../../compaction/CompactionModels';
import type { ThreadToolOutputStorage } from '../../toolOutputs';
import { SUB_AGENT_DEPTH } from '../../../collaboration/CollaborationConfig';
import { makeLandingHolds, RunAdmission } from '../../run/runAdmission';
import { ThreadEntryKinds } from '../../../transcript/kinds';

export const OWNER = 'owner';
export const SCOPE = 'scope-a';

export type ScriptedRhythm = ThreadRunLeaseRhythm &
  ThreadRunReaperRhythm &
  ThreadSettlementOutboxRhythm & { readonly streamFlushIntervalMs: number };

export const RHYTHM: ScriptedRhythm = {
  heartbeatIntervalMs: 30_000,
  staleRunningAfterMs: 30_000,
  takeoverAfterMs: 0,
  staleSweepIntervalMs: 30_000,
  settledClaimAfterMs: 30_000,
  settledHeartbeatIntervalMs: 30_000,
  settledNotificationBatch: 1,
  recoveryBatch: 1,
  resumeWithinMs: 20 * 60_000,
  resumeAttemptLimit: 1,
  settledNotifyAttemptLimit: 1,
  streamFlushIntervalMs: 0,
};

export const COMPACTION_POLICY: ThreadCompactionPolicy = {
  compactionTrigger: { strategy: 'reserve-output' },
  compactionOverrides: [],
  bufferTokens: 20_000,
  imageTokens: 0,
  maxRecentTokens: 8_000,
  minRecentTokens: 2_000,
  maxOpeningTokens: 0,
  recentFraction: 0.25,
  recentUserTurns: 2,
  toolPruneProtectShare: 0.2,
};

export const COMPACTION_PROMPT: ThreadCompactionPrompt = {
  instructions: 'Summarize the thread segment.',
  template: 'Use exactly these sections:\n## State',
};

export const COMPACTION_TEXT: ThreadCompactionText = {
  checkpointMarker: 'Continue from the anchored thread state below.',
  prunedToolOutput: '[Old tool result content cleared]',
  overflowMediaGuidance: 'Attached media was omitted from this retry.',
  omittedMedia: (mediaType) => `[Attached ${mediaType ?? 'media'} omitted.]`,
};

export type ScriptedCrossing = {
  readonly generation: number;
  readonly admitted?: { readonly instructions: string; readonly tools: readonly string[] };
};

export type ScriptedInput = ThreadRunInput & ThreadPrepareInput;

export type ScriptedTurn = (input: ScriptedInput) => ScriptedRun;

export type ScriptedWorld = {
  harness: AgentHarness<ThreadSnapshot>;
  admission: RunAdmission['Service'];
  plan: ScriptedTurn[];
  ranWith: string[];
  replayed: (readonly Message[])[];
  resolved(): number;
  prepared(): number;
  runs(): ThreadRuns['Service'];
  crossBoundary(
    input: ThreadRunInput,
    at: { stepNumber: number; generation: number },
    refusal?: unknown,
  ): Effect.Effect<ScriptedCrossing, ThreadBorderFailed>;
  dispose(): Effect.Effect<void>;
};

export function grantOf(id: string): ToolGrant {
  return { sources: [id, 'collaboration', 'resources', 'user-question', 'output'].map((source) => ({ source })) };
}

export type ScriptedWorldOptions = {
  catalog?: ToolCatalog;
  models?: ModelCatalog;
  onSettled?: (event: ThreadRunSettled) => Effect.Effect<void, ThreadBorderFailed>;
  toState?: (state: ThreadState) => Effect.Effect<ThreadSnapshot, ThreadBorderFailed>;
  rhythm?: Partial<ScriptedRhythm>;
  spawnSlots?: number;
  opening?: () => Effect.Effect<void, ThreadBorderFailed>;
  instructions?: () => string;
  host?: ThreadPreparedRun['host'];
  orient?: ThreadPreparedRun['orient'];
  outputsDisposed?: () => void;
  harness?: { approvers?: ApproversPort; ownerId?: string };
  transport?: TransportBinding;
};

export const scriptedWorld = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx>(
  storage: ThreadStorageHarness<TTx, TWrite>,
  agentId: string,
  options: ScriptedWorldOptions = {},
) {
  const plan: ScriptedTurn[] = [];
  const ranWith: string[] = [];
  const replayed: (readonly Message[])[] = [];
  let resolveCount = 0;
  let prepareCount = 0;
  const scripted = (id: string): ThreadAgent => ({
    id,
    name: 'Scripted',
    description: 'A scripted run driving the run-log proof.',
    runPolicy: { userStartable: true, backgroundStartable: false },
    grant: grantOf(id),
    prepare: Effect.fnUntraced(function* (prepared) {
      prepareCount += 1;
      if (options.opening) yield* options.opening();
      const given = yield* supplied(prepared.supply, null, prepared.thread.profile);
      return {
        orient: options.orient ?? (() => Effect.succeed(null)),
        start: Effect.fnUntraced(function* (input) {
          if (input.instructions === undefined) resolveCount += 1;
          const resolved = input.instructions ?? given.compose(options.instructions?.() ?? `Scripted prompt v${resolveCount}`);
          const instructions =
            input.instructions ?? (input.commitInstructions ? yield* bordered(input.commitInstructions(resolved)) : resolved);
          ranWith.push(instructions);
          replayed.push(input.messages);
          const turn = plan.shift();
          if (!turn) return yield* new ThreadCallBroke({ cause: new Error('The script has no turn for this run.') });
          return {
            ...(yield* playRun(turn({ ...input, supply: prepared.supply, admitted: prepared.admitted }), input.sink)),
            instructions,
          };
        }),
        host: options.host,
      };
    }),
    instructions(input) {
      return Effect.map(input.sources(null), (sources) =>
        composedInstructions(input.thread.profile, sources, options.instructions?.() ?? `Scripted prompt v${resolveCount}`),
      );
    },
    toolCatalog() {
      return Effect.succeed(options.catalog ?? {});
    },
    toolDoor(input) {
      return Effect.succeed(
        openToolDoor(
          input.run?.id ?? input.thread.id,
          unthreadedCaller,
          {},
          new ToolJudge(input.modeOf),
          new AgentRunState({ priorTools: input.priorTools }),
          undefined,
          undefined,
          input.toolOutputs,
          undefined,
          undefined,
          undefined,
          undefined,
          input.admitted?.generation ?? 0,
          undefined,
          input.resolutions,
        ),
      );
    },
  });
  const live = yield* makeThreadLiveFeed<ThreadSnapshot>();
  const registered = yield* registeredAgents([scripted(agentId), scripted(`${agentId}-fork`)], 'world');
  const admission = makeLandingHolds();
  const ports = Layer.mergeAll(
    threadStorageLayer<TTx, TWrite>({
      storage: storage.aggregate,
      eventLog: storage.eventLog,
      transitions: storage.transitions,
      createRuns: (ownerId) => storage.runs({ ownerId, scope: SCOPE }),
      attachments: inertAttachments<TWrite>(),
      inbox: storage.inbox,
      toolOutputs: inertToolOutputs<TWrite>(options.outputsDisposed),
      ownerSettings: storage.ownerSettings,
    }),
    threadFeaturesLayer({
      resources: inertResources<TTx, TWrite>(),
      collaboration: {
        models: () => options.models ?? modelCatalog([]),
        subAgentDepth: () => Effect.succeed(SUB_AGENT_DEPTH.default),
        delegation: () => Effect.succeed({ allowed: true, setAt: null }),
        reconcileIntervalMs: options.rhythm?.heartbeatIntervalMs ?? RHYTHM.heartbeatIntervalMs,
        spawnSlots: options.spawnSlots,
      },
    }),
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
    threadHostLayer({ rhythms: runRhythms({ ...RHYTHM, ...options.rhythm }), ...options.harness }),
    Layer.succeed(RunAdmission, admission),
    threadAgentsLayer(registered),
    Layer.succeed(ThreadEntryKinds, storage.kinds),
    approvalModesLayer,
  );
  let nativeRuns: ThreadRuns['Service'] | null = null;
  const harness = yield* Effect.acquireRelease(
    AgentHarness.make<ThreadSnapshot, TTx, TWrite>(ports, live, {
      fillers: {
        runs: (native) => {
          nativeRuns = native;
          return native;
        },
      },
      toState: options.toState,
      settled: options.onSettled,
    }),
    (harness) => harness.dispose(),
  );
  const crossBoundary = Effect.fnUntraced(function* (
    input: ThreadRunInput,
    at: { stepNumber: number; generation: number },
    refusal?: unknown,
  ): Effect.fn.Return<ScriptedCrossing, ThreadBorderFailed> {
    const prepared = input.boundary ? yield* bordered(input.boundary(at)) : null;
    if (!prepared) return { generation: at.generation };
    if (refusal !== undefined) {
      yield* bordered(prepared.deny(refusal));
      return { generation: at.generation };
    }
    const given = yield* supplied(prepared.supply, null, input.thread.profile);
    const { catalog } = resolveCatalog({ grant: grantOf(agentId) }, given.supply.profile, [
      { source: agentId, tools: options.catalog ?? {} },
      ...given.supply.contributions,
    ]);
    const admitted = {
      instructions: prepared.instructions ?? given.compose(options.instructions?.() ?? `Scripted prompt v${resolveCount}`),
      tools: Object.keys(catalog),
    };
    const took = yield* bordered(
      prepared.publish({
        stepNumber: at.stepNumber,
        evidence: {
          ...admitted,
          profileId: input.thread.profile?.id ?? null,
          approvalMode: input.run.approvalMode,
        },
      }),
    );
    return { generation: took ? prepared.context.generation : at.generation, admitted };
  });
  return {
    harness,
    admission,
    plan,
    ranWith,
    replayed,
    resolved: () => resolveCount,
    prepared: () => prepareCount,
    runs: () => {
      if (nativeRuns === null) throw new Error('The harness has not mounted its runs.');
      return nativeRuns;
    },
    crossBoundary,
    dispose: () => harness.dispose(),
  } satisfies ScriptedWorld;
});

function runRhythms(rhythm: ScriptedRhythm): ThreadRhythms {
  return {
    lease: {
      heartbeatIntervalMs: rhythm.heartbeatIntervalMs,
      staleRunningAfterMs: rhythm.staleRunningAfterMs,
      takeoverAfterMs: rhythm.takeoverAfterMs,
    },
    reaper: {
      staleSweepIntervalMs: rhythm.staleSweepIntervalMs,
      recoveryBatch: rhythm.recoveryBatch,
      resumeWithinMs: rhythm.resumeWithinMs,
      resumeAttemptLimit: rhythm.resumeAttemptLimit,
    },
    settlement: {
      settledClaimAfterMs: rhythm.settledClaimAfterMs,
      settledHeartbeatIntervalMs: rhythm.settledHeartbeatIntervalMs,
      settledNotificationBatch: rhythm.settledNotificationBatch,
      settledNotifyAttemptLimit: rhythm.settledNotifyAttemptLimit,
    },
    streamFlushIntervalMs: rhythm.streamFlushIntervalMs,
  };
}

export const openedRun = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx, R = never>(
  open: ThreadStorageFactory<TTx, TWrite, R>,
  options: ScriptedWorldOptions = {},
) {
  const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE, transport: options.transport });
  const world = yield* scriptedWorld(storage, thread.agentId, options);
  return { storage, world, thread };
});

export type StartedTurn = {
  readonly world: ScriptedWorld;
  readonly threadId: string;
  readonly runId: string;
  readonly entry: ThreadTranscriptEntry;
};

export const pump = Effect.fnUntraced(function* (turn: StartedTurn) {
  const { world, threadId, runId } = turn;
  const over = (state: ThreadState) =>
    (state.activeRun !== null && state.activeRun.id === runId && state.status.life === 'awaiting') ||
    (state.latestRun !== null &&
      state.latestRun.id === runId &&
      state.latestRun.status !== 'running' &&
      state.latestRun.settledNotifiedAt !== null) ||
    (state.latestRun !== null && state.latestRun.id !== runId);
  yield* Effect.scoped(
    Effect.gen(function* () {
      const finished = yield* Deferred.make<void>();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          world.harness.reads.subscribe(threadId, (event: ThreadLiveEvent<ThreadSnapshot>) => {
            if (event.type === 'state' && over(event.frame.state)) Deferred.doneUnsafe(finished, Effect.void);
          }),
        ),
        (detach) => Effect.sync(detach),
      );
      const snapshot = yield* world.harness.reads.snapshot(threadId);
      if (!over(snapshot)) yield* Deferred.await(finished);
    }),
  );
});

export const startedTurn = Effect.fnUntraced(function* (world: ScriptedWorld, threadId: string, text: string) {
  const said = yield* world.harness.threads.handle(threadId, OWNER).send(text);
  if (said.status !== 'started')
    return yield* new ThreadCallBroke({
      cause: new Error(`The words waited behind run ${said.runId} instead of opening a turn.`),
    });
  return { world, threadId, runId: said.runId, entry: said.entry } satisfies StartedTurn;
});

export const queuedTurn = Effect.fnUntraced(function* (
  handle: ThreadHandle<ThreadSnapshot>,
  text: string,
  attachments?: readonly ThreadAttachmentRef[],
) {
  const said = yield* handle.queue(text, attachments);
  if (said.status !== 'queued')
    return yield* new ThreadCallBroke({
      cause: new Error('The words opened a turn instead of waiting for the run that is going.'),
    });
  return { runId: said.runId, id: said.queued.id, queued: said.queued };
});

export const steeredWords = Effect.fnUntraced(function* (
  handle: ThreadHandle<ThreadSnapshot>,
  text: string,
  attachments?: readonly ThreadAttachmentRef[],
) {
  const said = yield* handle.send(text, attachments);
  if (said.status !== 'steered')
    return yield* new ThreadCallBroke({
      cause: new Error(`The words answered ${said.status} instead of going into the run.`),
    });
  return { runId: said.runId };
});

export function inertAttachments<TTx, TWrite extends TTx = TTx>(): ThreadAttachmentStorage<TWrite> {
  return {
    keep: (_threadId, image) => Effect.succeed({ id: 'kept', mediaType: image.mediaType, url: 'test://kept' }),
    resolve: (_threadId, _ownerId, refs) =>
      Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
    addressed: (_threadId, refs) =>
      Effect.succeed(refs.map((ref) => ({ id: ref.id, mediaType: 'image/png' as const, url: `test://${ref.id}` }))),
    hydrate: (_threadId, messages) => Effect.succeed([...messages]),
    sizes: () => Effect.succeed(new Map()),
  };
}

export function inertToolOutputs<TTx, TWrite extends TTx = TTx>(disposed?: () => void): ThreadToolOutputStorage<TWrite> {
  return {
    scope: () => ({
      tools: {},
      project: ({ output, modelOutput }) => Effect.succeed({ output, modelOutput }),
      projectMessages: (messages) => Effect.succeed(messages),
      retainInterrupted: ({ text, complete }) => Effect.succeed({ kind: 'text' as const, text, complete }),
      retainOpen: ({ text }) => Effect.succeed({ input: { kind: 'text' as const, text, complete: false }, chars: text.length }),
      commitReferenced: () => Effect.void,
      dispose: () => Effect.sync(() => disposed?.()),
    }),
    settleOpen: () => Effect.void,
  };
}

export function inertResources<TTx, TWrite extends TTx = TTx>(): ResourcesConfig<TTx> {
  const rows: ThreadResourceRow[] = [];
  const ledger: ThreadResourceStorage<TTx, TWrite> = {
    hold: Effect.fnUntraced(function* (values) {
      const row = { ...values, heldAt: new Date(yield* Clock.currentTimeMillis) };
      rows.push(row);
      return row;
    }),
    release: (kind, ids) =>
      Effect.sync(() => {
        const before = rows.length;
        rows.splice(0, rows.length, ...rows.filter((row) => row.kind !== kind || !ids.includes(row.id)));
        return before - rows.length;
      }),
    held: (threadIds) => Effect.sync(() => rows.filter((row) => row.threadId !== null && threadIds.includes(row.threadId))),
    detached: () => Effect.sync(() => rows.filter((row) => row.threadId === null)),
  };
  return { storage: ledger as ThreadResourceStorage<unknown>, kinds: [] };
}

export const neverModels: CompactionModels = {
  request() {
    throw new Error('The scripted run calls no model.');
  },
  served() {
    return Effect.die(new Error('The scripted run calls no model.'));
  },
  defaultModel() {
    throw new Error('The scripted run calls no model.');
  },
};
