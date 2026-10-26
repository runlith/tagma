import { Layer } from 'effect';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect, Exit, Scope, Stream } from 'effect';
import { openModelClient } from '@runlith/llm/models/client';
import type { ModelCredentials } from '@runlith/llm/profiles/contract';
import { opencodeGoRegistration } from '@runlith/adapter-opencode-go/profiles/opencodeGo';
import { stepfunRegistration } from '@runlith/adapter-stepfun/profiles/stepfun';
import { LLMRequest, Message } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import { answering } from '@runlith/llm/route/transport/answering';
import type { OpenAIChatBody } from '@runlith/llm/protocols/openai-chat';
import { prepare, stream } from '@runlith/llm/route/client';
import { RECORDED_PRODUCT } from '@runlith/llm/profiles/recordedProduct';

const credentials: ModelCredentials = {
  apiKey: async () => 'console-key',
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

const goModel = (model: string) => opencodeGoRegistration(RECORDED_PRODUCT).profile.model({ ownerId: 'operator', model, credentials });

const producedBy = (model: string) => new ModelIdentity({ provider: ProviderID.make('opencode-go'), model: ModelID.make(model) });

const silentToolTurn = (model: string) =>
  Message.make({
    role: 'assistant',
    origin: producedBy(model),
    content: [{ type: 'tool-call', id: 'call-1', name: 'read', input: { path: '/tmp/a' } }],
  });

const thinkingToolTurn = (model: string) =>
  Message.make({
    role: 'assistant',
    origin: producedBy(model),
    content: [
      { type: 'reasoning', text: 'The path is absolute.' },
      { type: 'tool-call', id: 'call-2', name: 'read', input: { path: '/tmp/b' } },
    ],
  });

const toolResult = (model: string, id: string) =>
  Message.make({
    role: 'tool',
    origin: producedBy(model),
    content: [{ type: 'tool-result', id, name: 'read', result: { type: 'json', value: 'done' } }],
  });

const assistantTurns = Effect.fnUntraced(function* (model: string) {
  const prepared = yield* prepare<OpenAIChatBody>(
    new LLMRequest({
      model: yield* goModel(model),
      system: [],
      messages: [
        Message.user('read both'),
        silentToolTurn(model),
        toolResult(model, 'call-1'),
        thinkingToolTurn(model),
        toolResult(model, 'call-2'),
      ],
      tools: [],
    }),
  );
  const sent = JSON.parse(JSON.stringify(prepared.body)) as OpenAIChatBody;
  return sent.messages.filter((message) => message.role === 'assistant');
});

it.effect('a DeepSeek row carries the echo on every assistant turn, empty where the turn thought nothing', () =>
  Effect.gen(function* () {
    const [silent, thinking] = yield* assistantTurns('deepseek-v4.1-flash');
    expect(silent?.reasoning_content).toBe('');
    expect(thinking?.reasoning_content).toBe('The path is absolute.');
  }),
);

it.effect('a row that does not demand the echo sends no key for a turn that thought nothing', () =>
  Effect.gen(function* () {
    const [silent, thinking] = yield* assistantTurns('glm-5.3-flash');
    expect(silent).not.toHaveProperty('reasoning_content');
    expect(thinking?.reasoning_content).toBe('The path is absolute.');
  }),
);

it.effect('a turn that answered with calls alone still carries its content key as null', () =>
  Effect.gen(function* () {
    const [silent] = yield* assistantTurns('glm-5.3-flash');
    expect(silent?.content).toBeNull();
  }),
);

const thoughtOnlyTurn = (model: string) =>
  Message.make({
    role: 'assistant',
    origin: producedBy(model),
    content: [{ type: 'reasoning', text: 'Still weighing it when the ceiling cut in.' }],
  });

const assistantTurnsOf = Effect.fnUntraced(function* (model: string, messages: readonly Message[]) {
  const prepared = yield* prepare<OpenAIChatBody>(new LLMRequest({ model: yield* goModel(model), system: [], messages, tools: [] }));
  const sent = JSON.parse(JSON.stringify(prepared.body)) as OpenAIChatBody;
  return sent.messages.filter((message) => message.role === 'assistant');
});

it.effect('a turn cut before it said or called anything never reaches the wire, on a row demanding the echo or not', () =>
  Effect.gen(function* () {
    for (const model of ['deepseek-v4.1-flash', 'glm-5.3-flash']) {
      const turns = yield* assistantTurnsOf(model, [Message.user('read both'), thoughtOnlyTurn(model)]);
      expect(turns).toEqual([]);
    }
  }),
);

const chunk = (toolCall: Record<string, unknown>, finish?: string) =>
  JSON.stringify({
    id: 'chatcmpl-1',
    object: 'chat.completion.chunk',
    model: 'step-5-preview',
    choices: [{ index: 0, delta: { role: 'assistant', content: '', tool_calls: [toolCall] }, finish_reason: finish }],
  });

const CLOSED = JSON.stringify({
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  model: 'step-5-preview',
  choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
});

const streamed = Effect.fnUntraced(
  function* (frames: ReadonlyArray<string>) {
    const model = yield* stepfunRegistration.profile.model({ ownerId: 'operator', model: 'step-5-preview', credentials });
    const lifetime = yield* Scope.make();
    return yield* Stream.runCollect(stream(new LLMRequest({ model, system: [], messages: [], tools: [] }), lifetime)).pipe(
      Effect.ensuring(Scope.close(lifetime, Exit.void)),
    );
  },
  (effect, frames) =>
    Effect.provide(
      effect,
      Layer.effectContext(
        openModelClient(
          answering(
            () =>
              new Response(frames.map((frame) => `data: ${frame}\n\n`).join(''), {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
              }),
          ),
        ),
      ),
    ),
);

it.effect('a continuation delta that spells its identity as empty strings keeps building the call it opened', () =>
  Effect.gen(function* () {
    const events = yield* streamed([
      chunk({ index: 0, id: 'call-7', type: 'function', function: { name: 'weather', arguments: '{' } }),
      chunk({ index: 0, id: '', type: '', function: { name: '', arguments: '"city": "Tbilisi"' } }),
      chunk({ index: 0, id: '', type: '', function: { name: '', arguments: '}' } }),
      CLOSED,
    ]);

    expect(events.find((event) => event.type === 'tool-call')).toMatchObject({
      id: 'call-7',
      name: 'weather',
      input: { city: 'Tbilisi' },
    });
  }),
);

it.effect('a first delta carrying no identity at all still fails the stream', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(streamed([chunk({ index: 0, id: '', type: '', function: { name: '', arguments: '{}' } }), CLOSED]));
    expect(failure.reason).toMatchObject({ family: 'invalid-output' });
  }),
);
