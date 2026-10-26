import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE, MINE, THEIRS, checkoutFixture, withCheckout } from '../checkoutFixture.js';

layer(checkoutFixture, { excludeTestServices: true })('programmatic files', (it) => {
  it.effect('submit_work carries a nested lockfile whole, while ordinary files and an explicit generated=false keep line ownership', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        const path = 'src/bun.lock';
        writeFileSync(join(world.root, path), `${FILE.join('\n')}\n`);
        yield* world.run(['add', '--', path]);
        yield* world.run(['commit', '-qm', 'a lockfile']);
        const theirs = [...FILE.slice(0, 3), 'const four = 40;', FILE[4]!];
        const both = [...theirs.slice(0, 4), 'const five = 50;'];
        for (const name of ['src/a.ts', path]) {
          yield* world.wrote(THEIRS, theirs, { path: name });
          yield* world.wrote(MINE, both, { path: name });
        }
        const partial = [...FILE.slice(0, 4), 'const five = 50;'];
        expect(yield* world.submit(MINE, { paths: ['src/a.ts'] })).toMatchObject({ status: 'landed', carried: [] });
        expect(yield* world.committed()).toEqual(partial);
        writeFileSync(join(world.root, 'src/.gitattributes'), 'bun.lock linguist-generated=false\n');
        expect(yield* world.submit(MINE, { paths: [path] })).toMatchObject({ status: 'landed', carried: [] });
        expect(yield* world.run(['show', `HEAD:${path}`])).toBe(partial.join('\n'));
        writeFileSync(join(world.root, 'src/.gitattributes'), '');
        const landed = yield* world.submit(MINE, { paths: [path] });
        expect(landed).toMatchObject({ status: 'landed', committed: [path], carried: [{ path, holders: [THEIRS] }] });
        expect(yield* world.run(['show', `HEAD:${path}`])).toBe(both.join('\n'));
        expect(yield* world.committed()).toEqual(partial);
      }),
    ),
  );

  it.effect('linguist-generated includes an otherwise ordinary file and carries the operator’s lines', () =>
    withCheckout((world) =>
      Effect.gen(function* () {
        writeFileSync(join(world.root, 'src/.gitattributes'), 'a.ts linguist-generated\n');
        const theirs = [...FILE.slice(0, 3), 'const four = 40;', FILE[4]!];
        const both = [...theirs.slice(0, 4), 'const five = 50;'];
        yield* world.wrote('operator', theirs);
        yield* world.wrote(MINE, both);
        expect(yield* world.submit(MINE)).toMatchObject({
          status: 'landed',
          carried: [{ path: 'src/a.ts', holders: ['operator'] }],
        });
        expect(yield* world.committed()).toEqual(both);
      }),
    ),
  );
});
