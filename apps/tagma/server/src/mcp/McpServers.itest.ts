import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { resolve } from 'node:path';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { keyedServer } from '@runlith/mcp/testing/keyed';
import { Context, Deferred, Effect, Fiber, Layer, PubSub, Stream } from 'effect';
import { type McpContribution, McpContributions } from './contract/service/contributions.js';
import type { McpResourceEvent } from './contract/wire/feeds.js';
import { graphFixture } from '../composition/testing/graphFixture.js';
import { mcpServers as mcpServersKey } from './contract/wire/settings.js';
import { Settings } from '../settings/contract/service/values.js';
import { McpServers } from './contract/service/servers.js';
import { mcpServersLayer, noMcpContributions } from './testing/doubles.js';
import { mcpServersLayer as poolLayer } from './serverPool.js';
import { McpPlaces } from './contract/service/places.js';
import { memorySecretsLayer } from '../secrets/testing/doubles.js';

const mcpGraph = graphFixture();
const MCP_SERVER = resolve(import.meta.dir, '../../../../../packages/mcp/test/mcpTestServer.ts');
const APP_SERVER = resolve(import.meta.dir, '../../../../../packages/mcp/test/mcpAppServer.ts');
const TOKEN = 'from-the-environment';

it.live('a view starts only its scoped server, carries its caller and loses its subscription when that declaration is replaced', () =>
  Effect.gen(function* () {
    const opened = yield* Effect.acquireRelease(mcpGraph.openEffect(), () => Effect.orDie(mcpGraph.releaseEffect));
    const demo = opened.effects;
    const projectId = demo.projectId;
    const settings = Context.get(demo.context, Settings);
    const context = yield* Layer.build(mcpServersLayer({ GH_TOKEN: TOKEN })).pipe(Effect.provide(demo.context));
    const servers = Context.get(context, McpServers);
    const app: McpServerDeclaration = {
      name: 'app',
      transport: 'stdio',
      command: process.execPath,
      args: [APP_SERVER],
      capabilities: { kinds: ['read'], mutates: false },
      enabled: true,
    };
    yield* settings.amend(mcpServersKey, 'project', projectId, () => Effect.succeed([{ ...app, name: 'files', args: [MCP_SERVER] }]));
    yield* servers.add({ projectId, scope: 'user', declaration: app });
    const listed = yield* servers.list(projectId);
    expect(listed.map((row) => [row.name, row.scope, row.status])).toEqual([
      ['app', 'user', 'pending'],
      ['files', 'project', 'pending'],
    ]);
    expect(servers.palette(projectId)).toEqual([]);
    expect(yield* Effect.flip(servers.remove({ projectId, scope: 'project', name: 'app' }))).toMatchObject({
      code: 'mcp-server-unknown',
    });
    const mount = { projectId, server: 'app', identity: listed[0]!.identity };
    const viewer = { kind: 'operator' as const, projectId, view: 'ui://app/dashboard' };
    const read = servers.appRead(mount, 'app://state', viewer);
    yield* Effect.all([read, read], { concurrency: 2 });
    expect(servers.palette(projectId).map((entry) => entry.declaration.name)).toEqual(['app']);
    expect(servers.palette(projectId + 1)).toEqual([]);

    const events: McpResourceEvent[] = [];
    const heard = yield* Deferred.make<void>();
    const watching = yield* Effect.forkScoped(
      servers.appWatch(mount, 'app://state', viewer).pipe(
        Stream.runForEach((event) => Effect.suspend(() => (events.push(event) === 2 ? Deferred.succeed(heard, undefined) : Effect.void))),
        Effect.flip,
      ),
    );
    yield* Deferred.await(heard);
    expect(events).toEqual([{ kind: 'subscribed' }, { kind: 'updated', uri: 'app://state', _meta: { revision: 0 } }]);
    const callers = (yield* servers.appRead(mount, 'app://callers', viewer)).contents[0];
    expect(JSON.parse(callers !== undefined && 'text' in callers ? callers.text : '{}')).toEqual({ read: viewer, subscribe: viewer });

    const changed = yield* servers.add({
      projectId,
      scope: 'project',
      declaration: { ...app, timeoutMs: 9_000, env: { TOKEN: '${GH_TOKEN}' } },
    });
    expect(changed.find((row) => row.name === 'app')).toMatchObject({ scope: 'project', shadows: 'user', reach: { env: ['TOKEN'] } });
    expect(JSON.stringify(changed)).not.toContain(TOKEN);
    expect(yield* Fiber.join(watching)).toMatchObject({ code: 'mcp-server-replaced' });
    expect(yield* Effect.flip(servers.add({ projectId, scope: 'project', declaration: app }))).toMatchObject({
      code: 'mcp-server-exists',
    });
    expect(servers.palette(projectId).map((entry) => entry.declaration.name)).toEqual(['app']);
    yield* servers.reconcile(projectId);
    expect(
      servers
        .palette(projectId)
        .map((entry) => entry.declaration.name)
        .sort(),
    ).toEqual(['app', 'files']);
    yield* servers.setEnabled({ projectId, scope: 'project', name: 'app', enabled: false });
    expect((yield* servers.list(projectId)).find((row) => row.name === 'app')).toMatchObject({ status: 'disabled', tools: 0 });
    expect(servers.palette(projectId).map((entry) => entry.declaration.name)).toEqual(['files']);
    yield* servers.release(projectId);
    expect(servers.palette(projectId)).toEqual([]);
  }),
);

