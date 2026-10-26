import { Layer } from '@runlith/layer/Layer';
import { ClosedPages } from './ClosedPages.svelte.js';
import { DesktopPages } from './DesktopPages.svelte.js';
import { Links } from './Links.svelte.js';
import { OpenPages } from './OpenPages.svelte.js';
import { Picks } from './pick/Picks.js';

export const BrowserLayer = Layer.mergeAll(DesktopPages, Links, Picks, OpenPages, ClosedPages);
