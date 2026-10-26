import { expect } from 'bun:test';
import { dirname, join } from 'node:path';
import { Cause, Context, Deferred, Effect, Exit, Fiber, FileSystem, Queue, Stream } from 'effect';
import { ToolAnswer, type ToolFailed, toolExecute, toolPrepare } from '@runlith/agent/tool';
import { makeLandingHolds } from '@runlith/agent/thread/run/runAdmission';
import { PreparedChanges } from '../../../change-record/contract/service/prepared.js';
import { Holdings } from '../../../change-record/contract/service/holdings.js';
import { Retirement } from '../../../change-record/contract/service/retirement.js';
import { RuleChecks } from '../../../enforcement/contract/service/ruleChecks.js';
import { LandingGit } from '../../../landing/contract/service/servedGit.js';
import { ServingGit } from '../../../executions/contract/service/git.js';
import { CheckoutPaths } from '../../../workspace/contract/service/checkoutPaths.js';
import { WorkingOrigins } from '../../../workspace/contract/service/places.js';
import { bornThread } from '../../../native-harness/testing/born.js';
import {
  claimPreparedInstance,
  preparedBase,
  makePreparedChanges,
  quietCommands,
  pathsOfThread,
  evidenceInGroups,
  judgingFns,
  recordWrite,
} from '../../../change-record/testing/doubles.js';
import { holdingsAt, underCheckoutLanes } from '../../../landing/testing/doubles.js';
import { CHECKOUT_DIRECTORY } from '../../../graph/contract/wire/storage.js';
import { LineWrites } from '../../../change-record/contract/service/lineWrites.js';
import { landingAdmission } from '../../preparedChanges.js';
import { landingServices, provedOrigins } from '../landingServices.js';
import { MINE } from '../checkoutFixture.js';
import { fixtureNativeCatalog, fixtureServedGraphs } from '../nativeCatalog.js';
import { testSessionIdentity } from '../../../platform/testing/identity.js';
import { unthreadedCaller } from '../callers.js';
import { layer } from '@runlith/effect-test';
import { MeasuredCheckout, RoutedGraphs } from '../../../graph/contract/service/serving.js';
import { TRIGGERS } from '../../../graph/testing/triggers.js';
import { perform } from '../../../invocation/testing/performing.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { type LandingJournal, Remeasure } from '../../../enforcement/contract/service/remeasure.js';
import { LAYERED_KEY } from '../../../enforcement/testing/layered.js';
import { QUIET_CHECKOUTS, QUIET_DRIVER } from '../../../enforcement/testing/doubles.js';
import { checksOver, driverOver, journalOver, type Lanes, withLanes } from '../../../enforcement/testing/wiring.js';
import { fixedCoverage, gitCheckoutPaths, TEST_CHECKOUT, testPlace } from '../../../workspace/testing/doubles.js';
import { gitEffect } from '../graphFixture.js';
import { bodies, Enforcements, enforceFixture, operator, withEnforcement, type EnforcementFixture } from './enforceFixture.js';

const VIEW_DEBT = 'app order core/view.ts -> ui/';
const VIEW_FIXED = "import { model } from './model';\nexport const view = model;\n";
const VIEW_UPWARD = "import { panel } from '../ui/panel';\nexport const view = panel;\n";
const LATE_UPWARD = "import { main } from '../app/main';\nexport const late = main;\n";

const enforced = Effect.fnUntraced(function* (fixture: EnforcementFixture) {
  const rule = yield* fixture.created(['rule'], 'Import only downward');
  const owner = yield* fixture.created(['task'], 'Move the view off the panel');
  yield* fixture.working(
    perform(
      bodies.enforce_rule,
      {
        blockId: rule,
        base: null,
        strictness: 'gate',
        inspection: LAYERED_KEY,
        owners: { [VIEW_DEBT]: owner },
        on: TRIGGERS.landing,
      },
      operator,
    ).pipe(Effect.provideService(Remeasure, QUIET_DRIVER)),
  );
  expect((yield* fixture.documentOf(rule))?.debt.map((one) => one.fingerprint)).toEqual([VIEW_DEBT]);
  return rule;
});

