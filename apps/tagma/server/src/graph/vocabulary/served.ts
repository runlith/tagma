import type { CatalogFinding } from '../contract/wire/tags/findings.js';
import type { InstalledCatalog } from '../contract/wire/tags/declaration.js';
import type { TagTable, Vocabulary } from '../contract/wire/tags/table.js';
import { fieldForm } from './declarationRules.js';

export const vocabularyOf = (
  table: TagTable,
  catalogs: readonly string[],
  installed: readonly InstalledCatalog[],
  findings: readonly CatalogFinding[],
): Vocabulary => {
  const tags = table.tags;
  return {
    catalogs,
    installed,
    findings,
    tags,
    revision: table.revision(),
    unreadable: table.unreadable,
    actions: Object.fromEntries(tags.map((tag) => [tag.id, table.actionsOf(tag.id)])),
    fieldNames: Object.fromEntries(
      tags.map((tag) => [tag.id, Object.fromEntries(Object.keys(tag.fields).map((field) => [field, table.fieldNameOf(tag.id, field)]))]),
    ),
    forms: Object.fromEntries(
      tags.flatMap((tag) =>
        Object.values(tag.fields).flatMap((type) =>
          typeof type === 'object' && type.type === 'schema' ? [[type.name, fieldForm(type.name)]] : [],
        ),
      ),
    ),
    laws: Object.fromEntries(
      tags.flatMap((tag) => {
        const law = table.lawProjectionOf(tag.id);
        return law === null ? [] : [[tag.id, law]];
      }),
    ),
  };
};
