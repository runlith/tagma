import { it } from '@runlith/effect-test';
import { describe, expect } from 'bun:test';
import { Effect, Layer, Schema, Stream } from 'effect';
import { openModelClient } from '@runlith/llm/models/client';
import { subscriptionRegistration } from '../subscription/provider';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { LLMError } from '@runlith/llm/schema/errors';
import { LLMEvent } from '@runlith/llm/schema/events';
import { LLMRequest, Message, ToolDefinition, ToolResultPart } from '@runlith/llm/schema/messages';
import { Model } from '@runlith/llm/schema/options';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import { protocol, route } from '@runlith/llm/protocols/anthropic-messages';
import { answering } from '@runlith/llm/route/transport/answering';
import { prepare, stream } from '@runlith/llm/route/client';

const model = Model.make({ id: 'claude-test', provider: 'anthropic', route });
const emptyRequest = new LLMRequest({ model, system: [], messages: [], tools: [] });
const stepThrough = Effect.fnUntraced(function* (upstream: ReadonlyArray<unknown>) {
  let state = protocol.stream.initial(emptyRequest);
  const events: LLMEvent[] = [];
  for (const raw of upstream) {
    const frame = yield* Schema.decodeUnknownEffect(AnthropicMessages.AnthropicEvent)(raw);
    const [next, produced] = yield* protocol.stream.step(state, frame);
    state = next;
    events.push(...produced);
  }
  return events;
});

