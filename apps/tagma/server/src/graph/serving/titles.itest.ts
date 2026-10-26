import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { demoGraphLayer, withDemo } from '../../composition/testing/graphFixture.js';
import { fixtureGraphMigrations } from '../../composition/testing/migrations.js';
import { testSessionIdentity } from '../../platform/testing/identity.js';
import { runGit } from '../../platform/git/ownGit.js';
import { onGraph, signedBy } from '../../invocation/testing/call.js';
import { Blocks } from '../contract/service/blocks.js';
import { blockName } from '../contract/wire/references.js';
import { syncGraph, TreeCommits } from '../tree/commits.js';
import { machineGraphOf } from './machine.js';
import { graphPool } from '../testing/doubles.js';
import { routedContext, titlesAcross } from './routing.js';

const signed = signedBy({ harness: 'test', key: 'titles' });
const mainUuid = '0199bbbb-0000-7000-8000-0000cafe0001';
const branchUuid = '0199bbbb-0000-7000-8000-0000cafe0002';

layer(demoGraphLayer({ repos: ['alpha', 'beta'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'indexed title navigation',
  (it) => {
    it.effect('names resolve from the indexes of copies the pool no longer holds, and a lookup opens no graph', () =>
      withDemo(({ graph, context, project, projectId, demoRoot, fixture }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const alpha = project('alpha');
            const beta = project('beta');
            yield* graph.projectPolicy.setStorage({ id: projectId, mode: 'stealth' });
            yield* graph.projectPolicy.setStorage({ id: alpha.id, mode: 'team' });
            yield* graph.projectPolicy.setStorage({ id: beta.id, mode: 'team' });
            const machine = machineGraphOf(context);
            const pool = yield* Effect.acquireRelease(
              graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
              (held) => held.dispose(),
            );
            const create = (uuid: string, title: string) =>
              signed(Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: beta.id, uuid, title })));
            const main = yield* pool.resolve({ projectId: beta.id });
            yield* create(mainUuid, 'Main reference').pipe(Effect.provide(main.context));
            yield* syncGraph({ commits: Context.get(main.context, TreeCommits), policy: Effect.succeed('auto') });
            const worktree = yield* fixture.directory('branch-copy');
            yield* runGit(graph.git, 'worktree', ['worktree', 'add', '-b', 'subject', worktree], { cwd: beta.root });
            const branch = yield* pool.resolve({ projectId: beta.id, cwd: worktree });
            yield* create(branchUuid, 'Branch reference').pipe(Effect.provide(branch.context));
            yield* pool.releaseProject(beta.id);

            const current = yield* pool.resolve({ projectId: alpha.id });
            const read = (names: readonly string[]) =>
              Effect.provide(onGraph(current)(titlesAcross(names)), routedContext(machine, pool)).pipe(
                Effect.map((answer) => answer.titles),
              );
            expect(pool.held().map((copy) => copy.treeRoot)).toEqual([current.layout.treeRoot]);
            expect(yield* read([blockName(mainUuid), blockName(branchUuid), 'ffffffff'])).toEqual([
              { name: blockName(mainUuid), title: 'Main reference', projectId: beta.id, branch: null },
              { name: blockName(branchUuid), title: 'Branch reference', projectId: beta.id, branch: 'subject' },
            ]);
            expect(pool.held().map((copy) => copy.treeRoot)).toEqual([current.layout.treeRoot]);
          }),
        ),
      ),
    );
  },
);
