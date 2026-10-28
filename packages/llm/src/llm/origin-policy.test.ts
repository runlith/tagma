import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import * as LLM from './call';
import * as AnthropicMessages from './protocols/anthropic-messages';
import * as OpenAIChat from './protocols/openai-chat';
import * as OpenAIResponses from './protocols/openai-responses';
import { Message } from './schema/messages';
import { ModelID, ProviderID } from './schema/ids';
import { ModelIdentity } from './schema/options';
import { prepare } from './route/client';

const sonnet = AnthropicMessages.route.model({ id: 'claude-sonnet-5', provider: 'anthropic' });
const opus = AnthropicMessages.route.model({ id: 'claude-opus-5', provider: 'anthropic' });

const gpt = new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.6-sol') });

type AnthropicBlock = {
  readonly type: string;
  readonly signature?: string;
  readonly caller?: unknown;
  readonly input?: unknown;
  readonly text?: string;
  readonly id?: string;
  readonly tool_use_id?: string;
  readonly content?: unknown;
  readonly source?: unknown;
  readonly from?: { readonly model: string };
  readonly to?: { readonly model: string };
};
type AnthropicWire = {
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: ReadonlyArray<AnthropicBlock> }>;
};

const wire = (input: LLM.RequestInput) => prepare<AnthropicWire>(LLM.request(input)).pipe(Effect.map((prepared) => prepared.body));

const blocks = (body: AnthropicWire) => body.messages.map((message) => message.content.map((block) => block.type));

const signedThinking = (signature: string) =>
  ({ type: 'reasoning', text: 'thought', providerMetadata: { anthropic: { signature } } }) as const;

const openAIThinking = {
  type: 'reasoning',
  text: 'thought',
  providerMetadata: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'opaque' } },
} as const;

describe('history produced by another model', () => {
  it.effect('reaches the wire without its reasoning, and its tool call still pairs', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.make({
            role: 'assistant',
            content: [openAIThinking, { type: 'tool-call', id: 'call-1', name: 'read', input: {} }],
            origin: gpt,
          }),
          Message.make({
            role: 'tool',
            content: [{ type: 'tool-result', id: 'call-1', name: 'read', result: { type: 'json', value: 'done' } }],
            origin: gpt,
          }),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['tool_use'], ['tool_result'], ['text']]);
    }),
  );

  it.effect('leaves no empty turn behind when reasoning was all it held', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.make({ role: 'assistant', content: [openAIThinking], origin: gpt }),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['text']]);
    }),
  );

  it.effect('is what a message naming no producer is read as', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.assistant([signedThinking('sig-from-nowhere'), Message.text('reply')]),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['text'], ['text']]);
    }),
  );
});

