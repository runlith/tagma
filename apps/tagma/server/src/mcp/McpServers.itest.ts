import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { resolve } from 'node:path';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Context, Deferred, Effect, Fiber, Layer, Stream } from 'effect';
import type { McpResourceEvent } from './contract/wire/feeds.js';
import { graphFixture } from '../composition/testing/graphFixture.js';
import { mcpServers as mcpServersKey } from './contract/wire/settings.js';
import { Settings } from '../settings/contract/service/values.js';
import { McpServers } from './contract/service/servers.js';
import { mcpServersLayer } from './serverPool.js';

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
    expect(
      yield* Effect.flip(servers.add({ projectId, scope: 'project', declaration: { ...app, env: { TOKEN: '${NOPE}' } } })),
    ).toMatchObject({ code: 'mcp-secret-missing' });
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