describe('Anthropic native system groups', () => {
  it.effect('system placement follows surviving wire turns and preserves chronological updates', () =>
    Effect.gen(function* () {
      const update = new Message({
        role: 'system',
        content: [{ type: 'text', text: 'history-update' }],
        native: { anthropic: { system: true } },
      });
      for (const content of [[], [{ type: 'reasoning' as const, text: 'unsigned' }]]) {
        const body = yield* protocol.body.from(
          new LLMRequest({
            model,
            system: [],
            tools: [],
            messages: [Message.user('first'), update, update, new Message({ role: 'assistant', content }), Message.user('second')],
          }),
        );
        expect(body.messages.map((message) => message.role)).toEqual(['user', 'user']);
        const first = body.messages[0];
        expect(first?.role).toBe('user');
        if (first?.role === 'user' && typeof first.content !== 'string')
          expect(first.content.map((part) => (part.type === 'text' ? part.text : part.type))).toEqual([
            'first',
            '<system-update>\nhistory-update\n</system-update>',
            '<system-update>\nhistory-update\n</system-update>',
          ]);
      }
      const body = yield* protocol.body.from(
        new LLMRequest({
          model,
          system: [],
          tools: [],
          messages: [
            Message.user('first'),
            new Message({ role: 'assistant', content: [] }),
            update,
            new Message({ role: 'assistant', content: [{ type: 'reasoning', text: 'signed', encrypted: 'signature' }] }),
          ],
        }),
      );
      expect(body.messages.map((message) => message.role)).toEqual(['user', 'system', 'assistant']);
      expect(body.messages[1]?.content).toEqual([{ type: 'text', text: 'history-update', cache_control: undefined }]);
      expect(body.messages[2]?.content).toEqual([{ type: 'thinking', thinking: 'signed', signature: 'signature' }]);
    }),
  );

  it.effect('directive-only output config survives anywhere, including an outstanding local tool batch', () =>
    Effect.gen(function* () {
      const directive = new Message({
        role: 'system',
        content: [],
        native: { anthropic: { system: true, format: 'string', outputConfig: { effort: 'high' } } },
      });
      const body = yield* protocol.body.from(
        new LLMRequest({
          model,
          system: [],
          tools: [],
          messages: [
            directive,
            Message.user('first'),
            Message.assistant([{ type: 'tool-call', id: 'call', name: 'read', input: {} }]),
            directive,
            Message.tool(ToolResultPart.from({ id: 'call', name: 'read', result: 'result' })),
            directive,
            Message.user('second'),
          ],
        }),
      );
      expect(body.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'system', 'user', 'system', 'user']);
      expect(body.messages.filter((message) => message.role === 'system')).toEqual([
        { role: 'system', content: [], output_config: { effort: 'high' } },
        { role: 'system', content: [], output_config: { effort: 'high' } },
        { role: 'system', content: [], output_config: { effort: 'high' } },
      ]);
    }),
  );

  it.effect('wrapping misplaced native text retains its output effort as a directive', () =>
    Effect.gen(function* () {
      const body = yield* protocol.body.from(
        new LLMRequest({
          model,
          system: [],
          tools: [],
          messages: [
            Message.user('first'),
            new Message({
              role: 'system',
              content: [{ type: 'text', text: 'history-update' }],
              native: { anthropic: { system: true, outputConfig: { effort: 'high' } } },
            }),
            Message.user('second'),
          ],
        }),
      );
      expect(body.messages.map((message) => message.role)).toEqual(['user', 'system', 'user']);
      expect(body.messages[1]).toEqual({ role: 'system', content: [], output_config: { effort: 'high' } });
      const content = body.messages[0]?.content;
      expect(Array.isArray(content) && content.at(-1)).toMatchObject({
        type: 'text',
        text: '<system-update>\nhistory-update\n</system-update>',
      });
    }),
  );

  it.effect('text updates wait for the entire local tool batch while settled updates remain native', () =>
    Effect.gen(function* () {
      const update = new Message({
        role: 'system',
        content: [{ type: 'text', text: 'history-update' }],
        native: { anthropic: { system: true } },
      });
      const request = new LLMRequest({
        model,
        system: [],
        tools: [],
        messages: [
          Message.user('first'),
          Message.assistant([
            { type: 'tool-call', id: 'first', name: 'read', input: {} },
            { type: 'tool-call', id: 'second', name: 'read', input: {} },
          ]),
          Message.tool(ToolResultPart.from({ id: 'first', name: 'read', result: 'first-result' })),
          update,
        ],
      });
      const failure = yield* Effect.flip(protocol.body.from(request));
      expect(failure.reason).toMatchObject({ _tag: 'InvalidRequest' });
      const body = yield* protocol.body.from(
        LLMRequest.update(request, {
          messages: [
            ...request.messages.slice(0, -1),
            Message.tool(ToolResultPart.from({ id: 'second', name: 'read', result: 'second-result' })),
            update,
          ],
        }),
      );
      expect(body.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'user', 'system']);
      expect(body.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'history-update', cache_control: undefined }]);
    }),
  );

  it.effect('adjacent marked updates retain their wire lifetime and string format', () =>
    Effect.gen(function* () {
      const request = new LLMRequest({
        model,
        system: [],
        tools: [],
        messages: [
          Message.user('Continue.'),
          new Message({ role: 'system', content: [{ type: 'text', text: 'History update.' }], native: { anthropic: { system: true } } }),
          new Message({
            role: 'system',
            content: [{ type: 'text', text: 'Temporary instruction.' }],
            native: { anthropic: { system: true, format: 'string', clearAt: 'next_user_message' } },
          }),
        ],
      });
      const body = yield* protocol.body.from(request);
      expect(body.messages.map((message) => message.role)).toEqual(['user', 'system', 'system']);
      expect(body.messages[2]).toEqual({ role: 'system', content: 'Temporary instruction.', clear_at: 'next_user_message' });
      const invalid = LLMRequest.update(request, {
        messages: [
          Message.user('Continue.'),
          new Message({
            role: 'system',
            content: [{ type: 'text', text: 'Temporary instruction.' }],
            native: { anthropic: { system: true, clearAt: 'now' } },
          }),
        ],
      });
      const failed = yield* Effect.flip(protocol.body.from(invalid));
      expect(failed).toBeInstanceOf(LLMError);
      expect(failed.reason).toMatchObject({ _tag: 'InvalidRequest', message: 'Anthropic native system clearAt must be next_user_message' });
    }),
  );
});

