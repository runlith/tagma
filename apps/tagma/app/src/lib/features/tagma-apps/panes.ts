import type { PanesModule } from '$lib/shared/panes/pane.js';
import TagmaAppTitle from './TagmaAppTitle.svelte';
import { ViewSets } from './ViewSets.svelte.js';

export const TAGMA_APP_PANE = 'app';

export const paneId = (tagmaApp: string, view: string): string => `${tagmaApp}/${view}`;

export const paneOf = (id: string | null): { readonly tagmaApp: string; readonly view: string } | null => {
  const cut = id?.indexOf('/') ?? -1;
  return id === null || cut <= 0 || cut === id.length - 1 ? null : { tagmaApp: id.slice(0, cut), view: id.slice(cut + 1) };
};

export const panes: PanesModule['panes'] = [
  {
    kind: TAGMA_APP_PANE,
    formerly: 'plugin',
    noun: 'app view',
    view: () => import('./TagmaAppPane.svelte'),
    title: TagmaAppTitle,
    stands: (app, id) => {
      const sets = app.resolve(ViewSets);
      if (!sets.known) return null;
      const target = paneOf(id);
      return target !== null && sets.keepsPane(target.tagmaApp, target.view);
    },
  },
];
