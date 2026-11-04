import { Context, type Effect } from 'effect';
import type { ToolCatalog } from '@runlith/agent/catalog';
import type { Tool, ToolShown } from '@runlith/agent/tool';
import type { CommentPolicy } from '@runlith/source-comments';
import type { CapabilityId } from '../../../platform/contract/wire/capability.js';
import type { WorldFacts } from '../../../executions/contract/service/worlds.js';
import type { TouchBrief } from '../../../graph/contract/service/orientation.js';
import type { GraphStore, StoreFailure } from '../../../platform/contract/service/store.js';
import type { GraphServices } from '../../../graph/contract/service/services.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ThreadContext } from '../../turns/context.js';

export type TouchedGraph = {
  readonly projectId: number;
  readonly graph: Context.Context<GraphServices | GraphStore>;
};

export type OfferedOperation = {
  readonly id: string;
  readonly meaning: string;
  readonly direct: boolean;
  readonly definition: Tool;
};

export type OfferFacts = {
  readonly world: WorldFacts;
  readonly comments: CommentPolicy;
  readonly images: boolean;
};

export class CapabilityOffers extends Context.Service<
  CapabilityOffers,
  {
    offers(capability: CapabilityId, facts: OfferFacts): readonly OfferedOperation[];
    everywhere(capability: CapabilityId): readonly OfferedOperation[];
  }
>()('tagma/native-harness/CapabilityOffers') {}

export class ThreadExecution extends Context.Service<
  ThreadExecution,
  {
    tools(ctx: ThreadContext, ids: readonly string[]): ToolCatalog;
    afterEdit(
      ctx: ThreadContext,
      tool: { readonly name: string; readonly input: unknown; readonly shown?: readonly ToolShown[] },
    ): Effect.Effect<void>;
    touched(
      ctx: ThreadContext,
      at: TouchedGraph,
      shown: readonly ToolShown[],
    ): Effect.Effect<readonly TouchBrief[], StoreFailure | GateRefusal>;
  }
>()('tagma/native-harness/ThreadExecution') {}