describe('Anthropic tool input schemas', () => {
  it.effect('projects a root object union without changing the canonical tool definition', () =>
    Effect.gen(function* () {
      const inputSchema = {
        $defs: { Cursor: { type: 'object', properties: { after: { type: 'string' } }, required: ['after'], additionalProperties: false } },
        type: 'object',
        anyOf: [
          {
            type: 'object',
            properties: { type: { const: 'stalls' }, limit: { type: 'number' }, cursor: { $ref: '#/$defs/Cursor' } },
            required: ['type', 'limit'],
            additionalProperties: false,
          },
          {
            type: 'object',
            properties: {
              type: { const: 'profile' },
              id: { type: 'string' },
              cursor: { anyOf: [{ $ref: '#/$defs/Cursor' }, { type: 'null' }] },
            },
            required: ['type', 'id'],
            additionalProperties: false,
          },
        ],
      } as const;
      const request = new LLMRequest({
        model,
        system: [],
        messages: [],
        tools: [new ToolDefinition({ name: 'read_performance', description: 'Read process evidence.', inputSchema })],
      });
      const body = yield* protocol.body.from(request);
      const { properties, ...root } = body.tools?.[0]?.input_schema as unknown as {
        readonly properties: Record<string, { readonly description?: string }>;
      };
      expect(root).toEqual({ $defs: inputSchema.$defs, type: 'object', required: ['type'], additionalProperties: false });
      expect(Object.fromEntries(Object.entries(properties).map(([name, { description: _described, ...shape }]) => [name, shape]))).toEqual({
        type: { enum: ['stalls', 'profile'] },
        limit: { type: 'number' },
        cursor: { anyOf: [{ $ref: '#/$defs/Cursor' }, { anyOf: [{ $ref: '#/$defs/Cursor' }, { type: 'null' }] }] },
        id: { type: 'string' },
      });
      expect(inputSchema).toHaveProperty('anyOf');
      expect(inputSchema.anyOf).toHaveLength(2);
    }),
  );

  it.effect('publishes a runtime number as the finite JSON value the tool decoder accepts', () =>
    Effect.gen(function* () {
      const inputSchema = {
        $defs: { NonFiniteNumber: { type: 'string', enum: ['Infinity', '-Infinity', 'NaN'] } },
        type: 'object',
        properties: {
          requestedDurationMs: {
            anyOf: [
              { type: 'number', allOf: [{ exclusiveMinimum: 0 }] },
              { type: 'string', enum: ['Infinity', '-Infinity', 'NaN'] },
            ],
          },
          monotonicStart: { anyOf: [{ type: 'number' }, { $ref: '#/$defs/NonFiniteNumber' }] },
        },
        required: ['requestedDurationMs', 'monotonicStart'],
        additionalProperties: false,
      } as const;
      const body = yield* protocol.body.from(
        new LLMRequest({
          model,
          system: [],
          messages: [],
          tools: [new ToolDefinition({ name: 'capture', description: 'Capture.', inputSchema })],
        }),
      );
      const properties = body.tools?.[0]?.input_schema.properties as Record<string, unknown> | undefined;
      expect(properties?.['requestedDurationMs']).toEqual({ type: 'number', allOf: [{ exclusiveMinimum: 0 }] });
      expect(properties?.['monotonicStart']).toEqual({ type: 'number' });
    }),
  );
});

describe('Anthropic input usage', () => {
  it.effect('the measured prompt leaves at message_start, cache counted once', () =>
    Effect.gen(function* () {
      const events = yield* stepThrough([
        {
          type: 'message_start',
          message: { usage: { input_tokens: 120, cache_read_input_tokens: 4_000, cache_creation_input_tokens: 80 } },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
      ]);
      const measured = events.filter(LLMEvent.is.inputUsage);
      expect(measured).toHaveLength(1);
      const usage = measured[0]!.inputUsage;
      expect(usage.inputTokens).toBe(4_200);
      expect(usage.nonCachedInputTokens).toBe(120);
      expect(usage.cacheReadInputTokens).toBe(4_000);
      expect(usage.cacheWriteInputTokens).toBe(80);
      expect(events.findIndex(LLMEvent.is.inputUsage)).toBeLessThan(events.findIndex((event) => event.type === 'text-delta'));
    }),
  );

  it.effect('a start frame that names no usage says nothing', () =>
    Effect.gen(function* () {
      expect((yield* stepThrough([{ type: 'message_start', message: {} }])).filter(LLMEvent.is.inputUsage)).toHaveLength(0);
    }),
  );

  it.effect('a multi-iteration turn is billed at the executor, not at the sum', () =>
    Effect.gen(function* () {
      const events = yield* stepThrough([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: {
            input_tokens: 132_000,
            output_tokens: 900,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens_details: { thinking_tokens: 640 },
            iterations: [
              { type: 'compaction', input_tokens: 130_000, output_tokens: 850 },
              { type: 'message', input_tokens: 2_000, output_tokens: 50, cache_read_input_tokens: 1_200, cache_creation_input_tokens: 60 },
            ],
          },
        },
      ]);
      const usage = events.find(LLMEvent.is.finish)?.usage;
      expect(usage?.nonCachedInputTokens).toBe(2_000);
      expect(usage?.cacheReadInputTokens).toBe(1_200);
      expect(usage?.cacheWriteInputTokens).toBe(60);
      expect(usage?.inputTokens).toBe(3_260);
      expect(usage?.outputTokens).toBe(50);
      expect(usage?.reasoningTokens).toBe(640);
    }),
  );

  it.effect('a thinking block with no text still carries its signature out', () =>
    Effect.gen(function* () {
      const events = yield* stepThrough([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '', estimated_tokens: 100 } },
        { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
        { type: 'content_block_stop', index: 0 },
      ]);
      const ended = events.find((event) => event.type === 'reasoning-end');
      expect(ended).toBeDefined();
      expect(JSON.stringify(ended)).toContain('sig-abc');
    }),
  );

  it.effect('a single-iteration turn reports what it reported', () =>
    Effect.gen(function* () {
      const events = yield* stepThrough([
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { input_tokens: 1_212, output_tokens: 30, iterations: [{ type: 'message', input_tokens: 1_212, output_tokens: 30 }] },
        },
      ]);
      const usage = events.find(LLMEvent.is.finish)?.usage;
      expect(usage?.nonCachedInputTokens).toBe(1_212);
      expect(usage?.outputTokens).toBe(30);
    }),
  );
});

