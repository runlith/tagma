import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Option, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { NamespaceId } from '@runlith/files/namespace';
import { LocationRevision } from '@runlith/files/resource';
import { type Capability, EngineFailed, EngineLost, Engines } from '@runlith/navigation/adapter';
import { type Checkout, type Launch, Launcher, type Process } from '@runlith/navigation/engine';
import type { Machine } from '../platform/contract/service/capacity.js';
import { CheckoutRows } from '../workspace/contract/service/checkouts.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch } from '../workspace/contract/service/watch.js';
import { RootId } from '../workspace/contract/wire/ids.js';
import { RepositoryId } from '../workspace/contract/wire/repositories.js';
import type { EnginePhase } from './contract/wire/engines.js';
import { EngineStates, QueryProject } from './contract/service/engines.js';
import { makeHolder } from './holder.js';
import { Settings } from '../settings/contract/service/values.js';
import { SettingChanges, type SettingChanged } from '../settings/contract/service/changes.js';
import { CheckoutPaths, PlaceUnread } from '../workspace/contract/service/checkoutPaths.js';

const GIB = 1024 ** 3;

const CAPABILITY: Capability = { language: 'test', extensions: ['.ts'], manifests: [], asks: ['definition', 'uses'] };

const namespaceId = NamespaceId.make('namespace-1');

const idOf = (root: string) => RootId.make(`root${root.replaceAll('/', '-')}`);

const REPOSITORY = '/work/repo';

type FakeEngine = {
  readonly ready: Deferred.Deferred<void>;
  readonly changed: Map<string, string[]>;
  readonly end: Deferred.Deferred<string>;
};

const fakeLauncher = () => {
  const launches: Launch[] = [];
  const opened: string[] = [];
  const closed: string[] = [];
  const attached: string[] = [];
  const detached: string[] = [];
  const rested: string[] = [];
  const memory = { bytes: GIB };
  const engines = new Map<string, FakeEngine>();
  const launcher = Launcher.of({
    capability: CAPABILITY,
    open: (launch) =>
      Effect.acquireRelease(
        Effect.gen(function* () {
          const engine: FakeEngine = { ready: yield* Deferred.make<void>(), changed: new Map(), end: yield* Deferred.make<string>() };
          engines.set(launch.base, engine);
          launches.push(launch);
          opened.push(launch.base);
          const now = (root: string) => ({
            snapshot: { revision: 'head', changed: [...(engine.changed.get(root) ?? [])], problems: [] },
            warming: false,
            adapter: { locate: () => Effect.never, judge: () => Effect.never },
          });
          const checkout = (root: string) =>
            Effect.acquireRelease(
              Effect.sync((): Checkout => {
                attached.push(root);
                return {
                  served: Effect.map(Deferred.isDone(engine.ready), (done) => (done ? now(root) : null)),
                  ready: Effect.raceFirst(
                    Effect.map(Deferred.await(engine.ready), () => now(root)),
                    Effect.flatMap(Deferred.await(engine.end), (detail) => Effect.fail(new EngineLost({ detail }))),
                  ),
                  touch: (touch) =>
                    Effect.sync(() => {
                      if (touch._tag === 'paths') engine.changed.set(root, [...(engine.changed.get(root) ?? []), ...touch.paths]);
                    }),
                  rest: Effect.sync(() => void rested.push(root)),
                };
              }),
              () => Effect.sync(() => void detached.push(root)),
            );
          return {
            checkout,
            limit: () => Effect.void,
            usage: Effect.sync(() => memory.bytes),
            ended: Deferred.await(engine.end),
          } satisfies Process;
        }),
        () => Effect.sync(() => void closed.push(launch.base)),
      ),
  });
  const engine = (base: string): FakeEngine => {
    const found = engines.get(base);
    if (found === undefined) throw new Error(`no engine was opened for ${base}`);
    return found;
  };
  const serve = (base: string) => Effect.suspend(() => Deferred.succeed(engine(base).ready, undefined));
  const end = (base: string, detail: string) => Effect.suspend(() => Deferred.succeed(engine(base).end, detail));
  return { launcher, launches, opened, closed, attached, detached, rested, memory, engine, serve, end };
};

