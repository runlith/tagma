import type { Raised } from '../permissions/vocabulary';
import type { SpawnLimit } from './spawnLimits';
import type { Effect } from 'effect';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ToolCaller, WakingThreadEvent } from '../agent/contracts';
import type { ToolEffectSettlement } from '../agent/tool';
import type { ThreadBorderFailed } from '../thread/ThreadBorder';
import type { KeyedSpent } from '../thread/keyed';
import type { ThreadRewindAnswer, ThreadRewindAsk } from '../thread/rewind';
import type { ThreadForkCut, ThreadModelSelection, ThreadReadFailure, ThreadTarget } from '../thread/record';
import type { InboxFailure } from '../thread/storage/inbox';
import type { ContextCompactionFailure } from './compaction';
import type { ThreadModelFailure } from './model';
import type { ThreadRunsFailure } from './runs';
import type { BirthFailure } from './threads';
import type { ThreadTypesFailure } from './types';
import type { ThreadHostBinding } from '../thread/rows';
import type { ThreadCompactionPoint } from '../thread/storage/inbox';
import type { ThreadSpawnType } from '../thread/agents/ThreadTypeCatalog';
import type { ThreadSummarizerReason, ThreadSummarizerSkip } from '../transcript/entries';
import type { ThreadDirectoryAccess } from './ThreadDirectory';
import type {
  ThreadAddressUnknown,
  ThreadCompactRefused,
  ThreadRecipients,
  ThreadSendAsk,
  ThreadSendRefused,
  ThreadSent,
} from './ThreadEnvelopes';
import type { ThreadSpawnDepth } from './ThreadSpawnAccess';
import type { SpawnHome, SpawnWorktrees } from './CollaborationConfig';
import type { Team } from './team';
import type { OwnLineage, Within } from './reach';
import type { CompactAsk, TreeAsk } from './treeActs';
import type { ApprovalAnswered, ApprovalChoice } from '../thread/run/ApprovalAnswers';

export type ThreadSpawnResult = ThreadTarget & {
  readonly status: 'started';
  readonly agentId: string;
  readonly name: string | null;
  readonly model: {
    readonly provider: string;
    readonly model: string;
    readonly reasoning: string | null;
  } | null;
  readonly lowered?: {
    readonly model?: string;
    readonly reasoning?: string;
  };
};

export type ThreadChildSummary = {
  readonly threadId: string;
  readonly agentId: string;
  readonly status: string;
};

export type ThreadChildSummarizer = {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
  readonly account: string | null;
  readonly own: boolean;
  readonly reason: ThreadSummarizerReason;
};

export type ThreadChildSpent = ThreadTarget & KeyedSpent;
export type ThreadChildStopped = ThreadTarget & { readonly status: 'stopped' | 'stopping' | 'not-running' | 'spent' };
export type ThreadChildContinued = ThreadTarget & ({ readonly runId: string } | KeyedSpent);
export type ThreadChildRewound = ThreadTarget & ThreadRewindAnswer;

export type ThreadChildCompacted = ThreadTarget &
  (
    | {
        readonly status: 'completed' | 'unchanged' | 'failed' | 'aborted';
        readonly runId: string;
        readonly history: { readonly before: number; readonly after: number };
        readonly summarizer: ThreadChildSummarizer | null;
        readonly skipped: readonly ThreadSummarizerSkip[];
      }
    | { readonly status: 'requested'; readonly requestId: string; readonly at: ThreadCompactionPoint; readonly runId: string }
    | { readonly status: 'joined'; readonly runId: string }
  );

export type ThreadModelAsk = {
  readonly provider?: string;
  readonly model?: string;
  readonly reasoning?: string | null;
};

export type ThreadChildMoved = ThreadTarget & {
  readonly from: ThreadModelSelection;
  readonly to: ThreadModelSelection;
  readonly runId?: string;
  readonly lowered?: ThreadSpawnResult['lowered'];
};

export type SpawnSubscription = { readonly wakes?: readonly WakingThreadEvent[] };

export type ThreadSpawnAsk = {
  readonly requestId: string;
  readonly step?: number;
  readonly agentId: string;
  readonly task: string;
  readonly name?: string;
  readonly root?: boolean;
  readonly title?: string;
  readonly fork?: ThreadForkCut;
  readonly forkFrom?: string;
  readonly model?: { provider?: string; model?: string; reasoning?: string | null };
  readonly switches?: ModelSwitches;
  readonly host?: ThreadHostBinding;
  readonly project?: string | number;
  readonly worktree?: string;
  readonly asked?: readonly string[];
  readonly plain?: boolean;
  readonly subscribe?: SpawnSubscription;
};