it.effect('a large fragmented tool input arrives as one parsed call', () =>
  Effect.gen(function* () {
    const value = 'x'.repeat(200 * 1024);
    const fragmentCount = 1_998;
    const fragmentSize = Math.ceil(value.length / fragmentCount);
    const fragments = Array.from({ length: fragmentCount }, (_, index) => value.slice(index * fragmentSize, (index + 1) * fragmentSize));
    const events = yield* stepThrough([
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: 'write' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":"' } },
      ...fragments.map((partial_json) => ({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json } })),
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"}' } },
      { type: 'content_block_stop', index: 0 },
    ]);
    expect(events.find(LLMEvent.is.toolCall)).toEqual(LLMEvent.toolCall({ id: 'call-1', name: 'write', input: { text: value } }));
  }),
);

describe('a tool input the output limit cut', () => {
  const opened = [
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-1', name: 'send_message' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"to":["lead"],"message":"Fin' } },
  ];
  const limited = { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 32_000 } };
  for (const [name, frames] of [
    ['closed by its block stop', [...opened, { type: 'content_block_stop', index: 0 }, limited]],
    ['left open at the finish', [...opened, limited]],
  ] as const) {
    it.effect(`arrives as a call carrying its unparsed text before the length finish, ${name}`, () =>
      Effect.gen(function* () {
        const events = yield* stepThrough(frames);
        expect(events.filter(LLMEvent.is.toolCall)).toEqual([
          LLMEvent.toolCall({ id: 'call-1', name: 'send_message', input: {}, unparsed: '{"to":["lead"],"message":"Fin' }),
        ]);
        expect(events.find(LLMEvent.is.finish)?.reason).toBe('length');
      }),
    );
  }
});

describe('Anthropic response identity', () => {
  it.effect('the start frame names the response id beside its usage', () =>
    Effect.gen(function* () {
      const frame = yield* Schema.decodeUnknownEffect(AnthropicMessages.AnthropicEvent)({
        type: 'message_start',
        message: { id: 'msg_x', usage: { input_tokens: 10 } },
      });
      const [state, events] = yield* protocol.stream.step(protocol.stream.initial(emptyRequest), frame);
      expect(state.messageId).toBe('msg_x');
      expect(events.find(LLMEvent.is.inputUsage)?.messageId).toBe('msg_x');
    }),
  );
  it.effect('an id without usage is still captured, emitting nothing', () =>
    Effect.gen(function* () {
      const frame = yield* Schema.decodeUnknownEffect(AnthropicMessages.AnthropicEvent)({
        type: 'message_start',
        message: { id: 'msg_y' },
      });
      const [state, events] = yield* protocol.stream.step(protocol.stream.initial(emptyRequest), frame);
      expect(state.messageId).toBe('msg_y');
      expect(events).toEqual([]);
    }),
  );
  it.effect('a start frame naming nothing leaves no id behind', () =>
    Effect.gen(function* () {
      const frame = yield* Schema.decodeUnknownEffect(AnthropicMessages.AnthropicEvent)({
        type: 'message_start',
        message: { usage: { input_tokens: 10 } },
      });
      const [state] = yield* protocol.stream.step(protocol.stream.initial(emptyRequest), frame);
      expect(state.messageId).toBeUndefined();
    }),
  );
});

