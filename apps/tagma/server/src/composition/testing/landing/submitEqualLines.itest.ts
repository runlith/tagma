import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { runGitBytes } from '../../../platform/git/ownGit.js';
import { checkoutFixture, withCheckout, type CheckoutWorld } from '../checkoutFixture.js';

const FIRST = 'equal-first';
const SECOND = 'equal-second';
const THIRD = 'equal-third';

const entry = (name: string, ...keys: string[]) => [
  `    "./${name}": {`,
  ...keys.map((key, at) => `      "${key}": "./src/${name}.ts"${at + 1 < keys.length ? ',' : ''}`),
  '    },',
];
const block = (name: string, calls: number) => [
  `function ${name}() {`,
  ...Array.from({ length: calls }, (_, at) => `  ${name}${at}();`),
  '}',
];

const based = Effect.fnUntraced(function* (world: CheckoutWorld, path: string, lines: readonly string[]) {
  writeFileSync(join(world.root, path), `${lines.join('\n')}\n`);
  yield* world.run(['add', '--', path]);
  yield* world.run(['commit', '-qm', `base ${path}`]);
});

const landed = Effect.fnUntraced(function* (world: CheckoutWorld, path: string, order: readonly string[]) {
  for (const holder of order) expect(yield* world.submit(holder)).toMatchObject({ status: 'landed', committed: [path] });
  return yield* Effect.provide(runGitBytes(world.git, 'test', ['-C', world.root, 'show', `HEAD:${path}`]), world.context);
});
const textOf = (lines: readonly string[]) => `${lines.join('\n')}\n`;

layer(checkoutFixture, { excludeTestServices: true })('equal lines across landings', (it) => {
  it.effect('a landing slices exactly when earlier landings rebuilt HEAD from the same working file', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        const blocks = { n0: entry('n0', 'n00', 'n01', 'n02'), n1: entry('n1', 'n10'), n2: entry('n2', 'n20', 'n21') };
        const file = (...names: (keyof typeof blocks)[]) => ['{', '  "exports": {', ...names.flatMap((name) => blocks[name]), '  }', '}'];
        yield* based(world, 'exports.txt', file('n0', 'n1'));
        yield* world.wrote(FIRST, file('n1'), { path: 'exports.txt' });
        yield* world.wrote(SECOND, file('n2', 'n1'), { path: 'exports.txt' });
        yield* world.wrote(THIRD, file('n2'), { path: 'exports.txt' });
        expect(yield* landed(world, 'exports.txt', [THIRD, SECOND, FIRST])).toBe(textOf(file('n2')));
      })(),
    ),
  );

  it.effect('a landing slices exactly after earlier landings retired the peers written between its edits', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        const blocks = {
          n0: entry('n0', 'n00', 'n01', 'n02'),
          n1: entry('n1', 'n10'),
          n2: entry('n2', 'n20', 'n21'),
          n3: entry('n3', 'n30'),
          n4: entry('n4', 'n40', 'n41'),
          n5: entry('n5', 'n50', 'n51', 'n52'),
        };
        const file = (...names: (keyof typeof blocks)[]) => ['{', '  "exports": {', ...names.flatMap((name) => blocks[name]), '  }', '}'];
        yield* based(world, 'exports.txt', file('n0', 'n1', 'n2', 'n3'));
        yield* world.wrote(FIRST, file('n0', 'n1', 'n3'), { path: 'exports.txt' });
        yield* world.wrote(FIRST, file('n0', 'n1', 'n4', 'n3'), { path: 'exports.txt' });
        yield* world.wrote(SECOND, file('n0', 'n1', 'n4'), { path: 'exports.txt' });
        yield* world.wrote(THIRD, file('n0', 'n5', 'n1', 'n4'), { path: 'exports.txt' });
        expect(yield* landed(world, 'exports.txt', [THIRD, SECOND, FIRST])).toBe(textOf(file('n0', 'n5', 'n1', 'n4')));
      })(),
    ),
  );

  it.effect('a landing slices exactly when an earlier landing kept its removed lines and was written before it', () =>
    withCheckout((world) =>
      Effect.fnUntraced(function* () {
        const blocks = { n0: block('n0', 2), n1: block('n1', 1), n2: block('n2', 1), n3: block('n3', 1), n4: block('n4', 3) };
        const file = (...names: (keyof typeof blocks)[]) => names.flatMap((name) => blocks[name]);
        yield* based(world, 'blocks.txt', file('n0', 'n1'));
        yield* world.wrote(FIRST, file('n0', 'n1', 'n2'), { path: 'blocks.txt' });
        yield* world.wrote(SECOND, file('n1', 'n2'), { path: 'blocks.txt' });
        yield* world.wrote(SECOND, file('n3', 'n1', 'n2'), { path: 'blocks.txt' });
        yield* world.wrote(THIRD, file('n3', 'n4', 'n1', 'n2'), { path: 'blocks.txt' });
        yield* world.wrote(THIRD, file('n3', 'n4', 'n2'), { path: 'blocks.txt' });
        expect(yield* landed(world, 'blocks.txt', [FIRST, SECOND])).toBe(textOf(file('n3', 'n4', 'n2')));
      })(),
    ),
  );
});
