import { Approvers, OPERATOR_ONLY, type ApproversPort } from './Approvers';
import { Data, Context, Effect, Layer } from 'effect';
import type { ThreadBornOf } from '../protocol/birth';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { AgentRecovery } from '../agent/AgentRecovery';
import type { CallRecord } from '../agent/callProgress';
import type { AgentRuleRegistry } from '../agent/policy/AgentRuntimePolicy';
import type { ThreadView } from './agents/ThreadAgent';
import type { ThreadInterruptedInput } from '../transcript/entries';
import type { ThreadLiveProgress, ThreadLiveView, ThreadOpenText, ThreadOpenView } from '../transcript/live';
import type { ThreadTranscriptEntry } from '../transcript/rows';
import type { ToolCatalog } from '../agent/ToolCatalog';
import { makeToolSourceRegistry, type ToolSourceRegistry } from '../catalog/toolSources';
import { mintThreadOwnerId } from './identity';
import type { AgentPictureKeeper } from '../agent/ToolOutput';
import type { ThreadState, ThreadStateFrame } from './state';
import type { ThreadAggregateStorage } from './storage/aggregate';
import type { ThreadCacheObservationStorage } from './storage/cacheObservations';
import type { ThreadEventLogStorage } from './storage/eventLog';
import type { ThreadInboxStorage } from './storage/inbox';
import type { ThreadOwnerSettingsStorage } from './storage/ownerSettings';
import type { ThreadRunStorage } from './storage/runs';
import type { ThreadTransitionStorage } from './transition/port';
import type {
  ThreadBirthCarried,
  ThreadBirthPlace,
  ThreadHostBinding,
  ThreadCompactionCheckpointRow,
  ThreadHistory,
  ThreadMetadataRow,
  ThreadRow,
  ThreadRunRow,
} from './rows';
import type { ThreadCheckpointWrite, ThreadCompactionStorage } from './storage/compaction';
import type { ThreadAttachmentStorage } from './attachmentStorage';
import {
  ThreadCallBroke,
  type ThreadBorderFailed,
  type ThreadPortFailure,
  type ThreadPortRefusal,
  isPortRefusal,
  threadBorderOut,
} from './ThreadBorder';
import { ThreadStorageFailed } from './persisted';
import type { ThreadForkCut } from './record';
import type { ThreadResourceSummary } from './storage/resources';
import type { ThreadToolOutputContext, ThreadToolOutputScope, ThreadToolOutputStorage } from './toolOutputs';

export type ThreadTx = unknown;

declare const THREAD_WRITE_TX: unique symbol;
export type ThreadWriteTx = {
  readonly [THREAD_WRITE_TX]: 'a write unit the adapter minted';
  afterCommit(effect: Effect.Effect<void>): Effect.Effect<void>;
};

export class ThreadStore extends Context.Service<ThreadStore, ThreadAggregateStorage<ThreadTx, ThreadWriteTx>>()(
  '@runlith/agent/ThreadStore',
) {}

export class ThreadTransitions extends Context.Service<ThreadTransitions, ThreadTransitionStorage<ThreadTx, ThreadWriteTx>>()(
  '@runlith/agent/ThreadTransitions',
) {}

export type ThreadEventJournalPort = ThreadEventLogStorage<ThreadTx, ThreadWriteTx>;

export class ThreadEventJournal extends Context.Service<ThreadEventJournal, ThreadEventJournalPort>()(
  '@runlith/agent/ThreadEventJournal',
) {}

export class ThreadAttachments extends Context.Service<ThreadAttachments, ThreadAttachmentStorage<ThreadTx>>()(
  '@runlith/agent/ThreadAttachments',
) {}

export class ThreadInbox extends Context.Service<ThreadInbox, ThreadInboxStorage<ThreadTx, ThreadWriteTx>>()(
  '@runlith/agent/ThreadInbox',
) {}

export class ThreadCacheObservations extends Context.Service<
  ThreadCacheObservations,
  ThreadCacheObservationStorage<ThreadTx, ThreadWriteTx>
>()('@runlith/agent/ThreadCacheObservations') {}

