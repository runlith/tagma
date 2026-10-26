import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, FileSystem } from 'effect';
import { accountEnvironment } from '@runlith/adapter-opencode/environment';
import { installedProgram, openHost } from '@runlith/adapter-opencode/host';
import { entryPath } from '../../../installation/contract/wire/junction.js';
import { installHooks } from '../../installs/hookWrite.js';
import { declareInto } from '../../installs/mcpDeclaration.js';
import { opencode } from './row.js';
import { dirname, join } from 'node:path';

it.live('the installed V2 plugin delivers lifecycle and file hooks, injects law and connects the declared MCP process', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const root = yield* files.makeTempDirectoryScoped({ prefix: 'opencode-terminal-' });
    const home = join(root, 'home');
    const stopped = yield* Deferred.make<void>();
    const childStopped = yield* Deferred.make<void>();
    const failed = yield* Deferred.make<Record<string, unknown>>();
    const cancelled = yield* Deferred.make<Record<string, unknown>>();
    const modelEntered = yield* Deferred.make<void>();
    let failureSession: string | undefined;
    let cancelSession: string | undefined;
    const hooks: Record<string, unknown>[] = [];
    const requests: Record<string, unknown>[] = [];
    const chunk = (delta: unknown, finish: string) =>
      `data: ${JSON.stringify({ id: 'chat_terminal', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'chat_terminal', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } })}\n\ndata: [DONE]\n\n`;
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          idleTimeout: 0,
          async fetch(request) {
            const body = (await request.json()) as Record<string, unknown>;
            if (new URL(request.url).pathname === '/hook') {
              hooks.push(body);
              if (body.verb === 'session-start') return new Response('TAGMA_LAW');
              if (body.verb === 'pre-tool-use' || body.verb === 'post-tool-use')
                return Response.json({ hookSpecificOutput: { additionalContext: 'TAGMA_TOUCHED' } });
              if (body.verb === 'permission-request')
                return Response.json(
                  body.tool_name === 'write' ? { decision: 'deny', reason: 'Fixture denied write' } : { decision: 'approve' },
                );
              if (body.verb === 'stop') {
                if (body.session_id === failureSession) Deferred.doneUnsafe(failed, Effect.succeed(body));
                else if (body.session_id === cancelSession) Deferred.doneUnsafe(cancelled, Effect.succeed(body));
                else Deferred.doneUnsafe(body.agent_id === undefined ? stopped : childStopped, Effect.void);
              }
              return new Response('');
            }
            if (body.tools === undefined)
              return new Response(chunk({ content: 'Title' }, 'stop'), { headers: { 'content-type': 'text/event-stream' } });
            if (JSON.stringify(body.messages).includes('FAIL_TERMINAL'))
              return Response.json({ error: { message: 'Fixture authorization rejected', type: 'invalid_api_key' } }, { status: 401 });
            if (JSON.stringify(body.messages).includes('CANCEL_TERMINAL')) {
              Deferred.doneUnsafe(modelEntered, Effect.void);
              return new Response(
                new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(
                      new TextEncoder().encode(
                        `data: ${JSON.stringify({ id: 'chat_wait', object: 'chat.completion.chunk', created: 1, model: 'probe', choices: [{ index: 0, delta: { content: 'waiting' }, finish_reason: null }] })}\n\n`,
                      ),
                    );
                  },
                }),
                { headers: { 'content-type': 'text/event-stream' } },
              );
            }
            requests.push(body);
            const tools = body.tools as { function: { name: string } }[];
            const marker = tools.find((tool) => tool.function.name.includes('marker'))?.function.name;
            if (requests.length === 4)
              return new Response(
                chunk(
                  {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_write',
                        type: 'function',
                        function: { name: 'write', arguments: '{"path":"blocked.txt","content":"must not be written"}' },
                      },
                    ],
                  },
                  'tool_calls',
                ),
                { headers: { 'content-type': 'text/event-stream' } },
              );
            if (requests.length === 1)
              return new Response(
                chunk(
                  {
                    tool_calls: [
                      { index: 0, id: 'call_read', type: 'function', function: { name: 'read', arguments: '{"path":"sample.txt"}' } },
                    ],
                  },
                  'tool_calls',
                ),
                { headers: { 'content-type': 'text/event-stream' } },
              );
            if (requests.length === 2 && marker !== undefined)
              return new Response(
                chunk(
                  { tool_calls: [{ index: 0, id: 'call_mcp', type: 'function', function: { name: marker, arguments: '{}' } }] },
                  'tool_calls',
                ),
                { headers: { 'content-type': 'text/event-stream' } },
              );
            return new Response(chunk({ content: 'DONE' }, 'stop'), { headers: { 'content-type': 'text/event-stream' } });
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    );
    const fixture = join(root, 'fixture.ts');
    yield* files.writeFileString(
      fixture,
      `
if (process.argv[2] === 'mcp-serve') {
  for await (const line of console) {
    const message = JSON.parse(line);
    if (!('id' in message)) continue;
    const result = message.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : message.method === 'tools/list' ? { tools: [{ name: 'marker', description: 'Return a marker', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'MCP_OK' }] };
    console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  }
} else {
  const payload = await Bun.stdin.json();
  const response = await fetch('http://127.0.0.1:${server.port}/hook', { method: 'POST', body: JSON.stringify({ verb: process.argv[3], ...payload }) });
  process.stdout.write(await response.text());
}
`,
    );
    const entry = entryPath({ HOME: home })!;
    yield* files.makeDirectory(dirname(entry), { recursive: true });
    yield* files.writeFileString(entry, `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o755 });
    yield* files.writeFileString(join(root, 'sample.txt'), 'FILE_MARKER');
    yield* installHooks(root);
    expect((yield* installHooks(root)).every((row) => row.write === 'current')).toBe(true);
    const directory = join(root, 'config');
    const declared = yield* Effect.tryPromise(() => declareInto(root, opencode, opencode.mcp!, [process.execPath, fixture], directory));
    expect(declared.write).toBe('created');
    const environment: Record<string, string | undefined> = { ...process.env, OPENCODE_DISABLE_MODELS_FETCH: 'true' };
    for (const entry of accountEnvironment(home)) environment[entry.name] = entry._tag === 'Set' ? entry.value : undefined;
    yield* files.makeDirectory(directory, { recursive: true });
    const host = yield* openHost({
      program: installedProgram(),
      cwd: root,
      environment,
      config: {
        directory,
        project: false,
        claude: false,
        content: JSON.stringify({
          plugins: [join(root, '.opencode', 'plugins', 'tagma')],
          mcp: JSON.parse(yield* files.readFileString(join(directory, 'opencode.json'))).mcp,
          model: 'probe/probe',
          snapshots: false,
          formatter: false,
          lsp: false,
          warming: false,
          update: 'disable',
          compaction: { auto: false },
          providers: {
            probe: {
              package: '@opencode/ai/providers/openai-compatible',
              settings: { baseURL: `http://127.0.0.1:${server.port}/v1`, apiKey: 'probe' },
              models: { probe: { capabilities: { tools: true, input: ['text'], output: ['text'] } } },
            },
          },
        }),
      },
      onStderr: (text) => process.stderr.write(text),
    });
    const session = yield* Effect.tryPromise(() =>
      host.client.session.create({ location: { directory: root }, permissions: [{ action: '*', resource: '*', effect: 'allow' }] }),
    );
    yield* Effect.tryPromise(() =>
      host.client.session.prompt({ sessionID: session.id, text: 'Read sample.txt, call marker, then finish.' }),
    );
    expect(hooks.find((hook) => hook.verb === 'session-start')?.session_id).toBe(session.id);
    yield* Effect.tryPromise(() => host.client.session.wait({ sessionID: session.id }));
    yield* Deferred.await(stopped);
    expect(hooks.find((hook) => hook.verb === 'pre-tool-use' && hook.tool_name === 'read')?.tool_input).toEqual({ path: 'sample.txt' });
    expect(hooks.find((hook) => hook.verb === 'post-tool-use' && hook.tool_name === 'read')?.tool_response).toContain('FILE_MARKER');
    expect(hooks.find((hook) => hook.verb === 'stop')?.last_assistant_message).toBe('DONE');
    expect(JSON.stringify(requests[0])).toContain('TAGMA_LAW');
    expect(JSON.stringify(requests[1])).toContain('TAGMA_TOUCHED');
    expect(JSON.stringify(requests.at(-1))).toContain('MCP_OK');
    yield* Effect.tryPromise(() => host.client.session.prompt({ sessionID: session.id, text: 'Write blocked.txt.' }));
    yield* Effect.tryPromise(() => host.client.session.wait({ sessionID: session.id }));
    expect(yield* files.exists(join(root, 'blocked.txt'))).toBe(false);
    expect(JSON.stringify(requests.at(-1))).toContain('Fixture denied write');
    const child = yield* Effect.tryPromise(() => host.client.session.create({ location: { directory: root }, parentID: session.id }));
    yield* Effect.tryPromise(() => host.client.session.prompt({ sessionID: child.id, text: 'Finish.' }));
    yield* Effect.tryPromise(() => host.client.session.wait({ sessionID: child.id }));
    yield* Deferred.await(childStopped);
    expect(hooks.find((hook) => hook.verb === 'stop' && hook.agent_id === child.id)?.session_id).toBe(session.id);
    const broken = yield* Effect.tryPromise(() => host.client.session.create({ location: { directory: root } }));
    failureSession = broken.id;
    yield* Effect.tryPromise(() => host.client.session.prompt({ sessionID: broken.id, text: 'FAIL_TERMINAL' }));
    const failure = yield* Deferred.await(failed);
    expect(failure.status).toBe('error');
    expect(failure.error).toContain('Fixture authorization rejected');
    expect((yield* Effect.tryPromise(() => host.client.session.get({ sessionID: broken.id }))).outcome).toBe('failed');
    const interrupted = yield* Effect.tryPromise(() => host.client.session.create({ location: { directory: root } }));
    cancelSession = interrupted.id;
    yield* Effect.tryPromise(() => host.client.session.prompt({ sessionID: interrupted.id, text: 'CANCEL_TERMINAL' }));
    yield* Deferred.await(modelEntered);
    yield* Effect.tryPromise(() => host.client.session.interrupt({ sessionID: interrupted.id }));
    expect((yield* Deferred.await(cancelled)).status).toBe('aborted');
    expect((yield* Effect.tryPromise(() => host.client.session.get({ sessionID: interrupted.id }))).outcome).toBe('interrupted');
  }).pipe(Effect.provide(BunFileSystem.layer)),
);