const gitOf = (root: string) => {
  if (!root.startsWith(REPOSITORY)) return null;
  const name = root.slice(REPOSITORY.length + 1);
  return {
    repositoryId: RepositoryId.make('repository-1'),
    gitDirectory: { namespaceId, path: name === '' ? `${REPOSITORY}/.git` : `${REPOSITORY}/.git/worktrees/${name}` },
  };
};

const checkouts = (
  marks: { listener: ((rootId: RootId, paths: readonly string[] | undefined) => Effect.Effect<void>) | null },
  moved: ReadonlyMap<string, string>,
) =>
  Layer.mergeAll(
    Layer.mock(FileRoots, {
      namespaceId,
      scope: () => ({ resolve: () => Effect.die('the holder resolves no scope') }),
      matching: (path) =>
        Effect.succeed({
          path,
          root: {
            rootId: idOf(moved.get(path) ?? path),
            namespaceId,
            path,
            locationRevision: LocationRevision.make(0),
            witness: { provider: 'test', format: 'test', token: path },
            provenance: { kind: 'test', id: path },
            git: gitOf(path),
            state: 'active' as const,
          },
        }),
    }),
    Layer.mock(CheckoutRows, {
      headMoved: () => Stream.never,
      onMark: (listener) => {
        marks.listener = listener;
        return () => {
          marks.listener = null;
        };
      },
    }),
    Layer.mock(CheckoutWatch, {
      follow: () => Effect.succeed({ shifts: Stream.never, watching: () => true, release: () => undefined }),
    }),
  );

const holder = Effect.fnUntraced(function* (
  machine: Machine,
  moved: ReadonlyMap<string, string> = new Map(),
  enabled = true,
  shared = false,
) {
  const values = new Map([
    [1, enabled],
    [2, true],
  ]);
  const fake = fakeLauncher();
  const marks: { listener: ((rootId: RootId, paths: readonly string[] | undefined) => Effect.Effect<void>) | null } = { listener: null };
  const subscribers = new Set<(event: SettingChanged) => Effect.Effect<void>>();
  const changes = SettingChanges.of({
    publish: (event) => Effect.forEach(subscribers, (subscriber) => subscriber(event), { discard: true }),
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      return () => {
        subscribers.delete(subscriber);
      };
    },
  });
  const settings = Layer.mock(Settings, {
    held: (_key, projectId) => Effect.succeed(() => values.get(projectId) ?? enabled),
    write: (input) =>
      Effect.andThen(
        Effect.sync(() => {
          values.set(input.projectId ?? 1, input.value === true);
        }),
        changes.publish({ key: input.key, scope: 'project', projectId: input.projectId ?? 1 }),
      ),
  });
  const doubles = yield* Layer.build(
    Layer.mergeAll(
      checkouts(marks, moved),
      settings,
      Layer.succeed(SettingChanges, changes),
      Layer.mock(CheckoutPaths, {
        rootAcross: (root, preferred) =>
          shared && preferred === null
            ? Effect.fail(new PlaceUnread({ path: root, reason: 'checkout belongs to projects 1, 2' }))
            : Effect.succeed({
                projectId: !shared && (root === REPOSITORY || root === idOf(REPOSITORY)) ? 1 : (preferred ?? 1),
                rootId: idOf(root),
                path: root,
                origin: 'canonical' as const,
              }),
      }),
    ),
  );
  const made = yield* makeHolder({ machine }).pipe(Effect.provideContext(Context.add(doubles, Launcher, fake.launcher)));
  const engines: Engines['Service'] = made.engines;
  const states: EngineStates['Service'] = made.states;
  const lease = (root: string, projectId: number | null = null) =>
    Effect.scoped(engines.lease(root)).pipe(Effect.provideService(QueryProject, projectId));
  const reached = (root: string, phase: EnginePhase) =>
    Effect.andThen(Effect.yieldNow, states.read(10)).pipe(
      Effect.flatMap((reading) => {
        const failed = phase === 'loading' ? reading.engines.find((row) => row.root === root && row.phase === 'resting') : undefined;
        return failed === undefined
          ? Effect.succeed(reading)
          : Effect.fail(new EngineFailed({ detail: failed.failure ?? 'the expected engine did not load' }));
      }),
      Effect.repeat({ until: (reading) => reading.engines.some((row) => row.root === root && row.phase === phase) }),
    );
  const started = Effect.fnUntraced(function* (root: string, base = root, projectId: number | null = null) {
    const asking = yield* Effect.forkChild(lease(root, projectId));
    yield* Effect.raceFirst(reached(base, 'loading'), Fiber.join(asking));
    yield* fake.serve(base);
    return yield* Fiber.join(asking);
  });
  const holding = Effect.fnUntraced(function* (root: string) {
    const held = yield* Deferred.make<void>();
    const done = yield* Deferred.make<void>();
    yield* Effect.forkChild(
      Effect.scoped(Effect.andThen(engines.lease(root), Effect.andThen(Deferred.succeed(held, undefined), Deferred.await(done)))),
    );
    yield* Deferred.await(held);
    return Deferred.succeed(done, undefined);
  });
  const switchTo = (enabled: boolean, projectId = 1) =>
    Context.get(doubles, Settings).write({ key: 'navigation.enabled', value: enabled, projectId });
  return { fake, marks, engines, lease, reached, started, holding, switchTo };
});