const worktreeAt = Effect.fnUntraced(function* (fixture: EnforcementFixture, branch: string) {
  const files = yield* FileSystem.FileSystem;
  const at = yield* fixture.demo.fixture.directory(`copy-${branch}`);
  yield* files.makeDirectory(at, { recursive: true });
  const root = yield* files.realPath(at);
  yield* gitEffect(fixture.demo.demoRoot, ['worktree', 'add', '-q', '-b', branch, root]);
  return root;
});

const rev = Effect.fnUntraced(function* (root: string, name: string) {
  return (yield* spawnedEffect(['git', 'rev-parse', name], { cwd: root })).stdout.toString().trim();
});

const committedIn = Effect.fnUntraced(function* (root: string, changes: Readonly<Record<string, string | null>>, message: string) {
  const files = yield* FileSystem.FileSystem;
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) {
      yield* files.remove(join(root, path));
      continue;
    }
    yield* files.makeDirectory(dirname(join(root, path)), { recursive: true });
    yield* files.writeFileString(join(root, path), text);
  }
  yield* gitEffect(root, ['add', '-A']);
  yield* gitEffect(root, ['commit', '-qm', message]);
  return yield* rev(root, 'HEAD');
});

type Hold = { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> };
type CopyInput = {
  readonly worktrees: readonly string[];
  readonly start?: Effect.Effect<void>;
  readonly memory?: string;
  readonly lanes?: Lanes;
  readonly journal?: LandingJournal;
};

const copies = Effect.fnUntraced(function* (fixture: EnforcementFixture, input: CopyInput) {
  const { demo } = fixture;
  const { workers } = yield* Enforcements;
  const main = demo.demoRoot;
  const standing = new Set<string>();
  const touched = new Set<string>();
  const watching = new Set<string>();
  const holds = new Map<string, Hold>();
  const opens = yield* Queue.unbounded<string>();
  const watches = yield* Queue.unbounded<string>();
  const unwatches = yield* Queue.unbounded<string>();
  const bound = (root: string) =>
    withLanes(demo.context, input.lanes ?? workers).pipe(Context.add(MeasuredCheckout, { projectId: demo.projectId, path: root }));
  const driver = yield* driverOver({
    graphOf: Effect.fnUntraced(function* (_projectId: number, root: string | null) {
      const at = root ?? main;
      touched.add(at);
      if (at !== main && !standing.has(at)) return yield* Effect.fail({ message: `the graph copy of ${at} is closed` });
      const hold = holds.get(at);
      if (hold !== undefined) {
        yield* Deferred.succeed(hold.entered, undefined);
        yield* Deferred.await(hold.release);
      }
      return bound(at);
    }),
    open: (_, root) =>
      Effect.sync(() => {
        standing.add(root);
        Queue.offerUnsafe(opens, root);
        return root;
      }),
    memory: input.memory ?? null,
    start: input.start,
    journal: input.journal,
    delayMs: 0,
    checkouts: {
      ...QUIET_CHECKOUTS,
      headMoved: (root) =>
        Stream.unwrap(
          Effect.as(
            Effect.acquireRelease(
              Effect.sync(() => {
                watching.add(root);
                Queue.offerUnsafe(watches, root);
              }),
              () =>
                Effect.sync(() => {
                  watching.delete(root);
                  Queue.offerUnsafe(unwatches, root);
                }),
            ),
            Stream.never,
          ),
        ),
    },
    coverage: fixedCoverage(
      demo.projectId,
      [main, ...input.worktrees].map((root, at) => ({ checkout: `copy-${at}`, root })),
    ),
  });
  return {
    driver,
    projectId: demo.projectId,
    touched,
    watching,
    opens,
    watches,
    unwatches,
    opened: (root: string) => {
      standing.add(root);
      driver.opened(demo.projectId, root);
    },
    closed: (root: string) => {
      standing.delete(root);
      driver.closed(demo.projectId, root);
    },
    hold: (root: string): Hold => {
      const hold = { entered: Deferred.makeUnsafe<void>(), release: Deferred.makeUnsafe<void>() };
      holds.set(root, hold);
      return hold;
    },
    judged: (_: number, root: string | null) => Effect.succeed(bound(root ?? main)),
  };
});

