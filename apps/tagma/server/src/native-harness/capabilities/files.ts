import type { SectionId } from '../../threads/doctrine/registry.js';
import type { WorldFacts } from '../../executions/contract/service/worlds.js';
import { instructionFilesSection, placementSection, scratchSection, setupSection } from '../turns/worldState.js';
import type { CapabilityBehaviour } from './contract.js';

const FILE_TOOLS = { read: 'eager', write: 'eager', edit: 'eager', delete: 'deferred', rename: 'deferred', ls: 'eager' } as const;

function treeSections(facts: WorldFacts): readonly SectionId[] {
  if (facts.shared) return ['typed-tools', 'the-shared-checkout', 'branches-and-worktrees'];
  if (!facts.history && !facts.network) return ['the-sandbox-tree'];
  return ['typed-tools'];
}

export const files: CapabilityBehaviour = {
  factSections: treeSections,
  toolNames: Object.keys(FILE_TOOLS),
  workspaceTools: FILE_TOOLS,
  turnNote: (ctx) => [
    scratchSection(ctx.world.scratch),
    instructionFilesSection(ctx.sources.contextFiles),
    ...(ctx.world.facts.shared ? [placementSection(ctx.workingRoot, ctx.projectRoot), setupSection(ctx.worktreeSetup ?? null)] : []),
  ],
};
