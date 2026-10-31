import { Layer } from '@runlith/layer/Layer';
import { Panes } from '$lib/shared/panes/pane.js';
import { PageStates } from './PageStates.svelte.js';
import { PageZoom } from './PageZoom.svelte.js';
import { panes } from './panes.js';
import { ThreadPages } from './ThreadPages.svelte.js';
import { VideosRepo } from './VideosRepo.js';

export const PagesLayer = Layer.mergeAll(Panes.contribute('pages', ...panes), ThreadPages, PageStates, PageZoom, VideosRepo);
