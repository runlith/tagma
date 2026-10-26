import { Context, Data, type Effect } from 'effect';
import type { AgentApprovalMode } from '../agent/contracts';
import type { AgentProfile } from '../thread/agents/AgentProfile';
import type { ThreadSpawnType, ThreadTypeCaller } from '../thread/agents/ThreadTypeCatalog';
import type { ThreadStorageFailed } from '../thread/persisted';
import type { ThreadRecord } from '../thread/record';
import type { TransportCapabilities } from '../thread/record';

export type ThreadTypeOffer = {
  readonly baseAgentId: string;
  readonly profile?: AgentProfile;
  readonly harness: string;
  readonly capabilities: TransportCapabilities;
  readonly approvalMode?: AgentApprovalMode;
};

export type ThreadTypeWithheld = {
  readonly withheld: string;
  readonly unblock: readonly [string, ...string[]];
};

export class ThreadTypesUnavailable extends Data.TaggedError('ThreadTypesUnavailable')<{
  readonly cause: unknown;
}> {}

export type ThreadTypesFailure = ThreadStorageFailed | ThreadTypesUnavailable;

export class ThreadTypes extends Context.Service<
  ThreadTypes,
  {
    resolve(input: {
      readonly caller: ThreadTypeCaller;
      readonly under: ThreadRecord;
      readonly project?: number;
      readonly typeId: string;
    }): Effect.Effect<ThreadTypeOffer | ThreadTypeWithheld | null, ThreadTypesFailure>;
    offered(input: {
      readonly caller: ThreadTypeCaller;
      readonly under: ThreadRecord;
      readonly project?: number;
    }): Effect.Effect<readonly ThreadSpawnType[], ThreadTypesFailure>;
  }
>()('@runlith/agent/ThreadTypes') {}