type CopyWorld = Effect.Success<ReturnType<typeof copies>>;
type OperationCall = (operation: 'submit_work' | 'check_rules') => Effect.Effect<unknown, ToolFailed>;

const withOperations = Effect.fnUntraced(function* <A, E, R>(
  fixture: EnforcementFixture,
  world: CopyWorld,
  root: string,
  driver: Remeasure['Service'],
  use: (call: OperationCall) => Effect.Effect<A, E, R>,
) {
  const { demo } = fixture;
  const { workers } = yield* Enforcements;
  yield* bornThread(
    demo.graph.store.db,
    {
      id: MINE,
      ownerId: 'writer',
      agentId: 'tagma',
      provider: 'test-provider',
      model: 'gpt-test',
      reasoning: 'high',
      status: 'idle',
      spawnRootId: MINE,
      authority: { mode: 'trust', bypassFrom: null },
    },
    { projectId: demo.projectId, title: 'writer', readerOrderAt: new Date(0) },
  );
  const services = yield* landingServices.pipe(Effect.provide(demo.context));
  const rig = yield* holdingsAt(demo.graph.git, root, demo.graph.store, demo.graph.units, Context.get(services, LineWrites));
  const instance = yield* Effect.acquireRelease(claimPreparedInstance(preparedBase(demo.graph.store)), (held) => held.release);
  const producer = makePreparedChanges(
    { commands: quietCommands, pathsOfThread, evidenceInGroups },
    landingAdmission(makeLandingHolds()),
    judgingFns(CHECKOUT_DIRECTORY),
    instance.dir,
  );
  const context = withLanes(demo.context, workers).pipe(Context.add(MeasuredCheckout, { projectId: demo.projectId, path: root }));
  const graphs = fixtureServedGraphs(context);
  const served = yield* graphs.resolve({ projectId: demo.projectId, cwd: root });
  const vocabulary = yield* demo.table();
  const origin = yield* provedOrigins.of({ projectId: demo.projectId, threadId: MINE }, root);
  if (origin === null) return yield* Effect.die('the landing fixture proves its checkout');
  return yield* underCheckoutLanes(
    Effect.gen(function* () {
      const owners = Context.merge(context, services).pipe(
        Context.add(Holdings, rig.holdings),
        Context.add(Retirement, rig.retirement),
        Context.add(PreparedChanges, producer),
        Context.add(CheckoutPaths, gitCheckoutPaths(TEST_CHECKOUT, demo.projectId)),
        Context.add(WorkingOrigins, provedOrigins),
        Context.add(Remeasure, driver),
        Context.add(RuleChecks, checksOver({ graphOf: world.judged, driver })),
        Context.add(LandingGit, { run: (_act, platform) => Effect.succeed(platform) }),
        Context.add(ServingGit, { run: (_act, platform) => Effect.succeed(platform) }),
        Context.add(RoutedGraphs, graphs),
      );
      const tools = yield* fixtureNativeCatalog(
        {
          caller: {
            actor: {
              kind: 'thread',
              threadId: MINE,
              projectId: demo.projectId,
              principalId: 'writer',
              session: { harness: 'tagma', key: MINE },
            },
            files: null,
          },
          place: { root, origin },
          world: 'checkout',
          project: { id: demo.projectId, name: 'demo' },
          vocabulary: () => vocabulary,
          identity: testSessionIdentity,
          served,
          owners,
        },
        ['submit_work', 'check_rules'],
      );
      const call: OperationCall = Effect.fnUntraced(function* (operation) {
        const tool = tools[operation]!;
        const input = { checkout: root, paths: ['src/core/view.ts'] };
        const invoked = { caller: unthreadedCaller, toolCallId: `idle-${operation}`, messages: [] };
        const prepare = toolPrepare(tool);
        const prepared = prepare === null ? undefined : yield* prepare(input, invoked);
        const answer = yield* toolExecute(tool)!(input, { ...invoked, prepared: prepared?.prepared });
        return answer instanceof ToolAnswer ? answer.value : answer;
      });
      return yield* use(call);
    }),
  );
});

