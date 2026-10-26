import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect, Exit, Fiber, Layer, Schema, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { Headers } from 'effect/http';
import { activity } from '@runlith/activity/Activity';
import type { ActivityFact } from '@runlith/activity/fact';
import { ActivityLog } from '@runlith/activity/log';
import { MODEL_CALL } from '@runlith/activity/modelCall';
import { openModelClient } from '../../models/client';
import * as LLM from '../call';
import * as OpenAIResponses from '../protocols/openai-responses';
import { type LLMError, WireFailureRecord, wireFailureRecord } from '../schema/errors';
import { VENDOR_CALL_TIMEOUT_MS } from '../../vendorCall';
import { Route } from './definition';
import { Endpoint } from './endpoint';
import { MAX_RETRIES } from './executor';
import * as Framing from './framing';
import * as OneShotTransport from './transport/one-shot';
import { fromWebSocket } from './transport/websocket';
import { answering } from './transport/answering';
import { generate, stream } from './client';

type Door = ReturnType<typeof oneShotAnswer>;

const decodeRecord = Schema.decodeUnknownEffect(WireFailureRecord);

const REASONING = JSON.stringify({
  type: 'response.reasoning_text.delta',
  item_id: 'reasoning-1',
  delta: 'thinking',
});

const OUTPUT = JSON.stringify({ type: 'response.output_text.delta', item_id: 'msg-1', delta: 'Hel' });

const CALL = { id: 'fc-1', type: 'function_call', call_id: 'call-1', name: 'send_task' };
const TOOL_START = JSON.stringify({ type: 'response.output_item.added', item: { ...CALL, arguments: '' } });
const TOOL_DELTA = JSON.stringify({ type: 'response.function_call_arguments.delta', item_id: 'fc-1', delta: '{"to":' });
const TOOL_DONE = JSON.stringify({ type: 'response.output_item.done', item: { ...CALL, arguments: '{"to":"x"}' } });

const BLANK_ERROR = JSON.stringify({ type: 'error', sequence_number: 0 });

const REFUSED = JSON.stringify({
  type: 'response.failed',
  response: { id: 'response-1', error: { code: 'invalid_prompt', message: 'The prompt is invalid.' } },
});

const COMPLETED = JSON.stringify({
  type: 'response.completed',
  response: { id: 'response-1', service_tier: null, incomplete_details: null, usage: null },
});

const streaming = (input: {
  readonly frames: ReadonlyArray<string> | ((attempt: number) => ReadonlyArray<string>);
  readonly headers?: Record<string, string>;
  readonly cut: unknown;
  readonly healsAt?: number;
}) => {
  let requests = 0;
  const door = answering(async () => {
    const attempt = requests++;
    const heals = input.healsAt === attempt;
    const streamed = typeof input.frames === 'function' ? input.frames(attempt) : input.frames;
    const frames = heals ? [...streamed, COMPLETED] : streamed;
    const encoder = new TextEncoder();
    let sent = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const frame = frames[sent];
          if (frame !== undefined) {
            sent += 1;
            return controller.enqueue(encoder.encode(`data: ${frame}\n\n`));
          }
          return heals ? controller.close() : controller.error(input.cut);
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream', ...input.headers },
      },
    );
  });
  return { client: door, requests: () => requests };
};

const oneShotAnswer = (body: string, status = 200) =>
  answering(() => new Response(body, { status, headers: { 'x-request-id': 'req_one_shot' } }));

const model = () =>
  OpenAIResponses.route.with({ provider: 'wire-test', endpoint: { baseURL: 'https://provider.test/v1' } }).model({ id: 'model-test' });

const reading = Effect.fnUntraced(
  function* (fetch: Door) {
    const lifetime = yield* Scope.make();
    const request = LLM.request({ model: model(), prompt: 'Hello' });
    return yield* Stream.runCollect(stream(request, lifetime)).pipe(Effect.ensuring(Scope.close(lifetime, Exit.void)));
  },
  (effect, fetch) => Effect.provide(effect, Layer.effectContext(openModelClient(fetch))),
);

