import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { applyCachePolicy } from './cache-policy';
import * as LLM from './call';
import * as AnthropicMessages from './protocols/anthropic-messages';
import * as BedrockConverse from './protocols/bedrock-converse';
import * as Gemini from './protocols/gemini';
import * as OpenAIChat from './protocols/openai-chat';
import * as Auth from './route/auth';
import { CacheHint } from './schema/options';
import { Message, ToolCallPart, ToolResultPart } from './schema/messages';
import { prepare } from './route/client';

const anthropic = AnthropicMessages.route.model({ id: 'claude-sonnet-5', provider: 'test-provider' });

const bedrock = BedrockConverse.route
  .with({ endpoint: { baseURL: 'https://bedrock-runtime.test' }, auth: Auth.none })
  .model({ id: 'anthropic.claude-sonnet-4-5-v1:0', provider: 'test-provider' });

const openai = OpenAIChat.route.model({ id: 'gpt-5.5', provider: 'test-provider' });

const gemini = Gemini.route.model({ id: 'gemini-3-pro', provider: 'test-provider' });

const EPHEMERAL = { type: 'ephemeral' };
const EPHEMERAL_1H = { type: 'ephemeral', ttl: '1h' };
const CACHE_POINT = { cachePoint: { type: 'default' } };

type Marked = { readonly cache_control?: unknown };

type AnthropicWire = {
  readonly system?: ReadonlyArray<Marked & { readonly text: string }>;
  readonly tools?: ReadonlyArray<Marked & { readonly name: string }>;
  readonly messages: ReadonlyArray<{ readonly role: string; readonly content: ReadonlyArray<Marked> }>;
};

const systemPart = (text: string) => ({ type: 'text' as const, text });

const tool = (name: string) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } });

const wire = <Body>(input: LLM.RequestInput) => prepare<Body>(LLM.request(input)).pipe(Effect.map((prepared) => prepared.body));

const marks = (parts: ReadonlyArray<Marked> | undefined) => parts?.map((part) => part.cache_control);

const turns = (body: AnthropicWire) => body.messages.map((message) => message.content[0]?.cache_control);

