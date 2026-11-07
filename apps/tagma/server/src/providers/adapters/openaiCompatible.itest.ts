import { openModelClient } from '@runlith/llm/models/client';
import { it } from '@runlith/effect-test';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { modelRequester } from '@runlith/agent/ModelRequests';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { Message } from '@runlith/llm/schema/messages';
import type { SettingInstance } from '@runlith/tagma/adapter/provider';
import { Context, Effect, Layer, Stream } from 'effect';
import { credentialMissing } from '../credentials/missing.js';
import { AdapterInstances } from '../contract/service/instances.js';
import { ProviderRegistry } from '../contract/service/registry.js';
import { fixedSources } from '../testing/registry.js';
import { registryLayer } from '../registry.js';

const seen: { path: string; authorization: string | null; body: Record<string, unknown> | null }[] = [];
let server: ReturnType<typeof Bun.serve>;

const frame = (delta: Record<string, unknown>, finish: string | null) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = request.method === 'POST' ? ((await request.json()) as Record<string, unknown>) : null;
      seen.push({ path, authorization: request.headers.get('authorization'), body });
      if (path === '/v1/models') {
        return Response.json({
          object: 'list',
          data: [
            { id: 'tiny', object: 'model' },
            { id: 'vision-large', context_length: 32768, architecture: { input_modalities: ['text', 'image'] } },
          ],
        });
      }
      const stream = `${frame({ role: 'assistant', content: 'Hello ' }, null)}${frame({ content: 'there' }, 'stop')}data: [DONE]\n\n`;
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    },
  });
});

afterAll(() => server.stop(true));

const instance = (id: string): SettingInstance => ({
  id,
  values: {
    name: 'Stub',
    baseUrl: `http://localhost:${server.port}/v1`,
    models: [
      { id: 'tiny', context: 8192 },
      { id: 'sized', context: 16000, output: 99999 },
    ],
  },
});

const registryOf = Effect.fnUntraced(function* (
  instances: readonly SettingInstance[],
  secrets: Record<string, Record<string, string>> = {},
) {
  const { adapter } = yield* Effect.promise(() => import('@runlith/adapter-openai-compatible/adapter'));
  const stored = Layer.succeed(AdapterInstances, {
    read: () => Effect.succeed({ instances: new Map([['openai-compatible', instances]]), secrets }),
    save: (_adapter, instance) => Effect.succeed(instance),
    remove: () => Effect.void,
  });
  const context = yield* Layer.build(
    registryLayer.pipe(
      Layer.provide(stored),
      Layer.provide(
        fixedSources([
          { id: 'openai-compatible', title: 'OpenAI-compatible server', origin: 'builtin', version: null, load: async () => adapter },
        ]),
      ),
    ),
  );
  return Context.get(context, ProviderRegistry);
});

const keyless: ModelCredentials = {
  apiKey: async () => {
    throw credentialMissing('No stub console key is stored.');
  },
  accessToken: async () => '',
  credential: async () => ({}),
};

it.live('an instance from settings serves its enabled models in the catalog, streams a reply and sends max_tokens within its window', () =>
  Effect.gen(function* () {
    const registry = yield* registryOf([instance('openai-compatible-stub')]);
    const catalog = yield* registry.catalog;

    expect(catalog.models.modelsFor('openai-compatible-stub', 'text').map((model) => model.id)).toEqual(['tiny', 'sized']);
    expect(catalog.served.settings.map((entry) => [entry.adapter, entry.instances.map((held) => held.id)])).toEqual([
      ['openai-compatible', ['openai-compatible-stub']],
    ]);

    const request = modelRequester(catalog.wires, keyless, yield* openModelClient()).request({
      ownerId: 'owner',
      provider: 'openai-compatible-stub',
      model: 'tiny',
    });
    const events = yield* Stream.runCollect(request.stream({ messages: [Message.user('hi')], tools: {} }));
    const text = [...events].flatMap((event) => (event.type === 'text-delta' ? [event.text] : [])).join('');
    const chat = seen.filter((entry) => entry.path === '/v1/chat/completions').at(-1)!;

    expect(text).toBe('Hello there');
    expect(chat.authorization).toBeNull();
    expect(chat.body?.max_tokens).toBe(2048);

    const sized = modelRequester(catalog.wires, keyless, yield* openModelClient()).request({
      ownerId: 'owner',
      provider: 'openai-compatible-stub',
      model: 'sized',
    });
    yield* Stream.runDrain(sized.stream({ messages: [Message.user('hi')], tools: {} }));
    expect(seen.filter((entry) => entry.path === '/v1/chat/completions').at(-1)?.body?.max_tokens).toBe(16000);
  }),
);

