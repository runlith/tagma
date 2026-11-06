import { expect } from 'bun:test';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { layer } from '@runlith/effect-test';
import { Context, Data, Effect, Layer, Schedule, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { BuildSteps } from '../../../checkout-builds/contract/service/steps.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { tagmaFormat } from '../../../plugin-formats/tagma/format.js';
import { HostPlace, PluginHost } from '../../../plugin-host/contract/service/supervision.js';
import { PluginTools } from '../../../plugin-host/contract/service/tools.js';
import { pluginHost } from '../../../plugin-host/plugin-host.js';
import { PluginFormats } from '../../../plugins/contract/service/format.js';
import { PluginPlaces, Plugins } from '../../../plugins/contract/service/plugins.js';
import type { PluginProcessState, PluginRow } from '../../../plugins/contract/wire/rows.js';
import { plugins as pluginsModule } from '../../../plugins/plugins.js';
import { Projects } from '../../../projects/contract/service/registry.js';
import { projectIdentificationLayer } from '../../../projects/identity.js';
import { Schedules } from '../../../schedule/contract/service/schedules.js';
import { schedule } from '../../../schedule/schedule.js';
import { memorySecretsLayer } from '../../../secrets/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { ViewPlaces, WindowStyles } from '../../../views/contract/service/places.js';
import { views as viewsModule } from '../../../views/views.js';
import { buildSteps } from '../../buildSteps.js';
import { ticks } from '../../ticks.js';
import { makeDoorWorld } from '../doorFixture.js';
import { demoGraphLayer, tempRootEffect, withDemo } from '../graphFixture.js';
import { liveGitLayer } from '../liveGit.js';

const ENTRY = fileURLToPath(import.meta.resolve('@runlith/tagma/plugin'));
const SDK = resolve(dirname(ENTRY), '../..');
const CLI = join(dirname(ENTRY), 'cli.ts');
const FIXTURE = join(import.meta.dir, 'sdkFixture.ts');
const DESCRIBED = 'Echoes the text it is given.';
const HOUR = 3_600_000;
const QUIET = 30_000;
const files = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

class NeverHeld extends Data.TaggedError('NeverHeld')<{}> {}

const until = <E>(holds: Effect.Effect<boolean, E>) =>
  Effect.retry(
    Effect.flatMap(holds, (held) => (held ? Effect.void : Effect.fail(new NeverHeld()))),
    { schedule: Schedule.spaced('20 millis') },
  );

const standing = (host: PluginHost['Service'], state: PluginProcessState) =>
  until(Effect.sync(() => host.reading('accept')?.state === state));

const journal = (data: string) =>
  Effect.promise(async () => {
    const file = Bun.file(join(data, 'machine', 'journal'));
    return (await file.exists()) ? (await file.text()).trim().split('\n') : [];
  });

const authored = (folder: string) =>
  Effect.promise(async () => {
    await writeFile(join(folder, 'plugin.ts'), await readFile(FIXTURE, 'utf8'));
    await rm(join(folder, 'plugin.test.ts'));
    await mkdir(join(folder, 'ui'));
    await writeFile(join(folder, 'ui', 'Board.svelte'), '<p>board</p>');
    await mkdir(join(folder, 'node_modules', '@runlith'), { recursive: true });
    await mkdir(join(folder, 'node_modules', '@types'), { recursive: true });
    await symlink(SDK, join(folder, 'node_modules', '@runlith', 'tagma'));
    await symlink(join(SDK, 'node_modules', '@types', 'bun'), join(folder, 'node_modules', '@types', 'bun'));
    await symlink(join(SDK, 'node_modules', 'effect'), join(folder, 'node_modules', 'effect'));
    await symlink(join(SDK, 'node_modules', 'svelte'), join(folder, 'node_modules', 'svelte'));
  });

const clocked = (home: string) =>
  Layer.mergeAll(
    schedule.lifetimes.serving.pipe(Layer.provideMerge(ticks)),
    buildSteps,
    viewsModule.lifetimes.installation.pipe(
      Layer.provide(Layer.succeed(ViewPlaces, { home: join(home, 'views') })),
      Layer.provide(Layer.succeed(WindowStyles, { utilities: null })),
    ),
  ).pipe(
    Layer.provideMerge(
      pluginHost.lifetimes.installation.pipe(
        Layer.provide(Layer.succeed(HostPlace, { server: null, quiet: QUIET })),
        Layer.provideMerge(
          pluginsModule.lifetimes.installation.pipe(
            Layer.provide(Layer.succeed(PluginPlaces, { home })),
            Layer.provide(Layer.succeed(PluginFormats, [tagmaFormat])),
            Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(files))),
            Layer.provide(BunFileSystem.layer),
          ),
        ),
      ),
    ),
    Layer.provide(memorySecretsLayer()),
    Layer.provide(projectIdentificationLayer.pipe(Layer.provide(liveGitLayer))),
  );

