import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Tool } from '@runlith/agent/tool';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { graphFixture } from '../graphFixture.js';
import { mcpPlaces } from '../../mcpPlaces.js';
import { McpPlaces } from '../../../mcp/contract/service/places.js';
import { McpServers } from '../../../mcp/contract/service/servers.js';
import { mcpServers as mcpServersKey } from '../../../mcp/contract/wire/settings.js';
import { mcpServersLayer } from '../../../mcp/serverPool.js';
import { asMcpToolsContext, mcpBoundTools, mcpServerTools } from '../../../native-harness/testing/doubles.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { threadScratch } from '../../../threads/testing/doubles.js';
import { fixedCoverage } from '../../../workspace/testing/doubles.js';

const mcpGraph = graphFixture();
const ROOTS_SERVER = resolve(import.meta.dir, '../../../../../../../packages/mcp/test/mcpRootsServer.ts');

it.live('a thread’s MCP tool that caches its roots writes into the thread’s checkout and scratch from its first call on', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const demo = (yield* Effect.acquireRelease(mcpGraph.openEffect(), () => Effect.orDie(mcpGraph.releaseEffect))).effects;
    const scratch = yield* threadScratch(yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'mcp-scratch-' })));
    const attachments = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'mcp-attachments-' }));
    const outside = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'mcp-outside-' }));
    const thread = yield* scratch.ensure('thread-1');
    const places = mcpPlaces();
    yield* places.bind({
      coverage: fixedCoverage(demo.projectId, [{ checkout: 'main', root: demo.demoRoot }]),
      bases: [scratch.root, attachments],
    });
    const servers = Context.get(
      yield* Layer.build(mcpServersLayer({}).pipe(Layer.provide(Layer.succeed(McpPlaces, places.port)))).pipe(Effect.provide(demo.context)),
      McpServers,
    );
    yield* Context.get(demo.context, Settings).amend(mcpServersKey, 'project', demo.projectId, () =>
      Effect.succeed([
        {
          name: 'roots',
          transport: 'stdio' as const,
          command: process.execPath,
          args: [ROOTS_SERVER],
          capabilities: { kinds: ['write' as const], mutates: true },
          enabled: true,
        },
      ]),
    );
    yield* servers.reconcile(demo.projectId);
    const tool = mcpServerTools(
      asMcpToolsContext({
        projectId: demo.projectId,
        world: { root: demo.demoRoot, facts: { shared: true } },
        thread: { id: 'thread-1' },
        mcpServers: servers,
        mcp: () => servers.palette(demo.projectId),
        mcpBound: mcpBoundTools(),
      }),
    )['mcp__roots__save'];
    const execute = tool === undefined ? null : Tool.toolExecute(tool);
    if (execute === null) return yield* Effect.die('the roots server offered no save tool');
    const save = (path: string) =>
      Effect.map(
        execute({ path }, { toolCallId: path, caller: { agentId: 'agent', ownerId: 'owner', thread: null }, messages: [] }),
        (answer) => (answer as Tool.ToolAnswer).display,
      );
    for (const path of [
      join(thread, 'shot.png'),
      join(demo.demoRoot, 'note.txt'),
      join(thread, 'again.png'),
      join(attachments, 'kept.pdf'),
    ]) {
      expect(yield* save(path)).toMatchObject({ text: 'saved' });
    }
    expect(yield* save(join(outside, 'elsewhere.txt'))).toMatchObject({ text: 'outside-roots' });
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