const ROOMY: Machine = { parallelism: 12, memoryBytes: 32 * GIB };

const ROOT = '/work/app';

it.effect('a shared checkout keeps the project selected by the question and stays usable from its enabled project', () =>
  Effect.gen(function* () {
    const { lease, started, switchTo } = yield* holder(ROOMY, new Map(), true, true);
    yield* started(ROOT, ROOT, 1);
    expect((yield* lease(ROOT, 2)).snapshot.revision).toBe('head');
    yield* switchTo(false, 1);
    expect((yield* Effect.flip(lease(ROOT, 1)))._tag).toBe('EngineDisabled');
    expect((yield* started(ROOT, ROOT, 2)).snapshot.revision).toBe('head');
  }),
);

it.effect('an enabled worktree starts from itself after its previously used main project is switched off', () =>
  Effect.gen(function* () {
    const tree = `${REPOSITORY}/tree`;
    const { started, switchTo, fake } = yield* holder(ROOMY);
    yield* started(REPOSITORY, REPOSITORY, 1);
    yield* started(tree, REPOSITORY, 2);
    yield* switchTo(false, 1);
    expect((yield* started(tree, tree, 2)).snapshot.revision).toBe('head');
    expect(fake.opened).toEqual([REPOSITORY, tree]);
  }),
);

it.effect('disabled navigation refuses leases without an engine, and switching off ends a live generation before another lease', () =>
  Effect.gen(function* () {
    const { fake, lease, started, switchTo, marks } = yield* holder(ROOMY, new Map(), false);
    expect((yield* Effect.flip(lease(ROOT)))._tag).toBe('EngineDisabled');
    yield* marks.listener?.(idOf(ROOT), ['a.ts']) ?? Effect.die('no mark listener');
    expect(fake.opened).toEqual([]);
    yield* switchTo(true);
    expect((yield* started(ROOT)).snapshot.revision).toBe('head');
    yield* switchTo(false);
    expect(fake.closed).toEqual([ROOT]);
    expect((yield* Effect.flip(lease(ROOT)))._tag).toBe('EngineDisabled');
    yield* switchTo(true);
    expect((yield* started(ROOT)).snapshot.revision).toBe('head');
    expect(fake.opened).toEqual([ROOT, ROOT]);
  }),
);

it.effect('switching off while the first snapshot loads cancels its waiting question and cannot restart the engine', () =>
  Effect.gen(function* () {
    const { fake, lease, reached, switchTo } = yield* holder(ROOMY);
    const asking = yield* Effect.forkChild(Effect.flip(lease(ROOT)));
    yield* reached(ROOT, 'loading');
    yield* switchTo(false);
    expect((yield* Fiber.join(asking))._tag).toBe('EngineDisabled');
    expect([fake.opened, fake.closed]).toEqual([[ROOT], [ROOT]]);
  }),
);

