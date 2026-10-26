import { Context, Effect, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { demoGraphLayer, type EffectDemo, withDemo } from '../../graphFixture.js';
import { fixtureGraphMigrations } from '../../migrations.js';
import { testSessionIdentity } from '../../../../platform/testing/identity.js';
import type { GraphPool } from '../../../../graph/serving/pool.js';
import { machineGraphOf } from '../../../../graph/serving/machine.js';
import { graphPool } from '../../../../graph/testing/doubles.js';
import type { ServedGraph } from '../../../../graph/contract/service/serving.js';
import type { StorageMode } from '../../../../projects/contract/wire/project.js';
import { runGit } from '../../../../platform/git/ownGit.js';

export const prepareTeamCopies = (names: readonly string[]) =>
  Effect.fnUntraced(function* (demo: EffectDemo) {
    const ids = names.map((name) => demo.project(name).id);
    yield* demo.graph.projectPolicy.setStorage({ id: demo.projectId, mode: 'stealth' });
    for (const id of ids) yield* demo.graph.projectPolicy.setStorage({ id, mode: 'team' });
    const pool = yield* Effect.acquireRelease(
      graphPool({
        machine: machineGraphOf(demo.context),
        sourcePath: demo.demoRoot,
        identity: testSessionIdentity,
        migrations: fixtureGraphMigrations,
      }),
      (held) => held.dispose(),
    );
    const global = yield* demo.graph.projects.global();
    for (const projectId of [demo.projectId, ...ids, ...(global === undefined ? [] : [global.id])]) yield* pool.resolve({ projectId });
  }, Effect.scoped);

export const servingLayer = demoGraphLayer({
  repos: ['repo'],
  source: 'repo',
  prepareEffect: (demo) =>
    Effect.asVoid(runGit(demo.graph.git, 'fixture-branch', ['-C', demo.project('repo').root, 'branch', '-M', 'main'])),
}).pipe(Layer.provideMerge(BunFileSystem.layer));

export type Serving = {
  readonly demo: EffectDemo;
  readonly pool: GraphPool;
  readonly served: ServedGraph;
  readonly projectId: number;
  readonly repo: string;
};

export const withServing = <A, E, R>(body: (fixture: Serving) => Effect.Effect<A, E, R>, mode: StorageMode = 'stealth') =>
  withDemo((demo) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { id: projectId, root: repo } = demo.project('repo');
        if (mode !== 'stealth') yield* demo.graph.projectPolicy.setStorage({ id: projectId, mode });
        const machine = machineGraphOf(demo.context);
        const pool = yield* Effect.acquireRelease(
          graphPool({ machine, sourcePath: repo, identity: testSessionIdentity, migrations: fixtureGraphMigrations }),
          (pool) => pool.dispose(),
        );
        const served = yield* pool.resolve({ projectId });
        return yield* body({ demo, pool, served, projectId, repo }).pipe(Effect.provide(served.context));
      }),
    ),
  );
