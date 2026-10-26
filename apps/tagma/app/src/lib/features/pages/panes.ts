import type { SidePanes } from '$lib/app/panes/SidePanes.svelte.js';
import type { PlacesPort } from '$lib/app/panes/ThreadPlaces.js';
import type { PaneContent, PanesModule } from '$lib/shared/panes/pane.js';
import PageTitle from './PageTitle.svelte';
import { PageStates } from './PageStates.svelte.js';

export const ARTIFACT_PANE = 'artifact';

export const artifactPane = (id: string): PaneContent => ({ kind: ARTIFACT_PANE, id });

export function showArtifact(sides: SidePanes, seats: PlacesPort, thread: string | null, id: string): void {
  const content = artifactPane(id);
  const layouts = sides.layouts;
  if (thread !== null && layouts !== null) seats.openFor(layouts, thread, content);
  else sides.open(content);
}

export const panes: PanesModule['panes'] = [
  {
    kind: ARTIFACT_PANE,
    noun: 'published page',
    view: () => import('./PagePane.svelte'),
    title: PageTitle,
    stands: (app, id) => {
      if (id === null) return false;
      const state = app.resolve(PageStates).state(id);
      return state === undefined ? null : state.current !== null;
    },
  },
];
