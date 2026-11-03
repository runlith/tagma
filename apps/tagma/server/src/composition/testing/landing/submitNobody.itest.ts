import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { checkoutFixture, withCheckout } from '../checkoutFixture.js';

const ACTOR = 'nobody-actor';
const counted = 'export function total(rows: readonly number[]) {\n  return rows.length;\n}\n';
const declared = counted.replace('  return', '  const first = rows[0] ?? 0;\n  return');
const used = declared.replace('rows.length;', 'rows.length + first;');

layer(checkoutFixture, { excludeTestServices: true })('submit_work and lines nobody holds', (it) => {
  it.effect('a file holding a declaration no tool recorded lands whole with the session’s edit and is named unattributed', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        yield* world.based({ 'total.ts': counted });
        writeFileSync(join(world.root, 'total.ts'), declared);
        yield* world.written(ACTOR, 'total.ts', used);
        expect(yield* world.submit(ACTOR, { subject: 'use the declaration nobody holds' })).toMatchObject({
          status: 'landed',
          committed: ['total.ts'],
          carried: [],
          unattributed: ['total.ts'],
        });
        expect(yield* world.head('total.ts')).toBe(used);
      }),
    ),
  );
});
