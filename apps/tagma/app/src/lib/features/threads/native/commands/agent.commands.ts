import { Effect } from 'effect';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ThreadBirth } from '../../birth/ThreadBirth.svelte.js';
import type { ShownThread } from '../../ShownThread.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

function chosenType(shown: ShownThread, birth: ThreadBirth): string | null {
  return shown.identity?.bornAs ?? birth.nextType;
}

export function agentCommand(shown: ShownThread, birth: ThreadBirth, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'agent',
    order: 60,
    get description() {
      return shown.identity === null ? 'What the next thread is born as' : 'Born as — or a new thread as another';
    },
    get value() {
      const chosen = chosenType(shown, birth);
      return birth.types.rows?.find((type) => type.id === chosen)?.name ?? chosen ?? undefined;
    },
    get disabled() {
      return birth.types.agents.length === 0;
    },
    get options() {
      const chosen = chosenType(shown, birth);
      const born = shown.identity?.bornAs ?? null;
      return birth.types.agents.map((type) => ({
        id: type.id,
        label: type.name,
        description: type.description,
        active: type.id === chosen,
        disabled: born !== null && type.id === born,
      }));
    },
    run: ({ optionId }) =>
      Effect.sync(() => {
        if (optionId === undefined) return;
        if (shown.id === null) birth.applyType(optionId);
        else writes.startDraftAs(optionId);
      }),
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'agent', make: (owners) => agentCommand(owners.shown, owners.birth, owners.writes) },
];
