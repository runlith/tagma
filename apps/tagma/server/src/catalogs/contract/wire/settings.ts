import { Schema } from 'effect';
import { settingKey } from '../../../platform/contract/wire/setting.js';
import { CATALOGS, CATALOG_IDS, DEFAULT_CATALOGS } from './registry.js';

export const graphCatalogs = settingKey({
  id: 'graph.catalogs',
  order: 50,
  title: 'Tag catalogs',
  description:
    'The catalogs of tag declarations this project is switched on with. Switching one on installs its tags as `#tag` nodes here, where they are read exactly as a tag you declare yourself; switching one off leaves the nodes standing, to be deleted or edited like any other.',
  schema: Schema.Array(Schema.Literals(CATALOG_IDS)),
  control: {
    kind: 'choice',
    multiple: true,
    choices: CATALOGS.map((catalog) => ({
      value: catalog.id,
      label: catalog.id,
      hint: `${catalog.tags.map((tag) => `#${tag.id}`).join(' ')}`,
    })),
  },
  fallback: DEFAULT_CATALOGS,
  scopes: ['user', 'project'],
  merge: 'replace',
  installs: true,
} as const);
