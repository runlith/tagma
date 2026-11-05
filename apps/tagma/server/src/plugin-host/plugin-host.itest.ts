import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context, Effect, Exit, Fiber, Layer, Schedule, Scope } from 'effect';
import { watchProcessLayer } from '../composition/testing/fileWatcher.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { claudeCodeFormat } from '../plugin-formats/claude-code/format.js';
import { MANIFEST } from '../plugin-formats/tagma/contract/wire/manifest.js';
import { tagmaFormat } from '../plugin-formats/tagma/format.js';
import { manifestText } from '../plugin-formats/tagma/testing/folder.js';
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
    yield* Effect.promise(() => writeFile(manifest, valid));
    yield* world.until(() => booted.host.reading('fixture')?.state === 'idle');
    expect(Object.keys((yield* booted.tools.of(world.projectId)).agents())).toEqual(['plugin__fixture__look']);
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
    yield* Effect.repeat(world.titles.read(projectId), {
      schedule: Schedule.spaced('20 millis'),
      until: (titles) => titles.get('fixture') === 'Fixture again',
    });
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