describe('the placement pass', () => {
  it.effect('no policy and "auto" alike mark the last tool, the last system part and the end of the conversation', () =>
    Effect.gen(function* () {
      for (const cache of [undefined, 'auto'] as const) {
        const body = yield* wire<AnthropicWire>({
          model: anthropic,
          cache,
          system: [systemPart('rules'), systemPart('style')],
          tools: [tool('read'), tool('write')],
          messages: [Message.user('first'), Message.assistant('reply'), Message.user('latest')],
        });

        expect(marks(body.tools)).toEqual([undefined, EPHEMERAL]);
        expect(marks(body.system)).toEqual([undefined, EPHEMERAL]);
        expect(turns(body)).toEqual([undefined, undefined, EPHEMERAL]);
      }
    }),
  );

  it.effect('"none" places nothing anywhere', () =>
    Effect.gen(function* () {
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: 'none',
        system: [systemPart('rules')],
        tools: [tool('read')],
        messages: [Message.user('first'), Message.user('latest')],
      });

      expect(marks(body.tools)).toEqual([undefined]);
      expect(marks(body.system)).toEqual([undefined]);
      expect(turns(body)).toEqual([undefined, undefined]);
    }),
  );

  it.effect('a hint the caller placed by hand is kept as written, and the pass fills only what is empty', () =>
    Effect.gen(function* () {
      const hand = new CacheHint({ type: 'ephemeral', ttlSeconds: 3600 });
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: 'auto',
        system: [{ ...systemPart('rules'), cache: hand }, systemPart('style')],
        messages: [Message.user('first'), Message.assistant('reply'), Message.user([{ type: 'text', text: 'latest', cache: hand }])],
      });

      expect(marks(body.system)).toEqual([EPHEMERAL_1H, EPHEMERAL]);
      expect(turns(body)).toEqual([undefined, undefined, EPHEMERAL_1H]);
    }),
  );

  it.effect('the pass is skipped whole for a route whose wire format ignores inline hints', () =>
    Effect.sync(() => {
      const call = (model: LLM.RequestInput['model']) =>
        LLM.request({
          model,
          cache: 'auto',
          system: [systemPart('rules')],
          tools: [tool('read')],
          prompt: 'hi',
        });

      for (const model of [openai, gemini]) {
        const request = call(model);
        expect(applyCachePolicy(request)).toBe(request);
      }
      const marked = call(anthropic);
      expect(applyCachePolicy(marked)).not.toBe(marked);
    }),
  );

  it.effect('Bedrock Converse takes the same three breakpoints, in its own positional markers', () =>
    Effect.gen(function* () {
      const body = yield* wire({
        model: bedrock,
        cache: 'auto',
        system: [systemPart('rules')],
        tools: [tool('read')],
        messages: [Message.user('first'), Message.assistant('reply'), Message.user('latest')],
      });

      expect(body).toMatchObject({
        toolConfig: { tools: [{ toolSpec: { name: 'read' } }, CACHE_POINT] },
        system: [{ text: 'rules' }, CACHE_POINT],
        messages: [
          { role: 'user', content: [{ text: 'first' }] },
          { role: 'assistant', content: [{ text: 'reply' }] },
          { role: 'user', content: [{ text: 'latest' }, CACHE_POINT] },
        ],
      });
    }),
  );

  it.effect('the object form places exactly what it names, and its ttl reaches the wire', () =>
    Effect.gen(function* () {
      const request = {
        model: anthropic,
        system: [systemPart('rules')],
        tools: [tool('read')],
        messages: [Message.user('latest')],
      };

      const toolsOnly = yield* wire<AnthropicWire>({ ...request, cache: { tools: true } });
      expect(marks(toolsOnly.tools)).toEqual([EPHEMERAL]);
      expect(marks(toolsOnly.system)).toEqual([undefined]);
      expect(turns(toolsOnly)).toEqual([undefined]);

      const systemOnly = yield* wire<AnthropicWire>({ ...request, cache: { system: true, ttlSeconds: 3600 } });
      expect(marks(systemOnly.tools)).toEqual([undefined]);
      expect(marks(systemOnly.system)).toEqual([EPHEMERAL_1H]);
      expect(turns(systemOnly)).toEqual([undefined]);
    }),
  );

  it.effect('a tail strategy marks the last n turns and nothing before them', () =>
    Effect.gen(function* () {
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: { messages: { tail: 2 } },
        messages: [Message.user('u1'), Message.assistant('a1'), Message.user('u2'), Message.assistant('a2')],
      });

      expect(turns(body)).toEqual([undefined, undefined, EPHEMERAL, EPHEMERAL]);
    }),
  );

  it.effect('the breakpoint lands on the tool result a step ended with, not on the turn that started it', () =>
    Effect.gen(function* () {
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: 'auto',
        messages: [
          Message.user('do the thing'),
          Message.assistant([ToolCallPart.from({ id: 'call-1', name: 'read', input: {} })]),
          Message.tool(ToolResultPart.from({ id: 'call-1', name: 'read', result: 'ok' })),
        ],
      });

      expect(turns(body)).toEqual([undefined, undefined, EPHEMERAL]);
    }),
  );

  it.effect('an image the turn ends with carries the marker, rather than losing it to the text before it', () =>
    Effect.gen(function* () {
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: 'auto',
        messages: [
          Message.user([
            { type: 'text', text: 'look at this' },
            { type: 'media', mediaType: 'image/png', data: 'aGk=' },
          ]),
        ],
      });

      expect(marks(body.messages[0]?.content)).toEqual([undefined, EPHEMERAL]);
    }),
  );

  it.effect('a tail of nothing but reasoning hands the breakpoint to the message before it', () =>
    Effect.sync(() => {
      const thinking = Message.assistant([{ type: 'reasoning' as const, text: 'thinking' }]);
      const marked = applyCachePolicy(LLM.request({ model: anthropic, cache: 'auto', messages: [Message.user('question'), thinking] }));

      const question = marked.messages[0]?.content[0];
      expect(question?.type === 'text' ? question.cache : undefined).toBeDefined();
      expect(marked.messages[1]).toEqual(thinking);
    }),
  );

  it.effect('"latest-assistant" moves the breakpoint off the user turn', () =>
    Effect.gen(function* () {
      const body = yield* wire<AnthropicWire>({
        model: anthropic,
        cache: { messages: 'latest-assistant' },
        messages: [Message.user('u1'), Message.assistant('a1'), Message.user('u2')],
      });

      expect(turns(body)).toEqual([undefined, EPHEMERAL, undefined]);
    }),
  );
});