it.live('a project declining the operator’s servers while its pool opens leaves none of them in the pool', () =>
  Effect.gen(function* () {
    const opened = yield* Effect.acquireRelease(mcpGraph.openEffect(), () => Effect.orDie(mcpGraph.releaseEffect));
    const demo = opened.effects;
    const projectId = demo.projectId;
    const settings = Context.get(demo.context, Settings);
    const entered = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    const places = McpPlaces.of({
      of: () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(held), [])),
      onMoved: () => () => undefined,
    });
    const context = yield* Layer.build(
      poolLayer({}).pipe(
        Layer.provide(Layer.succeed(McpPlaces, places)),
        Layer.provide(noMcpContributions),
        Layer.provideMerge(memorySecretsLayer()),
      ),
    ).pipe(Effect.provide(demo.context));
    const servers = Context.get(context, McpServers);
    const files: McpServerDeclaration = {
      name: 'files',
      transport: 'stdio',
      command: process.execPath,
      args: [MCP_SERVER],
      capabilities: { kinds: ['read'], mutates: false },
      enabled: true,
    };
    yield* settings.amend(mcpServersKey, 'user', undefined, () => Effect.succeed([files]));

    const opening = yield* Effect.forkChild(servers.reconcile(projectId));
    yield* Deferred.await(entered);
    const declined = yield* Effect.forkChild(
      servers.rows(projectId).pipe(
        Stream.filter((rows) => rows.some((row) => row.status === 'declined')),
        Stream.take(1),
        Stream.runDrain,
      ),
    );
    const declining = yield* Effect.forkChild(settings.write({ scope: 'project', projectId, key: mcpServersKey.id, declined: true }));
    yield* Fiber.join(declined);
    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(opening);
    yield* Fiber.join(declining);
    expect([servers.palette(projectId), (yield* servers.list(projectId)).map((row) => [row.name, row.status])]).toEqual([
      [],
      [['files', 'declined']],
    ]);
    yield* servers.release(projectId);
  }),
);

