import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import type { Git } from '@runlith/git/Git';
import { FILE, MINE, THEIRS, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect('two sessions editing one file in separate hunks each land only their own, and nobody else’s staging moves', () =>
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
        expect(mine.status).toBe('landed');
        if (mine.status !== 'landed') return;
        expect(mine.carried).toEqual([]);
        expect(yield* world.committed()).toEqual([...FILE.slice(0, 4), 'const five = 5; // mine']);
        expect(readFileSync(world.file, 'utf8')).toBe(`${both.join('\n')}\n`);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts'])).toBe(' M src/a.ts');
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/c.ts');
        expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/c.ts'])).toBe('');
        const theirsLanded = yield* world.submit(THEIRS);
        expect(theirsLanded.status).toBe('landed');
        if (theirsLanded.status !== 'landed') return;
        expect(theirsLanded.carried).toEqual([]);
        expect(yield* world.committed()).toEqual(both);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/a.ts'])).toBe('');
      })(),
    ),
  );
  it.effect('an absolute whole selector carries one file intact while another selected file keeps line slicing', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        writeFileSync(join(world.root, 'src/b.ts'), `${FILE.join('\n')}\n`);
        yield* world.run(['add', 'src/b.ts']);
        yield* world.run(['commit', '-qm', 'another file']);
        const theirs = [...FILE.slice(0, 3), 'const four = 4; // theirs', FILE[4]!];
        const both = [...theirs.slice(0, 4), 'const five = 5; // mine'];
        for (const path of ['src/a.ts', 'src/b.ts']) {
          yield* world.wrote(THEIRS, theirs, { path });
          yield* world.wrote(MINE, both, { path });
        }
        const answer = yield* world.submit(MINE, { whole: [join(world.root, 'src/a.ts')] });
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.carried).toEqual([{ path: 'src/a.ts', holders: [THEIRS] }]);
        expect(yield* world.committed()).toEqual(both);
        expect(yield* world.run(['show', 'HEAD:src/b.ts'])).toBe([...FILE.slice(0, 4), 'const five = 5; // mine'].join('\n'));
        expect(readFileSync(join(world.root, 'src/b.ts'), 'utf8')).toBe(`${both.join('\n')}\n`);
      })(),
    ),
  );
  it.effect('no run of a taken session opens while its work lands, the landing session stays open, and the hold is gone after', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        writeFileSync(join(world.root, 'src', 'b.ts'), 'const b = 1;\n');
        yield* world.record(THEIRS, '', 'const b = 1;\n', { path: 'src/b.ts', origin: 'write' });
        const admitted: (readonly [boolean, boolean])[] = [];
        const watching: Git['Service'] = {
          run: (args, options) => {
            if (args.includes('commit-tree')) admitted.push([world.admission.admits(MINE), world.admission.admits(THEIRS)]);
            return world.git.run(args, options);
          },
        };
        const answer = yield* world.submit(MINE, { git: watching, taking: [{ threadId: THEIRS, label: THEIRS }] });
        expect(answer.status).toBe('landed');
        expect(admitted).toEqual([[true, false]]);
        expect(world.admission.admits(THEIRS)).toBe(true);
      })(),
    ),
  );
});
