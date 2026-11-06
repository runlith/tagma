import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Context, Effect, Fiber, Queue, Stream } from 'effect';
import { makeDoorWorld } from '../composition/testing/doorFixture.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { MANIFEST } from '../plugin-formats/tagma/contract/wire/manifest.js';
import { entryText, manifestText, PROCESS_ENTRY } from '../plugin-formats/tagma/testing/folder.js';
import { PluginHost } from '../plugin-host/contract/service/supervision.js';
import type { PluginViews } from './contract/service/views.js';
import type { PluginViewState } from './contract/wire/sets.js';

const SERVER = resolve(import.meta.dir, '../../../../../packages/mcp/test/mcpAppServer.ts');
const object = { type: 'object' };
const contributes = {
  tools: [
    { name: 'dashboard', audience: 'agents', description: 'Shows the dashboard.', inputSchema: object },
    { name: 'refresh', audience: 'view', description: 'Refreshes the state.', inputSchema: object },
    { name: 'model', audience: 'tagma', description: 'Answers the model.', inputSchema: object },
    { name: 'both', audience: 'tagma', description: 'Answers the model and the view.', inputSchema: object },
    { name: 'hidden', audience: 'tagma', description: 'Answers nobody.', inputSchema: object },
  ],
  views: [{ id: 'board', entry: 'ui/Board.svelte', live: true }],
  results: [{ tool: 'dashboard', view: 'board' }],
  surfaces: [{ view: 'board', title: 'Board', icon: 'ui/icon.svg' }],
  panes: [{ view: 'board', title: 'Board card' }],
  launchers: [{ view: 'board', title: 'Open board' }],
};
const staticContributions = {
  views: contributes.views,
  surfaces: contributes.surfaces,
  panes: contributes.panes,
  launchers: contributes.launchers,
};
const manifest = (points: Record<string, unknown>, withProcess = false, id = 'board') =>
  manifestText({ id, title: 'Board', program: withProcess ? SERVER : undefined, contributes: points });
const placed = (root: string, text: string) =>
  Effect.promise(async () => {
    await mkdir(join(root, 'ui'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, PROCESS_ENTRY), entryText(SERVER));
    await writeFile(join(root, MANIFEST), text);
  });
const shown = (views: PluginViews['Service'], projectId: number, holds: (state: PluginViewState) => boolean) =>
  Stream.runCollect(Stream.take(Stream.filter(views.sets(projectId), holds), 1));

const refusalOf = Effect.fnUntraced(function* <E>(effect: Effect.Effect<unknown, E>) {
  const failure = yield* Effect.flip(effect);
  return failure instanceof GateRefusal ? failure.code : String(failure);
});

const setup = Effect.fnUntraced(function* (withProcess = false) {
  const world = yield* makeDoorWorld({ own: 'it installs a plugin for the machine' });
  const projectId = yield* world.stealthProject();
  const scope = `project=${projectId}`;
  const root = yield* world.directory('board-plugin');
  yield* placed(root, manifest(withProcess ? contributes : staticContributions, withProcess));
  const installed = (source: string) => world.op('install_plugin', { source }, scope);
  return {
    world,
    projectId,
    scope,
    root,
    installed,
    host: Context.get(world.runtime.owners, PluginHost),
    views: world.runtime.views,
    mount: { projectId, plugin: 'board', view: 'board' },
  };
});

