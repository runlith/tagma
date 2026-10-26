import { Context, type Effect } from 'effect';
import type { AgentCatalog, AgentFile, AgentFileDiscovery, AgentFloor, AgentPreview, AgentPreviewInput } from '../wire/agentLibrary.js';
import type { AgentProfile } from '@runlith/agent/thread/agents/AgentProfile';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadSpawnType, ThreadTypeCaller } from '@runlith/agent/thread/agents/ThreadTypeCatalog';
import type { HarnessInstall } from '../wire/harness/externalSession.js';
import type { HarnessFailure } from './failure.js';

export type OfferedType = ThreadSpawnType & {
  readonly harness?: HarnessInstall;
};

export type RejectedType = { readonly path: string; readonly reason: string };

export type AgentPackages = {
  agentsIn(projectId: number): Effect.Effect<readonly AgentFile[], ThreadBorderFailed>;
  agentIn(projectId: number, typeId: string): Effect.Effect<AgentFile | undefined, ThreadBorderFailed>;
};

export type AgentFiles = {
  readonly baseId: string;
  readonly discover: (floors: readonly AgentFloor[]) => Effect.Effect<AgentFileDiscovery, unknown>;
  readonly profileOf: (file: AgentFile) => AgentProfile;
};

export class AgentLibrary extends Context.Service<
  AgentLibrary,
  {
    list(projectId: number): Effect.Effect<AgentCatalog, HarnessFailure>;
    preview(projectId: number, input: AgentPreviewInput): Effect.Effect<AgentPreview, HarnessFailure>;
    offered(
      projectId: number,
      caller: ThreadTypeCaller,
    ): Effect.Effect<{ readonly types: readonly OfferedType[]; readonly rejected: readonly RejectedType[] }, HarnessFailure>;
  }
>()('tagma/threads/AgentLibrary') {}
