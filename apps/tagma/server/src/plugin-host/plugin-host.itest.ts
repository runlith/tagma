import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Clock, Context, Effect, Exit, Fiber, Layer, Schedule, Scope } from 'effect';
import { watchProcessLayer } from '../composition/testing/fileWatcher.js';
import { FileWatcher, WatchRefused } from '../platform/contract/service/watch.js';
import { claudeCodeFormat } from '../plugin-formats/claude-code/format.js';
import { MANIFEST } from '../plugin-formats/tagma/contract/wire/manifest.js';
import { tagmaFormat } from '../plugin-formats/tagma/format.js';
import { manifestText, type PluginFolder, writePlugin } from '../plugin-formats/tagma/testing/folder.js';
import { fixtureEntries } from './testing/tools.js';
import { hostWorld } from './testing/world.js';

const FIXTURE = resolve(import.meta.dir, 'testing/fixture.ts');
const TOOLS = { tools: fixtureEntries({ look: 'agents', act: 'own', deal: 'view' }) };

const watched = Effect.map(Layer.build(watchProcessLayer), (built) => Context.make(FileWatcher, Context.get(built, FileWatcher)));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const lines = (path: string) => Effect.promise(async () => (await readFile(path, 'utf8')).trim().split('\n'));

it.live(
  'an installed plugin offers its tools before its process ever runs, starts on a call, outlives a refused edit and a crash, and withdraws when switched off or removed',
  () =>
    Effect.gen(function* () {
      const world = yield* hostWorld({ prefix: 'host-', watcher: yield* watched });
      const { host, plugins, projectId, tools, said, until } = world;
      const agentTools = () => Effect.map(tools.of(projectId), (available) => Object.keys(available.agents()).sort());
      const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
      expect(yield* world.install(root)).toMatchObject({ id: 'fixture', format: 'tagma', enabled: true });
      yield* until(() => host.reading('fixture')?.state === 'idle');
      expect(yield* agentTools()).toEqual(['plugin__fixture__look']);
      expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual(['plugin__fixture__act']);
      expect((yield* tools.of(projectId)).view('fixture').map((tool) => tool.name)).toEqual(['deal']);
      expect(existsSync(join(world.data('fixture'), 'journal'))).toBe(false);
      expect(JSON.parse(yield* said('environment'))).toMatchObject({
        TAGMA_SERVER_URL: 'http://127.0.0.1:1',
        TAGMA_CALLER: 'plugin:fixture',
        TAGMA_PLUGIN_DATA: world.data('fixture'),
      });
      expect(host.reading('fixture')?.state).toBe('running');
      const first = yield* said('pid');
      const manifest = (contributes: Record<string, unknown>) =>
        writeFile(join(root, MANIFEST), manifestText({ id: 'fixture', title: 'Fixture', program: FIXTURE, contributes }));
      yield* Effect.promise(() => manifest({ ...TOOLS, surfaces: [] }));
      yield* until(() => host.reading('fixture')?.refused?.includes('surfaces') === true);
      expect((yield* plugins.rows(projectId, ['fixture']))[0]?.process?.refused).toContain('surfaces');
      expect(yield* said('pid')).toBe(first);
      yield* Effect.promise(() => manifest(TOOLS));
      yield* until(() => host.reading('fixture')?.refused === undefined);
      yield* Effect.exit(host.call('fixture', 'crash', {}, {}));
      yield* until(() => host.reading('fixture')?.state === 'idle');
      expect(host.reading('fixture')).toMatchObject({ restarts: 1 });
      expect(yield* agentTools()).toEqual(['plugin__fixture__look']);
      expect(yield* said('pid')).not.toBe(first);

      yield* plugins.enable({ projectId, id: 'fixture', enabled: false, scope: 'project' });
      expect(yield* agentTools()).toEqual([]);
      expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual([]);
      expect((yield* tools.of(projectId)).view('fixture')).toEqual([]);
      yield* until(() => host.reading('fixture') === undefined);
      yield* plugins.enable({ projectId, id: 'fixture', enabled: true, scope: 'project' });
      yield* until(() => host.reading('fixture')?.state === 'idle');
      yield* plugins.uninstall({ projectId, id: 'fixture' });
      yield* until(() => host.reading('fixture') === undefined);
      expect(yield* agentTools()).toEqual([]);
    }),
);