it.live('models on one endpoint route reasoning through their own field and value mapping, with the instance as default', () =>
  Effect.gen(function* () {
    const configured: SettingInstance = {
      id: 'openai-compatible-routing',
      values: {
        name: 'Reasoning',
        baseUrl: `http://localhost:${server.port}/v1`,
        reasoningField: 'thinking',
        models: [
          { id: 'default', context: 8192, reasoning: ['none', 'high'] },
          {
            id: 'mapped',
            context: 8192,
            reasoning: ['high'],
            reasoningField: 'analysis_mode',
            reasoningMapping: '{"high":{"budget":1234}}',
          },
          { id: 'effort', context: 8192, reasoning: ['high'], reasoningField: 'reasoning_effort', reasoningMapping: '{"high":"deep"}' },
        ],
      },
    };
    const catalog = (yield* registryOf([configured])).current();
    for (const [model, reasoning] of [
      ['default', 'none'],
      ['mapped', 'high'],
      ['effort', 'high'],
    ] as const) {
      const request = modelRequester(catalog.wires, keyless, yield* openModelClient()).request({
        ownerId: 'owner',
        provider: configured.id,
        model,
        reasoning,
      });
      yield* Stream.runDrain(request.stream({ messages: [Message.user('hi')], tools: {} }));
    }
    const requests = seen
      .filter((entry) => entry.path === '/v1/chat/completions')
      .slice(-3)
      .map((entry) => entry.body!);
    expect(requests[0]?.thinking).toEqual({ type: 'disabled' });
    expect(requests[0]?.reasoning_effort).toBeUndefined();
    expect(requests[1]?.analysis_mode).toEqual({ budget: 1234 });
    expect(requests[1]?.thinking).toBeUndefined();
    expect(requests[1]?.reasoning_effort).toBeUndefined();
    expect(requests[2]?.reasoning_effort).toBe('deep');
    expect(requests[2]?.thinking).toBeUndefined();
  }),
);

it.live('the stored key signs the request, and the server lists its models on demand', () =>
  Effect.gen(function* () {
    const registry = yield* registryOf([instance('openai-compatible-stub')], { 'openai-compatible-stub': { key: 'secret-key' } });
    const catalog = yield* registry.catalog;
    const signing: ModelCredentials = { ...keyless, apiKey: async () => 'secret-key' };

    const request = modelRequester(catalog.wires, signing, yield* openModelClient()).request({
      ownerId: 'owner',
      provider: 'openai-compatible-stub',
      model: 'tiny',
    });
    yield* Stream.runDrain(request.stream({ messages: [Message.user('hi')], tools: {} }));
    expect(seen.filter((entry) => entry.path === '/v1/chat/completions').at(-1)?.authorization).toBe('Bearer secret-key');

    const settings = catalog.settings.get('openai-compatible')!;
    const listed = yield* settings.discover!(instance('x').values, { key: 'secret-key' });
    expect(listed).toEqual([{ id: 'tiny' }, { id: 'vision-large', context: 32768, vision: true }]);
    expect(seen.find((entry) => entry.path === '/v1/models')?.authorization).toBe('Bearer secret-key');
  }),
);
