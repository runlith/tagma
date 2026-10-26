import { expect, test } from 'bun:test';
import { LLMEvent, LLMResponse } from './events';
import { ModelID, ProviderID } from './ids';
import { ModelIdentity } from './options';
import { Message } from './messages';
import * as ResponseFold from './responseFold';

test('the response fold preserves the protocol fixture bytes', () => {
  const events = [
    LLMEvent.textStart({ id: 'text-1' }),
    LLMEvent.textDelta({ id: 'text-1', text: 'hel' }),
    LLMEvent.textDelta({ id: 'text-1', text: 'lo' }),
    LLMEvent.textEnd({ id: 'text-1' }),
    LLMEvent.reasoningStart({ id: 'reasoning-1' }),
    LLMEvent.reasoningDelta({ id: 'reasoning-1', text: 'why' }),
    LLMEvent.reasoningEnd({ id: 'reasoning-1' }),
    LLMEvent.toolInputStart({ id: 'call-1', name: 'read' }),
    LLMEvent.toolInputDelta({ id: 'call-1', name: 'read', text: '{"path":' }),
    LLMEvent.toolInputDelta({ id: 'call-1', name: 'read', text: '"/tmp"}' }),
    LLMEvent.toolInputEnd({ id: 'call-1', name: 'read' }),
    LLMEvent.toolCall({ id: 'call-1', name: 'read', input: { path: '/tmp' } }),
    LLMEvent.finish({ reason: 'tool-calls', usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } }),
  ];

  const response = ResponseFold.fromEvents(events);
  expect(JSON.stringify(response)).toBe(
    '{"message":{"role":"assistant","content":[{"type":"text","text":"hello"},{"type":"reasoning","text":"why"},{"type":"tool-call","id":"call-1","name":"read","input":{"path":"/tmp"}}]},"events":[{"type":"text-start","id":"text-1"},{"type":"text-delta","id":"text-1","text":"hel"},{"type":"text-delta","id":"text-1","text":"lo"},{"type":"text-end","id":"text-1"},{"type":"reasoning-start","id":"reasoning-1"},{"type":"reasoning-delta","id":"reasoning-1","text":"why"},{"type":"reasoning-end","id":"reasoning-1"},{"type":"tool-input-start","id":"call-1","name":"read"},{"type":"tool-input-delta","id":"call-1","name":"read","text":"{\\"path\\":"},{"type":"tool-input-delta","id":"call-1","name":"read","text":"\\"/tmp\\"}"},{"type":"tool-input-end","id":"call-1","name":"read"},{"type":"tool-call","id":"call-1","name":"read","input":{"path":"/tmp"}},{"type":"finish","reason":"tool-calls","usage":{"inputTokens":12,"outputTokens":5,"totalTokens":17}}],"usage":{"inputTokens":12,"outputTokens":5,"totalTokens":17},"finishReason":"tool-calls"}',
  );
});

test.each(['text', 'reasoning'] as const)(
  '%s projection preserves whitespace and split Unicode independently of message content',
  (kind) => {
    const delta = kind === 'text' ? LLMEvent.textDelta : LLMEvent.reasoningDelta;
    const read = kind === 'text' ? LLMResponse.text : LLMResponse.reasoning;
    const events = [' \r', '\n', '\ud801', '\udc37\t'].map((text) => delta({ id: 'part', text }));
    const response = ResponseFold.fromEvents([...events, LLMEvent.finish({ reason: 'stop' })])!;
    const expected = ' \r\n\u{10437}\t';
    expect(response[kind]).toBe(expected);
    expect(read(response)).toBe(expected);
    expect(read({ events })).toBe(expected);
    const different = new LLMResponse({ ...response, message: Message.assistant([{ type: kind, text: 'x'.repeat(expected.length) }]) });
    expect(different[kind]).toBe(expected);
  },
);