layer(Layer.merge(demoGraphLayer(), BunFileSystem.layer), { excludeTestServices: true })('a plugin written with the SDK', (it) => {
  it.effect(
    'created and built, it installs from its folder with its tool offered before any process ran, starts on the first call, sleeps when quiet and wakes on the next tick, and a process listing tools otherwise is refused',
    () =>
      Effect.gen(function* () {
        const world = yield* makeDoorWorld();
        const root = yield* world.directory('accept');
        const projectId = yield* world.stealthProject(root);
        const scope = `project=${projectId}`;
        const created = yield* world.op('create_plugin', { id: 'accept', title: 'Acceptance' }, scope);
        expect(created).toMatchObject({ status: 200, body: { status: 'ok' } });
        const folder = (created.body as { readonly path: string }).path;
        yield* authored(folder);
        const build = yield* spawnedEffect([process.execPath, CLI, 'build', folder], { cwd: folder });
        expect({ code: build.exitCode, said: `${build.stdout}${build.stderr}` }).toMatchObject({ code: 0 });

        expect(yield* world.op('install_plugin', { source: folder }, scope)).toMatchObject({
          status: 200,
          body: { plugin: { id: 'accept', format: 'tagma', enabled: true } },
        });
        yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id: 'accept' }, scope).pipe(Effect.orDie));
        const host = Context.get(world.runtime.owners, PluginHost);
        const data = join(world.dataHome, 'agent-plugin-data', 'accept');
        yield* standing(host, 'idle');
        const listed = yield* world.op('read_plugins', {}, scope);
        expect((listed.body as { readonly plugins: readonly PluginRow[] }).plugins.find((row) => row.id === 'accept')).toMatchObject({
          outdated: false,
          process: { state: 'idle', restarts: 0 },
        });
        const offered = yield* Context.get(world.runtime.owners, PluginTools).of(projectId);
        expect(Object.keys(offered.agents())).toContain('plugin__accept__echo');
        expect(yield* journal(data)).toEqual([]);

        const caller = { kind: 'agent', projectId, agentId: 'agent', ownerId: 'owner', thread: null } as const;
        expect(yield* host.call('accept', 'echo', { text: 'hi' }, { caller })).toMatchObject({
          structuredContent: { text: 'hi', project: projectId, pid: expect.any(Number) },
        });
        expect(host.reading('accept')?.state).toBe('running');
        expect(yield* journal(data)).toEqual([expect.stringMatching(/^call \d+$/)]);

        const [step, ...others] = yield* Context.get(world.runtime.owners, BuildSteps).of(root);
        expect(others).toEqual([]);
        expect(step).toMatchObject({ plugin: 'accept', title: 'Acceptance check', projectId });
        expect(yield* step!.ask({ offer: 'head', checkout: root })).toEqual({ verdict: 'stop', reason: 'held head' });

        const views = world.runtime.views;
        const [shown] = yield* Stream.runCollect(
          Stream.take(
            Stream.filter(views.sets(projectId), (state) =>
              state.plugins.some((set) => set.plugin === 'accept' && set.views.every((view) => view.module.state !== 'preparing')),
            ),
            1,
          ),
        );
        expect(shown?.plugins.find((set) => set.plugin === 'accept')).toMatchObject({
          views: [{ id: 'board', module: { state: 'ready' } }],
        });

        yield* withDemo((demo) =>
          Effect.gen(function* () {
            const home = yield* tempRootEffect(demo.fixture, 'sdk-plugin-home-');
            const built = yield* Layer.build(
              clocked(home).pipe(
                Layer.provide(
                  Layer.succeedContext(
                    Context.make(Settings, demo.graph.settings).pipe(
                      Context.add(Projects, demo.graph.projects),
                      Context.add(MachineStore, demo.graph.store),
                      Context.add(MachineUnits, demo.graph.units),
                    ),
                  ),
                ),
                Layer.provideMerge(BunFileSystem.layer),
                Layer.provideMerge(TestClock.layer()),
              ),
            );
            const within = <A, E>(work: Effect.Effect<A, E>) => Effect.provide(work, built);
            const sleeper = Context.get(built, PluginHost);
            const installs = Context.get(built, Plugins);
            const schedules = Context.get(built, Schedules);
            const advance = (ms: number) => within(TestClock.adjust(ms));
            const beats = join(home, 'agent-plugin-data', 'accept');
            const ran = (at: number) =>
              until(
                Effect.map(schedules.read({ after: null, limit: 10 }), (page) =>
                  page.rows.some((row) => row.owner === 'plugin:accept' && !row.running && row.last?.startedAt === at),
                ),
              );
            yield* within(sleeper.start());
            const prepared = yield* within(installs.prepare({ projectId: demo.projectId, source: folder }));
            yield* within(installs.install({ projectId: demo.projectId, prepared, enabled: true, scope: 'project' }));
            yield* standing(sleeper, 'idle');

            yield* advance(HOUR);
            yield* ran(HOUR);
            expect(sleeper.reading('accept')?.state).toBe('running');
            yield* advance(QUIET);
            yield* standing(sleeper, 'idle');
            yield* advance(HOUR - QUIET);
            yield* ran(2 * HOUR);
            const [first, again, ...more] = yield* journal(beats);
            expect(more).toEqual([]);
            expect([first, again]).toEqual([expect.stringMatching(/^tick \d+$/), expect.stringMatching(/^tick \d+$/)]);
            expect(again).not.toBe(first);
            expect((yield* schedules.read({ after: null, limit: 10 })).rows).toMatchObject([
              { owner: 'plugin:accept', name: 'beat', last: { outcome: 'delivered' } },
            ]);
          }),
        );

        const entry = join(folder, 'dist', 'process.js');
        const bundled = yield* Effect.promise(() => readFile(entry, 'utf8'));
        expect(bundled).toContain(DESCRIBED);
        yield* Effect.promise(() => writeFile(entry, bundled.replace(DESCRIBED, 'Echoes nothing.')));
        yield* standing(host, 'idle');
        expect(yield* Effect.flip(host.call('accept', 'echo', { text: 'hi' }, { caller }))).toMatchObject({ _tag: 'McpConnectFailed' });
        expect(host.reading('accept')).toMatchObject({ state: 'failed', failure: expect.stringContaining('echo (description)') });
      }),
  );
});
