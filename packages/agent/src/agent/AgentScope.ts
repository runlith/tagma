import { Effect } from 'effect';
import { type CatalogSupply, type ResolvedCatalog, type Withheld, resolveCatalog } from '../catalog/resolveCatalog';
import type { Agent } from './Agent';
import { toolSearchContribution } from './AgentDeferredTools';
import type { AgentHostFailed } from './AgentFailure';
import type { ModelRequestInput } from './modelPort';
import type { Tool } from './tool';
import type { ToolCatalog } from './ToolCatalog';

export type AgentScope<TCtx = unknown> = {
  readonly generation: number;
  readonly ctx: TCtx;
  readonly model: ModelRequestInput;
  readonly catalog: ToolCatalog;
  readonly withheld: readonly Withheld[];
  readonly sources: ReadonlyMap<string, Tool>;
};

export type CatalogRefresh<TCtx> = (ctx: TCtx) => Effect.Effect<ResolvedCatalog<Tool> | null, AgentHostFailed>;

export const refreshCatalog = Effect.fnUntraced(function* <TCtx>(scope: AgentScope<TCtx>, refresh: CatalogRefresh<TCtx> | undefined) {
  const resolved = yield* refresh?.(scope.ctx) ?? Effect.succeed(null);
  return resolved === null ? scope : agentScope({ generation: scope.generation, ctx: scope.ctx, model: scope.model, resolved });
});

export type AgentScopeAdmission<TCtx = unknown> = {
  readonly generation: number;
  readonly ctx: TCtx;
};

export function agentCatalog<TCtx>(agent: Agent<TCtx>, ctx: TCtx, supply?: CatalogSupply<Tool>): ResolvedCatalog<Tool> {
  return resolveCatalog({ grant: agent.grant }, supply?.profile ?? {}, [
    { source: agent.id, tools: agent.tools(ctx) },
    ...(supply?.contributions ?? []),
    toolSearchContribution,
  ]);
}

export function agentScope<TCtx>(input: {
  readonly generation: number;
  readonly ctx: TCtx;
  readonly model: ModelRequestInput;
  readonly resolved: ResolvedCatalog<Tool>;
}): AgentScope<TCtx> {
  return {
    generation: input.generation,
    ctx: input.ctx,
    model: input.model,
    catalog: input.resolved.catalog,
    withheld: input.resolved.withheld,
    sources: new Map(Object.entries(input.resolved.catalog)),
  };
}

export type AgentScopeBoundary<TCtx = unknown> = (input: {
  readonly stepNumber: number;
  readonly scope: AgentScope<TCtx>;
}) => Effect.Effect<AgentScope<TCtx>, AgentHostFailed>;
