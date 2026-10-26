import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BunFileSystem } from '@effect/platform-bun';
import { Context, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { graphFixture, tempRootEffect } from '../composition/testing/graphFixture.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { PluginPlace, Plugins } from '../plugins/contract/service/supervision.js';
import { plugins as pluginsModule } from '../plugins/plugins.js';
import { Projects } from '../projects/contract/service/registry.js';
import { SettingChanges } from '../settings/contract/service/changes.js';
import { Settings } from '../settings/contract/service/values.js';
import { PluginViews, type ViewSites, ViewStorage } from './contract/service/views.js';
import { siteFile } from './files.js';
import { viewsLayer } from './layer.js';

const SERVER = resolve(import.meta.dir, '../../../../../packages/mcp/test/mcpAppServer.ts');
const fixtureGraph = graphFixture();
const contributes = {
  tools: [
    { name: 'dashboard', audience: 'agents' },
    { name: 'refresh', audience: 'view' },
  ],
  views: [{ id: 'board', entry: 'ui/board.html', live: true }],
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
const manifest = (points: Record<string, unknown>, withProcess = false) =>
  JSON.stringify({
    id: 'board',
    title: 'Board',
    process: withProcess ? { command: process.execPath, args: [SERVER] } : undefined,
    contributes: points,
  });
const FRAMERS = 'http://127.0.0.1:*';
const SITES: ViewSites['Service'] = { site: (plugin) => ({ _tag: 'served', origin: `https://${plugin}.example` }), moved: Stream.never };
const served = (views: PluginViews['Service']) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        HttpRouter.add('GET', '*', (request) => siteFile(views)('board', new URL(request.url, 'http://site').pathname, FRAMERS)).pipe(
          Layer.provide(HttpServer.layerServices),
          Layer.provideMerge(HttpPlatform.layer),
          Layer.provideMerge(BunFileSystem.layer),
        ),
        { disableLogger: true },
      ),
    ),
    ({ dispose }) => Effect.promise(dispose),
  );

const refusalOf = Effect.fnUntraced(function* <E>(effect: Effect.Effect<unknown, E>) {
  const failure = yield* Effect.flip(effect);
  return failure instanceof GateRefusal ? failure.code : String(failure);
});

const setup = Effect.fnUntraced(function* (withProcess = false) {
  const demo = yield* Effect.acquireRelease(fixtureGraph.openEffect(), () => Effect.orDie(fixtureGraph.releaseEffect));
  const projectId = demo.projectId;
  const home = yield* tempRootEffect(demo.fixture, 'views-home-').pipe(Effect.provide(BunFileSystem.layer));
  const project = yield* Context.get(demo.context, Projects).byId(projectId);
  const root = join(project.rootPath, '.plugins', 'board');
  yield* Effect.promise(async () => {
    await mkdir(join(root, 'ui'), { recursive: true });
    await writeFile(join(root, 'ui', 'board.html'), '<!doctype html><p>board</p>');
    await writeFile(join(root, 'plugin.json'), manifest(withProcess ? contributes : staticContributions, withProcess));
  });
  const built = yield* Layer.build(viewsLayer.pipe(Layer.provideMerge(pluginsModule.lifetimes.installation))).pipe(
    Effect.provideService(Settings, Context.get(demo.context, Settings)),
    Effect.provideService(SettingChanges, Context.get(demo.context, SettingChanges)),
    Effect.provideService(Projects, Context.get(demo.context, Projects)),
    Effect.provideService(PluginPlace, { home, server: 'http://127.0.0.1:1' }),
  );
  return {
    demo,
    projectId,
    root,
    plugins: Context.get(built, Plugins),
    views: Context.get(built, PluginViews),
    storage: Context.get(built, ViewStorage),
    mount: { projectId, plugin: 'board', view: 'board' },
  };
});

it.live(
  'the views and results of a plugin reach only a project it is enabled in at the site the door names, and its ui/ alone is served',
  () =>
    Effect.gen(function* () {
      const { demo, projectId, root, plugins, views } = yield* setup(true);
      const updates = yield* Queue.unbounded<void>();
      const fiber = yield* Effect.forkScoped(
        Stream.runCollect(
          views.sets(projectId, SITES).pipe(
            Stream.tap(() => Queue.offer(updates, undefined)),
            Stream.take(4),
          ),
        ),
      );
      yield* Queue.take(updates);
      yield* plugins.install({ projectId, id: 'board', enabled: true });
      yield* Queue.take(updates);
      yield* Queue.take(updates);
      yield* plugins.enable({ projectId, id: 'board', enabled: false });
      const seen = yield* Fiber.join(fiber);
      expect(seen).toEqual([
        { plugins: [], enabled: [] },
        { plugins: [], enabled: ['board'] },
        {
          plugins: [
            {
              plugin: 'board',
              title: 'Board',
              site: { _tag: 'served', origin: 'https://board.example' },
              views: [{ id: 'board', entry: 'ui/board.html', live: true }],
              results: [{ tool: 'dashboard', name: 'plugin__board__dashboard', view: 'board' }],
              surfaces: [{ view: 'board', title: 'Board', icon: 'ui/icon.svg' }],
              panes: [{ view: 'board', title: 'Board card' }],
              launchers: [{ view: 'board', title: 'Open board' }],
            },
          ],
          enabled: ['board'],
        },
        { plugins: [], enabled: [] },
      ]);
      const { handler } = yield* served(views);
      const page = yield* Effect.promise(() => handler(new Request('http://board.localhost:5636/ui/board.html')));
      expect(page.status).toBe(200);
      const policy = (page.headers.get('content-security-policy') ?? '').split('; ');
      expect(policy.some((directive) => directive.startsWith('sandbox'))).toBe(false);
      expect(policy).toContain(`frame-ancestors ${FRAMERS}`);
      expect(page.headers.get('access-control-allow-origin')).toBe('*');
      for (const path of ['ui/%2e%2e/plugin.json', 'ui/%E0%A4%A.html', 'plugin.json']) {
        expect((yield* Effect.promise(() => handler(new Request(`http://board.localhost:5636/${path}`)))).status).toBe(404);
      }
      expect(yield* views.file('board', 'ui/board.html')).toMatch(/board\.html$/u);
      expect(yield* views.file('board', 'ui/../plugin.json')).toBeNull();
      expect(yield* views.file('board', 'plugin.json')).toBeNull();
      const elsewhere = yield* tempRootEffect(demo.fixture, 'views-elsewhere-').pipe(Effect.provide(BunFileSystem.layer));
      yield* Effect.promise(async () => {
        await writeFile(join(elsewhere, 'secret.txt'), 'secret');
        await rename(join(root, 'ui'), join(elsewhere, 'ui'));
        await symlink(elsewhere, join(root, 'ui'));
      });
      expect(yield* views.file('board', 'ui/secret.txt')).toBeNull();
    }),
  20_000,
);

