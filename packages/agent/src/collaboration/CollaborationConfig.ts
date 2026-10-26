import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { Context, type Effect } from 'effect';
import type { WakingThreadEvent } from '../agent/contracts';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { ThreadCacheWarmth } from '../thread/cache/ThreadCacheWarmth';
import type { ThreadLimitSubject, ThreadLimitTable } from '../thread/compaction/limit';
import type { ThreadRecord } from '../thread/record';
import type { ThreadBirthPlace, ThreadContextReading, ThreadHostBinding } from '../thread/rows';
import type { Team } from './team';
import type { ColdWakeRule } from './wakeCost';

export const SUB_AGENT_DEPTH = { minimum: 1, maximum: 5, default: 2 } as const;

export const COLLABORATION_SOURCE = 'collaboration';

export type ThreadDelegation = {
  readonly allowed: boolean;
  readonly setAt: string | null;
};

export type SpawnWorktrees = 'ask' | 'allow';

export const WORKTREE_NEW = 'new';

export const WORKTREE_INHERIT = 'inherit';

export type SpawnHome = { readonly projectId: number; readonly parentProjectId: number; readonly worktrees: SpawnWorktrees };

export type CollaborationPlacement = {
  readonly asking: (thread: ThreadRecord) => Effect.Effect<SpawnWorktrees | null, ThreadBorderFailed>;
  readonly home: (parent: ThreadRecord, project: string | number) => Effect.Effect<SpawnHome, ThreadBorderFailed>;
  readonly resolve: (input: {
    readonly parent: ThreadRecord;
    readonly project?: number;
    readonly worktree: string;
    readonly requestId: string;
    readonly agentId: string;
    readonly asked: boolean;
    readonly name?: string;
    readonly host?: ThreadHostBinding;
  }) => Effect.Effect<ThreadBirthPlace, ThreadBorderFailed>;
  readonly released?: (place: ThreadBirthPlace) => Effect.Effect<void>;
};

export type ThreadWarmthSubject = {
  readonly contextReading: ThreadContextReading;
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
};

export type CollaborationWarmth = (
  resting: readonly ThreadWarmthSubject[],
) => Effect.Effect<readonly (ThreadCacheWarmth | null)[], ThreadBorderFailed>;

export type CollaborationLimits = (threads: readonly ThreadLimitSubject[]) => Effect.Effect<ThreadLimitTable, ThreadBorderFailed>;

export type CollaborationSubscribe = (
  subscriberId: string,
  targetId: string,
  wakes: readonly WakingThreadEvent[] | undefined,
) => Effect.Effect<void, ThreadBorderFailed>;

export type CollaborationConfig = {
  readonly placement?: CollaborationPlacement;
  readonly subscribe?: CollaborationSubscribe;
  readonly warmth?: CollaborationWarmth;
  readonly limits?: CollaborationLimits;
  readonly models: (runId?: string) => ModelCatalog;
  readonly menu?: (runId?: string) => ModelCatalog;
  readonly team?: (thread: ThreadRecord, runId?: string) => Effect.Effect<Team, ThreadBorderFailed>;
  readonly subAgentDepth: (thread: ThreadRecord) => Effect.Effect<number, ThreadBorderFailed>;
  readonly delegation: (thread: ThreadRecord) => Effect.Effect<ThreadDelegation, ThreadBorderFailed>;
  readonly coldWake?: (thread: ThreadRecord) => Effect.Effect<ColdWakeRule, ThreadBorderFailed>;
  readonly reconcileIntervalMs: number;
  readonly spawnSlots?: number;
};

export class DeclaredCollaboration extends Context.Service<DeclaredCollaboration, CollaborationConfig | null>()(
  '@runlith/agent/DeclaredCollaboration',
) {}