const crossingAtOpening = Effect.fnUntraced(function* (fixture: EnforcementFixture, operation: 'submit_work' | 'check_rules') {
  const files = yield* FileSystem.FileSystem;
  const { demo } = fixture;
  const rule = yield* enforced(fixture);
  const idle = yield* worktreeAt(fixture, `idle-${operation}`);
  const world = yield* copies(fixture, { worktrees: [idle], start: Effect.never });
  yield* committedIn(idle, { 'src/core/view.ts': null }, 'the view is deleted outside Tagma');
  yield* files.writeFileString(join(idle, 'src/core/view.ts'), VIEW_UPWARD);
  yield* recordWrite(demo.graph.units, demo.graph.store, demo.projectId, MINE, testPlace('src/core/view.ts'), {
    before: '',
    after: VIEW_UPWARD,
    mode: '100644',
  });
  const hold = world.hold(idle);
  world.opened(idle);
  const reached = yield* Deferred.make<'waiting' | 'answered'>();
  const driver: Remeasure['Service'] = {
    ...world.driver,
    ready: (projectId, root) => Deferred.succeed(reached, 'waiting').pipe(Effect.andThen(world.driver.ready(projectId, root))),
  };
  yield* withOperations(fixture, world, idle, driver, (call) =>
    Effect.gen(function* () {
      const running = yield* Effect.forkChild(call(operation).pipe(Effect.onExit(() => Deferred.succeed(reached, 'answered'))));
      const phase = yield* Deferred.await(reached);
      const early = phase === 'answered' ? yield* Fiber.join(running) : undefined;
      expect({ phase, early }).toMatchObject({ phase: 'waiting' });
      yield* Deferred.await(hold.entered);
      expect((yield* fixture.documentOf(rule))?.debt.map((one) => one.fingerprint)).toEqual([VIEW_DEBT]);
      yield* Deferred.succeed(hold.release, undefined);
      const answer = yield* Fiber.join(running);
      expect(answer).toMatchObject(
        operation === 'submit_work'
          ? { status: 'refused', code: 'rule-violated' }
          : { status: 'ok', refuses: true, fingerprints: [VIEW_DEBT] },
      );
      expect((yield* fixture.documentOf(rule))?.debt).toEqual([]);
    }),
  ).pipe(Effect.ensuring(Deferred.succeed(hold.release, undefined)));
});

