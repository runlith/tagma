import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer, Path } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { NamespaceId } from '@runlith/files/namespace';
import { Git } from '@runlith/git/Git';
import { coveredWorkspace } from '../../../workspace/testing/doubles.js';
import { type DemoState, demoGraphLayer, tempRepoEffect, tempRootEffect, withDemo } from '../graphFixture.js';
import { suiteGit } from '../suiteGit.js';

const linked = Effect.fnUntraced(function* (demo: DemoState, repo: string, names: readonly string[]) {
  const files = yield* FileSystem.FileSystem;
  const common = join(repo, '.git');
  const head = yield* suiteGit(repo, 'rev-parse', 'HEAD');
  const parent = yield* files.realPath(yield* tempRootEffect(demo.fixture, 'linked-'));
  for (const name of names) {
    const tree = join(parent, name);
    const admin = join(common, 'worktrees', name);
    yield* files.makeDirectory(tree, { recursive: true });
    yield* files.makeDirectory(admin, { recursive: true });
    yield* files.writeFileString(join(admin, 'gitdir'), `${join(tree, '.git')}\n`);
    yield* files.writeFileString(join(admin, 'commondir'), '../..\n');
    yield* files.writeFileString(join(admin, 'HEAD'), `${head}\n`);
    yield* files.writeFileString(join(tree, '.git'), `gitdir: ${admin}\n`);
  }
});

const covering = Effect.fnUntraced(function* (demo: DemoState, checkouts: number) {
  const live = yield* Git;
  let calls = 0;
  const counted = Git.of({
    run: (args, options) => {
      calls += 1;
      return live.run(args, options);
    },
  });
  const { coverage } = yield* coveredWorkspace({
    namespaceId: NamespaceId.make(`scale-${checkouts}`),
    projects: demo.graph.projects,
    git: counted,
  });
  const repo = yield* tempRepoEffect(demo.fixture, `scale-${checkouts}-`);
  const project = yield* demo.graph.projectLifecycle.create({ name: `scale-${checkouts}`, rootPath: repo });
  yield* linked(
    demo,
    repo,
    Array.from({ length: checkouts }, (_, index) => `tree-${index}`),
  );
  calls = 0;
  expect((yield* coverage.cover(project.id)).roots).toHaveLength(checkouts + 1);
  const cold = calls;
  yield* linked(demo, repo, ['tree-new']);
  calls = 0;
  expect((yield* coverage.cover(project.id)).roots).toHaveLength(checkouts + 2);
  return { cold, oneNew: calls };
});

layer(demoGraphLayer().pipe(Layer.provideMerge(Layer.merge(BunFileSystem.layer, Path.layer))), { excludeTestServices: true })(
  'project coverage at scale',
  (it) => {
    it.effect('coverage uses the same git work with more checkouts, taken cold or gaining one new checkout', () =>
      withDemo((demo) =>
        Effect.gen(function* () {
          const few = yield* covering(demo, 1);
          const many = yield* covering(demo, 2);
          expect(many.oneNew).toBe(few.oneNew);
          expect(many.cold).toBeLessThanOrEqual(few.cold);
        }),
      ),
    );
  },
);