describe('Anthropic thread chaining', () => {
  const request = (thread?: unknown, diagnostics?: unknown) =>
    new LLMRequest({ model, system: [], messages: [], tools: [], providerOptions: { anthropic: { thread, diagnostics } } });
  it.effect('a continue with its anchor and diagnostics lowers verbatim, absent stays absent', () =>
    Effect.gen(function* () {
      const body = yield* protocol.body.from(request({ type: 'continue', previous_message_id: 'msg_x' }, { previous_message_id: 'msg_x' }));
      expect(body.thread).toEqual({ type: 'continue', previous_message_id: 'msg_x' });
      expect(body.diagnostics).toEqual({ previous_message_id: 'msg_x' });
      const bare = JSON.parse(JSON.stringify(yield* protocol.body.from(request())));
      expect('thread' in bare).toBe(false);
      expect('diagnostics' in bare).toBe(false);
      const first = yield* protocol.body.from(request({ type: 'create' }, { previous_message_id: null }));
      expect(first.thread).toEqual({ type: 'create' });
      expect(first.diagnostics).toEqual({ previous_message_id: null });
    }),
  );
  it.effect('a continue without its anchor refuses naming the field', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(protocol.body.from(request({ type: 'continue' }, { previous_message_id: 'msg_x' })));
      expect(failure.reason._tag).toBe('InvalidRequest');
      expect(failure.reason.message).toContain('thread');
    }),
  );
  it.effect('an http overlay cannot stomp the thread chaining keys', () =>
    Effect.gen(function* () {
      const overlay = new LLMRequest({ model, system: [], messages: [], tools: [], http: { body: { thread: { type: 'create' } } } });
      const failure = yield* Effect.flip(prepare(overlay));
      expect(failure.reason._tag).toBe('InvalidRequest');
      expect(failure.reason.message).toContain('thread');
    }),
  );
});

describe('Anthropic errand shapes', () => {
  const errand = (options: Record<string, unknown>) =>
    new LLMRequest({ model, system: [], messages: [], tools: [], providerOptions: { anthropic: options } });
  it.effect('a format output config and disabled thinking lower verbatim', () =>
    Effect.gen(function* () {
      const body = yield* protocol.body.from(
        errand({ thinking: { type: 'disabled' }, outputConfig: { format: { type: 'json_schema', schema: { type: 'object' } } } }),
      );
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
    }),
  );
  it.effect('effort and format together refuse as a pair no client sends', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(protocol.body.from(errand({ outputConfig: { effort: 'high', format: {} } })));
      expect(failure.reason._tag).toBe('InvalidRequest');
      expect(failure.reason.message).toContain('never both');
    }),
  );
  it.effect('an explicit empty tool list survives only where asked', () =>
    Effect.gen(function* () {
      expect((yield* protocol.body.from(errand({ preserveEmptyTools: true }))).tools).toEqual([]);
      const bare = JSON.parse(JSON.stringify(yield* protocol.body.from(errand({}))));
      expect('tools' in bare).toBe(false);
    }),
  );
});

describe('Anthropic failover lowering', () => {
  const request = (fallbacks?: unknown) =>
    new LLMRequest({ model, system: [], messages: [], tools: [], providerOptions: { anthropic: { fallbacks } } });
  it.effect('a declared failover lowers verbatim, an undeclared one stays absent', () =>
    Effect.gen(function* () {
      expect((yield* protocol.body.from(request('default'))).fallbacks).toBe('default');
      expect((yield* protocol.body.from(request([{ model: 'claude-opus-5' }]))).fallbacks).toEqual([{ model: 'claude-opus-5' }]);
      const bare = JSON.parse(JSON.stringify(yield* protocol.body.from(request())));
      expect('fallbacks' in bare).toBe(false);
    }),
  );
  it.effect('a malformed failover refuses naming the field', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(protocol.body.from(request([{ model: 7 }])));
      expect(failure.reason._tag).toBe('InvalidRequest');
      expect(failure.reason.message).toContain('fallbacks');
    }),
  );
});

