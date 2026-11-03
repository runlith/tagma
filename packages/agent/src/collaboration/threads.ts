import { Context, Data, type Effect, type Scope } from 'effect';
import type { Cursor, PageQuestion, PageKey, PageDirection } from '@runlith/paging';
import type { ModelSwitches } from '@runlith/llm/models/description';
import type { ThreadBindings } from '../agent/contracts';
import type { ThreadBornOf } from '../protocol/birth';
import { actDigest, callKey, type Keyed, type KeyedSpent } from '../thread/keyed';
import type {
  CurrentRun,
  ThreadForkCut,
  ThreadModelSelection,
  ThreadReadFailure,
  ThreadRecord,
  TransportCapabilities,
} from '../thread/record';
import type { ThreadAuthority, ThreadBirthPlace, ThreadContextReading, ThreadHostBinding, ThreadRunStatus } from '../thread/rows';
import type { ThreadMissing } from '../thread/ThreadBorder';
import type { ThreadStorageFailed } from '../thread/persisted';
import type { ReportDelivery, ThreadInboxItemValues } from '../thread/storage/inbox';
import type { ThreadFailureDiagnostics } from '../transcript/entries';
import type { ThreadTypeOffer } from './types';
import type { SpawnSubscription } from './ThreadPlaneAccess';

export type ThreadDirectoryRow = {
  readonly threadId: string;
  readonly projectId: number | null;
  readonly agentId: string;
  readonly typeId: string;
  readonly name: string | null;
  readonly spawnRootId: string;
  readonly parentThreadId: string | null;
  readonly spawnedByRunId: string | null;
  readonly movedAt: Date;
  readonly selection: (ThreadModelSelection & { readonly account: string | null }) | null;
  readonly provider: string | null;
  readonly capabilities: TransportCapabilities;
  readonly contextReading: ThreadContextReading | null;
  readonly run: CurrentRun | null;
  readonly assignment: ThreadRunStatus | null;
  readonly failureReason: string | null;
  readonly failure: ThreadFailureDiagnostics | null;
};

export const THREAD_LIST: PageQuestion = { operation: 'threads.list', selection: {}, order: 1 };
export const THREAD_LIST_ORDER: readonly PageDirection[] = ['asc', 'desc', 'desc'];
const LIFE_ORDER = { working: 0, awaiting: 1, idle: 2 } as const;
export const IDLE_RANK = LIFE_ORDER.idle;
export const threadListKey = (life: 'working' | 'awaiting' | 'idle', movedAt: Date, threadId: string): PageKey => [
  LIFE_ORDER[life],
  movedAt.getTime(),
  threadId,
];

export type ThreadListQuery = {
  readonly principal: string;
  readonly from: string;
  readonly ids?: readonly string[];
  readonly parent?: string;
  readonly limit: number;
  readonly cursor?: Cursor;
};

export type BirthRequest = {
  readonly key: string;
  readonly task: string;
  readonly typeId: string;
  readonly name: string | null;
  readonly root?: true;
  readonly title?: string;
  readonly project?: number;
  readonly host: ThreadHostBinding | null;
  readonly bindings?: ThreadBindings;
  readonly seed: { readonly fresh: true } | { readonly fork: ThreadForkCut; readonly source: string };
  readonly model: Partial<ThreadModelSelection> | null;
  readonly switches?: ModelSwitches;
  readonly plain?: boolean;
  readonly subscribe?: SpawnSubscription;
  readonly reportDelivery?: ReportDelivery;
};

export function birthKeyed(parentThreadId: string, request: BirthRequest): Keyed {
  const { key, ...asked } = request;
  return { evidence: { envelope: callKey({ operation: 'spawn', actor: parentThreadId, key }) }, digest: actDigest(asked) };
}

export type BirthInput = {
  readonly request: BirthRequest;
  readonly deadline: Date;
  readonly childId: string;
  readonly creatorThreadId: string;
  readonly principal: string;
  readonly offer: ThreadTypeOffer;
  readonly authority: ThreadAuthority;
  readonly place: ThreadBirthPlace | null;
  readonly model:
    | { readonly judged: ThreadModelSelection; readonly switches: ModelSwitches }
    | { readonly asked: Partial<ThreadModelSelection> }
    | null;
  readonly bornOf: ThreadBornOf | null;
  readonly spawnedByRunId: string | null;
  readonly plain: boolean;
  readonly provision: Extract<ThreadInboxItemValues, { kind: 'task' }>;
};

export class BirthRefused extends Data.TaggedError('BirthRefused')<{
  readonly childId: string;
  readonly reason:
    | 'host-unadmitted'
    | 'host-with-fork'
    | 'pending-interaction'
    | 'harness-contract'
    | 'harness-host'
    | 'model-unnamed'
    | 'model-unavailable'
    | 'thread-project-missing'
    | 'harness-refused';
  readonly detail?: string;
}> {
  override get message(): string {
    return this.detail === undefined ? `Birth of ${this.childId} refused: ${this.reason}.` : `${this.reason}: ${this.detail}`;
  }
}

export class BirthConflict extends Data.TaggedError('BirthConflict')<{
  readonly childId: string | null;
  readonly key: string;
  readonly reason: 'name-taken' | 'spawn-conflict' | 'birth-id-taken' | 'run-conflict';
}> {
  override get message(): string {
    return `Birth of ${this.childId ?? 'a child'} under request ${this.key} conflicts: ${this.reason}.`;
  }
}

export class BirthUnavailable extends Data.TaggedError('BirthUnavailable')<{
  readonly childId: string;
  readonly reason: 'deadline';
}> {}

export class BirthLost extends Data.TaggedError('BirthLost')<{
  readonly childId: string;
  readonly key: string;
}> {}

export type BirthFailure = ThreadMissing | BirthRefused | BirthConflict | BirthUnavailable | BirthLost | ThreadStorageFailed;

export class Threads extends Context.Service<
  Threads,
  {
    find(threadId: string, principal: string): Effect.Effect<ThreadRecord | null, ThreadReadFailure>;
    named(principal: string, spawnRootId: string, name: string): Effect.Effect<ThreadRecord | null, ThreadReadFailure>;
    lineage(
      threadId: string,
      principal: string,
    ): Effect.Effect<{ readonly ancestors: readonly ThreadRecord[]; readonly complete: boolean }, ThreadReadFailure>;
    list(
      query: ThreadListQuery,
    ): Effect.Effect<
      { readonly rows: readonly ThreadDirectoryRow[]; readonly total: number; readonly cursor: Cursor | null },
      ThreadReadFailure
    >;
    watch(
      threadIds: readonly string[],
      kinds?: readonly ('record' | 'run' | 'inbox')[],
    ): Effect.Effect<Effect.Effect<readonly string[]>, never, Scope.Scope>;
    readBirth(
      creatorThreadId: string,
      principal: string,
      request: BirthRequest,
    ): Effect.Effect<
      { readonly status: 'born'; readonly thread: ThreadRecord; readonly itemId?: string } | KeyedSpent | { readonly status: 'unborn' },
      ThreadReadFailure | BirthConflict
    >;
    create(
      input: BirthInput,
    ): Effect.Effect<{ readonly status: 'created'; readonly thread: ThreadRecord; readonly acted: boolean } | KeyedSpent, BirthFailure>;
  }
>()('@runlith/agent/Threads') {}
