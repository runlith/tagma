import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Message, ToolDefinition, ToolResultPart } from '@runlith/llm/schema/messages';
import { ThreadRequestMeter, type MeteredRequestInput } from './ThreadRequestMeter';
const input = (messages: readonly Message[]): MeteredRequestInput => ({
  system: 'System 🙂',
  messages,
  tools: [ToolDefinition.make({ name: 'read', description: 'reads a value', inputSchema: { type: 'object' } })],
  providerOptions: { nested: [undefined, null, true, 7, '日本語', new Uint8Array([0, 255, 3])] },
});
it.effect(
  'asynchronous metering preserves exact structured identities, prices and prefix refusals',
  Effect.fnUntraced(function* () {
    const messages = [
      Message.user('First turn 🙂'),
      Message.tool(ToolResultPart.from({ id: 'call', name: 'read', result: { type: 'json', value: { second: 2, first: 1 } } })),
      Message.user([{ type: 'media', mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) }]),
    ];
    const sent = input(messages);
    const sync = new ThreadRequestMeter();
    const async = new ThreadRequestMeter();
    const expected = sync.request(sent, 100);
    expect(yield* async.requestHashed(sent, 100)).toEqual(expected);
    expect(async.size(sent, 100)).toBe(expected.tokens);
    const basis = { inputTokens: 7_777, cachedInputTokens: null, provider: 'provider', model: 'model', footprint: expected.footprint };
    const next = { ...sent, messages: [...messages, Message.user('continue')] };
    expect(yield* async.estimateHashed(next, basis, 100)).toEqual(sync.estimate(next, basis, 100));
    const rewritten = { ...next, messages: [Message.user('same length, different text'), ...next.messages.slice(1)] };
    expect(yield* async.estimateHashed(rewritten, basis, 100)).toEqual(sync.estimate(rewritten, basis, 100));
    expect(yield* async.requestHashed(sent, 5_000)).toEqual(sync.request(sent, 5_000));
  }),
);
it.effect(
  'concurrent new requests retain independent length framing while encoding yields',
  Effect.fnUntraced(function* () {
    const requests = [1, 7].map((width) => ({
      ...input([]),
      providerOptions: Array.from({ length: 128 }, (_, at) => ({
        name: 'x'.repeat(width),
        text: `${at}日本語`,
        bytes: new Uint8Array(width),
      })),
    }));
    const expected = requests.map((request) => new ThreadRequestMeter().request(request, 0));
    const measured = yield* Effect.all(
      requests.map((request) => new ThreadRequestMeter().requestHashed(request, 0)),
      { concurrency: 2 },
    );
    expect(measured).toEqual(expected);
  }),
);
it.effect(
  'a known immutable prefix is not traversed again when a new tail is metered',
  Effect.fnUntraced(function* () {
    let opened = true;
    const carry = Object.defineProperty({}, 'identity', {
      enumerable: true,
      get() {
        if (!opened) throw new Error('an already identified prefix was traversed again');
        return 'carried bytes';
      },
    });
    const message = Message.make({ role: 'assistant', content: 'already sent', native: { claudeCode: carry } });
    const sent = input([message]);
    const meter = new ThreadRequestMeter();
    const measured = yield* meter.requestHashed(sent, 0);
    opened = false;
    const next = { ...sent, messages: [...sent.messages, Message.user('new tail')] };
    const basis = { inputTokens: 8_000, cachedInputTokens: null, provider: 'provider', model: 'model', footprint: measured.footprint };
    expect(yield* meter.estimateHashed(next, basis, 0)).toMatchObject({ measured: 8_000, basis: 'measured' });
    expect((yield* meter.requestHashed(next, 0)).footprint.messages).toBe(2);
  }),
);
