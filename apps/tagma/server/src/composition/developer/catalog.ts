import { CORE_CATALOG } from '../coreCatalog.js';
import { graphRemote } from '../../graph-remote/contract/wire/module.js';
import { reflections } from '../../reflections/contract/wire/module.js';
import { checkoutBuilds } from '../../checkout-builds/contract/wire/module.js';

export const CATALOG_MODULES: readonly [...typeof CORE_CATALOG, typeof graphRemote, typeof reflections, typeof checkoutBuilds] = [
  ...CORE_CATALOG,
  graphRemote,
  reflections,
  checkoutBuilds,
];
