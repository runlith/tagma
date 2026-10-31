import { Effect } from 'effect';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

function newThreadCommand(writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'new',
    order: 10,
    description: 'Start a new thread',
    run: () => Effect.sync(() => writes.startDraft()),
  };
}

export const commands: readonly CommandDeclaration[] = [{ name: 'new', make: (owners) => newThreadCommand(owners.writes) }];
