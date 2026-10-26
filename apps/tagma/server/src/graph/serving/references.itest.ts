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

const signed = signedBy({ harness: 'test', key: 'references' });

layer(demoGraphLayer({ repos: ['beta'] }).pipe(Layer.provideMerge(BunFileSystem.layer)), { excludeTestServices: true })(
  'cross-project references',
  (it) => {
    it.effect('foreign and branch-only identities retain their addresses while colliding short names are refused', () =>
      withDemo(({ graph, context, projectId, demoRoot, project, fixture }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const beta = project('beta');
            yield* graph.projectPolicy.setStorage({ id: projectId, mode: 'stealth' });
            yield* graph.projectPolicy.setStorage({ id: beta.id, mode: 'team' });
            const machine = machineGraphOf(context);
            const pool = yield* Effect.acquireRelease(
              graphPool({ migrations: fixtureGraphMigrations, identity: testSessionIdentity, machine, sourcePath: demoRoot }),
              (held) => held.dispose(),
            );
            const routed = routedContext(machine, pool);
            const betaGraph = yield* pool.resolve({ projectId: beta.id });
            const uuid = '0199bbbb-0000-7000-8000-0000cafe0001';
            yield* signed(Effect.flatMap(Blocks, (blocks) => blocks.create({ projectId: beta.id, uuid, title: 'Foreign reference' }))).pipe(
              Effect.provide(betaGraph.context),
            );
            yield* syncGraph({ commits: Context.get(betaGraph.context, TreeCommits), policy: Effect.succeed('auto') });
            const current = yield* pool.resolve({ projectId });
            const short = blockName(uuid);
            const full = uuid.replaceAll('-', '');
            const read = (names: readonly string[]) =>
              Effect.provide(onGraph(current)(titlesAcross(names)), routed).pipe(Effect.map((answer) => answer.titles));
            expect(yield* read([short, full])).toEqual([
              { name: short, title: 'Foreign reference', projectId: beta.id, branch: null },
              { name: full, title: 'Foreign reference', projectId: beta.id, branch: null },
            ]);
            const global = (yield* graph.projects.global())!;
            const canonical = yield* pool.resolve({ projectId: global.id });
            const globalBlocks = Context.get(canonical.context, Blocks);
            yield* signed(
              globalBlocks.create({ projectId: global.id, uuid: '0199cccc-0000-7000-8000-0000cafe0001', title: 'Second reference' }),
            ).pipe(Effect.provide(canonical.context));
            const refused = yield* Effect.result(read([short]));
            expect(refused._tag).toBe('Failure');
            if (refused._tag === 'Failure') expect(refused.failure).toMatchObject({ code: 'ambiguous-name' });
            expect(yield* read([full])).toEqual([{ name: full, title: 'Foreign reference', projectId: beta.id, branch: null }]);
            const addressed = `${beta.id}/${short}`;
            expect(yield* read([addressed])).toEqual([{ name: addressed, title: 'Foreign reference', projectId: beta.id, branch: null }]);

            const worktree = yield* fixture.directory('branch-copy');
            yield* runGit(graph.git, 'worktree', ['worktree', 'add', '-b', 'subject', worktree], { cwd: beta.root });
            const branch = yield* pool.resolve({ projectId: beta.id, cwd: worktree });
            const born = yield* signed(
              Effect.flatMap(Blocks, (blocks) =>
                blocks.create({
                  projectId: beta.id,
                  uuid: '0199bbbb-0000-7000-8000-0000cafe0005',
                  title: 'Branch reference',
                }),
              ),
            ).pipe(Effect.provide(branch.context));
            const name = blockName(born.uuid);
            expect(yield* read([name])).toEqual([{ name, title: 'Branch reference', projectId: beta.id, branch: 'subject' }]);
            yield* signed(
              globalBlocks.create({ projectId: global.id, uuid: '0199cccc-0000-7000-8000-0000cafe0005', title: 'Canonical collision' }),
            ).pipe(Effect.provide(canonical.context));
            const answer = yield* Effect.result(read([name]));
            expect(answer._tag).toBe('Failure');
            if (answer._tag === 'Failure') expect(answer.failure).toMatchObject({ code: 'ambiguous-name' });
          }),
        ),
      ),
    );
  },
);
