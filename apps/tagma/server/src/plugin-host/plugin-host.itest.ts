import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Context, Effect, Exit, Fiber, Layer, Scope } from 'effect';
import { watchProcessLayer } from '../composition/testing/fileWatcher.js';
import { FileWatcher } from '../platform/contract/service/watch.js';
import { claudeCodeFormat } from '../plugin-formats/claude-code/format.js';
import { tagmaFormat } from '../plugin-formats/tagma/format.js';
import { codeFilterOf, revisionOf } from './revision.js';
import { hostWorld } from './testing/world.js';

const FIXTURE = resolve(import.meta.dir, 'testing/fixture.ts');
const processOf = (flags: readonly string[] = []) => ({ command: process.execPath, args: [FIXTURE, ...flags] });
const TOOLS = {
  tools: [
    { name: 'look', audience: 'agents' },
    { name: 'act', audience: 'own' },
    { name: 'deal', audience: 'view' },
  ],
};

const watched = Effect.map(Layer.build(watchProcessLayer), (built) => Context.make(FileWatcher, Context.get(built, FileWatcher)));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.live('an installed plugin routes its audiences, survives a refused edit and a crash, and withdraws when switched off or removed', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-', watcher: yield* watched });
    const { host, plugins, projectId, tools, said, until } = world;
    const agentTools = () => Effect.map(tools.of(projectId), (available) => Object.keys(available.agents()).sort());
    const root = yield* world.place('fixture', { process: processOf(), contributes: TOOLS });
    expect(yield* world.install(root)).toMatchObject({ id: 'fixture', format: 'tagma', enabled: true });
    yield* until(() => host.reading('fixture')?.state === 'running');
    expect(yield* agentTools()).toEqual(['plugin__fixture__look']);
    expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual(['plugin__fixture__act']);
    expect((yield* tools.of(projectId)).view('fixture').map((tool) => tool.name)).toEqual(['deal']);
    expect(JSON.parse(yield* said('environment'))).toMatchObject({
      TAGMA_SERVER_URL: 'http://127.0.0.1:1',
      TAGMA_CALLER: 'plugin:fixture',
      TAGMA_PLUGIN_DATA: world.data('fixture'),
    });
    const first = yield* said('pid');
    const manifest = (contributes: Record<string, unknown>) =>
      writeFile(join(root, 'tagma-plugin.json'), JSON.stringify({ id: 'fixture', title: 'Fixture', process: processOf(), contributes }));
    yield* Effect.promise(() => manifest({ ...TOOLS, surfaces: [] }));
    yield* until(() => host.reading('fixture')?.refused?.includes('surfaces') === true);
    expect((yield* plugins.rows(projectId, ['fixture']))[0]?.process?.refused).toContain('surfaces');
    expect(yield* said('pid')).toBe(first);
    yield* Effect.promise(() => manifest(TOOLS));
    yield* until(() => host.reading('fixture')?.refused === undefined);
    yield* Effect.exit(host.call('fixture', 'crash', {}, {}));
    yield* until(() => host.reading('fixture')?.state === 'failed');
    expect(yield* agentTools()).toEqual([]);
    yield* until(() => host.reading('fixture')?.state === 'running');
    expect(yield* said('pid')).not.toBe(first);
    expect(yield* agentTools()).toEqual(['plugin__fixture__look']);

    yield* plugins.enable({ projectId, id: 'fixture', enabled: false, scope: 'project' });
    expect(yield* agentTools()).toEqual([]);
    expect(Object.keys((yield* tools.of(projectId)).own('fixture'))).toEqual([]);
    expect((yield* tools.of(projectId)).view('fixture')).toEqual([]);
    yield* until(() => host.reading('fixture') === undefined);
    yield* plugins.enable({ projectId, id: 'fixture', enabled: true, scope: 'project' });
    yield* until(() => host.reading('fixture')?.state === 'running');
    yield* plugins.uninstall({ projectId, id: 'fixture' });
    yield* until(() => host.reading('fixture') === undefined);
    expect(yield* agentTools()).toEqual([]);
  }),
);

it.live('a manifest naming a point no owner declares refuses the install', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-refused-' });
    const root = yield* world.place('fixture', { process: processOf(), contributes: { ...TOOLS, surfaces: [] } });
    expect(yield* Effect.flip(world.install(root))).toMatchObject({ code: 'plugin-refused' });
    expect(world.host.reading('fixture')).toBeUndefined();
  }),
);

