import { CORE_CATALOG } from '../coreCatalog.js';
import { reflections } from '../../reflections/contract/wire/module.js';
import { checkoutBuilds } from '../../checkout-builds/contract/wire/module.js';
import { freshWorld } from '../../fresh-world/contract/wire/module.js';

export const CATALOG_MODULES: readonly [...typeof CORE_CATALOG, typeof reflections, typeof checkoutBuilds, typeof freshWorld] = [
  ...CORE_CATALOG,
  reflections,
  checkoutBuilds,
  freshWorld,
];