it.live('a process idle past its quiet period stops, and the next call starts another', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-quiet-', quiet: '300 millis' });
    const { host, said, until } = world;
    yield* world.install(yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS }));
    yield* until(() => host.reading('fixture')?.state === 'idle');
    const first = yield* said('pid');
    yield* until(() => host.reading('fixture')?.state === 'idle');
    expect(alive(Number(first))).toBe(false);
    const second = yield* said('pid');
    expect(second).not.toBe(first);
    expect(yield* lines(join(world.data('fixture'), 'journal'))).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
  }),
);

it.live('a process whose tool list differs from its manifest is refused, named, and its tools are offered to no agent', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-listing-' });
    const { host, projectId, tools, until } = world;
    const listed = TOOLS.tools
      .filter((entry) => entry.name !== 'slow')
      .map((entry) => (entry.name === 'act' ? { ...entry, description: 'Acts otherwise.' } : entry));
    yield* world.install(yield* world.place('fixture', { program: FIXTURE, contributes: { tools: listed } }));
    yield* until(() => host.reading('fixture')?.state === 'idle');
    expect(Object.keys((yield* tools.of(projectId)).agents())).toEqual(['plugin__fixture__look']);
    expect(yield* Effect.flip(host.call('fixture', 'look', {}, {}))).toMatchObject({ _tag: 'McpConnectFailed' });
    const failure = host.reading('fixture')?.failure ?? '';
    expect(host.reading('fixture')?.state).toBe('failed');
    expect(failure).toContain('serves slow, which its manifest does not name');
    expect(failure).toContain('act (description)');
    expect(Object.keys((yield* tools.of(projectId)).agents())).toEqual([]);
    expect((yield* lines(join(world.data('fixture'), 'journal'))).map((line) => line.split(' ')[0])).toEqual(['start', 'exit']);
  }),
);

it.live(
  'a process that ends before it answers waits idle behind its backoff with its tools offered, calls meanwhile wait for the gate and start it once, and a later call starts it',
  () =>
    Effect.gen(function* () {
      const world = yield* hostWorld({ prefix: 'host-unstarted-' });
      const { host, projectId, tools, said, until } = world;
      yield* world.install(yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS }));
      yield* until(() => host.reading('fixture')?.state === 'idle');
      const refusing = join(world.data('fixture'), 'refuse');
      const journal = join(world.data('fixture'), 'journal');
      const failed = Effect.map(Effect.flip(host.call('fixture', 'look', {}, {})), (failure) => failure._tag);
      yield* Effect.promise(() => writeFile(refusing, ''));
      const before = yield* Clock.currentTimeMillis;
      expect(yield* failed).toBe('McpConnectFailed');
      expect(host.reading('fixture')).toMatchObject({ state: 'idle', restarts: 1 });
      expect(Object.keys((yield* tools.of(projectId)).agents())).toEqual(['plugin__fixture__look']);
      expect(yield* Effect.all([failed, failed, failed], { concurrency: 'unbounded' })).toEqual([
        'McpConnectFailed',
        'McpConnectFailed',
        'McpConnectFailed',
      ]);
      expect((yield* Clock.currentTimeMillis) - before).toBeGreaterThanOrEqual(1_000);
      expect((yield* lines(journal)).map((line) => line.split(' ')[0])).toEqual(['refused', 'refused']);
      expect(host.reading('fixture')).toMatchObject({ state: 'idle', restarts: 2 });
      yield* Effect.promise(() => rm(refusing));
      expect(yield* said('look')).toStartWith('look ');
    }),
);

it.live('a call made while a quiet process is being stopped waits for it to end and starts the next one', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-stopping-', quiet: '300 millis' });
    const { host, said, until } = world;
    const ending = join(yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'plugins-stopping-'))), 'journal');
    const linger = [{ key: 'LINGER', title: 'Linger', description: 'Where the process notes how it was ended.', default: ending }];
    yield* world.install(yield* world.place('fixture', { program: FIXTURE, options: linger, contributes: TOOLS }));
    yield* until(() => host.reading('fixture')?.state === 'idle');
    const first = yield* said('pid');
    yield* until(() => existsSync(ending));
    expect(yield* lines(ending)).toEqual([`eof ${first}`]);
    const second = yield* said('pid');
    expect(second).not.toBe(first);
    expect(alive(Number(first))).toBe(false);
    expect(yield* lines(join(world.data('fixture'), 'journal'))).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
  }),
);

