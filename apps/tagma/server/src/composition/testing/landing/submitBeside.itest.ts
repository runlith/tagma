import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import { FILE, MINE, THEIRS, makeCheckout, CheckoutFixture, checkoutFixture, withCheckout } from '../checkoutFixture.js';
type World = Effect.Success<ReturnType<typeof makeCheckout>>;
const opened = Effect.fnUntraced(function* (world: World, conflict: boolean) {
  yield* world.run(['checkout', '-qb', 'incoming']);
  writeFileSync(join(world.root, 'src/incoming.ts'), 'const incoming = 1;\n');
  writeFileSync(join(world.root, 'src/extra.ts'), 'const extra = 1;\n');
  if (conflict) writeFileSync(world.file, `${['const one = 10;', ...FILE.slice(1)].join('\n')}\n`);
  yield* world.run(['add', '--', 'src']);
  yield* world.run(['commit', '-qm', 'incoming']);
  const tip = yield* world.run(['rev-parse', 'HEAD']);
  yield* world.run(['checkout', '-q', 'main']);
  if (conflict) {
    writeFileSync(world.file, `${['const one = 100;', ...FILE.slice(1)].join('\n')}\n`);
    yield* world.run(['commit', '-qam', 'local']);
  }
  const head = yield* world.run(['rev-parse', 'HEAD']);
  const before = readFileSync(world.file, 'utf8');
  const merge = world.run(['merge', '--no-commit', '--no-ff', 'incoming']);
  if (conflict) expect(yield* Effect.flip(merge)).toMatchObject({ _tag: 'OwnGitFailed', ran: true });
  else yield* merge;
  return { head, tip, before };
});
const unsettled = (world: World): Git['Service'] => ({
  run: (args, options) =>
    args.includes('reset') && args.includes('--pathspec-from-file=-')
      ? Effect.succeed({ status: 1, stdout: '', stderr: 'fatal: the index stayed unsettled', overflow: false, messageOverflow: false })
      : world.git.run(args, options),
});
layer(checkoutFixture, { excludeTestServices: true })('checkout', (it) => {
  it.effect(
    'a merge only a peer holds stays open beside a landing, and the peer concludes it over that landing even from an index left behind',
    () =>
      withCheckout((checkout) =>
        Effect.fnUntraced(function* () {
          const world = checkout;
          const { head, tip } = yield* opened(world, false);
          yield* world.record(THEIRS, '', 'const incoming = 1;\n', { path: 'src/incoming.ts', origin: 'write' });
          yield* world.wrote(MINE, ['const one = 11;', ...FILE.slice(1)]);
          yield* world.wrote(MINE, ['const extra = 1;', 'const mine = 2;'], { path: 'src/extra.ts' });
          const beside = yield* world.submit(MINE, { git: unsettled(world), paths: ['src/a.ts'] });
          expect(beside.status).toBe('landed');
          if (beside.status !== 'landed') return;
          expect(yield* world.run(['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${beside.commit} ${head}`);
          expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
          expect(yield* world.run(['ls-tree', '--name-only', 'HEAD', '--', 'src/incoming.ts'])).toBe('');
          expect(yield* world.run(['diff', '--cached', '--name-only', '--', 'src/a.ts'])).toBe('src/a.ts');
          const concluded = yield* world.submit(THEIRS);
          expect(concluded.status).toBe('landed');
          if (concluded.status !== 'landed') return;
          expect(yield* world.run(['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${concluded.commit} ${beside.commit} ${tip}`);
          expect(yield* world.committed()).toEqual(['const one = 11;', ...FILE.slice(1)]);
          expect(yield* world.run(['show', 'HEAD:src/incoming.ts'])).toBe('const incoming = 1;');
          expect(yield* world.run(['show', 'HEAD:src/extra.ts'])).toBe('const extra = 1;');
          expect(existsSync(join(world.root, '.git/MERGE_HEAD'))).toBe(false);
        })(),
      ),
  );
  it.effect('a landing beside a conflicted merge a peer holds leaves its conflicts standing for that peer', () =>
    withCheckout((checkout) =>
      Effect.fnUntraced(function* () {
        const world = checkout;
        const { head, tip, before } = yield* opened(world, true);
        yield* world.record(THEIRS, before, readFileSync(world.file, 'utf8'));
        writeFileSync(join(world.root, 'src/b.ts'), 'const b = 1;\n');
        yield* world.record(MINE, '', 'const b = 1;\n', { path: 'src/b.ts', origin: 'write' });
        const beside = yield* world.submit(MINE);
        expect(beside.status).toBe('landed');
        if (beside.status !== 'landed') return;
        expect(yield* world.run(['rev-list', '--parents', '-1', 'HEAD'])).toBe(`${beside.commit} ${head}`);
        expect(yield* world.run(['show', 'HEAD:src/b.ts'])).toBe('const b = 1;');
        expect(yield* world.run(['rev-parse', 'MERGE_HEAD'])).toBe(tip);
        expect(yield* world.run(['diff', '--name-only', '--diff-filter=U'])).toBe('src/a.ts');
        yield* world.run(['merge', '--abort']);
      })(),
    ),
  );
});
