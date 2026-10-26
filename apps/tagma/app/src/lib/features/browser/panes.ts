import type { PageId } from '@tagma/server/browser/contract/wire/ids';
import type { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import { type PaneContent, type PanesModule, projectScopedId, projectScopedOf } from '$lib/shared/panes/pane.js';
import BrowserOffer from './BrowserOffer.svelte';
import BrowserTitle from './BrowserTitle.svelte';
import { OpenPages } from './OpenPages.svelte.js';

export const BROWSER_PANE = 'browser';

export type Shown = { readonly project: number; readonly page: PageId };

export const shownId = (shown: Shown): string => projectScopedId(shown.project, shown.page);

export const shownOf = (id: string | null): Shown | null => {
  const scoped = projectScopedOf(id);
  return scoped === null || scoped.rest === '' ? null : { project: scoped.project, page: scoped.rest as PageId };
};

export const browserPane = (shown: Shown | null): PaneContent => ({ kind: BROWSER_PANE, id: shown === null ? null : shownId(shown) });

export const panes: PanesModule['panes'] = [
  {
    kind: BROWSER_PANE,
    noun: 'page',
    portable: true,
    view: () => import('./BrowserPane.svelte'),
    title: BrowserTitle,
    offer: { order: 30, view: BrowserOffer },
    stands: (app, id) => {
      const shown = shownOf(id);
      if (shown === null) return true;
      const open = app.resolve(OpenPages);
      if (shown.project !== open.aim.projectId || !open.listing.listed) return null;
      return open.listing.byId.has(shown.page);
    },
  },
];

export function showPage(sides: SidePanes, shown: Shown, fresh = false): void {
  const id = shownId(shown);
  const browsers = sides.panes.filter((pane) => pane.kind === BROWSER_PANE);
  const standing = browsers.find((pane) => pane.id === id);
  const active = sides.active?.kind === BROWSER_PANE ? sides.active : undefined;
  const aimed = standing ?? (fresh ? undefined : (active ?? browsers.at(-1)));
  if (aimed === undefined) {
    sides.open(browserPane(shown));
    return;
  }
  sides.point(aimed.key, id);
  sides.activate(aimed.key);
}
