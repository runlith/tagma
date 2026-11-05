import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { expect } from 'bun:test';
import { Effect, Exit, FiberSet, FileSystem, Layer, Queue, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { join } from 'node:path';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../composition/testing/graphFixture.js';
import { runGit } from '../../platform/git/ownGit.js';
import type { GraphCommitPolicy } from '../settings.js';
import { CHECKOUT_DIRECTORY, WORKFLOWS_DIRECTORY } from '../contract/wire/storage.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { syncGraph, treeCommits } from './commits.js';
import { commitJournal, startCommitJournals } from './message.js';

const BASE = 'the code and its graph';
const SYNCED = 'Sync graph files';
const AFTER_CODE = 60_000;
const IDLE = 600_000;
const fixtures = demoGraphLayer({
  projects: ['code'],
  prepareEffect: Effect.fnUntraced(function* (demo: EffectDemo) {
    const fs = yield* FileSystem.FileSystem;
    const base = demo.project('code').root;
    const treeRoot = join(base, CHECKOUT_DIRECTORY);
    yield* fs.makeDirectory(join(treeRoot, 'demo'), { recursive: true });
    yield* fs.makeDirectory(join(treeRoot, WORKFLOWS_DIRECTORY), { recursive: true });
    yield* fs.makeDirectory(join(base, 'src'), { recursive: true });
    yield* fs.writeFileString(join(base, 'src/a.ts'), 'export const a = 1;\n');
    yield* fs.writeFileString(join(treeRoot, 'demo/standing.md'), 'a block that already stands\n');
    yield* fs.writeFileString(join(treeRoot, WORKFLOWS_DIRECTORY, 'review.json'), '{}\n');
    const run = (args: readonly string[]) => runGit(demo.graph.git, 'test', ['-C', base, ...args]);
    yield* run(['init', '-q', '-b', 'main', '.']);
    yield* run(['add', '--', 'src', CHECKOUT_DIRECTORY]);
    yield* run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', BASE]);
  }),
}).pipe(Layer.provideMerge(BunFileSystem.layer));

const checkout = Effect.fnUntraced(function* (demo: EffectDemo) {
  const fs = yield* FileSystem.FileSystem;
  const base = demo.project('code').root;
  const treeRoot = join(base, CHECKOUT_DIRECTORY);
  const git = demo.graph.git;
  const run = (args: readonly string[]) => runGit(git, 'test', ['-C', base, ...args]);
  const committed = yield* Queue.unbounded<void>();
  const refused = yield* Queue.unbounded<void>();
  let refusing: ((args: readonly string[]) => boolean) | undefined;
  const observed = Git.of({
    run: (args, options) =>
      refusing?.(args) === true
        ? Effect.andThen(
            Effect.sync(() => {
              refusing = undefined;
            }),
            Effect.as(Queue.offer(refused, undefined), {
              status: 1,
              stdout: '',
              stderr: 'fatal: the index could not be read',
              overflow: false,
              messageOverflow: false,
            }),
          )
        : git
            .run(args, options)
            .pipe(
              Effect.tap((answer) =>
                answer.status === 0 && args.includes('update-ref') && args.includes('tagma landing graph batch')
                  ? Queue.offer(committed, undefined)
                  : Effect.void,
              ),
            ),
  });
  const scope = yield* Scope.fork(yield* Effect.scope);
  yield* demo.fixture.producer('committer', Scope.close(scope, Exit.void));
  const fork = yield* Scope.provide(FiberSet.makeRuntime<never, void, never>(), scope);
  let policy: GraphCommitPolicy = 'auto';
  const chosen = Effect.suspend(() => Effect.succeed(policy));
  yield* startCommitJournals(demo.graph.graphStore);
  const journal = commitJournal({
    store: demo.graph.graphStore,
    tags: demo.graph.tags,
    identity: testSessionIdentity,
    projectId: demo.projectId,
    scope: 'team',
  });
  const opened = () =>
    treeCommits({
      git: observed,
      checkout: base,
      treeRoot,
      journal,
      permit: (effect) => effect,
      policy: chosen,
      fork,
    });
  const commits = opened();
  const subjects = Effect.map(run(['log', '--format=%s']), (text) => text.split('\n'));
  return {
    base,
    treeRoot,
    run,
    scope,
    commits,
    opened,
    journal,
    subjects,
    sync: () => syncGraph({ commits, policy: chosen }),
    answers: (value: GraphCommitPolicy) => {
      policy = value;
    },
    wrote: (name: string, body: string) => fs.writeFileString(join(treeRoot, 'demo', name), body),
    landed: Effect.andThen(Queue.take(committed), subjects),
    refuse: (matching: (args: readonly string[]) => boolean) => {
      refusing = matching;
      return Queue.take(refused);
    },
    graphStatus: (path: string = CHECKOUT_DIRECTORY) =>
      Effect.map(run(['status', '--porcelain', '--', path]), (text) => text.split('\n').filter(Boolean).sort()),
  };
});

const withCheckout = <A, E, R>(body: (world: Effect.Success<ReturnType<typeof checkout>>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => Effect.flatMap(checkout(demo), body));

const withClock = <A, E, R>(body: (world: Effect.Success<ReturnType<typeof checkout>>) => Effect.Effect<A, E, R>) =>
  withDemo((demo) => Effect.provide(Effect.flatMap(checkout(demo), body), TestClock.layer()));

layer(fixtures, { excludeTestServices: true })('the tree committer', (it) => {
  it.effect('commits only block files, preserves staged and unstaged code, and bypasses checkout hooks', () =>
    withCheckout((w) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const hooks = join(w.base, '.git/hooks');
        const heard = join(w.base, 'heard');
        yield* fs.makeDirectory(hooks, { recursive: true });
        for (const hook of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
          const path = join(hooks, hook);
          yield* fs.writeFileString(path, `#!/bin/sh\necho ${hook} >> '${heard}'\n`);
          yield* fs.chmod(path, 0o755);
        }
        yield* fs.writeFileString(join(w.base, 'src/a.ts'), 'export const a = 2;\n');
        yield* w.run(['add', '--', 'src/a.ts']);
        yield* fs.writeFileString(join(w.base, 'src/a.ts'), 'export const a = 2;\nexport const b = 3;\n');
        yield* fs.writeFileString(join(w.treeRoot, WORKFLOWS_DIRECTORY, 'review.json'), '{"mode":"run"}\n');
        yield* w.wrote('standing.md', 'the block, rewritten\n');
        yield* w.wrote('born.md', 'a block that did not exist\n');
        yield* fs.writeFileString(join(w.treeRoot, '.watch-cookie-4242-7'), '');
        expect(yield* w.commits.commit).toMatchObject({ kind: 'committed', files: 2 });
        expect(yield* w.run(['log', '-1', '--format=%an <%ae>|%cn <%ce>|%s'])).toBe(
          'Tagma <agent@tagma.dev>|Tagma <agent@tagma.dev>|Sync graph files',
        );
        expect((yield* w.run(['show', '--name-only', '--format=', 'HEAD'])).split('\n').sort()).toEqual([
          `${CHECKOUT_DIRECTORY}/demo/born.md`,
          `${CHECKOUT_DIRECTORY}/demo/standing.md`,
        ]);
        expect((yield* w.run(['status', '--porcelain'])).split('\n').sort()).toEqual([
          ' M .tagma/workflows/review.json',
          '?? .tagma/.watch-cookie-4242-7',
          'MM src/a.ts',
        ]);
        expect(yield* w.run(['show', 'HEAD:src/a.ts'])).toBe('export const a = 1;');
        expect(yield* fs.exists(heard)).toBe(false);
      }),
    ),
  );

  it.effect('leaves a clean index untouched, settles stale graph entries and syncs a manual act just once', () =>
    withCheckout((w) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const index = join(w.base, '.git/index');
        const before = yield* fs.stat(index);
        const inode = yield* Effect.fromOption(before.ino);
        const mtime = yield* Effect.fromOption(before.mtime);
        yield* fs.utimes(join(w.treeRoot, 'demo/standing.md'), new Date(2_000_000_000_000), new Date(2_000_000_000_000));
        expect(yield* w.commits.commit).toEqual({ kind: 'clean' });
        const after = yield* fs.stat(index);
        expect([yield* Effect.fromOption(after.ino), yield* Effect.fromOption(after.mtime)]).toEqual([inode, mtime]);
        yield* w.wrote('standing.md', 'a stale graph snapshot\n');
        yield* w.run(['add', '--', `${CHECKOUT_DIRECTORY}/demo/standing.md`]);
        yield* w.wrote('standing.md', 'a block that already stands\n');
        yield* fs.writeFileString(join(w.base, 'src/a.ts'), 'export const a = 2;\n');
        yield* w.run(['add', '--', 'src/a.ts']);
        const head = yield* w.run(['rev-parse', 'HEAD']);
        expect(yield* w.sync()).toEqual({ commit: null, sessions: [], files: 0 });
        expect(yield* w.run(['rev-parse', 'HEAD'])).toBe(head);
        expect(yield* w.run(['diff', '--cached', '--name-only'])).toBe('src/a.ts');
        expect(yield* w.graphStatus()).toEqual([]);
        expect(yield* w.run(['show', ':src/a.ts'])).toBe('export const a = 2;');
        w.answers('manual');
        yield* w.wrote('born.md', 'an act nobody committed automatically\n');
        expect(yield* w.sync()).toEqual({ commit: expect.any(String), sessions: [], files: 1 });
        expect(yield* w.subjects).toHaveLength(2);
        expect(yield* w.sync()).toEqual({ commit: null, sessions: [], files: 0 });
      }),
    ),
  );

  it.effect('settles a block born under a foreign index lock when a later round commits another block', () =>
    withCheckout((w) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const lock = join(w.base, '.git/index.lock');
        yield* fs.writeFileString(lock, '');
        yield* w.wrote('born.md', 'born under another index lock\n');
        expect((yield* w.commits.commit).kind).toBe('committed');
        expect(yield* w.graphStatus()).toEqual(['?? .tagma/demo/born.md', 'D  .tagma/demo/born.md']);
        yield* fs.remove(lock);
        yield* w.wrote('later.md', 'the next act\n');
        expect(yield* w.commits.commit).toMatchObject({ kind: 'committed', files: 1 });
        expect(yield* w.graphStatus()).toEqual([]);
      }),
    ),
  );

  it.effect('retries failed settlement by itself and brings the index to HEAD without another act', () =>
    withClock((w) =>
      Effect.gen(function* () {
        const refusal = w.refuse((args) => args.includes('ls-tree') && args.includes('--full-tree'));
        yield* w.wrote('born.md', 'a block whose index entry was never written\n');
        yield* w.commits.carry([]);
        yield* TestClock.adjust(IDLE);
        yield* refusal;
        expect(yield* w.landed).toHaveLength(2);
        expect(yield* w.graphStatus(`${CHECKOUT_DIRECTORY}/demo/born.md`)).toEqual(['?? .tagma/demo/born.md', 'D  .tagma/demo/born.md']);
        yield* w.wrote('later.md', 'a block nobody acted on since\n');
        yield* TestClock.adjust(IDLE);
        expect(yield* w.landed).toHaveLength(3);
        expect(yield* w.graphStatus(`${CHECKOUT_DIRECTORY}/demo/born.md`)).toEqual([]);
      }),
    ),
  );

  it.effect('refuses off and non-team syncs, and holds detached HEAD and an operator merge without changing either', () =>
    withCheckout((w) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        expect(yield* Effect.flip(syncGraph({ commits: undefined, policy: Effect.succeed('auto') }))).toMatchObject({
          code: 'not-a-team-tree',
        });
        w.answers('off');
        yield* w.wrote('born.md', 'an act on no branch\n');
        expect(yield* Effect.flip(w.sync())).toMatchObject({ code: 'commit-off' });
        expect(yield* w.subjects).toEqual([BASE]);
        w.answers('auto');
        yield* w.run(['checkout', '-q', '--detach', 'HEAD']);
        expect(yield* w.commits.commit).toEqual({ kind: 'held', reason: 'detached' });
        expect(yield* Effect.flip(w.sync())).toMatchObject({ code: 'no-branch' });
        expect(yield* w.graphStatus()).toEqual(['?? .tagma/demo/born.md']);
        yield* w.run(['checkout', '-q', 'main']);
        yield* w.run(['checkout', '-q', '-b', 'other']);
        yield* w.wrote('standing.md', 'the other branch says this\n');
        yield* w.run(['add', '--', CHECKOUT_DIRECTORY]);
        yield* w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'other']);
        yield* w.run(['checkout', '-q', 'main']);
        yield* w.wrote('standing.md', 'and main says this\n');
        yield* w.run(['add', '--', CHECKOUT_DIRECTORY]);
        yield* w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'main']);
        expect(yield* Effect.result(w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'merge', 'other']))).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'OwnGitFailed' },
        });
        const head = yield* w.run(['rev-parse', 'HEAD']);
        const index = yield* fs.readFile(join(w.base, '.git/index'));
        expect(yield* fs.exists(join(w.base, '.git/MERGE_HEAD'))).toBe(true);
        yield* w.wrote('held.md', 'an act that landed mid-merge\n');
        expect(yield* w.commits.commit).toEqual({ kind: 'held', reason: 'merge' });
        expect(yield* Effect.flip(w.sync())).toMatchObject({ code: 'tree-mid-merge' });
        expect(yield* w.run(['rev-parse', 'HEAD'])).toBe(head);
        expect(yield* fs.readFile(join(w.base, '.git/index'))).toEqual(index);
      }),
    ),
  );

  it.effect(
    'commits a batch a minute after a code commit, ten minutes after its first act without one, and never sooner for its own commit',
    () =>
      withClock((w) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const head = Effect.flatMap(w.run(['rev-parse', 'HEAD']), w.commits.moved);
          yield* head;
          yield* w.wrote('born.md', 'an act no code commit follows\n');
          yield* w.commits.carry([]);
          yield* TestClock.adjust(IDLE - 1);
          expect(yield* w.subjects).toEqual([BASE]);
          yield* TestClock.adjust(1);
          expect(yield* w.landed).toEqual([SYNCED, BASE]);
          yield* head;
          yield* w.wrote('later.md', 'an act the graph commit before it does not hurry\n');
          yield* w.commits.carry([]);
          yield* TestClock.adjust(2 * AFTER_CODE);
          expect(yield* w.subjects).toEqual([SYNCED, BASE]);
          yield* fs.writeFileString(join(w.base, 'src/a.ts'), 'export const a = 2;\n');
          yield* w.run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'code', '--', 'src/a.ts']);
          yield* head;
          yield* TestClock.adjust(AFTER_CODE - 1);
          expect(yield* w.subjects).toEqual(['code', SYNCED, BASE]);
          yield* TestClock.adjust(1);
          expect(yield* w.landed).toEqual([SYNCED, 'code', SYNCED, BASE]);
        }),
      ),
  );

  it.effect('resumes auto after manual and off, then ends its fiber before the served graph is released', () =>
    withClock((w) =>
      Effect.gen(function* () {
        for (const answer of ['manual', 'off'] as const) {
          w.answers(answer);
          yield* w.wrote(`${answer}.md`, 'an act nobody committed\n');
          yield* w.commits.carry([]);
          yield* TestClock.adjust(IDLE);
          expect(yield* w.subjects).toEqual([BASE]);
        }
        w.answers('auto');
        yield* w.commits.carry([]);
        yield* TestClock.adjust(10_000);
        expect(yield* w.landed).toEqual([SYNCED, BASE]);
        expect((yield* w.run(['show', '--name-only', '--format=', 'HEAD'])).split('\n').sort()).toEqual([
          `${CHECKOUT_DIRECTORY}/demo/manual.md`,
          `${CHECKOUT_DIRECTORY}/demo/off.md`,
        ]);
        yield* w.wrote('born.md', 'an act whose graph was disposed\n');
        yield* w.commits.carry([]);
        yield* Scope.close(w.scope, Exit.void);
        yield* TestClock.adjust(IDLE);
        expect(yield* w.subjects).toEqual([SYNCED, BASE]);
        expect(yield* w.graphStatus()).toEqual(['?? .tagma/demo/born.md']);
      }),
    ),
  );

  it.effect('acts made before a reopening and a failed publication are named by the commit that lands them, once', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const w = yield* checkout(demo);
        const body = Effect.map(w.run(['log', '-1', '--format=%B']), (text) => text.trim().split('\n'));
        const first = yield* demo.graph.blocks.create({ projectId: demo.projectId, title: 'Before the reopening', parentId: demo.root });
        yield* w.wrote('born.md', 'the first act\n');
        yield* w.commits.carry([]);
        const reopened = w.opened();
        const refusal = w.refuse((args) => args.includes('fast-import'));
        expect((yield* Effect.flip(reopened.commit))._tag).toBe('OwnGitFailed');
        yield* refusal;
        const second = yield* demo.graph.blocks.create({ projectId: demo.projectId, title: 'After the failure', parentId: demo.root });
        yield* demo.graph.blocks.update({ id: first.id, body: 'edited twice' });
        yield* demo.graph.blocks.update({ id: first.id, body: 'edited three times' });
        expect(yield* reopened.commit).toMatchObject({ kind: 'committed' });
        const lines = yield* body;
        const name = (uuid: string) => lines.find((line) => line.includes(uuid.replaceAll('-', '').slice(-8)));
        expect([lines[0], name(first.uuid), name(second.uuid)]).toEqual([
          'Add 2 notes, edit note',
          expect.stringMatching(/^add [0-9a-f]{8} Before the reopening$/),
          expect.stringMatching(/^add [0-9a-f]{8} After the failure$/),
        ]);
        expect(lines.filter((line) => line.startsWith('edit '))).toHaveLength(1);
        expect(lines.at(-1)).toMatch(/^Tagma-Graph: [0-9]+$/);
        yield* w.wrote('later.md', 'a write no act made\n');
        expect(yield* reopened.commit).toMatchObject({ kind: 'committed' });
        expect((yield* body)[0]).toBe(SYNCED);
      }),
    ),
  );

  it.effect('a commit that landed before its position was written is not named again by the next one', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const w = yield* checkout(demo);
        yield* demo.graph.blocks.create({ projectId: demo.projectId, title: 'Landed once', parentId: demo.root });
        yield* w.wrote('born.md', 'the landed act\n');
        expect(yield* w.commits.commit).toMatchObject({ kind: 'committed' });
        const position = Number(yield* w.run(['log', '-1', '--format=%(trailers:key=Tagma-Graph,valueonly,separator=)']));
        yield* w.journal.committed(0);
        yield* w.journal.landing(position);
        yield* demo.graph.blocks.create({ projectId: demo.projectId, title: 'After the gap', parentId: demo.root });
        yield* w.wrote('later.md', 'the next act\n');
        expect(yield* w.opened().commit).toMatchObject({ kind: 'committed' });
        expect(yield* w.run(['log', '-1', '--format=%s'])).toBe('Add note "After the gap"');
      }),
    ),
  );

  it.effect('a carry from inside a unit lands after the unit ends', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const w = yield* checkout(demo);
        yield* w.wrote('born.md', 'an act whose unit closed before its batch settled\n');
        yield* demo.graph.graphStore.transaction('commits.itest.act', () => w.commits.carry([]));
        yield* TestClock.adjust(IDLE);
        expect(yield* w.landed).toEqual([SYNCED, BASE]);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );
});
