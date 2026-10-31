import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import { Effect } from 'effect';
import { APPROVES_ALL } from '@runlith/agent/thread/Approvers';
import type { ModeAction } from '../../thread/authority.js';
import type { ThreadViews } from '../../thread/ThreadViews.js';
import type { ThreadWrites } from '../../ThreadWrites.js';
import type { CommandDeclaration } from '../contribution.js';

const INHERIT = 'inherit';
const NOTHING = 'nothing';

const unlisted = (actions: readonly ModeAction[], own: readonly string[]): readonly ModeAction[] =>
  actions.filter((action) => !own.includes(action.id));

function approvesCommand(views: ThreadViews, writes: ThreadWrites): ComposerSlashCommand {
  return {
    name: 'approves',
    order: 32,
    description: 'What this thread answers for its children instead of you',
    get value() {
      const approves = views.authority.approving?.approves;
      if (approves === undefined) return undefined;
      if (approves.own === null) return 'Inherit';
      if (approves.own.includes(APPROVES_ALL)) return 'Everything';
      return approves.own.length === 0 ? 'Nothing' : `${approves.own.length} listed`;
    },
    get disabled() {
      return views.authority.setApproves === undefined || views.authority.busy;
    },
    get options() {
      const own = views.authority.approving?.approves.own ?? null;
      const listed = (own ?? []).filter((selector) => selector !== APPROVES_ALL);
      return [
        { id: INHERIT, label: 'Inherit', description: 'Follow the thread that leads this team, else the setting.', active: own === null },
        {
          id: APPROVES_ALL,
          label: 'Everything',
          description: 'Answer every question of its children instead of you.',
          active: own?.includes(APPROVES_ALL) === true,
        },
        {
          id: NOTHING,
          label: 'Nothing',
          description: 'Answer nothing here and below; every question comes to you.',
          active: own?.length === 0,
        },
        ...unlisted(views.authority.modeActions ?? [], listed).map((action) => ({
          id: action.id,
          label: action.label,
          description: action.description,
          active: false,
        })),
        ...listed.map((selector) => ({
          id: selector,
          label: selector,
          description: 'Listed: select it to take it off.',
          active: true,
        })),
      ];
    },
    run: ({ optionId }) => {
      if (optionId === undefined) return Effect.void;
      if (optionId === INHERIT) return writes.setApproves(null);
      if (optionId === NOTHING) return writes.setApproves([]);
      if (optionId === APPROVES_ALL) return writes.setApproves([APPROVES_ALL]);
      const own = (views.authority.approving?.approves.own ?? []).filter((selector) => selector !== APPROVES_ALL);
      return writes.setApproves(own.includes(optionId) ? own.filter((one) => one !== optionId) : [...own, optionId]);
    },
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'approves', make: (owners) => approvesCommand(owners.views, owners.writes) },
];
