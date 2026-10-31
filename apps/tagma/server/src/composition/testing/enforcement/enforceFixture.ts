import { kind, shared } from '@runlith/testbed/worlds';
import { dirname, join } from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { Context, Effect, FileSystem, Layer } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { event } from '../../../graph/store/tables.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import type { Caller } from '../../../platform/contract/wire/caller.js';
import { DemoGraphs, demoGraphLayer, gitEffect, withDemo, refusalOf, type EffectDemo } from '../graphFixture.js';
import type { InputOf } from '../../../platform/contract/service/body.js';
import { quiet, workerLanes } from '../../../enforcement/testing/wiring.js';
import { enforcementBodies } from '../../../enforcement/testing/bodies.js';
import { perform, prepare } from '../../../invocation/testing/performing.js';
import { OperationChecks } from '../../../invocation/contract/service/operationChecks.js';
import { OperationCatalog } from '../../../invocation/contract/service/catalog.js';
import { fixtureOperationCatalog as operationCatalog } from '../nativeCatalog.js';
import { operationChecks } from '../../operationChecks.js';
import type { LawEnforcement } from '../../../graph/contract/wire/enforcement.js';
import { checkSubjectOf } from '../composed.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { UNBOUND_CHECKS } from '../../../enforcement/testing/doubles.js';
import { based, type Unbased } from '../../../enforcement/testing/based.js';
import type { ENFORCEMENT_OPERATIONS } from '../../../enforcement/contract/wire/operationCatalog.js';
import { forProject, withGraphCall } from '../../../invocation/testing/call.js';
import { layeredDrawn } from '../../../enforcement/testing/layered.js';

export const bodies = enforcementBodies(checkSubjectOf);
export const operator: Caller = { actor: { kind: 'operator' }, files: null };

const makeFixture = Effect.fnUntraced(function* (demo: EffectDemo, workers: ReturnType<typeof workerLanes>) {
  const catalog = yield* operationCatalog;
  const files = yield* FileSystem.FileSystem;
  const wrote = Effect.fnUntraced(function* (path: string, text: string) {
    const at = join(demo.demoRoot, path);
    yield* files.makeDirectory(dirname(at), { recursive: true });
    yield* files.writeFileString(at, text);
  });
  const committed = Effect.fnUntraced(function* (message: string) {
    yield* gitEffect(demo.demoRoot, ['add', '-A']);
    yield* gitEffect(demo.demoRoot, ['commit', '-qm', message]);
  });
  const demoCall = () =>
    Effect.map(Effect.orDie(demo.table()), (vocabulary) => ({
      project: { id: demo.projectId, name: 'demo' },
      vocabulary,
      lens: { scope: undefined, names: 'law-and-reflections' as const },
      deliveredTags: new Set<string>(),
    }));
  const context = demo.context.pipe(
    Context.merge(quiet(workers)),
    Context.add(RuleChecks, UNBOUND_CHECKS),
    Context.add(OperationChecks, operationChecks(UNBOUND_CHECKS)),
    Context.add(OperationCatalog, catalog),
  );
  const working = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(withGraphCall(demoCall()), forProject(demoCall()), Effect.provide(context));
  return {
    demo,
    wrote,
    committed,
    head: () =>
      Effect.map(spawnedEffect(['git', 'rev-parse', 'HEAD'], { cwd: demo.demoRoot }), (answer) => answer.stdout.toString().trim()),
    working,
    enforce: (input: Unbased) => working(Effect.flatMap(based(input), (full) => perform(bodies.enforce_rule, full, operator))),
    refused: (input: Unbased) => working(refusalOf(Effect.flatMap(based(input), (full) => perform(bodies.enforce_rule, full, operator)))),
    planned: (input: Unbased) => working(Effect.flatMap(based(input), (full) => prepare(bodies.enforce_rule, full, operator))),
    written: (input: Unbased): InputOf<typeof ENFORCEMENT_OPERATIONS.enforce_rule> => ({ ...input, base: null }),
    created: Effect.fnUntraced(function* (tags: string[], title: string, extra: object = {}) {
      return yield* demo.nameOf(
        (yield* demo.graph.blocks.create({ projectId: demo.projectId, parentId: demo.root, tags, title, ...extra })).id,
      );
    }),
    documentOf: Effect.fnUntraced(function* (name: string) {
      const id = yield* demo.graph.blockNames.idOfName(name);
      const row = yield* demo.graph.blocks.blockById(id);
      return row.fields.enforcement as LawEnforcement | undefined;
    }),
    journal: Effect.fnUntraced(function* (name: string) {
      const id = yield* demo.graph.blockNames.idOfName(name);
      const { db } = yield* MachineStore;
      return yield* db
        .select()
        .from(event)
        .where(and(eq(event.blockId, id), eq(event.op, 'enforce')))
        .orderBy(desc(event.id));
    }),
  };
});

export type EnforcementFixture = Effect.Success<ReturnType<typeof makeFixture>>;
export class Enforcements extends Context.Service<
  Enforcements,
  {
    readonly workers: ReturnType<typeof workerLanes>;
    readonly seed: string;
  }
>()('testing/Enforcements') {}

const enforceLayer = (home: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      yield* files.makeDirectory(home, { recursive: true });
      const seed = join(home, 'seed');
      const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (workers) => Effect.sync(() => workers.close()));
      return Layer.mergeAll(
        Layer.succeed(Enforcements, { workers, seed }),
        demoGraphLayer({
          prepareEffect: Effect.fnUntraced(function* (demo) {
            const fx = yield* makeFixture(demo, workers);
            yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
            yield* fx.wrote('src/core/model.ts', 'export const model = 1;\n');
            yield* fx.wrote('src/ui/panel.ts', "import { model } from '../core/model';\nexport const panel = model;\n");
            yield* fx.wrote('src/core/view.ts', "import { panel } from '../ui/panel';\nexport const view = panel;\n");
            yield* fx.wrote('src/core/view.test.ts', "import { main } from '../app/main';\n");
            yield* fx.wrote('src/app/main.ts', "import { panel } from '../ui/panel';\nexport const main = panel;\n");
            yield* fx.committed('seed');
            yield* fx.working(layeredDrawn(demo.projectId));
            yield* files.copy(demo.demoRoot, seed, { overwrite: true });
          }),
        }),
      );
    }),
  ).pipe(Layer.provideMerge(BunFileSystem.layer));

class EnforcementWorld extends Context.Service<EnforcementWorld, Context.Context<Enforcements | DemoGraphs | FileSystem.FileSystem>>()(
  'testing/EnforcementWorld',
) {}
const enforcementWorld = kind(EnforcementWorld, (_params: {}, home) => Layer.build(enforceLayer(home)));
export const enforceFixture = () => Layer.effectContext(shared(enforcementWorld, {}));

export const withEnforcement = <A, E, R>(body: (fixture: EnforcementFixture) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(Enforcements, ({ workers, seed }) =>
    withDemo((demo) =>
      Effect.gen(function* () {
        const files = yield* FileSystem.FileSystem;
        if (!(yield* files.exists(join(demo.demoRoot, '.git')))) yield* files.copy(seed, demo.demoRoot, { overwrite: true });
        return yield* Effect.flatMap(makeFixture(demo, workers), body);
      }),
    ),
  );
