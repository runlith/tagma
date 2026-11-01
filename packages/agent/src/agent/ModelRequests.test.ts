import { openModelClient } from '@runlith/llm/models/client';
import { it } from '@runlith/effect-test';
import { describe, expect, test } from 'bun:test';
import { Effect, Fiber, Schema, Stream } from 'effect';
import { activity } from '@runlith/activity/Activity';
import { activityKind } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { answering } from '@runlith/llm/route/transport/answering';
import { modelCatalog } from '@runlith/llm/models/catalog';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { recordedRegistrations } from '@runlith/builtin-catalog/registrations';
import { Message } from '@runlith/llm/schema/messages';
import { LLMResponse, Usage } from '@runlith/llm/schema/events';
import type { VendorWebCall, WebTool } from '@runlith/llm/profiles/vendorWeb';
import type { HttpExecutor } from '@runlith/llm/route/executor';
import { Tool } from './tool';
import { modelRequester, wireToolDefinitions } from './ModelRequests';
import type { ToolCatalog } from './ToolCatalog';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';
describe('a picture sent to a row that takes no images', () => {
  const credentials: ModelCredentials = {
    apiKey: async () => 'test-key',
    accessToken: async () => 'test-token',
    credential: async () => ({
      accessToken: 'token',
      refreshToken: 'test-identity',
      expiresAt: 0,
      scope: '',
      account: { uuid: 'test-account', email: 'test@example.com' },
      organization: { uuid: 'organization-uuid', name: '' },
      accountId: undefined,
    }),
  };
  const PIXEL = `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`;
  const STOPPED = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'seen' }, finish_reason: 'stop' }],
  });
  const history = [
    Message.user([
      { type: 'text', text: 'look' },
      { type: 'media', mediaType: 'image/png', data: PIXEL, filename: 'pasted.png' },
    ]),
    Message.assistant([{ type: 'tool-call', id: 'call-1', name: 'read', input: { path: 'screen.png' } }]),
    Message.tool({
      id: 'call-1',
      name: 'read',
      result: {
        type: 'content',
        value: [
          { type: 'text', text: 'screen.png' },
          { type: 'file', uri: PIXEL, mime: 'image/png', name: 'screen.png' },
        ],
      },
    }),
  ];
  const sent = Effect.fnUntraced(function* (model: string) {
    const bodies: string[] = [];
    const fetch = answering((request) => {
      bodies.push(request.text);
      return new Response(`data: ${STOPPED}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    });
    const request = modelRequester(modelCatalog([recordedRegistrations.stepfun]), credentials, yield* openModelClient(fetch)).request({
      ownerId: 'owner',
      provider: recordedRegistrations.stepfun.id,
      model,
    });
    yield* request.text({ messages: history });
    return bodies[0] ?? '';
  });
  it.live(
    'reaches a seeing row as images and a blind row as words, every picture of the history alike',
    Effect.fnUntraced(function* () {
      const seeing = yield* sent('step-5-preview');
      const blind = yield* sent('step-3.5-flash');
      expect(seeing.match(/"type":"image_url"/g)?.length).toBe(2);
      expect(blind).not.toContain('image_url');
      expect(blind).toContain('pasted.png');
    }),
  );
});
describe('the stall window a request carries', () => {
  const credentials: ModelCredentials = {
    apiKey: async () => 'test-key',
    accessToken: async () => 'test-token',
    credential: async () => ({
      accessToken: 'token',
      refreshToken: 'test-identity',
      expiresAt: 0,
      scope: '',
      account: { uuid: 'test-account', email: 'test@example.com' },
      organization: { uuid: 'organization-uuid', name: '' },
      accountId: undefined,
    }),
  };
  const WINDOW_MS = 60;
  const silent = Effect.fnUntraced(function* (stallMs?: number) {
    const fetch = answering(
      () =>
        new Response(new ReadableStream<Uint8Array>({ start: () => {} }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    return modelRequester(modelCatalog([recordedRegistrations.stepfun]), credentials, yield* openModelClient(fetch))
      .request({
        ownerId: 'owner',
        provider: recordedRegistrations.stepfun.id,
        model: 'step-5-preview',
        stallMs: stallMs,
      })
      .text({ messages: [Message.user('summarize')] });
  });
  it.live(
    'a call that states none of its own is cut by the window its request carries',
    Effect.fnUntraced(function* () {
      const calling = yield* silent(WINDOW_MS);
      expect(yield* Effect.flip(calling)).toMatchObject({ reason: { _tag: 'StreamStalled', idleMs: WINDOW_MS } });
    }),
  );
  it.live(
    'a request carrying no window leaves a silent call standing',
    Effect.fnUntraced(function* () {
      const calling = yield* silent();
      expect((yield* calling.pipe(Effect.timeoutOption(WINDOW_MS * 4)))._tag).toBe('None');
    }),
  );
});
describe('the model-call a request records', () => {
  const credentials: ModelCredentials = {
    apiKey: async () => 'test-key',
    accessToken: async () => 'test-token',
    credential: async () => ({
      accessToken: 'token',
      refreshToken: 'test-identity',
      expiresAt: 0,
      scope: '',
      account: { uuid: 'test-account', email: 'test@example.com' },
      organization: { uuid: 'organization-uuid', name: '' },
      accountId: undefined,
    }),
  };
  const ASKING = activityKind<{
    readonly purpose: string;
  }>('asking');
  const STOPPED = JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'named' }, finish_reason: 'stop' }],
  });
  const streamed = Effect.fnUntraced(function* (status: number) {
    const recording = activityRecording();
    const wire: string[] = [];
    const fetch = answering((sent) =>
      (wire.push(sent.text), status === 200)
        ? new Response(`data: ${STOPPED}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
        : new Response('{"error":{"message":"broken"}}', { status, headers: { 'content-type': 'application/json' } }),
    );
    const request = modelRequester(modelCatalog([recordedRegistrations.stepfun]), credentials, yield* openModelClient(fetch)).request({
      ownerId: 'owner',
      provider: recordedRegistrations.stepfun.id,
      model: 'step-5-preview',
    });
    const call = request.stream({ messages: [Message.user('name it')], tools: {} });
    yield* activity(ASKING, { purpose: 'title' }, Effect.exit(Stream.runDrain(call)), { thread: 'thread-1' }).pipe(
      Effect.provideService(ActivityLog, recording.log),
    );
    const [asking, modelCall] = recording.activities();
    const recorded = recording.facts.flatMap((fact) =>
      fact._tag === 'Bodied' && fact.body.kind === 'request' && 'encoded' in fact.body ? [new TextDecoder().decode(fact.body.encoded)] : [],
    );
    return { asking: asking!, modelCall: modelCall!, wire, recorded };
  });
  it.live(
    'an answered stream is a model-call child of the activity it ran in, with the request that went on the wire and its answer',
    Effect.fnUntraced(function* () {
      const { asking, modelCall, wire, recorded } = yield* streamed(200);
      expect(modelCall.opened).toMatchObject({
        kind: 'model-call',
        parent: asking.opened.id,
        thread: 'thread-1',
        attrs: { provider: recordedRegistrations.stepfun.id, model: 'step-5-preview' },
      });
      expect(modelCall.bodies).toEqual(['request', 'response']);
      expect(recorded).toEqual(wire);
      expect(modelCall.ended).toMatchObject({ outcome: 'ok', result: { finish: 'stop' } });
    }),
  );
  it.live(
    'a provider failure ends the model-call failed with the failure reason',
    Effect.fnUntraced(function* () {
      const { modelCall } = yield* streamed(400);
      expect(modelCall.bodies).toEqual(['request']);
      expect(modelCall.ended).toMatchObject({ outcome: 'failed', reason: expect.any(String) });
    }),
  );
  it.live(
    'a model the catalog cannot resolve still leaves a model-call, refused, naming what was asked',
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const request = modelRequester(
        modelCatalog([recordedRegistrations.stepfun]),
        credentials,
        yield* openModelClient(answering(() => new Response('{}'))),
      ).request({
        ownerId: 'owner',
        provider: 'nobody',
        model: 'nothing',
      });
      yield* Effect.exit(Stream.runDrain(request.stream({ messages: [Message.user('x')], tools: {} }))).pipe(
        Effect.provideService(ActivityLog, recording.log),
      );
      const [refused] = recording.activities();
      expect(refused?.opened).toMatchObject({ kind: 'model-call', attrs: { provider: 'nobody', model: 'nothing' } });
      expect(refused?.ended).toMatchObject({ outcome: 'refused' });
    }),
  );
});
describe('wireToolDefinitions', () => {
  const catalog = (...names: readonly string[]): ToolCatalog =>
    Object.fromEntries(
      names.map((name) => [
        name,
        Tool.make({
          display: () => ({ form: 'none' }),
          approval: ASKS_NEVER,
          description: `does ${name}`,
          parameters: Schema.Struct({}),
          execute: () => Effect.succeed('done'),
        }),
      ]),
    );
  const named = (
    definitions: readonly {
      name: string;
    }[],
  ) => definitions.map((definition) => definition.name);
  test('a selection sends what it named, and the whole set is not a name a selection can spell', () => {
    const tools = catalog('all', 'safe');
    expect(named(wireToolDefinitions(tools, undefined))).toEqual(['all', 'safe']);
    expect(named(wireToolDefinitions(tools, ['', 'all']))).toEqual(['all']);
    expect(named(wireToolDefinitions(tools, ['all']))).toEqual(['all']);
    expect(named(wireToolDefinitions(tools, ['safe']))).toEqual(['safe']);
    expect(named(wireToolDefinitions(tools, []))).toEqual([]);
    expect(named(wireToolDefinitions(tools, undefined))).toEqual(['all', 'safe']);
  });
  test('two selections that differ only in where their names divide are two selections', () => {
    const tools = catalog('a:b', 'a', 'b', 'c');
    expect(named(wireToolDefinitions(tools, ['a:b']))).toEqual(['a:b']);
    expect(named(wireToolDefinitions(tools, ['a', 'b']))).toEqual(['a', 'b']);
    expect(named(wireToolDefinitions(tools, ['3:a:b']))).toEqual([]);
  });
  test('a deferred tool crosses as a definition marked deferred, and a direct one carries no mark', () => {
    const tools: ToolCatalog = {
      ...catalog('read'),
      mcp__files__search: Tool.make({
        display: () => ({ form: 'none' }),
        approval: ASKS_NEVER,
        description: 'Search the files.',
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed('found'),
        exposure: 'deferred',
      }),
    };
    const [read, search] = wireToolDefinitions(tools, undefined);
    expect(read?.deferred).toBeUndefined();
    expect(search?.deferred).toBe(true);
    expect(wireToolDefinitions(tools, ['mcp__files__search'])[0]?.deferred).toBe(true);
  });
  test('the same selection is answered with the same objects, so a reader may hold them', () => {
    const tools = catalog('read', 'write');
    expect(wireToolDefinitions(tools, undefined)).toBe(wireToolDefinitions(tools, undefined));
    const selected = wireToolDefinitions(tools, ['read']);
    wireToolDefinitions(tools, undefined);
    expect(wireToolDefinitions(tools, ['read'])).toBe(selected);
    expect(wireToolDefinitions(catalog('read', 'write'), undefined)).not.toBe(wireToolDefinitions(tools, undefined));
  });
});
const ASKING = activityKind<{
  readonly purpose: string;
}>('asking');
describe('the web a subscription brings', () => {
  const credentials: ModelCredentials = {
    apiKey: async () => 'test-key',
    accessToken: async () => 'test-token',
    credential: async () => ({}),
  };
  const errand: WebTool<VendorWebCall, HttpExecutor> = {
    wire: { vendor: { name: 'web_search' }, description: 'Searches the web.', inputSchema: { type: 'object' } },
    input: Schema.Unknown,
    reads: () => false,
    targets: () => ({ queries: [], pages: [] }),
    run: (_input, call) =>
      call.measure(
        'claude-sonnet-5-5',
        Effect.succeed({
          value: 'found it',
          response: new LLMResponse({
            message: Message.assistant('found it'),
            events: [],
            usage: new Usage({ inputTokens: 11, outputTokens: 5, totalTokens: 16 }),
            finishReason: 'stop',
          }),
        }),
      ),
  };
  const subscription = recordedRegistrations.subscription;
  const searching = {
    ...subscription,
    profile: { ...subscription.profile, web: () => Effect.succeed({ tools: { websearch: errand } }) },
  };
  it.live(
    'an errand it runs is a model-call of the activity it ran in, with the tokens it spent',
    Effect.fnUntraced(function* () {
      const recording = activityRecording();
      const fetch = answering(() => new Response('no request leaves this errand', { status: 599 }));
      const request = modelRequester(modelCatalog([searching]), credentials, yield* openModelClient(fetch)).request({
        ownerId: 'owner',
        provider: searching.id,
        model: 'claude-sonnet-5-5',
      });
      if (request.web === undefined) return yield* Effect.die(new Error('The subscription offers no web of its own.'));
      const asked = Effect.flatMap(request.web, (web) => {
        const search = web.lifetimes === undefined ? web.tools.websearch : undefined;
        if (search === undefined) throw new Error('The subscription offers no search of its own.');
        return search.run({ query: 'bun release' }, { messages: [] });
      });
      yield* activity(ASKING, { purpose: 'search' }, Effect.exit(asked), { thread: 'thread-1' }).pipe(
        Effect.provideService(ActivityLog, recording.log),
      );
      const [asking, modelCall] = recording.activities();
      expect(modelCall?.opened).toMatchObject({ kind: 'model-call', parent: asking?.opened.id, attrs: { model: 'claude-sonnet-5-5' } });
      expect(modelCall?.ended).toMatchObject({ outcome: 'ok', result: { usage: { inputTokens: 11, outputTokens: 5 } } });
    }),
  );
});
