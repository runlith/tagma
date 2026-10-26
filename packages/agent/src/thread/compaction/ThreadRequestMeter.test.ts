import { describe, expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import * as AnthropicMessages from '@runlith/llm/protocols/anthropic-messages';
import * as LLM from '@runlith/llm/call';
import { Message, ToolCallPart, ToolDefinition, ToolResultPart } from '@runlith/llm/schema/messages';
import { ModelID, ProviderID } from '@runlith/llm/schema/ids';
import { ModelIdentity } from '@runlith/llm/schema/options';
import type { AgentRequestFootprint } from '../../agent/AgentCallMeasurement';
import { estimateThreadTokens } from './measurement';
import { MeteredParts, ThreadRequestMeter } from './ThreadRequestMeter';
import { prepare } from '@runlith/llm/route/client';
describe('ThreadRequestMeter', () => {
  const turns = (count: number, size: number) => Array.from({ length: count }, (_, index) => Message.user('x'.repeat(size) + index));
  const tools = (...names: readonly string[]) =>
    names.map((name) =>
      ToolDefinition.make({
        name,
        description: `does ${name}`,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      }),
    );
  const request = (messages: readonly Message[], toolSet = tools('search')) => ({
    system: 'the system prompt',
    messages,
    tools: toolSet,
    providerOptions: undefined,
  });
  const basis = (inputTokens: number, footprint: AgentRequestFootprint) => ({
    inputTokens,
    cachedInputTokens: null,
    provider: 'openai-oauth',
    model: 'gpt-5.5',
    footprint,
  });
  test('a proved prefix is taken as the provider counted it, and only the addition is estimated', () => {
    const meter = new ThreadRequestMeter();
    const measured = turns(2, 4_000);
    const sent = request(measured);
    const taken = basis(61_000, meter.request(sent, 0).footprint);
    const next = request([...measured, ...turns(1, 100)]);
    const estimate = meter.estimate(next, taken, 0);
    expect(estimate.measured).toBe(61_000);
    expect(estimate.basis).toBe('measured');
    expect(estimate.estimated).toBeGreaterThan(0);
    expect(estimate.estimated).toBeLessThan(meter.request(sent, 0).tokens / 10);
    const unmeasured = meter.estimate(sent, null, 0);
    expect(unmeasured.measured).toBe(0);
    expect(unmeasured.basis).toBe('none');
    expect(unmeasured.estimated).toBe(meter.request(sent, 0).tokens);
  });
  it.effect(
    'a step over a measured history reads only the messages it added',
    Effect.fnUntraced(function* () {
      const meter = new ThreadRequestMeter();
      const reads = new Map<number, number>();
      const watched = turns(1, 1).map(
        (message, index) =>
          new Proxy(message, {
            get(target, key, receiver) {
              if (key === 'content') reads.set(index, (reads.get(index) ?? 0) + 1);
              return Reflect.get(target, key, receiver);
            },
          }),
      );
      yield* meter.requestHashed(request(watched), 0);
      reads.clear();
      const next = yield* meter.requestHashed(request([...watched, Message.user('the next turn')]), 0);
      expect(next.footprint.messages).toBe(2);
      expect(reads.size).toBe(0);
    }),
  );
  it.effect(
    'the next run metering the same held messages reads none of them again',
    Effect.fnUntraced(function* () {
      const parts = new MeteredParts();
      const reads = new Map<number, number>();
      const watched = turns(3, 100).map(
        (message, index) =>
          new Proxy(message, {
            get(target, key, receiver) {
              if (key === 'content') reads.set(index, (reads.get(index) ?? 0) + 1);
              return Reflect.get(target, key, receiver);
            },
          }),
      );
      const first = yield* new ThreadRequestMeter(parts).requestHashed(request(watched), 0);
      reads.clear();
      const next = yield* new ThreadRequestMeter(parts).requestHashed(request(watched), 0);
      expect(next).toEqual(first);
      expect(reads.size).toBe(0);
    }),
  );
  test('a basis measured over live messages opens on the same history read back from storage by the next run', () => {
    const live = [
      Message.user('read the file'),
      Message.assistant([ToolCallPart.from({ id: 'call-1', name: 'read', input: { path: 'a.ts' } })]),
      Message.tool(ToolResultPart.from({ id: 'call-1', name: 'read', result: 'x'.repeat(4_000), resultType: 'text' })),
    ];
    const taken = basis(61_000, new ThreadRequestMeter().request(request(live), 0).footprint);
    const stored: Message[] = JSON.parse(JSON.stringify(live));
    const estimate = new ThreadRequestMeter().estimate(request([...stored, Message.user('next turn')]), taken, 0);
    expect(estimate.basis).toBe('measured');
    expect(estimate.measured).toBe(61_000);
  });
  test('a request that added nothing is the measurement itself', () => {
    const meter = new ThreadRequestMeter();
    const sent = request(turns(5, 1_000));
    const taken = basis(7_777, meter.request(sent, 0).footprint);
    expect(meter.estimate(sent, taken, 0)).toEqual({
      measured: 7_777,
      covered: meter.request(sent, 0).tokens,
      estimated: 0,
      basis: 'measured',
    });
  });
  test('a same-length prefix rewritten under the basis is refused, not counted as proof', () => {
    const meter = new ThreadRequestMeter();
    const sent = request(turns(4, 1_000));
    const taken = basis(50_000, meter.request(sent, 0).footprint);
    const rewritten = request([...turns(3, 1_000), Message.user('something else entirely')]);
    const estimate = meter.estimate(rewritten, taken, 0);
    expect(estimate.measured).toBe(0);
    expect(estimate.basis).toBe('prefix');
    expect(estimate.estimated).toBe(meter.request(rewritten, 0).tokens);
  });
  test('a history shorter than the measurement covered is refused', () => {
    const meter = new ThreadRequestMeter();
    const taken = basis(90_000, meter.request(request(turns(20, 1_000)), 0).footprint);
    const folded = request(turns(3, 1_000));
    expect(meter.estimate(folded, taken, 0)).toMatchObject({ measured: 0, basis: 'length' });
  });
  test('a changed prompt or a dropped tool keeps the measured history: the new prompt and messages are estimated, the replaced prompt is sized as its replacement', () => {
    const meter = new ThreadRequestMeter();
    const messages = turns(6, 800);
    const taken = basis(30_000, meter.request(request(messages, tools('search', 'read')), 0).footprint);
    const next = [...messages, Message.user('the next turn')];
    const turn = meter.request(request(next, []), 0).tokens - meter.request(request(messages, []), 0).tokens;
    const reprompted = { ...request(next, tools('search', 'read')), system: 'a different prompt' };
    const prompt = meter.request({ ...request([], []), system: 'a different prompt' }, 0).tokens;
    expect(meter.estimate(reprompted, taken, 0)).toMatchObject({
      measured: 30_000,
      covered: meter.request({ ...request(messages, tools('search', 'read')), system: 'a different prompt' }, 0).tokens,
      estimated: prompt + turn,
      basis: 'prompt',
    });
    expect(meter.estimate(request(next, tools('search')), taken, 0)).toMatchObject({
      measured: 30_000,
      covered: meter.request(request(messages, tools('search')), 0).tokens,
      estimated: turn,
      basis: 'tools',
    });
  });
  test('a basis measured over the narrowed tools is borrowed by the ceiling, and the tools it lacked are priced', () => {
    const meter = new ThreadRequestMeter();
    const messages = turns(6, 800);
    const sent = request(messages, tools('search'));
    const taken = basis(30_000, meter.request(sent, 0).footprint);
    const ceiling = request(messages, tools('search', 'read'));
    const estimate = meter.estimate(ceiling, taken, 0);
    expect(estimate.measured).toBe(30_000);
    expect(estimate.estimated).toBe(meter.request(request([], tools('read')), 0).tokens - meter.request(request([], []), 0).tokens);
  });
  test('a message provider carry is priced at nothing and still names the request', () => {
    const meter = new ThreadRequestMeter();
    const bare = Message.make({ role: 'assistant', content: 'The build is green.', id: 'msg_1', requestId: 'req_1' });
    const carrying = Message.make({
      ...bare,
      native: { claudeCode: { inventory: 'mcp__tagma__read_block\n'.repeat(2_000), countdown: 7 } },
    });
    expect(meter.request(request([carrying]), 0).tokens).toBe(meter.request(request([bare]), 0).tokens);
    expect(meter.request(request([carrying]), 0).footprint.messageDigest).not.toBe(
      meter.request(request([bare]), 0).footprint.messageDigest,
    );
  });
  test('a deferred tool costs its name until a search in the history revealed it', () => {
    const meter = new ThreadRequestMeter();
    const deferred = ToolDefinition.make({
      name: 'read_block',
      description: 'read one block, with a schema the size of a paragraph'.repeat(20),
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
      deferred: true,
    });
    const declared = estimateThreadTokens(deferred);
    const named = meter.request(request([], [deferred]), 0).tokens - meter.request(request([], []), 0).tokens;
    expect(named).toBeLessThan(declared / 5);
    const revealing = Message.tool(
      ToolResultPart.from({
        id: 'call-1',
        name: 'tool_search',
        result: {
          type: 'json',
          value: {
            status: 'revealed',
            tools: [{ name: 'read_block', description: 'read one block' }],
            missing: [],
            truncated: [],
            note: '',
          },
        },
      }),
    );
    const afterReveal = meter.request(request([revealing], [deferred]), 0).tokens - meter.request(request([revealing], []), 0).tokens;
    expect(afterReveal).toBe(declared);
    const taken = basis(1_000, meter.request(request([], [deferred]), 0).footprint);
    const told = meter.request(request([revealing], []), 0).tokens - meter.request(request([], []), 0).tokens;
    expect(meter.estimate(request([revealing], [deferred]), taken, 0)).toMatchObject({ measured: 1_000, estimated: told + declared });
  });
  test('an attachment reference and the bytes it resolves to are different requests', () => {
    const meter = new ThreadRequestMeter();
    const referenced = Message.user([{ type: 'media', mediaType: 'image/png', data: 'attachment://thread-1/picture-1' }]);
    const hydrated = Message.user([{ type: 'media', mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }]);
    const stored = meter.request(request([referenced]), 0);
    const sent = meter.request(request([hydrated]), 0);
    expect(sent.footprint.messageDigest).not.toBe(stored.footprint.messageDigest);
    expect(meter.estimate(request([referenced]), basis(4_000, sent.footprint), 0).measured).toBe(0);
  });
  test('nothing a payload can spell impersonates the bytes it stands for', () => {
    const meter = new ThreadRequestMeter();
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const real = { adapter: { data: bytes } };
    const asString = { adapter: { data: `bytes:${digest}` } };
    const asObject = { adapter: { data: { binary: 3, digest } } };
    const messages = [Message.user('a turn')];
    const priced = (providerOptions: unknown) =>
      meter.request({ system: 'sys', messages, tools: [], providerOptions }, 0).footprint.promptDigest;
    expect(priced(asString)).not.toBe(priced(real));
    expect(priced(asObject)).not.toBe(priced(real));
    expect(priced(asObject)).not.toBe(priced(asString));
  });
  it.effect(
    'different compiled tool-result text cannot borrow the same measured prefix',
    Effect.fnUntraced(function* () {
      const meter = new ThreadRequestMeter();
      const model = AnthropicMessages.route.model({ id: 'claude-opus-5', provider: 'test-provider' });
      const history = (value: Record<string, number>) =>
        request([
          Message.user('read the result'),
          Message.assistant([ToolCallPart.from({ id: 'call-1', name: 'search', input: {} })]),
          Message.tool(ToolResultPart.from({ id: 'call-1', name: 'search', result: { type: 'json', value } })),
        ]);
      const sent = history({ first: 1, second: 2 });
      const rewritten = history({ second: 2, first: 1 });
      const before = yield* prepare(LLM.request({ model, ...sent }));
      const after = yield* prepare(LLM.request({ model, ...rewritten }));
      expect(JSON.stringify(after.body)).not.toBe(JSON.stringify(before.body));
      const taken = basis(7_777, meter.request(sent, 0).footprint);
      expect(meter.estimate(rewritten, taken, 0)).toEqual({
        measured: 0,
        covered: 0,
        estimated: meter.request(rewritten, 0).tokens,
        basis: 'prefix',
      });
    }),
  );
  it.effect(
    'raw measurement and anchored sizing preserve compiled bodies and mixed-model cache prefixes',
    Effect.fnUntraced(function* () {
      const model = AnthropicMessages.route.model({ id: 'claude-opus-5', provider: 'test-provider' });
      const foreign = new ModelIdentity({ provider: ProviderID.make('openai-oauth'), model: ModelID.make('gpt-5.6-sol') });
      for (const origin of [ModelIdentity.of(model), foreign]) {
        const meter = new ThreadRequestMeter();
        const sent = request([
          Message.user('read the result'),
          Message.make({
            role: 'assistant',
            origin,
            content: [
              { type: 'reasoning', text: 'thinking', providerMetadata: { anthropic: { signature: 'signed' } } },
              ToolCallPart.from({ id: 'call-1', name: 'search', input: {} }),
            ],
          }),
          Message.tool(ToolResultPart.from({ id: 'call-1', name: 'search', result: { type: 'json', value: { second: 2, first: 1 } } })),
        ]);
        const next = { ...sent, messages: [...sent.messages, Message.user('continue')] };
        const before = (yield* prepare<AnthropicMessages.AnthropicMessagesBody>(LLM.request({ model, ...next }))).body;
        const body = JSON.stringify(before);
        const prefix = JSON.stringify(AnthropicMessages.protocol.body.cachePrefix?.(before));
        expect(prefix).toBeDefined();
        expect(before.system?.[0]?.cache_control).toEqual({ type: 'ephemeral' });
        const taken = basis(7_777, meter.request(sent, 0).footprint);
        expect(meter.estimate(next, taken, 0).measured).toBe(7_777);
        meter.request(next, 0);
        const after = (yield* prepare<AnthropicMessages.AnthropicMessagesBody>(LLM.request({ model, ...next }))).body;
        expect(JSON.stringify(after)).toBe(body);
        expect(JSON.stringify(AnthropicMessages.protocol.body.cachePrefix?.(after))).toBe(prefix);
      }
    }),
  );
  test('prefix totals preserve the original addition order for fractional image prices', () => {
    const meter = new ThreadRequestMeter();
    const picture = Message.user([{ type: 'media', mediaType: 'image/png', data: new Uint8Array(4) }]);
    const sent = request([picture]);
    const cheap = meter.request(sent, 0).tokens;
    const price = 5_000.1;
    const priced = meter.request(sent, price);
    expect(priced.tokens).toBeGreaterThan(cheap);
    const next = { ...sent, messages: [...sent.messages, Message.user('the new tail')] };
    expect(meter.request(next, price).tokens).toBe(meter.size(next, price));
    const estimate = meter.estimate(next, basis(8_000, priced.footprint), price);
    const tail = meter.size({ ...sent, messages: next.messages.slice(1) }, price) - meter.size({ ...sent, messages: [] }, price);
    expect(estimate).toEqual({ measured: 8_000, covered: meter.size(sent, price), estimated: tail, basis: 'measured' });
  });
  test('price-only sizing does not inspect the provider carry that only identifies a request', () => {
    const bare = Message.assistant('the text the provider reads');
    const carry = Object.defineProperty({}, 'identity', {
      enumerable: true,
      get() {
        throw new Error('the price-only path inspected digest-only state');
      },
    });
    const carried = Message.make({ ...bare, native: { claudeCode: carry } });
    expect(new ThreadRequestMeter().size(request([carried]), 0)).toBe(new ThreadRequestMeter().request(request([bare]), 0).tokens);
  });
  test('the whole-request price is what the raw estimator says of its parts', () => {
    const meter = new ThreadRequestMeter();
    const sent = request(turns(3, 900));
    const whole = estimateThreadTokens(sent);
    expect(meter.request(sent, 0).tokens).toBeGreaterThan(whole * 0.9);
    expect(meter.request(sent, 0).tokens).toBeLessThan(whole * 1.1);
  });
});
