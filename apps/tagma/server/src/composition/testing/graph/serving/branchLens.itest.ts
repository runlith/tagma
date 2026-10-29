import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { layer } from '@runlith/effect-test';
import { Context, Effect } from 'effect';
import { eq } from 'drizzle-orm';
import { block } from '../../../../graph/store/tables.js';
import { GraphStore } from '../../../../platform/contract/service/store.js';
import { Blocks } from '../../../../graph/contract/service/blocks.js';
import { runGit } from '../../../../platform/git/ownGit.js';
import { servingLayer, withServing } from './fixture.js';

layer(servingLayer, { excludeTestServices: true })('branch lenses', (it) => {
  it.effect('working copies select isolated graphs, canonical first; a branch without a checkout refuses', () =>
    withServing(({ demo, pool, served: canonical, projectId, repo }) =>
      Effect.gen(function* () {
        const feature = join(dirname(repo), 'feature');
        yield* runGit(demo.graph.git, 'feature', ['-C', repo, 'worktree', 'add', '-b', 'feature', feature, 'main']);
        expect(yield* pool.branches(projectId)).toEqual([
          { branch: 'main', worktree: repo, canonical: true },
          { branch: 'feature', worktree: feature, canonical: false },
        ]);
        const served = yield* pool.resolve({ projectId, branch: 'feature' });
        const root = yield* Effect.provide(
          Effect.flatMap(Blocks, (blocks) => blocks.rootBlockOf(projectId)),
          served.context,
        );
        const made = yield* demo
          .as(
            'branch',
            Context.get(served.context, Blocks).create({
              projectId,
              parentId: root.id,
              tags: ['idea'],
              title: 'On The Branch',
              body: 'written under the aim',
            }),
          )
          .pipe(Effect.provide(served.context));
        expect(yield* Context.get(served.context, Blocks).rawBlockById(made.id)).toMatchObject({
          uuid: made.uuid,
          body: 'written under the aim',
        });
        yield* canonical.settled(true);
        expect(yield* Context.get(canonical.context, GraphStore).db.select().from(block).where(eq(block.uuid, made.uuid))).toEqual([]);
        yield* runGit(demo.graph.git, 'ghost', ['-C', repo, 'branch', 'ghost', 'main']);
        expect((yield* pool.branches(projectId)).map((row) => row.branch)).toEqual(['main', 'feature']);
        const refused = yield* demo.refusal(pool.resolve({ projectId, branch: 'ghost' }));
        expect(refused.code).toBe('no-checkout');
        expect(refused.unblock.length).toBeGreaterThan(0);
      }),
    ),
  );
});