describe('provider-owned tool history', () => {
  const foreign = new ModelIdentity({ provider: ProviderID.make('acme-oauth'), model: ModelID.make('model-a') });
  const input = { server_name: 'lode', tool_name: 'file_reflection', arguments: { actual: 'export refused' } };
  const failure = "Failed to connect to MCP server 'lode'. Please try again.";
  const metadata = { acme: { mcpGateway: { name: 'mcp_call_tool', input } } };
  const history = () => [
    Message.user('Record the failed export.'),
    Message.make({
      role: 'assistant',
      origin: foreign,
      native: { acmeClient: { trajectoryId: 'old-trajectory' } },
      content: [
        Message.text('Before the attempt.'),
        { type: 'tool-call', id: 'gateway-1', name: 'mcp_call_tool', input, providerExecuted: true, providerMetadata: metadata },
        {
          type: 'tool-result',
          id: 'gateway-1',
          name: 'mcp_call_tool',
          result: { type: 'text', value: failure },
          providerExecuted: true,
          providerMetadata: metadata,
        },
        Message.text('After the attempt.'),
        { type: 'tool-call', id: 'real-1', name: 'read', input: { path: 'result.txt' }, providerMetadata: metadata },
      ],
    }),
    Message.make({
      role: 'tool',
      origin: foreign,
      content: [
        {
          type: 'tool-result',
          id: 'real-1',
          name: 'read',
          result: { type: 'text', value: 'Export is still pending.' },
          providerMetadata: metadata,
        },
      ],
    }),
    Message.user('Continue.'),
  ];

  it.effect('Anthropic receives the attempted gateway operation as history and the real tool as a paired call', () =>
    Effect.gen(function* () {
      const messages = history();
      const stored = JSON.stringify(messages);
      const body = yield* wire({ model: sonnet, messages });
      expect(blocks(body)).toEqual([['text'], ['text', 'text'], ['text', 'text'], ['text', 'tool_use'], ['tool_result'], ['text']]);
      expect(body.messages[1]?.content[1]?.text).toContain(JSON.stringify(input));
      expect(body.messages[2]?.role).toBe('user');
      expect(body.messages[2]?.content[1]?.text).toBe(failure);
      expect(body.messages[3]?.content).toEqual([
        expect.objectContaining({ type: 'text', text: 'After the attempt.' }),
        expect.objectContaining({ type: 'tool_use', id: 'real-1', name: 'read', input: { path: 'result.txt' } }),
      ]);
      expect(body.messages[4]?.content[0]).toMatchObject({
        type: 'tool_result',
        tool_use_id: 'real-1',
        content: 'Export is still pending.',
      });
      expect(JSON.stringify(messages)).toBe(stored);
    }),
  );

  it.effect('Responses retains the gateway answer instead of losing it as an unresolvable hosted reference', () =>
    Effect.gen(function* () {
      const body = (yield* prepare<{ input: Array<Record<string, unknown>> }>(
        LLM.request({
          model: OpenAIResponses.route.model({ id: 'gpt-test', provider: 'openai' }),
          messages: history(),
        }),
      )).body;
      expect(body.input.filter((item) => item.type === 'function_call')).toEqual([
        expect.objectContaining({ call_id: 'real-1', name: 'read', arguments: JSON.stringify({ path: 'result.txt' }) }),
      ]);
      expect(body.input.filter((item) => item.type === 'function_call_output')).toEqual([
        expect.objectContaining({ call_id: 'real-1', output: 'Export is still pending.' }),
      ]);
      expect(body.input.find((item) => item.role === 'user' && JSON.stringify(item).includes(failure))).toMatchObject({
        content: expect.arrayContaining([{ type: 'input_text', text: failure }]),
      });
    }),
  );

  it.effect('Chat receives the gateway result as user text without inventing a tool declaration', () =>
    Effect.gen(function* () {
      const body = (yield* prepare<{ messages: Array<Record<string, unknown>> }>(
        LLM.request({
          model: OpenAIChat.route.model({ id: 'gpt-test', provider: 'openai' }),
          messages: history(),
        }),
      )).body;
      expect(body.messages.filter((message) => message.tool_calls !== undefined)).toEqual([
        expect.objectContaining({
          tool_calls: [
            expect.objectContaining({ id: 'real-1', function: { name: 'read', arguments: JSON.stringify({ path: 'result.txt' }) } }),
          ],
        }),
      ]);
      expect(body.messages.find((message) => message.role === 'user' && JSON.stringify(message).includes(failure))).toBeDefined();
    }),
  );

  it.effect('historical results wait for the complete real tool batch in Anthropic and Chat', () =>
    Effect.gen(function* () {
      const messages = history();
      const assistant = messages[1]!;
      const call = assistant.content.at(-1)!;
      messages[1] = new Message({
        ...assistant,
        content: [
          call,
          { type: 'tool-call', id: 'real-2', name: 'read', input: { path: 'second.txt' } },
          ...assistant.content.slice(0, -1),
        ],
      });
      messages.splice(
        3,
        0,
        Message.make({
          role: 'tool',
          origin: foreign,
          content: [{ type: 'tool-result', id: 'real-2', name: 'read', result: { type: 'text', value: 'Second result.' } }],
        }),
      );
      const anthropic = yield* wire({ model: sonnet, messages });
      expect(blocks(anthropic)).toEqual([
        ['text'],
        ['tool_use', 'tool_use', 'text', 'text', 'text'],
        ['tool_result'],
        ['tool_result'],
        ['text', 'text'],
        ['text'],
      ]);
      expect(anthropic.messages[4]?.content[1]?.text).toBe(failure);
      const chat = (yield* prepare<{ messages: Array<Record<string, unknown>> }>(
        LLM.request({
          model: OpenAIChat.route.model({ id: 'gpt-test', provider: 'openai' }),
          messages,
        }),
      )).body;
      expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'user', 'user']);
      expect(chat.messages[2]?.tool_call_id).toBe('real-1');
      expect(chat.messages[3]?.tool_call_id).toBe('real-2');
      expect(JSON.stringify(chat.messages[4])).toContain(failure);
    }),
  );

  it.effect('a separate hosted result retains structured errors and media on the user side', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('Read the previous results.'),
          Message.make({
            role: 'tool',
            origin: foreign,
            content: [
              {
                type: 'tool-result',
                id: 'bad',
                name: 'remote',
                providerExecuted: true,
                result: { type: 'error', value: { code: 'denied' } },
              },
              {
                type: 'tool-result',
                id: 'image',
                name: 'remote',
                providerExecuted: true,
                result: {
                  type: 'content',
                  value: [
                    { type: 'text', text: 'Observed image.' },
                    { type: 'file', uri: 'data:image/png;base64,aGk=', mime: 'image/png' },
                  ],
                },
              },
            ],
          }),
        ],
      });
      expect(body.messages[1]?.role).toBe('user');
      expect(body.messages[1]?.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('"type":"error"') }),
        expect.objectContaining({ type: 'text', text: '{"code":"denied"}' }),
        expect.objectContaining({ type: 'text', text: expect.stringContaining('"id":"image"') }),
        expect.objectContaining({ type: 'text', text: 'Observed image.' }),
        expect.objectContaining({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } }),
      ]);
    }),
  );

  it.effect('compatible Anthropic hosted history still round-trips natively after a foreign projection', () =>
    Effect.gen(function* () {
      const messages = [
        Message.user('Search.'),
        Message.make({
          role: 'assistant',
          origin: ModelIdentity.of(sonnet),
          content: [
            { type: 'tool-call', id: 'search-1', name: 'web_search', input: { query: 'lode' }, providerExecuted: true },
            { type: 'tool-result', id: 'search-1', name: 'web_search', result: { type: 'json', value: [] }, providerExecuted: true },
          ],
        }),
      ];
      yield* prepare(LLM.request({ model: OpenAIResponses.route.model({ id: 'gpt-test', provider: 'openai' }), messages }));
      expect(blocks(yield* wire({ model: sonnet, messages }))).toEqual([['text'], ['server_tool_use', 'web_search_tool_result']]);
    }),
  );
});

