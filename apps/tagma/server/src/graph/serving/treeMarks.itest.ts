import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { servedTree } from '../../composition/testing/servedTree.fixture.js';
import { FileWatcher } from '../../platform/contract/service/watch.js';

layer(demoGraphLayer({ repos: ['topology'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'served tree marks',
  (it) => {
    for (const marking of ['refresh', 'close'] as const) {
      it.effect(
        `a tree served again after an edit made while it was closed reads only what changed since its stored mark (marks at ${marking})`,
        () =>
          withDemo((demo) =>
            Effect.scoped(
              Effect.gen(function* () {
                const tree = yield* servedTree(demo, (inner) => FileWatcher.of({ ...inner, marking }));
                yield* tree.release;
                yield* tree.edit('Edited while nobody served the tree');
                const from = tree.statuses.length;
                yield* tree.serve;
                expect(tree.statuses.slice(from).some(tree.whole)).toBe(false);
                expect(tree.statuses.slice(from).some(tree.scoped)).toBe(true);
                expect(yield* tree.bodies).toEqual(['Edited while nobody served the tree']);
              }),
            ),
          ),
      );
    }
  },
);