it.live(
  'a plugin whose manifest cannot be read keeps the others hosted, owes its ends, and is not read again for another plugin’s change',
  () =>
    Effect.gen(function* () {
      const world = yield* hostWorld({ prefix: 'host-unreadable-' });
      const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
      yield* world.install(root);
      yield* world.install(yield* world.place('second', { program: FIXTURE, contributes: TOOLS }));
      yield* world.until(() => world.host.reading('second')?.state === 'idle');
      yield* world.shutdown;
      const manifest = join(root, MANIFEST);
      yield* Effect.acquireRelease(
        Effect.promise(() => chmod(manifest, 0o000)),
        () => Effect.promise(() => chmod(manifest, 0o644)),
      );
      const booted = yield* world.boot();
      yield* world.until(() => booted.host.reading('fixture')?.state === 'failed' && booted.host.reading('second')?.state === 'idle');
      expect(yield* booted.host.pending('fixture')).toBe(true);
      const restarts = booted.host.reading('fixture')?.restarts;
      yield* booted.plugins.enable({ projectId: world.projectId, id: 'second', enabled: false, scope: 'project' });
      yield* world.until(() => booted.host.reading('second') === undefined);
      expect(booted.host.reading('fixture')?.restarts).toBe(restarts);
    }),
);

it.live('uninstalling a copied plugin removes the copy only after its process stopped and the call it served answered', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-uninstall-' });
    const { host, plugins, projectId, said, until } = world;
    const prepared = yield* plugins.prepare({
      projectId,
      source: {
        source: { kind: 'folder', path: yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS }) },
        origin: { marketplace: 'market', entry: 'fixture' },
        declared: null,
      },
    });
    const { root } = yield* plugins.install({ projectId, prepared, enabled: true, scope: 'project' });
    if (root === null) return yield* Effect.die('an installed plugin is read from its own directory');
    yield* until(() => host.reading('fixture')?.state === 'idle');
    const serving = yield* Effect.forkScoped(said('hold'));
    yield* until(() => host.reading('fixture')?.state === 'running');
    const uninstalled = yield* Effect.forkScoped(plugins.uninstall({ projectId, id: 'fixture' }));
    yield* Effect.repeat(plugins.ids(), { schedule: Schedule.spaced('20 millis'), until: (ids) => !ids.includes('fixture') });
    expect(existsSync(root)).toBe(true);
    yield* Effect.promise(() => writeFile(join(world.data('fixture'), 'release'), ''));
    expect(yield* Fiber.join(serving)).toStartWith('held ');
    yield* Fiber.join(uninstalled);
    expect(existsSync(root)).toBe(false);
  }),
);

it.live('a resident plugin runs from its enabling and comes back by itself after a crash', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-resident-' });
    const { host, said, until } = world;
    yield* world.install(yield* world.place('fixture', { program: FIXTURE, resident: true, contributes: TOOLS }));
    yield* until(() => host.reading('fixture')?.state === 'running');
    const journal = join(world.data('fixture'), 'journal');
    const [started] = yield* lines(journal);
    yield* Effect.exit(host.call('fixture', 'crash', {}, {}));
    yield* until(() => host.reading('fixture')?.restarts === 1 && host.reading('fixture')?.state === 'running');
    expect((yield* lines(journal)).filter((line) => line.startsWith('start '))).toHaveLength(2);
    expect(`start ${yield* said('pid')}`).not.toBe(started);
  }),
);