layer(enforceFixture(), { excludeTestServices: true })('remeasurement of idle copies', (it) => {
  it.effect('startup measures and watches the main checkout alone; a copy is measured and watched from its opening to its closing', () =>
    withEnforcement((fixture) =>
      Effect.gen(function* () {
        const { demo } = fixture;
        const files = yield* FileSystem.FileSystem;
        yield* enforced(fixture);
        const one = yield* worktreeAt(fixture, 'one');
        const two = yield* worktreeAt(fixture, 'two');
        const memory = join(yield* demo.fixture.directory('remembered'), 'enforced.json');
        yield* files.writeFileString(
          memory,
          JSON.stringify([demo.demoRoot, one, two].map((root) => ({ projectId: demo.projectId, root }))),
        );
        const world = yield* copies(fixture, { worktrees: [one, two], memory });

        expect(yield* Queue.take(world.opens)).toBe(demo.demoRoot);
        yield* world.driver.ready(world.projectId, demo.demoRoot);
        world.opened(one);
        yield* world.driver.ready(world.projectId, one);
        expect([yield* Queue.take(world.watches), yield* Queue.take(world.watches)].sort()).toEqual([demo.demoRoot, one].sort());

        world.closed(one);
        expect(yield* Queue.take(world.unwatches)).toBe(one);
        expect([...world.watching]).toEqual([demo.demoRoot]);
        expect([...world.touched].sort()).toEqual([demo.demoRoot, one].sort());
      }),
    ),
  );

  it.effect('closing an inspecting copy cancels its work, releases the measurement lane and preserves unmeasured landings', () =>
    withEnforcement((fixture) =>
      Effect.gen(function* () {
        const { demo } = fixture;
        const { workers } = yield* Enforcements;
        const rule = yield* enforced(fixture);
        const one = yield* worktreeAt(fixture, 'inspecting');
        const two = yield* worktreeAt(fixture, 'next');
        const entered = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<boolean>();
        const lanes: Lanes = {
          ...workers,
          reach: (ask, priority) =>
            ask.root === one
              ? Deferred.succeed(entered, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onExit((exit) => Deferred.succeed(stopped, Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause))),
                )
              : workers.reach(ask, priority),
        };
        const journal = journalOver(demo.graph.store.db, demo.graph.units);
        const world = yield* copies(fixture, { worktrees: [one, two], lanes, journal });
        world.opened(one);
        yield* Deferred.await(entered);
        yield* world.driver.landed('submit_work', {
          kind: 'tree',
          projectId: world.projectId,
          root: one,
          commit: yield* rev(one, 'HEAD'),
          paths: ['src/core/view.ts'],
        });
        world.closed(one);
        yield* world.driver.ready(world.projectId, two);
        expect(yield* Deferred.await(stopped)).toBe(true);
        expect(yield* journal.page(null, 10)).toHaveLength(1);
        expect((yield* fixture.documentOf(rule))?.debt.map((one) => one.fingerprint)).toEqual([VIEW_DEBT]);
      }),
    ),
  );

  for (const operation of ['submit_work', 'check_rules'] as const)
    it.effect(
      `${operation} waits for the opened copy's measurement before maintenance opens and rejects a fingerprint retired while it idled`,
      () => withEnforcement((fixture) => crossingAtOpening(fixture, operation)),
    );

  it.effect(
    'a head moved while the copy idled is recognized at its opening: the debt retires before the opening answers, and the new crossing is recorded as escaped after it',
    () =>
      withEnforcement((fixture) =>
        Effect.gen(function* () {
          const rule = yield* enforced(fixture);
          const moved = yield* worktreeAt(fixture, 'moved');
          const world = yield* copies(fixture, { worktrees: [moved] });
          yield* world.driver.ready(world.projectId, moved);
          world.closed(moved);
          const commit = yield* committedIn(
            moved,
            { 'src/core/view.ts': VIEW_FIXED, 'src/core/late.ts': LATE_UPWARD },
            'the view drops the panel and a late import appears outside Tagma',
          );
          const remeasured = yield* Queue.unbounded<void>();
          yield* Effect.acquireRelease(
            fixture.demo.graph.feed.subscribe(fixture.demo.projectId, (frame) => {
              if (frame.type === 'change' && frame.events.some((event) => event.op === 'remeasure'))
                Queue.offerUnsafe(remeasured, undefined);
            }),
            (unsubscribe) => Effect.sync(unsubscribe),
          );

          yield* world.driver.ready(world.projectId, moved);
          expect((yield* fixture.documentOf(rule))?.debt).toEqual([]);
          while ((yield* fixture.documentOf(rule))?.escaped.length === 0) yield* Queue.take(remeasured);
          const document = yield* fixture.documentOf(rule);
          expect(document?.escaped).toEqual([
            {
              fingerprint: 'app order core/late.ts -> app/',
              path: 'src/core/late.ts',
              line: 1,
              said: expect.any(String),
              fix: expect.any(String),
              commit,
            },
          ]);
        }),
      ),
  );
});