const torn = (fetch: Door) => Effect.flip(reading(fetch)) as Effect.Effect<LLMError>;

const answered = (fetch: Door) =>
  generate(LLM.request({ model: model(), prompt: 'Hello' })).pipe(Effect.provide(Layer.effectContext(openModelClient(fetch))));

const withoutWaiting = Effect.fnUntraced(function* <A, E>(effect: Effect.Effect<A, E>) {
  const call = yield* Effect.forkChild(effect);
  yield* TestClock.adjust(MAX_RETRIES * VENDOR_CALL_TIMEOUT_MS);
  return yield* Fiber.join(call);
});

const unanswered = (fetch: Door) => withoutWaiting(Effect.flip(answered(fetch))) as Effect.Effect<LLMError>;

const outputOf = Effect.fnUntraced(function* (error: LLMError) {
  if (error.reason._tag !== 'InvalidProviderOutput') return yield* Effect.die(`expected a body break, got ${error.reason._tag}`);
  return error.reason;
});

describe('a body break after a 200', () => {
  it.effect('preserves the native socket code through the durable failure record', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: [OUTPUT],
        cut: Object.assign(new TypeError('The socket closed unexpectedly'), { code: 'ECONNRESET' }),
      });
      const error = yield* torn(wire.client);
      const record = yield* decodeRecord(JSON.parse(JSON.stringify(wireFailureRecord(error))));
      expect(record.cause?.at(-1)).toEqual({ tag: 'TypeError', message: 'The socket closed unexpectedly', code: 'ECONNRESET' });
      expect(error.detail).toContain('ECONNRESET');
      expect(error.retryable).toBe(true);
    }),
  );

  it.live('redacts a sent credential from native error codes before persistence', () =>
    Effect.gen(function* () {
      const secret = 'secret-header-value';
      const wire = streaming({
        frames: [OUTPUT],
        cut: Object.assign(new Error('connection ended'), { code: secret }),
      });
      const request = LLM.request({ model: model(), prompt: 'Hello', http: { headers: { authorization: `Bearer ${secret}` } } });
      const error = yield* Effect.gen(function* () {
        const lifetime = yield* Scope.make();
        return yield* Effect.flip(Stream.runCollect(stream(request, lifetime))).pipe(Effect.ensuring(Scope.close(lifetime, Exit.void)));
      }).pipe(Effect.provide(Layer.effectContext(openModelClient(wire.client))));
      const record = yield* decodeRecord(JSON.parse(JSON.stringify(wireFailureRecord(error))));
      expect(record.cause?.at(-1)).toMatchObject({ code: '<redacted>' });
      expect(JSON.stringify(record)).not.toContain(secret);
      expect(error.detail).not.toContain(secret);
    }),
  );

  it.effect('preserves a protocol defect instead of retrying it as a broken connection', () =>
    Effect.gen(function* () {
      const defect = new Error('protocol reducer invariant failed');
      const route = Route.make({
        id: 'defect-test',
        provider: 'wire-test',
        protocol: {
          ...OpenAIResponses.protocol,
          stream: {
            ...OpenAIResponses.protocol.stream,
            step: () =>
              Effect.sync(() => {
                throw defect;
              }),
          },
        },
        endpoint: Endpoint.path('/responses', { baseURL: 'https://provider.test/v1' }),
        framing: Framing.sse,
      });
      const wire = streaming({ frames: [OUTPUT], cut: new Error('unused'), healsAt: 0 });
      const exit = yield* withoutWaiting(
        Effect.exit(
          generate(LLM.request({ model: route.model({ id: 'model-test' }), prompt: 'Hello' })).pipe(
            Effect.provide(Layer.effectContext(openModelClient(wire.client))),
          ),
        ),
      );
      expect(exit._tag).toBe('Failure');
      if (exit._tag !== 'Failure') return yield* Effect.die('Expected the protocol defect');
      expect(exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)).toEqual([defect]);
      expect(wire.requests()).toBe(1);
    }),
  );

  it.effect('carries the family, the reply it belonged to, how far the read got and whose abort cut it', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: [REASONING, REASONING, REASONING],
        headers: { 'x-request-id': 'req_torn' },
        cut: new Error('The socket connection was closed unexpectedly'),
      });
      const reason = yield* outputOf(yield* torn(wire.client));

      expect(reason.family).toBe('torn-stream');
      expect(reason.status).toBe(200);
      expect(reason.upstreamRequestId).toBe('req_torn');
      expect(reason.bytesRead).toBeGreaterThan(0);
      expect(reason.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(reason.lastEvent).toMatchObject({ type: 'reasoning-delta' });
      expect(reason.lastEvent?.count).toBeGreaterThanOrEqual(3);
      expect(reason.cause?.at(-1)?.message).toContain('The socket connection was closed unexpectedly');
      expect(reason.cause?.length).toBeGreaterThan(1);
    }),
  );

  it.effect('leaves the streaming door on its first attempt, retryable, with one request made', () =>
    Effect.gen(function* () {
      const wire = streaming({ frames: [REASONING], cut: new Error('reset by peer'), healsAt: 1 });
      const error = yield* torn(wire.client);

      expect((yield* outputOf(error)).attempt).toBe(0);
      expect(error.retryable).toBe(true);
      expect(wire.requests()).toBe(1);
    }),
  );

  it.effect('is asked again by the one-shot door, and the healed attempt is the answer', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: (attempt) => (attempt === 0 ? [REASONING] : [REASONING, OUTPUT]),
        cut: new Error('reset by peer'),
        healsAt: 1,
      });
      const response = yield* withoutWaiting(answered(wire.client));

      expect(response.text).toBe('Hel');
      expect(response.finishReason).toBe('stop');
      expect(wire.requests()).toBe(2);
    }),
  );

  it.effect('exhausts the wire’s four retries at the one-shot door and names the attempt that gave up', () =>
    Effect.gen(function* () {
      const wire = streaming({ frames: [REASONING], cut: new Error('reset by peer') });
      const reason = yield* outputOf(yield* unanswered(wire.client));

      expect(reason.family).toBe('torn-stream');
      expect(reason.attempt).toBe(4);
      expect(wire.requests()).toBe(5);
    }),
  );

  it.effect('projects into the stored record with the same fields, not into its sentence', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: [REASONING, REASONING, REASONING],
        headers: { 'x-request-id': 'req_torn' },
        cut: new Error('The socket connection was closed unexpectedly'),
      });
      const error = yield* torn(wire.client);
      const record = wireFailureRecord(error);

      expect(record).toMatchObject({
        family: 'torn-stream',
        status: 200,
        upstreamRequestId: 'req_torn',
        attempt: 0,
        lastEvent: { type: 'reasoning-delta' },
      });
      expect(record.bytesRead).toBeGreaterThan(0);
      expect(record.cause?.at(-1)?.message).toContain('The socket connection was closed unexpectedly');
      expect(yield* decodeRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    }),
  );

  it.effect('notes each break the one-shot door met under the family the table read', () =>
    Effect.gen(function* () {
      const wire = streaming({ frames: [REASONING], cut: new Error('reset by peer'), healsAt: 1 });
      const facts: ActivityFact[] = [];

      yield* withoutWaiting(
        activity(MODEL_CALL, { provider: 'anthropic', model: 'claude', rung: null }, answered(wire.client)).pipe(
          Effect.provideService(ActivityLog, { record: (fact) => void facts.push(fact), settled: Effect.void }),
        ),
      );

      const seen = facts.flatMap((fact) =>
        fact._tag === 'Noted' ? [fact.note as { readonly type: string } & Record<string, unknown>] : [],
      );
      const failed = seen.filter((note) => note.type === 'stream-failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({ transportAttempt: 0, family: 'torn-stream', status: 200, retryable: true });
      const scheduled = seen.filter((note) => note.type === 'retry-scheduled');
      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]).toMatchObject({ transportAttempt: 0 });
      expect(scheduled[0]?.delayMs).toBeGreaterThan(0);
    }),
  );

  it.effect('a tear inside a tool input still arriving is asked again by the one-shot door, and the caller gets one tool call', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: (attempt) => (attempt === 0 ? [TOOL_START, TOOL_DELTA] : [TOOL_START, TOOL_DELTA, TOOL_DONE]),
        cut: new Error('reset by peer'),
        healsAt: 1,
      });
      const response = yield* withoutWaiting(answered(wire.client));

      expect(wire.requests()).toBe(2);
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls[0]).toMatchObject({ id: 'call-1', name: 'send_task' });
      expect(response.finishReason).toBe('tool-calls');
    }),
  );
});

