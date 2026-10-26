import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { LLMEvent } from '../schema/events';
import { LLMRequest, Message, ToolDefinition } from '../schema/messages';
import { Model } from '../schema/options';
import * as Gemini from './gemini';

type Chunk = Parameters<typeof Gemini.protocol.stream.step>[1];

const request = (input: Partial<ConstructorParameters<typeof LLMRequest>[0]> = {}) =>
  new LLMRequest({
    model: Model.make({ id: 'gemini-4-argon', provider: 'test-provider', route: Gemini.route }),
    system: [],
    messages: [],
    tools: [],
    ...input,
  });

const answer = Effect.fnUntraced(function* (chunks: ReadonlyArray<Chunk>) {
  const stream = Gemini.protocol.stream;
  let state = stream.initial(request());
  const events: LLMEvent[] = [];
  for (const chunk of chunks) {
    const [next, emitted] = yield* stream.step(state, chunk);
    state = next;
    events.push(...emitted);
  }
  events.push(...(stream.onHalt?.(state) ?? []));
  return events;
});

type Part = NonNullable<NonNullable<Chunk['candidates']>[number]['content']>['parts'][number];

const model = (parts: ReadonlyArray<Part>, finishReason?: string): Chunk => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
});

describe('a function call keeps one identity from answer to result', () => {
  it.effect('the native id returns on the call and on its result; without one, successive answers never share an id', () =>
    Effect.gen(function* () {
      const callIds = (events: ReadonlyArray<LLMEvent>) => events.flatMap((event) => (event.type === 'tool-call' ? [event.id] : []));
      const native = yield* answer([model([{ functionCall: { id: 'fc-native', name: 'read', args: {} } }], 'STOP')]);
      const first = yield* answer([model([{ functionCall: { name: 'read', args: {} } }], 'STOP')]);
      const second = yield* answer([model([{ functionCall: { name: 'read', args: {} } }], 'STOP')]);
      expect(callIds(native)).toEqual(['fc-native']);
      expect(callIds(first)[0]).not.toBe(callIds(second)[0]);

      const body = yield* Gemini.protocol.body.from(
        request({
          messages: [
            Message.assistant({ type: 'tool-call', id: 'fc-native', name: 'read', input: {} }),
            Message.tool({ id: 'fc-native', name: 'read', result: 'ok', resultType: 'text' }),
          ],
        }),
      );
      const parts = body.contents.flatMap((content) => content.parts);
      expect(parts.flatMap((part) => ('functionCall' in part ? [part.functionCall.id] : []))).toEqual(['fc-native']);
      expect(parts.flatMap((part) => ('functionResponse' in part ? [part.functionResponse.id] : []))).toEqual(['fc-native']);
    }),
  );
});

describe('a signature carried by answer text survives the round trip', () => {
  it.effect('the closing signature of a text answer lands on its text, and goes back with it', () =>
    Effect.gen(function* () {
      const events = yield* answer([model([{ text: 'Done.' }]), model([{ text: '', thoughtSignature: 'sig-text' }], 'STOP')]);
      const ended = events.find((event) => event.type === 'text-end');
      expect(ended?.providerMetadata).toEqual({ google: { thoughtSignature: 'sig-text' } });

      const body = yield* Gemini.protocol.body.from(
        request({
          messages: [Message.assistant({ type: 'text', text: 'Done.', providerMetadata: { google: { thoughtSignature: 'sig-text' } } })],
        }),
      );
      expect(body.contents[0]?.parts).toEqual([{ text: 'Done.', thoughtSignature: 'sig-text' }]);
    }),
  );
});

describe('how an answer ends', () => {
  it.effect('an error inside a successful stream fails with the provider’s own words', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        answer([{ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Function call is missing a thought_signature' } } as Chunk]),
      );
      expect(failure.reason.message).toContain('missing a thought_signature');
    }),
  );

  it.effect('a blocked prompt finishes as filtered content', () =>
    Effect.gen(function* () {
      const events = yield* answer([{ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } as Chunk]);
      expect(events.find((event) => event.type === 'finish')).toMatchObject({ reason: 'content-filter' });
    }),
  );

  it.effect('usage without a finish reason is no terminal answer', () =>
    Effect.gen(function* () {
      const events = yield* answer([
        { ...model([{ text: 'partial' }]), usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } } as Chunk,
      ]);
      expect(events.some((event) => event.type === 'finish')).toBe(false);
    }),
  );
});

it.effect('a tool whose input is a union of objects offers each branch as anyOf', () =>
  Effect.gen(function* () {
    const branch = (field: string) => ({ type: 'object', properties: { [field]: { type: 'string' } }, required: [field] });
    const body = yield* Gemini.protocol.body.from(
      request({
        tools: [
          ToolDefinition.make({
            name: 'read_performance',
            description: 'Read one view.',
            inputSchema: { type: 'object', anyOf: [branch('span'), branch('trace')] },
          }),
          ToolDefinition.make({
            name: 'pick',
            description: 'Pick one.',
            inputSchema: { type: 'object', oneOf: [branch('left'), branch('right')] },
          }),
        ],
      }),
    );
    const parameters = body.tools?.[0]?.functionDeclarations.map((tool) => tool.parameters);
    expect(
      parameters?.map((schema) => (schema?.anyOf as ReadonlyArray<{ required: unknown }> | undefined)?.map((one) => one.required)),
    ).toEqual([
      [['span'], ['trace']],
      [['left'], ['right']],
    ]);
    expect(parameters?.some((schema) => schema !== undefined && 'oneOf' in schema)).toBe(false);
  }),
);
