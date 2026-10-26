import { Effect } from 'effect';
import { join } from 'node:path';
import { mcpClose, mcpConnect, mcpSdkDefaults, openMcpTransport } from '@runlith/mcp/testing/sdk';
import { makeTerminalWorld } from '../fixture.js';

export const makeMcpWorld = Effect.fnUntraced(function* () {
  const world = yield* makeTerminalWorld();
  const project = yield* world.checkout();
  const scratch = yield* world.directory('mcp-tmp');
  const call = { timeout: (yield* mcpSdkDefaults('tagma', 'stdio')).timeoutMs };
  const environment = (extra: Record<string, string> = {}): Record<string, string> => {
    const base: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) if (value !== undefined) base[name] = value;
    for (const name of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'GROK_SESSION_ID', 'TAGMA_SESSION_GRANT']) delete base[name];
    return { ...base, TAGMA_SERVER_URL: world.url, TMPDIR: scratch, TMP: scratch, TEMP: scratch, ...extra };
  };
  const bridge = Effect.fnUntraced(function* (
    harness: string,
    extra: Record<string, string> = {},
    onToolsChanged: () => void = () => undefined,
  ) {
    const stderr: string[] = [];
    const connection = yield* Effect.acquireRelease(
      openMcpTransport(
        'tagma',
        {
          transport: 'stdio',
          command: 'bun',
          args: [join(import.meta.dir, '../../entries/cli.ts'), 'mcp-serve', '--harness', harness],
          cwd: project.root,
          env: environment(extra),
          onStderr: (chunk) => {
            stderr.push(new TextDecoder().decode(chunk));
          },
        },
        { onToolsChanged, onClosed: () => undefined },
      ),
      (connection) => mcpClose(connection, call.timeout),
    );
    yield* mcpConnect(connection, { timeout: 30_000 }).pipe(Effect.tapError(() => Effect.logError(stderr.join(''))));
    return connection;
  });
  return { world, project, call, environment, bridge };
});
