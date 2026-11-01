import type { AgentHarness, AgentHarnessOptions, HarnessLaunchGate, ThreadPortFillers } from '@runlith/agent/thread/AgentHarness';
import type { ThreadStorageHost } from '@runlith/agent/thread/kernelPorts';
import type { ThreadBirth, ThreadHost, ThreadInputRecovery } from '@runlith/agent/thread/ThreadPorts';
import type { ThreadCompaction } from '@runlith/agent/thread/compaction/ThreadCompaction';
import type { AgentRegistry } from '@runlith/agent/thread/agents/AgentRegistry';
import type { WorkflowConfig } from '@runlith/agent/workflow/WorkflowConfig';
import type { ThreadLiveFeed } from '@runlith/agent/thread/run/ThreadLiveFeed';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import type { AgentCalls } from '@runlith/agent/AgentCalls';
import type { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import type { HarnessFailure } from './failure.js';
import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { WriteSet } from '../../../platform/contract/service/writes.js';
import type { ExternalSession } from '../wire/harness/externalSession.js';
import type { HarnessSeat } from '../wire/harness/seat.js';
import type { NativeThreadState } from './state.js';

type Storage = ThreadStorageHost<Unit<'machine'>, WriteUnit<'machine'>>;

export class NativeStorage extends Context.Service<
  NativeStorage,
  {
    readonly threads: Storage['storage'];
    readonly transitions: Storage['transitions'];
    readonly runs: Storage['createRuns'];
    readonly cacheObservations: NonNullable<Storage['cacheObservations']>;
    readonly ownerSettings: Storage['ownerSettings'];
    readonly writes: WriteSet;
  }
>()('tagma/threads/NativeStorage') {}

export class NativeHistories extends Context.Service<
  NativeHistories,
  {
    readonly serveDriven: (driven: () => ReadonlySet<string>) => () => void;
    readonly reconsider: () => void;
  }
>()('tagma/threads/NativeHistories') {}

export class NativeAgents extends Context.Service<NativeAgents, AgentRegistry<WriteUnit<'machine'>>>()('tagma/threads/NativeAgents') {}

export class NativeCompaction extends Context.Service<
  NativeCompaction,
  {
    readonly compaction: ThreadCompaction<WriteUnit<'machine'>>;
    readonly fill: NonNullable<ThreadPortFillers['compaction']>;
  }
>()('tagma/threads/NativeCompaction') {}

export class NativeInputRecovery extends Context.Service<NativeInputRecovery, ThreadInputRecovery>()('tagma/threads/NativeInputRecovery') {}

export class NativeSwitches extends Context.Service<NativeSwitches, NonNullable<ThreadHost['standingSwitches']>>()(
  'tagma/threads/NativeSwitches',
) {}

export class NativeWorkflow extends Context.Service<NativeWorkflow, WorkflowConfig>()('tagma/threads/NativeWorkflow') {}

export type BornFacet = {
  readonly threadId: string;
  readonly fromThreadId: string;
  readonly contextFrom?: string;
  readonly agentId: string;
  readonly harness?: HarnessSeat | null;
  readonly carried?: ThreadBirth['carried'];
  readonly isRoot?: boolean;
  readonly title?: string;
  readonly projectId?: number;
};

export class BornFacets extends Context.Service<
  BornFacets,
  {
    inherit(input: BornFacet, tx: WriteUnit<'machine'>): Effect.Effect<number | undefined, StoreFailure>;
  }
>()('tagma/threads/BornFacets') {}

export class ThreadHarness extends Context.Service<ThreadHarness, AgentHarness<NativeThreadState, Unit<'machine'>, WriteUnit<'machine'>>>()(
  'tagma/threads/ThreadHarness',
) {}

export class ThreadJournal extends Context.Service<
  ThreadJournal,
  Storage['eventLog'] & {
    open(threadId: string): Effect.Effect<void, ThreadStorageFailed>;
  }
>()('tagma/threads/ThreadJournal') {}

export class ThreadLive extends Context.Service<ThreadLive, ThreadLiveFeed<NativeThreadState>>()('tagma/threads/ThreadLive') {}

export class ThreadLaunchGate extends Context.Service<ThreadLaunchGate, HarnessLaunchGate>()('tagma/threads/ThreadLaunchGate') {}

type Born = ThreadBirth;

export class HarnessSandboxes extends Context.Service<
  HarnessSandboxes,
  {
    admit(
      input: { host: NonNullable<Born['host']>; child: Born['child']; projectId: number | undefined; carried: Born['carried'] },
      tx: WriteUnit<'machine'>,
    ): Effect.Effect<void, ThreadBorderFailed>;
    ready(thread: Born['child']): Effect.Effect<void, ThreadBorderFailed>;
  }
>()('tagma/threads/HarnessSandboxes') {}

export class ExternalThreads extends Context.Service<ExternalThreads, NonNullable<ThreadPortFillers['threads']>>()(
  'tagma/threads/ExternalThreads',
) {}

export class SettledRelease extends Context.Service<SettledRelease, NonNullable<AgentHarnessOptions<NativeThreadState>['settled']>>()(
  'tagma/threads/SettledRelease',
) {}

export class HarnessCalls extends Context.Service<HarnessCalls, AgentCalls>()('tagma/threads/HarnessCalls') {}

export class McpForgetting extends Context.Service<McpForgetting, { forget(threadId: string): void }>()('tagma/threads/McpForgetting') {}

export class SourceForgetting extends Context.Service<
  SourceForgetting,
  {
    forget(threadId: string): Effect.Effect<void>;
  }
>()('tagma/threads/SourceForgetting') {}

export class ThreadTeardown extends Context.Service<
  ThreadTeardown,
  {
    readonly endHeld: (
      threads: readonly { readonly id: string; readonly harness: ExternalSession | null }[],
      act: string,
    ) => Effect.Effect<void, HarnessFailure>;
    readonly endCommands: (input: {
      readonly projectId: number;
      readonly threadIds: readonly string[];
      readonly run?: string;
      readonly cause: CancellationCause;
      readonly operation: HostRequestKey;
    }) => Effect.Effect<void, HarnessFailure>;
    readonly afterDeleted: (
      threadIds: readonly string[],
      hosts: readonly { readonly kind: string; readonly id: string }[],
    ) => Effect.Effect<void>;
  }
>()('tagma/threads/ThreadTeardown') {}

export class HarnessOwner extends Context.Service<HarnessOwner, { readonly id: string; readonly build: string }>()(
  'tagma/threads/HarnessOwner',
) {}

export class HarnessToolOutputs extends Context.Service<HarnessToolOutputs, Storage['toolOutputs']>()('tagma/threads/HarnessToolOutputs') {}
