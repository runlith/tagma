import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import { checkoutFixture, withCheckout } from '../checkoutFixture.js';

const ACTOR = 'nobody-actor';
const counted = 'export function total(rows: readonly number[]) {\n  return rows.length;\n}\n';
const declared = counted.replace('  return', '  const first = rows[0] ?? 0;\n  return');
const used = declared.replace('rows.length;', 'rows.length + first;');

layer(checkoutFixture, { excludeTestServices: true })('submit_work and lines nobody holds', (it) => {
  it.effect('a declaration nobody holds that the session’s edit uses refuses the landing until it is carried whole', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        yield* world.based({ 'total.ts': counted });
        writeFileSync(join(world.root, 'total.ts'), declared);
        yield* world.written(ACTOR, 'total.ts', used);
        const refused = yield* Effect.flip(world.submit(ACTOR, { subject: 'use the declaration nobody holds' }));
        expect(refused).toBeInstanceOf(GateRefusal);
        if (!(refused instanceof GateRefusal)) return;
        expect(refused.code).toBe('lines-held');
        expect(refused.reason).toContain('first in total.ts:2, held by nobody');
        expect(yield* world.head('total.ts')).toBe(counted);
        expect(yield* world.submit(ACTOR, { subject: 'carry the declaration', whole: ['total.ts'] })).toMatchObject({
          status: 'landed',
          committed: ['total.ts'],
        });
        expect(yield* world.head('total.ts')).toBe(used);
      }),
    ),
  );
});
