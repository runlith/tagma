import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Clock, Console, Context, Deferred, Effect, Exit, FileSystem, Layer, Queue, Scope, Tracer } from 'effect';
import type { Inspection } from '@tagma/inspection/builtins';
import { MeasuredCheckout } from '../../../graph/contract/service/serving.js';
import {
  driverOver,
  enforcementApplied,
  enforcementBaseOf,
  journalOver,
  withLanes,
  workerLanes,
  type Closable,
  type Lanes,
} from '../../../enforcement/testing/wiring.js';
import type { LandingJournal } from '../../../enforcement/contract/service/remeasure.js';
import { graphFixture, gitEffect, type EffectDemo } from '../graphFixture.js';
import { fixedCoverage } from '../../../workspace/testing/doubles.js';

type StartupCase = { readonly demo: EffectDemo; readonly workers: Closable; readonly files: FileSystem.FileSystem };
type BootOptions = {
  readonly memory: string;
  readonly completed: number | 'Measured' | 'Stale';
  readonly lanes: Lanes;
  readonly journal?: LandingJournal;
  readonly barrier?: Effect.Effect<void>;
  readonly opened?: readonly string[];
  readonly covered?: readonly string[];
};
const inspection = (lines = 10): Inspection => ({
  builtin: 'size',
  params: { base: 'src', files: { extensions: ['.ts'], exclude: [] }, thresholds: [{ glob: '**', metric: 'non-import', lines }] },
});
const tagsOf = (exits: readonly Exit.Exit<unknown, unknown>[]) =>
  exits
    .map((exit) =>
      Exit.isSuccess(exit) && typeof exit.value === 'object' && exit.value !== null && '_tag' in exit.value ? exit.value._tag : 'Failed',
    )
    .sort();
