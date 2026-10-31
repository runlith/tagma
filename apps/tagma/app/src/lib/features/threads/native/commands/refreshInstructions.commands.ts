import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ShownThread } from '../../ShownThread.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

function refreshInstructionsCommand(shown: ShownThread, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'refresh-instructions',
    order: 80,
    get description() {
      return shown.id === null
        ? 'Re-read skills and instruction files from the checkout'
        : 'Re-read the checkout and update what this thread runs under, from its next turn';
    },
    run: () => writes.refreshInstructions(),
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'refresh-instructions', make: (owners) => refreshInstructionsCommand(owners.shown, owners.writes) },
];
