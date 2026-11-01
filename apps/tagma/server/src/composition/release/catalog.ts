import { CORE_CATALOG } from '../coreCatalog.js';
import { graphRemote } from '../../graph-remote/contract/wire/module.js';
import { calls } from '../../calls/contract/wire/module.js';

export const CATALOG_MODULES: readonly [...typeof CORE_CATALOG, typeof graphRemote, typeof calls] = [...CORE_CATALOG, graphRemote, calls];
