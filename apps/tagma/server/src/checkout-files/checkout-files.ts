import { checkoutFiles as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { CheckoutPlaces } from '../workspace/contract/service/checkouts.js';
import { Directories } from './contract/service/directories.js';
import { Documents } from './contract/service/documents.js';
import { LooseFolders } from './contract/service/folders.js';
import { ScratchFolders } from './contract/service/scratch.js';
import { Searches } from './contract/service/searches.js';
import type { FilesLive } from './contract/service/live.js';
import { TREE_FEED } from './contract/wire/directory.js';
import { DOCUMENT_FEED, LOOSE_DOCUMENT_FEED } from './contract/wire/document.js';
import { SCRATCH_FEED } from './contract/wire/scratch.js';
import { SEARCH_FEED } from './contract/wire/search.js';
import { FILES_SETTING_KEYS, FILES_SETTING_SECTIONS } from './contract/wire/settings.js';

const FEEDS = [TREE_FEED, SEARCH_FEED, DOCUMENT_FEED, LOOSE_DOCUMENT_FEED, SCRATCH_FEED] as const;

const live: FilesLive = liveOf(FEEDS, async (door) =>
  (await import('./feed.js')).filesChannel(
    Context.get(door, CheckoutPlaces),
    Context.get(door, Directories),
    Context.get(door, Searches),
    Context.get(door, Documents),
    Context.get(door, LooseFolders),
    Context.get(door, ScratchFolders),
  ),
);

export const checkoutFiles = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations/pairs.js')).FILE_PAIRS),
  live,
  settings: FILES_SETTING_KEYS,
  settingSections: FILES_SETTING_SECTIONS,
  drivers: [{ id: 'trash-sweep' }],
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ checkoutFilesServingLayer }) => checkoutFilesServingLayer,
    ),
  },
});
