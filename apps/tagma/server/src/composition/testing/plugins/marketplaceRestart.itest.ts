import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { Context, Effect, Exit, FileSystem, Layer, Option, Scope, Stream } from 'effect';
import { HttpPlatform, HttpRouter, HttpServer } from 'effect/http';
import { endHosts } from '../../../executions/testing/doubles.js';
import { routedContext } from '../../../graph/testing/doubles.js';
import { frozenBuildsLayer } from '../../../installation/testing/doubles.js';
import { Marketplaces } from '../../../marketplaces/contract/service/marketplaces.js';
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
import { committed, repository, skill, written } from './files.js';

const names = (components: readonly { readonly name: string }[]) => components.map((component) => component.name).sort();

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
      yield* Effect.addFinalizer(() => Effect.orDie(endHosts(home)));
      const vendor = join(home, 'vendor-claude');
      const other = join(home, 'vendor-codex');
      const project = join(home, 'project');
      yield* files.makeDirectory(project, { recursive: true });
      yield* spawnedEffect(['git', 'init', '-q', '-b', 'main'], { cwd: project });
      yield* files.makeDirectory(vendor, { recursive: true });
      yield* files.makeDirectory(other, { recursive: true });
      yield* written(vendor, {
        '.claude-plugin/marketplace.json': JSON.stringify({
          name: 'vendor-claude',
          owner: { name: 'Vendor' },
          plugins: [{ name: 'echoer', source: './plugins/echoer' }],
        }),
        'plugins/echoer/.claude-plugin/plugin.json': JSON.stringify({ name: 'echoer' }),
        'plugins/echoer/skills/greet/SKILL.md': skill('Greets.'),
        'plugins/echoer/docs/linked/SKILL.md': skill('Linked.'),
        'plugins/echoer/.mcp.json': JSON.stringify({ mcpServers: { echo: { command: process.execPath, args: [MCP_SERVER] } } }),
      });
      yield* files.symlink('../docs/linked', join(vendor, 'plugins/echoer/skills/linked'));
      yield* repository(vendor, {});
      yield* repository(other, { '.agents/plugins/marketplace.json': JSON.stringify({ name: 'vendor-codex', plugins: [] }) });
      const presets: readonly MarketplacePreset[] = [
        { id: 'vendor-claude', title: 'Vendor Claude', label: 'vendor', source: { kind: 'git', url: `file://${vendor}` } },
        { id: 'vendor-codex', title: 'Vendor Codex', label: 'vendor', source: { kind: 'git', url: `file://${other}` } },
      ];

      const first = yield* booted(join(home, 'data'), presets);
      yield* Effect.addFinalizer(() => first.close);
      const marketplaces = Context.get(first.runtime.owners as Context.Context<Marketplaces>, Marketplaces);
      const fetched = yield* Stream.runHead(
        Stream.filter(
          Stream.mapEffect(marketplaces.changes, () => marketplaces.rows()),
          (rows) => rows.every((row) => row.revision !== null || row.failure !== null),
        ),
      );
      expect(Option.getOrThrow(fetched)).toEqual([
        expect.objectContaining({ id: 'vendor-claude', label: 'vendor', failure: null }),
        expect.objectContaining({ id: 'vendor-codex', label: 'vendor', failure: null }),
      ]);
      const projectId = (yield* first.op('add_project', { name: 'restarted', rootPath: project, storage: 'stealth' })).project?.id;
      const scope = `project=${projectId}`;
      const shown = Effect.suspend(() =>
        Effect.map(first.op('read_plugins', {}, scope), (read) => names(read.plugins?.[0]?.components ?? [])),
      );
      const { preview } = yield* first.op('preview_plugin', { marketplace: 'vendor-claude', entry: 'echoer' }, scope);
      yield* first.op('install_plugin', { prepared: preview?.prepared }, scope);
      yield* committed(vendor, { 'plugins/echoer/skills/later/SKILL.md': skill('Later.') });
      yield* first.op('preview_plugin', { marketplace: 'vendor-claude', entry: 'echoer' }, scope);
      yield* first.op('refresh_marketplace', { id: 'vendor-claude' });
      expect(yield* shown).toEqual(['echoer-echo', 'echoer-greet', 'echoer-linked']);
      yield* first.op('update_plugin', { id: 'echoer' }, scope);
      expect(yield* shown).toEqual(['echoer-echo', 'echoer-greet', 'echoer-later', 'echoer-linked']);
      yield* first.op('remove_marketplace', { id: 'vendor-claude' });
      yield* first.close;

      const second = yield* booted(join(home, 'data'), presets);
      yield* Effect.addFinalizer(() => second.close);
      expect((yield* second.op('read_marketplaces', {})).marketplaces?.map((marketplace) => marketplace.id)).toEqual(['vendor-codex']);
      expect((yield* second.op('read_plugins', {}, scope)).plugins).toEqual([expect.objectContaining({ id: 'echoer', enabled: true })]);
      const thread = (yield* second.op('create_thread', {}, scope)).snapshot?.thread.id;
      expect(
        ((yield* second.op('read_agent_skills', { kind: 'thread', id: thread }, scope)).skills ?? [])
          .map((offered) => offered.id)
          .filter((id) => id.startsWith('echoer-'))
          .sort(),
      ).toEqual(['echoer-greet', 'echoer-later', 'echoer-linked']);
      yield* second.runtime.mcp.reconcile(projectId ?? 0);
      const answered = yield* second.runtime.mcp.caller(projectId ?? 0).call('echoer-echo', 'echo', { text: 'restarted' }, {});
      expect('content' in answered ? answered.content : answered).toEqual([expect.objectContaining({ type: 'text', text: 'restarted' })]);
    }).pipe(Effect.provide(BunFileSystem.layer)),
);
