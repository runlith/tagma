import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import { Effect } from 'effect';
import type { ThreadViews } from '../../thread/ThreadViews.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

const WORDS = {
  you: 'Its questions come to you instead of its parent.',
  default: 'Its parent answers its questions, as far as the parent’s /approves reaches.',
} as const;

function approverCommand(views: ThreadViews, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'approver',
    order: 31,
    description: 'Who answers this thread’s approval questions',
    get value() {
      const approving = views.authority.approving;
      if (approving === undefined || approving === null) return undefined;
      return approving.approver === null ? 'You' : 'Parent';
    },
    get disabled() {
      return views.authority.setApprover === undefined || views.authority.busy;
    },
    get options() {
      const taken = views.authority.approving?.takenOver === true;
      return [
        { id: 'you', label: 'You', description: WORDS.you, active: taken },
        { id: 'default', label: 'Default', description: WORDS.default, active: !taken },
      ];
    },
    run: ({ optionId }) => {
      const pick = optionId === 'you' || optionId === 'default' ? optionId : undefined;
      return pick === undefined ? Effect.void : writes.setApprover(pick);
    },
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'approver', make: (owners) => approverCommand(owners.views, owners.writes) },
];
