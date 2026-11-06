import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Context, Effect, Queue, Stream } from 'effect';
import { makeDoorWorld } from '../../composition/testing/doorFixture.js';
import { writePlugin } from '../../plugin-formats/tagma/testing/folder.js';
import type { PluginRow } from '../../plugins/contract/wire/rows.js';
import { ViewFiles } from '../contract/service/places.js';
import type { ViewModule } from '../contract/wire/modules.js';
import type { PluginViewState } from '../contract/wire/sets.js';

const SERVER = resolve(import.meta.dir, '../../../../../../packages/mcp/test/mcpAppServer.ts');
const object = { type: 'object' };
const contributes = {
  tools: [
    { name: 'dashboard', audience: 'agents', description: 'Shows the dashboard.', inputSchema: object },
    { name: 'refresh', audience: 'view', description: 'Refreshes the state.', inputSchema: object },
    { name: 'model', audience: 'tagma', description: 'Answers the model.', inputSchema: object },
    { name: 'both', audience: 'tagma', description: 'Answers the model and the view.', inputSchema: object },
    { name: 'hidden', audience: 'tagma', description: 'Answers nobody.', inputSchema: object },
  ],
  views: [{ id: 'board', entry: 'ui/Board.svelte' }],
  surfaces: [{ view: 'board', title: 'Board', icon: 'ui/icon.svg' }],
};

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';

const shipped = (root: string, component: string, hash: string) =>
  Effect.promise(async () => {
    await mkdir(join(root, 'dist/ui/ui'), { recursive: true });
    await writeFile(join(root, 'dist/ui/ui/Board.svelte'), component);
    await writeFile(join(root, 'dist/ui/ui/icon.svg'), ICON);
    await writeFile(
      join(root, 'dist/ui/graph.json'),
      JSON.stringify({ files: { 'ui/Board.svelte': { imports: {} }, 'ui/icon.svg': { imports: {} } }, candidates: ['p-2'] }),
    );
    await writePlugin(root, { id: 'board', title: 'Board', program: SERVER, contributes, build: { hash, sources: [] } });
  });

const setup = Effect.fnUntraced(function* (component: string) {
  const world = yield* makeDoorWorld({ own: 'it installs a plugin for the machine' });
  const projectId = yield* world.stealthProject();
  const scope = `project=${projectId}`;
  const root = yield* world.directory('board-plugin');
  yield* shipped(root, component, 'a'.repeat(64));
  const states = yield* Queue.unbounded<PluginViewState>();
  yield* Effect.forkScoped(Stream.runForEach(world.runtime.views.sets(projectId), (state) => Queue.offer(states, state)));
  const module = Effect.fnUntraced(function* (holds: (view: ViewModule) => boolean) {
    for (;;) {
      const state = yield* Queue.take(states);
      const shown = state.plugins.find((set) => set.plugin === 'board');
      const view = shown?.views.find((candidate) => candidate.id === 'board');
      if (view !== undefined && holds(view.module)) return { module: view.module, set: shown! };
    }
  });
  const ready = Effect.fnUntraced(function* (before: string | null = null) {
    for (;;) {
      const { module: built, set } = yield* module((state) => state.state === 'ready');
      if (built.state === 'ready' && built.address !== before) return { address: built.address, set };
    }
  });
  yield* world.op('install_plugin', { source: root }, scope);
  return { world, projectId, scope, root, module, ready, mount: { projectId, plugin: 'board', view: 'board' } };
});

const revisionOf = (answer: { readonly structuredContent?: unknown }) =>
  (answer.structuredContent as { readonly revision: number }).revision;

it.live(
  'a view compiles after its plugin publishes, is served at the address the feed names, and a view-only rebuild keeps the process',
  () =>
    Effect.gen(function* () {
      const { world, projectId, root, ready, mount } = yield* setup('<p class="p-2">board</p>');
      const caller = { kind: 'operator' as const, projectId, view: 'board' };
      const first = yield* ready();
      expect(first.address).toMatch(/^\/api\/views\/modules\/board\/[0-9a-f]{24}\/Board-[a-z0-9]+\.js$/u);
      expect((yield* world.call(first.address)).status).toBe(200);
      expect((yield* world.call(first.address.replace(/[^/]+$/u, 'nothing.js'))).status).toBe(404);
      expect(first.set.surfaces[0]?.icon).toMatch(/^\/api\/views\/modules\/board\/[0-9a-f]{24}\/icon-[0-9a-f]{10}\.svg$/u);

      expect(revisionOf(yield* world.runtime.views.call(mount, 'refresh', {}, caller))).toBe(1);
      yield* shipped(root, '<p class="p-2">board, rebuilt</p>', 'b'.repeat(64));
      yield* ready(first.address);
      expect(revisionOf(yield* world.runtime.views.call(mount, 'refresh', {}, caller))).toBe(2);
    }),
);

it.live('a view the compiler refuses reads failed with the file, faults the plugin, and leaves its tools working', () =>
  Effect.gen(function* () {
    const { world, projectId, scope, module, mount } = yield* setup('<p>{</p>');
    const failed = yield* module((state) => state.state === 'failed');
    expect(failed.module).toMatchObject({ state: 'failed', file: 'ui/Board.svelte' });
    const rows = (yield* world.op('read_plugins', {}, scope)).body as { readonly plugins: readonly PluginRow[] };
    expect(rows.plugins.find((row) => row.id === 'board')?.faults).toEqual([
      { point: 'views', reason: expect.stringContaining('A view of this plugin does not compile: ui/Board.svelte') },
    ]);
    const caller = { kind: 'operator' as const, projectId, view: 'board' };
    expect(revisionOf(yield* world.runtime.views.call(mount, 'refresh', {}, caller))).toBe(1);
  }),
);

it.live('publishing the same views again compiles nothing', () =>
  Effect.gen(function* () {
    const { world, scope, ready } = yield* setup('<p>board</p>');
    const first = yield* ready();
    const files = Context.get(world.runtime.door, ViewFiles);
    const built = Effect.promise(() => stat(files.module('board', first.address.split('/')[5]!, 'index.json')));
    const compiled = (yield* built).mtimeMs;
    yield* world.op('enable_plugin', { id: 'board', enabled: false }, scope);
    yield* world.op('enable_plugin', { id: 'board', enabled: true }, scope);
    expect((yield* ready()).address).toBe(first.address);
    expect((yield* built).mtimeMs).toBe(compiled);
  }),
);