describe('an error frame naming neither a code nor a message', () => {
  it.effect('is a blank-error body break the one-shot door asks again for, and the healed attempt is the answer', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: (attempt) => (attempt === 0 ? [REASONING, BLANK_ERROR] : [REASONING, OUTPUT]),
        cut: new Error('never reached: the frame ends the attempt'),
        healsAt: 1,
      });
      const response = yield* withoutWaiting(answered(wire.client));

      expect(wire.requests()).toBe(2);
      expect(response.text).toBe('Hel');
      expect(response.finishReason).toBe('stop');
    }),
  );

  it.effect('leaves the streaming door as blank-error with the frame’s shape as its evidence and the attempt’s reading', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: [REASONING, BLANK_ERROR],
        headers: { 'x-request-id': 'req_blank' },
        cut: new Error('never reached: the frame ends the attempt'),
      });
      const error = yield* torn(wire.client);
      const reason = yield* outputOf(error);

      expect(reason.family).toBe('blank-error');
      expect(error.retryable).toBe(true);
      expect(JSON.parse(reason.excerpt ?? '')).toEqual({
        kind: 'blank-error',
        eventType: 'error',
        keys: ['sequence_number', 'type'],
      });
      expect(reason).toMatchObject({ status: 200, upstreamRequestId: 'req_blank', attempt: 0 });
      expect(reason.lastEvent).toMatchObject({ type: 'reasoning-delta', count: 3 });
      expect(reason.message).toMatch(
        /^The provider ended the stream with an error naming neither a code nor a message \(blank-error · HTTP 200 · req_blank · \d+ bytes · 3 events, last reasoning-delta · \d+ ms\)$/,
      );
      expect(wire.requests()).toBe(1);
    }),
  );
});

