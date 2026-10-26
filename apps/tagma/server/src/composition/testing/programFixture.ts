import { kind, shared } from '@runlith/testbed/worlds';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { ProgramInvocation } from '@tagma/inspection/program';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { landingAdmission } from '../preparedChanges.js';
import { Context, Effect, FileSystem, Layer, PlatformError, Scope } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { claimPreparedInstance, preparedBase } from '../../change-record/testing/doubles.js';
import { judgingFns } from '../../change-record/testing/doubles.js';
import { eligiblePaths, pathChunks } from '../../change-record/testing/doubles.js';
import {
  evidenceInGroups,
  makePreparedChanges,
  quietCommands,
  pathsOfThread,
  prepareChange,
  recordWrite,
  releasePrepared,
} from '../../change-record/testing/doubles.js';
import type { PreparedInstance } from '../../change-record/prepared/subject.js';
import { actChecks, RuleChecks } from '../../enforcement/contract/service/ruleChecks.js';
import { based, type Unbased } from '../../enforcement/testing/based.js';
import { enforcementBodies } from '../../enforcement/testing/bodies.js';
import { UNBOUND_CHECKS } from '../../enforcement/testing/doubles.js';
import { changeChecked, checksOver, type Lanes, quiet, targetsOf, withLanes, workerLanes } from '../../enforcement/testing/wiring.js';
import { type ProgramLaunch, ProgramRoad } from '../../executions/contract/service/programs.js';
import { localRoad } from '../../executions/testing/road.js';
import { CHECKOUT_DIRECTORY } from '../../graph/contract/wire/storage.js';
import type { EnforcedStrictness, LawEnforcement } from '../../graph/contract/wire/enforcement.js';
import type { ProgramInspection } from '../../config/contract/wire/config.js';
import { TRIGGERS } from '../../graph/testing/triggers.js';
import { OperationCatalog } from '../../invocation/contract/service/catalog.js';
import { OperationChecks } from '../../invocation/contract/service/operationChecks.js';
import { forProject, withGraphCall } from '../../invocation/testing/call.js';
import { perform } from '../../invocation/testing/performing.js';
import { submitOver } from '../../landing/testing/doubles.js';
import { landingServices } from './landingServices.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import type { WorkingOrigin } from '../../workspace/contract/wire/place.js';
import { TEST_CHECKOUT, testPlace } from '../../workspace/testing/doubles.js';
import { operationChecks } from '../operationChecks.js';
import { checkSubjectOf } from '../catalog.js';
import { MINE, PLACE } from './checkoutFixture.js';
import {
  DemoGraphs,
  type DemoServices,
  type EffectDemo,
  demoGraphLayer,
  DemoGraphUnbuilt,
  DemoGraphStillHeld,
  gitEffect,
} from './graphFixture.js';
import { fixtureOperationCatalog } from './nativeCatalog.js';

const CHECK = `
const filesOf = async (side) =>
  Promise.all(side.paths.filter((path) => path.startsWith('src/')).map(async (path) => ({ path, text: (await side.read(path)) ?? '' })));
const found = (files) => files.flatMap(({ path, text }) => text.split('\\n').flatMap((line, at) => {
  if (!line.includes('FORBIDDEN')) return [];
  const one = line.slice(line.indexOf('FORBIDDEN')).trim();
  return [{ fingerprint: path + ' × ' + one, path, line: at + 1, message: 'forbidden: ' + one }];
}));
export default {
  forbidden: async ({ tree, base }) => {
    const changed = await filesOf(tree);
    const marked = (marker) => changed.some(({ text }) => text.includes(marker));
    if (marked('CRASH')) { console.error('crashed reading the change'); process.exit(3); }
    if (marked('GARBAGE')) { process.stdout.write('this is no verdict'); process.exit(0); }
    if (marked('SLEEP')) { console.error('sleeping past the budget'); await Bun.sleep(20000); }
    return { tree: { findings: found(changed) }, base: base === null ? undefined : { findings: found(await filesOf(base)) } };
  },
};
`;

export const BOUND = 'forbidden';

export const FORBIDDEN: ProgramInspection = { program: 'tools/check.js', name: 'forbidden', concern: 'code', needs: [], params: {} };

export const fp = (text: string) => `${BOUND} ${text}`;

export const SEEDED = fp('src/a.ts × FORBIDDEN one');