export type ThreadApprovalAnswer = ThreadTarget & { readonly status: ApprovalAnswered };

export type ThreadPlaneApprovals = {
  answer(input: {
    readonly threadId: string;
    readonly questionId: string;
    readonly choice: ApprovalChoice;
  }): Effect.Effect<ThreadApprovalAnswer, ThreadPlaneFailure>;
};

export type ThreadVerbs = {
  readonly worktreeAsking: Effect.Effect<SpawnWorktrees | null, ThreadBorderFailed>;
  spawnLimits(root: boolean): Effect.Effect<readonly SpawnLimit[], ThreadPlaneFailure>;
  spawnHome(project: string | number): Effect.Effect<SpawnHome, ThreadPlaneFailure>;
  crossing(input: { to: string; within: Within }): Effect.Effect<readonly Raised[], ThreadPlaneFailure>;
  spawn(input: ThreadSpawnAsk): Effect.Effect<ThreadSpawnResult, ThreadPlaneFailure>;
  stop(input: TreeAsk): Effect.Effect<ThreadChildStopped, ThreadPlaneFailure>;
  continue(input: TreeAsk): Effect.Effect<ThreadChildContinued, ThreadPlaneFailure>;
  readonly directory: ThreadDirectoryAccess;
  readonly messaging: ThreadPlaneMessaging;
  readonly approvals: ThreadPlaneApprovals;
};

export type ThreadActing = ThreadVerbs & {
  move(input: TreeAsk & { readonly model: ThreadModelAsk }): Effect.Effect<ThreadChildMoved | ThreadChildSpent, ThreadPlaneFailure>;
  compact(input: CompactAsk): Effect.Effect<ThreadChildCompacted | ThreadChildSpent, ThreadPlaneFailure>;
  rewind(input: ThreadRewindAsk & TreeAsk): Effect.Effect<ThreadChildRewound, ThreadPlaneFailure>;
};

export type ThreadPlaneAccess = {
  readonly ownerId: string;
  readonly spawnDepth: ThreadSpawnDepth;
  readonly startable: readonly ThreadSpawnType[];
  readonly models: ModelCatalog;
  readonly menu?: ModelCatalog;
  readonly team?: Team;
  readonly spawnSlots?: number;
  readonly summarizerChoice: boolean;
  readonly worktrees: SpawnWorktrees | null;
  readonly parent: string | null;
  readonly approves?: readonly string[];
  acting(caller: ToolCaller): Effect.Effect<ThreadActing, ThreadPlaneFailure>;
  spawnSettlement(
    caller: ToolCaller,
    requestId: string,
    subscribe: SpawnSubscription | undefined,
  ): Effect.Effect<ToolEffectSettlement<ThreadSpawnResult>, ThreadPlaneFailure>;
};

export type ThreadPlaneFailure =
  | ThreadBorderFailed
  | ThreadReadFailure
  | BirthFailure
  | ThreadRunsFailure
  | ContextCompactionFailure
  | ThreadModelFailure
  | ThreadTypesFailure
  | InboxFailure;

export type ThreadSendAnswer = ThreadSent | ThreadAddressUnknown | ThreadSendRefused | ThreadCompactRefused;

export type ThreadSendCompacting = ThreadSendAsk & { readonly compact?: { readonly keep?: string } };

export type ThreadPlaneMessaging = {
  recipients(to: readonly string[]): Effect.Effect<ThreadRecipients | ThreadAddressUnknown, ThreadPlaneFailure>;
  send(input: ThreadSendCompacting & { readonly asked?: readonly string[] }): Effect.Effect<ThreadSendAnswer, ThreadPlaneFailure>;
  settle(input: ThreadSendCompacting): Effect.Effect<ToolEffectSettlement<ThreadSent>, ThreadPlaneFailure>;
  lineage(to: readonly string[]): Effect.Effect<readonly OwnLineage[], ThreadPlaneFailure>;
  aheadCrossing(to: readonly string[]): Effect.Effect<readonly Raised[], ThreadPlaneFailure>;
};
