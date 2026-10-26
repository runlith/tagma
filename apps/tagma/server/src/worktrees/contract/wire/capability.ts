import type { CapabilityDeclaration } from '../../../platform/contract/wire/capability.js';

export const worktreesCapability = {
  id: 'worktrees',
  description:
    'making a checkout of a registered Git store, recovering one whose end nobody saw, reading what one holds, and finishing a worktree: merging it, opening its pull request, deleting it',
  sections: [],
} as const satisfies CapabilityDeclaration;
