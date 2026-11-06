import { Layer } from '@runlith/layer/Layer';
import { Actions } from '$lib/features/workspace/action.js';
import { Panes } from '$lib/shared/panes/pane.js';
import { actions } from './actions.js';
import { PageStates } from './PageStates.svelte.js';
import { PageZoom } from './PageZoom.svelte.js';
import { panes } from './panes.js';
import { ThreadPages } from './ThreadPages.svelte.js';
import { VideosRepo } from './VideosRepo.js';

export const PagesLayer = Layer.mergeAll(
  Panes.contribute('pages', ...panes),
  Actions.contribute('pages', { id: 'pages', area: 'Pages', actions }),
  ThreadPages,
  PageStates,
  PageZoom,
  VideosRepo,
);
