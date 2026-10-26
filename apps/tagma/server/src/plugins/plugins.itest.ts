import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Clock, Context, Effect, Fiber, Layer, Option } from 'effect';
import { graphFixture, tempRootEffect } from '../composition/testing/graphFixture.js';
import { watchProcessLayer } from '../composition/testing/fileWatcher.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { Projects } from '../projects/contract/service/registry.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginPlace, Plugins } from './contract/service/supervision.js';
import { PluginTools } from './contract/service/tools.js';
import { pluginsLayer } from './layer.js';
import { codeFilterOf, revisionOf } from './revision.js';

const FIXTURE = resolve(import.meta.dir, 'testing/fixture.ts');
const fixtureGraph = graphFixture();
const manifest = (contributes: Record<string, unknown>) =>
  JSON.stringify({ id: 'fixture', title: 'Fixture', process: { command: process.execPath, args: [FIXTURE] }, contributes });
const TOOLS = {
  tools: [
    { name: 'look', audience: 'agents' },
    { name: 'act', audience: 'own' },
    { name: 'deal', audience: 'view' },
  ],
};

const setup = Effect.gen(function* () {
  const demo = yield* Effect.acquireRelease(fixtureGraph.openEffect(), () => Effect.orDie(fixtureGraph.releaseEffect));
  const projectId = demo.projectId;
  const home = yield* tempRootEffect(demo.fixture, 'plugins-home-').pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  const root = join(project.rootPath, '.plugins', 'fixture');
  yield* Effect.promise(async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'plugin.json'), manifest(TOOLS));
  });
  const watching = yield* Layer.build(watchProcessLayer);
  const built = yield* Layer.build(pluginsLayer).pipe(
    Effect.provideService(Settings, Context.get(demo.context, Settings)),
    Effect.provideService(Projects, Context.get(demo.context, Projects)),
    Effect.provideService(PluginPlace, { home, server: 'http://127.0.0.1:1' }),
    Effect.provideService(FileWatcher, Context.get(watching, FileWatcher)),
  );
  const plugins = Context.get(built, Plugins);
  const tools = Context.get(built, PluginTools);
  const said = Effect.fnUntraced(function* (tool: string) {
    const result = yield* plugins.call('fixture', tool, {}, {});
    if (!('content' in result)) return yield* Effect.die('the fixture answered no content');
    const first = result.content[0];
    return first?.type === 'text' ? first.text : '';
  });
  const agentTools = () => Effect.map(tools.of(projectId), (available) => Object.keys(available.agents()).sort());
  const row = () => Effect.map(plugins.list(projectId), (rows) => rows[0]);
  const revision = () => Effect.flatMap(codeFilterOf(root), (filter) => revisionOf(root, filter));
  const journal = () =>
    Effect.promise(async () => (await readFile(join(home, 'plugin-data', 'fixture', 'journal'), 'utf8')).trim().split('\n'));
  return { plugins, projectId, home, root, said, tools, agentTools, row, revision, journal };
});

const until = Effect.fnUntraced(function* <E>(holds: () => Effect.Effect<boolean, E>) {
  const start = yield* Clock.currentTimeMillis;
  while ((yield* Clock.currentTimeMillis) - start < 10_000) {
    if (yield* holds()) return true;
    yield* Effect.sleep('50 millis');
  }
  return yield* holds();
});

