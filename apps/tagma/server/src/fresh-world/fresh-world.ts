import { manifest } from '../platform/contract/service/manifest.js';
import { freshWorld as declaration } from './contract/wire/module.js';
import { freshVerbs } from './verbs.js';

export const freshWorld = manifest({
  ...declaration,
  verbs: freshVerbs,
  bodies: async () => Object.values((await import('./operations.js')).FRESH_PAIRS),
});