const seed = Effect.fnUntraced(function* (scene: StartupCase) {
  const { demo, files } = scene;
  yield* files.makeDirectory(join(demo.demoRoot, 'src'), { recursive: true });
  yield* files.writeFileString(join(demo.demoRoot, 'src/model.ts'), 'export const model = 1;\n');
  yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
  yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
  yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
  yield* gitEffect(demo.demoRoot, ['add', '.']);
  yield* gitEffect(demo.demoRoot, ['commit', '-qm', 'seed']);
});
const applied = Effect.fnUntraced(function* (scene: StartupCase, id: number, lines = 10, op = 'submit_work') {
  const { demo, workers } = scene;
  const row = yield* demo.graph.blocks.blockById(id);
  const key = `size-${lines}`;
  demo.described.set(key, inspection(lines));
  return yield* enforcementApplied(row, {
    strictness: 'gate',
    inspection: key,
    on: [{ op, phase: 'before' }],
    caller: null,
    subjectOf: () => 'tree',
    base: yield* enforcementBaseOf(row),
  }).pipe(Effect.provide(withLanes(demo.context, workers)));
});
const boot = Effect.fnUntraced(function* (scene: StartupCase, options: BootOptions) {
  const { demo } = scene;
  const scope = yield* Scope.fork(yield* Effect.scope);
  const done = yield* Queue.unbounded<readonly Exit.Exit<unknown, unknown>[]>();
  const exits: Exit.Exit<unknown, unknown>[] = [];
  let scans = 0;
  let active = 0;
  let maximum = 0;
  let heads = 0;
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      if (span.name === 'enforcement.placeOf') heads += 1;
      if (span.name === 'enforcement.measureReach') {
        scans += 1;
        maximum = Math.max(maximum, ++active);
      }
      const end = span.end.bind(span);
      span.end = (at, exit) => {
        end(at, exit);
        if (span.name === 'enforcement.measureReach') active -= 1;
        if (span.name === 'enforcement.startRules' && Exit.isSuccess(exit) && Array.isArray(exit.value) && exit.value.length === 0)
          exits.push(Exit.succeed({ _tag: 'Skipped' }));
        else if (span.name === 'enforcement.remeasureRule') exits.push(exit);
        else return;
        if (exits.length === completed || tagsOf([exit])[0] === completed) Queue.offerUnsafe(done, [...exits]);
      };
      return span;
    },
  });
  const completed = options.completed;
  const driver = yield* Scope.provide(
    driverOver({
      graphOf: (_, root) =>
        Effect.andThen(
          options.barrier ?? Effect.void,
          Effect.succeed(
            withLanes(demo.context, options.lanes).pipe(
              Context.add(MeasuredCheckout, { projectId: demo.projectId, path: root ?? demo.demoRoot }),
              Context.add(Tracer.Tracer, tracer),
            ),
          ),
        ),
      memory: options.memory,
      delayMs: 0,
      journal: options.journal,
      coverage: fixedCoverage(
        demo.projectId,
        [demo.demoRoot, ...(options.covered ?? options.opened ?? [])].map((root, at) => ({ checkout: `copy-${at}`, root })),
      ),
    }).pipe(Effect.withTracer(tracer)),
    scope,
  );
  for (const root of options.opened ?? []) driver.opened(demo.projectId, root);
  return {
    driver,
    done: Queue.take(done),
    counts: () => ({ scans, maximum }),
    headReads: () => heads,
    close: Scope.close(scope, Exit.void),
  };
});
class Workers extends Context.Service<Workers, Closable>()('enforcement/testing/StartupWorkers') {}
const workersLayer = Layer.effect(
  Workers,
  Effect.acquireRelease(
    Effect.sync(() => workerLanes('fixture-inspection')),
    (workers) => Effect.sync(() => workers.close()),
  ),
);
class World extends Context.Service<World, EffectDemo>()('enforcement/testing/StartupWorld') {}
const worldLayer = Layer.effect(
  World,
  Effect.gen(function* () {
    const fixture = graphFixture({ projects: ['stale', 'journal', 'interrupted'] });
    return (yield* Effect.acquireRelease(fixture.openEffect(), () => Effect.orDie(fixture.releaseEffect))).effects;
  }),
);
const withCase = Effect.fnUntraced(function* <A, E, R>(body: (scene: StartupCase) => Effect.Effect<A, E, R>, project?: string) {
  const world = yield* World;
  const at = project === undefined ? { id: world.projectId, root: world.demoRoot } : world.project(project);
  const demo = { ...world, projectId: at.id, demoRoot: at.root };
  const workers = yield* Workers;
  const files = yield* FileSystem.FileSystem;
  return yield* body({ demo, workers, files }).pipe(Effect.provide(demo.context));
});