describe('a failure the protocol raised inside the body', () => {
  it.effect('a spelled-out refusal carries the reply it belonged to and how far the read got', () =>
    Effect.gen(function* () {
      const wire = streaming({
        frames: [REASONING, REASONING, REFUSED],
        headers: { 'x-request-id': 'req_refused' },
        cut: new Error('never reached: the frame ends the attempt'),
      });
      const error = yield* torn(wire.client);

      expect(error.reason._tag).toBe('UnknownProvider');
      expect(error.retryable).toBe(false);
      expect(wire.requests()).toBe(1);
      expect(error.reason.message).toBe('invalid_prompt: The prompt is invalid.');
      expect(error.reason).toMatchObject({ status: 200, upstreamRequestId: 'req_refused', attempt: 0 });
      expect(wireFailureRecord(error)).toMatchObject({
        family: 'refused',
        status: 200,
        upstreamRequestId: 'req_refused',
        attempt: 0,
        lastEvent: { type: 'reasoning-delta', count: 4 },
      });
      expect(wireFailureRecord(error).bytesRead).toBeGreaterThan(0);
      expect(wireFailureRecord(error).elapsedMs).toBeGreaterThanOrEqual(0);
    }),
  );
});

describe('a 200 that is not JSON', () => {
  const oneShot = (fetch: Door, body: string) =>
    Effect.flip(
      OneShotTransport.post(
        {
          baseURL: 'https://provider.test/v1',
          headers: { authorization: 'Bearer secret-header-value' },
        },
        { path: `/answer?api_key=secret-query-value`, json: { prompt: body } },
      ).pipe(Effect.provide(Layer.effectContext(openModelClient(fetch)))),
    );

  it.live('carries the answer that arrived, bounded, as its excerpt', () =>
    Effect.gen(function* () {
      const reason = yield* outputOf(yield* oneShot(oneShotAnswer('<html><title>502 Bad Gateway</title></html>'), 'ask'));

      expect(reason.family).toBe('non-json-answer');
      expect(reason.status).toBe(200);
      expect(reason.upstreamRequestId).toBe('req_one_shot');
      expect(reason.excerpt).toContain('502 Bad Gateway');
    }),
  );

  it.live('never carries a secret this call sent, however the answer echoed it back', () =>
    Effect.gen(function* () {
      const reason = yield* outputOf(
        yield* oneShot(oneShotAnswer('gateway refused: sent secret-header-value, api_key=secret-query-value, {"token":"whatever"}'), 'ask'),
      );

      const excerpt = reason.excerpt ?? '';
      expect(excerpt).not.toContain('secret-header-value');
      expect(excerpt).not.toContain('secret-query-value');
      expect(excerpt).not.toContain('whatever');
      expect(excerpt).toContain('<redacted>');
    }),
  );
});

