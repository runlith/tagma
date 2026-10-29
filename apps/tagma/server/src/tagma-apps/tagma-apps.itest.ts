import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Clock, Context, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { graphFixture, tempRootEffect } from '../composition/testing/graphFixture.js';
import { watchProcessLayer } from '../composition/testing/fileWatcher.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SecretsPlace } from '../secrets/contract/service/secrets.js';
import { secrets } from '../secrets/secrets.js';
import { Settings } from '../settings/contract/service/values.js';
import { TagmaAppPlace, TagmaApps } from './contract/service/supervision.js';
import { TagmaAppTools } from './contract/service/tools.js';
import { tagmaAppsLayer } from './layer.js';
import { codeFilterOf, revisionOf } from './revision.js';

const FIXTURE = resolve(import.meta.dir, 'testing/fixture.ts');
const fixtureGraph = graphFixture();
const manifest = (contributes: Record<string, unknown>, id = 'fixture', flags: readonly string[] = []) =>
  JSON.stringify({ id, title: 'Fixture', process: { command: process.execPath, args: [FIXTURE, ...flags] }, contributes });
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
  const home = yield* tempRootEffect(demo.fixture, 'apps-home-').pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  const root = join(project.rootPath, '.tagma-apps', 'fixture');
  yield* Effect.promise(async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'tagma-app.json'), manifest(TOOLS));
  });
  const watching = yield* Layer.build(watchProcessLayer);
  const secretsAt = secrets.lifetimes.installation.pipe(Layer.provide(Layer.succeed(SecretsPlace, { home })));
  const built = yield* Layer.build(tagmaAppsLayer.pipe(Layer.provide(secretsAt))).pipe(
    Effect.provideService(Settings, Context.get(demo.context, Settings)),
    Effect.provideService(Projects, Context.get(demo.context, Projects)),
    Effect.provideService(TagmaAppPlace, { home, server: 'http://127.0.0.1:1' }),
    Effect.provideService(FileWatcher, Context.get(watching, FileWatcher)),
  );
  const apps = Context.get(built, TagmaApps);
  const tools = Context.get(built, TagmaAppTools);
  const said = Effect.fnUntraced(function* (tool: string, app = 'fixture') {
    const result = yield* apps.call(app, tool, {}, {});
    if (!('content' in result)) return yield* Effect.die('the fixture answered no content');
    const first = result.content[0];
    return first?.type === 'text' ? first.text : '';
  });
  const agentTools = () => Effect.map(tools.of(projectId), (available) => Object.keys(available.agents()).sort());
  const row = () => Effect.map(apps.list(projectId), (rows) => rows[0]);
  const revision = () => Effect.flatMap(codeFilterOf(root), (filter) => revisionOf(root, filter));
  const journal = () =>
    Effect.promise(async () => (await readFile(join(home, 'app-data', 'fixture', 'journal'), 'utf8')).trim().split('\n'));
  return { apps, projectId, home, root, said, tools, agentTools, row, revision, journal };
});

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const until = Effect.fnUntraced(function* <E>(holds: () => Effect.Effect<boolean, E>) {
  for (;;) {
    if (yield* holds()) return true;
    yield* Effect.sleep('50 millis');
  }
});

it.live('an installed app routes its audiences, survives a refused edit and a crash, and withdraws when hidden or uninstalled', () =>
  Effect.gen(function* () {
    const { apps, projectId, root, home, said, tools, agentTools, row } = yield* setup;
    expect(yield* apps.install({ projectId, id: 'fixture', enabled: true })).toMatchObject({
      id: 'fixture',
      state: 'running',
      enabled: true,
      installed: { source: root, enabled: true },
    });
    expect(yield* agentTools()).toEqual(['app__fixture__look']);
    expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual(['app__fixture__act']);
    expect((yield* tools.of(projectId)).view('fixture').map((tool) => tool.name)).toEqual(['deal']);
    expect(JSON.parse(yield* said('environment'))).toMatchObject({
      TAGMA_SERVER_URL: 'http://127.0.0.1:1',
      TAGMA_CALLER: 'app:fixture',
    });
    const first = yield* said('pid');
    yield* Effect.promise(() => writeFile(join(root, 'tagma-app.json'), manifest({ ...TOOLS, surfaces: [] })));
    expect(yield* until(() => Effect.map(row(), (row) => row?.refused?.includes('surfaces') === true))).toBe(true);
    expect(yield* said('pid')).toBe(first);
    yield* Effect.promise(() => writeFile(join(root, 'tagma-app.json'), manifest(TOOLS)));
    yield* apps.install({ projectId, id: 'fixture', enabled: true });
    yield* Effect.exit(apps.call('fixture', 'crash', {}, {}));
    expect(yield* until(() => Effect.map(row(), (row) => row?.state === 'failed'))).toBe(true);
    expect(yield* agentTools()).toEqual([]);
    expect(yield* until(() => Effect.map(row(), (row) => row?.state === 'running'))).toBe(true);
    expect(yield* said('pid')).not.toBe(first);
    expect(yield* agentTools()).toEqual(['app__fixture__look']);

    yield* apps.enable({ projectId, id: 'fixture', enabled: false });
    expect(yield* agentTools()).toEqual([]);
    expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual([]);
    expect((yield* tools.of(projectId)).view('fixture')).toEqual([]);
    yield* apps.enable({ projectId, id: 'fixture', enabled: true });
    const elsewhere = join(home, 'apps', 'fixture');
    yield* Effect.promise(async () => {
      await mkdir(elsewhere, { recursive: true });
      await writeFile(join(elsewhere, 'tagma-app.json'), manifest(TOOLS));
    });
    expect(yield* Effect.flip(apps.install({ projectId, id: 'fixture', enabled: true }))).toMatchObject({ code: 'app-collision' });
    yield* Effect.promise(() => rm(root, { recursive: true }));
    expect(yield* Effect.flip(apps.install({ projectId, id: 'fixture', enabled: true }))).toMatchObject({
      code: 'app-source-taken',
    });
    expect(yield* apps.uninstall({ projectId, id: 'fixture' })).toMatchObject({ installed: null, enabled: false, state: 'stopped' });
    expect(yield* agentTools()).toEqual([]);
  }),
);

