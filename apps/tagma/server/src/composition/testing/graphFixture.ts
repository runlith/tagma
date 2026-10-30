import { sessionIdentityLayer } from '../../external-harnesses/testing/builtin.js';
import { tenant } from './tenant.js';
import { kind, shared } from '@runlith/testbed/worlds';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { fixtureRoot as fixtureRootAt } from '../../platform/testing/roots.js';
import { spawnedEffect } from '../../platform/testing/spawn.js';
import { FixtureScope, type ReleaseReport } from '../../platform/testing/scope.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Cause, Context, Data, Effect, Exit, FileSystem, Layer, Scope, Semaphore } from 'effect';
import { GraphStore, MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, GraphUnits } from '../../platform/contract/service/units.js';
import { unitsLayer } from '../../platform/store/units.js';
import { WriterRegister } from '../../platform/contract/service/writers.js';
import { signedBy } from '../../invocation/testing/call.js';
import { machineFileLayer } from '../../platform/store/open.js';
import type { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { Act, BlockAnswers, BlockNames, BlockProjection } from '../../graph/contract/service/acts.js';
import { Blocks } from '../../graph/contract/service/blocks.js';
import { Digest } from '../../graph/contract/service/orientation.js';
import { Edges } from '../../graph/contract/service/blocks.js';
import { Sources } from '../../graph/contract/service/sources.js';
import { WorkEnds } from '../../graph/contract/service/workEnds.js';
import { WorkDebt } from '../../graph/contract/service/workDebt.js';
import { ProjectLaw } from '../../graph/contract/service/law.js';
import type { HolderStandings } from '../../graph/contract/service/holders.js';
import { workEndsOver } from '../../graph/testing/doubles.js';
import { fixtureGraph } from './fixtureGraph.js';
import { watchProcessLayer } from './fileWatcher.js';
import type { GraphServices } from '../../graph/contract/service/services.js';
import { projectsLayer } from '../../projects/testing/doubles.js';
import { GraphFeed } from '../../graph/contract/service/journal.js';
import { GraphJournal } from '../../graph/contract/service/journal.js';
import { Orientation } from '../../graph/contract/service/orientation.js';
import { Projects } from '../../projects/contract/service/registry.js';
import { GraphScopes, ProjectLifecycle, ProjectPolicy } from '../../graph/contract/service/serving.js';
import { BlockReads, History, Ranking, Selection } from '../../graph/contract/service/reads.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Tags } from '../../graph/contract/service/vocabulary.js';
import { Batch, Reflections, Supersession, Tasks } from '../../graph/contract/service/work.js';
import { SourceProject } from '../../graph/contract/service/source.js';
import type { GraphSteps } from '../../graph/contract/service/steps.js';
import { Touches } from '../../graph/contract/service/orientation.js';
import { Trash } from '../../graph/contract/service/blocks.js';
import { Git } from '@runlith/git/Git';
import { Doctrine } from '../../platform/contract/service/sections.js';
import { Configs } from '../../config/contract/service/configs.js';
import type { Descriptor } from '../../config/contract/wire/config.js';
import { describedBy } from '../../enforcement/testing/doubles.js';
import { LAYERED, LAYERED_KEY } from '../../enforcement/testing/layered.js';
import { Capacity, serverCapacity, thisMachine } from '../../platform/contract/service/capacity.js';
import { OperationOwners } from '../../platform/contract/service/operationOwners.js';
import type { Background } from '../../platform/contract/service/background.js';

export type DemoServices =
  | GraphServices
  | GraphStore
  | GraphUnits
  | MachineStore
  | MachineUnits
  | Configs
  | GraphSteps
  | Background
  | WorkEnds
  | WorkDebt
  | ProjectLaw
  | Capacity
  | OperationOwners
  | HolderStandings;

const fixtureRoot = () => fixtureRootAt('tagma-graph-fixture', randomUUID());

export type DemoOwners = {
  store: Context.Service.Shape<typeof MachineStore>;
  graphStore: Context.Service.Shape<typeof GraphStore>;
  git: Context.Service.Shape<typeof Git>;
  units: Context.Service.Shape<typeof MachineUnits>;
  act: Context.Service.Shape<typeof Act>;
  blockAnswers: Context.Service.Shape<typeof BlockAnswers>;
  blockNames: Context.Service.Shape<typeof BlockNames>;
  blockProjection: Context.Service.Shape<typeof BlockProjection>;
  batch: Context.Service.Shape<typeof Batch>;
  blocks: Context.Service.Shape<typeof Blocks>;
  digest: Context.Service.Shape<typeof Digest>;
  edges: Context.Service.Shape<typeof Edges>;
  feed: Context.Service.Shape<typeof GraphFeed>;
  sources: Context.Service.Shape<typeof Sources>;
  history: Context.Service.Shape<typeof History>;
  journal: Context.Service.Shape<typeof GraphJournal>;
  orientation: Context.Service.Shape<typeof Orientation>;
  projects: Context.Service.Shape<typeof Projects>;
  projectLifecycle: ProjectLifecycle['Service'];
  projectPolicy: ProjectPolicy['Service'];
  graphScopes: GraphScopes['Service'];
  ranking: Context.Service.Shape<typeof Ranking>;
  reading: Context.Service.Shape<typeof BlockReads>;
  reflection: Context.Service.Shape<typeof Reflections>;
  sourceProject: SourceProject['Service'];
  selection: Context.Service.Shape<typeof Selection>;
  sessions: Context.Service.Shape<typeof WriterRegister>;
  settings: Context.Service.Shape<typeof Settings>;
  standing: Context.Service.Shape<typeof Supersession>;
  tags: Context.Service.Shape<typeof Tags>;
  tasks: Context.Service.Shape<typeof Tasks>;
  touches: Context.Service.Shape<typeof Touches>;
  trash: Context.Service.Shape<typeof Trash>;
};

export type DemoOptions = {
  readonly sourcePath?: string;
  readonly originPath?: string;
};

export type DemoState = {
  graph: DemoOwners;
  context: Context.Context<DemoServices>;
  described: Map<string, Descriptor>;
  fixture: FixtureScope;
  projectId: number;
  root: number;
  demoRoot: string;
  project(name: string): FixtureProject;
};

export type EffectDemo = DemoState & {
  as<A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  refusalAs<A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<GateRefusal, string, R>;
  refusal<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<GateRefusal, string, R>;
  nameOf(id: number): ReturnType<DemoOwners['blockNames']['nameOf']>;
  table(projectId?: number): ReturnType<DemoOwners['tags']['of']>;
};

export type FixtureProject = { readonly id: number; readonly root: string };

export type GraphFixtureOptions = {
  readonly source?: string;
  readonly projects?: readonly string[];
  readonly repos?: readonly string[];
  readonly prepareEffect?: (demo: EffectDemo) => Effect.Effect<void, unknown, DemoServices | FileSystem.FileSystem>;
};

type Home = {
  readonly root: string;
  readonly template: string;
  readonly kind: string;
  projectId: number | undefined;
  projects: ReadonlyMap<string, number> | undefined;
};

export class GraphWorld extends Context.Service<
  GraphWorld,
  {
    readonly processes: ProcessPool;
    homeTaken(kind: string): Home;
    homeLeft(home: Home): void;
    templated(kind: string): boolean;
    root(): string;
    preparation(prepare: NonNullable<GraphFixtureOptions['prepareEffect']>): number;
  }
>()('testing/GraphWorld') {}

export const graphWorld = kind(GraphWorld, (_params: null, root: string) =>
  Effect.gen(function* () {
    const processes = yield* heldPool;
    yield* Effect.tryPromise({
      try: () => processes.prepare(1),
      catch: (cause) => new DemoGraphUnbuilt({ release: undefined, cause }),
    });
    const idle: Home[] = [];
    const preparations = new WeakMap<object, number>();
    let prepared = 0;
    let homes = 0;
    let roots = 0;
    return GraphWorld.of({
      processes,
      homeTaken: (kind) => {
        const at = idle.findLastIndex((home) => home.kind === kind);
        if (at >= 0) return idle.splice(at, 1)[0]!;
        homes += 1;
        return {
          root: join(root, `h${homes}`),
          template: join(root, `h${homes}.template`),
          kind,
          projectId: undefined,
          projects: undefined,
        };
      },
      homeLeft: (home) => {
        idle.push(home);
      },
      templated: (kind) => idle.some((home) => home.kind === kind && home.projectId !== undefined),
      root: () => join(root, `r${++roots}`),
      preparation: (prepare) => {
        const standing = preparations.get(prepare);
        if (standing !== undefined) return standing;
        prepared += 1;
        preparations.set(prepare, prepared);
        return prepared;
      },
    });
  }),
);

const kindOf = (world: GraphWorld['Service'], settings: GraphFixtureOptions, extra: ReadonlyMap<string, boolean>): string => {
  const named = [...extra].map(([name, repo]) => `${repo ? 'repo' : 'folder'}:${name}`);
  if (settings.source !== undefined) named.push(`source:${settings.source}`);
  if (settings.prepareEffect === undefined) return named.join('\0');
  return [...named, `prepared:${world.preparation(settings.prepareEffect)}`].join('\0');
};

const reported = (report: ReleaseReport) =>
  `${report.state}` +
  `${report.failures.length === 0 ? '' : ` — ${report.failures.map((entry) => `${entry.name}${entry.path === null ? '' : ` (${entry.path})`}: ${entry.reason}`).join('; ')}`}` +
  `${report.remaining.length === 0 ? '' : ` — still standing: ${report.remaining.join(', ')}`}`;

export class DemoGraphUnbuilt extends Data.TaggedError('DemoGraphUnbuilt')<{
  readonly release: ReleaseReport | undefined;
  readonly cause: unknown;
}> {
  override get message() {
    return (
      `the graph fixture could not be built: ${String(this.cause)}` +
      `${this.release === undefined ? ' — nothing was acquired' : ` — release ${reported(this.release)}`}`
    );
  }
}

export class DemoGraphUnreleased extends Data.TaggedError('DemoGraphUnreleased')<{ readonly release: ReleaseReport }> {
  override get message() {
    return `the graph fixture did not release: ${reported(this.release)}`;
  }
}

export class DemoGraphStillHeld extends Data.TaggedError('DemoGraphStillHeld')<{ readonly root: string }> {
  override get message() {
    return `the graph fixture at ${this.root} is still held: release it before opening another`;
  }
}

function lifetime() {
  let standing: { readonly scope: Scope.Closeable; fixture: FixtureScope | undefined } | undefined;

  const letGo = Effect.suspend(() => {
    const held = standing;
    if (held === undefined) return Effect.succeed(undefined);
    return (held.fixture === undefined ? Effect.succeed(undefined) : held.fixture.close()).pipe(
      Effect.ensuring(Scope.close(held.scope, Exit.void)),
      Effect.tap(() => Effect.sync(() => (standing = undefined))),
    );
  });

  const acquiring = Effect.fn('graphFixture.acquire')(function* (root: string) {
    const scope = yield* Scope.make();
    const held = { scope, fixture: undefined as FixtureScope | undefined };
    standing = held;
    const fixture = yield* Scope.provide(FixtureScope.acquire(root), scope);
    held.fixture = fixture;
    return { fixture, scope };
  });

  return {
    opening: <A, E>(root: string, build: (fixture: FixtureScope) => Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
      Effect.suspend<A, DemoGraphUnbuilt | DemoGraphStillHeld, FileSystem.FileSystem>(() => {
        if (standing !== undefined) {
          return Effect.fail(new DemoGraphStillHeld({ root: standing.fixture?.root ?? 'an unacquired root' }));
        }
        return Effect.flatMap(acquiring(root), ({ fixture, scope }) => Scope.provide(build(fixture), scope)).pipe(
          Effect.catchCause((cause) =>
            Effect.flatMap(letGo, (report) => Effect.fail(new DemoGraphUnbuilt({ release: report, cause: Cause.squash(cause) }))),
          ),
        );
      }),
    releasing: Effect.flatMap(letGo, (report) =>
      report === undefined || report.state === 'released'
        ? Effect.succeed(report)
        : Effect.fail(new DemoGraphUnreleased({ release: report })),
    ),
  };
}

export type RootFixture = ReturnType<typeof rootFixture>;

export function rootFixture() {
  const held = lifetime();
  const openEffect = Effect.suspend(() => held.opening(fixtureRoot(), Effect.succeed));
  return {
    openEffect,
    releaseEffect: held.releasing,
  };
}

export type GraphFixture = ReturnType<typeof graphFixture>;

export class DemoGraphs extends Context.Service<
  DemoGraphs,
  {
    use<A, E, R>(
      body: (demo: EffectDemo) => Effect.Effect<A, E, R>,
      options?: DemoOptions,
    ): Effect.Effect<A, E | DemoGraphUnbuilt | DemoGraphStillHeld, Exclude<R, DemoServices>>;
  }
>()('testing/DemoGraphs') {}

export const demoGraphLayer = (settings: GraphFixtureOptions = {}) =>
  Layer.effect(
    DemoGraphs,
    Effect.gen(function* () {
      const world = graphFixture(settings);
      yield* world.warmEffect;
      const uses = yield* Semaphore.make(1);
      return DemoGraphs.of({
        use: (body, options) =>
          uses.withPermit(
            Effect.acquireUseRelease(
              tenant(world.openEffect(options)),
              (demo) => Effect.provide(Effect.scoped(Effect.suspend(() => body(demo.effects))), demo.context),
              () => tenant(Effect.orDie(world.releaseEffect)),
            ),
          ),
      });
    }),
  );

export const withDemo = <A, E, R>(body: (demo: EffectDemo) => Effect.Effect<A, E, R>, options?: DemoOptions) =>
  Effect.flatMap(DemoGraphs, (demos) => demos.use(body, options));

const MACHINE_DATABASE = 'tagma.sqlite';

const plain = (options: DemoOptions): boolean => options.sourcePath === undefined && options.originPath === undefined;

const storeCopy = (template: string): string => join(template, 'store');

const snapshot = Effect.fn('graphFixture.snapshot')(function* (storeDir: string, template: string) {
  const store = yield* GraphStore;
  const fs = yield* FileSystem.FileSystem;
  const copy = storeCopy(template);
  yield* fs.remove(template, { recursive: true, force: true });
  yield* fs.makeDirectory(copy, { recursive: true });
  yield* store.db.run(sql`VACUUM INTO ${join(copy, MACHINE_DATABASE)}`);
  for (const entry of yield* fs.readDirectory(storeDir)) {
    if (entry.startsWith(MACHINE_DATABASE)) continue;
    yield* fs.copy(join(storeDir, entry), join(copy, entry), { overwrite: true });
  }
  for (const entry of yield* fs.readDirectory(copy, { recursive: true })) {
    if (entry.endsWith('-shm')) yield* fs.remove(join(copy, entry));
  }
});

const restored = Effect.fn('graphFixture.restore')(function* (template: string, storeDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const copy = storeCopy(template);
  for (const entry of yield* fs.readDirectory(copy)) {
    yield* fs.copy(join(copy, entry), join(storeDir, entry), { overwrite: true });
  }
});

export const zoneDeclared = Effect.fnUntraced(function* (projectId: number) {
  const blocks = yield* Blocks;
  yield* blocks.create({
    projectId,
    parentId: (yield* blocks.rootBlockOf(projectId)).id,
    tags: ['tag'],
    title: '#zone',
    body: 'A grouping inside a module.',
    fields: { id: 'zone', sources: ['dir', 'file'], roles: { container: true } },
  });
  yield* (yield* Tags).forget(projectId);
});

export function graphFixture(settings: GraphFixtureOptions = {}) {
  const held = lifetime();
  const extra = new Map<string, boolean>();
  for (const name of settings.projects ?? []) extra.set(name, false);
  for (const name of settings.repos ?? []) extra.set(name, true);
  let home: { readonly world: GraphWorld['Service']; readonly home: Home | undefined } | undefined;

  const building = Effect.fn('graphFixture.build')(function* (
    world: GraphWorld['Service'],
    fixture: FixtureScope,
    options: DemoOptions,
    at: Home | undefined,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const demoRoot = yield* fs.realPath(yield* fixture.directory('demo'));
    const storeDir = yield* fixture.directory('store');
    const copied = at !== undefined && (yield* fs.exists(join(storeCopy(at.template), MACHINE_DATABASE))) ? at.projectId : undefined;
    if (at !== undefined && copied !== undefined) yield* restored(at.template, storeDir);
    const roots = new Map<string, string>();
    for (const [name, repo] of extra) {
      const made = yield* fixture.directory(`project-${name}`);
      if (at !== undefined && copied !== undefined) yield* fs.copy(join(at.template, `project-${name}`), made, { overwrite: true });
      else if (repo) yield* committedRepo(made);
      const root = yield* fs.realPath(made);
      roots.set(name, root);
    }
    const sourcePath = settings.source === undefined ? demoRoot : roots.get(settings.source);
    if (sourcePath === undefined) return yield* Effect.die(`source ${settings.source} names no fixture project`);
    const [{ fixtureMigrations }, { SHIPPED_CATALOGS }, { doctrine }, { POOLS }] = yield* Effect.promise(() =>
      Promise.all([import('./migrations.js'), import('../settings.js'), import('../doctrine.js'), import('../manifest.js')]),
    );
    const scope = yield* Scope.fork(yield* Effect.scope);
    yield* fixture.producer('runtime', Scope.close(scope, Exit.void));
    const described = new Map<string, Descriptor>([[LAYERED_KEY, LAYERED]]);
    const context = yield* Layer.buildWithScope(
      Layer.mergeAll(
        Layer.succeed(Configs, describedBy(described)),
        Layer.sync(WorkEnds, workEndsOver),
        Layer.succeed(WorkDebt, WorkDebt.of({ remaining: () => Effect.die('debt inspections require the enforcement fixture') })),
        Layer.succeed(ProjectLaw, ProjectLaw.of({ read: () => Effect.die('reading a project law requires the enforcement fixture') })),
        Layer.succeed(OperationOwners, OperationOwners.of({ of: () => null })),
        fixtureGraph({
          catalogs: SHIPPED_CATALOGS,
          sourcePath: options.sourcePath ?? sourcePath,
          originPath: options.originPath,
        }).pipe(Layer.provideMerge(projectsLayer())),
        unitsLayer(MachineUnits, MachineStore),
        unitsLayer(GraphUnits, GraphStore),
        watchProcessLayer,
      )
        .pipe(
          Layer.provideMerge(
            Layer.orDie(
              machineFileLayer(join(storeDir, 'tagma.sqlite'), fixtureMigrations, { readers: 1, durable: false }, world.processes),
            ),
          ),
        )
        .pipe(
          Layer.provideMerge(sessionIdentityLayer),
          Layer.provideMerge(Layer.effect(Doctrine, doctrine)),
          Layer.provideMerge(Layer.sync(Capacity, () => serverCapacity(POOLS(thisMachine())))),
        ),
      scope,
    ).pipe(Effect.updateContext((_context: Context.Context<never>) => Context.empty()));
    const graph: DemoOwners = {
      store: Context.get(context, MachineStore),
      graphStore: Context.get(context, GraphStore),
      git: Context.get(context, Git),
      units: Context.get(context, MachineUnits),
      act: Context.get(context, Act),
      blockAnswers: Context.get(context, BlockAnswers),
      blockNames: Context.get(context, BlockNames),
      blockProjection: Context.get(context, BlockProjection),
      batch: Context.get(context, Batch),
      blocks: Context.get(context, Blocks),
      digest: Context.get(context, Digest),
      edges: Context.get(context, Edges),
      feed: Context.get(context, GraphFeed),
      sources: Context.get(context, Sources),
      history: Context.get(context, History),
      journal: Context.get(context, GraphJournal),
      orientation: Context.get(context, Orientation),
      projects: Context.get(context, Projects),
      projectLifecycle: Context.get(context, ProjectLifecycle),
      projectPolicy: Context.get(context, ProjectPolicy),
      graphScopes: Context.get(context, GraphScopes),
      ranking: Context.get(context, Ranking),
      reading: Context.get(context, BlockReads),
      reflection: Context.get(context, Reflections),
      sourceProject: Context.get(context, SourceProject),
      selection: Context.get(context, Selection),
      sessions: Context.get(context, WriterRegister),
      settings: Context.get(context, Settings),
      standing: Context.get(context, Supersession),
      tags: Context.get(context, Tags),
      tasks: Context.get(context, Tasks),
      touches: Context.get(context, Touches),
      trash: Context.get(context, Trash),
    };
    const projectId = copied ?? (yield* Effect.provide(graph.projectLifecycle.create({ name: 'demo', rootPath: demoRoot }), context)).id;
    const ids = new Map<string, number>();
    for (const [name, rootPath] of roots) {
      const carried = copied === undefined ? undefined : at?.projects?.get(name);
      ids.set(name, carried ?? (yield* Effect.provide(graph.projectLifecycle.create({ name, rootPath }), context)).id);
    }
    const project = (name: string): FixtureProject => {
      const id = ids.get(name);
      const root = roots.get(name);
      if (id === undefined || root === undefined) throw new Error(`the graph fixture registered no project ${name}`);
      return { id, root };
    };
    const effects: EffectDemo = {
      graph,
      context,
      described,
      fixture,
      as: (key, effect) => signedBy({ harness: 'test', key })(effect),
      refusal: refusalOf,
      refusalAs: (key, effect) => signedBy({ harness: 'test', key })(refusalOf(effect)),
      nameOf: graph.blockNames.nameOf,
      table: (id) => graph.tags.of(id ?? projectId),
      projectId,
      root: (yield* Effect.provide(graph.blocks.rootBlockOf(projectId), context)).id,
      demoRoot,
      project,
    };
    const demo = { ...effects, effects };
    if (copied === undefined) {
      for (const id of [projectId, ...ids.values()]) yield* Effect.provide(zoneDeclared(id), context);
    }
    if (copied === undefined && settings.prepareEffect !== undefined) yield* Effect.provide(settings.prepareEffect(effects), context);
    if (at !== undefined && copied === undefined) {
      yield* Effect.provide(snapshot(storeDir, at.template), context);
      for (const [name, root] of roots) {
        yield* fs.copy(root, join(at.template, `project-${name}`), { overwrite: true });
      }
      at.projectId = projectId;
      at.projects = ids;
    }
    return demo;
  });

  const openEffect = (options: DemoOptions = {}) =>
    Effect.flatMap(shared(graphWorld, null), (world) =>
      Effect.suspend(() => {
        const taken = home === undefined && plain(options) ? world.homeTaken(kindOf(world, settings, extra)) : undefined;
        return held
          .opening(taken?.root ?? world.root(), (fixture) => building(world, fixture, options, taken))
          .pipe(
            Effect.tap(() => Effect.sync(() => (home = { world, home: taken }))),
            Effect.tapError((error) =>
              Effect.sync(() => {
                const untouched =
                  error instanceof DemoGraphUnbuilt ? error.release?.state === 'released' : error instanceof DemoGraphStillHeld;
                if (taken !== undefined && untouched) world.homeLeft(taken);
              }),
            ),
          );
      }),
    ).pipe(Effect.provide(BunFileSystem.layer));
  const releaseEffect = held.releasing.pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (home?.home !== undefined && Exit.isSuccess(exit)) home.world.homeLeft(home.home);
        home = undefined;
      }),
    ),
  );

  const warmEffect = Effect.flatMap(shared(graphWorld, null), (world) =>
    world.templated(kindOf(world, settings, extra))
      ? Effect.void
      : Effect.acquireUseRelease(
          openEffect(),
          () => Effect.void,
          () => Effect.orDie(releaseEffect),
        ),
  );

  return {
    openEffect,
    releaseEffect,
    warmEffect,
  };
}

