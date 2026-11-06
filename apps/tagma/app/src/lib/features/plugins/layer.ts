import { Layer } from '@runlith/layer/Layer';
import { LinkKinds } from '$lib/features/opening/Link.js';
import { SettingSections } from '$lib/features/settings/section.js';
import { Columns } from '$lib/features/workspace/column.js';
import { Surfaces } from '$lib/features/workspace/surface.js';
import { columns } from './columns.js';
import { MarketplacesFeed } from './Feed.svelte.js';
import { links } from './links.js';
import { CardParts } from './parts.js';
import { PluginsColumn } from './PluginsColumn.svelte.js';
import { PluginsPlace } from './PluginsPlace.svelte.js';
import { PluginsRepo } from './Repo.js';
import { sections } from './settings.js';
import { surfaces } from './surfaces.js';

export const PluginsLayer = Layer.mergeAll(
  CardParts,
  Surfaces.contribute('plugins', ...surfaces),
  Columns.contribute('plugins', ...columns),
  SettingSections.contribute('plugins', ...sections),
  LinkKinds.contribute('plugins', ...links),
  PluginsRepo,
  MarketplacesFeed,
  PluginsColumn,
  PluginsPlace,
);
