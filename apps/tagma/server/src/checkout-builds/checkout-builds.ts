import { manifest } from '../platform/contract/service/manifest.js';
import { checkoutBuilds as declaration } from './contract/wire/module.js';
import { buildVerbs } from './verbs.js';

export const checkoutBuilds = manifest({
  ...declaration,
  verbs: buildVerbs,
  bodies: async () => Object.values((await import('./operations.js')).SURFACE_PAIRS),
});