export function refusalOf<A, E>(effect: Effect.Effect<A, E, never>): Effect.Effect<GateRefusal, string, never>;
export function refusalOf<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<GateRefusal, string, R>;
export function refusalOf<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<GateRefusal, string, R> {
  return Effect.matchEffect(effect, {
    onSuccess: () => Effect.fail('expected a refusal, got a success'),
    onFailure: (failure) =>
      failure instanceof GateRefusal ? Effect.succeed(failure) : Effect.fail(`expected a refusal, got ${String(failure)}`),
  });
}

export const tempRootEffect = (fixture: FixtureScope, prefix: string) =>
  Effect.suspend(() => fixture.directory(`${prefix}${randomUUID()}`));

export const gitEffect = Effect.fn('graphFixture.git')(function* (cwd: string, args: string[]) {
  const run = yield* spawnedEffect(['git', ...args], { cwd, stdout: 'ignore', stderr: 'pipe' });
  if (run.exitCode !== 0) return yield* Effect.die(new Error(`git ${args.join(' ')}: ${run.stderr.toString()}`));
});

export const tempRepoEffect = Effect.fnUntraced(function* (fixture: FixtureScope, prefix: string) {
  return yield* committedRepo(yield* tempRootEffect(fixture, prefix));
});

export const committedRepo = Effect.fn('graphFixture.repo')(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(join(root, 'apps', 'x'), { recursive: true });
  yield* fs.writeFileString(join(root, 'apps', 'x', 'seed'), root);
  yield* gitEffect(root, ['init', '-q']);
  yield* fs.writeFileString(join(root, '.git', 'config'), '[user]\n\temail = tagma@test\n\tname = tagma\n', { flag: 'a' });
  yield* gitEffect(root, ['add', '-A']);
  yield* gitEffect(root, ['commit', '-qm', 'seed']);
  return yield* fs.realPath(root);
});