it.live('closing the apps waits out processes that ignore the end of stdin together, not one after another', () =>
  Effect.gen(function* () {
    const owned = yield* Scope.fork(yield* Effect.scope);
    const { apps, projectId, root, said } = yield* setup.pipe(Scope.provide(owned));
    const second = join(dirname(root), 'second');
    const journal = join(yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'apps-linger-'))), 'journal');
    yield* Effect.promise(async () => {
      await writeFile(join(root, 'tagma-app.json'), manifest(TOOLS, 'fixture', ['--linger', journal]));
      await mkdir(second, { recursive: true });
      await writeFile(join(second, 'tagma-app.json'), manifest(TOOLS, 'second', ['--linger', journal]));
    });
    yield* apps.install({ projectId, id: 'fixture', enabled: true });
    yield* apps.install({ projectId, id: 'second', enabled: true });
    const pids = [Number(yield* said('pid')), Number(yield* said('pid', 'second'))];
    yield* Scope.close(owned, Exit.void);
    const heard = (yield* Effect.promise(() => readFile(journal, 'utf8'))).trim().split('\n');
    expect(heard.slice(0, 2).sort()).toEqual(pids.map((pid) => `eof ${pid}`).sort());
    expect(heard.slice(2).sort()).toEqual(pids.map((pid) => `term ${pid}`).sort());
    expect(pids.filter(alive)).toEqual([]);
  }),
);

it.live('an edit drains the serving call before replacing its process, and concurrent callers reach the new generation', () =>
  Effect.gen(function* () {
    const productClock = yield* TestClock.make();
    const product = Effect.provideService(Clock.Clock, productClock);
    const { apps, projectId, root, home, said, revision, journal, agentTools, row } = yield* setup.pipe(product);
    yield* Effect.promise(() => writeFile(join(root, '.gitignore'), '*.log\n'));
    yield* apps.install({ projectId, id: 'fixture', enabled: true }).pipe(product);
    const first = yield* said('pid').pipe(product);
    const before = yield* revision();
    yield* Effect.promise(async () => {
      await mkdir(join(root, 'ui'), { recursive: true });
      await writeFile(join(root, 'ui', 'table.html'), '<p>a view</p>');
      await writeFile(join(root, 'process.log'), 'written by the process');
    });
    expect(yield* revision()).toBe(before);
    const serving = yield* Effect.forkScoped(said('hold').pipe(product));
    yield* Effect.promise(() =>
      writeFile(join(root, 'tagma-app.json'), manifest({ tools: [...TOOLS.tools, { name: 'pid', audience: 'agents' }] })),
    );
    const restarted = yield* Effect.forkScoped(apps.install({ projectId, id: 'fixture', enabled: true }).pipe(product));
    yield* until(() => Effect.map(row(), (row) => row?.tools === 0));
    const meanwhile = yield* Effect.forkScoped(said('pid').pipe(product));
    yield* Effect.yieldNow;
    expect(serving.pollUnsafe()).toBeUndefined();
    expect(meanwhile.pollUnsafe()).toBeUndefined();
    yield* Effect.promise(() => writeFile(join(home, 'app-data', 'fixture', 'release'), ''));
    expect(yield* Fiber.join(serving)).toBe(`held ${first}`);
    yield* Fiber.join(restarted);
    const second = yield* Fiber.join(meanwhile);
    expect(second).not.toBe(first);
    expect(yield* journal()).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
    expect(yield* agentTools()).toEqual(['app__fixture__look', 'app__fixture__pid']);
  }),
);