it.live('a contributed server joins the pool below the declared ones, switches off by name and keeps ${NAME} literal', () =>
  Effect.gen(function* () {
    const demo = (yield* Effect.acquireRelease(mcpGraph.openEffect(), () => Effect.orDie(mcpGraph.releaseEffect))).effects;
    const projectId = demo.projectId;
    const keyed = yield* keyedServer('${HOME}');
    const files: McpContribution = {
      contributor: 'plug',
      redact: ['kept-token'],
      declaration: {
        name: 'plug-files',
        transport: 'stdio',
        command: process.execPath,
        args: [MCP_SERVER, '--token=kept-token'],
        capabilities: { kinds: ['read'], mutates: false },
        enabled: true,
      },
    };
    let contributed: readonly McpContribution[] = [];
    const changes = yield* PubSub.sliding<number | null>({ capacity: 1, replay: 1 });
    const contributions = McpContributions.of({ of: () => Effect.sync(() => contributed), changes: Stream.fromPubSub(changes) });
    const entered = yield* Deferred.make<void>();
    const held = yield* Deferred.make<void>();
    const places = McpPlaces.of({
      of: () => Effect.andThen(Deferred.succeed(entered, undefined), Effect.as(Deferred.await(held), [])),
      onMoved: () => () => undefined,
    });
    const context = yield* Layer.build(
      poolLayer({ HOME: '/home/someone' }).pipe(
        Layer.provide(Layer.succeed(McpPlaces, places)),
        Layer.provide(Layer.succeed(McpContributions, contributions)),
        Layer.provideMerge(memorySecretsLayer()),
      ),
    ).pipe(Effect.provide(demo.context));
    const servers = Context.get(context, McpServers);
    const statusOf = (name: string, wanted: string) =>
      Effect.forkChild(
        servers.rows(projectId).pipe(
          Stream.filter((rows) => rows.some((row) => row.name === name && row.status === wanted)),
          Stream.take(1),
          Stream.runDrain,
        ),
      );

    const opening = yield* Effect.forkChild(servers.reconcile(projectId));
    yield* Deferred.await(entered);
    const connected = yield* statusOf('plug-files', 'connected');
    contributed = [files];
    yield* PubSub.publish(changes, projectId);
    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(opening);
    yield* Fiber.join(connected);
    expect(servers.palette(projectId).map((entry) => entry.declaration.name)).toEqual(['plug-files']);
    const listed = yield* servers.list(projectId);
    expect(listed.map((row) => [row.name, row.scope, row.contributor, row.status])).toEqual([
      ['plug-files', 'contributed', 'plug', 'connected'],
    ]);
    expect(listed[0]?.reach).toMatchObject({ args: [MCP_SERVER, '--token=[redacted]'] });

    const shadowed = yield* servers.add({ projectId, scope: 'project', declaration: files.declaration });
    expect(shadowed.map((row) => [row.name, row.scope, row.shadows])).toEqual([['plug-files', 'project', 'contributed']]);
    yield* servers.remove({ projectId, scope: 'project', name: 'plug-files' });
    expect(yield* Effect.flip(servers.remove({ projectId, scope: 'project', name: 'plug-files' }))).toMatchObject({
      code: 'mcp-server-contributed',
    });

    const off = yield* servers.setEnabled({ projectId, scope: 'contributed', name: 'plug-files', enabled: false });
    expect(off.map((row) => [row.name, row.status])).toEqual([['plug-files', 'disabled']]);
    expect(servers.palette(projectId)).toEqual([]);

    const settled = yield* Effect.forkChild(
      servers.rows(projectId).pipe(
        Stream.map((rows) => rows.find((row) => row.name === 'plug-keyed')?.status),
        Stream.filter((status) => status === 'connected' || status === 'failed' || status === 'needs-sign-in'),
        Stream.take(1),
        Stream.runCollect,
      ),
    );
    contributed = [
      files,
      {
        contributor: 'plug',
        redact: [],
        declaration: {
          name: 'plug-keyed',
          transport: 'http',
          url: keyed.url,
          headers: { Authorization: 'Bearer ${HOME}' },
          capabilities: { kinds: ['network'], mutates: true },
          enabled: true,
        },
      },
    ];
    yield* PubSub.publish(changes, projectId);
    expect(yield* Fiber.join(settled)).toEqual(['connected']);
    const echoed = yield* servers.caller(projectId).call('plug-keyed', 'whoami', {}, {});
    expect(JSON.stringify(echoed)).toContain('Bearer ${HOME}');
    yield* servers.release(projectId);
  }),
);
