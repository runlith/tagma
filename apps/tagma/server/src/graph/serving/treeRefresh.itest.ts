import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Exit, Layer } from 'effect';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { servedTree } from '../../composition/testing/servedTree.fixture.js';
import { FileWatcher, type WatchHearing } from '../../platform/contract/service/watch.js';

layer(demoGraphLayer({ repos: ['topology'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'served tree refresh',
  (it) => {
    it.effect('an edit of one block file refreshes the tree with a status of that one path', () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const tree = yield* servedTree(demo);
            const from = tree.statuses.length;
            yield* tree.edit('Edited by hand');
            yield* tree.after(from, tree.scoped);
            yield* tree.settled;
            expect(tree.statuses.slice(from).every(tree.scoped)).toBe(true);
            expect(yield* tree.bodies).toEqual(['Edited by hand']);
          }),
        ),
      ),
    );

    it.effect('a tree whose watch was lost watches again by itself, and its next edit refreshes that one path', () =>
      withDemo((demo) =>
        Effect.scoped(
          Effect.gen(function* () {
            const hearings = new Map<string, WatchHearing>();
            const reopened = yield* Deferred.make<number>();
            let lost = false;
            let statuses: readonly (readonly string[])[] = [];
            const tree = yield* servedTree(demo, (inner) =>
              FileWatcher.of({
                ...inner,
                subscribe: (at, options, hearing) =>
                  Effect.tap(inner.subscribe(at, options, hearing), () =>
                    Effect.sync(() => {
                      if (lost && options.recursive) Deferred.doneUnsafe(reopened, Exit.succeed(statuses.length));
                      if (options.recursive) hearings.set(at, hearing);
                    }),
                  ),
              }),
            );
            statuses = tree.statuses;
            const hearing = hearings.get(tree.root);
            if (hearing === undefined) return yield* Effect.die('the tree was not watched');
            lost = true;
            hearing.ended('the watch process was lost');
            yield* tree.after(yield* Deferred.await(reopened), tree.whole);
            yield* tree.settled;
            const from = tree.statuses.length;
            yield* tree.edit('Edited after the watch came back');
            yield* tree.after(from, tree.scoped);
            yield* tree.settled;
            expect(tree.statuses.slice(from).every(tree.scoped)).toBe(true);
            expect(yield* tree.bodies).toEqual(['Edited after the watch came back']);
          }),
        ),
      ),
    );
  },
);
