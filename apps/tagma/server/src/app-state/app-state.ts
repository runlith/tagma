import { Context } from 'effect';
import { lazyLayer, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { Documents } from './contract/service/documents.js';
import { appState as declaration } from './contract/wire/module.js';

export const appState = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).APP_STATE_PAIRS),
  live: liveOf(declaration.feeds, (door: Context.Context<Documents>) => ({
    'app-state.changes': () => Context.get(door, Documents).changes,
  })),
  tables: async () => {
    const { appDocument } = await import('./store/tables.js');
    return { entities: [appDocument], history: [] };
  },
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ documentsLayer }) => documentsLayer,
    ),
  },
});