it.live('a plugin whose manifest is broken when the server starts is watched, and starts once the manifest is repaired', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-boot-', watcher: yield* watched });
    const root = yield* world.place('fixture', { process: processOf(), contributes: TOOLS });
    yield* world.install(root);
    yield* world.until(() => world.host.reading('fixture')?.state === 'running');
    yield* world.shutdown;
    const manifest = join(root, 'tagma-plugin.json');
    const valid = yield* Effect.promise(() => readFile(manifest, 'utf8'));
    yield* Effect.promise(() => writeFile(manifest, '{ not json'));
    const booted = yield* world.boot();
    yield* world.until(() => booted.host.reading('fixture')?.state === 'failed');
    yield* Effect.promise(() => writeFile(manifest, valid));
    yield* world.until(() => booted.host.reading('fixture')?.state === 'running');
    expect(Object.keys((yield* booted.tools.of(world.projectId)).agents())).toEqual(['plugin__fixture__look']);
  }),
);

it.live('a directory holding tagma-plugin.json is read in Tagma’s format even where a marketplace entry declares another', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-formats-', formats: [tagmaFormat, claudeCodeFormat] });
    const root = yield* world.place('fixture', { process: processOf(), contributes: TOOLS });
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
    for (const id of ['fixture', 'second']) {
      yield* world.install(yield* world.place(id, { process: processOf(['--linger', journal]), contributes: TOOLS }));
    }
    yield* world.until(() => world.host.reading('fixture')?.state === 'running' && world.host.reading('second')?.state === 'running');
    const pids = [Number(yield* world.said('pid')), Number(yield* world.said('pid', 'second'))];
    yield* Scope.close(owned, Exit.void);
    const heard = (yield* Effect.promise(() => readFile(journal, 'utf8'))).trim().split('\n');
    expect(heard.slice(0, 2).sort()).toEqual(pids.map((pid) => `eof ${pid}`).sort());
    expect(heard.slice(2).sort()).toEqual(pids.map((pid) => `term ${pid}`).sort());
    expect(pids.filter(alive)).toEqual([]);
  }),
);

it.live('an edit drains the serving call before replacing its process, and concurrent callers reach the new generation', () =>
  Effect.gen(function* () {
    const world = yield* hostWorld({ prefix: 'host-drain-', watcher: yield* watched });
    const { host, projectId, tools, said, until } = world;
    const root = yield* world.place('fixture', { process: processOf(), contributes: TOOLS });
    yield* Effect.promise(() => writeFile(join(root, '.gitignore'), '*.log\n'));
    yield* world.install(root);
    yield* until(() => host.reading('fixture')?.state === 'running');
    const first = yield* said('pid');
    const revision = () => Effect.flatMap(codeFilterOf(root), (filter) => revisionOf(root, filter));
    const before = yield* revision();
    yield* Effect.promise(async () => {
      await mkdir(join(root, 'ui'), { recursive: true });
      await writeFile(join(root, 'ui', 'table.html'), '<p>a view</p>');
      await writeFile(join(root, 'process.log'), 'written by the process');
    });
    expect(yield* revision()).toBe(before);
    const serving = yield* Effect.forkScoped(said('hold'));
    yield* Effect.promise(() =>
      writeFile(
        join(root, 'tagma-plugin.json'),
        JSON.stringify({
          id: 'fixture',
          title: 'Fixture',
          process: processOf(),
          contributes: { tools: [...TOOLS.tools, { name: 'pid', audience: 'agents' }] },
        }),
      ),
    );
    yield* until(() => host.reading('fixture')?.tools === 0);
    const meanwhile = yield* Effect.forkScoped(said('pid'));
    yield* Effect.yieldNow;
    expect(serving.pollUnsafe()).toBeUndefined();
    expect(meanwhile.pollUnsafe()).toBeUndefined();
    yield* Effect.promise(() => writeFile(join(world.data('fixture'), 'release'), ''));
    expect(yield* Fiber.join(serving)).toBe(`held ${first}`);
    const second = yield* Fiber.join(meanwhile);
    expect(second).not.toBe(first);
    const journal = (yield* Effect.promise(() => readFile(join(world.data('fixture'), 'journal'), 'utf8'))).trim().split('\n');
    expect(journal).toEqual([`start ${first}`, `exit ${first}`, `start ${second}`]);
    expect(Object.keys((yield* tools.of(projectId)).agents()).sort()).toEqual(['plugin__fixture__look', 'plugin__fixture__pid']);
  }),
);
