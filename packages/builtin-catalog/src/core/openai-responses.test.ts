import { it } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect, Layer, Stream } from 'effect';
import { openModelClient } from '@runlith/llm/models/client';
import { museConsoleRegistration } from '@runlith/adapter-muse/profiles/muse';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { xaiConsoleRegistration } from '@runlith/adapter-xai/profiles/xai';
import { LLMError } from '@runlith/llm/schema/errors';
import { LLMEvent } from '@runlith/llm/schema/events';
import { LLMRequest, Message, ToolChoice, ToolDefinition } from '@runlith/llm/schema/messages';
import type { Model } from '@runlith/llm/schema/options';
import { protocol, route } from '@runlith/llm/protocols/openai-responses';
import { answering } from '@runlith/llm/route/transport/answering';
import { stream } from '@runlith/llm/route/client';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';

const XAI_CAPACITY =
  'The model is currently at capacity due to high demand. Please try again in a few minutes, or use a higher service tier for priority processing: https://docs.x.ai/developers/advanced-api-usage/priority-processing';
const CAPACITY_EVENT = JSON.stringify({ sequence_number: 0, type: 'error', code: null, message: XAI_CAPACITY, param: null });
const credentials: ModelCredentials = {
  apiKey: async () => 'api-key',
  accessToken: async () => 'access-token',
  credential: async () => ({
    accessToken: 'token',
    refreshToken: 'refresh',
    expiresAt: 0,
    scope: '',
    account: { uuid: 'account-uuid', email: 'operator@example.com' },
    organization: { uuid: 'organization-uuid', name: '' },
    accountId: undefined,
  }),
};
const COMPLETED = JSON.stringify({
  type: 'response.completed',
  response: { id: 'response-1', service_tier: null, incomplete_details: null, usage: null },
});
const fetchOf = (...frames: ReadonlyArray<string>) =>
  answering(
    () =>
      new Response(frames.map((frame) => `data: ${frame}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
  );
const streamEffect = (model: Model, ...frames: ReadonlyArray<string>) =>
  Effect.scopedWith((lifetime) => Stream.runCollect(stream(new LLMRequest({ model, system: [], messages: [], tools: [] }), lifetime))).pipe(
    Effect.provide(Layer.effectContext(openModelClient(fetchOf(...frames)))),
  );
const streamFailure = (model: Model, ...frames: ReadonlyArray<string>) => Effect.flip(streamEffect(model, ...frames));
const xaiModel = () => xaiConsoleRegistration.profile.model({ ownerId: 'owner', model: 'grok-4.6', credentials });
const museModel = () =>
  museConsoleRegistration(RECORDED_PRODUCT).profile.model({ ownerId: 'owner', model: 'muse-spark-1.3-contributor', credentials });
const ordinary = route.with({ provider: 'responses-test', endpoint: { baseURL: 'https://responses.invalid/v1' } });
const openAIModel = () => ordinary.model({ id: 'gpt-test' });

it.effect('Muse flattens root tool composition while ordinary OpenAI retains it', () =>
  Effect.gen(function* () {
    const inputSchema = {
      type: 'object',
      anyOf: [
        { type: 'object', properties: { type: { const: 'captures' }, limit: { type: 'number' } }, required: ['type', 'limit'] },
        { type: 'object', properties: { type: { const: 'profile' }, id: { type: 'string' } }, required: ['type', 'id'] },
      ],
    } as const;
    const tool = new ToolDefinition({ name: 'read_performance', description: 'Read evidence.', inputSchema });
    const parametersFor = Effect.fnUntraced(function* (model: Model) {
      const body = yield* protocol.body.from(new LLMRequest({ model, system: [], messages: [], tools: [tool] }));
      const sent = body.tools?.[0];
      if (sent?.type !== 'function') return yield* Effect.die('The tool was not sent as a function.');
      return sent.parameters as Record<string, unknown>;
    });
    const museParameters = yield* parametersFor(yield* museModel());
    const museProperties = museParameters.properties as Record<string, Record<string, unknown>>;
    expect('anyOf' in museParameters).toBe(false);
    expect(museParameters.required).toEqual(['type']);
    for (const name of ['type', 'limit', 'id']) expect(typeof museProperties[name]?.description).toBe('string');
    expect((yield* parametersFor(openAIModel())).anyOf).toHaveLength(2);
  }),
);

describe('Responses vendor wires', () => {
  const web = new ToolDefinition({
    name: 'websearch',
    description: 'The web.',
    inputSchema: { type: 'object', properties: { search_query: { type: 'array' } } },
    vendorWire: { name: 'run', namespace: { name: 'web', description: 'Tools in the web namespace.' } },
  });
  const read = new ToolDefinition({ name: 'read', description: 'Read.', inputSchema: { type: 'object', properties: {} } });
  const history = [
    Message.user('Look it up.'),
    Message.assistant([{ type: 'tool-call' as const, id: 'call-1', name: 'websearch', input: { search_query: [{ q: 'bun' }] } }]),
    Message.tool({ id: 'call-1', name: 'websearch', result: { type: 'text', value: 'found' } }),
  ];
  const bodyOf = (tools: readonly ToolDefinition[]) =>
    protocol.body.from(
      new LLMRequest({ model: route.model({ id: 'gpt-test', provider: 'test-provider' }), system: [], messages: history, tools }),
    );

  it.effect('a declared vendor tool goes out in its namespace, and its call in history is replayed on its wire', () =>
    Effect.gen(function* () {
      const body = yield* bodyOf([read, web]);
      expect(
        body.tools?.map((tool) => (tool.type === 'namespace' ? { [tool.name]: tool.tools.map((member) => member.name) } : tool.name)),
      ).toEqual(['read', { web: ['run'] }]);
      expect(body.input.find((item) => 'type' in item && item.type === 'function_call')).toMatchObject({ name: 'run', namespace: 'web' });
    }),
  );

  it.effect('a call whose vendor tool the request no longer declares is replayed under its own name', () =>
    Effect.gen(function* () {
      const body = yield* bodyOf([read]);
      const replayed = body.input.find((item) => 'type' in item && item.type === 'function_call');
      expect(replayed).toMatchObject({ name: 'websearch' });
      expect(replayed && 'namespace' in replayed ? replayed.namespace : undefined).toBeUndefined();
    }),
  );

  it.effect('a namespaced call is read back under the declared tool name, and an undeclared one keeps its namespace', () =>
    Effect.gen(function* () {
      const call = (namespace: string, name: string) =>
        JSON.stringify({
          type: 'response.output_item.done',
          item: { type: 'function_call', id: `fc-${namespace}`, call_id: `call-${namespace}`, namespace, name, arguments: '{}' },
        });
      const events = yield* Effect.scopedWith((lifetime) =>
        Stream.runCollect(
          stream(
            new LLMRequest({
              model: route.model({ id: 'gpt-test', provider: 'test-provider' }),
              system: [],
              messages: [],
              tools: [web, read],
            }),
            lifetime,
          ),
        ),
      ).pipe(Effect.provide(Layer.effectContext(openModelClient(fetchOf(call('web', 'run'), call('other', 'read'), COMPLETED)))));
      expect(events.filter(LLMEvent.is.toolCall).map((event) => event.name)).toEqual(['websearch', 'other.read']);
    }),
  );

  it.effect('a named choice of a namespaced vendor tool is refused before any request, since the wire cannot name it', () =>
    Effect.gen(function* () {
      const model = route.model({ id: 'gpt-test', provider: 'test-provider' });
      const chosen = (name: string) =>
        Effect.result(
          protocol.body.from(new LLMRequest({ model, system: [], messages: [], tools: [read, web], toolChoice: ToolChoice.named(name) })),
        );
      expect(yield* chosen('read')).toMatchObject({ _tag: 'Success', success: { tool_choice: { type: 'function', name: 'read' } } });
      expect(yield* chosen('websearch')).toMatchObject({ _tag: 'Failure', failure: { reason: { _tag: 'InvalidRequest' } } });
    }),
  );
});

describe('Responses provider refusals', () => {
  it.effect("xAI's code-less capacity refusal is retryable on xAI's own route, and not on the protocol's", () =>
    Effect.gen(function* () {
      const onXai = yield* streamFailure(yield* xaiModel(), CAPACITY_EVENT);
      expect(onXai).toBeInstanceOf(LLMError);
      expect(onXai.reason).toMatchObject({ _tag: 'ProviderInternal', message: XAI_CAPACITY, modelStarted: false });
      expect(onXai.retryable).toBe(true);
      const onOpenAI = yield* streamFailure(openAIModel(), CAPACITY_EVENT);
      expect(onOpenAI).toBeInstanceOf(LLMError);
      expect(onOpenAI.reason).toMatchObject({ _tag: 'UnknownProvider', message: XAI_CAPACITY, modelStarted: false });
      expect(onOpenAI.retryable).toBe(false);
    }),
  );

  for (const code of ['server_error', 'server_is_overloaded']) {
    it.effect(`a transient ${code} refusal is retryable on every route`, () =>
      Effect.gen(function* () {
        for (const model of [openAIModel(), yield* xaiModel()]) {
          const error = yield* streamFailure(model, JSON.stringify({ sequence_number: 0, type: 'error', code, message: 'Try again.' }));
          expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', message: `${code}: Try again.`, modelStarted: false });
          expect(error.retryable).toBe(true);
        }
      }),
    );
  }

  it.effect('a non-transient Responses error keeps its code and stays non-retryable', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(
        yield* xaiModel(),
        JSON.stringify({ sequence_number: 0, type: 'error', code: 'invalid_prompt', message: 'The prompt is invalid.', param: 'input' }),
      );
      expect(error.reason).toMatchObject({
        _tag: 'UnknownProvider',
        message: 'invalid_prompt: The prompt is invalid.',
        modelStarted: false,
      });
      expect(error.retryable).toBe(false);
    }),
  );

  for (const shape of ['flat', 'error', 'response.error'] as const) {
    it.effect(`a ${shape} refusal preserves its cause and retry classification`, () =>
      Effect.gen(function* () {
        for (const [code, retryable] of [
          ['server_error', true],
          ['invalid_prompt', false],
        ] as const) {
          const payload = { code, message: 'The provider explained the failure.' };
          const frame =
            shape === 'flat'
              ? { type: 'error', ...payload }
              : shape === 'error'
                ? { type: 'error', error: payload }
                : { type: 'response.failed', response: { error: payload } };
          const error = yield* streamFailure(openAIModel(), JSON.stringify({ ...frame, sequence_number: 0 }));
          expect(error.reason).toMatchObject({
            _tag: retryable ? 'ProviderInternal' : 'UnknownProvider',
            message: `${code}: The provider explained the failure.`,
            modelStarted: false,
          });
          expect(error.retryable).toBe(retryable);
        }
      }),
    );
  }

  it.effect('a typed nested refusal and a nested context overflow retain their distinct meaning', () =>
    Effect.gen(function* () {
      const refused = yield* streamFailure(
        openAIModel(),
        JSON.stringify({ type: 'error', error: { type: 'usage_limit_reached', message: 'The usage limit has been reached.' } }),
      );
      expect(refused.reason).toMatchObject({ _tag: 'UnknownProvider', message: 'usage_limit_reached: The usage limit has been reached.' });
      expect(refused.retryable).toBe(false);
      const overflow = yield* streamFailure(
        openAIModel(),
        JSON.stringify({ type: 'error', error: { code: 'context_length_exceeded', message: 'The context is full.' } }),
      );
      expect(overflow.reason).toMatchObject({ _tag: 'InvalidRequest', classification: 'context-overflow' });
    }),
  );

  it.effect('a genuinely empty refusal is a retryable blank error, not an unknown payload', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(
        openAIModel(),
        JSON.stringify({ type: 'error', sequence_number: 0, code: null, message: null, error: null }),
      );
      expect(error.family).toBe('blank-error');
      expect(error.retryable).toBe(true);
      expect(JSON.parse(error.detail ?? '')).toMatchObject({ kind: 'blank-error', eventType: 'error' });
    }),
  );

  it.effect('an unreadable nested refusal keeps structural evidence instead of claiming the provider said nothing', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(
        openAIModel(),
        JSON.stringify({
          type: 'error',
          sequence_number: 0,
          error: { explanation: 'sensitive provider payload', credential: 'secret-token' },
        }),
      );
      expect(error.family).toBe('invalid-output');
      expect(error.retryable).toBe(false);
      expect(JSON.parse(error.detail ?? '')).toEqual({
        kind: 'unrecognized-error',
        eventType: 'error',
        keys: ['error', 'sequence_number', 'type'],
        payloadKeys: ['credential', 'explanation'],
      });
    }),
  );

  it.effect('a refusal may explain the failure without exposing a credential the request sent', () =>
    Effect.gen(function* () {
      const model = ordinary.with({ headers: { authorization: 'Bearer request-secret-value' } }).model({ id: 'gpt-test' });
      const error = yield* streamFailure(
        model,
        JSON.stringify({ type: 'error', error: { code: 'server_error', message: 'Rejected request-secret-value; api_key=other-secret' } }),
      );
      expect(error.reason.message).toBe('server_error: Rejected <redacted>; api_key=<redacted>');
      expect(error.retryable).toBe(true);
    }),
  );

  it.effect('a refusal after model output records that execution had begun', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(
        openAIModel(),
        JSON.stringify({ type: 'response.output_item.added', item: { id: 'msg-1', type: 'message', role: 'assistant', content: [] } }),
        JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg-1', delta: 'Hel' }),
        JSON.stringify({
          type: 'response.failed',
          response: { id: 'response-1', error: { code: 'server_error', message: 'Lost the model.' } },
        }),
      );
      expect(error.reason).toMatchObject({ _tag: 'ProviderInternal', modelStarted: true });
      expect(error.retryable).toBe(true);
    }),
  );

  it.effect('the xAI response.done event closes the public stream as a successful finish', () =>
    Effect.gen(function* () {
      const events = yield* streamEffect(
        yield* xaiModel(),
        JSON.stringify({
          type: 'response.done',
          response: { id: 'response-1', service_tier: null, incomplete_details: null, usage: null },
        }),
      );
      expect(Array.from(events).map((event) => event.type)).toEqual(['step-start', 'step-finish', 'finish']);
    }),
  );

  it.effect('an event type the protocol does not handle is ignored and the stream finishes normally', () =>
    Effect.gen(function* () {
      const events = yield* streamEffect(
        openAIModel(),
        JSON.stringify({ type: 'response.future.delta', payload: 'whatever a future provider sends' }),
        COMPLETED,
      );
      expect(Array.from(events).find(LLMEvent.is.finish)?.reason).toBe('stop');
    }),
  );
});

describe('Responses invalid-event diagnostics', () => {
  it.effect('a schema-invalid event names its type, keys and failing field without retaining values', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(
        openAIModel(),
        JSON.stringify({
          sequence_number: 0,
          type: 'error',
          code: 503,
          message: 'sensitive provider payload',
          param: null,
          credential: 'secret-token',
        }),
      );
      expect(error.reason._tag).toBe('InvalidProviderOutput');
      expect(JSON.parse(error.detail ?? '')).toEqual({
        kind: 'schema-invalid',
        eventType: 'error',
        keys: ['code', 'credential', 'message', 'param', 'sequence_number', 'type'],
        issue: { path: ['code'], reason: 'AnyOf' },
      });
    }),
  );
  it.effect('malformed JSON is distinguished without retaining its bytes', () =>
    Effect.gen(function* () {
      const error = yield* streamFailure(openAIModel(), '{"type":"error","message":"sensitive provider payload"');
      expect(error.reason._tag).toBe('InvalidProviderOutput');
      expect(JSON.parse(error.detail ?? '')).toEqual({
        kind: 'malformed-json',
        eventType: null,
        keys: [],
        issue: { path: [], reason: 'InvalidJson' },
      });
    }),
  );
});