describe('Anthropic eager tool input streaming', () => {
  const toolsOf = (eagerInputStreaming?: boolean) =>
    new LLMRequest({
      model,
      system: [],
      messages: [],
      tools: [
        new ToolDefinition({
          name: 'read',
          description: 'Read.',
          inputSchema: { type: 'object', properties: {} },
          native: { anthropic: { eagerInputStreaming } },
        }),
      ],
    });
  it.effect('a deployment streaming eagerly marks every declared tool, otherwise none', () =>
    Effect.gen(function* () {
      const marked = yield* protocol.body.from(toolsOf(true));
      expect(marked.tools?.map((tool) => tool.eager_input_streaming)).toEqual([true]);
      const bare = JSON.parse(JSON.stringify(yield* protocol.body.from(toolsOf())));
      expect('eager_input_streaming' in (bare.tools?.[0] ?? {})).toBe(false);
    }),
  );
});

describe('Anthropic tool results', () => {
  it.effect('an errored result that lost its sentence still lowers to content the API accepts', () =>
    Effect.gen(function* () {
      const request = new LLMRequest({
        model,
        system: [],
        messages: [
          Message.make({
            role: 'tool',
            content: [ToolResultPart.from({ id: 'call-1', name: 'spawn_agent', result: '', resultType: 'error' })],
          }),
        ],
        tools: [],
      });
      const body = yield* protocol.body.from(request);
      const block = body.messages[0]?.content[0] as { is_error?: boolean; content: string };
      expect(block.is_error).toBe(true);
      expect(block.content.length).toBeGreaterThan(0);
      expect(block.content).toContain('spawn_agent');
    }),
  );
  it.effect('ids another provider minted reach the wire in its id alphabet, still paired and distinct', () =>
    Effect.gen(function* () {
      const ids = ['call_3dd02836#24d06945', 'call_3dd02836.24d06945', 'functions.read:0', 'toolu_01Native'];
      const request = new LLMRequest({
        model,
        system: [],
        tools: [],
        messages: [
          Message.user('Continue.'),
          Message.make({ role: 'assistant', content: ids.map((id) => ({ type: 'tool-call' as const, id, name: 'read', input: {} })) }),
          Message.make({
            role: 'tool',
            content: ids.map((id) => ToolResultPart.from({ id, name: 'read', result: id, resultType: 'text' })),
          }),
        ],
      });
      const body = yield* protocol.body.from(request);
      const calls = (body.messages[1]?.content as ReadonlyArray<{ id: string }>).map((block) => block.id);
      const results = body.messages[2]?.content as ReadonlyArray<{ tool_use_id: string; content: string }>;
      for (const id of calls) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(new Set(calls).size).toBe(ids.length);
      expect(results.map((block) => block.tool_use_id)).toEqual(calls);
      expect(results.map((block) => block.content)).toEqual(ids);
      expect(calls[3]).toBe('toolu_01Native');
    }),
  );
});

it.effect.each(['overload', 'unrecognized', 'blank'] as const)(
  'an Anthropic %s failure keeps its meaning through the public stream',
  (kind) =>
    Effect.gen(function* () {
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
      const model = yield* subscriptionRegistration.profile.model({ ownerId: 'owner', model: 'claude-opus-5-5', credentials });
      const payload =
        kind === 'overload'
          ? { type: 'overloaded_error', message: 'Overloaded; access-token' }
          : kind === 'unrecognized'
            ? { explanation: 'sensitive payload' }
            : null;
      const door = answering(
        () =>
          new Response(`data: ${JSON.stringify({ type: 'error', error: payload })}\n\n`, {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
      );
      const error = yield* Effect.scopedWith((lifetime) =>
        Effect.flip(
          Stream.runCollect(
            stream(
              new LLMRequest({
                model,
                system: [{ type: 'text', text: 'caller rules' }],
                messages: [Message.user('Are you there?')],
                tools: [],
              }),
              lifetime,
            ),
          ),
        ),
      ).pipe(Effect.provide(Layer.effectContext(openModelClient(door))));
      expect(error).toBeInstanceOf(LLMError);
      if (kind === 'overload') {
        expect(error.reason).toMatchObject({
          _tag: 'ProviderInternal',
          message: 'overloaded_error: Overloaded; <redacted>',
          modelStarted: false,
        });
        expect(error.retryable).toBe(true);
      } else {
        expect(error.family).toBe(kind === 'blank' ? 'blank-error' : 'invalid-output');
        expect(error.retryable).toBe(kind === 'blank');
        expect(JSON.parse(error.detail ?? '')).toEqual({
          kind: kind === 'blank' ? 'blank-error' : 'unrecognized-error',
          eventType: 'error',
          keys: ['error', 'type'],
          payloadKeys: kind === 'unrecognized' ? ['explanation'] : undefined,
        });
      }
    }),
);