it.live(
  'an installed plugin routes its audiences, survives a refused edit and a crash, and withdraws when hidden or uninstalled',
  () =>
    Effect.gen(function* () {
      const { plugins, projectId, root, home, said, tools, agentTools, row } = yield* setup;
      expect(yield* plugins.install({ projectId, id: 'fixture', enabled: true })).toMatchObject({
        id: 'fixture',
        state: 'running',
        enabled: true,
        installed: { source: root, enabled: true },
      });
      expect(yield* agentTools()).toEqual(['plugin__fixture__look']);
      expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual(['plugin__fixture__act']);
      expect((yield* tools.of(projectId)).view('fixture').map((tool) => tool.name)).toEqual(['deal']);
      expect(JSON.parse(yield* said('environment'))).toMatchObject({
        TAGMA_SERVER_URL: 'http://127.0.0.1:1',
        TAGMA_CALLER: 'plugin:fixture',
      });
      const first = yield* said('pid');
      yield* Effect.promise(() => writeFile(join(root, 'plugin.json'), manifest({ ...TOOLS, surfaces: [] })));
      expect(yield* until(() => Effect.map(row(), (row) => row?.refused?.includes('surfaces') === true))).toBe(true);
      expect(yield* said('pid')).toBe(first);
      yield* Effect.promise(() => writeFile(join(root, 'plugin.json'), manifest(TOOLS)));
      yield* plugins.install({ projectId, id: 'fixture', enabled: true });
      yield* Effect.exit(plugins.call('fixture', 'crash', {}, {}));
      expect(yield* until(() => Effect.map(row(), (row) => row?.state === 'failed'))).toBe(true);
      expect(yield* agentTools()).toEqual([]);
      expect(yield* until(() => Effect.map(row(), (row) => row?.state === 'running'))).toBe(true);
      expect(yield* said('pid')).not.toBe(first);
      expect(yield* agentTools()).toEqual(['plugin__fixture__look']);

      yield* plugins.enable({ projectId, id: 'fixture', enabled: false });
      expect(yield* agentTools()).toEqual([]);
      expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual([]);
      expect((yield* tools.of(projectId)).view('fixture')).toEqual([]);
      yield* plugins.enable({ projectId, id: 'fixture', enabled: true });
      const elsewhere = join(home, 'plugins', 'fixture');
      yield* Effect.promise(async () => {
        await mkdir(elsewhere, { recursive: true });
        await writeFile(join(elsewhere, 'plugin.json'), manifest(TOOLS));
      });
      expect(yield* Effect.flip(plugins.install({ projectId, id: 'fixture', enabled: true }))).toMatchObject({ code: 'plugin-collision' });
      yield* Effect.promise(() => rm(root, { recursive: true }));
      expect(yield* Effect.flip(plugins.install({ projectId, id: 'fixture', enabled: true }))).toMatchObject({
        code: 'plugin-source-taken',
      });
      expect(yield* plugins.uninstall({ projectId, id: 'fixture' })).toMatchObject({ installed: null, enabled: false, state: 'stopped' });
      expect(yield* agentTools()).toEqual([]);
    }),
  20_000,
);

it.live(
  'an edit drains the serving call before replacing its process, and concurrent callers reach the new generation',
  () =>
    Effect.gen(function* () {
      const { plugins, projectId, root, said, revision, journal, agentTools } = yield* setup;
      yield* Effect.promise(() => writeFile(join(root, '.gitignore'), '*.log\n'));
      yield* plugins.install({ projectId, id: 'fixture', enabled: true });
      const first = yield* said('pid');
      const before = yield* revision();
      yield* Effect.promise(async () => {
        await mkdir(join(root, 'ui'), { recursive: true });
        await writeFile(join(root, 'ui', 'table.html'), '<p>a view</p>');
        await writeFile(join(root, 'process.log'), 'written by the process');
      });
      expect(yield* revision()).toBe(before);
      const serving = yield* Effect.forkScoped(said('slow'));
      yield* Effect.promise(() =>
        writeFile(join(root, 'plugin.json'), manifest({ tools: [...TOOLS.tools, { name: 'pid', audience: 'agents' }] })),
      );
      const restarted = yield* Effect.forkScoped(plugins.install({ projectId, id: 'fixture', enabled: true }));
      yield* until(() => Effect.map(Effect.timeoutOption(plugins.call('fixture', 'pid', {}, {}), '50 millis'), Option.isNone));
      const meanwhile = yield* Effect.forkScoped(said('pid'));
      expect(yield* Fiber.join(serving)).toBe(`slow ${first}`);
      yield* Fiber.join(restarted);
      const second = yield* Fiber.join(meanwhile);
      expect(second).not.toBe(first);
      expect(yield* journal()).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
      expect(yield* agentTools()).toEqual(['plugin__fixture__look', 'plugin__fixture__pid']);
    }),
  20_000,
);
