import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { view } from '../../../../catalogs/contract/wire/coreLibrary.js';
import { TagIndex } from '../../../../graph/vocabulary/tagIndex.js';
import { namingOf, type VocabularyRow } from '../../../../graph/vocabulary/identity.js';
import { localTypeId } from '../../../../graph/contract/wire/tags/identity.js';
import { SELECTION } from '../../../../graph/contract/wire/tags/selection.js';
import { blockName } from '../../../../graph/contract/wire/references.js';
import { GRAPH_BEHAVIOURS } from '../../../../graph/testing/behaviours.js';

const uuid = '01a03991-45fa-70d8-ac24-000000000005';
const id = localTypeId(uuid.replaceAll('-', ''));

function table(broken: boolean) {
  const catalogs: VocabularyRow[] = [
    { uuid: '01a03991-45fa-70d8-ac24-000000000006', fields: { id: 'base', profile: { defaults: [{ contract: SELECTION, type: id }] } } },
  ];
  if (broken)
    catalogs.push({
      uuid: '01a03991-45fa-70d8-ac24-000000000007',
      fields: { id: 'broken', profile: { defaults: [{ contract: SELECTION, type: 'moving-alias', override: true }] } },
    });
  const { naming } = namingOf([{ uuid, fields: { id: view.id } }], catalogs);
  return new TagIndex([{ name: blockName(uuid), declaration: view, unread: null }], GRAPH_BEHAVIOURS, [], naming);
}

it.effect('an unreadable stored profile refuses creation selection instead of exposing another catalog default', () =>
  Effect.gen(function* () {
    expect((yield* table(false).creationType(SELECTION)).id).toBe(view.id);
    const refused = yield* Effect.flip(table(true).creationType(SELECTION));
    expect(refused.code).toBe('creation-default-invalid');
  }),
);
