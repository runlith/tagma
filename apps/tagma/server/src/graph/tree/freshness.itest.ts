import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Effect, FileSystem } from 'effect';
import { twinWorld, twinWorldLayer } from '../testing/twins.js';
import { type FreshnessDrivers, ensureFreshMirror, readTree } from './freshness.js';
import { MirrorRefused } from './mirror.js';

const world = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const { base, shadow, sh } = yield* twinWorld();
  const tree = join(base, 'tree');
  yield* shadow.attach(tree, 'main');
  let stamp: string | null = null;
  const drivers: FreshnessDrivers<never, never> = {
    readStamp: Effect.sync(() => stamp),
    writeStamp: (sha) =>
      Effect.sync(() => {
        stamp = sha;
      }),
    unreflected: (changed) => Effect.succeed([...changed]),
    rebuild: Effect.void,
    repair: () => Effect.void,
  };
  return {
    base,
    sh,
    git,
    tree,
    shadow,
    drivers,
    file: (name: string, body: string) => fs.writeFileString(join(tree, `${name}.md`), body),
    reading: readTree(git, tree, drivers.readStamp),
    fresh: ensureFreshMirror(git, tree, drivers),
  };
});

layer(twinWorldLayer, { excludeTestServices: true })('sha-stamped freshness', (it) => {
  it.effect('an unstamped mirror rebuilds, a moved SHA repairs only its Unicode delta, and a lost stamp rebuilds again', () =>
    Effect.gen(function* () {
      const { tree, shadow, drivers, file, reading, fresh } = yield* world();
      yield* file('хорошо\nзакон', 'the original');
      yield* file('calm', 'untouched');
      const born = yield* shadow.commitAct(tree, 'create blocks');
      expect(yield* fresh).toBe('rebuilt');
      expect(yield* drivers.readStamp).toBe(born);
      expect(yield* fresh).toBe('fresh');
      yield* file('хорошо\nзакон', 'the amended');
      const head = yield* shadow.commitAct(tree, 'edit doctrine');
      expect(yield* reading).toMatchObject({
        head,
        stamped: born,
        changes: [{ status: 'M', path: 'хорошо\nзакон.md' }],
        dirty: [],
      });
      expect(yield* fresh).toBe('repaired');
      expect(yield* drivers.readStamp).toBe(head);
      expect(yield* fresh).toBe('fresh');
      expect(yield* ensureFreshMirror(yield* Git, tree, { ...drivers, readStamp: Effect.succeed(null) })).toBe('rebuilt');
      expect(yield* drivers.readStamp).toBe(head);
    }),
  );

  it.effect('unreflected dirty bytes stay due on every read, while an already reflected edit is fresh', () =>
    Effect.gen(function* () {
      const { git, tree, shadow, drivers, file, reading, fresh } = yield* world();
      yield* file('doctrine', 'the original');
      const head = yield* shadow.commitAct(tree, 'create doctrine');
      yield* fresh;
      yield* file('doctrine', 'edited by hand, uncommitted');
      expect(yield* reading).toMatchObject({
        head,
        stamped: head,
        changes: [{ status: 'M', path: 'doctrine.md' }],
        dirty: [{ status: 'M', path: 'doctrine.md' }],
      });
      expect(yield* fresh).toBe('repaired');
      expect(yield* fresh).toBe('repaired');
      const reflected = {
        ...drivers,
        unreflected: () => Effect.succeed([]),
        repair: () => Effect.die('already reflected bytes must not be ingested again'),
      };
      expect(yield* ensureFreshMirror(git, tree, reflected)).toBe('fresh');
      expect(yield* drivers.readStamp).toBe(head);
    }),
  );

  it.effect('a failed delta repair rebuilds before advancing its stamp and the next clean read is fresh', () =>
    Effect.gen(function* () {
      const { git, tree, shadow, drivers, file, fresh } = yield* world();
      yield* file('doctrine', 'the original');
      const born = yield* shadow.commitAct(tree, 'create doctrine');
      yield* fresh;
      yield* file('doctrine', 'the amended');
      const head = yield* shadow.commitAct(tree, 'edit doctrine');
      const refusal = new MirrorRefused({ reason: 'repair', message: 'the incremental repair cannot absorb this change' });
      const failing = { ...drivers, repair: () => Effect.fail(refusal) };
      expect(yield* ensureFreshMirror(git, tree, { ...failing, rebuild: Effect.fail(refusal) }).pipe(Effect.flip)).toBe(refusal);
      expect(yield* drivers.readStamp).toBe(born);
      expect(yield* ensureFreshMirror(git, tree, failing)).toBe('rebuilt');
      expect(yield* drivers.readStamp).toBe(head);
      expect(yield* fresh).toBe('fresh');
    }),
  );

  it.effect('a whole read follows the excludes file the repository config names, directly or through an include', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, sh, shadow, reading } = yield* world();
      const config = (...args: string[]) => sh(['--git-dir', shadow.gitDir, 'config', ...args]);
      const excludes = Effect.map(reading, (read) => read.rules?.files.at(-1));
      yield* config('core.excludesFile', join(base, 'first'));
      expect(yield* excludes).toBe(join(base, 'first'));
      yield* config('core.excludesFile', join(base, 'second'));
      expect(yield* excludes).toBe(join(base, 'second'));
      const included = join(base, 'included.config');
      yield* fs.writeFileString(included, `[core]\n\texcludesFile = ${join(base, 'third')}\n`);
      yield* config('--unset', 'core.excludesFile');
      yield* config('include.path', included);
      expect(yield* excludes).toBe(join(base, 'third'));
      yield* fs.writeFileString(included, `[core]\n\texcludesFile = ${join(base, 'fourth')}\n`);
      expect(yield* excludes).toBe(join(base, 'fourth'));
    }),
  );
});
