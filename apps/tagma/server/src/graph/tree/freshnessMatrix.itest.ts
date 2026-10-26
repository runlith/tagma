import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { Deferred, Effect, Exit, FileSystem, Layer } from 'effect';
import { twinWorld, twinWorldLayer } from '../testing/twins.js';
import { runGit } from '../../platform/git/ownGit.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';
import { watchProcessLayer } from '../../composition/testing/fileWatcher.js';
import { type FreshnessDrivers, type TreeChange, ensureFreshMirror, readTree } from './freshness.js';

const world = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* Git;
  const { base, shadow } = yield* twinWorld();
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
    fs,
    git,
    tree,
    shadow,
    drivers,
    file: (name: string, body: string) => fs.writeFileString(join(tree, name), body),
    reading: readTree(git, tree, drivers.readStamp),
    fresh: ensureFreshMirror(git, tree, drivers),
  };
});

layer(Layer.merge(twinWorldLayer, watchProcessLayer), { excludeTestServices: true })('what moves the mirror', (it) => {
  it.effect('non-block commits advance the stamp, while an untracked block stays due until committed', () =>
    Effect.gen(function* () {
      const { tree, shadow, drivers, file, reading, fresh } = yield* world();
      yield* file('doc.md', 'the original');
      yield* shadow.commitAct(tree, 'one block');
      yield* fresh;
      yield* file('notes.txt', 'not a block\n');
      const head = yield* shadow.commitAct(tree, 'plain notes');
      expect((yield* reading).changes).toEqual([]);
      expect(yield* fresh).toBe('fresh');
      expect(yield* drivers.readStamp).toBe(head);
      yield* file('newcomer.md', 'an untracked block');
      expect((yield* reading).changes).toEqual([{ status: 'A', path: 'newcomer.md' }]);
      expect(yield* fresh).toBe('repaired');
      expect(yield* fresh).toBe('repaired');
      expect(yield* drivers.readStamp).toBe(head);
      const committed = yield* shadow.commitAct(tree, 'commit newcomer');
      expect(yield* fresh).toBe('repaired');
      expect(yield* drivers.readStamp).toBe(committed);
      expect(yield* fresh).toBe('fresh');
    }),
  );

  it.effect('a committed addition and deletion combine with an uncommitted edit relative to the same HEAD', () =>
    Effect.gen(function* () {
      const { fs, tree, shadow, drivers, file, reading, fresh } = yield* world();
      yield* file('stays.md', 'the original');
      yield* file('leaves.md', 'the departing block');
      const born = yield* shadow.commitAct(tree, 'both blocks');
      yield* fresh;
      yield* fs.remove(join(tree, 'leaves.md'));
      yield* file('arrival.md', 'the arriving block');
      const head = yield* shadow.commitAct(tree, 'replace a block');
      yield* file('stays.md', 'uncommitted edit');
      const seen = yield* reading;
      expect({ ...seen, changes: seen.changes?.toSorted((a, b) => a.path.localeCompare(b.path)) }).toMatchObject({
        head,
        stamped: born,
        changes: [
          { status: 'A', path: 'arrival.md' },
          { status: 'D', path: 'leaves.md' },
          { status: 'M', path: 'stays.md' },
        ],
        dirty: [{ status: 'M', path: 'stays.md' }],
      });
      expect(yield* fresh).toBe('repaired');
      expect(yield* drivers.readStamp).toBe(head);
    }),
  );

  it.effect('a named reading rereads only its paths and keeps the rest of the reading it follows', () =>
    Effect.gen(function* () {
      const { git, tree, shadow, drivers, file, reading } = yield* world();
      yield* file('kept.md', 'the original');
      yield* file('edited.md', 'the original');
      yield* shadow.commitAct(tree, 'two blocks');
      yield* file('kept.md', 'an edit nobody names');
      const whole = yield* reading;
      yield* file('edited.md', 'a named edit');
      yield* file('born.md', 'a named arrival');
      yield* file('kept.md', 'the original');
      const named = yield* readTree(git, tree, drivers.readStamp, {
        since: whole,
        paths: new Set(['edited.md', 'born.md']),
        staged: false,
      });
      expect(named.dirty.map((change) => `${change.status} ${change.path}`).toSorted()).toEqual(['A born.md', 'M edited.md', 'M kept.md']);
      const reverted = yield* readTree(git, tree, drivers.readStamp, { since: named, paths: new Set(['kept.md']), staged: false });
      expect(reverted.dirty.map((change) => change.path).toSorted()).toEqual(['born.md', 'edited.md']);
    }),
  );

  it.effect('a changed ignore rule inside or outside the tree makes a named reading read the whole tree', () =>
    Effect.gen(function* () {
      const { fs, git, tree, shadow, drivers, file, reading } = yield* world();
      yield* file('doc.md', 'the original');
      yield* shadow.commitAct(tree, 'one block');
      const info = join(yield* runGit(git, 'test-common', ['-C', tree, 'rev-parse', '--path-format=absolute', '--git-common-dir']), 'info');
      yield* fs.makeDirectory(info, { recursive: true });
      yield* fs.writeFileString(join(info, 'exclude'), 'draft.md\n');
      yield* file('draft.md', 'an untracked draft');
      const excluded = yield* reading;
      expect(excluded.dirty).toEqual([]);
      yield* fs.writeFileString(join(info, 'exclude'), '');
      const whole = yield* readTree(git, tree, drivers.readStamp, { since: excluded, paths: new Set(['doc.md']), staged: false });
      expect(whole.dirty).toEqual([{ status: 'A', path: 'draft.md' }]);
      yield* file('.gitignore', 'draft.md\n');
      const ignored = yield* readTree(git, tree, drivers.readStamp, { since: whole, paths: new Set(['.gitignore']), staged: false });
      expect(ignored.dirty).toEqual([{ status: 'A', path: '.gitignore' }]);
    }),
  );

  it.effect('a moved HEAD, and on request the index, reread the paths they touched without reading the whole tree', () =>
    Effect.gen(function* () {
      const { git, tree, shadow, drivers, file, reading } = yield* world();
      const run = (...args: string[]) => runGit(git, 'test-index', ['-C', tree, ...args]);
      yield* file('moved.md', 'one');
      yield* file('kept.md', 'kept');
      const first = yield* shadow.commitAct(tree, 'first');
      if (first === null) return yield* Effect.die('the first commit was not made');
      yield* file('moved.md', 'two');
      yield* shadow.commitAct(tree, 'second');
      const settled = yield* reading;
      yield* run('reset', '-q', '--mixed', first);
      yield* file('late.md', 'untracked and never named');
      const reset = yield* readTree(git, tree, drivers.readStamp, { since: settled, paths: new Set(['other.md']), staged: false });
      expect(reset.dirty).toEqual([{ status: 'M', path: 'moved.md' }]);
      yield* run('rm', '-q', '--cached', 'kept.md');
      const unstaged = yield* readTree(git, tree, drivers.readStamp, { since: reset, paths: new Set(['other.md']), staged: false });
      expect(unstaged.dirty.map((change) => change.path)).toEqual(['moved.md']);
      const staged = yield* readTree(git, tree, drivers.readStamp, { since: reset, paths: new Set(['other.md']), staged: true });
      expect(staged.dirty.map((change) => change.path).toSorted()).toEqual(['kept.md', 'moved.md']);
    }),
  );

  it.effect('a cold reading over what the watcher saw since its mark, the old dirty set and the index equals a whole status', () =>
    Effect.gen(function* () {
      const { fs, git, tree, shadow, drivers, file, reading } = yield* world();
      const watcher = yield* FileWatcher;
      yield* file('edited.md', 'one');
      yield* file('removed.md', 'leaves while the server is away');
      yield* file('kept.md', 'leaves the index only');
      yield* shadow.commitAct(tree, 'three blocks');
      yield* file('dirty.md', 'untracked before the mark');
      const heard = new Set<string>();
      const arrived = yield* Deferred.make<void>();
      const awaited = ['born.md', 'removed.md', 'dirty.md'];
      yield* Effect.acquireRelease(
        watcher.subscribe(
          tree,
          { recursive: true, ignore: [] },
          {
            heard: (changes) => {
              for (const change of changes) heard.add(change.path);
              if (awaited.every((path) => heard.has(path))) Deferred.doneUnsafe(arrived, Exit.void);
            },
            dropped: () => undefined,
            ended: () => undefined,
          },
        ),
        (subscription) => subscription.close,
      );
      const position = yield* watcher.mark(tree, `${tree}.watch-0`, [], false);
      const basis = yield* reading;
      yield* file('edited.md', 'two');
      yield* shadow.commitAct(tree, 'moved on');
      yield* file('born.md', 'arrives while the server is away');
      yield* fs.remove(join(tree, 'removed.md'));
      yield* runGit(git, 'test-index', ['-C', tree, 'rm', '-q', '--cached', 'kept.md']);
      yield* file('dirty.md', 'changed while the server is away');
      yield* Deferred.await(arrived);
      const changed = yield* watcher.changedSince(tree, position, []);
      if (changed === null) return yield* Effect.die('the watcher could not vouch for its own mark');
      const statuses: (readonly string[])[] = [];
      const recorded: Git['Service'] = {
        ...git,
        run: (args, options) =>
          Effect.suspend(() => {
            if (args.includes('--porcelain=v2')) statuses.push(args);
            return git.run(args, options);
          }),
      };
      const paths = new Set([...changed.map((change) => change.path), ...basis.dirty.map((change) => change.path)]);
      const cold = yield* readTree(recorded, tree, drivers.readStamp, { since: basis, paths, staged: true });
      const whole = yield* reading;
      const sorted = (dirty: readonly TreeChange[]) => dirty.map((change) => `${change.status} ${change.path}`).toSorted();
      expect(statuses.some((args) => args[args.length - 1] === '.')).toBe(false);
      expect(sorted(cold.dirty)).toEqual(sorted(whole.dirty));
      expect(sorted(whole.dirty)).toEqual(['A born.md', 'D kept.md', 'D removed.md', 'M dirty.md']);
    }),
  );

  it.effect('an unknown stamped SHA rebuilds and is replaced by the real HEAD before the next read', () =>
    Effect.gen(function* () {
      const { tree, shadow, drivers, file, reading, fresh } = yield* world();
      yield* file('doc.md', 'the original');
      const head = yield* shadow.commitAct(tree, 'one block');
      const unknown = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      yield* drivers.writeStamp(unknown);
      expect(yield* reading).toMatchObject({ head, stamped: unknown, changes: null, dirty: [] });
      expect(yield* fresh).toBe('rebuilt');
      expect(yield* drivers.readStamp).toBe(head);
      expect(yield* fresh).toBe('fresh');
    }),
  );
});