it.effect('a first question waits while one engine starts for every question waiting on it, and gets its verdicts', () =>
  Effect.gen(function* () {
    const { fake, lease, reached } = yield* holder(ROOMY);
    const both = yield* Effect.forkChild(Effect.all([lease(ROOT), lease(ROOT)], { concurrency: 2 }));
    yield* reached(ROOT, 'loading');
    yield* fake.serve(ROOT);
    expect((yield* Fiber.join(both)).map((engine) => engine.snapshot.revision)).toEqual(['head', 'head']);
    expect(fake.opened).toEqual([ROOT]);
  }),
);

it.effect('a question waiting on an engine that ends while it starts waits for the next generation and gets its verdicts', () =>
  Effect.gen(function* () {
    const { fake, lease, reached } = yield* holder(ROOMY);
    const asking = yield* Effect.forkChild(lease(ROOT));
    yield* reached(ROOT, 'loading');
    yield* fake.end(ROOT, 'the engine process was killed');
    yield* reached(ROOT, 'resting');
    yield* TestClock.adjust('1 second');
    yield* reached(ROOT, 'loading');
    yield* fake.serve(ROOT);
    expect((yield* Fiber.join(asking)).snapshot.revision).toBe('head');
    expect([fake.opened, fake.closed]).toEqual([[ROOT, ROOT], [ROOT]]);
  }),
);

it.effect('an engine that ends three times in a row fails the question waiting on it with the cause', () =>
  Effect.gen(function* () {
    const { fake, lease, reached } = yield* holder(ROOMY);
    const asking = yield* Effect.forkChild(Effect.flip(lease(ROOT)));
    for (const pause of ['1 second', '2 seconds'] as const) {
      yield* reached(ROOT, 'loading');
      yield* fake.end(ROOT, 'out of memory');
      yield* reached(ROOT, 'resting');
      yield* TestClock.adjust(pause);
    }
    yield* reached(ROOT, 'loading');
    yield* fake.end(ROOT, 'out of memory');
    const failure = yield* Fiber.join(asking);
    expect([failure._tag, failure.detail.includes('out of memory'), fake.opened.length]).toEqual(['EngineFailed', true, 3]);
  }),
);

it.effect('an engine that ends refuses the question it held, and a later question starts the next generation', () =>
  Effect.gen(function* () {
    const { fake, engines, reached, started } = yield* holder(ROOMY);
    yield* started(ROOT);
    const asking = yield* Effect.forkChild(
      Effect.scoped(
        Effect.flatMap(engines.lease(ROOT), (engine) => engine.adapter.locate({ _tag: 'at', path: 'src/a.ts', line: 1, name: 'x' })),
      ),
    );
    yield* Effect.yieldNow;
    yield* fake.end(ROOT, 'the engine process was killed');
    const exit = yield* Fiber.await(asking);
    const failure = Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined;
    expect(failure?._tag).toBe('EngineLost');
    yield* reached(ROOT, 'resting');
    expect(fake.closed).toEqual([ROOT]);
    yield* TestClock.adjust('1 second');
    expect((yield* started(ROOT)).snapshot.revision).toBe('head');
    expect(fake.opened).toEqual([ROOT, ROOT]);
  }),
);

it.effect('worktrees of one repository are served by one engine whose base is the main checkout', () =>
  Effect.gen(function* () {
    const { fake, lease, started } = yield* holder(ROOMY);
    yield* started(`${REPOSITORY}/one`, REPOSITORY);
    yield* lease(`${REPOSITORY}/two`);
    expect([fake.opened, fake.attached]).toEqual([[REPOSITORY], [REPOSITORY, `${REPOSITORY}/one`, `${REPOSITORY}/two`]]);
  }),
);

