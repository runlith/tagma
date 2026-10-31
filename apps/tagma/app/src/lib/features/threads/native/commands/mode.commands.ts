import { Effect } from 'effect';
import type { ComposerCycle, ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ThreadMode } from '@runlith/chat-ui/wire/ChatConnection';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

function activeMode(writes: ThreadWrites): ThreadMode | undefined {
  const modes = writes.modes;
  return modes?.declared.find((mode) => mode.id === modes.active);
}

function modeCommand(writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'mode',
    order: 20,
    description: 'What this thread asks before it acts',
    get value() {
      return activeMode(writes)?.label;
    },
    get valueActive() {
      return activeMode(writes)?.elevated === true;
    },
    get disabled() {
      return writes.modes === null;
    },
    get options() {
      const modes = writes.modes;
      return (modes?.declared ?? []).map((mode) => ({
        id: mode.id,
        label: mode.label,
        description: mode.description,
        active: mode.id === modes?.active,
      }));
    },
    run: ({ optionId }) => (optionId === undefined ? Effect.void : writes.chooseMode(optionId)),
  };
}

export function modeCycle(writes: ThreadWrites): ComposerCycle {
  return {
    get available() {
      return writes.modes !== null;
    },
    run: () => writes.cycleMode(),
  };
}

export const commands: readonly CommandDeclaration[] = [{ name: 'mode', make: (owners) => modeCommand(owners.writes) }];