it.live('a view reaches the outside origins its manifest declares and no origin it does not, this machine never', () =>
  Effect.gen(function* () {
    const { projectId, root, plugins, views } = yield* setup();
    const csp = {
      frameDomains: ['https://www.youtube-nocookie.com', 'http://localhost:5633'],
      connectDomains: ['https://api.example.com'],
      resourceDomains: ['https://*.cdn.example.com'],
    };
    yield* Effect.promise(async () => {
      await writeFile(join(root, 'ui', 'player.html'), '<!doctype html><p>player</p>');
      await writeFile(
        join(root, 'plugin.json'),
        manifest({
          ...staticContributions,
          views: [
            { id: 'board', entry: 'ui/board.html', live: true },
            { id: 'player', entry: 'ui/player.html', csp },
          ],
        }),
      );
    });
    yield* plugins.install({ projectId, id: 'board', enabled: true });
    const { handler } = yield* served(views);
    const directive = (page: string, name: string) =>
      Effect.promise(async () => {
        const policy = (await handler(new Request(`http://board.localhost:5636/ui/${page}`))).headers.get('content-security-policy') ?? '';
        return policy.split('; ').find((part) => part.startsWith(`${name} `));
      });
    expect(yield* directive('player.html', 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com');
    expect(yield* directive('player.html', 'connect-src')).toBe("connect-src 'self' data: blob: https://api.example.com");
    expect(yield* directive('player.html', 'media-src')).toContain('https://*.cdn.example.com');
    expect(yield* directive('board.html', 'frame-src')).toBe("frame-src 'none'");
    expect(yield* directive('board.html', 'connect-src')).toBe("connect-src 'self' data: blob:");
  }),
);

it.live('a contribution naming an undeclared view fails the plugin and shows nothing', () =>
  Effect.gen(function* () {
    const { projectId, root, plugins, views } = yield* setup();
    for (const point of ['results', 'surfaces', 'panes', 'launchers']) {
      const entry = point === 'results' ? { tool: 'dashboard', view: 'missing' } : { view: 'missing', title: 'Missing' };
      yield* Effect.promise(() =>
        writeFile(
          join(root, 'plugin.json'),
          manifest({ ...(point === 'results' ? contributes : staticContributions), [point]: [entry] }, point === 'results'),
        ),
      );
      const row = yield* plugins.install({ projectId, id: 'board', enabled: true });
      expect(row.state).toBe('failed');
      expect(row.failure).toContain('missing');
      expect(yield* Stream.runCollect(Stream.take(views.sets(projectId, SITES), 1))).toEqual([{ plugins: [], enabled: ['board'] }]);
    }
  }),
);

it.live(
  'a view calls only its plugin’s view tools, follows its resources and keeps its values',
  () =>
    Effect.gen(function* () {
      const { projectId, plugins, views, storage, mount } = yield* setup(true);
      yield* plugins.install({ projectId, id: 'board', enabled: true });
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
          yield* Effect.exit(plugins.call('board', 'exit', {}, {}));
          return yield* Fiber.join(fiber);
        }),
      ).pipe(Effect.timeout('20 seconds'));
      expect(events.map((event) => event.kind)).toEqual(['subscribed', 'updated', 'updated', 'updated', 'updated']);
      expect((yield* views.read(mount, 'app://subscriptions')).contents[0]).toMatchObject({ text: '[]' });
      yield* views.read(mount, 'app://state');
      const callers = (yield* views.read(mount, 'app://callers')).contents[0];
      expect(JSON.parse(callers !== undefined && 'text' in callers ? callers.text : '{}')).toMatchObject({ read: caller });
      expect(subscribed).toEqual({ subscribe: caller });
      expect(yield* storage.get(mount, 'save')).toEqual({ stored: false });
      yield* storage.set(mount, 'save', { level: 3 });
      expect(yield* storage.get(mount, 'save')).toEqual({ stored: true, value: { level: 3 } });
      yield* storage.set(mount, 'save', undefined);
      expect(yield* storage.get(mount, 'save')).toEqual({ stored: false });
      expect(yield* refusalOf(storage.set(mount, 'big', 'x'.repeat(1024 * 1024 + 1)))).toBe('view-storage-too-large');
    }),
  30_000,
);
