import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Git } from '@runlith/git/Git';
import { eq } from 'drizzle-orm';
import { Context, Deferred, Effect, FileSystem, Layer, Schedule, Schema } from 'effect';
import { endHosts } from '../../executions/testing/doubles.js';
import { type CreationStep, PROJECT_CREATION } from '../../graph/contract/service/creation.js';
import { type ExchangeHost, GraphExchange } from '../../graph/contract/service/exchange.js';
import { readSides, relate } from '../../graph/storage/tracking.js';
import { block } from '../../graph/store/tables.js';
import { manifest } from '../../platform/contract/service/manifest.js';
import { GraphStore } from '../../platform/contract/service/store.js';
import { runGit } from '../../platform/git/ownGit.js';
import { serverParts } from '../build.js';
import { CORE_MODULES } from '../core.js';
import { PARTS } from '../developer/parts.js';
import { assemble } from '../manifest.js';
import { servedAssembly } from './assembled.js';

const TRACKING = 'refs/remotes/sync';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'operator',
  GIT_AUTHOR_EMAIL: 'operator@test',
  GIT_COMMITTER_NAME: 'operator',
  GIT_COMMITTER_EMAIL: 'operator@test',
};

class Sync extends Context.Service<
  Sync,
  {
    readonly from: Map<number, string>;
    readonly commits: Map<number, number>;
    readonly host: Effect.Effect<ExchangeHost>;
  }
>()('testing/Sync') {}

const sync = manifest({
  id: 'sync',
  title: 'Sync',
  contributions: PROJECT_CREATION.of({
    id: 'sync-from',
    value: Schema.String,
    step: Effect.fnUntraced(function* (projectId: number, bare: string) {
      (yield* Sync).from.set(projectId, bare);
    }),
  } satisfies CreationStep<string>),
  lifetimes: {
    installation: Layer.effectContext(
      Effect.gen(function* () {
        const git = yield* Git;
        const from = new Map<number, string>();
        const commits = new Map<number, number>();
        const host = Deferred.makeUnsafe<ExchangeHost>();
        const birth = (bare: string) =>
          Effect.fnUntraced(function* (draft: string) {
            yield* runGit(git, 'sync-birth', ['--git-dir', draft, 'fetch', '--quiet', bare, '+refs/heads/*:refs/heads/*']);
            return (yield* runGit(git, 'sync-heads', ['--git-dir', draft, 'for-each-ref', 'refs/heads'])) !== '';
          });
        return Context.make(Sync, { from, commits, host: Deferred.await(host) }).pipe(
          Context.add(GraphExchange, (given: ExchangeHost) =>
            Effect.sync(() => {
              Deferred.doneUnsafe(host, Effect.succeed(given));
              return {
                side: (projectId: number) => {
                  const bare = from.get(projectId);
                  return { birth: bare === undefined ? null : birth(bare), tracking: TRACKING };
                },
                opened: () => undefined,
                committed: (projectId: number) => {
                  commits.set(projectId, (commits.get(projectId) ?? 0) + 1);
                },
              };
            }),
          ),
        );
      }),
    ),
  },
});

class World extends Context.Service<
  World,
  {
    readonly op: (id: string, input: unknown, project?: number) => Effect.Effect<{ readonly status: number; readonly body: unknown }>;
    readonly checkout: (label: string) => Effect.Effect<string>;
    readonly sync: Sync['Service'];
    readonly titleIn: (projectId: number, cwd: string, title: string) => Effect.Effect<boolean>;
    readonly home: string;
    readonly git: Git['Service'];
  }
>()('testing/ExchangeWorld') {}