const makeProgram = Effect.fnUntraced(function* (
  demo: EffectDemo,
  workers: Lanes,
  road: ProgramRoad['Service'],
  launches: ProgramLaunch[],
  rule: string,
  owner: string,
) {
  const files = yield* FileSystem.FileSystem;
  const services = yield* Effect.provide(landingServices, demo.context);
  const operationCatalog = yield* fixtureOperationCatalog;
  const bodies = enforcementBodies(checkSubjectOf);
  let prepared: PreparedInstance | undefined;
  yield* Effect.addFinalizer(() => (prepared === undefined ? Effect.void : prepared.release));
  const current = () => demo;

  const at = (path: string) => join(demo.demoRoot, path);

  const put = Effect.fn('programFixture.put')(function* (path: string, text: string) {
    yield* files.makeDirectory(dirname(at(path)), { recursive: true });
    yield* files.writeFileString(at(path), text);
  });

  const committed = Effect.fnUntraced(function* (message: string) {
    yield* gitEffect(demo.demoRoot, ['add', '-A']);
    yield* gitEffect(demo.demoRoot, ['commit', '-qm', message]);
  });

  const revision = (name: string) =>
    Effect.map(spawnedEffect(['git', 'rev-parse', name], { cwd: demo.demoRoot }), (run) => run.stdout.toString().trim());

  const operator: Caller = { actor: { kind: 'operator' }, files: null };

  const created = Effect.fnUntraced(function* (tags: string[], title: string) {
    return yield* demo.nameOf((yield* demo.graph.blocks.create({ projectId: demo.projectId, tags, title })).id);
  });

  const served = () => withLanes(demo.context, workers).pipe(Context.add(ProgramRoad, road));

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

  const enforce = (input: Omit<Unbased, 'blockId'>) =>
    Effect.flatMap(based({ blockId: rule, ...input }), (full) => perform(bodies.enforce_rule, full, operator)).pipe(
      Effect.provide(served()),
      Effect.provideService(RuleChecks, UNBOUND_CHECKS),
      Effect.provideService(OperationChecks, operationChecks(UNBOUND_CHECKS)),
      Effect.provideService(OperationCatalog, operationCatalog),
      Effect.provideContext(quiet(workers)),
      forProject(projectCall()),
      withGraphCall(projectCall()),
    );

  const enforcedAt = (strictness: EnforcedStrictness, owners: Readonly<Record<string, string>> = { [SEEDED]: owner }) =>
    enforce({ strictness, on: TRIGGERS.landing, inspection: BOUND, owners });

  const documentOf = Effect.fnUntraced(function* () {
    const row = yield* Effect.flatMap(demo.graph.blockNames.idOfName(rule), (id) => demo.graph.blocks.blockById(id));
    return row.fields.enforcement as LawEnforcement;
  });

  const originFor = (threadId: string) => ({ ...PLACE, generation: 0, work: { projectId: demo.projectId, threadId } }) as WorkingOrigin;

  const wroteAs = Effect.fn('programFixture.wrote')(function* (threadId: string, path: string, text: string) {
    const before = (yield* files.exists(at(path))) ? yield* files.readFileString(at(path)) : '';
    yield* put(path, text);
    yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, threadId, testPlace(path), {
      before,
      after: text,
      mode: '100644',
    });
  });

  const wrote = (path: string, text: string) => wroteAs(MINE, path, text);

  const checks = actChecks(checksOver({ graphOf: () => Effect.succeed(served()) }), 'submit_work');

  const landing = Effect.fnUntraced(function* (paths?: readonly string[], whole = false) {
    const inst = yield* claimPreparedInstance(preparedBase(demo.graph.store));
    const producer = makePreparedChanges(
      { commands: quietCommands, pathsOfThread, evidenceInGroups },
      landingAdmission(makeLandingHolds()),
      judgingFns(CHECKOUT_DIRECTORY),
      inst.dir,
    );
    return yield* Effect.ensuring(
      submitOver(
        demo.graph.git,
        demo.demoRoot,
        demo.graph.store,
        demo.graph.units,
        originFor(MINE),
        {
          projectId: demo.projectId,
          tasks: [],
          taking: [],
          paths,
          whole: whole ? ['.'] : undefined,
        },
        checks,
        producer,
      ).pipe(Effect.provideContext(services)),
      inst.release,
    );
  });

  const inputOf = (launch: ProgramLaunch | undefined): ProgramInvocation => JSON.parse(launch?.stdin ?? 'null') as ProgramInvocation;

  const checkedChange = Effect.fnUntraced(
    function* (whole = false) {
      const caller = { _tag: 'Thread' as const, threadId: ThreadId.make(MINE), projectId: demo.projectId };
      const ask = { projectId: demo.projectId, caller, rules: 'all' as const };
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
          origin: originFor(MINE),
          checkout: TEST_CHECKOUT,
          input: { taking: [], whole: whole ? ['.'] : undefined },
          job: `check:${randomUUID()}`,
          caller,
          act: { kind: 'thread', ...originFor(MINE).work },
        },
      );
      if (made === null) return null;
      const version = { projectId: demo.projectId, actor: caller, root: made.subject.root, tree: made.subject.built };
      return yield* targetsOf(ask, version).pipe(
        Effect.flatMap((targets) => changeChecked(ask, targets, made.subject)),
        Effect.ensuring(releasePrepared(made)),
      );
    },
    (effect, _whole = false) => Effect.provide(effect, served()),
  );

  return {
    launches,
    current,
    context: served,
    created,
    put,
    committed,
    revision,
    enforce,
    enforcedAt,
    documentOf,
    wrote,
    wroteAs,
    landing,
    inputOf,
    checkedChange,
    rule: () => rule,
    owner: () => owner,
  };
});

