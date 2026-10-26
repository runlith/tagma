import { Effect } from 'effect';
import type { Tool } from '../../agent/tool';
import type { ToolCatalog } from '../../agent/ToolCatalog';
import type { CatalogContribution, CatalogSupply } from '../../catalog/resolveCatalog';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadToolSource } from '../ThreadPorts';
import { catalogProfileOf, type ThreadProfileBirth } from './AgentProfile';
import { threadPrompt } from './threadPrompt';

export const OUTPUT_SOURCE = 'output';

export type ThreadSources = (context: unknown) => Effect.Effect<readonly ThreadToolSource[], ThreadBorderFailed>;

export type ThreadSupplyPlan = {
  readonly sources: ThreadSources;
  readonly outputTools: ToolCatalog;
  readonly restored?: readonly string[];
};

export type ThreadSupplied = {
  readonly supply: CatalogSupply<Tool>;
  compose(instructions: string): string;
};

export function toolSupply(
  sources: readonly ThreadToolSource[],
  outputTools: ToolCatalog,
  profile: ThreadProfileBirth | null,
  restored?: readonly string[],
): CatalogSupply<Tool> {
  return {
    contributions: [
      ...sources.map((source): CatalogContribution<Tool> =>
        source.declined === undefined ? { source: source.id, tools: source.tools } : { source: source.id, declined: source.declined },
      ),
      { source: OUTPUT_SOURCE, tools: outputTools },
    ],
    profile: restored === undefined ? catalogProfileOf(profile) : { ...catalogProfileOf(profile), tools: restored },
  };
}

export function composedInstructions(
  profile: ThreadProfileBirth | null,
  sources: readonly ThreadToolSource[],
  instructions: string,
): string {
  return threadPrompt(
    instructions,
    profile?.overlay.instructions,
    sources.flatMap((source) => (source.prompt ? [source.prompt] : [])),
  );
}

export function supplied(
  plan: ThreadSupplyPlan,
  context: unknown,
  profile: ThreadProfileBirth | null,
): Effect.Effect<ThreadSupplied, ThreadBorderFailed> {
  return Effect.map(plan.sources(context), (sources) => ({
    supply: toolSupply(sources, plan.outputTools, profile, plan.restored),
    compose: (instructions) => composedInstructions(profile, sources, instructions),
  }));
}
