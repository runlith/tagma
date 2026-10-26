import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Deferred, Effect, Fiber, Stream } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { LLMEvent } from '@runlith/llm/schema/events';
import { agentAside, AgentAsideCalledTool } from './AgentAside';
import { withAgentOrigin, withAgentReaderInput } from './AgentSignal';
import type { ModelRequest, ModelStreamInput } from './modelPort';
function requesting(events: readonly LLMEvent[]) {
  const sent: ModelStreamInput[] = [];
  const request: ModelRequest = {
    plannedOutputTokens: 0,
    stream: (input) => {
      sent.push(input);
      return Stream.fromIterable(events);
    },
    text: () => Effect.die(new Error('not used')),
    object: () => Effect.die(new Error('not used')),
  };
  return { request, sent };
}
const answering = (text: string): readonly LLMEvent[] => [
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', text },
  { type: 'text-end', id: 't' },
  { type: 'finish', reason: 'stop' },
];
it.effect(
  'an aside sends the prepared messages unchanged with the question appended last',
  Effect.fnUntraced(function* () {
    const messages = [Message.user('build the thing'), Message.assistant('building')];
    const { request, sent } = requesting(answering('Building the thing'));
    const answer = yield* agentAside({ runId: 'r', stepNumber: 0, request, messages, tools: {}, stallMs: 1000 }).ask({
      instruction: 'name it',
    });
    expect(answer.text).toBe('Building the thing');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.messages.slice(0, 2)).toEqual(messages);
    expect(sent[0]?.messages).toHaveLength(3);
    expect(sent[0]?.messages.at(-1)?.role).toBe('user');
  }),
);
it.effect(
  'an aside answered with a tool call fails instead of answering empty text',
  Effect.fnUntraced(function* () {
    const { request } = requesting([
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', text: 'I will inspect it.' },
      { type: 'text-end', id: 't' },
      { type: 'tool-call', id: 'c1', name: 'read', input: {} },
      { type: 'finish', reason: 'tool-calls' },
    ]);
    const failure = yield* Effect.flip(
      agentAside({ runId: 'r', stepNumber: 0, request, messages: [Message.user('hi')], tools: {}, stallMs: 1000 }).ask({
        instruction: 'name it',
      }),
    );
    expect(failure).toBeInstanceOf(AgentAsideCalledTool);
    expect(failure).toMatchObject({ tools: ['read'], text: 'I will inspect it.', finishReason: 'tool-calls' });
  }),
);
test('the reader input of a request is the newest marked one, never a runtime user message', () => {
  const { request } = requesting(answering('x'));
  const messages = [
    withAgentReaderInput(Message.user('the first thing'), 'entry-1'),
    Message.assistant('done'),
    withAgentReaderInput(Message.user('the second thing'), 'entry-2', 20),
    withAgentOrigin(Message.user('the turn orientation'), 'orientation'),
  ];
  const aside = agentAside({ runId: 'r', stepNumber: 1, request, messages, tools: {}, stallMs: 1000 });
  expect(aside.readerInput).toBe('entry-2');
  const revised = agentAside({
    runId: 'r',
    stepNumber: 2,
    request,
    messages: [withAgentReaderInput(Message.user('revised words'), 'entry-2', 21)],
    tools: {},
    stallMs: 1000,
  });
  expect(revised.readerPosition).toBe(21);
  expect(aside.readerPosition).toBe(20);
  const none = agentAside({
    runId: 'r',
    stepNumber: 2,
    request,
    messages: [withAgentOrigin(Message.user('an agent envelope'), 'envelope')],
    tools: {},
    stallMs: 1000,
  });
  expect(none.readerInput).toBeNull();
});
it.effect(
  'interrupting an aside mid-stream ends it interrupted with no answer',
  Effect.fnUntraced(function* () {
    const opened = yield* Deferred.make<void>();
    const { request: base } = requesting([]);
    const request: ModelRequest = {
      ...base,
      stream: () =>
        Stream.concat(
          Stream.fromIterable<LLMEvent>([
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', text: 'partial' },
          ]),
          Stream.fromEffect(Effect.andThen(Deferred.succeed(opened, undefined), Effect.never)),
        ),
    };
    const fiber = yield* Effect.forkScoped(
      agentAside({ runId: 'r', stepNumber: 0, request, messages: [], tools: {}, stallMs: 1000 }).ask({ instruction: 'name it' }),
    );
    yield* Deferred.await(opened);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
  }),
);
it.effect(
  'an aside answers the folded text and the reason the model stopped',
  Effect.fnUntraced(function* () {
    const { request } = requesting(answering('Two words'));
    const answer = yield* agentAside({ runId: 'r', stepNumber: 0, request, messages: [], tools: {}, stallMs: 1000 }).ask({
      instruction: 'name it',
    });
    expect(answer).toMatchObject({ text: 'Two words', finishReason: 'stop' });
  }),
);
