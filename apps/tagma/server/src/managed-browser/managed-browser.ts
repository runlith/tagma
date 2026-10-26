import { HOST_ADAPTERS } from '../browser/contract/service/hosts.js';
import { lazyLayer, manifest } from '../platform/contract/service/manifest.js';
import { managedAdapter } from './adapter.js';

export const managedBrowser = manifest({
  id: 'managed-browser',
  title: 'Managed Chromium',
  contributions: HOST_ADAPTERS.of(managedAdapter),
  lifetimes: {
    installation: lazyLayer(
      () => import('./layer.js'),
      ({ managedLayer }) => managedLayer,
    ),
  },
});
