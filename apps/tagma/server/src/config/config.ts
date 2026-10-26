import { Effect } from 'effect';
import { config as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';

export const config = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations/read.js')).CONFIG_PAIRS),
  facts: [
    {
      id: 'config',
      read: (checkout) =>
        Effect.flatMap(
          Effect.promise(() => import('./fact.js')),
          (loaded) => loaded.configPresent(checkout),
        ),
    },
  ],
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ configsLayer }) => configsLayer,
    ),
  },
});
