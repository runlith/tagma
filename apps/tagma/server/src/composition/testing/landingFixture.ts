import { kind, shared } from '@runlith/testbed/worlds';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Context, Effect, FileSystem, Layer, PlatformError, Scope } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { checkSubjectOf } from '../catalog.js';
import {
  changeChecked,
  checksOver,
  enforcementApplied,
  enforcementBaseOf,
  type Lanes,
  quiet,
  targetsOf,
  unqueued,
  withLanes,
  workerLanes,
} from '../../enforcement/testing/wiring.js';
import { GIT_COMMIT } from '../../enforcement/contract/wire/checks.js';
import { type ActChecks, actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import {
  DemoGraphs,
  type EffectDemo,
  type DemoServices,
  DemoGraphUnbuilt,
  DemoGraphStillHeld,
  demoGraphLayer,
  gitEffect,
  refusalOf,
} from './graphFixture.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { type EnforcedStrictness, type Trigger } from '../../graph/contract/wire/enforcement.js';
import { TRIGGERS } from '../../graph/testing/triggers.js';
import type { SubmitReceipt } from '../../landing/contract/wire/receipt.js';
import type { WorkingOrigin } from '../../workspace/contract/wire/place.js';
import { TEST_CHECKOUT, testPlace } from '../../workspace/testing/doubles.js';
import { PLACE } from './checkoutFixture.js';
import { submitOver } from '../../landing/testing/doubles.js';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmission } from '../preparedChanges.js';
import { evidenceInGroups } from '../../change-record/testing/doubles.js';
import { pathsOfThread } from '../../change-record/testing/doubles.js';
import { recordWrite } from '../../change-record/testing/doubles.js';
import { claimPreparedInstance, preparedBase } from '../../change-record/testing/doubles.js';
import type { PreparedInstance } from '../../change-record/prepared/subject.js';
import { judgingFns } from '../../change-record/testing/doubles.js';
import { eligiblePaths, pathChunks } from '../../change-record/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import { prepareChange, releasePrepared, makePreparedChanges } from '../../change-record/testing/doubles.js';
import { quietCommands } from '../../change-record/testing/doubles.js';
import { LAYERED_KEY, layeredDrawn } from '../../enforcement/testing/layered.js';
import { CommitLandings } from '../../landing/contract/service/commitLandings.js';
import { landingServices } from './landingServices.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { PreparedChanges } from '../../change-record/contract/service/prepared.js';
import { ServingGit } from '../../executions/contract/service/git.js';
import { UNBOUND_CHECKS } from '../../enforcement/testing/doubles.js';
import { OperationChecks } from '../../invocation/contract/service/operationChecks.js';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import { fixtureOperationCatalog } from './nativeCatalog.js';
import { operationChecks } from '../operationChecks.js';
import { enforcementBodies } from '../../enforcement/testing/bodies.js';
import { perform } from '../../invocation/testing/performing.js';
import { based, type Unbased } from '../../enforcement/testing/based.js';
import { forProject, inWorkspace, withGraphCall } from '../../invocation/testing/call.js';

const bodies = enforcementBodies(checkSubjectOf);

export type Asked = {
  readonly whole?: readonly string[];
  readonly paths?: readonly string[];
  readonly faces?: Lanes;
  readonly checks?: ActChecks;
};

