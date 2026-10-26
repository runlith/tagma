import { graphCatalogs } from '../../catalogs/contract/wire/settings.js';
import { catalogs } from '../../catalogs/testing/doubles.js';
import { settingDeclarations } from '../settings.js';

export const SHIPPED_CATALOGS = catalogs(graphCatalogs);

export const SETTING_DECLARATIONS = settingDeclarations();
