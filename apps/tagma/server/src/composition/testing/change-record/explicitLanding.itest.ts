import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { MINE, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('explicit paths land nobody-attributed additions and deletions only within their selected directory', () =>
    withCheckout((checkout) =>
      Effect.gen(function* () {
        const world = checkout;
        writeFileSync(join(world.root, 'src/free.ts'), 'export const free = 1;\n');
        writeFileSync(join(world.root, 'outside.ts'), 'export const outside = 1;\n');
        rmSync(world.file);
        expect(yield* world.submit(MINE)).toMatchObject({ status: 'nothing' });
        const landed = yield* world.submit(MINE, { paths: ['src/'], whole: ['src/'] });
        expect(landed).toMatchObject({ status: 'landed', committed: ['src/a.ts', 'src/free.ts'], carried: [] });
        expect(yield* world.run(['show', 'HEAD:src/free.ts'])).toBe('export const free = 1;');
        expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/a.ts'])).toBe('');
        expect(yield* world.run(['status', '--porcelain'])).toBe('?? outside.ts');
      }),
    ),
  );
});
