import type { CapabilityBehaviour } from './contract.js';
import { commandRulesSection } from '../turns/commandRules.js';

const SHELL_TOOLS = { bash: 'eager', glob: 'eager', grep: 'eager' } as const;

export const shell: CapabilityBehaviour = {
  factSections: (facts) => [
    ...(facts.shared ? ['the-shared-checkout' as const] : []),
    ...(facts.history ? ['commits' as const, 'commit-steps' as const] : []),
  ],
  toolNames: Object.keys(SHELL_TOOLS),
  workspaceTools: SHELL_TOOLS,
  turnNote: (ctx) => [commandRulesSection(ctx.machine, ctx.projectId, ctx.thread.id)],
};
