import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
const base = `${FILE.join('\n')}\n`;
const edited = [...FILE.slice(0, 4), 'const five = 55;'];
const moved = Effect.fnUntraced(function* (world: Effect.Success<ReturnType<typeof makeCheckout>>) {
  mkdirSync(join(world.root, 'lib'));
  yield* world.run(['mv', '--', 'src/a.ts', 'lib/a.ts']);
  return world;
});
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('a staged move selected by its old path lands its unrecorded destination bytes when explicitly carried whole', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = yield* moved(checkout);
        yield* world.wrote(MINE, edited, { path: 'lib/a.ts' });
        const landed = yield* world.submit(MINE, { paths: ['src/a.ts'], whole: ['lib/a.ts'] });
        expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
        expect(yield* world.run(['show', 'HEAD:lib/a.ts'])).toBe(edited.join('\n'));
        expect(yield* world.run(['status', '--porcelain'])).toBe('');
      })(),
    ),
  );
  it.effect('a staged move another session holds lands with its source deletion when taken whole', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = yield* moved(checkout);
        yield* world.namedAgent(THEIRS, { name: THEIRS, task: 'their move' });
        yield* world.wrote(THEIRS, edited, { path: 'lib/a.ts' });
        const landed = yield* world.submit(MINE, { taking: [{ threadId: THEIRS, label: THEIRS }], whole: ['.'] });
        expect(landed).toMatchObject({ status: 'landed', committed: ['lib/a.ts', 'src/a.ts'] });
        expect(yield* world.run(['status', '--porcelain'])).toBe('');
      })(),
    ),
  );
  it.effect('a staged deletion only similar to the landed file stays out, and a recreated source is not deleted', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.run(['rm', '-q', '--', 'src/a.ts']);
        const text = `${edited.join('\n')}\n`;
        mkdirSync(join(world.root, 'src'), { recursive: true });
        writeFileSync(join(world.root, 'src', 'b.ts'), text);
        yield* world.record(MINE, '', text, { path: 'src/b.ts', origin: 'write' });
        yield* world.run(['add', '--', 'src/b.ts']);
        const similar = yield* world.submit(MINE);
        expect(similar).toMatchObject({ status: 'landed', committed: ['src/b.ts'] });
        expect(yield* world.run(['status', '--porcelain'])).toBe('D  src/a.ts');
        yield* world.run(['reset', '-q', '--', 'src/a.ts']);
        yield* world.run(['checkout', '--', 'src/a.ts']);
        mkdirSync(join(world.root, 'lib'));
        yield* world.run(['mv', '--', 'src/a.ts', 'lib/a.ts']);
        writeFileSync(join(world.root, 'src', 'a.ts'), 'export const again = 1;\n');
        yield* world.wrote(MINE, edited, { path: 'lib/a.ts' });
        const recreated = yield* world.submit(MINE, { paths: ['lib/a.ts'] });
        expect(recreated).toMatchObject({ status: 'landed', committed: ['lib/a.ts'] });
        expect(yield* world.run(['show', 'HEAD:src/a.ts'])).toBe(base.trimEnd());
      })(),
    ),
  );
});