test.each(['text', 'reasoning'] as const)('%s projection follows delta order when parts are interleaved', (kind) => {
  const delta = kind === 'text' ? LLMEvent.textDelta : LLMEvent.reasoningDelta;
  const response = ResponseFold.fromEvents([
    delta({ id: 'first', text: ' A ' }),
    delta({ id: 'second', text: 'B\n' }),
    delta({ id: 'first', text: 'C ' }),
    LLMEvent.finish({ reason: 'stop' }),
  ])!;
  expect(response.message.content).toEqual([
    { type: kind, text: ' A C ' },
    { type: kind, text: 'B\n' },
  ]);
  expect(response[kind]).toBe(' A B\nC ');
});

test('an unfinished part is materialized when a torn response reads it', () => {
  let state = ResponseFold.empty();
  state = ResponseFold.reduce(state, LLMEvent.textStart({ id: 'text-1' }));
  state = ResponseFold.reduce(state, LLMEvent.textDelta({ id: 'text-1', text: 'still here' }));

  expect(state.message.content).toEqual([{ type: 'text', text: 'still here' }]);
});

test('the named response id rides the fold onto the assembled message', () => {
  const response = ResponseFold.fromEvents([
    LLMEvent.inputUsage({ inputUsage: { inputTokens: 5 }, messageId: 'msg_x' }),
    LLMEvent.textStart({ id: 'text-1' }),
    LLMEvent.textDelta({ id: 'text-1', text: 'hi' }),
    LLMEvent.textEnd({ id: 'text-1' }),
    LLMEvent.finish({ reason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } }),
  ]);

  expect(response?.message.id).toBe('msg_x');
});

test('the first named response id wins, and an unnamed fold stays nameless', () => {
  const first = ResponseFold.fromEvents([
    LLMEvent.inputUsage({ inputUsage: { inputTokens: 5 }, messageId: 'msg_a' }),
    LLMEvent.inputUsage({ inputUsage: { inputTokens: 5 }, messageId: 'msg_b' }),
    LLMEvent.finish({ reason: 'stop', usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 } }),
  ]);
  expect(first?.message.id).toBe('msg_a');

  const unnamed = ResponseFold.fromEvents([
    LLMEvent.inputUsage({ inputUsage: { inputTokens: 5 } }),
    LLMEvent.finish({ reason: 'stop', usage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 } }),
  ]);
  expect(unnamed?.message.id).toBeUndefined();
});

test('a model fallback replaces the abandoned partial answer and stamps the model that continued', () => {
  const provider = ProviderID.make('subscription');
  const fable = new ModelIdentity({ provider, model: ModelID.make('claude-fable-5-1') });
  const opus = new ModelIdentity({ provider, model: ModelID.make('claude-opus-5') });
  let state = ResponseFold.empty(fable);
  state = ResponseFold.reduce(state, LLMEvent.reasoningStart({ id: 'abandoned' }));
  state = ResponseFold.reduce(state, LLMEvent.reasoningDelta({ id: 'abandoned', text: 'partial' }));
  state = ResponseFold.reduce(state, LLMEvent.modelFallback({ from: fable, to: opus, trigger: { type: 'refusal' } }));
  state = ResponseFold.reduce(state, LLMEvent.reasoningStart({ id: 'continued' }));
  state = ResponseFold.reduce(state, LLMEvent.reasoningDelta({ id: 'continued', text: 'replacement' }));
  state = ResponseFold.reduce(state, LLMEvent.reasoningEnd({ id: 'continued' }));

  expect(state.message.origin).toEqual(opus);
  expect(state.message.content.map((part) => part.type)).toEqual(['model-fallback', 'reasoning']);
  expect(state.message.content[1]).toMatchObject({ text: 'replacement' });
  const response = ResponseFold.complete(ResponseFold.reduce(state, LLMEvent.finish({ reason: 'stop' })))!;
  expect(response.reasoning).toBe('partialreplacement');
});