const world = Layer.effect(
  World,
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'exchange-' }));
    yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
    const parts = serverParts({ ...PARTS, modules: [...CORE_MODULES, sync] });
    const { runtime, request } = yield* servedAssembly(home, yield* Effect.promise(() => assemble(parts)));
    const git = Context.get(runtime.owners, Git);
    return World.of({
      op: (id, input, project) => request(`/api/op/${id}${project === undefined ? '' : `?project=${project}`}`, input),
      checkout: Effect.fnUntraced(function* (label: string) {
        const path = join(home, label);
        yield* Effect.orDie(files.makeDirectory(path));
        yield* Effect.orDie(runGit(git, 'test', ['init', '-q', '-b', 'main', path]));
        yield* Effect.orDie(files.writeFileString(join(path, 'README.md'), label));
        yield* Effect.orDie(runGit(git, 'test', ['-C', path, 'add', '-A']));
        yield* Effect.orDie(runGit(git, 'test', ['-C', path, 'commit', '-q', '-m', label], { env: IDENTITY }));
        return path;
      }),
      sync: Context.getUnsafe(runtime.owners, Sync),
      titleIn: (projectId, cwd, title) =>
        Effect.orDie(
          Effect.gen(function* () {
            const served = yield* runtime.pool.resolve({ projectId, cwd });
            yield* served.fresh();
            const found = yield* Context.get(served.context, GraphStore).db.select().from(block).where(eq(block.title, title));
            return found.length > 0;
          }),
        ),
      home,
      git,
    });
  }),
).pipe(Layer.provide(BunFileSystem.layer));

layer(world, { excludeTestServices: true })('a filler of the graph exchange port', (it) => {
  it.effect('births a graph from a bare repository, is woken after commits, and its tracking refs move and seed trees', () =>
    Effect.gen(function* () {
      const { op, checkout, sync, titleIn, home, git } = yield* World;
      const gitDirOf = (projectId: number) => join(home, 'graphs', String(projectId), 'graph.git');
      const idOf = (answer: { readonly body: unknown }) => (answer.body as { project: { id: number } }).project.id;
      const committed = Effect.fnUntraced(function* (projectId: number, title: string) {
        const roots = yield* op('list_root_blocks', {}, projectId);
        const parentId = (roots.body as { blocks: { name: string }[] }).blocks[0]!.name;
        const before = sync.commits.get(projectId) ?? 0;
        expect((yield* op('create_block', { tags: ['idea'], title, parentId }, projectId)).status).toBe(200);
        yield* Effect.sync(() => sync.commits.get(projectId) ?? 0).pipe(
          Effect.repeat({ schedule: Schedule.spaced('20 millis'), until: (count) => count > before }),
        );
      });
      const pushed = (projectId: number, bare: string, branch: string) =>
        Effect.orDie(runGit(git, 'test', ['--git-dir', gitDirOf(projectId), 'push', '--quiet', bare, `main:refs/heads/${branch}`]));

      const bare = join(home, 'shared.git');
      yield* Effect.orDie(runGit(git, 'test', ['init', '-q', '--bare', bare]));
      const sourceRoot = yield* checkout('source');
      const source = idOf(yield* op('add_project', { name: 'source', rootPath: sourceRoot, storage: 'stealth' }));
      yield* committed(source, 'Seeded');
      yield* pushed(source, bare, 'main');

      const takerRoot = yield* checkout('taker');
      const born = yield* op('add_project', { name: 'taker', rootPath: takerRoot, storage: 'stealth', contributed: { 'sync-from': bare } });
      expect(born.status).toBe(200);
      const taker = idOf(born);
      expect(yield* titleIn(taker, takerRoot, 'Seeded')).toBe(true);

      yield* committed(source, 'Later');
      yield* pushed(source, bare, 'main');
      yield* committed(source, 'Featured');
      yield* pushed(source, bare, 'feature');
      const takerGit = gitDirOf(taker);
      yield* Effect.orDie(runGit(git, 'test', ['--git-dir', takerGit, 'fetch', '--quiet', bare, `+refs/heads/*:${TRACKING}/*`]));
      const host = yield* sync.host;
      const sides = yield* Effect.orDie(readSides(git, takerGit, TRACKING));
      expect(yield* Effect.orDie(host.gitDir(taker))).toBe(takerGit);
      const relation = yield* Effect.orDie(relate(git, takerGit, sides));
      if (yield* Effect.orDie(host.follow(takerGit, relation))) yield* Effect.orDie(host.moved(takerGit));
      expect(yield* titleIn(taker, takerRoot, 'Later')).toBe(true);
      expect(yield* titleIn(taker, takerRoot, 'Featured')).toBe(false);

      const feature = join(dirname(takerRoot), 'taker-feature');
      yield* Effect.orDie(runGit(git, 'test', ['-C', takerRoot, 'worktree', 'add', '-q', '-b', 'feature', feature, 'main']));
      expect(yield* titleIn(taker, feature, 'Featured')).toBe(true);

      yield* committed(taker, 'Written here');
    }),
  );
});
