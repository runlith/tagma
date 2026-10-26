import { Effect } from 'effect';
import type { ComposerSlashCommand } from '@runlith/chat-ui/composer';
import type { ModelPanelState } from '../../ModelPanelState.svelte.js';
import type { ThreadViews } from '../../thread/ThreadViews.js';
import type { CommandDeclaration } from '../contribution.js';

export function modelCommand(views: ThreadViews, panel: ModelPanelState): ComposerSlashCommand {
  return {
    name: 'model',
    order: 40,
    description: 'What this thread thinks with',
    get value() {
      return views.model.settings?.modelLabel || undefined;
    },
    get disabled() {
      const settings = views.model.settings;
      return settings === null || settings.busy;
    },
    opens: true,
    run: ({ query }) => Effect.sync(() => panel.open('model', query ?? '')),
  };
}

export function reasoningCommand(views: ThreadViews, panel: ModelPanelState): ComposerSlashCommand {
  return {
    name: 'reasoning',
    order: 50,
    description: 'How hard the model thinks',
    get value() {
      return views.model.settings?.reasoningLabel || undefined;
    },
    get disabled() {
      const settings = views.model.settings;
      return settings === null || settings.busy || settings.reasoningOptions.length === 0;
    },
    opens: true,
    run: ({ query }) => Effect.sync(() => panel.open('model', query ?? '')),
  };
}

export const commands: readonly CommandDeclaration[] = [
  { name: 'model', make: (owners) => modelCommand(owners.views, owners.panel) },
  { name: 'reasoning', make: (owners) => reasoningCommand(owners.views, owners.panel) },
];
