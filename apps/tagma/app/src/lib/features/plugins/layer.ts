import { Layer } from '@runlith/layer/Layer';
import { MarketplacesFeed } from './Feed.svelte.js';
import { PluginsColumn } from './PluginsColumn.svelte.js';
import { PluginsPlace } from './PluginsPlace.svelte.js';
import { PluginsRepo } from './Repo.js';

export const PluginsLayer = Layer.mergeAll(PluginsRepo, MarketplacesFeed, PluginsColumn, PluginsPlace);