describe('a refusal the provider answered with an error body', () => {
  it.effect('keeps the provider’s own words and the expiry its code names in the stored record', () =>
    Effect.gen(function* () {
      const body = JSON.stringify({
        error: { type: 'authentication_error', code: 'api_key_expired', message: 'This API key has expired. Create a new API key.' },
      });
      const error = yield* withoutWaiting(Effect.flip(answered(oneShotAnswer(body, 401))));
      expect(error.reason).toMatchObject({ _tag: 'Authentication', kind: 'expired' });
      expect(yield* decodeRecord(JSON.parse(JSON.stringify(wireFailureRecord(error))))).toMatchObject({
        family: 'auth',
        status: 401,
        kind: 'expired',
        said: 'This API key has expired. Create a new API key.',
      });
    }),
  );
});

describe('a socket the peer closed', () => {
  const socket = () => {
    const listeners = new Map<string, Set<(event: never) => void>>();
    const ws = {
      readyState: 1,
      addEventListener: (type: string, listener: (event: never) => void) => {
        const set = listeners.get(type) ?? new Set<(event: never) => void>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, listener: (event: never) => void) => {
        listeners.get(type)?.delete(listener);
      },
      send: () => undefined,
      close: () => undefined,
    };
    return {
      ws: ws as unknown as globalThis.WebSocket,
      emit: (type: string, event: unknown) => {
        for (const listener of listeners.get(type) ?? []) listener(event as never);
      },
    };
  };

  it.effect('answers the code and the reason text the peer sent with it', () =>
    Effect.gen(function* () {
      const fake = socket();
      const error = (yield* Effect.flip(
        Effect.gen(function* () {
          const connection = yield* fromWebSocket(fake.ws, {
            url: 'wss://provider.test/stream',
            headers: Headers.fromInput({}),
          });
          fake.emit('close', { code: 1011, reason: 'upstream model unavailable' });
          return yield* Stream.runCollect(connection.messages);
        }),
      )) as LLMError;
      const reason = yield* outputOf(error);

      expect(reason.family).toBe('socket-closed');
      expect(reason.message).toContain('1011');
      expect(reason.excerpt).toBe('upstream model unavailable');
    }),
  );
});
