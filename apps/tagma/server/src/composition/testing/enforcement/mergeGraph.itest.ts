import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { basename, dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { type EffectDemo, graphFixture } from '../graphFixture.js';
import { composed, shEffect } from '../finishingFixture.js';
import { checkSubjectOf } from '../composed.js';
import { makeMachineWorld } from '../../../executions/testing/doubles.js';
import {
  checksOver,
  enforcementApplied,
  enforcementBaseOf,
  modulesDrawn,
  quiet,
  withLanes,
  workerLanes,
  type Lanes,
} from '../../../enforcement/testing/wiring.js';
import { actChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import type { ModuleSet } from '../../../enforcement/contract/wire/modules.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { MeasuredCheckout } from '../../../graph/contract/service/serving.js';
import type { GraphSync } from '../../../landing/contract/wire/receipt.js';

const put = Effect.fn('testing.mergeGraph.put')(function* (dir: string, path: string, text: string) {
  const files = yield* FileSystem.FileSystem;
  yield* files.makeDirectory(dirname(join(dir, path)), { recursive: true });
  yield* files.writeFileString(join(dir, path), text);
});

const committed = Effect.fnUntraced(function* (dir: string, message: string) {
  yield* shEffect(dir, ['add', '-A']);
  yield* shEffect(dir, ['commit', '-q', '-m', message]);
});

const enforced = Effect.fnUntraced(
  function* (graph: EffectDemo, projectId: number, checkout: string, modules: readonly ModuleSet[], workers: Lanes) {
    const under = yield* graph.graph.blocks.rootBlockOf(projectId);
    yield* modulesDrawn({ projectId, caller: null, subjectOf: () => null, modules: modules.map((one) => ({ ...one, under })) });
    const made = yield* graph.graph.blocks.create({
      projectId,
      parentId: under.id,
      tags: ['rule'],
      title: 'Import only along declared relations',
    });
    const row = yield* graph.graph.blocks.blockById(made.id);
    yield* enforcementApplied(row, {
      strictness: 'gate',
      on: [{ op: 'merge_worktree', phase: 'before' }],
      inspection: LAYERED_KEY,
      caller: null,
      subjectOf: checkSubjectOf,
      base: yield* enforcementBaseOf(row),
    });
  },
  (effect, graph, projectId, checkout, _modules, workers) =>
    effect.pipe(
      Effect.provideService(MeasuredCheckout, { projectId, path: checkout }),
      Effect.provideContext(quiet(workers)),
      Effect.provide(graph.context),
    ),
);

const CORE: ModuleSet = { id: 'core', title: 'Core', root: 'src/core', entries: { put: [{ at: 'model.ts' }] } };

const EXTRA: ModuleSet = { id: 'extra', title: 'Extra', root: 'src/extra', entries: { put: [{ at: 'extra.ts' }] } };

const twinned = (
  title: string,
  options: {
    readonly behind: boolean;
    readonly graph?: GraphSync;
  },
  check: (seen: {
    readonly finishing: Effect.Success<ReturnType<typeof composed>>['finishing'];
    readonly projectId: number;
    readonly project: string;
    readonly side: {
      readonly path: string;
      readonly rootId: Parameters<Effect.Success<ReturnType<typeof composed>>['finishing']['merge']>[1];
    };
    readonly base: string;
  }) => Effect.Effect<void, unknown, FileSystem.FileSystem>,
) =>
  it.live(title, () =>
    Effect.gen(function* () {
      const baseWorld = graphFixture();
      const branchWorld = graphFixture();
      const base = (yield* Effect.acquireRelease(baseWorld.openEffect(), () => Effect.orDie(baseWorld.releaseEffect))).effects;
      const branch = (yield* Effect.acquireRelease(branchWorld.openEffect(), () => Effect.orDie(branchWorld.releaseEffect))).effects;
      const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (lanes) => Effect.sync(() => lanes.close()));
      return yield* Effect.gen(function* () {
        let worktree = '';
        const checks = actChecks(
          checksOver({
            graphOf: (_projectId, root) => Effect.succeed(withLanes(root === worktree ? branch.context : base.context, workers)),
          }),
          'merge_worktree',
        );
        const { finishing, make, project, projectId } = yield* composed(
          base,
          makeMachineWorld(() => null),
          {
            before: checks.before,
            twinBehind: () => Effect.succeed(options.behind),
            graph: options.graph === undefined ? undefined : () => Effect.succeed(options.graph!),
          },
        );
        yield* put(project, 'src/core/model.ts', 'export const model = 1;\n');
        yield* put(project, 'src/app/main.ts', "import { model } from '../core/model.js';\nexport const main = model;\n");
        yield* committed(project, 'two modules');
        yield* enforced(
          base,
          projectId,
          project,
          [CORE, { id: 'app', title: 'App', root: 'src/app', imports: { put: ['core'] } }],
          workers,
        );
        const side = yield* make('twinned');
        worktree = side.path;
        yield* put(side.path, 'src/extra/extra.ts', 'export const extra = 1;\n');
        yield* put(
          side.path,
          'src/app/main.ts',
          "import { model } from '../core/model.js';\nimport { extra } from '../extra/extra.js';\nexport const main = model + extra;\n",
        );
        yield* committed(side.path, 'an extra module');
        yield* Effect.provide(branch.graph.projectLifecycle.create({ name: basename(project), rootPath: side.path }), branch.context);
        yield* enforced(
          branch,
          projectId,
          side.path,
          [CORE, EXTRA, { id: 'app', title: 'App', root: 'src/app', imports: { put: ['core', 'extra'] } }],
          workers,
        );
        yield* put(project, 'src/base.ts', 'export const base = 1;\n');
        yield* committed(project, 'the base moves on');
        yield* check({ finishing, projectId, project, side, base: yield* shEffect(project, ['rev-parse', 'HEAD']) });
      }).pipe(Effect.provide(base.context));
    }).pipe(Effect.provide(BunFileSystem.layer)),
  );

twinned(
  'a stealth branch whose graph twin holds its own module card merges under that twin, the base graph written to nowhere',
  { behind: false },
  ({ finishing, projectId, project, side }) =>
    Effect.gen(function* () {
      const merged = yield* finishing.merge(projectId, side.rootId, {});
      expect(merged.base.head).toBe(yield* shEffect(project, ['rev-parse', 'HEAD']));
      expect(yield* shEffect(project, ['show', 'HEAD:src/extra/extra.ts'])).toBe('export const extra = 1;');
    }),
);

twinned(
  'a base twin the topology sync leaves ahead is not taken as absorbed: the base graph judges',
  { behind: true, graph: { status: 'synced', merges: [] } },
  ({ finishing, projectId, side }) =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(finishing.merge(projectId, side.rootId, {}));
      expect(refused._tag === 'WorktreeFinishRefused' && refused.reason).toBe('rule-violated');
    }),
);