describe('history produced by the model being called', () => {
  it.effect('keeps its signed thinking', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.make({
            role: 'assistant',
            content: [signedThinking('sig-1'), Message.text('reply')],
            origin: ModelIdentity.of(sonnet),
          }),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['thinking', 'text'], ['text']]);
      expect(body.messages[1]?.content[0]?.signature).toBe('sig-1');
    }),
  );

  it.effect('is another model of the same provider only when the model matches too', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.make({
            role: 'assistant',
            content: [signedThinking('sig-from-opus'), Message.text('reply')],
            origin: ModelIdentity.of(opus),
          }),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['text'], ['text']]);
    }),
  );

  it.effect('drops a thinking part whose stream was torn before its signature arrived', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: sonnet,
        messages: [
          Message.user('first'),
          Message.make({
            role: 'assistant',
            content: [{ type: 'reasoning', text: 'unfinished' }, Message.text('reply')],
            origin: ModelIdentity.of(sonnet),
          }),
          Message.user('now you'),
        ],
      });

      expect(blocks(body)).toEqual([['text'], ['text'], ['text']]);
    }),
  );
});

it.effect('a fallback target keeps the source model state that its native transition authorizes', () =>
  Effect.gen(function* () {
    const body = yield* wire({
      model: opus,
      messages: [
        Message.user('first'),
        Message.make({
          role: 'assistant',
          origin: ModelIdentity.of(sonnet),
          content: [
            signedThinking('sig-from-sonnet'),
            {
              type: 'tool-call',
              id: 'search-1',
              name: 'tool_search',
              input: { query: 'select:read' },
              providerMetadata: { anthropic: { caller: { type: 'direct' } } },
            },
          ],
        }),
        Message.make({
          role: 'assistant',
          origin: ModelIdentity.of(opus),
          content: [
            {
              type: 'model-fallback',
              from: ModelIdentity.of(sonnet),
              to: ModelIdentity.of(opus),
              trigger: { type: 'refusal' },
            },
          ],
        }),
      ],
    });

    expect(blocks(body)).toEqual([['text'], ['thinking', 'tool_use'], ['fallback']]);
    expect(body.messages[1]?.content[1]).toMatchObject({ caller: { type: 'direct' }, input: { query: 'select:read' } });
    expect(body.messages[2]?.content[0]).toMatchObject({ from: { model: 'claude-sonnet-5' }, to: { model: 'claude-opus-5' } });
  }),
);
