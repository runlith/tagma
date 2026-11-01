import { CORE_CATALOG } from '../coreCatalog.js';
import { graphRemote } from '../../graph-remote/contract/wire/module.js';

export const CATALOG_MODULES: readonly [...typeof CORE_CATALOG, typeof graphRemote] = [...CORE_CATALOG, graphRemote];
