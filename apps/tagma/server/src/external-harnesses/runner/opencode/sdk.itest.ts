import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Exit, Fiber, FileSystem, Schema, Scope } from 'effect';
import { FAULT, type Outlet } from '@runlith/acp/agent';
import type { SessionUpdate } from '@runlith/acp/updates';
import { accountEnvironment } from '@runlith/adapter-opencode/environment';
import { installedProgram } from '@runlith/adapter-opencode/host';
import { SAID, Said } from '../../contract/wire/extensions.js';
import { hostedAgent } from '../hosted/agent.js';
import type { HostedDoor } from '../hosted/door.js';
import { OpenCodeSdk } from './channel.js';
import { makeOpenCodeCycle } from './cycle.js';
import { makeOpenCodeSdk } from './sdk.js';

const RequestBody = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
  tools: Schema.optional(Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String, parameters: Schema.Unknown }) }))),
});
const tool = {
  name: 'record',
  description: 'Record a marker',
  inputSchema: { type: 'object', properties: { marker: { type: 'string' } }, required: ['marker'], additionalProperties: false },
  mutates: false,
};
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

it.live(
  'the private CLI runs only hosted tools, seals original ids before results, isolates sessions and loads only terminal durable executions',
  () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const root = yield* files.makeTempDirectoryScoped({ prefix: 'opencode-boundary-' });
      const requests: (typeof RequestBody.Type)[] = [];
      const waiting = yield* Deferred.make<void>();
      const chunks = (delta: unknown, finish: string | null = null) =>
        `data: ${JSON.stringify({
          id: 'chat_probe',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'probe',
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(finish === null ? {} : { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }),
        })}\n\n`;
      const upstream = yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bun.serve({
            hostname: '127.0.0.1',
            port: 0,
            idleTimeout: 0,
            async fetch(request) {
              const body = Schema.decodeUnknownSync(RequestBody)(await request.json());
              requests.push(body);
              if (JSON.stringify(body.messages.filter((message) => message.role === 'user').at(-1)?.content).includes('WAIT_FOR_CANCEL')) {
                const delta = {
                  tool_calls: [
                    { index: 0, id: 'call_cancel', type: 'function', function: { name: 'replacement', arguments: '{"marker":"cancel"}' } },
                  ],
                };
                return new Response(chunks(delta) + chunks({}, 'tool_calls') + 'data: [DONE]\n\n', {
                  headers: { 'content-type': 'text/event-stream' },
                });
              }
              const answered = body.messages.some((message) => message.role === 'tool');
              const delta = answered
                ? { content: 'DONE' }
                : {
                    tool_calls: [
                      { index: 0, id: 'call_original_a', type: 'function', function: { name: 'record', arguments: '{"marker":"a"}' } },
                      { index: 1, id: 'call_original_b', type: 'function', function: { name: 'record', arguments: '{"marker":"b"}' } },
                    ],
                  };
              return new Response(chunks(delta) + chunks({}, answered ? 'stop' : 'tool_calls') + 'data: [DONE]\n\n', {
                headers: { 'content-type': 'text/event-stream' },
              });
            },
          }),
        ),
        (server) => Effect.promise(() => server.stop(true)),
      );
      const environment: Record<string, string | undefined> = { ...globalThis.process.env, OPENCODE_DISABLE_MODELS_FETCH: 'true' };
      for (const change of accountEnvironment(`${root}/account`))
        environment[change.name] = change._tag === 'Set' ? change.value : undefined;
      const config = JSON.stringify({
        providers: {
          probe: {
            package: '@opencode/ai/providers/openai-compatible',
            settings: { baseURL: `http://127.0.0.1:${upstream.port}/v1`, apiKey: 'probe' },
            models: { probe: { capabilities: { tools: true, input: ['text', 'image'], output: ['text'] } } },
          },
        },
      });
      const process = {
        stderr: (text: string) => {
          globalThis.process.stderr.write(text);
        },
        died: (reason: string) => Effect.die(reason),
      };
      const host = (directory: string) => ({
        directory,
        host: {
          program: installedProgram(),
          cwd: root,
          environment,
          config: { directory: `${directory}/config`, content: config, project: false as const, claude: false as const },
          onStderr: process.stderr,
        },
      });
      yield* files.makeDirectory(`${root}/one/config`, { recursive: true });
      yield* files.makeDirectory(`${root}/two/config`, { recursive: true });
      const firstScope = yield* Scope.fork(yield* Effect.scope);
      const sdk = yield* makeOpenCodeSdk(host(`${root}/one`), process).pipe(Effect.provideService(Scope.Scope, firstScope));
      let system = 'TAGMA_EXACT_SYSTEM';
      let listed = [tool];
      const called: { id: string; name: string; input: unknown }[] = [];
      const updates: SessionUpdate[] = [];
      const seal = yield* Deferred.make<void>();
      const door: HostedDoor = {
        agent: () => Effect.succeed({ prompt: system, web: 'none' }),
        turn: () => Effect.succeed({ prompt: system, context: 'turn-context', web: 'none' }),
        tools: () => Effect.succeed({ names: listed.map((item) => item.name), tools: listed }),
        history: () =>
          Effect.succeed([
            {
              role: 'user',
              content: [
                { type: 'text', text: 'before-image' },
                { type: 'image', data: png, mimeType: 'image/png' },
                { type: 'text', text: 'after-image' },
              ],
            },
          ]),
        call: Effect.fnUntraced(function* (id: string, name: string, input: unknown) {
          called.push({ id, name, input });
          if (id === 'call_cancel') {
            yield* Deferred.succeed(waiting, undefined);
            return yield* Effect.never;
          }
          yield* Deferred.await(seal);
          return {
            status: 'called' as const,
            content: [{ type: 'text' as const, text: id === 'call_original_a' ? 'recorded' : 'declined' }],
            failed: id === 'call_original_b',
            offered: false,
            words: [],
          };
        }),
      };
      const outlet: Outlet = {
        update: (event) =>
          Effect.sync(() => {
            updates.push(event.update);
          }),
        notify: (method, params) =>
          method === SAID
            ? Schema.decodeUnknownEffect(Said)(params).pipe(
                Effect.orDie,
                Effect.flatMap((said) => (said.toolCallIds.length === 2 ? Effect.asVoid(Deferred.succeed(seal, undefined)) : Effect.void)),
              )
            : Effect.void,
        request: () => Effect.die('No vendor permission loop'),
      };
      const cycle = yield* makeOpenCodeCycle(door, process, { model: 'probe/probe', effort: null, parameters: {}, version: 'test' }).pipe(
        Effect.provideService(OpenCodeSdk, sdk),
      );
      const agent = hostedAgent(cycle, door)(outlet);
      const session = yield* agent.newSession({ cwd: root, mcpServers: [] });
      const result = yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Run the two hosted calls' }] });
      expect(result.stopReason).toBe('end_turn');
      expect(called).toEqual([
        { id: 'call_original_a', name: 'record', input: { marker: 'a' } },
        { id: 'call_original_b', name: 'record', input: { marker: 'b' } },
      ]);
      expect(requests[0]!.messages.filter((message) => message.role === 'system')).toEqual([{ role: 'system', content: system }]);
      expect(requests[0]!.tools?.map((item) => item.function)).toEqual([{ name: tool.name, parameters: tool.inputSchema }]);
      const user = requests[0]!.messages.find((message) => message.role === 'user');
      const wire = JSON.stringify(user?.content);
      expect(wire.indexOf('before-image')).toBeLessThan(wire.indexOf(png));
      expect(wire.indexOf(png)).toBeLessThan(wire.indexOf('after-image'));
      expect(updates.filter((update) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed')).toMatchObject([
        { toolCallId: 'call_original_b', _meta: { 'tagma/executes': true } },
      ]);
      expect(updates.filter((update) => update.sessionUpdate === 'usage_update')).toHaveLength(2);
      expect(result.usage).toBeUndefined();
      system = 'NEXT_EXACT_SYSTEM';
      listed = [{ ...tool, name: 'replacement' }];
      yield* agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Next turn' }] });
      expect(requests.at(-1)!.messages.filter((message) => message.role === 'system')).toEqual([{ role: 'system', content: system }]);
      expect(requests.at(-1)!.tools?.map((item) => item.function.name)).toEqual(['replacement']);
      const turning = yield* Effect.forkChild(
        agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'WAIT_FOR_CANCEL' }] }),
      );
      yield* Deferred.await(waiting);
      const second = yield* makeOpenCodeSdk(host(`${root}/two`), process);
      expect((yield* Effect.flip(second.open({ id: session.sessionId, cwd: root }, Effect.void))).code).toBe(FAULT.notFound);
      expect((yield* Effect.flip(second.open({ id: session.sessionId, cwd: `${root}/wrong` }, Effect.void))).code).toBe(FAULT.notFound);
      yield* agent.cancel({ sessionId: session.sessionId });
      expect((yield* Fiber.join(turning)).stopReason).toBe('cancelled');
      expect(called.filter((call) => call.id === 'call_cancel')).toEqual([
        { id: 'call_cancel', name: 'replacement', input: { marker: 'cancel' } },
      ]);
      yield* agent.ended;
      yield* Scope.close(firstScope, Exit.succeed(undefined));
      const loaded = yield* second.open({ id: session.sessionId, cwd: root }, Effect.void);
      expect(loaded.id).toBe(session.sessionId);
      const resumed = yield* loaded.send({
        system,
        blocks: [{ type: 'text', text: 'Continue after restart' }],
        selection: { model: 'probe/probe', effort: null },
        tools: [],
        event: () => Effect.void,
        call: () => Effect.die('No tools admitted'),
      });
      expect(yield* resumed.wait).toMatchObject({ status: 'finished' });
      yield* loaded.close;
    }).pipe(Effect.provide(BunFileSystem.layer)),
  60_000,
);