it.live('the views and results of a plugin reach only a project it is enabled in', () =>
  Effect.gen(function* () {
    const { world, projectId, scope, root, installed, views } = yield* setup(true);
    const states = yield* Queue.unbounded<PluginViewState>();
    yield* Effect.forkScoped(Stream.runForEach(views.sets(projectId), (state) => Queue.offer(states, state)));
    const reach = Effect.fnUntraced(function* (holds: (state: PluginViewState) => boolean) {
      for (;;) {
        const state = yield* Queue.take(states);
        if (holds(state)) return state;
      }
    });
    expect(yield* reach(() => true)).toEqual({ plugins: [], enabled: [], sheet: null });
    yield* installed(root);
    expect(yield* reach((state) => state.plugins.some((set) => set.views.some((view) => view.module.state === 'failed')))).toEqual({
      plugins: [
        {
          plugin: 'board',
          title: 'Board',
          views: [
            {
              id: 'board',
              live: true,
              module: {
                state: 'failed',
                message: 'dist/ui/graph.json is missing: build the plugin again with tagma-plugin build',
                file: null,
              },
            },
          ],
          results: [{ tool: 'dashboard', name: 'plugin__board__dashboard', view: 'board' }],
          surfaces: [{ view: 'board', title: 'Board', icon: null }],
          panes: [{ view: 'board', title: 'Board card', icon: null }],
          launchers: [{ view: 'board', title: 'Open board' }],
        },
      ],
      enabled: ['board'],
      sheet: null,
    });
    yield* world.op('enable_plugin', { id: 'board', enabled: false }, scope);
    expect(yield* reach((state) => state.plugins.length === 0)).toEqual({ plugins: [], enabled: [], sheet: null });
    yield* world.op('enable_plugin', { id: 'board', enabled: true }, scope);
    yield* reach((state) => state.plugins.some((set) => set.launchers.length > 0));
  }),
);

it.live('a view calls only its plugin’s view tools, follows its resources and keeps its values through the door', () =>
  Effect.gen(function* () {
    const { world, scope, root, installed, host, views, mount, projectId } = yield* setup(true);
    yield* installed(root);
    yield* shown(views, projectId, (state) => state.plugins.some((set) => set.launchers.length > 0));
    const caller = { kind: 'operator' as const, projectId, view: 'board' };
    expect(yield* refusalOf(views.call(mount, 'dashboard', {}, caller))).toBe('plugin-tool-unoffered');
    expect(yield* refusalOf(views.call({ ...mount, view: 'other' }, 'refresh', {}, caller))).toBe('plugin-view-unknown');
    let subscribed: unknown;
    const events = yield* Effect.scoped(
      Effect.gen(function* () {
        const seen = yield* Queue.unbounded<string>();
        const fiber = yield* Effect.forkScoped(
          Stream.runCollect(
            views.watch(mount, 'app://state').pipe(
              Stream.tap((event) => Queue.offer(seen, event.kind)),
              Stream.take(5),
            ),
          ),
        );
        yield* Queue.take(seen);
        yield* Queue.take(seen);
        expect((yield* views.call(mount, 'refresh', {}, caller)).structuredContent).toEqual({ revision: 1 });
        yield* Queue.take(seen);
        const named = (yield* views.read(mount, 'app://callers')).contents[0];
        subscribed = JSON.parse(named !== undefined && 'text' in named ? named.text : '{}');
        yield* Effect.exit(host.call('board', 'exit', {}, {}));
        return yield* Fiber.join(fiber);
      }),
    );
    expect(events.map((event) => event.kind)).toEqual(['subscribed', 'updated', 'updated', 'updated', 'updated']);
    expect((yield* views.read(mount, 'app://subscriptions')).contents[0]).toMatchObject({ text: '[]' });
    yield* views.read(mount, 'app://state');
    const callers = (yield* views.read(mount, 'app://callers')).contents[0];
    expect(JSON.parse(callers !== undefined && 'text' in callers ? callers.text : '{}')).toMatchObject({ read: caller });
    expect(subscribed).toEqual({ subscribe: caller });
    const target = { plugin: 'board', view: 'board' };
    const stored = (key: string) => Effect.map(world.op('read_view_storage', { ...target, key }, scope), (answer) => answer.body);
    const keep = (key: string, value?: unknown) => world.op('write_view_storage', { ...target, key, value }, scope);
    expect(yield* stored('save')).toMatchObject({ stored: false });
    yield* keep('save', { level: 3 });
    expect(yield* stored('save')).toMatchObject({ stored: true, value: { level: 3 } });
    yield* keep('save');
    expect(yield* stored('save')).toMatchObject({ stored: false });
    expect((yield* keep('big', 'x'.repeat(1024 * 1024 + 1))).body).toMatchObject({ code: 'view-storage-too-large' });
  }),
);