it.effect('an engine idle past its term keeps running and rests its idle worktrees, which answer again without joining anew', () =>
  Effect.gen(function* () {
    const { fake, lease, started } = yield* holder(ROOMY);
    yield* started(`${REPOSITORY}/one`, REPOSITORY);
    yield* TestClock.adjust('16 minutes');
    expect([fake.rested, fake.detached, fake.closed]).toEqual([[`${REPOSITORY}/one`], [], []]);
    yield* lease(`${REPOSITORY}/one`);
    expect([fake.opened, fake.attached]).toEqual([[REPOSITORY], [REPOSITORY, `${REPOSITORY}/one`]]);
  }),
);

it.effect('an engine over its share of memory rests its least recently asked worktree first', () =>
  Effect.gen(function* () {
    const { fake, lease, started } = yield* holder(ROOMY);
    yield* started(`${REPOSITORY}/one`, REPOSITORY);
    yield* TestClock.adjust('1 second');
    yield* lease(`${REPOSITORY}/two`);
    fake.memory.bytes = 11 * GIB;
    yield* TestClock.adjust('30 seconds');
    expect([fake.rested, fake.detached, fake.closed]).toEqual([[`${REPOSITORY}/one`], [], []]);
  }),
);

it.effect('a repository the budget cannot hold beside the others stops the engine used longest ago', () =>
  Effect.gen(function* () {
    const { fake, reached, started } = yield* holder(ROOMY);
    for (const root of ['/work/a', '/work/b']) {
      yield* started(root);
      yield* TestClock.adjust('1 second');
    }
    yield* started('/work/c');
    yield* reached('/work/a', 'idle');
    expect(fake.closed).toEqual(['/work/a']);
    expect(fake.opened).toEqual(['/work/a', '/work/b', '/work/c']);
  }),
);

it.effect('a repository asked while every engine the budget holds is answering waits until one of them finishes', () =>
  Effect.gen(function* () {
    const { fake, lease, reached, started, holding } = yield* holder(ROOMY);
    for (const root of ['/work/a', '/work/b']) yield* started(root);
    const done = yield* Effect.forEach(['/work/a', '/work/b'], holding);
    const asking = yield* Effect.forkChild(lease('/work/c'));
    yield* reached('/work/c', 'waiting');
    expect(fake.opened).toEqual(['/work/a', '/work/b']);
    yield* done[0] ?? Effect.void;
    yield* reached('/work/c', 'loading');
    yield* fake.serve('/work/c');
    yield* Fiber.join(asking);
    expect([fake.opened, fake.closed]).toEqual([['/work/a', '/work/b', '/work/c'], ['/work/a']]);
  }),
);

it.effect('a machine with memory for many engines but few cores keeps one engine at a time', () =>
  Effect.gen(function* () {
    const { fake, reached, started } = yield* holder({ parallelism: 4, memoryBytes: 128 * GIB });
    yield* started('/work/a');
    yield* started('/work/b');
    yield* reached('/work/a', 'idle');
    expect(fake.closed).toEqual(['/work/a']);
  }),
);

it.effect('a machine with little memory runs its engine under the smallest limit', () =>
  Effect.gen(function* () {
    const { fake, started } = yield* holder({ parallelism: 4, memoryBytes: 4 * GIB });
    expect((yield* started(ROOT)).snapshot.revision).toBe('head');
    expect(fake.launches.map((launch) => launch.memory)).toEqual([2 * GIB]);
  }),
);

it.effect('a checkout found at a new path stops the engine of its old path and starts the next one at the new', () =>
  Effect.gen(function* () {
    const { fake, started } = yield* holder(ROOMY, new Map([['/work/moved', ROOT]]));
    yield* started(ROOT);
    yield* started('/work/moved');
    expect(fake.opened).toEqual([ROOT, '/work/moved']);
    expect(fake.closed).toEqual([ROOT]);
  }),
);

it.effect('a write the change record marks reaches the engine before the next answer', () =>
  Effect.gen(function* () {
    const { marks, lease, started } = yield* holder(ROOMY);
    yield* started(ROOT);
    yield* marks.listener?.(idOf(ROOT), ['src/a.ts']) ?? Effect.die('the holder listens to no checkout marks');
    expect((yield* lease(ROOT)).snapshot.changed).toEqual(['src/a.ts']);
  }),
);