const makeLanding = Effect.fnUntraced(function* (demo: EffectDemo, workers: Lanes, rule: string) {
  const files = yield* FileSystem.FileSystem;
  const services = yield* Effect.provide(landingServices, demo.context);
  const operationCatalog = yield* fixtureOperationCatalog;
  let prepared: PreparedInstance | undefined;
  yield* Effect.addFinalizer(() => (prepared === undefined ? Effect.void : prepared.release));

  const at = (path: string) => join(demo.demoRoot, path);

  const put = Effect.fn('landingFixture.put')(function* (path: string, text: string) {
    yield* files.makeDirectory(dirname(at(path)), { recursive: true });
    yield* files.writeFileString(at(path), text);
  });

  const sh = (args: readonly string[]) =>
    Effect.map(spawnedEffect(['git', ...args], { cwd: demo.demoRoot }), (run) => run.stdout.toString().trim());

  const committed = Effect.fnUntraced(function* (message: string) {
    yield* gitEffect(demo.demoRoot, ['add', '-A']);
    yield* gitEffect(demo.demoRoot, ['commit', '-qm', message]);
  });

  const created = Effect.fnUntraced(function* (tags: string[], title: string) {
    return yield* demo.nameOf((yield* demo.graph.blocks.create({ projectId: demo.projectId, tags, title })).id);
  });

  const enforcedAt = Effect.fnUntraced(function* (
    strictness: EnforcedStrictness,
    owners?: Readonly<Record<string, string>>,
    on: readonly Trigger[] = TRIGGERS.landing,
  ) {
    const graph = demo;
    const row = yield* Effect.flatMap(graph.graph.blockNames.idOfName(rule), (id) => graph.graph.blocks.blockById(id));
    const base = yield* enforcementBaseOf(row);
    const ask = {
      strictness,
      on,
      inspection: LAYERED_KEY,
      caller: null,
      subjectOf: checkSubjectOf,
      base,
      owners,
    };
    yield* enforcementApplied(row, ask).pipe(Effect.provideContext(quiet(workers)));
  });

  const originFor = (threadId: string) => ({ ...PLACE, generation: 0, work: { projectId: demo.projectId, threadId } }) as WorkingOrigin;

  const wrote = Effect.fn('landingFixture.wrote')(function* (threadId: string, path: string, text: string | null) {
    const before = (yield* files.exists(at(path))) ? yield* files.readFileString(at(path)) : '';
    if (text === null) yield* files.remove(at(path));
    else yield* put(path, text);
    yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, threadId, testPlace(path), {
      before,
      after: text,
      mode: '100644',
    });
  });

  const checksWith = (faces: Lanes): ActChecks => {
    const graphOf = () => Effect.succeed(withLanes(demo.context, faces));
    return actChecks(checksOver({ graphOf }), 'submit_work');
  };

  const producerAt = (dir: string) =>
    makePreparedChanges(
      { commands: quietCommands, pathsOfThread, evidenceInGroups },
      landingAdmission(makeLandingHolds()),
      judgingFns(CHECKOUT_DIRECTORY),
      dir,
    );

  const landing = Effect.fnUntraced(function* (threadId: string, asked: Asked = {}) {
    const inst = yield* claimPreparedInstance(preparedBase(demo.graph.store));
    const producer = producerAt(inst.dir);
    return yield* Effect.ensuring(
      Effect.provideContext(
        submitOver(
          demo.graph.git,
          demo.demoRoot,
          demo.graph.store,
          demo.graph.units,
          originFor(threadId),
          {
            projectId: demo.projectId,
            tasks: [],
            taking: [],
            whole: asked.whole,
            paths: asked.paths,
          },
          asked.checks ?? checksWith(asked.faces ?? workers),
          producer,
        ),
        services,
      ),
      inst.release,
    );
  });

  const projectCall = () =>
    demo.table().pipe(
      Effect.orDie,
      Effect.map((vocabulary) => ({
        project: { id: demo.projectId, name: 'demo' },
        vocabulary,
        lens: { scope: undefined, names: 'law-and-reflections' as const },
        deliveredTags: new Set<string>(),
      })),
    );

  const threadOf = (threadId: string): Caller => ({
    actor: {
      kind: 'thread',
      threadId,
      projectId: demo.projectId,
      principalId: 'operator',
      session: { harness: 'tagma', key: threadId },
    },
    files: null,
  });

  const enforcing = Effect.fnUntraced(function* (threadId: string, input: Unbased) {
    const inst = yield* claimPreparedInstance(preparedBase(demo.graph.store));
    const performed = Effect.flatMap(based(input), (full) => perform(bodies.enforce_rule, full, threadOf(threadId))).pipe(
      inWorkspace({ root: demo.demoRoot, origin: originFor(threadId) }),
      Effect.provideService(PreparedChanges, producerAt(inst.dir)),
      Effect.provideService(ServingGit, { run: (_act, platform) => Effect.succeed(platform) }),
      Effect.provideContext(quiet(workers)),
      Effect.provideService(RuleChecks, UNBOUND_CHECKS),
      Effect.provideService(OperationChecks, operationChecks(UNBOUND_CHECKS)),
      Effect.provideService(OperationCatalog, operationCatalog),
      forProject(projectCall()),
      withGraphCall(projectCall()),
    );
    return yield* Effect.ensuring(Effect.provideContext(performed, services), inst.release);
  });

  const landed = (receipt: SubmitReceipt) => {
    if (receipt.status !== 'landed') throw new Error(`expected a landing, got ${JSON.stringify(receipt)}`);
    return receipt;
  };

  return {
    workers,
    commitLandings: Context.get(services, CommitLandings),
    get demo() {
      return demo;
    },
    get rule() {
      return rule;
    },
    put,
    sh,
    committed,
    created,
    enforcedAt,
    enforced: (threadId: string, input: Unbased) => enforcing(threadId, input),
    enforceRefused: (threadId: string, input: Unbased) => refusalOf(enforcing(threadId, input)),
    wrote,
    landing,
    landed,
    submit: (threadId: string, asked: Asked = {}) => landing(threadId, asked),
    staged: () =>
      checksOver({
        graphOf: () => Effect.succeed(withLanes(demo.context, workers)),
        commits: { git: demo.graph.git, projectAt: () => Effect.succeed(demo.projectId), queue: unqueued },
      }).before(GIT_COMMIT, { kind: 'staged', projectId: demo.projectId, root: demo.demoRoot, gate: false }),
    refused: (threadId: string, asked: Asked = {}) => refusalOf(landing(threadId, asked)),
    checked: Effect.fnUntraced(
      function* (threadId: string, asked: Asked = {}) {
        const ask = { projectId: demo.projectId, caller: null, rules: 'all' as const };
        if (prepared === undefined) prepared = yield* claimPreparedInstance(preparedBase(demo.graph.store));
        const { prepared: made } = yield* prepareChange(
          { commands: quietCommands, pathsOfThread, evidenceInGroups },
          judgingFns(CHECKOUT_DIRECTORY),
          prepared.dir,
          {
            projectId: demo.projectId,
            git: demo.graph.git,
            root: demo.demoRoot,
            store: demo.graph.store,
            units: demo.graph.units,
            origin: originFor(threadId),
            checkout: TEST_CHECKOUT,
            input: {
              taking: [],
              whole: asked.whole,
              paths: asked.paths,
            },
            job: `check:${randomUUID()}`,
            caller: { _tag: 'Thread' as const, threadId: ThreadId.make(threadId), projectId: demo.projectId },
            act: { kind: 'thread', threadId, projectId: demo.projectId },
          },
        );
        if (made === null) return null;
        const version = {
          projectId: demo.projectId,
          actor: { _tag: 'Operator' } as const,
          root: made.subject.root,
          tree: made.subject.built,
        };
        const targets = yield* targetsOf(ask, version);
        return yield* changeChecked(ask, targets, made.subject).pipe(Effect.ensuring(releasePrepared(made)));
      },
      (effect, _threadId, asked = {}) => Effect.provideContext(effect, quiet(asked.faces ?? workers)),
    ),
  };
});

