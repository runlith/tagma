import type { PanesModule } from '$lib/shared/panes/pane.js';
import PluginTitle from './PluginTitle.svelte';
import { ViewSets } from './ViewSets.svelte.js';

export const PLUGIN_PANE = 'plugin';

export const pluginPaneId = (plugin: string, view: string): string => `${plugin}/${view}`;

export const pluginPaneOf = (id: string | null): { readonly plugin: string; readonly view: string } | null => {
  const cut = id?.indexOf('/') ?? -1;
  return id === null || cut <= 0 || cut === id.length - 1 ? null : { plugin: id.slice(0, cut), view: id.slice(cut + 1) };
};

export const panes: PanesModule['panes'] = [
  {
    kind: PLUGIN_PANE,
    noun: 'plugin view',
    view: () => import('./PluginPane.svelte'),
    title: PluginTitle,
    stands: (app, id) => {
      const sets = app.resolve(ViewSets);
      if (!sets.known) return null;
      const target = pluginPaneOf(id);
      return target !== null && sets.keepsPane(target.plugin, target.view);
    },
  },
];
