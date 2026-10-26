import { manifest } from '../platform/contract/service/manifest.js';
import { graphCatalogs } from './contract/wire/settings.js';

export const catalogs = manifest({
  id: 'catalogs',
  settings: [graphCatalogs],
});
