import { manifest } from '../platform/contract/service/manifest.js';
import { buildVerbs } from './verbs.js';

export const checkoutBuilds = manifest({
  id: 'checkout-builds',
  title: 'Builds from the checkout',
  verbs: buildVerbs,
});
