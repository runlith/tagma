import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ThreadViews } from '../../thread/ThreadViews.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import { DELEGATION_OWN, DELEGATION_PICKS } from '../../thread/authority.js';
import { Effect } from 'effect';
import type { CommandDeclaration } from '../contribution.js';

const WORDS = {
  on: 'Agents may start agents here and in the team this starts, within the configured depth.',
  off: 'Agents do the work themselves; their spawn refuses.',
  inherit: 'Follow the thread that leads this team, else the machine switch.',
} as const;

const LABELS = { on: 'On', off: 'Off', inherit: 'Inherit' } as const;

export function delegationCommand(views: ThreadViews, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'delegation',
    order: 30,
    get description() {
      const origin = views.authority.delegation.origin;
      return origin === null
        ? 'Whether agents here may start other agents'
        : `Whether agents here may start other agents — decided by ${origin}`;
    },
    get value() {
      const allowed = views.authority.delegation.allowed;
      return allowed === null ? undefined : allowed ? 'On' : 'Off';
    },
    get valueActive() {
      return views.authority.delegation.allowed === false;
    },
    get disabled() {
      return views.authority.busy;
    },
    get options() {
      return DELEGATION_PICKS.map((pick) => ({
        id: pick,
        label: LABELS[pick],
        description: WORDS[pick],
        active: DELEGATION_OWN[pick] === views.authority.delegation.own,
      }));
    },
    run: ({ optionId }) => {
      const pick = DELEGATION_PICKS.find((one) => one === optionId);
      return pick === undefined ? Effect.void : writes.setDelegation(pick);
    },
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'delegation', make: (owners) => delegationCommand(owners.views, owners.writes) },
];