export type ThreadToolOutputScopeFaces<TWrite = ThreadWriteTx> = ThreadToolOutputScope<TWrite> & {
  readonly keepPicture?: AgentPictureKeeper;
};

export type ThreadInputRecovery = (input: {
  readonly threadId: string;
  readonly runId: string;
  readonly recorded: (toolCallIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, ThreadInterruptedInput>, ThreadBorderFailed>;
}) => AgentRecovery;

export type ThreadToolOutputFaces<TWrite = ThreadWriteTx> = Omit<ThreadToolOutputStorage<TWrite>, 'scope'> & {
  scope(input: ThreadToolOutputContext): ThreadToolOutputScopeFaces<TWrite>;
};

export class ThreadToolOutputVault extends Context.Service<ThreadToolOutputVault, ThreadToolOutputFaces>()(
  '@runlith/agent/ThreadToolOutputVault',
) {}

export class ThreadOwnerSettings extends Context.Service<ThreadOwnerSettings, ThreadOwnerSettingsStorage>()(
  '@runlith/agent/ThreadOwnerSettings',
) {}

export class ThreadResourceLedger extends Context.Service<
  ThreadResourceLedger,
  {
    end(threadIds: readonly string[], tx: ThreadWriteTx): Effect.Effect<void, ThreadBorderFailed>;
    letGo(): Effect.Effect<void, ThreadBorderFailed>;
    held(threadId: string): Effect.Effect<readonly ThreadResourceSummary[], ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadResourceLedger') {}

export const emptyThreadResourceLedgerLayer: Layer.Layer<ThreadResourceLedger> = Layer.succeed(ThreadResourceLedger, {
  end: () => Effect.void,
  letGo: () => Effect.void,
  held: () => Effect.succeed([]),
});

export class ModelRuns extends Context.Service<
  ModelRuns,
  {
    admit(runId: string): void;
    release(runId: string): Effect.Effect<void>;
  }
>()('@runlith/agent/ModelRuns') {}

export class ThreadRunStoreFactory extends Context.Service<
  ThreadRunStoreFactory,
  { create(ownerId: string): ThreadRunStorage<ThreadTx, ThreadWriteTx> }
>()('@runlith/agent/ThreadRunStoreFactory') {}

export type ThreadToolSource = {
  readonly id: string;
  readonly tools: ToolCatalog;
  readonly prompt?: string;
  readonly declined?: readonly string[];
};

export type ThreadToolSourceTarget = {
  readonly thread: ThreadRow;
  readonly run?: ThreadRunRow;
};

export type ThreadToolSourceRequest = ThreadToolSourceTarget & {
  readonly context: unknown;
};

export type ThreadToolSourceRegistry = ToolSourceRegistry<ThreadToolSourceRequest, ThreadToolSource, ThreadBorderFailed>;

export class ThreadToolRegistry extends Context.Service<ThreadToolRegistry, ThreadToolSourceRegistry>()(
  '@runlith/agent/ThreadToolRegistry',
) {}

export function threadToolSources(): ThreadToolSourceRegistry {
  return makeToolSourceRegistry<ThreadToolSourceRequest, ThreadToolSource, ThreadBorderFailed>({
    declined: (id, declined) => ({ id, tools: {}, declined }),
    stamped: (source, standing, removed) => {
      const contributor = { id: source.id, standing, removed };
      return { ...source, tools: Object.fromEntries(Object.entries(source.tools).map(([name, tool]) => [name, { ...tool, contributor }])) };
    },
  });
}

export type ThreadBudgetQuery = {
  readonly spawnRootId: string;
  readonly principal: string;
  readonly root?: ThreadMetadataRow;
};

export function budgetQueryOf(thread: ThreadMetadataRow): ThreadBudgetQuery {
  return { spawnRootId: thread.spawnRootId, principal: thread.ownerId, root: thread.spawnRootId === thread.id ? thread : undefined };
}

export const THREAD_BUDGET_UNMEASURED_SAMPLE = 8;

export type ThreadBudgetReading = {
  readonly allowed: number | null;
  readonly spent: number;
  readonly remaining: number | null;
  readonly unmeasuredCount: number;
  readonly unmeasuredSample: readonly string[];
};

export class ThreadBudgetSpentError extends Data.TaggedError('ThreadBudgetSpent')<{ readonly message: string; readonly allowed: number }> {
  constructor(allowed: number) {
    super({ message: `This agent tree has spent its budget of ${allowed} tokens; no further turn opens under it.`, allowed });
    this.name = 'ThreadBudgetSpentError';
  }
}

export class ThreadBudget extends Context.Service<
  ThreadBudget,
  {
    of(query: ThreadBudgetQuery): Effect.Effect<ThreadBudgetReading, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadBudget') {}

export const unboundedThreadBudgetLayer: Layer.Layer<ThreadBudget> = Layer.succeed(ThreadBudget, {
  of: () => Effect.succeed({ allowed: null, spent: 0, remaining: null, unmeasuredCount: 0, unmeasuredSample: [] }),
});

export class ThreadResidency extends Context.Service<
  ThreadResidency,
  {
    admit(thread: ThreadMetadataRow): Effect.Effect<void, ThreadBorderFailed>;
    release(threadId: string): Effect.Effect<void>;
    bind(threadId: string, runId: string): Effect.Effect<void>;
    ended(runId: string): Effect.Effect<void>;
  }
>()('@runlith/agent/ThreadResidency') {}

export const unboundedThreadResidencyLayer: Layer.Layer<ThreadResidency> = Layer.succeed(ThreadResidency, {
  admit: () => Effect.void,
  release: () => Effect.void,
  bind: () => Effect.void,
  ended: () => Effect.void,
});

export class ThreadRunRules extends Context.Service<ThreadRunRules, AgentRuleRegistry<unknown, ThreadView>>()(
  '@runlith/agent/ThreadRunRules',
) {}

export type ThreadWorkflowMember = {
  readonly threadId: string;
};

export class ThreadWorkflowMembers extends Context.Service<
  ThreadWorkflowMembers,
  {
    startMember(input: {
      readonly parent: ThreadRow;
      readonly requestId: string;
      readonly bornOf: ThreadBornOf;
      readonly agentId: string;
      readonly task: string;
      readonly name: string;
    }): Effect.Effect<ThreadWorkflowMember, ThreadBorderFailed>;
    waitForReports(input: {
      readonly thread: ThreadRow;
      readonly members: readonly string[];
      readonly deadlineMs: number;
    }): Effect.Effect<ReadonlyMap<string, string>, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadWorkflowMembers') {}

export const emptyThreadWorkflowMembersLayer: Layer.Layer<ThreadWorkflowMembers> = Layer.succeed(ThreadWorkflowMembers, {
  startMember: () =>
    Effect.fail(
      new ThreadCallBroke({
        cause: new Error('This host declared no collaboration, so a workflow step can start no agent.'),
      }),
    ),
  waitForReports: () => Effect.succeed(new Map()),
});

export type ThreadRunLeaseRhythm = {
  readonly heartbeatIntervalMs: number;
  readonly staleRunningAfterMs: number;
  readonly takeoverAfterMs: number;
};

export type ThreadRunReaperRhythm = {
  readonly staleSweepIntervalMs: number;
  readonly recoveryBatch: number;
  readonly resumeWithinMs: number;
  readonly resumeAttemptLimit: number;
};

export type ThreadSettlementOutboxRhythm = {
  readonly settledClaimAfterMs: number;
  readonly settledHeartbeatIntervalMs: number;
  readonly settledNotificationBatch: number;
  readonly settledNotifyAttemptLimit: number;
};

export type ThreadRhythms = {
  readonly lease: ThreadRunLeaseRhythm;
  readonly reaper: ThreadRunReaperRhythm;
  readonly settlement: ThreadSettlementOutboxRhythm;
  readonly streamFlushIntervalMs: number;
};

export class ThreadLeaseRhythm extends Context.Service<ThreadLeaseRhythm, ThreadRunLeaseRhythm>()('@runlith/agent/ThreadLeaseRhythm') {}

export class ThreadReaperRhythm extends Context.Service<ThreadReaperRhythm, ThreadRunReaperRhythm>()('@runlith/agent/ThreadReaperRhythm') {}

export class ThreadSettlementRhythm extends Context.Service<ThreadSettlementRhythm, ThreadSettlementOutboxRhythm>()(
  '@runlith/agent/ThreadSettlementRhythm',
) {}

export class ThreadStreamRhythm extends Context.Service<ThreadStreamRhythm, { readonly flushIntervalMs: number }>()(
  '@runlith/agent/ThreadStreamRhythm',
) {}

export class ThreadOwner extends Context.Service<ThreadOwner, { readonly id: string }>()('@runlith/agent/ThreadOwner') {}

export class ThreadInputRecoveries extends Context.Service<ThreadInputRecoveries, { readonly of: ThreadInputRecovery } | null>()(
  '@runlith/agent/ThreadInputRecoveries',
) {}

export type ThreadBirth = {
  readonly child: ThreadRow;
  readonly parent: ThreadRow;
  readonly creator?: ThreadRow;
  readonly carried: ThreadBirthCarried;
  readonly cut?: ThreadForkCut;
  readonly title?: string;
  readonly typeId?: string;
  readonly host?: ThreadHostBinding;
  readonly place?: ThreadBirthPlace;
};

export class ThreadBirthRecords extends Context.Service<
  ThreadBirthRecords,
  { record(birth: ThreadBirth, tx: ThreadWriteTx): Effect.Effect<void, ThreadBorderFailed> } | null
>()('@runlith/agent/ThreadBirthRecords') {}

export class ThreadOwedCalls extends Context.Service<
  ThreadOwedCalls,
  { owe(call: CallRecord, tx: ThreadWriteTx): Effect.Effect<void, ThreadBorderFailed> } | null
>()('@runlith/agent/ThreadOwedCalls') {}

export class ThreadOwnWork extends Context.Service<
  ThreadOwnWork,
  {
    owed(threadId: string): Effect.Effect<boolean, ThreadBorderFailed>;
    readonly endings: ReadonlySet<string>;
  } | null
>()('@runlith/agent/ThreadOwnWork') {}

export class ThreadReadiness extends Context.Service<
  ThreadReadiness,
  { ready(thread: ThreadRow): Effect.Effect<void, ThreadBorderFailed> } | null
>()('@runlith/agent/ThreadReadiness') {}

type ThreadRestingPort<TTx> = {
  resting(threadId: string, tx?: TTx): Effect.Effect<boolean, ThreadBorderFailed>;
};

export class ThreadResting extends Context.Service<ThreadResting, ThreadRestingPort<ThreadTx> | null>()('@runlith/agent/ThreadResting') {}

export class ThreadResidence extends Context.Service<
  ThreadResidence,
  {
    holding<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadBorderFailed, R>;
    reading<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | ThreadBorderFailed, R>;
  } | null
>()('@runlith/agent/ThreadResidence') {}

export class ThreadModelMoves extends Context.Service<
  ThreadModelMoves,
  { moved(thread: ThreadRow): Effect.Effect<void, ThreadBorderFailed> } | null
>()('@runlith/agent/ThreadModelMoves') {}

export class StandingSwitches extends Context.Service<
  StandingSwitches,
  {
    of(input: {
      readonly ownerId: string;
      readonly provider: string;
      readonly model: string;
    }): Effect.Effect<ModelSwitches, ThreadBorderFailed>;
  } | null
>()('@runlith/agent/StandingSwitches') {}

export class RunSweep extends Context.Service<
  RunSweep,
  { sweep(threadId: string, runId: string): Effect.Effect<void, ThreadBorderFailed> } | null
>()('@runlith/agent/RunSweep') {}

export type ThreadHostPorts =
  | RunSweep
  | ThreadLeaseRhythm
  | ThreadReaperRhythm
  | ThreadSettlementRhythm
  | ThreadStreamRhythm
  | ThreadOwner
  | ThreadInputRecoveries
  | ThreadBirthRecords
  | ThreadOwedCalls
  | ThreadOwnWork
  | ThreadReadiness
  | ThreadResting
  | ThreadResidence
  | ThreadModelMoves
  | StandingSwitches;

export type ThreadHost<TWrite = ThreadWriteTx, TTx = ThreadTx> = {
  readonly rhythms: ThreadRhythms;
  readonly ownerId?: string;
  readonly approvers?: ApproversPort;
  readonly inputRecovery?: ThreadInputRecovery;
  readonly births?: { record(birth: ThreadBirth, tx: TWrite): Effect.Effect<void, ThreadBorderFailed> };
  readonly owedCalls?: { owe(call: CallRecord, tx: TWrite): Effect.Effect<void, ThreadBorderFailed> };
  readonly ownWork?: NonNullable<Context.Service.Shape<typeof ThreadOwnWork>>;
  readonly readiness?: NonNullable<Context.Service.Shape<typeof ThreadReadiness>>;
  readonly resting?: ThreadRestingPort<TTx>;
  readonly residence?: NonNullable<Context.Service.Shape<typeof ThreadResidence>>;
  readonly modelMoves?: NonNullable<Context.Service.Shape<typeof ThreadModelMoves>>;
  readonly standingSwitches?: NonNullable<Context.Service.Shape<typeof StandingSwitches>>;
  readonly sweep?: NonNullable<Context.Service.Shape<typeof RunSweep>>;
};

export function threadHostLayer<TWrite = ThreadWriteTx, TTx = ThreadTx>(given: ThreadHost<TWrite, TTx>): Layer.Layer<ThreadHostPorts> {
  const host = given as unknown as ThreadHost;
  return Layer.mergeAll(
    Layer.succeed(ThreadLeaseRhythm, host.rhythms.lease),
    Layer.succeed(ThreadReaperRhythm, host.rhythms.reaper),
    Layer.succeed(ThreadSettlementRhythm, host.rhythms.settlement),
    Layer.succeed(ThreadStreamRhythm, { flushIntervalMs: host.rhythms.streamFlushIntervalMs }),
    Layer.sync(ThreadOwner, () => ({ id: host.ownerId ?? mintThreadOwnerId() })),
    Layer.succeed(Approvers, host.approvers ?? OPERATOR_ONLY),
    Layer.succeed(ThreadInputRecoveries, host.inputRecovery ? { of: host.inputRecovery } : null),
    Layer.succeed(ThreadBirthRecords, host.births ?? null),
    Layer.succeed(ThreadOwedCalls, host.owedCalls ?? null),
    Layer.succeed(ThreadOwnWork, host.ownWork ?? null),
    Layer.succeed(ThreadReadiness, host.readiness ?? null),
    Layer.succeed(ThreadResting, host.resting ?? null),
    Layer.succeed(ThreadResidence, host.residence ?? null),
    Layer.succeed(ThreadModelMoves, host.modelMoves ?? null),
    Layer.succeed(StandingSwitches, host.standingSwitches ?? null),
    Layer.succeed(RunSweep, host.sweep ?? null),
  );
}

export class ThreadFeed extends Context.Service<
  ThreadFeed,
  {
    atCut<A, E, R>(threadId: string, work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
    tail(threadId: string, runId: string, entries: readonly ThreadTranscriptEntry[], landed: readonly string[]): void;
    append(threadId: string, runId: string, id: string, text: string): void;
    progress(threadId: string, runId: string, progress: ThreadLiveProgress): void;
    view(threadId: string): ThreadOpenView;
    liveView(threadId: string): ThreadLiveView;
    text(threadId: string, id: string, from: number, limit: number): ThreadOpenText | null;
    publish(frame: ThreadStateFrame<ThreadState>, tx: ThreadTx, published: () => void): Effect.Effect<void, ThreadBorderFailed>;
    carry(frame: ThreadStateFrame<ThreadState>, published: () => void): Effect.Effect<boolean, ThreadBorderFailed>;
  }
>()('@runlith/agent/ThreadFeed') {}
