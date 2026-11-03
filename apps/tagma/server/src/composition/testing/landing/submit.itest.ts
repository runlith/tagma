import { layer } from '@runlith/effect-test';
import { Effect } from 'effect';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { FILE, MINE, THEIRS, checkoutFixture, withCheckout } from '../checkoutFixture.js';
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'the paths this session holds land in one commit, its declared task rides as a trailer, and the record reads as committed',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const body = '\n\nPreserve the detail.\n\nAnd the final paragraph.';
          const mine = [...FILE.slice(0, 4), 'const five = 6;'];
          yield* world.wrote(MINE, mine);
          writeFileSync(join(world.root, 'src', 'b.ts'), 'const b = 1;\n');
          yield* world.record(MINE, '', 'const b = 1;\n', { path: 'src/b.ts', origin: 'write' });
          const answer = yield* world.submit(MINE, { subject: `the work of one session (AB12CD34)${body}` });
          expect(answer.status).toBe('landed');
          if (answer.status !== 'landed') return;
          expect(answer.committed).toEqual(['src/a.ts', 'src/b.ts']);
          expect(answer.carried).toEqual([]);
          expect(yield* world.committed()).toEqual(mine);
          expect((yield* world.run(['log', '-1', '--format=%B'])).trimEnd()).toBe(
            `the work of one session (AB12CD34)${body}\n\nTask: ab12cd34 the work this commit answers\nCo-authored-by: Tagma <agent@tagma.dev>`,
          );
          const rows = yield* world.rows();
          expect(rows.every((row) => row.commit !== null && row.committedAt !== null)).toBe(true);
        })(),
      ),
  );
  it.effect(
    'paths selects named changed files whoever wrote them, leaves the other own files left by paths, accepts an absolute directory and names unmatched paths',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
          for (const [path, holder] of [
            ['src/b.ts', THEIRS],
            ['src/c.ts', MINE],
          ] as const) {
            writeFileSync(join(world.root, path), 'const value = 1;\n');
            yield* world.record(holder, '', 'const value = 1;\n', { path, origin: 'write' });
          }
          expect(yield* world.submit(MINE, { paths: ['lib/'] })).toEqual({ status: 'nothing', unmatched: ['lib/'] });
          const theirs = yield* world.submit(MINE, { paths: ['src/b.ts'] });
          expect(theirs.status).toBe('landed');
          if (theirs.status !== 'landed') return;
          expect(theirs.committed).toEqual(['src/b.ts']);
          expect(theirs.carried).toEqual([{ path: 'src/b.ts', holders: [THEIRS] }]);
          expect(theirs.unmatched).toBeUndefined();
          const named = yield* world.submit(MINE, { paths: ['src/a.ts', 'lib/'] });
          expect(named.status).toBe('landed');
          if (named.status !== 'landed') return;
          expect(named.committed).toEqual(['src/a.ts']);
          expect(named.unmatched).toEqual(['lib/']);
          expect(named.left).toEqual([{ path: 'src/c.ts', reason: 'paths' }]);
          const directory = yield* world.submit(MINE, { paths: [join(world.root, 'src')] });
          expect(directory.status).toBe('landed');
          if (directory.status !== 'landed') return;
          expect(directory.committed).toEqual(['src/c.ts']);
        })(),
      ),
  );
  it.effect('a session whose files another commit already carried answers nothing and names that commit', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        yield* world.wrote(MINE, [...FILE.slice(0, 4), 'const five = 5; // mine']);
        yield* world.run(['commit', '-qam', 'landed outside submit_work']);
        const head = yield* world.run(['rev-parse', 'HEAD']);
        expect(yield* world.submit(MINE)).toEqual({ status: 'nothing', commits: [head] });
        expect((yield* world.rows()).map((row) => row.commit)).toEqual([head]);
      })(),
    ),
  );
  it.effect('a path the session’s own command staged is brought level with its landing, while staging no record of it explains stays', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const moved = 'const b = 1;\n';
        writeFileSync(join(world.root, 'src', 'b.ts'), moved);
        yield* world.run(['add', '--', 'src/b.ts']);
        yield* world.record(MINE, '', moved, { path: 'src/b.ts', origin: 'write' });
        writeFileSync(join(world.root, 'src', 'b.ts'), 'const b = 2;\n');
        yield* world.record(MINE, moved, 'const b = 2;\n', { path: 'src/b.ts' });
        const mine = [...FILE.slice(0, 4), 'const five = 5; // mine'];
        writeFileSync(world.file, `${['const one = 1; // staged by someone', ...FILE.slice(1)].join('\n')}\n`);
        yield* world.run(['add', '--', 'src/a.ts']);
        writeFileSync(world.file, `${FILE.join('\n')}\n`);
        yield* world.wrote(MINE, mine);
        const answer = yield* world.submit(MINE);
        expect(answer.status).toBe('landed');
        if (answer.status !== 'landed') return;
        expect(answer.committed).toEqual(['src/a.ts', 'src/b.ts']);
        expect(yield* world.run(['status', '--porcelain', '--', 'src/b.ts'])).toBe('');
        expect(yield* world.run(['diff', '--cached', '--name-only'])).toBe('src/a.ts');
      })(),
    ),
  );
  it.effect('a session that holds no path of this checkout answers nothing, and no commit is made', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const before = yield* world.run(['rev-parse', 'HEAD']);
        expect(yield* world.submit('quiet-otter')).toEqual({ status: 'nothing' });
        expect(yield* world.run(['rev-parse', 'HEAD'])).toBe(before);
      })(),
    ),
  );
});
