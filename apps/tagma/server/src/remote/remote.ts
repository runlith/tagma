import { remote as declaration } from './contract/wire/module.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { PAIRING_ENDPOINT } from './contract/wire/access.js';
import { REMOTE_SETTING_SECTIONS, remoteEnabled } from './keys.js';

export const remote = manifest({
  ...declaration,
  bodies: async () => Object.values((await import('./operations.js')).REMOTE_PAIRS),
  tables: async () => {
    const [{ device, pairing, remoteOrigin, remoteTerminal }] = await Promise.all([import('./store/tables.js')]);
    return { entities: [device, pairing, remoteOrigin, remoteTerminal], history: [] };
  },
  settings: [remoteEnabled],
  settingSections: REMOTE_SETTING_SECTIONS,
  endpoints: [PAIRING_ENDPOINT],
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ remoteLayer }) => remoteLayer,
    ),
  },
});
