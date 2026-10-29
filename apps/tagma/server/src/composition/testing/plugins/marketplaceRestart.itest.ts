import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Effect, Exit, FileSystem, Layer, Scope } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../../executions/testing/doubles.js';
import { routedContext } from '../../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../../installation/testing/doubles.js';
import type { MarketplacePreset } from '../../../marketplaces/contract/wire/presets.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { doorLayer } from '../../http/door.js';
import { makeRuntime } from '../../runtime.js';
import { TESTING_ADAPTERS } from '../adapters.js';
import { chosenModel } from '../chosenModel.js';
import { doorServing } from '../doorServices.js';
import { hostBundleRoot } from '../hostBundle.js';
import { requestEffect } from '../httpRequest.js';
import { committed, repository, skill } from './files.js';

const MCP_SERVER = resolve(import.meta.dir, '../../../../../../../packages/mcp/test/mcpTestServer.ts');

type Body = {
  readonly marketplaces?: readonly { readonly id: string; readonly label: string }[];
  readonly preview?: { readonly prepared: string };
  readonly plugins?: readonly {
    readonly id: string;
    readonly enabled: boolean;
    readonly components: readonly { readonly name: string }[];
  }[];
  readonly project?: { readonly id: number };
  readonly snapshot?: { readonly thread: { readonly id: string } };
  readonly skills?: readonly { readonly id: string }[];
  readonly mcp?: readonly { readonly name: string; readonly status: string; readonly tools: number }[];
};

const booted = Effect.fnUntraced(function* (home: string, presets: readonly MarketplacePreset[]) {
  const scope = yield* Scope.make();
  const runtime = yield* makeRuntime(
    {
      adapters: TESTING_ADAPTERS,
      grants: testGrantSigner,
      databasePath: join(home, 'tagma.sqlite'),
      tokensPath: join(home, 'tokens.json'),
      attachmentsPath: join(home, 'attachments'),
      sourcePath: join(home, 'source'),
      hostBundlePath: yield* Effect.orDie(hostBundleRoot),
      drivers: [],
      marketplaces: presets,
    },
    Layer.empty,
    yield* sharedPool,
  ).pipe(Scope.provide(scope), Effect.orDie);
  yield* Effect.orDie(chosenModel(runtime));
  const routed = routedContext(runtime.graph, runtime.pool);
  const handler = yield* HttpRouter.toHttpEffect(
    doorServing(doorLayer({ status: runtime.status }), runtime, home).pipe(
      Layer.provide(frozenBuildsLayer({ dataPath: home })),
      Layer.provide(Layer.succeedContext(routed)),
      Layer.provide(Layer.succeedContext(runtime.bindings)),
      Layer.provide(HttpServer.layerServices),
      Layer.provideMerge(HttpPlatform.layer),
      Layer.provideMerge(BunFileSystem.layer),
    ),
  ).pipe(Scope.provide(scope));
  const files = yield* FileSystem.FileSystem;
  const op = (id: string, input: unknown, query = '') =>
    Effect.map(
      Effect.provide(
        requestEffect(
          Effect.provideService(handler, FileSystem.FileSystem, files),
          new Request(`http://tagma/api/op/${id}${query === '' ? '' : `?${query}`}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          }),
        ),
        routed,
      ),
      (answer) => answer.body as Body,
    );
  return { op, runtime, close: Scope.close(scope, Exit.void) };
});

it.live(
  'an installed marketplace plugin keeps working after a refresh, its marketplace’s removal and a restart, and a removed preset stays removed',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const home = yield* files.makeTempDirectoryScoped({ prefix: 'marketplace-restart-' });
      const vendor = join(home, 'vendor-claude');
      const other = join(home, 'vendor-codex');
      const project = join(home, 'project');
      yield* files.makeDirectory(project, { recursive: true });
      yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: project });
      yield* files.makeDirectory(vendor, { recursive: true });
      yield* files.makeDirectory(other, { recursive: true });
      yield* repository(vendor, {
        '.claude-plugin/marketplace.json': JSON.stringify({
          name: 'vendor-claude',
          owner: { name: 'Vendor' },
          plugins: [{ name: 'echoer', source: './plugins/echoer' }],
        }),
        'plugins/echoer/.claude-plugin/plugin.json': JSON.stringify({ name: 'echoer' }),
        'plugins/echoer/skills/greet/SKILL.md': skill('Greets.'),
        'plugins/echoer/.mcp.json': JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [MCP_SERVER] } } }),
      });
      yield* repository(other, { '.agents/plugins/marketplace.json': JSON.stringify({ name: 'vendor-codex', plugins: [] }) });
      const presets: readonly MarketplacePreset[] = [
        { id: 'vendor-claude', title: 'Vendor Claude', label: 'vendor', source: { kind: 'git', url: `file://${vendor}` } },
        { id: 'vendor-codex', title: 'Vendor Codex', label: 'vendor', source: { kind: 'git', url: `file://${other}` } },
      ];

      const first = yield* booted(join(home, 'data'), presets);
      expect((yield* first.op('read_marketplaces', {})).marketplaces).toEqual([
        expect.objectContaining({ id: 'vendor-claude', label: 'vendor' }),
        expect.objectContaining({ id: 'vendor-codex', label: 'vendor' }),
      ]);
      const projectId = (yield* first.op('add_project', { name: 'restarted', rootPath: project, storage: 'stealth' })).project?.id;
      const scope = `project=${projectId}`;
      yield* first.op('refresh_marketplace', { id: 'vendor-claude' });
      const { preview } = yield* first.op('preview_plugin', { marketplace: 'vendor-claude', entry: 'echoer' }, scope);
      yield* first.op('install_plugin', { prepared: preview?.prepared }, scope);
      yield* committed(vendor, { 'plugins/echoer/skills/later/SKILL.md': skill('Later.') });
      yield* first.op('refresh_marketplace', { id: 'vendor-claude' });
      yield* first.op('remove_marketplace', { id: 'vendor-claude' });
      yield* first.close;

      const second = yield* booted(join(home, 'data'), presets);
      yield* Effect.addFinalizer(() => Effect.andThen(second.close, Effect.orDie(endHosts(home))));
      expect((yield* second.op('read_marketplaces', {})).marketplaces?.map((marketplace) => marketplace.id)).toEqual(['vendor-codex']);
      expect((yield* second.op('read_plugins', {}, scope)).plugins).toEqual([
        expect.objectContaining({
          id: 'echoer',
          enabled: true,
          components: [expect.objectContaining({ name: 'echoer-greet' }), expect.objectContaining({ name: 'echoer-echo' })],
        }),
      ]);
      const thread = (yield* second.op('create_thread', {}, scope)).snapshot?.thread.id;
      expect((yield* second.op('read_agent_skills', { kind: 'thread', id: thread }, scope)).skills).toContainEqual(
        expect.objectContaining({ id: 'echoer-greet' }),
      );
      yield* second.runtime.mcp.reconcile(projectId ?? 0);
      const echo = (yield* second.op('read_mcp_servers', {}, scope)).mcp?.find((row) => row.name === 'echoer-echo');
      expect(echo?.status).toBe('connected');
      expect(echo?.tools).toBeGreaterThan(0);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