it.live(
  'a plugin reads outdated once a source its build lists changes or goes missing, and unknown with the cause on its own row while its sources cannot be hashed',
  () =>
    Effect.gen(function* () {
      const world = yield* hostWorld({ prefix: 'host-outdated-' });
      const { plugins, projectId } = world;
      const source = 'export default 1;\n';
      const hash = createHash('sha256')
        .update(`plugin.ts\u0000${Buffer.byteLength(source)}\u0000${source}`)
        .digest('hex');
      const root = yield* world.place('fixture', { build: { hash, sources: ['plugin.ts'] } });
      yield* Effect.promise(() => writeFile(join(root, 'plugin.ts'), source));
      yield* world.install(root);
      const outdated = Effect.map(plugins.rows(projectId, ['fixture']), ([row]) => row?.outdated);
      expect(yield* outdated).toBe(false);
      yield* Effect.promise(() => writeFile(join(root, 'plugin.ts'), 'export default 2;\n'));
      expect(yield* outdated).toBe(true);
      yield* Effect.promise(() => writeFile(join(root, 'plugin.ts'), source));
      expect(yield* outdated).toBe(false);
      yield* Effect.promise(() => rm(join(root, 'plugin.ts')));
      expect(yield* outdated).toBe(true);
      yield* world.shutdown;
      expect(yield* plugins.rows(projectId, ['fixture'])).toMatchObject([
        { id: 'fixture', title: 'Fixture', outdated: null, unhashed: expect.stringContaining('could not be hashed: the plugins closed') },
      ]);
    }),
);

it.live('a manifest naming a point no owner declares refuses the install', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-refused-' });
    const root = yield* world.place('fixture', { program: FIXTURE, contributes: { ...TOOLS, surfaces: [] } });
    expect(yield* Effect.flip(world.install(root))).toMatchObject({ code: 'plugin-refused' });
    expect(world.host.reading('fixture')).toBeUndefined();
  }),
);

it.live('a plugin whose manifest is broken when the server starts is watched, and stands once the manifest is repaired', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-boot-', watcher: yield* watched });
    const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
    yield* world.install(root);
    yield* world.until(() => world.host.reading('fixture')?.state === 'idle');
    yield* world.shutdown;
    const manifest = join(root, MANIFEST);
    const valid = yield* Effect.promise(() => readFile(manifest, 'utf8'));
    yield* Effect.promise(() => writeFile(manifest, '{ not json'));
    const booted = yield* world.boot();
    yield* world.until(() => booted.host.reading('fixture')?.state === 'failed');
    expect(yield* booted.host.pending('fixture')).toBe(true);
    yield* Effect.promise(() => writeFile(manifest, valid));
    yield* world.until(() => booted.host.reading('fixture')?.state === 'idle');
    expect(yield* booted.host.pending('fixture')).toBe(false);
    expect(Object.keys((yield* booted.tools.of(world.projectId)).agents())).toEqual(['plugin__fixture__look']);
  }),
);

it.live('a plugin is read again by polling while its watch is refused, and is watched again once the watch answers', () =>
  Effect.gen(function* () {
    const watcher = Context.get(yield* watched, FileWatcher);
    let refusing = true;
    let opened = 0;
    const recovering = FileWatcher.of({
      ...watcher,
      subscribe: (at, options, hearing) =>
        refusing
          ? Effect.fail(new WatchRefused({ message: 'the watch service is unavailable' }))
          : Effect.tap(watcher.subscribe(at, options, hearing), () => Effect.sync(() => void (opened += 1))),
    });
    const world = yield* hostWorld({ prefix: 'host-polled-', watcher: Context.make(FileWatcher, recovering) });
    const { host, until } = world;
    const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
    yield* world.install(root);
    yield* until(() => host.reading('fixture')?.state === 'idle');
    const retitled = (title: string) =>
      Effect.promise(() => writeFile(join(root, MANIFEST), manifestText({ id: 'fixture', title, program: FIXTURE, contributes: TOOLS })));
    yield* retitled('Polled');
    yield* until(() => host.title('fixture') === 'Polled');
    refusing = false;
    yield* until(() => opened > 0);
    yield* retitled('Watched');
    yield* until(() => host.title('fixture') === 'Watched');
  }),
);

it.live('rebuilds alone take a plugin up when it gains a process and contributions, and stop it when it loses them', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-gained-', watcher: yield* watched });
    const { host, projectId, tools, until } = world;
    const root = yield* world.place('fixture', {});
    const rebuilt = (folder: Omit<PluginFolder, 'id'>) =>
      Effect.promise(() => writePlugin(root, { id: 'fixture', title: 'Fixture', ...folder }));
    yield* world.install(root);
    expect(host.reading('fixture')).toBeUndefined();
    yield* rebuilt({ program: FIXTURE, contributes: TOOLS });
    yield* until(() => host.reading('fixture')?.state === 'idle');
    yield* rebuilt({});
    yield* until(() => host.reading('fixture') === undefined);
    yield* rebuilt({ program: FIXTURE, contributes: TOOLS });
    yield* until(() => host.reading('fixture')?.state === 'idle');
    expect(Object.keys((yield* tools.of(projectId)).agents())).toEqual(['plugin__fixture__look']);
  }),
);

