import { schedule as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';

export const schedule = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).SCHEDULE_PAIRS),
  tables: async () => {
    const { scheduleRun } = await import('./store/tables.js');
    return { entities: [scheduleRun], history: [] };
  },
  lifetimes: {
    serving: lazyLayer(
      () => import('./layer.js'),
      ({ scheduleLayer }) => scheduleLayer,
    ),
  },
});