twinned(
  'a stealth merge whose base twin cannot be brought into the branch twin refuses naming the conflict, with the base taken into the branch',
  { behind: true, graph: { status: 'synced', merges: [{ branch: 'main', merged: null, conflicts: ['modules/core.md'] }] } },
  ({ finishing, projectId, project, side, base }) =>
    Effect.gen(function* () {
      const refused = yield* Effect.flip(finishing.merge(projectId, side.rootId, {}));
      expect(refused._tag === 'WorktreeFinishRefused' && [refused.reason, refused.message.includes('modules/core.md')]).toEqual([
        'merge-conflicts',
        true,
      ]);
      expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(base);
      expect(yield* shEffect(side.path, ['merge-base', '--is-ancestor', base, 'HEAD']).pipe(Effect.as(true))).toBe(true);
    }),
);

it.live(
  'a branch that carries its own module card in the tree merges under its own graph, and a crossing of that graph still refuses',
  () =>
    Effect.gen(function* () {
      const baseWorld = graphFixture();
      const branchWorld = graphFixture();
      const base = (yield* Effect.acquireRelease(baseWorld.openEffect(), () => Effect.orDie(baseWorld.releaseEffect))).effects;
      const branch = (yield* Effect.acquireRelease(branchWorld.openEffect(), () => Effect.orDie(branchWorld.releaseEffect))).effects;
      const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (lanes) => Effect.sync(() => lanes.close()));
      return yield* Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        let worktree = '';
        const checks = actChecks(
          checksOver({
            graphOf: (_projectId, root) => Effect.succeed(withLanes(root === worktree ? branch.context : base.context, workers)),
          }),
          'merge_worktree',
        );
        const { finishing, make, project, projectId } = yield* composed(
          base,
          makeMachineWorld(() => null),
          { carried: true, before: checks.before },
        );
        yield* put(project, 'src/core/model.ts', 'export const model = 1;\n');
        yield* put(project, 'src/app/main.ts', "import { model } from '../core/model.js';\nexport const main = model;\n");
        yield* committed(project, 'two modules');
        yield* enforced(
          base,
          projectId,
          project,
          [CORE, { id: 'app', title: 'App', root: 'src/app', imports: { put: ['core'] } }],
          workers,
        );

        const side = yield* make('carrying');
        worktree = side.path;
        yield* put(side.path, 'src/extra/extra.ts', 'export const extra = 1;\n');
        yield* put(
          side.path,
          'src/app/main.ts',
          "import { model } from '../core/model.js';\nimport { extra } from '../extra/extra.js';\nexport const main = model + extra;\n",
        );
        yield* put(side.path, '.tagma/carrying/extra.md', 'the card of the extra module, as the branch carries it\n');
        yield* committed(side.path, 'an extra module');
        const twin = yield* Effect.provide(
          branch.graph.projectLifecycle.create({ name: basename(project), rootPath: side.path }),
          branch.context,
        );
        expect(twin.id).toBe(projectId);
        yield* enforced(
          branch,
          projectId,
          side.path,
          [
            CORE,
            { id: 'extra', title: 'Extra', root: 'src/extra', entries: { put: [{ at: 'extra.ts' }] } },
            { id: 'app', title: 'App', root: 'src/app', imports: { put: ['core', 'extra'] } },
          ],
          workers,
        );

        yield* put(side.path, 'src/core/boot.ts', "import { main } from '../app/main.js';\nexport const boot = main;\n");
        yield* committed(side.path, 'core reaches up into app');
        const before = yield* shEffect(project, ['rev-parse', 'HEAD']);
        const crossing = yield* Effect.flip(finishing.merge(projectId, side.rootId, {}));
        expect(crossing._tag === 'WorktreeFinishRefused' && [crossing.reason, crossing.message.includes('core/boot.ts')]).toEqual([
          'rule-violated',
          true,
        ]);
        expect(yield* shEffect(project, ['rev-parse', 'HEAD'])).toBe(before);

        yield* files.remove(join(side.path, 'src/core/boot.ts'));
        yield* committed(side.path, 'core stays below app');
        const merged = yield* finishing.merge(projectId, side.rootId, {});
        expect(merged.base.head).toBe(yield* shEffect(project, ['rev-parse', 'HEAD']));
        expect(yield* shEffect(project, ['show', 'HEAD:src/extra/extra.ts'])).toBe('export const extra = 1;');
      }).pipe(Effect.provide(base.context));
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
