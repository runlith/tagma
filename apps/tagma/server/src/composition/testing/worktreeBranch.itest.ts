import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { toolExecute, toolPrepare } from '@runlith/agent/tool';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { fixedCheckoutPaths } from '../../workspace/testing/doubles.js';
import { makeMachineWorld } from '../../executions/testing/doubles.js';
import { demoGraphLayer, withDemo } from './graphFixture.js';
import { commitEffect, composed, shEffect } from './finishingFixture.js';
import { fixtureNativeCatalog, fixtureServedGraphs } from './nativeCatalog.js';
import { RoutedGraphs } from '../../graph/contract/service/serving.js';
import { unthreadedCaller } from './callers.js';

layer(Layer.merge(demoGraphLayer({ repos: ['finishing'] }), BunFileSystem.layer), {
  excludeTestServices: true,
})('worktree branch retirement', (it) => {
  it.effect('delete_worktree reports the unmerged commits after its checkout is gone', () =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        const { retirement, make, project, projectId } = yield* composed(
          demo,
          makeMachineWorld(() => null),
          { project: demo.project('finishing') },
        );
        yield* commitEffect(project, 'work.txt', 'base\n', 'shared work');
        const side = yield* make('unmerged');
        yield* commitEffect(side.path, 'work.txt', 'branch work\n', 'work the base lacks');
        const tip = yield* shEffect(side.path, ['rev-parse', 'HEAD']);
        yield* commitEffect(project, 'work.txt', 'base work\n', 'independent base work');
        const vocabulary = yield* demo.graph.tags.of(projectId);
        const paths = yield* fixedCheckoutPaths(projectId, [{ checkout: side.rootId, root: side.path }]);
        const tools = yield* fixtureNativeCatalog(
          {
            caller: { actor: { kind: 'operator' }, files: null },
            place: { root: project, origin: null },
            world: 'checkout',
            project: { id: projectId, name: (yield* demo.graph.projects.byId(projectId)).name },
            vocabulary: () => vocabulary,
            identity: testSessionIdentity,
            owners: Context.add(demo.context, WorktreeRetirement, retirement).pipe(
              Context.add(CheckoutPaths, paths),
              Context.add(RoutedGraphs, fixtureServedGraphs(demo.context)),
            ),
          },
          ['delete_worktree'],
        );
        const tool = tools.delete_worktree!;
        const input = { rootId: side.rootId };
        const call = { caller: unthreadedCaller, toolCallId: 'delete-unmerged', messages: [] };
        const prepared = yield* toolPrepare(tool)!(input, call);
        const answer = yield* toolExecute(tool)!(input, { ...call, prepared: prepared.prepared });
        const value = typeof answer === 'object' && answer !== null && 'value' in answer ? answer.value : answer;

        expect(yield* files.exists(side.path)).toBe(false);
        expect(value).toMatchObject({
          status: 'branch-kept',
          branch: { status: 'kept', name: side.branch, commits: [{ sha: tip, subject: 'work the base lacks' }] },
        });
        expect(yield* shEffect(project, ['rev-parse', side.branch])).toBe(tip);
      }),
    ),
  );
});
