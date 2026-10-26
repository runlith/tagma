import { Context, type Effect } from 'effect';
import type { Raised } from '@runlith/agent/permissions';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { ProjectRoot } from '../../../workspace/contract/wire/coverage.js';
import type { RootBinding } from '../../../workspace/contract/wire/roots.js';
import type { RootUse } from '../../../workspace/contract/wire/uses.js';
import type { FinishFailure, WorktreeFinishRefused, WorktreeUnavailable } from '../wire/failures.js';
import type { WorktreeIntent } from '../wire/creation.js';
import type { WorktreeRecord } from './worktrees.js';

export type LiveThread = {
  readonly threadId: string;
  readonly rootId: string | null;
  readonly cleared: boolean;
  readonly live: boolean;
  readonly state: 'working' | 'waiting' | 'finished' | 'idle';
};

export type PlacedThread = {
  readonly threadId: string;
  readonly parentThreadId: string | null;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
};

export type PlacedThreadIssue = { readonly message: string };

export type FinishingThreads = {
  readonly live: (projectId: number) => Effect.Effect<readonly LiveThread[], WorktreeUnavailable>;
  readonly placedIn: (projectId: number, rootId: RootId) => Effect.Effect<readonly PlacedThread[], WorktreeUnavailable>;
  readonly archive: (projectId: number, threadId: string, archived: boolean) => Effect.Effect<void, PlacedThreadIssue>;
  readonly stop: (projectId: number, threadId: string) => Effect.Effect<void, PlacedThreadIssue>;
  readonly place: (threadId: string, root: RootBinding) => Effect.Effect<void, PlacedThreadIssue>;
};

export type ThreadPlacing = {
  readonly threadId: string;
  readonly movedAt: Date;
  readonly rootId: string | null;
  readonly cleared: boolean;
  readonly state: 'working' | 'waiting' | 'finished' | 'idle';
};

export type ThreadsMoved = (projectId: number, listener: (threadId: string | null) => void) => () => void;

export type WorktreeThreadPort = FinishingThreads & {
  readonly standingRoot: (threadId: string) => Effect.Effect<string | null, PlacedThreadIssue>;
  readonly placing: (projectId: number, threadIds?: readonly string[]) => Effect.Effect<readonly ThreadPlacing[], StoreFailure>;
  readonly threadsMoved: ThreadsMoved;
  readonly stopping: (stop: ThreadStop) => () => void;
};

export type ThreadStop = (projectId: number, threadId: string) => Effect.Effect<void, PlacedThreadIssue>;

export class WorktreeThreads extends Context.Service<WorktreeThreads, WorktreeThreadPort>()('tagma/worktrees/WorktreeThreads') {}

export class UnbornReleasing extends Context.Service<UnbornReleasing, { readonly release: (rootId: RootId) => void }>()(
  'tagma/worktrees/UnbornReleasing',
) {}

export const HEADS = 'refs/heads/';

export const UNCOMMITTED = ['staged', 'unstaged', 'untracked', 'unmerged'] as const;

export type FinishingGuards = {
  readonly recorded: (projectId: number, rootId: RootId) => Effect.Effect<WorktreeRecord, FinishFailure>;
  readonly present: (path: string) => Effect.Effect<boolean, WorktreeUnavailable>;
  readonly stands: (record: WorktreeRecord) => Effect.Effect<void, FinishFailure>;
  readonly branchOf: (record: WorktreeRecord) => Effect.Effect<string, WorktreeFinishRefused>;
  readonly baseOf: (record: WorktreeRecord) => Effect.Effect<string, WorktreeFinishRefused>;
  readonly working: (projectId: number, rootId: RootId, asking: string | null) => Effect.Effect<readonly LiveThread[], FinishFailure>;
  readonly retiring: (projectId: number, rootId: RootId, asking: string | null) => Effect.Effect<readonly Raised[], FinishFailure>;
  readonly quiet: (projectId: number, rootId: RootId) => Effect.Effect<void, FinishFailure>;
  readonly holders: (rootId: RootId) => Effect.Effect<readonly RootUse[], FinishFailure>;
  readonly baseCheckout: (
    projectId: number,
    baseBranch: string,
    except: RootId,
  ) => Effect.Effect<{ readonly root: ProjectRoot }, FinishFailure>;
  readonly placeOf: (
    projectId: number,
    rootId: RootId,
    withBase: boolean,
  ) => Effect.Effect<{ readonly folder: string; readonly base: string | null }, FinishFailure>;
  readonly operationOf: (record: WorktreeRecord) => Effect.Effect<WorktreeIntent, WorktreeUnavailable>;
  readonly commonOf: (record: WorktreeRecord) => Effect.Effect<string, FinishFailure>;
};
