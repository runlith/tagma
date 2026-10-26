import type { Behaviour } from '../contract/service/behaviours.js';
import type { FieldSchemaName, TagFields } from '../contract/wire/tags/declaration.js';
import { VIEW_QUERY } from '../contract/wire/query.js';
import { SELECTION } from '../contract/wire/tags/selection.js';

const LAYOUT = 'layout';

const holds = (fields: TagFields, name: string, schema: FieldSchemaName): boolean => {
  const type = Object.hasOwn(fields, name) ? fields[name] : undefined;
  return typeof type === 'object' && type.type === 'schema' && type.name === schema;
};

export const selection: Behaviour = {
  id: SELECTION,
  slots: { query: { kind: { schema: 'blockQuery' } }, layout: { kind: { schema: 'viewLayout' }, optional: true } },
  words: {},
  actions: [],
  requires: [],
  fromRoles: ({ leaf: childless }, fields) =>
    childless !== true || !holds(fields, VIEW_QUERY, 'blockQuery')
      ? null
      : { slots: { query: VIEW_QUERY, ...(holds(fields, LAYOUT, 'viewLayout') ? { layout: LAYOUT } : {}) }, words: {} },
};
