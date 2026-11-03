import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { FILE, MINE, THEIRS, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'two sessions editing separate places of one file land in the first one’s commit as read, and the second answers nothing naming it',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const theirs = [FILE[0] as string, 'const two = 2; // theirs', ...FILE.slice(2)];
          yield* world.wrote(THEIRS, theirs);
          const both = [...theirs.slice(0, 4), 'const five = 5; // mine'];
          yield* world.wrote(MINE, both);
          writeFileSync(join(world.root, 'src', 'c.ts'), 'const c = 1;\n');
          yield* world.run(['add', '--', 'src/c.ts']);
          const mine = yield* world.submit(MINE);
          expect(mine).toMatchObject({ status: 'landed', carried: [{ path: 'src/a.ts', holders: [THEIRS] }] });
          if (mine.status !== 'landed') return;
          expect(yield* world.run(['rev-parse', `${mine.commit}:src/a.ts`])).toBe(yield* world.run(['hash-object', 'src/a.ts']));
          expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/c.ts');
          expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/c.ts'])).toBe('');
          expect(yield* world.submit(THEIRS)).toMatchObject({ status: 'nothing', commits: [mine.commit] });
        })(),
      ),
  );
});