export type ProgramFixture = Effect.Success<ReturnType<typeof makeProgram>>;

export class ProgramFixtures extends Context.Service<
  ProgramFixtures,
  {
    use<A, E, R>(
      body: (gate: ProgramFixture) => Effect.Effect<A, E, R>,
    ): Effect.Effect<
      A,
      E | DemoGraphUnbuilt | DemoGraphStillHeld | PlatformError.PlatformError,
      Exclude<Exclude<Exclude<R, FileSystem.FileSystem>, Scope.Scope>, DemoServices>
    >;
    readonly timing: { timeMs: number | undefined };
  }
>()('testing/ProgramFixtures') {}

const programWorld = kind(ProgramFixtures, (_params: null, home) =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const workers = yield* Effect.acquireRelease(Effect.sync(workerLanes), (lanes) => Effect.sync(() => lanes.close()));
    const launches: ProgramLaunch[] = [];
    const timing: { timeMs: number | undefined } = { timeMs: undefined };
    const road = localRoad(launches, timing);
    yield* files.makeDirectory(home, { recursive: true });
    const seed = join(home, 'seed');
    let rule = '';
    let owner = '';
    const demos = Context.get(
      yield* Layer.build(
        demoGraphLayer({
          prepareEffect: Effect.fnUntraced(function* (demo) {
            const first = yield* makeProgram(demo, workers, road, launches, '', '');
            yield* gitEffect(demo.demoRoot, ['init', '-q', '-b', 'main']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.email', 'tagma@test']);
            yield* gitEffect(demo.demoRoot, ['config', 'user.name', 'tagma']);
            yield* first.put('tools/check.js', CHECK);
            yield* first.put('src/a.ts', 'export const a = 1; // FORBIDDEN one\n');
            yield* first.committed('seed');
            yield* files.copy(demo.demoRoot, seed, { overwrite: true });
            rule = yield* first.created(['rule'], 'Nothing forbidden lands');
            owner = yield* first.created(['task'], 'Take the forbidden line out of a.ts');
          }, Effect.scoped),
        }),
      ),
      DemoGraphs,
    );
    return ProgramFixtures.of({
      timing,
      use: (body) =>
        demos.use((demo) =>
          Effect.scoped(
            Effect.gen(function* () {
              launches.length = 0;
              if (!(yield* files.exists(join(demo.demoRoot, '.git')))) yield* files.copy(seed, demo.demoRoot, { overwrite: true });
              demo.described.set(BOUND, FORBIDDEN);
              return yield* Effect.flatMap(makeProgram(demo, workers, road, launches, rule, owner), body);
            }).pipe(Effect.provideService(FileSystem.FileSystem, files)),
          ),
        ),
    });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);

export const programFixture = (options: { readonly timeMs?: number } = {}) =>
  Layer.effect(
    ProgramFixtures,
    Effect.tap(shared(programWorld, null), (world) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          world.timing.timeMs = options.timeMs;
        }),
        () =>
          Effect.sync(() => {
            world.timing.timeMs = undefined;
          }),
      ),
    ),
  );

export const withProgram = <A, E, R>(body: (gate: ProgramFixture) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(ProgramFixtures, (fixtures) => fixtures.use(body));
