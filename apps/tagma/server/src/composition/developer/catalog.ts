import { CORE_CATALOG } from '../coreCatalog.js';
import { reflections } from '../../reflections/contract/wire/module.js';

export const CATALOG_MODULES: readonly [...typeof CORE_CATALOG, typeof reflections] = [...CORE_CATALOG, reflections];