export type LandingFixture = Effect.Success<ReturnType<typeof makeLanding>>;

export class LandingFixtures extends Context.Service<
  LandingFixtures,
  {
    use<A, E, R>(
      body: (gate: LandingFixture) => Effect.Effect<A, E, R>,
    ): Effect.Effect<
      A,
      E | DemoGraphUnbuilt | DemoGraphStillHeld | PlatformError.PlatformError,
      Exclude<Exclude<Exclude<R, FileSystem.FileSystem>, Scope.Scope>, DemoServices>
    >;
  }
>()('testing/LandingFixtures') {}

const landingWorld = kind(LandingFixtures, (_params: {}, home) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (lanes) => Effect.sync(() => lanes.close()));
    yield* files.makeDirectory(home, { recursive: true });
    const seed = join(home, 'seed');
    let rule = '';
    const demos = Context.get(
      yield* Layer.build(
        demoGraphLayer({
          prepareEffect: Effect.fnUntraced(function* (demo) {
            const first = yield* makeLanding(demo, workers, '');
            yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
            yield* first.put('src/core/model.ts', 'export const model = 1;\n');
            yield* first.put('src/ui/panel.ts', "import { model } from '../core/model';\nexport const panel = model;\n");
            yield* first.put('src/core/view.ts', "import { panel } from '../ui/panel';\nexport const view = panel;\n");
            yield* first.put('src/app/main.ts', "import { panel } from '../ui/panel';\nexport const main = panel;\n");
            yield* first.put('src/core/shared.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
            yield* first.committed('seed');
            yield* layeredDrawn(demo.projectId).pipe(Effect.provideContext(quiet(workers)));
            yield* files.copy(demo.demoRoot, seed, { overwrite: true });
            rule = yield* first.created(['rule'], 'Import only downward');
            const ready = yield* makeLanding(demo, workers, rule);
            yield* ready.enforcedAt('gate', {
              'app order core/view.ts -> ui/': yield* ready.created(['task'], 'Move the view off the panel'),
            });
          }, Effect.scoped),
        }),
      ),
      DemoGraphs,
    );
    return LandingFixtures.of({
      use: (body) =>
        demos.use((demo) =>
          Effect.scoped(
            Effect.gen(function* () {
              if (!(yield* files.exists(join(demo.demoRoot, '.git')))) yield* files.copy(seed, demo.demoRoot, { overwrite: true });
              return yield* Effect.flatMap(makeLanding(demo, workers, rule), body);
            }).pipe(Effect.provideService(FileSystem.FileSystem, files)),
          ),
        ),
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

export const landingFixture = () => Layer.effect(LandingFixtures, shared(landingWorld, {}));

export const withLanding = <A, E, R>(body: (gate: LandingFixture) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(LandingFixtures, (fixture) => fixture.use(body));