it.live('a directory holding tagma-plugin.json is read in Tagma’s format even where a marketplace entry declares another', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-formats-', formats: [tagmaFormat, claudeCodeFormat] });
    const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
    yield* Effect.promise(async () => {
      await mkdir(join(root, '.claude-plugin'), { recursive: true });
      await writeFile(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'fixture' }));
    });
    const prepared = yield* world.plugins.prepare({
      projectId: world.projectId,
      source: {
        source: { kind: 'folder', path: root },
        origin: { marketplace: 'market', entry: 'fixture' },
        declared: { name: 'fixture', manifest: { format: 'claude-code', fields: { name: 'fixture' } } },
      },
    });
    expect(prepared.preview).toMatchObject({ format: 'tagma', id: 'fixture' });
  }),
);

it.live('closing the host waits out processes that ignore the end of stdin together, not one after another', () =>
  Effect.gen(function* () {
    const owned = yield* Scope.fork(yield* Effect.scope);
    const world = yield* hostWorld({ prefix: 'host-linger-' }).pipe(Scope.provide(owned));
    const journal = join(yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'plugins-linger-'))), 'journal');
    const linger = [{ key: 'LINGER', title: 'Linger', description: 'Where the process notes how it was ended.', default: journal }];
    for (const id of ['fixture', 'second']) {
      yield* world.install(yield* world.place(id, { program: FIXTURE, resident: true, options: linger, contributes: TOOLS }));
    }
    yield* world.until(() => world.host.reading('fixture')?.state === 'running' && world.host.reading('second')?.state === 'running');
    const pids = [Number(yield* world.said('pid')), Number(yield* world.said('pid', 'second'))];
    yield* Scope.close(owned, Exit.void);
    const heard = yield* lines(journal);
    expect(heard.slice(0, 2).sort()).toEqual(pids.map((pid) => `eof ${pid}`).sort());
    expect(heard.slice(2).sort()).toEqual(pids.map((pid) => `term ${pid}`).sort());
    expect(pids.filter(alive)).toEqual([]);
  }),
);

it.live('a rebuild drains the serving call before replacing its process, and a call made meanwhile reaches the new process', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-drain-', watcher: yield* watched });
    const { host, projectId, tools, said, until } = world;
    const root = yield* world.place('fixture', { program: FIXTURE, contributes: TOOLS });
    yield* world.install(root);
    yield* until(() => host.reading('fixture')?.state === 'idle');
    const first = yield* said('pid');
    yield* Effect.promise(async () => {
      await mkdir(join(root, 'ui'), { recursive: true });
      await writeFile(join(root, 'ui', 'table.html'), '<p>a view</p>');
    });
    const serving = yield* Effect.forkScoped(said('hold'));
    yield* Effect.promise(() =>
      writeFile(
        join(root, MANIFEST),
        manifestText({
          id: 'fixture',
          title: 'Fixture again',
          program: FIXTURE,
          contributes: { tools: fixtureEntries({ look: 'agents', act: 'own', deal: 'view', pid: 'agents' }) },
        }),
      ),
    );
    yield* Effect.repeat(
      Effect.sync(() => host.title('fixture')),
      { schedule: Schedule.spaced('20 millis'), until: (title) => title === 'Fixture again' },
    );
    const meanwhile = yield* Effect.forkScoped(said('pid'));
    yield* Effect.yieldNow;
    expect(serving.pollUnsafe()).toBeUndefined();
    expect(meanwhile.pollUnsafe()).toBeUndefined();
    yield* Effect.promise(() => writeFile(join(world.data('fixture'), 'release'), ''));
    expect(yield* Fiber.join(serving)).toBe(`held ${first}`);
    const second = yield* Fiber.join(meanwhile);
    expect(second).not.toBe(first);
    expect(yield* lines(join(world.data('fixture'), 'journal'))).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
    expect(Object.keys((yield* tools.of(projectId)).agents()).sort()).toEqual(['plugin__fixture__look', 'plugin__fixture__pid']);
    expect(host.reading('fixture')?.state).toBe('running');
  }),
);
