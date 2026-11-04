import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE, MINE, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('an ended session’s and a failed one’s lines ride along whole and both are named', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.namedAgent('old-owl', { name: 'old-owl', task: 'long done', ended: true });
        yield* world.namedAgent('lost-lynx', { name: 'lost-lynx', task: 'failed midway', failed: true });
        const retired = ['const one = 1; // retired', 'const two = 2; // retired', ...FILE.slice(2)];
        yield* world.wrote('old-owl', retired);
        const failed = [...retired.slice(0, 3), 'const four = 4; // failed', FILE[4] as string];
        yield* world.wrote('lost-lynx', failed);
        const mine = [...failed.slice(0, 2), 'const three = 3; // mine', failed[3] as string, 'const five = 5; // mine'];
        yield* world.wrote(MINE, mine);
        expect(yield* world.submit(MINE)).toMatchObject({
          status: 'landed',
          carried: [{ path: 'src/a.ts', holders: ['old-owl', 'lost-lynx'] }],
        });
        expect(yield* world.committed()).toEqual(mine);
      })(),
    ),
  );
  it.effect('a file whose name stands on disk in another Unicode normalization lands edited, never as a deletion', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        writeFileSync(join(world.root, 'src', 'Jo\u0308.ts'), `${FILE.join('\n')}\n`);
        yield* world.run(['add', 'src']);
        yield* world.run(['commit', '-q', '-m', 'named']);
        const path = 'src/Jo\u0308.ts';
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine'], { path });
        expect((yield* world.submit(MINE, { paths: [path] })).status).toBe('landed');
        expect(yield* world.run(['status', '--porcelain'])).toBe('');
      })(),
    ),
  );
});
