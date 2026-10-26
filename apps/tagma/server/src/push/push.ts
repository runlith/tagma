import { push as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';

export const push = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).PUSH_PAIRS),
  tables: async () => {
    const [{ pushSubscription, pushSent }] = await Promise.all([import('./store/tables.js')]);
    return { entities: [pushSubscription], history: [pushSent] };
  },
  drivers: [{ id: 'push-retention' }],
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ pushLayer }) => pushLayer,
    ),
  },
});
