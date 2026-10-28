import { Schema } from 'effect';
import { countedDebtSchema } from '../../../graph/contract/wire/enforcement.js';
import { blockRef } from '../../../graph/contract/wire/fields.js';
import { crowdedSchema } from '../../../graph/contract/wire/answers.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { insidePath, moduleOrderSchema, ROOT_FLOOR } from '../../../graph/contract/wire/modules.js';

const moduleId = Schema.NonEmptyString;

const workPath = insidePath.annotate({ description: 'A path from the repository root, as it stands in the working tree.' });

const moduleRef = Schema.Union([moduleId, Schema.Struct({ id: moduleId }), Schema.Struct({ block: blockRef })]);
export type ModuleRef = typeof moduleRef.Type;

const entryAt = Schema.Union([Schema.Literal(ROOT_FLOOR), insidePath]);

const entry = Schema.Struct({
  at: entryAt,
  for: Schema.optional(
    Schema.Array(moduleRef).check(Schema.isMinLength(1)).annotate({
      description:
        'The modules this entry is open to alone, each its id, `{ id }`, or the name of its card, `{ block }`; absent, every importer allowed.',
    }),
  ),
  role: Schema.optional(Schema.Literals(['port', 'testing']).annotate({ description: 'Absent, no special role.' })),
});
export type EntryAsk = typeof entry.Type;

export type ModuleChange<Item, Key> =
  | { readonly put?: readonly Item[]; readonly drop?: readonly Key[] }
  | { readonly replace: readonly Item[] };

const changing = <Item extends Schema.Top, Key extends Schema.Top>(
  item: Item,
  key: Key,
  what: { readonly put: string; readonly drop: string },
) =>
  Schema.Union([
    Schema.Struct({
      put: Schema.optional(Schema.Array(item).annotate({ description: what.put })),
      drop: Schema.optional(Schema.Array(key).annotate({ description: what.drop })),
    }),
    Schema.Struct({
      replace: Schema.Array(item).annotate({
        description: 'The whole collection after the change; the one choice when nothing standing should stay.',
      }),
    }),
  ]);

export const ModuleSet = Schema.Struct({
  id: moduleId.annotate({
    description: 'The module id: violations and debt are keyed by it. A new id creates a card unless `block` names the card it becomes.',
  }),
  block: Schema.optional(
    blockRef.annotate({ description: 'The #module card this write is about, when its id changes or it has none yet.' }),
  ),
  title: Schema.optional(Schema.NonEmptyString.annotate({ description: 'A new card: its title.' })),
  body: Schema.optional(
    Schema.String.annotate({ description: 'A new card: one paragraph, what the module is and why the product has it.' }),
  ),
  parent: Schema.optional(
    blockRef.annotate({
      description:
        'Where the card stands: the module card whose root holds its code, else its part — a page for one area of what the user gets — or the project root named explicitly. A new card names it; a standing one moves there.',
    }),
  ),
  remove: Schema.optional(
    Schema.Literal(true).annotate({ description: 'Delete the card; its relations and the relations to it go with it.' }),
  ),
  root: Schema.optional(workPath.annotate({ ...placeRole('value'), description: 'The one directory the module owns.' })),
  cuts: Schema.optional(
    changing(workPath, workPath, {
      put: 'Files to own besides the root.',
      drop: 'Files no longer owned; each must stand.',
    }).annotate({ description: 'Files outside the root the module owns besides it; absent, what stands.' }),
  ),
  entries: Schema.optional(
    changing(entry, entryAt, {
      put: 'Entries by `at`, each replacing the standing entry of that `at` whole and adding when none stands; `for` and `role` absent mean open to all and no role.',
      drop: 'The `at` of standing entries to remove; each must stand.',
    }).annotate({
      description:
        'What other modules may import, each `at` a path from the module root. `{ replace: [] }` closes the module; absent, what stands.',
    }),
  ),
  order: Schema.optional(
    Schema.NullOr(moduleOrderSchema).annotate({
      description: 'The floors inside the module, bottom first; null removes them. Absent, what stands.',
    }),
  ),
  imports: Schema.optional(
    changing(moduleRef, moduleRef, {
      put: 'Modules to import.',
      drop: 'Modules no longer imported; each must stand.',
    }).annotate({ description: 'The modules this one imports; absent, what stands.' }),
  ),
  importsTests: Schema.optional(
    changing(moduleRef, moduleRef, {
      put: 'Modules only this one’s test code imports.',
      drop: 'Modules no longer imported by its test code; each must stand.',
    }).annotate({ description: 'The modules only this one’s test code imports; absent, what stands.' }),
  ),
});
export type ModuleSet = typeof ModuleSet.Type;

export const ModuleRuleMeasure = Schema.Struct({
  rule: Schema.String,
  title: Schema.String,
  head: Schema.String,
  ms: Schema.Int,
  debt: Schema.Struct({ before: Schema.Int, after: Schema.Int }),
  absorbed: Schema.Array(countedDebtSchema),
  retired: Schema.Array(Schema.String),
  escaped: Schema.Array(Schema.String),
});

export const ModulesPlan = Schema.Struct({
  modules: Schema.Array(
    Schema.Struct({ id: Schema.String, card: Schema.NullOr(Schema.String), act: Schema.Literals(['create', 'update', 'remove']) }),
  ),
  rules: Schema.Array(ModuleRuleMeasure),
});
export type ModulesPlan = typeof ModulesPlan.Type;

export const ModulesSet = Schema.Struct({
  ...ModulesPlan.fields,
  graph: Schema.NullOr(Schema.String),
  crowded: Schema.optional(Schema.Array(crowdedSchema)),
});
export type ModulesSet = typeof ModulesSet.Type;
