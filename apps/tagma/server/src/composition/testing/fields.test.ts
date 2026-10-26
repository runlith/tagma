import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Schema } from 'effect';
import { editOpSchema, updateOpSchema } from '../../graph/contract/wire/batch.js';
import { OPERATIONS } from '../catalog.js';

const cases: readonly (readonly [string, Schema.Codec<unknown, unknown>, unknown, boolean])[] = [
  ['update blank title', OPERATIONS.update_block.params, { blockId: '5940aab5', title: '   ' }, false],
  ['batch blank title', updateOpSchema, { op: 'update', id: '5940aab5', title: '   ' }, false],
  ['update title', OPERATIONS.update_block.params, { blockId: '5940aab5', title: 'a name' }, true],
  ['batch title', updateOpSchema, { op: 'update', id: '5940aab5', title: 'a name' }, true],
  ['edit empty anchor', OPERATIONS.edit_block.params, { blockId: '5940aab5', oldString: '', newString: 'x' }, false],
  ['batch empty anchor', editOpSchema, { op: 'edit', id: '5940aab5', old: '', new: 'x' }, false],
  ['create blank title', OPERATIONS.create_block.params, { tags: ['idea'], title: '  ' }, false],
  ['create title', OPERATIONS.create_block.params, { tags: ['idea'], title: 'a name' }, true],
];

it.effect.each(cases)('%s', (_name, schema, value, accepted) =>
  Effect.sync(() => {
    expect(Schema.decodeUnknownResult(schema)(value)._tag === 'Success').toBe(accepted);
  }),
);
