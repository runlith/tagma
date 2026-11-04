import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect, FileSystem, Layer, Option, Path } from 'effect';
import { NamespaceId } from '@runlith/files/namespace';
import { commitOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { type DemoState, demoGraphLayer, gitEffect, tempRepoEffect, withDemo } from '../../composition/testing/graphFixture.js';
import { checkoutPaths, coveredWorkspace, gitCheckoutReads } from '../testing/doubles.js';
import { CommitOverlay } from '../contract/service/checkouts.js';
import { makeCheckoutPathService } from './paths.js';
import { Coverage, FileRoots } from '../contract/service/roots.js';
import { Projects } from '../../projects/contract/service/registry.js';

const composed = Effect.fnUntraced(function* (demo: DemoState) {
  const git = yield* Git;
  const { coverage } = yield* coveredWorkspace({
    namespaceId: NamespaceId.make('test-checkout-reads'),
    projects: demo.graph.projects,
    git,
  });
  const placed = yield* checkoutPaths(coverage, demo.graph.projects);
  return { coverage, reads: yield* gitCheckoutReads(coverage, placed, yield* FileSystem.FileSystem, yield* Path.Path, git) };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'checkout reads',
  (it) => {
    it.effect('a read of a project nobody opened a terminal in takes its coverage and answers the canonical checkout', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { coverage, reads } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'read-');
          const project = (yield* demo.graph.projectLifecycle.create({ name: 'read-me', rootPath: checkout })).id;
          const before = yield* Effect.flip(coverage.covered(project));
          expect(before._tag === 'ProjectRootsUnavailable' && before.reason).toBe('unestablished');
          const place = yield* reads.placeOf({ projectId: project, cwd: undefined });
          expect(yield* files.realPath(place.path)).toBe(yield* files.realPath(checkout));
          expect((yield* coverage.covered(project)).roots.map((root) => root.origin)).toEqual(['canonical']);
        }),
      ),
    );

    it.effect('a commit says whether the thread overlay was applied, unavailable or unrequested', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const { reads } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'commit-marks-');
          const project = (yield* demo.graph.projectLifecycle.create({ name: 'commit-marks', rootPath: checkout })).id;
          const commit = yield* commitOf(yield* Git, checkout, 'HEAD');
          if (commit === null) return yield* Effect.die('the fixture commit was missing');
          const caller = { projectId: project, cwd: undefined };
          const asked = { commit, thread: 'writer' };
          const overlay = CommitOverlay.of({ pathsOf: () => Effect.succeed(new Set(['apps/x/seed'])) });
          expect((yield* reads.commit(caller, { commit })).marks).toBe('unrequested');
          const unavailable = yield* reads.commit(caller, asked);
          expect(unavailable.marks).toBe('unavailable');
          expect(unavailable.files.map((entry) => entry.path)).toEqual(['apps/x/seed']);
          const applied = yield* reads.commit(caller, asked, overlay);
          expect(applied.marks).toBe('applied');
          expect(applied.files.map((entry) => entry.path)).toEqual(['apps/x/seed']);
        }),
      ),
    );

    it.effect('a path found outside every checkout stays outside until the coverage changes, and then is placed', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { coverage } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'placed-');
          const later = yield* tempRepoEffect(demo.fixture, 'adopted-');
          const project = (yield* demo.graph.projectLifecycle.create({ name: 'place-me', rootPath: checkout })).id;
          const paths = yield* checkoutPaths(coverage, demo.graph.projects);
          const file = `${later}/src/a.ts`;
          expect(yield* paths.placeOf(project, file)).toBeNull();
          yield* coverage.adopt(project, later);
          const placed = yield* paths.placeOf(project, file);
          expect(placed?.path).toBe('src/a.ts');
          expect(yield* files.realPath(placed?.root ?? '')).toBe(yield* files.realPath(later));
          expect((yield* paths.placeAcross(file))?.projectId).toBe(project);
        }),
      ),
    );

    it.effect('membership rejects a removed worktree immediately but retains a missing root that git still administers', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const git = yield* Git;
          const checkout = yield* files.realPath(yield* tempRepoEffect(demo.fixture, 'membership-'));
          const project = (yield* demo.graph.projectLifecycle.create({ name: 'membership', rootPath: checkout })).id;
          const gone = `${checkout}/nested`;
          const moved = `${checkout}-moved`;
          yield* gitEffect(checkout, ['worktree', 'add', '-q', '-b', 'gone', gone]);
          yield* gitEffect(checkout, ['worktree', 'add', '-q', '-b', 'moved', moved]);
          const { roots, coverage } = yield* coveredWorkspace({
            namespaceId: NamespaceId.make('membership'),
            projects: demo.graph.projects,
            git,
          });
          const covered = yield* coverage.cover(project);
          const main = covered.roots.find((root) => root.origin === 'canonical')!;
          const removed = covered.roots.find((root) => root.path === gone)!;
          const paths = yield* makeCheckoutPathService.pipe(
            Effect.provideService(Coverage, coverage),
            Effect.provideService(FileRoots, roots),
            Effect.provideService(Projects, demo.graph.projects),
          );
          expect((yield* paths.placeAcross(`${gone}/file.ts`))?.checkout).toBe(removed.rootId);
          expect((yield* paths.placeOf(project, `${gone}/file.ts`))?.checkout).toBe(removed.rootId);
          yield* gitEffect(checkout, ['worktree', 'move', moved, `${moved}-next`]);
          yield* gitEffect(checkout, ['worktree', 'remove', '--force', gone]);
          expect((yield* paths.placeAcross(`${gone}/file.ts`))?.checkout).toBe(main.rootId);
          expect((yield* paths.resourceAcross(`${gone}/file.ts`))?.checkout).toBe(main.rootId);
          expect((yield* paths.placeOf(project, `${gone}/file.ts`))?.checkout).toBe(main.rootId);
          expect(yield* paths.rootAcross(removed.rootId, project)).toBeNull();
          expect(yield* paths.rootAcross(removed.rootId, null)).toBeNull();
          expect((yield* paths.rootAcross(gone, project))?.rootId).toBe(main.rootId);
          expect(yield* paths.rootsWithin(checkout)).toEqual([]);
          expect((yield* paths.placeAcross(`${moved}/file.ts`))?.root).toBe(moved);
        }),
      ),
    );

    it.effect('a file entry is placed under the spelling it was named by, even where another spelling of it stands', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { coverage } = yield* composed(demo);
          const checkout = yield* tempRepoEffect(demo.fixture, 'spelled-');
          yield* demo.graph.projectLifecycle.create({ name: 'spelled', rootPath: checkout });
          yield* files.makeDirectory(`${checkout}/src`, { recursive: true });
          yield* files.writeFileString(`${checkout}/src/a.ts`, 'a\n');
          const paths = yield* checkoutPaths(coverage, demo.graph.projects);
          expect((yield* paths.placeAcross(`${checkout}/src/A.ts`))?.path).toBe('src/A.ts');
        }),
      ),
    );

    it.effect('a path beneath a directory whose inode is unusable lies outside every checkout', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const sealed = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'sealed-' }));
          yield* files.makeDirectory(`${sealed}/bin`);
          const blind: FileSystem.FileSystem = {
            ...files,
            stat: (path) => Effect.map(files.stat(path), (info) => (path === sealed ? { ...info, ino: Option.none() } : info)),
          };
          const { coverage } = yield* Effect.provideService(composed(demo), FileSystem.FileSystem, blind);
          const paths = yield* checkoutPaths(coverage, demo.graph.projects);
          expect(yield* paths.placeAcross(`${sealed}/bin`)).toBeNull();
        }),
      ),
    );

    it.effect('a path in the covered root of the global project is its place, and looking it up ends', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const files = yield* FileSystem.FileSystem;
          const { coverage } = yield* composed(demo);
          const global = yield* demo.graph.projects.global();
          if (global === undefined) return yield* Effect.die('the fixture registry has no global project');
          yield* files.makeDirectory(global.rootPath, { recursive: true });
          yield* coverage.cover(global.id);
          const paths = yield* checkoutPaths(coverage, demo.graph.projects);
          expect((yield* paths.resourceAcross(global.rootPath))?.projectId).toBe(global.id);
        }),
      ),
    );
  },
);
