import type { PaneKind } from '$lib/shared/panes/pane.js';
import PluginPaneTitle from './PluginPaneTitle.svelte';
import { ViewSets } from './ViewSets.svelte.js';

export const PLUGIN_PANE = 'plugin-pane';

export const paneId = (plugin: string, view: string): string => `${plugin}/${view}`;

export const paneOf = (id: string | null): { readonly plugin: string; readonly view: string } | null => {
  const cut = id?.indexOf('/') ?? -1;
  return id === null || cut <= 0 || cut === id.length - 1 ? null : { plugin: id.slice(0, cut), view: id.slice(cut + 1) };
};

export const panes: readonly PaneKind[] = [
  {
    kind: PLUGIN_PANE,
    noun: 'plugin view',
    view: () => import('./PluginPane.svelte'),
    title: PluginPaneTitle,
    stands: (app, id) => {
      const sets = app.resolve(ViewSets);
      if (!sets.known) return null;
      const target = paneOf(id);
      return target !== null && sets.keepsPane(target.plugin, target.view);
    },
  },
];
