import { expect } from 'bun:test';
import { join, resolve } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Effect, FileSystem } from 'effect';
import { writePlugin } from '../../../plugin-formats/tagma/testing/folder.js';
import { makeDoorWorld } from '../doorFixture.js';

const MCP_SERVER = resolve(import.meta.dir, '../../../../../../../packages/mcp/test/mcpTestServer.ts');

const brought = Effect.fnUntraced(function* (world: Effect.Success<ReturnType<typeof makeDoorWorld>>, id: string, server: string) {
  const files = yield* FileSystem.FileSystem;
  const folder = yield* world.directory(`${id}-plugin`);
  yield* files.makeDirectory(folder, { recursive: true });
  yield* files.writeFileString(join(folder, 'server'), `#!/bin/sh\nexec "${process.execPath}" "${MCP_SERVER}"\n`);
  yield* files.chmod(join(folder, 'server'), 0o755);
  yield* Effect.promise(() => writePlugin(folder, { id, mcpServers: { [server]: { type: 'stdio', command: './server' } } }));
  return folder;
});

layer(BunFileSystem.layer, { excludeTestServices: true })('the MCP servers a plugin brings', (it) => {
  it.effect(
    'its process and its views call its own server under the plugin’s attribution, and another plugin’s server or a project where it is off refuses',
    () =>
      Effect.gen(function* () {
        const world = yield* makeDoorWorld();
        const projectId = yield* world.stealthProject();
        const elsewhere = yield* world.stealthProject();
        const scope = `project=${projectId}`;
        for (const [id, server] of [
          ['alpha', 'files'],
          ['beta', 'notes'],
        ] as const) {
          const folder = yield* brought(world, id, server);
          expect(yield* world.op('install_plugin', { source: folder, scope: 'project' }, scope)).toMatchObject({
            status: 200,
            body: { plugin: { id, enabled: true } },
          });
          yield* Effect.addFinalizer(() => world.op('uninstall_plugin', { id }, scope).pipe(Effect.orDie));
        }
        const call = (input: Readonly<Record<string, unknown>>, at = scope, caller: string | null = 'plugin:alpha') =>
          world.op(
            'call_contributed_tool',
            { tool: 'meta', arguments: {}, ...input },
            at,
            caller === null ? undefined : { 'x-tagma-caller': caller },
          );
        const callerOf = (answer: { readonly body: unknown }) =>
          JSON.parse((answer.body as { result: { content: [{ text: string }] } }).result.content[0].text)['runlith/caller'];

        const fromProcess = yield* call({ server: 'files' });
        expect(fromProcess.status).toBe(200);
        expect(callerOf(fromProcess)).toEqual({ kind: 'tagma', projectId, reason: 'plugin alpha' });

        const fromView = yield* call({ server: 'files', plugin: 'alpha', view: 'board', threadId: 'thread-1' }, scope, null);
        expect(fromView.status).toBe(200);
        expect(callerOf(fromView)).toEqual({ kind: 'operator', projectId, view: 'alpha/board', threadId: 'thread-1' });

        expect(yield* call({ server: 'notes' })).toMatchObject({ status: 409, body: { code: 'mcp-server-unbrought' } });
        expect(yield* call({ server: 'files' }, `project=${elsewhere}`)).toMatchObject({
          status: 409,
          body: { code: 'plugin-not-enabled' },
        });
      }),
  );
});