layer(Layer.mergeAll(worldLayer, BunFileSystem.layer, workersLayer), { excludeTestServices: true })('remeasurement startup', (it) => {
  it.effect(
    'reopening copies reuses persisted tree identity while changed trees, declarations and implementations are measured sequentially',
    () =>
      withCase((scene) =>
        Effect.gen(function* () {
          const { demo, workers, files } = scene;
          yield* seed(scene);
          const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Files stay small' });
          yield* applied(scene, rule.id);
          const other = yield* demo.fixture.directory('other-checkout');
          yield* files.copy(demo.demoRoot, other, { overwrite: true });
          for (const root of [demo.demoRoot, other])
            yield* files.remove(join(root, '.git/tagma/measured'), { recursive: true, force: true });
          const memory = join(demo.fixture.root, 'enforcing.json');
          yield* files.writeFileString(memory, JSON.stringify([demo.demoRoot, other].map((root) => ({ projectId: demo.projectId, root }))));
          const clock = yield* Clock.Clock;
          const started = clock.monotonicTimeNanosUnsafe();
          const cold = yield* boot(scene, { lanes: workers, memory, completed: 2, opened: [other] });
          expect(tagsOf(yield* cold.done)).toEqual(['Measured', 'Measured']);
          expect(cold.counts()).toEqual({ scans: 2, maximum: 1 });
          yield* cold.close;
          const warmAt = clock.monotonicTimeNanosUnsafe();
          const warm = yield* boot(scene, { lanes: workers, memory, completed: 2, opened: [other] });
          expect(tagsOf(yield* warm.done)).toEqual(['Skipped', 'Skipped']);
          expect(warm.counts()).toEqual({ scans: 0, maximum: 0 });
          expect(warm.headReads()).toBe(2);
          yield* Console.log(
            JSON.stringify({
              sample: 'remeasure-repeat-start',
              checkouts: 2,
              rules: 1,
              headReads: warm.headReads(),
              coldMs: Math.round(Number(warmAt - started) / 1_000_000),
              warmMs: Math.round(Number(clock.monotonicTimeNanosUnsafe() - warmAt) / 1_000_000),
              scans: warm.counts().scans,
              maximum: cold.counts().maximum,
            }),
          );
          yield* warm.close;
          yield* files.writeFileString(join(demo.demoRoot, 'src/model.ts'), 'export const model = 2;\n');
          yield* gitEffect(demo.demoRoot, ['add', '.']);
          yield* gitEffect(demo.demoRoot, ['commit', '-qm', 'changed tree']);
          const changed = yield* boot(scene, { lanes: workers, memory, completed: 1, covered: [other] });
          expect(tagsOf(yield* changed.done)).toEqual(['Measured']);
          expect(changed.counts()).toEqual({ scans: 1, maximum: 1 });
          yield* changed.close;
          yield* applied(scene, rule.id, 5);
          const redeclared = yield* boot(scene, { lanes: workers, memory, completed: 2, opened: [other] });
          expect(tagsOf(yield* redeclared.done)).toEqual(['Measured', 'Skipped']);
          expect(redeclared.counts()).toEqual({ scans: 1, maximum: 1 });
          yield* redeclared.close;
          const implementation = yield* boot(scene, {
            lanes: { ...workers, code: 'changed-inspection' },
            memory,
            completed: 1,
            covered: [other],
          });
          expect(tagsOf(yield* implementation.done)).toEqual(['Measured']);
          expect(implementation.counts()).toEqual({ scans: 1, maximum: 1 });
          yield* implementation.close;
          const unconfirmed = yield* boot(scene, { lanes: { ...workers, code: undefined }, memory, completed: 1, covered: [other] });
          expect(tagsOf(yield* unconfirmed.done)).toEqual(['Measured']);
          expect(unconfirmed.counts()).toEqual({ scans: 1, maximum: 1 });
          yield* unconfirmed.close;
        }),
      ),
  );

  it.effect('a declaration changed during inspection rejects the stale result without overwriting the accepted measurement', () =>
    withCase(
      (scene) =>
        Effect.gen(function* () {
          const { demo, workers, files } = scene;
          const gate = yield* Deferred.make<void>();
          const entered = yield* Deferred.make<void>();
          yield* seed(scene);
          const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Files stay small' });
          yield* applied(scene, rule.id);
          const memory = join(demo.fixture.root, 'enforcing.json');
          yield* files.writeFileString(memory, JSON.stringify([{ projectId: demo.projectId, root: demo.demoRoot }]));
          const paused: Lanes = {
            ...workers,
            code: 'changed-inspection',
            reach: (ask, priority) =>
              Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(gate)), Effect.andThen(workers.reach(ask, priority))),
          };
          const changing = yield* boot(scene, { lanes: paused, memory, completed: 'Stale' });
          yield* Effect.gen(function* () {
            yield* Deferred.await(entered);
            yield* applied(scene, rule.id, 5);
            const measured = join(demo.demoRoot, '.git/tagma/measured', `${rule.uuid}.json`);
            const accepted = yield* files.readFileString(measured);
            yield* Deferred.succeed(gate, undefined);
            expect(tagsOf(yield* changing.done)).toEqual(['Stale']);
            expect(yield* files.readFileString(measured)).toBe(accepted);
            yield* changing.close;
          }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined)));
        }),
      'stale',
    ),
  );

  it.effect('journal entries for one commit preserve different operations and paths until each is settled', () =>
    withCase(
      (scene) =>
        Effect.gen(function* () {
          const { demo, workers, files } = scene;
          yield* seed(scene);
          const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Files stay small' });
          const measured = yield* applied(scene, rule.id, 10, 'merge_worktree');
          const journal = journalOver(demo.graph.store.db, demo.graph.units);
          const memory = join(demo.fixture.root, 'enforcing.json');
          yield* files.writeFileString(memory, '[]');
          const gate = yield* Deferred.make<void>();
          const settled = yield* Queue.unbounded<void>();
          const observed: LandingJournal = {
            ...journal,
            remove: (key) => journal.remove(key).pipe(Effect.tap(() => Queue.offer(settled, undefined))),
          };
          const drive = yield* boot(scene, {
            lanes: workers,
            memory,
            completed: 'Measured',
            journal: observed,
            barrier: Deferred.await(gate),
          });
          yield* Effect.gen(function* () {
            const landing = {
              kind: 'tree' as const,
              projectId: demo.projectId,
              root: demo.demoRoot,
              commit: measured.head!,
              paths: ['README.md'],
            };
            yield* drive.driver.landed('merge_worktree', landing);
            yield* drive.driver.landed('merge_worktree', { ...landing, paths: ['src/model.ts'] });
            yield* drive.driver.landed('submit_work', { ...landing, paths: ['src/model.ts'] });
            expect((yield* journal.page(null, 10)).map((row) => `${row.landing?.op}:${row.landing?.paths.join(',')}`).sort()).toEqual([
              'merge_worktree:README.md',
              'merge_worktree:src/model.ts',
              'submit_work:src/model.ts',
            ]);
            yield* Deferred.succeed(gate, undefined);
            expect(tagsOf(yield* drive.done)).toContain('Measured');
            for (let index = 0; index < 3; index += 1) yield* Queue.take(settled);
            expect(yield* journal.page(null, 10)).toEqual([]);
            yield* drive.close;
          }).pipe(Effect.ensuring(Deferred.succeed(gate, undefined)));
        }),
      'journal',
    ),
  );

  it.effect('a failed and interrupted landing preserves its last measurement and is replayed from the journal', () =>
    withCase(
      (scene) =>
        Effect.gen(function* () {
          const { demo, workers, files } = scene;
          yield* seed(scene);
          const rule = yield* demo.graph.blocks.create({ projectId: demo.projectId, tags: ['rule'], title: 'Files stay small' });
          const planned = yield* applied(scene, rule.id);
          const measured = join(demo.demoRoot, '.git/tagma/measured', `${rule.uuid}.json`);
          const prior = yield* files.readFileString(measured);
          const memory = join(demo.fixture.root, 'enforcing.json');
          yield* files.writeFileString(memory, '[]');
          const journal = journalOver(demo.graph.store.db, demo.graph.units);
          const entered = yield* Deferred.make<void>();
          let attempts = 0;
          const failing: Lanes = {
            ...workers,
            reach: (ask, priority) =>
              Effect.suspend(() => {
                attempts += 1;
                return attempts === 1
                  ? workers.reach({ ...ask, commit: '0'.repeat(40) }, priority)
                  : Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
              }),
          };
          const cut = yield* boot(scene, { lanes: failing, memory, completed: 2, journal });
          yield* cut.driver.landed('submit_work', {
            kind: 'tree',
            projectId: demo.projectId,
            root: demo.demoRoot,
            commit: planned.head!,
            paths: ['src/model.ts'],
          });
          yield* Deferred.await(entered);
          yield* cut.close;
          expect(yield* files.readFileString(measured)).toBe(prior);
          expect(yield* journal.page(null, 10)).toHaveLength(1);
          const removed = yield* Deferred.make<void>();
          const observed: LandingJournal = {
            ...journal,
            remove: (key) => journal.remove(key).pipe(Effect.tap(() => Deferred.succeed(removed, undefined))),
          };
          const replay = yield* boot(scene, { lanes: workers, memory, completed: 'Measured', journal: observed });
          expect(tagsOf(yield* replay.done)).toContain('Measured');
          expect(replay.counts().maximum).toBe(1);
          expect(yield* files.readFileString(measured)).not.toBe(prior);
          yield* Deferred.await(removed);
          yield* replay.close;
          expect(yield* journal.page(null, 10)).toEqual([]);
        }),
      'interrupted',
    ),
  );
});
